// POST /api/import/full-profile - Deep dive import of full LinkedIn data export
// Parses all CSV files to build a versioned owner profile for ICP/niche context

import { NextRequest, NextResponse } from 'next/server';
import { readdir, stat } from 'fs/promises';
import { join } from 'path';
import { getPool } from '@/lib/db/client';
import { importFullProfile, OwnerProfileImportError } from '@/lib/import/profile-importer';
import { allowedImportDirectory, readAllowedImportFile, validateDirectoryBatch } from '@/lib/import/directory-path';
import { MAX_TOTAL_SIZE, UploadLimitError } from '@/lib/import/upload-boundary';
import { detectDeepFileType } from '@/lib/import/profile-importer';

// GET - fetch current owner profile
export async function GET() {
  try {
    const pool = getPool();
    const result = await pool.query(
      'SELECT * FROM owner_profiles WHERE is_current = TRUE LIMIT 1'
    );

    if (result.rows.length === 0) {
      return NextResponse.json({ data: null });
    }

    return NextResponse.json({ data: result.rows[0] });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to fetch owner profile', details: error instanceof Error ? error.message : undefined },
      { status: 500 }
    );
  }
}

// POST - import full LinkedIn export
export async function POST(request: NextRequest) {
  let client;

  try {
    const body = await request.json();
    const { directoryPath } = body;

    if (!directoryPath || typeof directoryPath !== 'string') {
      return NextResponse.json(
        { error: 'directoryPath (string) is required' },
        { status: 400 }
      );
    }

    const resolvedPath = await allowedImportDirectory(directoryPath);
    if (!resolvedPath) {
      return NextResponse.json(
        { error: 'Directory path not allowed', details: 'Path must be under an allowed data directory' },
        { status: 403 }
      );
    }

    // Verify directory exists
    let dirStat;
    try {
      dirStat = await stat(resolvedPath);
    } catch {
      return NextResponse.json(
        { error: 'Directory not found', details: resolvedPath },
        { status: 404 }
      );
    }

    if (!dirStat.isDirectory()) {
      return NextResponse.json(
        { error: 'Path is not a directory' },
        { status: 400 }
      );
    }

    const entries = await readdir(resolvedPath);
    if (!entries.some(name => name.toLowerCase() === 'profile.csv')) {
      return NextResponse.json({ error: 'Profile.csv is required for owner profile import' }, { status: 400 });
    }
    const snapshots = new Map<string, Buffer>();
    let remainingBytes = MAX_TOTAL_SIZE;
    const selectedNames = entries.filter(name => detectDeepFileType(name));
    try { await validateDirectoryBatch(resolvedPath, selectedNames.map(name => join(resolvedPath, name))); }
    catch (error) {
      if (error instanceof UploadLimitError) throw error;
      return NextResponse.json({ error: 'CSV file path is not allowed or changed' }, { status: 403 });
    }
    for (const name of selectedNames) {
      try {
        const bytes = await readAllowedImportFile(resolvedPath, join(resolvedPath, name), remainingBytes);
        snapshots.set(name, bytes);
        remainingBytes -= bytes.byteLength;
      } catch (error) {
        if (error instanceof UploadLimitError) throw error;
        if (name.toLowerCase() === 'profile.csv') {
          return NextResponse.json({ error: `CSV file path is not allowed or changed: ${name}` }, { status: 403 });
        }
        // The importer receives the complete directory listing. A missing
        // supplemental snapshot becomes a reported skipped file there.
      }
    }

    // Run the full profile import
    const pool = getPool();
    client = await pool.connect();

    const result = await importFullProfile(client, resolvedPath, snapshots, entries);

    return NextResponse.json({
      data: {
        profileId: result.profileId,
        version: result.version,
        selfName: result.selfName,
        importedFiles: result.importedFiles,
        skippedFiles: result.skippedFiles,
        diagnostics: result.diagnostics,
        totalFiles: result.importedFiles.length,
      },
    });
  } catch (error) {
    if (error instanceof UploadLimitError) {
      return NextResponse.json({ error: error.message }, { status: 413 });
    }
    return NextResponse.json(
      { error: error instanceof OwnerProfileImportError ? error.message : 'Full profile import failed',
        details: error instanceof Error ? error.message : undefined },
      { status: error instanceof OwnerProfileImportError ? 422 : 500 }
    );
  } finally {
    if (client) client.release();
  }
}
