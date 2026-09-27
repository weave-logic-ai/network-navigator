// Tests for the approved-origins permission mirror (ADR-028).
//
// `approved-origins.ts` keeps `chrome.storage.local.approvedOrigins` in sync
// with Chrome's native per-origin permission grants — the mechanism the
// sidebar's "Add this site to approved sources" button (ADR-028 §3) and the
// content-script gating check both depend on. These tests fake the `chrome`
// global (storage.local + permissions) and exercise the real
// canonicalization/merge/reconciliation logic, not a mock of it.
//
// Run: `node --test src/shared/approved-origins.test.ts` (from browser/).

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  addApprovedOrigins,
  removeApprovedOrigins,
  syncApprovedOriginsFromChrome,
  revokeOrigin,
} from './approved-origins.ts';

interface FakeChrome {
  storage: {
    local: {
      get: (key: string, cb: (v: Record<string, unknown>) => void) => void;
      set: (obj: Record<string, unknown>) => Promise<void>;
    };
  };
  permissions: {
    getAll: () => Promise<{ origins?: string[] }>;
    remove: (perms: { origins?: string[] }) => Promise<boolean>;
    contains: (perms: { origins?: string[] }) => Promise<boolean>;
  };
  __store: Record<string, unknown>;
  __nativeOrigins: string[];
  __setCalls: number;
  __removeCalls: Array<{ origins?: string[] }>;
}

function makeFakeChrome(initial: Record<string, unknown> = {}): FakeChrome {
  const store: Record<string, unknown> = { ...initial };
  const fake: FakeChrome = {
    __store: store,
    __nativeOrigins: [],
    __setCalls: 0,
    __removeCalls: [],
    storage: {
      local: {
        get(key, cb) {
          cb({ [key]: store[key] });
        },
        async set(obj) {
          fake.__setCalls += 1;
          Object.assign(store, obj);
        },
      },
    },
    permissions: {
      async getAll() {
        return { origins: [...fake.__nativeOrigins] };
      },
      async remove(perms) {
        fake.__removeCalls.push(perms);
        const before = fake.__nativeOrigins.length;
        fake.__nativeOrigins = fake.__nativeOrigins.filter((origin) => !perms.origins?.includes(origin));
        return fake.__nativeOrigins.length < before;
      },
      async contains(perms) {
        return (perms.origins ?? []).some((origin) =>
          fake.__nativeOrigins.includes(origin) || fake.__nativeOrigins.includes('<all_urls>')
        );
      },
    },
  };
  return fake;
}

let fake: FakeChrome;

beforeEach(() => {
  fake = makeFakeChrome();
  (globalThis as unknown as { chrome: unknown }).chrome = fake;
});

afterEach(() => {
  delete (globalThis as unknown as { chrome?: unknown }).chrome;
});

test('addApprovedOrigins canonicalizes https://host/* unchanged', async () => {
  const result = await addApprovedOrigins(['https://example.com/*']);
  assert.deepEqual(result, ['https://example.com/*']);
  assert.deepEqual(fake.__store.approvedOrigins, ['https://example.com/*']);
});

test('addApprovedOrigins preserves the native wildcard and HTTP grant patterns', async () => {
  const result = await addApprovedOrigins([
    '*://foo.example.com/*',
    'http://bar.example.com/*',
  ]);
  assert.deepEqual(result, [
    '*://foo.example.com/*',
    'http://bar.example.com/*',
  ]);
  assert.deepEqual(fake.__store.approvedOrigins, [
    '*://foo.example.com/*',
    'http://bar.example.com/*',
  ]);
});

test('addApprovedOrigins keeps a broad <all_urls> grant visible', async () => {
  const result = await addApprovedOrigins(['<all_urls>', 'https://ok.com/*']);
  assert.deepEqual(result, ['<all_urls>', 'https://ok.com/*']);
});

test('addApprovedOrigins merges with existing entries and dedupes', async () => {
  fake.__store.approvedOrigins = ['https://existing.com/*'];
  const result = await addApprovedOrigins([
    'https://existing.com/*',
    'https://new.com/*',
  ]);
  assert.deepEqual(result, ['https://existing.com/*', 'https://new.com/*']);
});

test('addApprovedOrigins is a no-op (no storage write) when nothing new added', async () => {
  fake.__store.approvedOrigins = ['https://existing.com/*'];
  const result = await addApprovedOrigins(['https://existing.com/*']);
  assert.deepEqual(result, ['https://existing.com/*']);
  assert.equal(fake.__setCalls, 0, 'should not churn storage.onChanged when nothing changed');
});

test('addApprovedOrigins with an empty list returns current list untouched', async () => {
  fake.__store.approvedOrigins = ['https://existing.com/*'];
  const result = await addApprovedOrigins([]);
  assert.deepEqual(result, ['https://existing.com/*']);
  assert.equal(fake.__setCalls, 0);
});

test('addApprovedOrigins with only unparseable patterns returns current list untouched', async () => {
  fake.__store.approvedOrigins = ['https://existing.com/*'];
  const result = await addApprovedOrigins(['not-a-url', 'ftp://bad.com/*']);
  assert.deepEqual(result, ['https://existing.com/*']);
  assert.equal(fake.__setCalls, 0);
});

test('removeApprovedOrigins removes only the exact native pattern', async () => {
  fake.__store.approvedOrigins = [
    'https://keep.com/*',
    '*://remove.com/*',
    'https://remove.com/*',
  ];
  const result = await removeApprovedOrigins(['*://remove.com/*']);
  assert.deepEqual(result, ['https://keep.com/*', 'https://remove.com/*']);
});

test('removeApprovedOrigins with an empty list returns current list untouched', async () => {
  fake.__store.approvedOrigins = ['https://keep.com/*'];
  const result = await removeApprovedOrigins([]);
  assert.deepEqual(result, ['https://keep.com/*']);
  assert.equal(fake.__setCalls, 0);
});

test('removeApprovedOrigins is a no-op when the origin is not present', async () => {
  fake.__store.approvedOrigins = ['https://keep.com/*'];
  const result = await removeApprovedOrigins(['https://not-there.com/*']);
  assert.deepEqual(result, ['https://keep.com/*']);
  assert.equal(fake.__setCalls, 0, 'should not churn storage.onChanged when nothing changed');
});

test('syncApprovedOriginsFromChrome rewrites the mirror to exact native patterns', async () => {
  fake.__store.approvedOrigins = ['https://stale.com/*'];
  fake.permissions.getAll = async () => ({
    origins: ['https://www.linkedin.com/*', 'http://legacy.com/*'],
  });
  const result = await syncApprovedOriginsFromChrome();
  assert.deepEqual(result, [
    'http://legacy.com/*',
    'https://www.linkedin.com/*',
  ]);
  assert.deepEqual(fake.__store.approvedOrigins, [
    'http://legacy.com/*',
    'https://www.linkedin.com/*',
  ]);
});

test('syncApprovedOriginsFromChrome shows a broad grant alongside fixed hosts', async () => {
  fake.permissions.getAll = async () => ({
    origins: ['<all_urls>', 'https://www.linkedin.com/*'],
  });
  const result = await syncApprovedOriginsFromChrome();
  assert.deepEqual(result, ['<all_urls>', 'https://www.linkedin.com/*']);
});

test('syncApprovedOriginsFromChrome fails without changing the mirror if getAll throws', async () => {
  fake.__store.approvedOrigins = ['https://survives.com/*'];
  fake.permissions.getAll = async () => {
    throw new Error('permissions API unavailable');
  };
  await assert.rejects(syncApprovedOriginsFromChrome(), /permissions API unavailable/);
  assert.deepEqual(fake.__store.approvedOrigins, ['https://survives.com/*']);
  assert.equal(fake.__setCalls, 0, 'a failed sync must not clobber the existing mirror');
});

test('syncApprovedOriginsFromChrome handles an undefined origins array', async () => {
  fake.permissions.getAll = async () => ({});
  const result = await syncApprovedOriginsFromChrome();
  assert.deepEqual(result, []);
});

// ADR-028 clause 6 — revoke UI (sidebar "Revoke" button routes through this
// single entry point rather than calling chrome.permissions.remove and
// writing chrome.storage.local.approvedOrigins separately).

test('revokeOrigin calls chrome.permissions.remove with the given origin', async () => {
  fake.__store.approvedOrigins = ['https://revoke-me.com/*'];
  fake.__nativeOrigins = ['https://revoke-me.com/*'];
  await revokeOrigin('https://revoke-me.com/*');
  assert.equal(fake.__removeCalls.length, 1);
  assert.deepEqual(fake.__removeCalls[0], { origins: ['https://revoke-me.com/*'] });
});

test('revokeOrigin drops the origin from the mirror after a successful native remove', async () => {
  fake.__store.approvedOrigins = ['https://keep.com/*', 'https://revoke-me.com/*'];
  fake.__nativeOrigins = ['https://keep.com/*', 'https://revoke-me.com/*'];
  const result = await revokeOrigin('https://revoke-me.com/*');
  assert.deepEqual(result, { origins: ['https://keep.com/*'], revoked: true });
  assert.deepEqual(fake.__store.approvedOrigins, ['https://keep.com/*', 'https://revoke-me.com/*'],
    'the panel must not race the service worker as a second mirror writer');
  await syncApprovedOriginsFromChrome();
  assert.deepEqual(fake.__store.approvedOrigins, ['https://keep.com/*']);
});

test('revokeOrigin targets an exact wildcard grant, leaving a separate HTTPS grant', async () => {
  fake.__store.approvedOrigins = ['*://legacy.com/*', 'https://legacy.com/*'];
  fake.__nativeOrigins = ['*://legacy.com/*', 'https://legacy.com/*'];
  const result = await revokeOrigin('*://legacy.com/*');
  assert.deepEqual(fake.__removeCalls[0], { origins: ['*://legacy.com/*'] });
  assert.deepEqual(result, { origins: ['https://legacy.com/*'], revoked: true });
});

test('revokeOrigin leaves the mirror untouched when chrome.permissions.remove throws', async () => {
  fake.__store.approvedOrigins = ['https://survives.com/*'];
  fake.__nativeOrigins = ['https://survives.com/*'];
  fake.permissions.remove = async () => {
    throw new Error('permissions API unavailable');
  };
  const result = await revokeOrigin('https://survives.com/*');
  assert.deepEqual(result, { origins: ['https://survives.com/*'], revoked: false });
  assert.equal(fake.__setCalls, 0, 'a failed native revoke must not touch the mirror');
});

test('revokeOrigin does not claim success when native state cannot be reconciled', async () => {
  fake.__store.approvedOrigins = ['https://example.com/*'];
  fake.__nativeOrigins = ['https://example.com/*'];
  fake.permissions.getAll = async () => {
    throw new Error('permissions API unavailable');
  };
  const result = await revokeOrigin('https://example.com/*');
  assert.deepEqual(result, { origins: ['https://example.com/*'], revoked: false });
});

test('revokeOrigin reports native state without racing the mirror writer', async () => {
  fake.__store.approvedOrigins = ['https://keep.com/*'];
  fake.__nativeOrigins = [];
  const result = await revokeOrigin('https://not-there.com/*');
  assert.deepEqual(result, { origins: [], revoked: false });
  assert.equal(fake.__removeCalls.length, 1);
  assert.deepEqual(fake.__store.approvedOrigins, ['https://keep.com/*']);
  await syncApprovedOriginsFromChrome();
  assert.deepEqual(fake.__store.approvedOrigins, []);
});

test('revokeOrigin retains a fixed permission when native removal returns false', async () => {
  fake.__store.approvedOrigins = ['https://www.linkedin.com/*'];
  fake.__nativeOrigins = ['https://www.linkedin.com/*'];
  fake.permissions.remove = async () => false;
  const result = await revokeOrigin('https://www.linkedin.com/*');
  assert.deepEqual(result, { origins: ['https://www.linkedin.com/*'], revoked: false });
  assert.deepEqual(fake.__store.approvedOrigins, ['https://www.linkedin.com/*']);
});

test('revokeOrigin does not claim the site is inaccessible while a broad grant remains', async () => {
  fake.__store.approvedOrigins = ['<all_urls>', 'http://example.com/*'];
  fake.__nativeOrigins = ['<all_urls>', 'http://example.com/*'];
  const result = await revokeOrigin('http://example.com/*');
  assert.deepEqual(result, { origins: ['<all_urls>'], revoked: false });
});

test('revokeOrigin removes an optional <all_urls> grant by its native pattern', async () => {
  fake.__store.approvedOrigins = ['<all_urls>'];
  fake.__nativeOrigins = ['<all_urls>'];
  const result = await revokeOrigin('<all_urls>');
  assert.deepEqual(fake.__removeCalls[0], { origins: ['<all_urls>'] });
  assert.deepEqual(result, { origins: [], revoked: true });
});

test('serialized reconciliation cannot let an older grant snapshot overwrite a later revoke', async () => {
  let releaseFirst: (() => void) | undefined;
  const firstRead = new Promise<void>((resolve) => { releaseFirst = resolve; });
  let reads = 0;
  fake.permissions.getAll = async () => {
    reads += 1;
    if (reads === 1) {
      await firstRead;
      return { origins: ['https://old.example/*'] };
    }
    return { origins: ['https://new.example/*'] };
  };
  const older = syncApprovedOriginsFromChrome();
  const newer = syncApprovedOriginsFromChrome();
  await Promise.resolve();
  assert.equal(reads, 1, 'the second native read must wait for the first write');
  releaseFirst?.();
  await Promise.all([older, newer]);
  assert.deepEqual(fake.__store.approvedOrigins, ['https://new.example/*']);
});
