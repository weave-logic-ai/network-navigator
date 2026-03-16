// POST /api/import/from-directory - import LinkedIn CSVs from a local directory path

import { NextRequest, NextResponse } from 'next/server';
import { readdir, stat } from 'fs/promises';
import { join, resolve, basename } from 'path';
import { getPool } from '@/lib/db/client';
import { runImportPipeline, detectFileType } from '@/lib/import/pipeline';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Allowed directory prefixes (absolute paths only)
const ALLOWED_PREFIXES = [
  '/home/aepod/dev/ctox/data/',
  '/data/',
];

function isPathAllowed(dirPath: string): boolean {
  const resolved = resolve(dirPath);

  // Reject paths with traversal sequences
  if (dirPath.includes('..')) {
    return false;
  }

  return ALLOWED_PREFIXES.some((prefix) => resolved.startsWith(prefix));
}

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

    // Resolve relative "data/" paths to absolute
    let resolvedPath = directoryPath;
    if (directoryPath.startsWith('data/')) {
      // Try container path first, then host path
      const containerPath = resolve('/', directoryPath);
      const hostPath = resolve('/home/aepod/dev/ctox', directoryPath);
      resolvedPath = containerPath;
      // Fallback to host path if container path doesn't match allowed prefixes
      if (!isPathAllowed(containerPath) && isPathAllowed(hostPath)) {
        resolvedPath = hostPath;
      }
    } else {
      resolvedPath = resolve(directoryPath);
    }

    // --- Security: path allowlist ---

    if (!isPathAllowed(resolvedPath)) {
      return NextResponse.json(
        {
          error: 'Directory path is not allowed',
          details: 'Path must be under /home/aepod/dev/ctox/data/',
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
    const skippedFiles: string[] = [];

    for (const filename of csvFiles) {
      const fileType = detectFileType(filename);
      if (fileType) {
        recognizedPaths.push(join(resolvedPath, filename));
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
      selfName || ''
    );

    return NextResponse.json({
      ...summary,
      directoryPath: resolvedPath,
      recognizedFiles: recognizedPaths.map((p) => basename(p)),
      skippedFiles: skippedFiles.length > 0 ? skippedFiles : undefined,
    });
  } catch (error) {
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
