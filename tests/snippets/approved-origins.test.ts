// WS-3 Phase 6 §7 — approved-origins sync tests.
//
// Exercises the three entry points:
//   - removeApprovedOrigins drops revoked origins from storage
//   - addApprovedOrigins merges grants into storage
//   - syncApprovedOriginsFromChrome reconciles against chrome.permissions.getAll

/* eslint-disable @typescript-eslint/no-explicit-any */

interface StoredMap {
  [key: string]: unknown;
}

function installChromeShim(initialOrigins: string[] = []): {
  db: StoredMap;
  setPermissionsOrigins: (origins: string[]) => void;
} {
  const db: StoredMap = { approvedOrigins: [...initialOrigins] };
  let permOrigins: string[] = [...initialOrigins];
  (globalThis as any).chrome = {
    storage: {
      local: {
        get(key: string, cb: (items: StoredMap) => void): void {
          cb({ [key]: db[key] });
        },
        set(patch: StoredMap, cb?: () => void): void {
          for (const k of Object.keys(patch)) db[k] = patch[k];
          cb?.();
        },
      },
    },
    permissions: {
      getAll: async () => ({ origins: permOrigins, permissions: [] }),
    },
  };
  return {
    db,
    setPermissionsOrigins: (origins) => {
      permOrigins = [...origins];
    },
  };
}

describe('approved-origins sync', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  it('removeApprovedOrigins drops revoked origins from the stored list', async () => {
    const { db } = installChromeShim([
      'https://edgar.sec.gov/*',
      'https://web.archive.org/*',
    ]);
    const mod = await import('../../browser/src/shared/approved-origins');
    const next = await mod.removeApprovedOrigins(['https://edgar.sec.gov/*']);
    expect(next).toEqual(['https://web.archive.org/*']);
    expect(db.approvedOrigins).toEqual(['https://web.archive.org/*']);
  });

  it('removeApprovedOrigins removes the native wildcard grant but preserves a separate HTTPS grant', async () => {
    const { db } = installChromeShim(['*://edgar.sec.gov/*', 'https://edgar.sec.gov/*']);
    const mod = await import('../../browser/src/shared/approved-origins');
    const next = await mod.removeApprovedOrigins(['*://edgar.sec.gov/*']);
    expect(next).toEqual(['https://edgar.sec.gov/*']);
    expect(db.approvedOrigins).toEqual(['https://edgar.sec.gov/*']);
  });

  it('addApprovedOrigins merges without duplicates', async () => {
    const { db } = installChromeShim(['https://web.archive.org/*']);
    const mod = await import('../../browser/src/shared/approved-origins');
    const next = await mod.addApprovedOrigins([
      'https://web.archive.org/*',
      'https://edgar.sec.gov/*',
    ]);
    expect(next.sort()).toEqual([
      'https://edgar.sec.gov/*',
      'https://web.archive.org/*',
    ]);
    expect((db.approvedOrigins as string[]).length).toBe(2);
  });

  it('syncApprovedOriginsFromChrome overwrites with native permission state', async () => {
    const { db, setPermissionsOrigins } = installChromeShim([
      'https://stale.example.com/*',
    ]);
    setPermissionsOrigins([
      'https://edgar.sec.gov/*',
      'https://web.archive.org/*',
    ]);
    const mod = await import('../../browser/src/shared/approved-origins');
    const next = await mod.syncApprovedOriginsFromChrome();
    expect(next.sort()).toEqual([
      'https://edgar.sec.gov/*',
      'https://web.archive.org/*',
    ]);
    expect((db.approvedOrigins as string[]).sort()).toEqual([
      'https://edgar.sec.gov/*',
      'https://web.archive.org/*',
    ]);
  });
});
