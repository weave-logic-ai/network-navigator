import { lstat, open, realpath } from 'fs/promises';
import { readAllowedImportFile, validateDirectoryBatch } from '@/lib/import/directory-path';
import { MAX_FILE_SIZE, MAX_FILES, MAX_TOTAL_SIZE, UploadLimitError } from '@/lib/import/upload-boundary';

jest.mock('fs/promises');

describe('validated directory file snapshots', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(realpath).mockImplementation(async path => String(path) as never);
  });

  it('rejects a pathname swapped to another inode after validation', async () => {
    const close = jest.fn().mockResolvedValue(undefined);
    const readFile = jest.fn().mockResolvedValue(Buffer.from('outside content'));
    jest.mocked(lstat).mockResolvedValue({ isFile: () => true, isSymbolicLink: () => false, dev: 1, ino: 10 } as never);
    jest.mocked(open).mockResolvedValue({ stat: async () => ({ isFile: () => true, dev: 1, ino: 11 }), readFile, close } as never);
    await expect(readAllowedImportFile('/data/export', '/data/export/Profile.csv'))
      .rejects.toThrow('CSV file changed during validation');
    expect(readFile).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalled();
  });

  it('rejects too many files before opening any CSV', async () => {
    await expect(validateDirectoryBatch('/data/export', Array.from({ length: MAX_FILES + 1 }, (_, i) => `/data/export/${i}.csv`)))
      .rejects.toBeInstanceOf(UploadLimitError);
    expect(open).not.toHaveBeenCalled();
  });

  it('accepts all eleven supported owner files under the aggregate byte limit', async () => {
    jest.mocked(lstat).mockResolvedValue({ isFile: () => true, isSymbolicLink: () => false, size: 1 } as never);
    const names = ['Profile.csv', 'Email Addresses.csv', 'PhoneNumbers.csv', 'Registration.csv',
      'Ad_Targeting.csv', 'Skills.csv', 'Certifications.csv', 'Honors.csv', 'Organizations.csv',
      'Volunteering.csv', 'Projects.csv'];
    await expect(validateDirectoryBatch('/data/export', names.map(name => `/data/export/${name}`)))
      .resolves.toBeUndefined();
  });

  it('rejects oversized individual and aggregate batches before buffering', async () => {
    jest.mocked(lstat).mockResolvedValue({ isFile: () => true, isSymbolicLink: () => false, size: MAX_FILE_SIZE + 1 } as never);
    await expect(validateDirectoryBatch('/data/export', ['/data/export/a.csv'])).rejects.toBeInstanceOf(UploadLimitError);
    jest.mocked(lstat).mockResolvedValue({ isFile: () => true, isSymbolicLink: () => false, size: MAX_TOTAL_SIZE / 3 + 1 } as never);
    await expect(validateDirectoryBatch('/data/export', ['/data/export/a.csv', '/data/export/b.csv', '/data/export/c.csv'])).rejects.toBeInstanceOf(UploadLimitError);
  });

  it('stops reading when a file grows beyond the remaining batch budget', async () => {
    const close = jest.fn().mockResolvedValue(undefined);
    const read = jest.fn().mockResolvedValueOnce({ bytesRead: 4 }).mockResolvedValueOnce({ bytesRead: 4 });
    jest.mocked(lstat).mockResolvedValue({ isFile: () => true, isSymbolicLink: () => false, dev: 1, ino: 10, size: 4 } as never);
    jest.mocked(open).mockResolvedValue({ stat: async () => ({ isFile: () => true, dev: 1, ino: 10, size: 4 }), read, close } as never);
    await expect(readAllowedImportFile('/data/export', '/data/export/a.csv', 5)).rejects.toBeInstanceOf(UploadLimitError);
    expect(close).toHaveBeenCalled();
  });
});
