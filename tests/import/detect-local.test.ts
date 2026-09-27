import { lstat, open, readdir, realpath, stat } from 'fs/promises';
import { GET } from '@/app/api/import/detect-local/route';
import { allowedImportDirectory, allowedImportFile } from '@/lib/import/directory-path';
import { POST as importDirectory } from '@/app/api/import/from-directory/route';
import { POST as importOwnerProfile } from '@/app/api/import/full-profile/route';
import { getPool } from '@/lib/db/client';

jest.mock('fs/promises');
jest.mock('@/lib/db/client', () => ({ getPool: jest.fn(), query: jest.fn() }));
jest.mock('next/server', () => ({
  NextResponse: { json: (body: object, init?: ResponseInit) => Response.json(body, init) },
}));

describe('local owner profile detection', () => {
  beforeEach(() => {
    jest.mocked(realpath).mockImplementation(async path => String(path));
    jest.mocked(stat).mockResolvedValue({ isDirectory: () => true } as never);
    jest.mocked(open).mockResolvedValue({ read: async () => ({ bytesRead: 0 }), close: async () => undefined } as never);
  });

  it('offers owner profile import for a partial export with Profile.csv', async () => {
    jest.mocked(readdir).mockResolvedValue(['Profile.csv'] as never);
    const data = await (await GET()).json();
    expect(data.hasOwnerProfileFiles).toBe(true);
    expect(data.ownerProfileFiles).toEqual(['Profile.csv']);
  });

  it('reports an unavailable preview after a pathname changes inode', async () => {
    jest.mocked(readdir).mockResolvedValue(['Profile.csv'] as never);
    jest.mocked(lstat).mockResolvedValue({ isFile: () => true, isSymbolicLink: () => false, dev: 1, ino: 10 } as never);
    const read = jest.fn();
    jest.mocked(open).mockResolvedValue({ stat: async () => ({ isFile: () => true, dev: 1, ino: 11 }), read,
      close: async () => undefined } as never);
    const data = await (await GET()).json();
    expect(data.ownerPreviews[0].warning).toContain('unavailable');
    expect(data.ownerPreviews[0].fields).toEqual([]);
    expect(read).not.toHaveBeenCalled();
  });

  it('does not offer owner profile import for 15 unrelated CSVs', async () => {
    jest.mocked(readdir).mockResolvedValue(Array.from({ length: 15 }, (_, i) => `unrelated-${i}.csv`) as never);
    const data = await (await GET()).json();
    expect(data.hasOwnerProfileFiles).toBe(false);
    expect(data.ownerProfileFiles).toEqual([]);
  });

  it('does not count Profile Summary.csv as a supported profile file', async () => {
    jest.mocked(readdir).mockResolvedValue(['Profile.csv', 'Profile Summary.csv'] as never);
    const data = await (await GET()).json();
    expect(data.ownerProfileFiles).toEqual(['Profile.csv']);
    expect(data.recognizedFiles).toEqual([{ name: 'Profile.csv', type: 'profile' }]);
    expect(data.otherFiles).toEqual(['Profile Summary.csv']);
  });

  it('does not offer owner profile import when only supplemental deep files exist', async () => {
    jest.mocked(readdir).mockResolvedValue(['Skills.csv', 'Registration.csv'] as never);
    const data = await (await GET()).json();
    expect(data.ownerProfileFiles).toEqual(['Skills.csv', 'Registration.csv']);
    expect(data.hasOwnerProfileFiles).toBe(false);
  });
});

describe('directory import path boundaries', () => {
  beforeEach(() => {
    jest.mocked(realpath).mockImplementation(async path => String(path));
  });

  it('rejects a directory symlink that resolves outside the allowed root', async () => {
    jest.mocked(realpath).mockImplementation(async path =>
      String(path) === '/data/export' ? '/private/secret-export' : String(path));
    await expect(allowedImportDirectory('/data/export')).resolves.toBeNull();
    const contactsRequest = new Request('http://localhost/api/import/from-directory', {
      method: 'POST', body: JSON.stringify({ directoryPath: '/data/export', selfContactId: '00000000-0000-0000-0000-000000000000' }),
    });
    const profileRequest = new Request('http://localhost/api/import/full-profile', {
      method: 'POST', body: JSON.stringify({ directoryPath: '/data/export' }),
    });
    expect((await importDirectory(contactsRequest as never)).status).toBe(403);
    expect((await importOwnerProfile(profileRequest as never)).status).toBe(403);
    expect(getPool).not.toHaveBeenCalled();
  });

  it('accepts a canonical in-root directory and rejects a file symlink escape', async () => {
    await expect(allowedImportDirectory('/data/export')).resolves.toBe('/data/export');
    jest.mocked(realpath).mockImplementation(async path =>
      String(path) === '/data/export/Connections.csv' ? '/private/secret.csv' : String(path));
    await expect(allowedImportFile('/data/export', '/data/export/Connections.csv')).resolves.toBe(false);
  });

  it('resolves the directory returned by detect-local inside this worktree', async () => {
    jest.mocked(readdir).mockResolvedValue(['Profile.csv'] as never);
    const detected = await (await GET()).json();
    const resolved = await allowedImportDirectory(detected.directoryPath);
    expect(resolved).toBe(require('path').resolve(process.cwd(), '..', detected.directoryPath));
    jest.mocked(readdir).mockResolvedValue([] as never);
    expect((await importOwnerProfile(new Request('http://localhost/api/import/full-profile', {
      method: 'POST', body: JSON.stringify({ directoryPath: detected.directoryPath }),
    }) as never)).status).toBe(400);
  });

  it('rejects prefix siblings and traversal', async () => {
    await expect(allowedImportDirectory('/data-malicious/export')).resolves.toBeNull();
    await expect(allowedImportDirectory('/data/../private/export')).resolves.toBeNull();
  });
});

describe('full profile route supplemental snapshots', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(realpath).mockImplementation(async path => String(path));
    jest.mocked(stat).mockResolvedValue({ isDirectory: () => true } as never);
    jest.mocked(lstat).mockResolvedValue({ isFile: () => true, isSymbolicLink: () => false, dev: 1, ino: 10 } as never);
    jest.mocked(readdir).mockResolvedValue(['Profile.csv', 'Registration.csv'] as never);
  });

  it('accepts Profile.csv plus ten supported owner CSVs', async () => {
    const names = ['Profile.csv', 'Email Addresses.csv', 'PhoneNumbers.csv', 'Registration.csv',
      'Ad_Targeting.csv', 'Skills.csv', 'Certifications.csv', 'Honors.csv', 'Organizations.csv',
      'Volunteering.csv', 'Projects.csv'];
    jest.mocked(readdir).mockResolvedValue(names as never);
    const client = { query: jest.fn(async (sql: string) =>
      sql.startsWith('INSERT INTO owner_profiles') ? { rows: [{ id: 'profile-1' }] } : { rows: [] }),
      release: jest.fn() };
    jest.mocked(getPool).mockReturnValue({ connect: async () => client } as never);
    jest.mocked(open).mockImplementation(async path => {
      const content = Buffer.from(String(path).endsWith('Profile.csv') ? 'First Name,Last Name\nAda,Lovelace' : 'Unsupported\nvalue');
      let offset = 0;
      return { stat: async () => ({ isFile: () => true, dev: 1, ino: 10, size: content.length }),
        read: async (buffer: Buffer) => {
          const bytesRead = content.copy(buffer, 0, offset);
          offset += bytesRead;
          return { bytesRead };
        }, close: async () => undefined } as never;
    });
    const response = await importOwnerProfile(new Request('http://localhost/api/import/full-profile', {
      method: 'POST', body: JSON.stringify({ directoryPath: '/data/export' }),
    }) as never);
    expect(response.status).toBe(200);
    expect((await response.json()).data.importedFiles).toContain('Profile.csv');
    expect(client.release).toHaveBeenCalled();
  });

  it('imports valid Profile.csv and reports an unreadable supplemental as skipped', async () => {
    const client = { query: jest.fn(async (sql: string) =>
      sql.startsWith('INSERT INTO owner_profiles') ? { rows: [{ id: 'profile-1' }] } : { rows: [] }),
      release: jest.fn() };
    jest.mocked(getPool).mockReturnValue({ connect: async () => client } as never);
    jest.mocked(open).mockImplementation(async path => {
      if (String(path).endsWith('Registration.csv')) throw new Error('permission denied');
      const content = Buffer.from('First Name,Last Name\nAda,Lovelace');
      let offset = 0;
      return { stat: async () => ({ isFile: () => true, dev: 1, ino: 10, size: content.length }),
        read: async (buffer: Buffer) => {
          const bytesRead = content.copy(buffer, 0, offset);
          offset += bytesRead;
          return { bytesRead };
        }, close: async () => undefined } as never;
    });
    const response = await importOwnerProfile(new Request('http://localhost/api/import/full-profile', {
      method: 'POST', body: JSON.stringify({ directoryPath: '/data/export' }),
    }) as never);
    expect(response.status).toBe(200);
    expect((await response.json()).data).toMatchObject({ importedFiles: ['Profile.csv'], skippedFiles: ['Registration.csv'] });
    expect(client.release).toHaveBeenCalled();
  });

  it('rejects an unreadable Profile.csv before acquiring a database connection', async () => {
    jest.mocked(open).mockRejectedValue(new Error('permission denied'));
    const response = await importOwnerProfile(new Request('http://localhost/api/import/full-profile', {
      method: 'POST', body: JSON.stringify({ directoryPath: '/data/export' }),
    }) as never);
    expect(response.status).toBe(403);
    expect(getPool).not.toHaveBeenCalled();
  });

  it('rejects an oversized owner directory before opening files or connecting to the database', async () => {
    jest.mocked(lstat).mockResolvedValue({ isFile: () => true, isSymbolicLink: () => false,
      dev: 1, ino: 10, size: 50 * 1024 * 1024 + 1 } as never);
    const response = await importOwnerProfile(new Request('http://localhost/api/import/full-profile', {
      method: 'POST', body: JSON.stringify({ directoryPath: '/data/export' }),
    }) as never);
    expect(response.status).toBe(413);
    expect(open).not.toHaveBeenCalled();
    expect(getPool).not.toHaveBeenCalled();
  });
});
