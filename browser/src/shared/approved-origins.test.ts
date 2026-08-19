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
  };
  __store: Record<string, unknown>;
  __setCalls: number;
}

function makeFakeChrome(initial: Record<string, unknown> = {}): FakeChrome {
  const store: Record<string, unknown> = { ...initial };
  const fake: FakeChrome = {
    __store: store,
    __setCalls: 0,
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
        return { origins: [] };
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

test('addApprovedOrigins canonicalizes *://host/* and http://host/* to https', async () => {
  // The return value preserves insertion order (it's the raw merged Set);
  // only the persisted storage value is sorted (see setApprovedOrigins).
  const result = await addApprovedOrigins([
    '*://foo.example.com/*',
    'http://bar.example.com/*',
  ]);
  assert.deepEqual(result, [
    'https://foo.example.com/*',
    'https://bar.example.com/*',
  ]);
  assert.deepEqual(fake.__store.approvedOrigins, [
    'https://bar.example.com/*',
    'https://foo.example.com/*',
  ]);
});

test('addApprovedOrigins drops patterns that do not canonicalize (e.g. <all_urls>)', async () => {
  // <all_urls> is what ships in optional_host_permissions per ADR-028 — a
  // runtime grant of it should not silently show up as an approved *host*,
  // since the sidebar list renders per-origin rows.
  const result = await addApprovedOrigins(['<all_urls>', 'https://ok.com/*']);
  assert.deepEqual(result, ['https://ok.com/*']);
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

test('removeApprovedOrigins removes the matching canonicalized origin', async () => {
  fake.__store.approvedOrigins = [
    'https://keep.com/*',
    'https://remove.com/*',
  ];
  const result = await removeApprovedOrigins(['*://remove.com/*']);
  assert.deepEqual(result, ['https://keep.com/*']);
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

test('syncApprovedOriginsFromChrome rewrites the mirror to match chrome.permissions.getAll()', async () => {
  // Note: the resolved/returned value preserves chrome.permissions.getAll()
  // order; the persisted storage value is deduped+sorted by
  // setApprovedOrigins. These two can legitimately differ in order — this
  // is real behavior, not an assumption.
  fake.__store.approvedOrigins = ['https://stale.com/*'];
  fake.permissions.getAll = async () => ({
    origins: ['https://www.linkedin.com/*', 'http://legacy.com/*'],
  });
  const result = await syncApprovedOriginsFromChrome();
  assert.deepEqual(result, [
    'https://www.linkedin.com/*',
    'https://legacy.com/*',
  ]);
  assert.deepEqual(fake.__store.approvedOrigins, [
    'https://legacy.com/*',
    'https://www.linkedin.com/*',
  ]);
});

test('syncApprovedOriginsFromChrome drops <all_urls> from the per-host mirror', async () => {
  // Reproduces the real Phase-1 shape: seed host_permissions plus a runtime
  // grant of the optional <all_urls> permission. Only real hosts should
  // surface in the sidebar's approved-origins list.
  fake.permissions.getAll = async () => ({
    origins: ['<all_urls>', 'https://www.linkedin.com/*'],
  });
  const result = await syncApprovedOriginsFromChrome();
  assert.deepEqual(result, ['https://www.linkedin.com/*']);
});

test('syncApprovedOriginsFromChrome falls back to the stored list if permissions.getAll throws', async () => {
  fake.__store.approvedOrigins = ['https://survives.com/*'];
  fake.permissions.getAll = async () => {
    throw new Error('permissions API unavailable');
  };
  const result = await syncApprovedOriginsFromChrome();
  assert.deepEqual(result, ['https://survives.com/*']);
  assert.equal(fake.__setCalls, 0, 'a failed sync must not clobber the existing mirror');
});

test('syncApprovedOriginsFromChrome handles an undefined origins array', async () => {
  fake.permissions.getAll = async () => ({});
  const result = await syncApprovedOriginsFromChrome();
  assert.deepEqual(result, []);
});
