import { lstat, open, realpath } from 'fs/promises';
import { constants } from 'fs';
import { relative, resolve, sep } from 'path';
import { MAX_FILES, MAX_FILE_SIZE, MAX_TOTAL_SIZE, UploadLimitError } from './upload-boundary';

const ALLOWED_ROOTS = [resolve(process.cwd(), '..', 'data'), '/data', '/home/aepod/dev/ctox/data'];

function inside(root: string, target: string): boolean {
  const rel = relative(root, target);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !rel.startsWith(sep));
}

export async function allowedImportDirectory(input: string): Promise<string | null> {
  if (input.includes('..')) return null;
  const candidates = input.startsWith('data/')
    ? [resolve(process.cwd(), '..', input), resolve('/', input), resolve('/home/aepod/dev/ctox', input)]
    : [resolve(input)];
  for (const candidate of candidates) {
    if (!ALLOWED_ROOTS.some(root => inside(root, candidate))) continue;
    try {
      const actual = await realpath(candidate);
      for (const root of ALLOWED_ROOTS) {
        try {
          if (inside(await realpath(root), actual)) return actual;
        } catch { /* root unavailable in this environment */ }
      }
    } catch { /* missing directory; caller reports 404 */ }
  }
  return null;
}

export async function allowedImportFile(directory: string, file: string): Promise<boolean> {
  try {
    return inside(directory, await realpath(file));
  } catch {
    return false;
  }
}

export async function validateDirectoryBatch(directory: string, files: readonly string[]): Promise<void> {
  if (files.length > MAX_FILES) throw new UploadLimitError('Too many CSV files');
  let total = 0;
  for (const file of files) {
    if (!await allowedImportFile(directory, file)) throw new Error('CSV file path is not allowed');
    const info = await lstat(file);
    if (!info.isFile() || info.isSymbolicLink()) throw new Error('CSV file is not a regular file');
    if (info.size > MAX_FILE_SIZE) throw new UploadLimitError('CSV file exceeds 50 MB limit');
    total += info.size;
    if (total > MAX_TOTAL_SIZE) throw new UploadLimitError('CSV files exceed total size limit');
  }
}

// Open once, verify that the validated path still names this inode, and keep
// the bounded bytes in memory. Callers must never reopen the pathname for import.
export async function readAllowedImportFile(directory: string, file: string, remainingBytes = MAX_TOTAL_SIZE): Promise<Buffer> {
  if (!await allowedImportFile(directory, file)) throw new Error('CSV file path is not allowed');
  const before = await lstat(file);
  if (!before.isFile() || before.isSymbolicLink()) throw new Error('CSV file is not a regular file');
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const opened = await handle.stat();
    const current = await lstat(file);
    if (opened.size > Math.min(MAX_FILE_SIZE, remainingBytes)) throw new UploadLimitError('CSV files exceed size limit');
    if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino ||
        current.dev !== opened.dev || current.ino !== opened.ino ||
        !await allowedImportFile(directory, file)) {
      throw new Error('CSV file changed during validation');
    }
    const chunks: Buffer[] = [];
    let total = 0;
    const chunk = Buffer.allocUnsafe(64 * 1024);
    while (true) {
      const { bytesRead } = await handle.read(chunk, 0, chunk.length, null);
      if (bytesRead === 0) break;
      total += bytesRead;
      if (total > Math.min(MAX_FILE_SIZE, remainingBytes)) throw new UploadLimitError('CSV files exceed size limit');
      chunks.push(Buffer.from(chunk.subarray(0, bytesRead)));
    }
    return Buffer.concat(chunks, total);
  } finally {
    await handle.close();
  }
}

// A preview must read from the same validated inode, never from a pathname
// reopened after validation. O_NOFOLLOW rejects a swapped final symlink.
export async function readAllowedImportPreview(directory: string, file: string): Promise<string> {
  if (!await allowedImportFile(directory, file)) throw new Error('CSV file path is not allowed');
  const before = await lstat(file);
  if (!before.isFile() || before.isSymbolicLink()) throw new Error('CSV file is not a regular file');
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const opened = await handle.stat();
    const current = await lstat(file);
    if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino ||
        current.dev !== opened.dev || current.ino !== opened.ino ||
        !await allowedImportFile(directory, file)) {
      throw new Error('CSV file changed during validation');
    }
    const buffer = Buffer.alloc(65536);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    return buffer.subarray(0, bytesRead).toString('utf8');
  } finally {
    await handle.close();
  }
}
