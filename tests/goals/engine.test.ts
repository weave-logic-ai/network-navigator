// Goal engine tests: tick() selection/gating/dedup/suppression, contextHash,
// acceptGoal(), rejectGoal(). Mocks @/lib/db/client (never hits a real
// database) and mocks each checks/* module so tick()'s own orchestration
// logic can be exercised independently of any individual check's SQL.

jest.mock('@/lib/db/client', () => ({
  query: jest.fn(),
}));

jest.mock('@/lib/goals/checks/icp-checks', () => ({ icpChecks: [jest.fn(), jest.fn()] }));
jest.mock('@/lib/goals/checks/hub-checks', () => ({ hubChecks: [jest.fn(), jest.fn()] }));
jest.mock('@/lib/goals/checks/relationship-checks', () => ({ relationshipChecks: [jest.fn()] }));
jest.mock('@/lib/goals/checks/background-checks', () => ({ backgroundChecks: [jest.fn()] }));
jest.mock('@/lib/goals/checks/signal-checks', () => ({ signalChecks: [jest.fn()] }));
jest.mock('@/lib/goals/checks/relevance-checks', () => ({ relevanceChecks: [jest.fn()] }));

import { query } from '@/lib/db/client';
import { tick, acceptGoal, rejectGoal, contextHash } from '@/lib/goals/engine';
import { icpChecks } from '@/lib/goals/checks/icp-checks';
import { hubChecks } from '@/lib/goals/checks/hub-checks';
import { relationshipChecks } from '@/lib/goals/checks/relationship-checks';
import { backgroundChecks } from '@/lib/goals/checks/background-checks';
import { signalChecks } from '@/lib/goals/checks/signal-checks';
import { relevanceChecks } from '@/lib/goals/checks/relevance-checks';
import type { GoalCandidate, TickContext } from '@/lib/goals/types';

const mockQuery = query as jest.MockedFunction<typeof query>;

const mockIcp0 = icpChecks[0] as jest.Mock;
const mockIcp1 = icpChecks[1] as jest.Mock;
const mockHub0 = hubChecks[0] as jest.Mock;
const mockHub1 = hubChecks[1] as jest.Mock;
const mockRelationship0 = relationshipChecks[0] as jest.Mock;
const mockBackground0 = backgroundChecks[0] as jest.Mock;
const mockSignal0 = signalChecks[0] as jest.Mock;
const mockRelevance0 = relevanceChecks[0] as jest.Mock;

function mockRows<T>(rows: T[]): ReturnType<typeof query> {
  return Promise.resolve({ rows, command: '', rowCount: rows.length, oid: 0, fields: [] }) as ReturnType<typeof query>;
}

function candidate(overrides: Partial<GoalCandidate> = {}): GoalCandidate {
  return {
    title: 'Test goal',
    description: 'Test description',
    goalType: 'test-check',
    priority: 3,
    metadata: {
      engine: 'test_engine',
      checkType: 'test-check',
      contextHash: 'hash123',
      suggestedTasks: [],
    },
    ...overrides,
  };
}

// Queue the two "no error" embedding-health queries that `tick()` always
// issues after the goal-creation loop (unless hasImportedData was false).
function mockHealthyEmbeddings() {
  mockQuery.mockReturnValueOnce(mockRows([{ c: '100' }])); // profile_embeddings
  mockQuery.mockReturnValueOnce(mockRows([{ c: '100' }])); // contacts with degree > 0
}

beforeEach(() => {
  mockQuery.mockReset();
  for (const fn of [
    mockIcp0, mockIcp1, mockHub0, mockHub1, mockRelationship0,
    mockBackground0, mockSignal0, mockRelevance0,
  ]) {
    fn.mockReset();
    fn.mockResolvedValue([]);
  }
});

describe('contextHash', () => {
  it('is deterministic regardless of key order', () => {
    const a = contextHash('check-a', { nicheId: 'n1', contactId: 'c1' });
    const b = contextHash('check-a', { contactId: 'c1', nicheId: 'n1' });
    expect(a).toBe(b);
  });

  it('excludes undefined values from the hash input', () => {
    const a = contextHash('check-a', { nicheId: 'n1', contactId: undefined });
    const b = contextHash('check-a', { nicheId: 'n1' });
    expect(a).toBe(b);
  });

  it('differs when checkType differs', () => {
    const a = contextHash('check-a', { nicheId: 'n1' });
    const b = contextHash('check-b', { nicheId: 'n1' });
    expect(a).not.toBe(b);
  });

  it('differs when context values differ', () => {
    const a = contextHash('check-a', { nicheId: 'n1' });
    const b = contextHash('check-a', { nicheId: 'n2' });
    expect(a).not.toBe(b);
  });

  it('returns a 16-character hex string', () => {
    const h = contextHash('check-a', { nicheId: 'n1' });
    expect(h).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe('tick', () => {
  it('returns empty result and stops after the import gate when no data has been imported', async () => {
    mockQuery.mockReturnValueOnce(mockRows([{ c: '0' }])); // import_sessions completed count

    const result = await tick({ page: 'dashboard' });

    expect(result).toEqual({ newGoals: [], errors: [] });
    expect(mockQuery).toHaveBeenCalledTimes(1);
    expect(mockIcp0).not.toHaveBeenCalled();
    expect(mockBackground0).not.toHaveBeenCalled();
  });

  it('skips context checks (but still runs background checks) when there is no active ICP', async () => {
    mockQuery.mockReturnValueOnce(mockRows([{ c: '1' }])); // hasImportedData
    mockQuery.mockReturnValueOnce(mockRows([{ c: '0' }])); // hasActiveIcp = false
    mockHealthyEmbeddings();

    const result = await tick({ page: 'discover', selectedNicheId: 'n1' });

    expect(mockIcp0).not.toHaveBeenCalled();
    expect(mockIcp1).not.toHaveBeenCalled();
    expect(mockHub0).not.toHaveBeenCalled();
    expect(mockRelationship0).not.toHaveBeenCalled();
    // Background pool (background + signal + relevance checks) still runs.
    expect(
      mockBackground0.mock.calls.length +
      mockSignal0.mock.calls.length +
      mockRelevance0.mock.calls.length
    ).toBeGreaterThan(0);
    expect(result.newGoals).toEqual([]);
  });

  it('runs every matched context check on discover with a selected niche — no check is dropped by push order', async () => {
    mockQuery.mockReturnValueOnce(mockRows([{ c: '1' }])); // hasImportedData
    mockQuery.mockReturnValueOnce(mockRows([{ c: '1' }])); // hasActiveIcp
    mockHealthyEmbeddings();

    const ctx: TickContext = { page: 'discover', selectedNicheId: 'n1' };
    await tick(ctx);

    // Context checks for 'discover' with a niche selected are
    // [...icpChecks, ...hubChecks] = [icp0, icp1, hub0, hub1]. All of them
    // run — the cap now applies to the resulting *candidates*, ranked by
    // priority, not to this check-function list by push order.
    expect(mockIcp0).toHaveBeenCalledWith(ctx);
    expect(mockIcp1).toHaveBeenCalledWith(ctx);
    expect(mockHub0).toHaveBeenCalledWith(ctx);
    expect(mockHub1).toHaveBeenCalledWith(ctx);
    expect(mockRelationship0).not.toHaveBeenCalled();
  });

  it('caps context candidates by priority when checks produce more than MAX_CONTEXT_CANDIDATES, and logs what was dropped', async () => {
    mockQuery.mockReturnValueOnce(mockRows([{ c: '1' }])); // hasImportedData
    mockQuery.mockReturnValueOnce(mockRows([{ c: '1' }])); // hasActiveIcp

    // Four context checks fire (icp0, icp1, hub0, hub1) with distinct
    // priorities. icp0 is pushed FIRST but has the least-urgent priority (4)
    // — under the old push-order truncation, hub1 (pushed last) would have
    // been dropped regardless of relevance. Now the lowest-priority
    // candidate (icp0) should be the one dropped instead.
    mockIcp0.mockResolvedValueOnce([candidate({
      title: 'icp0', priority: 4,
      metadata: { engine: 'icp_fit', checkType: 'icp0-check', contextHash: 'h-icp0', suggestedTasks: [] },
    })]);
    mockIcp1.mockResolvedValueOnce([candidate({
      title: 'icp1', priority: 1,
      metadata: { engine: 'icp_fit', checkType: 'icp1-check', contextHash: 'h-icp1', suggestedTasks: [] },
    })]);
    mockHub0.mockResolvedValueOnce([candidate({
      title: 'hub0', priority: 3,
      metadata: { engine: 'network_hub', checkType: 'hub0-check', contextHash: 'h-hub0', suggestedTasks: [] },
    })]);
    mockHub1.mockResolvedValueOnce([candidate({
      title: 'hub1', priority: 2,
      metadata: { engine: 'network_hub', checkType: 'hub1-check', contextHash: 'h-hub1', suggestedTasks: [] },
    })]);

    // Every remaining query in this test (suppression checks for the 3 kept
    // candidates, plus the embedding-health queries) returns this shape —
    // treating all kept candidates as suppressed keeps the test focused on
    // the cap/log behavior without needing dedup/insert mocks per candidate.
    mockQuery.mockReturnValue(mockRows([{ rejection_count: '3' }]));

    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    const ctx: TickContext = { page: 'discover', selectedNicheId: 'n1' };
    const result = await tick(ctx);

    expect(mockIcp0).toHaveBeenCalledWith(ctx);
    expect(mockIcp1).toHaveBeenCalledWith(ctx);
    expect(mockHub0).toHaveBeenCalledWith(ctx);
    expect(mockHub1).toHaveBeenCalledWith(ctx);

    // All 4 candidates were suppressed, so nothing gets created — but the
    // cap/drop logging happens before suppression is even checked.
    expect(result.newGoals).toEqual([]);

    expect(warnSpy).toHaveBeenCalledTimes(1);
    const [warnMessage] = warnSpy.mock.calls[0];
    expect(warnMessage).toContain('kept 3/4');
    expect(warnMessage).toContain('dropped 1');
    expect(warnMessage).toContain('icp1-check (priority 1)');
    expect(warnMessage).toContain('hub1-check (priority 2)');
    expect(warnMessage).toContain('hub0-check (priority 3)');
    expect(warnMessage).toContain('icp0-check (priority 4)'); // the dropped one

    warnSpy.mockRestore();
  });

  it('runs only icpChecks on discover without a selected niche', async () => {
    mockQuery.mockReturnValueOnce(mockRows([{ c: '1' }]));
    mockQuery.mockReturnValueOnce(mockRows([{ c: '1' }]));
    mockHealthyEmbeddings();

    await tick({ page: 'discover' });

    expect(mockIcp0).toHaveBeenCalled();
    expect(mockHub0).not.toHaveBeenCalled();
  });

  it('runs relationshipChecks and hubChecks on contacts with a viewed contact', async () => {
    mockQuery.mockReturnValueOnce(mockRows([{ c: '1' }]));
    mockQuery.mockReturnValueOnce(mockRows([{ c: '1' }]));
    mockHealthyEmbeddings();

    const ctx: TickContext = { page: 'contacts', viewingContactId: 'c1' };
    await tick(ctx);

    expect(mockRelationship0).toHaveBeenCalledWith(ctx);
    expect(mockHub0).toHaveBeenCalledWith(ctx);
    expect(mockIcp0).not.toHaveBeenCalled();
  });

  it('runs both icpChecks and relationshipChecks on dashboard', async () => {
    mockQuery.mockReturnValueOnce(mockRows([{ c: '1' }]));
    mockQuery.mockReturnValueOnce(mockRows([{ c: '1' }]));
    mockHealthyEmbeddings();

    await tick({ page: 'dashboard' });

    expect(mockIcp0).toHaveBeenCalled();
    expect(mockRelationship0).toHaveBeenCalled();
    expect(mockHub0).not.toHaveBeenCalled();
  });

  it('runs only hubChecks on network', async () => {
    mockQuery.mockReturnValueOnce(mockRows([{ c: '1' }]));
    mockQuery.mockReturnValueOnce(mockRows([{ c: '1' }]));
    mockHealthyEmbeddings();

    await tick({ page: 'network' });

    expect(mockHub0).toHaveBeenCalled();
    expect(mockIcp0).not.toHaveBeenCalled();
    expect(mockRelationship0).not.toHaveBeenCalled();
  });

  it('falls back to a single icpCheck for unmapped pages', async () => {
    mockQuery.mockReturnValueOnce(mockRows([{ c: '1' }]));
    mockQuery.mockReturnValueOnce(mockRows([{ c: '1' }]));
    mockHealthyEmbeddings();

    await tick({ page: 'tasks' });

    expect(mockIcp0).toHaveBeenCalled();
    expect(mockIcp1).not.toHaveBeenCalled(); // icpChecks.slice(0, 1)
  });

  it('creates a goal for a candidate that is neither suppressed nor a duplicate', async () => {
    mockQuery.mockReturnValueOnce(mockRows([{ c: '1' }])); // hasImportedData
    mockQuery.mockReturnValueOnce(mockRows([{ c: '1' }])); // hasActiveIcp
    mockIcp0.mockResolvedValueOnce([candidate({ title: 'Grow niche X' })]);
    mockQuery.mockReturnValueOnce(mockRows([{ rejection_count: '0' }])); // isSuppressed
    mockQuery.mockReturnValueOnce(mockRows([])); // isDuplicate -> none found
    mockQuery.mockReturnValueOnce(mockRows([])); // INSERT INTO goals
    mockHealthyEmbeddings();

    const result = await tick({ page: 'discover' });

    expect(result.newGoals).toEqual([candidate({ title: 'Grow niche X' })]);
    const insertCall = mockQuery.mock.calls[4];
    expect(String(insertCall[0])).toMatch(/INSERT INTO goals/);
    expect(insertCall[1]).toEqual([
      'Grow niche X',
      'Test description',
      'test-check',
      3,
      null,
      null,
      0,
      JSON.stringify(candidate().metadata),
    ]);
  });

  it('suppresses a candidate rejected 3+ times in the last 30 days and never checks dedup for it', async () => {
    mockQuery.mockReturnValueOnce(mockRows([{ c: '1' }]));
    mockQuery.mockReturnValueOnce(mockRows([{ c: '1' }]));
    mockIcp0.mockResolvedValueOnce([candidate()]);
    mockQuery.mockReturnValueOnce(mockRows([{ rejection_count: '3' }])); // isSuppressed -> true
    mockHealthyEmbeddings();

    const result = await tick({ page: 'discover' });

    expect(result.newGoals).toEqual([]);
    // Only the suppression check ran for this candidate — no dedup query, no insert.
    const queryTexts = mockQuery.mock.calls.map((c) => String(c[0]));
    expect(queryTexts.filter((t) => /goals\s+WHERE goal_type/.test(t))).toHaveLength(0);
    expect(queryTexts.filter((t) => /INSERT INTO goals/.test(t))).toHaveLength(0);
  });

  it('does not create a duplicate goal for an already-active candidate', async () => {
    mockQuery.mockReturnValueOnce(mockRows([{ c: '1' }]));
    mockQuery.mockReturnValueOnce(mockRows([{ c: '1' }]));
    mockIcp0.mockResolvedValueOnce([candidate()]);
    mockQuery.mockReturnValueOnce(mockRows([{ rejection_count: '0' }])); // not suppressed
    mockQuery.mockReturnValueOnce(mockRows([{ id: 'existing-goal' }])); // isDuplicate -> found
    mockHealthyEmbeddings();

    const result = await tick({ page: 'discover' });

    expect(result.newGoals).toEqual([]);
    const insertCalls = mockQuery.mock.calls.filter((c) => /INSERT INTO goals/.test(String(c[0])));
    expect(insertCalls).toHaveLength(0);
  });

  it('caps new goals at 2 per tick even when more candidates qualify', async () => {
    mockQuery.mockReturnValueOnce(mockRows([{ c: '1' }]));
    mockQuery.mockReturnValueOnce(mockRows([{ c: '1' }]));
    mockIcp0.mockResolvedValueOnce([candidate({ title: 'A', metadata: { ...candidate().metadata, contextHash: 'ha' } })]);
    mockIcp1.mockResolvedValueOnce([candidate({ title: 'B', metadata: { ...candidate().metadata, contextHash: 'hb' } })]);
    mockHub0.mockResolvedValueOnce([candidate({ title: 'C', metadata: { ...candidate().metadata, contextHash: 'hc' } })]);
    // Three candidates, all pass suppression + dedup:
    mockQuery.mockReturnValueOnce(mockRows([{ rejection_count: '0' }])); // A suppressed?
    mockQuery.mockReturnValueOnce(mockRows([])); // A duplicate?
    mockQuery.mockReturnValueOnce(mockRows([])); // INSERT A
    mockQuery.mockReturnValueOnce(mockRows([{ rejection_count: '0' }])); // B suppressed?
    mockQuery.mockReturnValueOnce(mockRows([])); // B duplicate?
    mockQuery.mockReturnValueOnce(mockRows([])); // INSERT B
    mockHealthyEmbeddings();

    const result = await tick({ page: 'discover', selectedNicheId: 'n1' });

    expect(result.newGoals.map((g) => g.title)).toEqual(['A', 'B']);
    const insertCalls = mockQuery.mock.calls.filter((c) => /INSERT INTO goals/.test(String(c[0])));
    expect(insertCalls).toHaveLength(2);
  });

  it('silently skips a check that throws and still processes the others', async () => {
    mockQuery.mockReturnValueOnce(mockRows([{ c: '1' }]));
    mockQuery.mockReturnValueOnce(mockRows([{ c: '1' }]));
    mockIcp0.mockRejectedValueOnce(new Error('boom'));
    mockIcp1.mockResolvedValueOnce([candidate({ title: 'Survivor' })]);
    mockQuery.mockReturnValueOnce(mockRows([{ rejection_count: '0' }]));
    mockQuery.mockReturnValueOnce(mockRows([]));
    mockQuery.mockReturnValueOnce(mockRows([]));
    mockHealthyEmbeddings();

    const result = await tick({ page: 'discover' });

    expect(result.newGoals.map((g) => g.title)).toEqual(['Survivor']);
    expect(result.errors).toEqual([]);
  });

  it('surfaces an embeddings-incomplete error when embedding coverage is under 50%', async () => {
    mockQuery.mockReturnValueOnce(mockRows([{ c: '1' }]));
    mockQuery.mockReturnValueOnce(mockRows([{ c: '1' }]));
    mockQuery.mockReturnValueOnce(mockRows([{ c: '10' }])); // profile_embeddings
    mockQuery.mockReturnValueOnce(mockRows([{ c: '100' }])); // contacts with degree > 0

    const result = await tick({ page: 'discover' });

    expect(result.errors).toEqual([
      'Embeddings incomplete: 10/100 contacts. Go to Admin > Data Management > Reindex.',
    ]);
  });

  it('does not surface an embeddings error when there are no addressable contacts', async () => {
    mockQuery.mockReturnValueOnce(mockRows([{ c: '1' }]));
    mockQuery.mockReturnValueOnce(mockRows([{ c: '1' }]));
    mockQuery.mockReturnValueOnce(mockRows([{ c: '0' }])); // profile_embeddings
    mockQuery.mockReturnValueOnce(mockRows([{ c: '0' }])); // contacts with degree > 0

    const result = await tick({ page: 'discover' });

    expect(result.errors).toEqual([]);
  });
});

describe('acceptGoal', () => {
  it('does nothing when the goal is not found (or not in "suggested" status)', async () => {
    mockQuery.mockReturnValueOnce(mockRows([])); // UPDATE ... RETURNING -> no rows

    await acceptGoal('missing-id');

    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it('records acceptance feedback and creates each suggested task', async () => {
    const metadata = {
      checkType: 'niche-coverage-gap',
      contextHash: 'hash1',
      suggestedTasks: [
        { title: 'Task 1', description: 'D1', taskType: 'expand_network', priority: 2, url: 'https://x', contactId: 'c1' },
        { title: 'Task 2', description: 'D2', taskType: 'manual', priority: 3 },
      ],
    };
    mockQuery.mockReturnValueOnce(
      mockRows([{ metadata: JSON.stringify(metadata), goal_type: 'niche-coverage-gap' }])
    );
    mockQuery.mockReturnValueOnce(mockRows([])); // feedback insert
    mockQuery.mockReturnValueOnce(mockRows([])); // task 1 insert
    mockQuery.mockReturnValueOnce(mockRows([])); // task 2 insert

    await acceptGoal('goal-1');

    expect(mockQuery).toHaveBeenCalledTimes(4);

    const feedbackCall = mockQuery.mock.calls[1];
    expect(String(feedbackCall[0])).toMatch(/INSERT INTO goal_check_feedback/);
    expect(String(feedbackCall[0])).toMatch(/TRUE/);
    expect(feedbackCall[1]).toEqual(['niche-coverage-gap', 'niche-coverage-gap', 'hash1']);

    const task1Call = mockQuery.mock.calls[2];
    expect(String(task1Call[0])).toMatch(/INSERT INTO tasks/);
    expect(task1Call[1]).toEqual(['goal-1', 'Task 1', 'D1', 'expand_network', 2, 'https://x', 'c1']);

    const task2Call = mockQuery.mock.calls[3];
    expect(task2Call[1]).toEqual(['goal-1', 'Task 2', 'D2', 'manual', 3, null, null]);
  });

  it('creates no tasks when the goal has no suggestedTasks', async () => {
    const metadata = { checkType: 'x', contextHash: 'h', suggestedTasks: [] };
    mockQuery.mockReturnValueOnce(mockRows([{ metadata: JSON.stringify(metadata), goal_type: 'x' }]));
    mockQuery.mockReturnValueOnce(mockRows([])); // feedback insert

    await acceptGoal('goal-2');

    expect(mockQuery).toHaveBeenCalledTimes(2);
  });
});

describe('rejectGoal', () => {
  it('does nothing when the goal is not found (or not in "suggested" status)', async () => {
    mockQuery.mockReturnValueOnce(mockRows([]));

    await rejectGoal('missing-id');

    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it('records rejection feedback with accepted=FALSE', async () => {
    const metadata = { checkType: 'hub-dormant', contextHash: 'hash2', suggestedTasks: [] };
    mockQuery.mockReturnValueOnce(mockRows([{ metadata: JSON.stringify(metadata), goal_type: 'hub-dormant' }]));
    mockQuery.mockReturnValueOnce(mockRows([])); // feedback insert

    await rejectGoal('goal-3');

    const feedbackCall = mockQuery.mock.calls[1];
    expect(String(feedbackCall[0])).toMatch(/INSERT INTO goal_check_feedback/);
    expect(String(feedbackCall[0])).toMatch(/FALSE/);
    expect(feedbackCall[1]).toEqual(['hub-dormant', 'hub-dormant', 'hash2']);
  });
});
