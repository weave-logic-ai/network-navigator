import { randomUUID } from 'crypto';
import { open } from 'fs/promises';
import { basename, relative, resolve, sep } from 'path';
import { MIMEType } from 'node:util';

export const MAX_FILES = 10;
export const MAX_FILE_SIZE = 50 * 1024 * 1024;
export const MAX_TOTAL_SIZE = 100 * 1024 * 1024;
// Allow multipart framing and field headers, but cap it independently of Content-Length.
export const MAX_BODY_SIZE = MAX_TOTAL_SIZE + 1024 * 1024;

export class UploadLimitError extends Error {}
export class UploadValidationError extends Error {}

export function isMultipartFormData(contentType: string | null): boolean {
  if (!contentType) return false;
  try {
    const parts: string[] = [];
    let start = 0;
    let quoted = false;
    let escaped = false;
    for (let i = 0; i < contentType.length; i++) {
      const char = contentType[i];
      if (escaped) { escaped = false; continue; }
      if (quoted && char === '\\') { escaped = true; continue; }
      if (char === '"') quoted = !quoted;
      if (char === ';' && !quoted) { parts.push(contentType.slice(start, i).trim()); start = i + 1; }
    }
    if (quoted || escaped) return false;
    parts.push(contentType.slice(start).trim());
    if (parts.shift()?.toLowerCase() !== 'multipart/form-data') return false;
    const token = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
    const seen = new Set<string>();
    for (const part of parts) {
      const equal = part.indexOf('=');
      if (equal < 1) return false;
      const key = part.slice(0, equal).trim().toLowerCase();
      const value = part.slice(equal + 1).trim();
      if (!token.test(key) || seen.has(key)) return false;
      seen.add(key);
      if (!token.test(value) && !/^"(?:[^"\\\r\n]|\\[\t -~])*"$/.test(value)) return false;
    }
    const mime = new MIMEType(contentType);
    const boundary = mime.params.get('boundary');
    return mime.essence === 'multipart/form-data' && boundary !== null
      && /^[0-9A-Za-z'()+_,.\/:=? -]{1,70}$/.test(boundary)
      && !boundary.endsWith(' ');
  } catch {
    return false;
  }
}

export function boundedBody(body: ReadableStream<Uint8Array>, limit = MAX_BODY_SIZE, onLimit?: () => void): ReadableStream<Uint8Array> {
  const reader = body.getReader();
  let received = 0;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) return controller.close();
        received += value.byteLength;
        if (received > limit) {
          onLimit?.();
          await reader.cancel();
          controller.error(new UploadLimitError('Upload body exceeds limit'));
          return;
        }
        controller.enqueue(value);
      } catch (error) {
        controller.error(error);
      }
    },
    cancel(reason) { return reader.cancel(reason); },
  });
}

export function validateCsv(file: File): void {
  // Do not reflect the supplied name: it may itself contain a private path.
  if (!/\.csv$/i.test(file.name) || /[\\/\u0000-\u001f\u007f]/.test(file.name)) {
    throw new UploadValidationError('Only CSV filenames without path or control characters are accepted');
  }
  if (file.type && !['text/csv', 'application/csv', 'application/vnd.ms-excel'].includes(file.type.toLowerCase())) {
    throw new UploadValidationError('Only CSV content types are accepted');
  }
  if (file.size > MAX_FILE_SIZE) throw new UploadLimitError('CSV file exceeds 50 MB limit');
}

export function validateCsvBatch(entries: FormDataEntryValue[]): File[] {
  if (entries.length > MAX_FILES) throw new UploadLimitError('Too many CSV files');
  const files: File[] = [];
  let total = 0;
  for (const entry of entries) {
    if (!(entry instanceof File)) throw new UploadValidationError('Invalid file entry');
    validateCsv(entry);
    total += entry.size;
    if (total > MAX_TOTAL_SIZE) throw new UploadLimitError('CSV files exceed total size limit');
    files.push(entry);
  }
  return files;
}

export function storedCsvName(original: string): string {
  const safeStem = basename(original).replace(/\.csv$/i, '').replace(/[^a-zA-Z0-9_-]/g, '_');
  // The import pipeline identifies LinkedIn file kinds from the stored filename.
  // For long names, retain the kind even when its marker falls beyond the prefix.
  const stem = safeStem.length > 80
    ? `${importTypePrefix(original)}-${safeStem.slice(0, 65)}`
    : safeStem || 'upload';
  return `${stem}-${randomUUID()}.csv`;
}

function importTypePrefix(original: string): string {
  const lower = original.toLowerCase();
  for (const kind of ['connection', 'message', 'invitation', 'endorsement', 'recommendation', 'position', 'education', 'skill']) {
    if (lower.includes(kind)) return kind;
  }
  if (lower.includes('company') && lower.includes('follow')) return 'company_follow';
  if (lower.includes('profile')) return 'profile';
  return 'upload';
}

export function containedPath(directory: string, name: string): string {
  const root = resolve(directory);
  const target = resolve(root, name);
  const remainder = relative(root, target);
  if (!remainder || remainder === '..' || remainder.startsWith(`..${sep}`) || remainder.startsWith(sep)) {
    throw new UploadLimitError('Invalid upload destination');
  }
  return target;
}

export async function writeCsvFile(file: File, directory: string, name: string): Promise<void> {
  const handle = await open(containedPath(directory, name), 'wx', 0o600);
  let written = 0;
  const reader = file.stream().getReader();
  try {
    while (true) {
      const { done, value: chunk } = await reader.read();
      if (done) break;
      written += chunk.byteLength;
      if (written > MAX_FILE_SIZE) throw new UploadLimitError('CSV file exceeds 50 MB limit');
      let offset = 0;
      while (offset < chunk.byteLength) {
        const { bytesWritten } = await handle.write(chunk, offset, chunk.byteLength - offset);
        offset += bytesWritten;
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    await handle.close();
  }
}
