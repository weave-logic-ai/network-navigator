// POST /api/import/full-profile - Deep dive import of full LinkedIn data export
// Parses all CSV files to build a versioned owner profile for ICP/niche context

import { NextRequest, NextResponse } from 'next/server';
import { stat } from 'fs/promises';
import { resolve } from 'path';
import { getPool } from '@/lib/db/client';
import { importFullProfile } from '@/lib/import/profile-importer';

const ALLOWED_PREFIXES = [
  '/home/aepod/dev/ctox/data/',
  '/data/',
];

function isPathAllowed(dirPath: string): boolean {
  const resolved = resolve(dirPath);
  if (dirPath.includes('..')) return false;
  return ALLOWED_PREFIXES.some((prefix) => resolved.startsWith(prefix));
}

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

    // Resolve relative "data/" paths
    let resolvedPath = directoryPath;
    if (directoryPath.startsWith('data/')) {
      // Try container path first, then host path
      const containerPath = resolve('/', directoryPath);
      const hostPath = resolve('/home/aepod/dev/ctox', directoryPath);
      resolvedPath = containerPath;
      if (!isPathAllowed(containerPath) && isPathAllowed(hostPath)) {
        resolvedPath = hostPath;
      }
    } else {
      resolvedPath = resolve(directoryPath);
    }

    if (!isPathAllowed(resolvedPath)) {
      return NextResponse.json(
        { error: 'Directory path not allowed', details: 'Path must be under /home/aepod/dev/ctox/data/' },
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

    // Run the full profile import
    const pool = getPool();
    client = await pool.connect();

    const result = await importFullProfile(client, resolvedPath);

    return NextResponse.json({
      data: {
        profileId: result.profileId,
        version: result.version,
        selfName: result.selfName,
        importedFiles: result.importedFiles,
        skippedFiles: result.skippedFiles,
        totalFiles: result.importedFiles.length,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: 'Full profile import failed', details: error instanceof Error ? error.message : undefined },
      { status: 500 }
    );
  } finally {
    if (client) client.release();
  }
}
