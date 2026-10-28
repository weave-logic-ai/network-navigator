// Allow-list of directories the import routes may read from.
// Configure with LEGACY_IMPORT_DIRS (colon-separated absolute paths).

import { resolve } from 'path';

const DEFAULT_DIRS = '/data/';

export function getAllowedImportDirs(): string[] {
  const raw = process.env.LEGACY_IMPORT_DIRS || DEFAULT_DIRS;
  return raw
    .split(':')
    .map((d) => d.trim())
    .filter((d) => d.startsWith('/'))
    .map((d) => (d.endsWith('/') ? d : `${d}/`));
}

export function isImportPathAllowed(filePath: string): boolean {
  if (filePath.includes('..')) return false;
  const resolved = resolve(filePath);
  return getAllowedImportDirs().some(
    (prefix) => resolved.startsWith(prefix) || `${resolved}/` === prefix
  );
}

// Base directory for resolving relative paths (first allowed dir).
export function importBaseDir(): string {
  return getAllowedImportDirs()[0] ?? DEFAULT_DIRS;
}
