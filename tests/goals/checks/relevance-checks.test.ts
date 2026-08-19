// Content/Skills Relevance checks (Engine 5): skill-cluster-gap, offering-alignment.
// Both use contacts.tags as the skills proxy, matching the convention already
// established in app/src/lib/db/queries/scoring.ts and
// app/src/lib/scoring/scorers/skills-relevance.ts.

jest.mock('@/lib/db/client', () => ({
  query: jest.fn(),
}));

import { query } from '@/lib/db/client';
import { relevanceChecks } from '@/lib/goals/checks/relevance-checks';

const mockQuery = query as jest.MockedFunction<typeof query>;
const [skillClusterGap, offeringAlignment] = relevanceChecks;

function mockRows<T>(rows: T[]): ReturnType<typeof query> {
  return Promise.resolve({ rows, command: '', rowCount: rows.length, oid: 0, fields: [] }) as ReturnType<typeof query>;
}

beforeEach(() => {
  mockQuery.mockReset();
});

describe('skillClusterGap', () => {
  it('returns no candidate when no niche is selected', async () => {
    const result = await skillClusterGap({ page: 'discover' });

    expect(result).toEqual([]);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('returns no candidate when the niche does not exist', async () => {
    mockQuery.mockReturnValueOnce(mockRows([])); // niche lookup -> none

    const result = await skillClusterGap({ page: 'discover', selectedNicheId: 'n1' });

    expect(result).toEqual([]);
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it('returns no candidate when there is no disconnected skill cluster', async () => {
    mockQuery.mockReturnValueOnce(mockRows([{ name: 'Digital Health' }]));
    mockQuery.mockReturnValueOnce(mockRows([])); // cluster query -> none

    const result = await skillClusterGap({ page: 'discover', selectedNicheId: 'n1' });

    expect(result).toEqual([]);
  });

  it('produces a candidate for a disconnected skill cluster', async () => {
    mockQuery.mockReturnValueOnce(mockRows([{ name: 'Digital Health' }]));
    mockQuery.mockReturnValueOnce(mockRows([{ tag: 'FHIR', member_count: '4' }]));

    const result = await skillClusterGap({ page: 'discover', selectedNicheId: 'n1' });

    expect(result).toHaveLength(1);
    expect(result[0].goalType).toBe('skill-cluster-gap');
    expect(result[0].title).toBe('Skill gap in "Digital Health": "FHIR" cluster has 4 contacts, none connected');
    expect(result[0].metadata.engine).toBe('skills_relevance');
  });
});

describe('offeringAlignment', () => {
  it('returns no candidate when no ICP is selected', async () => {
    const result = await offeringAlignment({ page: 'discover' });

    expect(result).toEqual([]);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('returns no candidate when no contact aligns with an offering', async () => {
    mockQuery.mockReturnValueOnce(mockRows([]));

    const result = await offeringAlignment({ page: 'discover', selectedIcpId: 'icp1' });

    expect(result).toEqual([]);
  });

  it('produces a candidate for a strongly aligned contact', async () => {
    mockQuery.mockReturnValueOnce(mockRows([{
      id: 'c1', name: 'Alex Kim', offering_id: 'o1', offering_name: 'Fractional CTO', fit_score: 0.92,
    }]));

    const result = await offeringAlignment({ page: 'discover', selectedIcpId: 'icp1' });

    expect(result).toHaveLength(1);
    expect(result[0].goalType).toBe('offering-alignment');
    expect(result[0].title).toBe('Alex Kim is ideal for "Fractional CTO" — 92% fit');
    expect(result[0].metadata.engine).toBe('skills_relevance');
    expect(result[0].metadata.suggestedTasks[0].taskType).toBe('pitch_offering');
  });
});
