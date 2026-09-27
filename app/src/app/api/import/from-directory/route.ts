// POST /api/import/from-directory - import LinkedIn CSVs from a local directory path

import { NextRequest, NextResponse } from 'next/server';
import { readdir, stat } from 'fs/promises';
import { join, basename } from 'path';
import { getPool } from '@/lib/db/client';
import { runImportPipeline, detectFileType } from '@/lib/import/pipeline';
import { triggerBatchAutoScore } from '@/lib/scoring/auto-score';
import { query as dbQuery } from '@/lib/db/client';
import { allowedImportDirectory, readAllowedImportFile, validateDirectoryBatch } from '@/lib/import/directory-path';
import { MAX_TOTAL_SIZE, UploadLimitError } from '@/lib/import/upload-boundary';
import { createHash } from 'crypto';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: NextRequest) {
  let client;

  try {
    const body = await request.json();
    const { directoryPath, selfContactId, selfName } = body;

    // --- Validation ---

    if (!directoryPath || typeof directoryPath !== 'string') {
      return NextResponse.json(
        { error: 'directoryPath (string) is required' },
        { status: 400 }
      );
    }

    if (!selfContactId || !UUID_REGEX.test(selfContactId)) {
      return NextResponse.json(
        { error: 'Valid selfContactId (UUID) is required' },
        { status: 400 }
      );
    }

    const resolvedPath = await allowedImportDirectory(directoryPath);
    if (!resolvedPath) {
      return NextResponse.json(
        {
          error: 'Directory path is not allowed',
          details: 'Path must be under an allowed data directory',
        },
        { status: 403 }
      );
    }

    // --- Validate directory exists ---

    let dirStat;
    try {
      dirStat = await stat(resolvedPath);
    } catch {
      return NextResponse.json(
        { error: 'Directory not found', details: `Path does not exist: ${resolvedPath}` },
        { status: 404 }
      );
    }

    if (!dirStat.isDirectory()) {
      return NextResponse.json(
        { error: 'Path is not a directory', details: resolvedPath },
        { status: 400 }
      );
    }

    // --- Scan for CSV files ---

    const entries = await readdir(resolvedPath);
    const csvFiles = entries.filter((name) => name.toLowerCase().endsWith('.csv'));

    if (csvFiles.length === 0) {
      return NextResponse.json(
        { error: 'No CSV files found in directory', details: resolvedPath },
        { status: 400 }
      );
    }

    // Filter to files the pipeline recognizes
    const recognizedPaths: string[] = [];
    const snapshots = new Map<string, { bytes: Buffer; sha256: string }>();
    const skippedFiles: string[] = [];
    let remainingBytes = MAX_TOTAL_SIZE;

    const selectedPaths = csvFiles.filter(name => detectFileType(name))
      .map(name => join(resolvedPath, name));
    try { await validateDirectoryBatch(resolvedPath, selectedPaths); }
    catch (error) {
      if (error instanceof UploadLimitError) throw error;
      return NextResponse.json({ error: 'CSV file path is not allowed or changed' }, { status: 403 });
    }

    for (const filename of csvFiles) {
      const fileType = detectFileType(filename);
      if (fileType) {
        const path = join(resolvedPath, filename);
        let bytes: Buffer;
        try { bytes = await readAllowedImportFile(resolvedPath, path, remainingBytes); }
        catch (error) { if (error instanceof UploadLimitError) throw error;
          return NextResponse.json({ error: `CSV file path is not allowed or changed: ${filename}` }, { status: 403 }); }
        remainingBytes -= bytes.byteLength;
        snapshots.set(path, { bytes, sha256: createHash('sha256').update(bytes).digest('hex') });
        recognizedPaths.push(path);
      } else {
        skippedFiles.push(filename);
      }
    }

    if (recognizedPaths.length === 0) {
      return NextResponse.json(
        {
          error: 'No recognized LinkedIn CSV files found',
          details: { csvFilesFound: csvFiles, skippedFiles },
        },
        { status: 400 }
      );
    }

    // --- Run import pipeline ---

    const pool = getPool();
    client = await pool.connect();

    const summary = await runImportPipeline(
      client,
      recognizedPaths,
      selfContactId,
      selfName || '', undefined, snapshots
    );

    // Trigger auto-scoring for recently created/updated contacts
    let scoringTriggered = false;
    if (summary.newRecords > 0 || summary.updatedRecords > 0) {
      try {
        const recentContacts = await dbQuery<{ id: string }>(
          `SELECT id FROM contacts WHERE updated_at >= NOW() - INTERVAL '2 minutes' AND is_archived = FALSE LIMIT 500`
        );
        if (recentContacts.rows.length > 0) {
          triggerBatchAutoScore(recentContacts.rows.map(r => r.id));
          scoringTriggered = true;
        }
      } catch {
        // Non-critical
      }
    }

    return NextResponse.json({
      ...summary,
      directoryPath: resolvedPath,
      recognizedFiles: recognizedPaths.map((p) => basename(p)),
      skippedFiles: skippedFiles.length > 0 ? skippedFiles : undefined,
      scoringTriggered,
    });
  } catch (error) {
    if (error instanceof UploadLimitError) {
      return NextResponse.json({ error: error.message }, { status: 413 });
    }
    return NextResponse.json(
      {
        error: 'Import from directory failed',
        details: error instanceof Error ? error.message : undefined,
      },
      { status: 500 }
    );
  } finally {
    if (client) {
      client.release();
    }
  }
}
