// GET /api/import/detect-local - check for LinkedIn export files in the known directory

import { NextResponse } from 'next/server';
import { readdir, stat } from 'fs/promises';
import { join } from 'path';
import { detectDeepFileType } from '@/lib/import/profile-importer';
import { detectContactFileType, previewContactCsv, previewOwnerProfileCsv } from '@/lib/import/mapping-preview';
import type { MappingPreview } from '@/lib/import/mapping-preview';
import { allowedImportDirectory, readAllowedImportPreview } from '@/lib/import/directory-path';

const LINKEDIN_EXPORT_DIR = join(process.cwd(), '..', 'data', 'linkedin', 'LinkedinExport');

function detectFileType(filename: string): string | null {
  return detectContactFileType(filename);
}

async function previewFile(directory: string, path: string, name: string, owner: boolean): Promise<MappingPreview> {
  try {
    const content = await readAllowedImportPreview(directory, path);
    return (owner ? previewOwnerProfileCsv(name, content) : previewContactCsv(name, content))!;
  } catch {
    return { file: name, target: owner ? 'Owner profile' : 'Contacts', rowsSampled: 0,
      fields: [], ignored: [], warning: 'Preview unavailable: file cannot be read.',
      warningDisposition: owner ? name.toLowerCase() === 'profile.csv' ? 'fatal' : 'skip' : undefined };
  }
}

export async function GET() {
  try {
    const directory = await allowedImportDirectory(LINKEDIN_EXPORT_DIR);
    if (!directory) return NextResponse.json({ found: false });
    let dirStat;
    try {
      dirStat = await stat(directory);
    } catch {
      return NextResponse.json({ found: false });
    }

    if (!dirStat.isDirectory()) {
      return NextResponse.json({ found: false });
    }

    const entries = await readdir(directory);
    const csvFiles = entries.filter((name) => name.toLowerCase().endsWith('.csv'));

    if (csvFiles.length === 0) {
      return NextResponse.json({ found: false });
    }

    const recognized: { name: string; type: string }[] = [];
    const deepFiles: { name: string; type: string }[] = [];
    const other: string[] = [];

    for (const name of csvFiles) {
      const type = detectFileType(name);
      const deepType = detectDeepFileType(name);
      if (type) {
        recognized.push({ name, type });
      } else if (deepType) {
        deepFiles.push({ name, type: deepType });
      } else {
        other.push(name);
      }
    }

    // Check for subdirectories (Articles, Jobs, etc.)
    const subdirs: string[] = [];
    for (const entry of entries) {
      try {
        const entryStat = await stat(join(directory, entry));
        if (entryStat.isDirectory()) subdirs.push(entry);
      } catch {
        // skip
      }
    }

    const ownerProfileFiles = csvFiles.filter((name) => detectDeepFileType(name) !== null);
    const hasOwnerProfileFiles = ownerProfileFiles.some(name => name.toLowerCase() === 'profile.csv');
    const contactPreviews = await Promise.all(recognized.map(file => previewFile(directory, join(directory, file.name), file.name, false)));
    const ownerPreviews = hasOwnerProfileFiles
      ? await Promise.all(ownerProfileFiles.map(name => previewFile(directory, join(directory, name), name, true)))
      : [];

    return NextResponse.json({
      found: true,
      directoryPath: 'data/linkedin/LinkedinExport',
      recognizedFiles: recognized,
      deepFiles,
      ownerProfileFiles,
      otherFiles: other,
      subdirectories: subdirs,
      totalCsvCount: csvFiles.length,
      hasOwnerProfileFiles,
      contactPreviews,
      ownerPreviews,
    });
  } catch {
    return NextResponse.json({ found: false });
  }
}
