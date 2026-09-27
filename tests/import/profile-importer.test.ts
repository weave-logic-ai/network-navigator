import { readFile, readdir, stat } from 'fs/promises';
import { importFullProfile, parseProfileWebsites } from '@/lib/import/profile-importer';
import { ProfileWebsiteLink, safeProfileWebsite } from '@/components/profile/profile-view';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { PoolClient } from 'pg';
import { isOwnerSender } from '@/lib/import/messages-importer';

jest.mock('fs/promises');

const historicalProfile = [
  'First Name,Last Name,Birth Date,Websites',
  'Ada,Lovelace,1815-12-10,"Portfolio [https://example.org/work]; https://example.org/about; trusted.example:443 [https://evil.example/]; javascript:alert(1); Unsafe [ftp://example.org/file]"',
].join('\n');

describe('historical owner profile import', () => {
  it('only classifies the exact owner name as a sender', () => {
    expect(isOwnerSender(' Ada   Lovelace ', 'Ada Lovelace')).toBe(true);
    expect(isOwnerSender('Not Ada Lovelace', 'Ada Lovelace')).toBe(false);
  });
  beforeEach(() => {
    jest.mocked(readdir).mockResolvedValue(['Profile.csv', 'Registration.csv'] as never);
    jest.mocked(stat).mockResolvedValue({ isFile: () => true } as never);
    jest.mocked(readFile).mockImplementation(async (path) =>
      String(path).endsWith('Registration.csv')
        ? 'Registered At\n2020-01-02T03:04:05Z'
        : historicalProfile
    );
  });

  it('retains dates and validated labeled websites across versioned re-import', async () => {
    let version = 0;
    const query = jest.fn(async (sql: string, values?: unknown[]) => {
      if (sql.startsWith('SELECT MAX')) return { rows: [{ max_version: version }] };
      if (sql.startsWith('INSERT INTO owner_profiles')) {
        version = values?.[0] as number;
        expect(values?.[9]).toBe('1815-12-10');
        expect(values?.[13]).toEqual([
          'Portfolio [https://example.org/work]',
          'https://example.org/about',
          'evil.example [https://evil.example/]',
        ]);
        expect(values?.[14]).toEqual(new Date('2020-01-02T03:04:05Z'));
        return { rows: [{ id: `profile-${version}` }] };
      }
      return { rows: [] };
    });
    const client = { query } as unknown as PoolClient;

    expect((await importFullProfile(client, '/export')).version).toBe(1);
    expect((await importFullProfile(client, '/export')).version).toBe(2);
    expect(query).toHaveBeenCalledWith('UPDATE owner_profiles SET is_current = FALSE WHERE is_current = TRUE');
  });

  it('never turns malformed or non-http legacy entries into links', () => {
    expect(parseProfileWebsites('Work [https://example.org/]; javascript:alert(1); ftp://example.org')).toEqual([
      'Work [https://example.org/]',
    ]);
    expect(safeProfileWebsite('Work [https://example.org/]')).toEqual({
      href: 'https://example.org/', label: 'Work', host: 'example.org',
    });
    expect(safeProfileWebsite('Work [javascript:alert(1)]')).toBeNull();
    expect(safeProfileWebsite('https://example.org@evil.example')).toBeNull();
    expect(safeProfileWebsite('https://example.org [bad]')).toBeNull();
    expect(safeProfileWebsite(['https://example.org'])).toBeNull();
    expect(safeProfileWebsite({ href: 'https://example.org' })).toBeNull();
    expect(safeProfileWebsite('trusted.example [https://evil.example/]')).toEqual({
      href: 'https://evil.example/', label: 'evil.example', host: 'evil.example',
    });
    expect(safeProfileWebsite('https://trusted.example\\@evil.example/')).toBeNull();
    expect(parseProfileWebsites('trusted.example [https://evil.example/]; Safe [https://safe.example/]'))
      .toEqual(['evil.example [https://evil.example/]', 'Safe [https://safe.example/]']);
    expect(parseProfileWebsites('trusted.example:443 [https://evil.example/]'))
      .toEqual(['evil.example [https://evil.example/]']);
    expect(safeProfileWebsite('trusted.example:443 [https://evil.example/]')).toEqual({
      href: 'https://evil.example/', label: 'evil.example', host: 'evil.example',
    });
    expect(safeProfileWebsite('https://trusted.example/path [https://evil.example/]')?.label)
      .toBe('evil.example');
    const html = renderToStaticMarkup(createElement(ProfileWebsiteLink, {
      entry: 'trusted.example:443 [https://evil.example/]',
    }));
    expect(html).toContain('href="https://evil.example/"');
    expect(html).toContain('evil.example');
    expect(html).not.toContain('trusted.example');
  });

  it('keeps absent fields and dates from the current profile while applying explicit changes', async () => {
    let current: Record<string, unknown> | undefined;
    let version = 0;
    const query = jest.fn(async (sql: string, values?: unknown[]) => {
      if (sql.startsWith('SELECT * FROM owner_profiles')) return { rows: current ? [current] : [] };
      if (sql.startsWith('SELECT MAX')) return { rows: [{ max_version: version }] };
      if (sql.startsWith('INSERT INTO owner_profiles')) {
        version = values?.[0] as number;
        current = {
          first_name: values?.[1], last_name: values?.[2], headline: values?.[3],
          birth_date: values?.[9], websites: values?.[13], registered_at: values?.[14],
          skills: values?.[16],
        };
        return { rows: [{ id: `profile-${version}` }] };
      }
      return { rows: [] };
    });
    const client = { query } as unknown as PoolClient;
    await importFullProfile(client, '/export');
    jest.mocked(readdir).mockResolvedValue(['Profile.csv'] as never);
    jest.mocked(readFile).mockResolvedValue('First Name,Headline\nAda,New headline');

    const result = await importFullProfile(client, '/export');
    expect(result.version).toBe(2);
    expect(result.importedFiles).toEqual(['Profile.csv']);
    expect(current).toMatchObject({
      first_name: 'Ada', headline: 'New headline', birth_date: '1815-12-10',
      registered_at: new Date('2020-01-02T03:04:05Z'),
      websites: ['Portfolio [https://example.org/work]', 'https://example.org/about', 'evil.example [https://evil.example/]'],
    });
  });

  it('reports Profile Summary.csv as skipped and counts only processed files', async () => {
    jest.mocked(readdir).mockResolvedValue(['Profile.csv', 'Profile Summary.csv'] as never);
    const client = { query: jest.fn(async (sql: string) =>
      sql.startsWith('INSERT INTO owner_profiles') ? { rows: [{ id: 'profile-1' }] } : { rows: [] }
    ) } as unknown as PoolClient;
    const result = await importFullProfile(client, '/export');
    expect(result.importedFiles).toEqual(['Profile.csv']);
    expect(result.skippedFiles).toEqual(['Profile Summary.csv']);
  });

  it('does not claim a Skills.csv Skill column was imported as owner skills', async () => {
    jest.mocked(readdir).mockResolvedValue(['Profile.csv', 'Skills.csv'] as never);
    jest.mocked(readFile).mockImplementation(async path => String(path).endsWith('Skills.csv')
      ? 'Skill\nPainting' : historicalProfile);
    const query = jest.fn(async (sql: string, values?: unknown[]) => {
      if (sql.startsWith('INSERT INTO owner_profiles')) {
        expect(values?.[16]).toEqual([]);
        return { rows: [{ id: 'profile-1' }] };
      }
      return { rows: [] };
    });
    const result = await importFullProfile({ query } as unknown as PoolClient, '/export');
    expect(result.importedFiles).toEqual(['Profile.csv']);
    expect(result.skippedFiles).toEqual(['Skills.csv']);
  });

  it('does not write a version when Profile.csv is absent', async () => {
    jest.mocked(readdir).mockResolvedValue(['Skills.csv'] as never);
    const query = jest.fn().mockResolvedValue({ rows: [] });
    await expect(importFullProfile({ query } as unknown as PoolClient, '/export'))
      .rejects.toThrow('Profile.csv is required');
    expect(query).not.toHaveBeenCalledWith(expect.stringContaining('INSERT INTO owner_profiles'), expect.anything());
  });

  it('skips an unreadable supplemental file and publishes the valid Profile.csv', async () => {
    jest.mocked(readFile).mockImplementation(async path => {
      if (String(path).endsWith('Registration.csv')) throw new Error('permission denied');
      return historicalProfile;
    });
    const query = jest.fn(async (sql: string) => sql.startsWith('INSERT INTO owner_profiles')
      ? { rows: [{ id: 'profile-1' }] } : { rows: [] });
    const result = await importFullProfile({ query } as unknown as PoolClient, '/export');
    expect(result.importedFiles).toEqual(['Profile.csv']);
    expect(result.skippedFiles).toEqual(['Registration.csv']);
    expect(query.mock.calls.some(([sql]) => String(sql).startsWith('INSERT INTO owner_profiles'))).toBe(true);
  });

  it('rejects empty Profile.csv instead of publishing a blank profile', async () => {
    jest.mocked(readdir).mockResolvedValue(['Profile.csv'] as never);
    jest.mocked(readFile).mockResolvedValue('First Name,Last Name\n,');
    const query = jest.fn().mockResolvedValue({ rows: [] });
    await expect(importFullProfile({ query } as unknown as PoolClient, '/export'))
      .rejects.toThrow('must contain a readable row');
    expect(query.mock.calls.some(([sql]) => String(sql).startsWith('INSERT INTO owner_profiles'))).toBe(false);
  });

  it('does not treat a previous version as proof that the new Profile.csv is complete', async () => {
    jest.mocked(readdir).mockResolvedValue(['Profile.csv'] as never);
    jest.mocked(readFile).mockResolvedValue('First Name,Headline\n,Changed');
    const query = jest.fn(async (sql: string) => ({ rows: sql.startsWith('SELECT *') ? [{ first_name: 'Existing' }] : [] }));
    await expect(importFullProfile({ query } as unknown as PoolClient, '/export'))
      .rejects.toThrow('must contain a readable row');
    expect(query.mock.calls.some(([sql]) => String(sql).startsWith('UPDATE owner_profiles'))).toBe(false);
  });

  it('imports captured Profile.csv bytes after the path changes', async () => {
    const query = jest.fn(async (sql: string) => sql.startsWith('INSERT INTO owner_profiles')
      ? { rows: [{ id: 'profile-1' }] } : { rows: [] });
    const captured = new Map([['Profile.csv', Buffer.from('First Name,Last Name\nAda,Lovelace')]]);
    jest.mocked(readFile).mockRejectedValue(new Error('path swapped'));
    jest.mocked(readFile).mockClear();
    const result = await importFullProfile({ query } as unknown as PoolClient, '/export', captured);
    expect(result.selfName).toBe('Ada Lovelace');
    expect(readFile).not.toHaveBeenCalled();
  });

  it('counts messages using Profile.csv identity even when Messages.csv is listed first', async () => {
    const query = jest.fn(async (sql: string, values?: unknown[]) => {
      if (sql.startsWith('INSERT INTO owner_profiles')) {
        expect(values?.[37]).toBe(1);
        expect(values?.[38]).toBe(1);
        return { rows: [{ id: 'profile-1' }] };
      }
      return { rows: [] };
    });
    const snapshots = new Map([
      ['Messages.csv', Buffer.from('Conversation ID,From,To,Content\n1,Ada Lovelace,Bob,Hello\n1,Not Ada Lovelace,Ada Lovelace,Reply')],
      ['Profile.csv', Buffer.from('First Name,Last Name\nAda,Lovelace')],
    ]);
    const result = await importFullProfile({ query } as unknown as PoolClient, '/export', snapshots);
    expect(result.importedFiles).toEqual(['Profile.csv', 'Messages.csv']);
  });

  it('skips ambiguous message counts for a first-name-only Profile.csv', async () => {
    const query = jest.fn(async (sql: string, values?: unknown[]) => {
      if (sql.startsWith('INSERT INTO owner_profiles')) {
        expect(values?.[37]).toBeNull();
        expect(values?.[38]).toBeNull();
        expect(values?.[39]).toBeNull();
        return { rows: [{ id: 'profile-1' }] };
      }
      return { rows: sql.startsWith('SELECT *') ? [{ first_name: 'Ada', last_name: 'Lovelace' }] : [] };
    });
    const snapshots = new Map([
      ['Profile.csv', Buffer.from('First Name\nAda')],
      ['Messages.csv', Buffer.from('Conversation ID,From,To,Content\n1,Ada Lovelace,Bob,Hello')],
    ]);
    const result = await importFullProfile({ query } as unknown as PoolClient, '/export', snapshots);
    expect(result.skippedFiles).toContain('Messages.csv');
    expect(result.diagnostics).toEqual([expect.stringContaining('both owner first and last name')]);
  });
});
