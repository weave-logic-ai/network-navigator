// GET /api/import/detect-local - check for LinkedIn export files in the known directory

import { NextResponse } from 'next/server';
import { readdir, stat } from 'fs/promises';
import { join } from 'path';

const LINKEDIN_EXPORT_DIR = join(process.cwd(), '..', 'data', 'linkedin', 'LinkedinExport');

// Pipeline-recognized file types (contacts import)
const FILE_TYPE_PATTERNS: [string, string][] = [
  ['connection', 'connections'],
  ['message', 'messages'],
  ['invitation', 'invitations'],
  ['endorsement', 'endorsements'],
  ['recommendation', 'recommendations'],
  ['position', 'positions'],
  ['education', 'education'],
  ['skill', 'skills'],
  ['profile', 'profile'],
];

// Deep profile file types (full LinkedIn dump)
const DEEP_FILE_TYPES: Record<string, string> = {
  'ad_targeting.csv': 'ad_targeting',
  'certifications.csv': 'certifications',
  'company follows.csv': 'company_follows',
  'courses.csv': 'courses',
  'email addresses.csv': 'email_addresses',
  'events.csv': 'events',
  'honors.csv': 'honors',
  'learning.csv': 'learning',
  'organizations.csv': 'organizations',
  'phonenumbers.csv': 'phone_numbers',
  'profile summary.csv': 'profile_summary',
  'receipts_v2.csv': 'receipts',
  'registration.csv': 'registration',
  'rich_media.csv': 'rich_media',
  'savedjob alerts.csv': 'saved_job_alerts',
  'savedjobalerts.csv': 'saved_job_alerts',
  'volunteering.csv': 'volunteering',
  'projects.csv': 'projects',
};

function detectFileType(filename: string): string | null {
  const lower = filename.toLowerCase();
  if (lower.includes('company') && lower.includes('follow')) return 'company_follows';
  for (const [pattern, type] of FILE_TYPE_PATTERNS) {
    if (lower.includes(pattern)) return type;
  }
  return null;
}

function detectDeepFileType(filename: string): string | null {
  const lower = filename.toLowerCase();
  return DEEP_FILE_TYPES[lower] || null;
}

export async function GET() {
  try {
    let dirStat;
    try {
      dirStat = await stat(LINKEDIN_EXPORT_DIR);
    } catch {
      return NextResponse.json({ found: false });
    }

    if (!dirStat.isDirectory()) {
      return NextResponse.json({ found: false });
    }

    const entries = await readdir(LINKEDIN_EXPORT_DIR);
    const csvFiles = entries.filter((name) => name.toLowerCase().endsWith('.csv'));

    if (csvFiles.length === 0) {
      return NextResponse.json({ found: false });
    }

    const recognized: { name: string; type: string }[] = [];
    const deepFiles: { name: string; type: string }[] = [];
    const other: string[] = [];

    for (const name of csvFiles) {
      const type = detectFileType(name);
      if (type) {
        recognized.push({ name, type });
      } else {
        const deepType = detectDeepFileType(name);
        if (deepType) {
          deepFiles.push({ name, type: deepType });
        } else {
          other.push(name);
        }
      }
    }

    // Check for subdirectories (Articles, Jobs, etc.)
    const subdirs: string[] = [];
    for (const entry of entries) {
      try {
        const entryStat = await stat(join(LINKEDIN_EXPORT_DIR, entry));
        if (entryStat.isDirectory()) subdirs.push(entry);
      } catch {
        // skip
      }
    }

    // Full dump = has Profile.csv + Ad_Targeting.csv + messages + connections
    const hasFullDump = csvFiles.length >= 15;

    return NextResponse.json({
      found: true,
      directoryPath: 'data/linkedin/LinkedinExport',
      recognizedFiles: recognized,
      deepFiles,
      otherFiles: other,
      subdirectories: subdirs,
      totalCsvCount: csvFiles.length,
      hasFullDump,
    });
  } catch {
    return NextResponse.json({ found: false });
  }
}
