// Tests for the Snip mode session-state helper (ADR-028 clause 4).
//
// `snip-mode.ts` backs the side panel's opt-in toggle/hotkey: the snippet
// widget must stay off by default and only turn on for the current browser
// session (chrome.storage.session), never persisting across a restart the
// way the approvedOrigins permission mirror (chrome.storage.local) does.
// Fakes chrome.storage.session and exercises the real get/set logic, not a
// mock of it — same pattern as approved-origins.test.ts.
//
// Run: `node --test src/shared/snip-mode.test.ts` (from browser/).

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { getSnipModeActive, setSnipModeActive } from './snip-mode.ts';

interface FakeChrome {
  storage: {
    session: {
      get: (key: string) => Promise<Record<string, unknown>>;
      set: (obj: Record<string, unknown>) => Promise<void>;
    };
  };
  __store: Record<string, unknown>;
}

function makeFakeChrome(initial: Record<string, unknown> = {}): FakeChrome {
  const store: Record<string, unknown> = { ...initial };
  return {
    __store: store,
    storage: {
      session: {
        async get(key) {
          return { [key]: store[key] };
        },
        async set(obj) {
          Object.assign(store, obj);
        },
      },
    },
  };
}

let fake: FakeChrome;

beforeEach(() => {
  fake = makeFakeChrome();
  (globalThis as unknown as { chrome: unknown }).chrome = fake;
});

afterEach(() => {
  delete (globalThis as unknown as { chrome?: unknown }).chrome;
});

test('getSnipModeActive defaults to false when nothing is stored', async () => {
  const result = await getSnipModeActive();
  assert.equal(result, false);
});

test('getSnipModeActive returns the stored value once set', async () => {
  await setSnipModeActive(true);
  assert.equal(await getSnipModeActive(), true);
});

test('setSnipModeActive persists false after true (toggling back off)', async () => {
  await setSnipModeActive(true);
  await setSnipModeActive(false);
  assert.equal(await getSnipModeActive(), false);
  assert.equal(fake.__store.snipModeActive, false);
});

test('getSnipModeActive coerces a falsy stored value to false rather than throwing', async () => {
  fake.__store.snipModeActive = undefined;
  assert.equal(await getSnipModeActive(), false);
});

test('getSnipModeActive fails closed (off) if chrome.storage.session.get throws', async () => {
  fake.storage.session.get = async () => {
    throw new Error('storage.session unavailable');
  };
  const result = await getSnipModeActive();
  assert.equal(result, false);
});

test('setSnipModeActive propagates a storage failure to the caller', async () => {
  fake.storage.session.set = async () => {
    throw new Error('storage.session unavailable');
  };
  await assert.rejects(() => setSnipModeActive(true));
});
