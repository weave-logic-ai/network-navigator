// Tests for scoring/icp-gap-analysis — compares the (real, weighted)
// Natural ICP against a user-selected Desired ICP.
//
// Regression coverage for the audit fix (#18 item 3): this module was dead
// code with two bugs that would have crashed or silently no-op'd it in
// production had it been wired up unchanged:
//   1. `owner_profiles WHERE is_active = TRUE` — no such column exists on
//      owner_profiles (only on icp_profiles); the query threw and was
//      swallowed by a `.catch()`, so the desired-ICP config was never found.
//   2. `FROM niche_memberships` — that table does not exist in this schema
//      at all, and the query was NOT wrapped in a catch, so it would have
//      thrown an unhandled error on every request with a desired ICP set.
// Both are fixed to use the real schema (`is_current`, `niche_profiles.member_count`).

jest.mock('@/lib/db/client', () => ({
  query: jest.fn(),
  transaction: jest.fn(),
  healthCheck: jest.fn(),
  getPool: jest.fn(),
  shutdown: jest.fn(),
}));

jest.mock('@/lib/scoring/natural-icp', () => ({
  computeNaturalICP: jest.fn(),
}));

type Row = Record<string, unknown>;

function resultOf(rows: Row[]) {
  return Promise.resolve({
    rows,
    command: '',
    rowCount: rows.length,
    oid: 0,
    fields: [],
  });
}

const baseNaturalIcp = {
  roles: ['ceo/founder', 'vp'],
  industries: ['fintech', 'saas'],
  signals: ['leadership', 'growth'],
  companySizeRanges: ['11-50'],
  profileSignals: {
    headlineKeywords: [],
    aboutKeywords: [],
    skillSignals: [],
    positionIndustries: [],
  },
  networkSignals: { topRoles: [], topIndustries: [], topNiches: [] },
};

describe('scoring/icp-gap-analysis', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  it('falls back to "Set a Desired ICP" (with a working taskTemplate) when there is no natural ICP', async () => {
    const { query } = await import('@/lib/db/client');
    const { computeNaturalICP } = await import('@/lib/scoring/natural-icp');
    (query as jest.MockedFunction<typeof query>).mockImplementation(() =>
      resultOf([]) as unknown as ReturnType<typeof query>
    );
    (computeNaturalICP as jest.Mock).mockResolvedValue(null);

    const svc = await import('@/lib/scoring/icp-gap-analysis');
    const result = await svc.runGapAnalysis();

    expect(result.naturalIcp).toBeNull();
    expect(result.desiredIcp).toBeNull();
    expect(result.alignmentScore).toBe(0);
    expect(result.suggestions).toHaveLength(1);
    expect(result.suggestions[0].taskTemplate).toBeDefined();
    expect(result.suggestions[0].taskTemplate.title).toBeTruthy();
  });

  it('falls back to "Set a Desired ICP" when no desiredIcpConfig is saved yet', async () => {
    const { query } = await import('@/lib/db/client');
    const { computeNaturalICP } = await import('@/lib/scoring/natural-icp');
    (query as jest.MockedFunction<typeof query>).mockImplementation((sql: string) => {
      if (sql.includes('FROM owner_profiles')) {
        return resultOf([{ metadata: {} }]) as unknown as ReturnType<typeof query>;
      }
      return resultOf([]) as unknown as ReturnType<typeof query>;
    });
    (computeNaturalICP as jest.Mock).mockResolvedValue(baseNaturalIcp);

    const svc = await import('@/lib/scoring/icp-gap-analysis');
    const result = await svc.runGapAnalysis();

    expect(result.naturalIcp).toEqual(baseNaturalIcp);
    expect(result.desiredIcp).toBeNull();
    expect(result.suggestions[0].title).toBe('Set a Desired ICP');
  });

  it('reads the owner metadata query with is_current (not the nonexistent is_active column)', async () => {
    const { query } = await import('@/lib/db/client');
    const { computeNaturalICP } = await import('@/lib/scoring/natural-icp');
    const mockQuery = query as jest.MockedFunction<typeof query>;
    mockQuery.mockImplementation(() => resultOf([]) as unknown as ReturnType<typeof query>);
    (computeNaturalICP as jest.Mock).mockResolvedValue(baseNaturalIcp);

    const svc = await import('@/lib/scoring/icp-gap-analysis');
    await svc.runGapAnalysis();

    const ownerCall = mockQuery.mock.calls.find((c) =>
      (c[0] as string).includes('FROM owner_profiles')
    );
    expect(ownerCall).toBeDefined();
    expect(ownerCall![0] as string).toContain('is_current = TRUE');
    expect(ownerCall![0] as string).not.toContain('is_active');
  });

  it('does not crash and falls back gracefully when the owner metadata query throws', async () => {
    const { query } = await import('@/lib/db/client');
    const { computeNaturalICP } = await import('@/lib/scoring/natural-icp');
    (query as jest.MockedFunction<typeof query>).mockImplementation((sql: string) => {
      if (sql.includes('FROM owner_profiles')) {
        return Promise.reject(new Error('connection lost'));
      }
      return resultOf([]) as unknown as ReturnType<typeof query>;
    });
    (computeNaturalICP as jest.Mock).mockResolvedValue(baseNaturalIcp);

    const svc = await import('@/lib/scoring/icp-gap-analysis');
    const result = await svc.runGapAnalysis();

    expect(result.desiredIcp).toBeNull();
    expect(result.suggestions[0].title).toBe('Set a Desired ICP');
  });

  it('computes alignment as a 0-100 integer percentage (not a 0-1 fraction)', async () => {
    const { query } = await import('@/lib/db/client');
    const { computeNaturalICP } = await import('@/lib/scoring/natural-icp');
    (computeNaturalICP as jest.Mock).mockResolvedValue(baseNaturalIcp);
    (query as jest.MockedFunction<typeof query>).mockImplementation((sql: string) => {
      if (sql.includes('FROM owner_profiles')) {
        return resultOf([
          { metadata: { desiredIcpConfig: { nicheId: 'niche-1', icpId: 'icp-1' } } },
        ]) as unknown as ReturnType<typeof query>;
      }
      if (sql.includes('FROM icp_profiles WHERE id')) {
        return resultOf([
          {
            id: 'icp-1',
            name: 'Target ICP',
            niche_id: 'niche-1',
            // Exact match against baseNaturalIcp — every criterion present.
            criteria: {
              roles: ['ceo/founder'],
              industries: ['fintech'],
              signals: ['leadership'],
              nicheKeywords: [],
            },
          },
        ]) as unknown as ReturnType<typeof query>;
      }
      if (sql.includes('SELECT name FROM niche_profiles WHERE id')) {
        return resultOf([{ name: 'Fintech Founders' }]) as unknown as ReturnType<typeof query>;
      }
      if (sql.includes('member_count')) {
        return resultOf([{ count: 30 }]) as unknown as ReturnType<typeof query>;
      }
      return resultOf([]) as unknown as ReturnType<typeof query>;
    });

    const svc = await import('@/lib/scoring/icp-gap-analysis');
    const result = await svc.runGapAnalysis();

    // 3/3 desired criteria matched -> 100, not 1.
    expect(result.alignmentScore).toBe(100);
    expect(Number.isInteger(result.alignmentScore)).toBe(true);
  });

  it('uses niche_profiles.member_count, not the nonexistent niche_memberships table', async () => {
    const { query } = await import('@/lib/db/client');
    const { computeNaturalICP } = await import('@/lib/scoring/natural-icp');
    (computeNaturalICP as jest.Mock).mockResolvedValue(baseNaturalIcp);
    const mockQuery = query as jest.MockedFunction<typeof query>;
    mockQuery.mockImplementation((sql: string) => {
      if (sql.includes('FROM owner_profiles')) {
        return resultOf([
          { metadata: { desiredIcpConfig: { nicheId: 'niche-1', icpId: 'icp-1' } } },
        ]) as unknown as ReturnType<typeof query>;
      }
      if (sql.includes('FROM icp_profiles WHERE id')) {
        return resultOf([
          { id: 'icp-1', name: 'Target ICP', niche_id: 'niche-1', criteria: {} },
        ]) as unknown as ReturnType<typeof query>;
      }
      if (sql.includes('SELECT name FROM niche_profiles WHERE id')) {
        return resultOf([{ name: 'Fintech Founders' }]) as unknown as ReturnType<typeof query>;
      }
      return resultOf([{ count: 4 }]) as unknown as ReturnType<typeof query>;
    });

    const svc = await import('@/lib/scoring/icp-gap-analysis');
    const result = await svc.runGapAnalysis();

    const memberCountCall = mockQuery.mock.calls.find((c) =>
      (c[0] as string).includes('member_count')
    );
    expect(memberCountCall).toBeDefined();
    expect(memberCountCall![0] as string).toContain('niche_profiles');
    expect(memberCountCall![0] as string).not.toContain('niche_memberships');
    expect(result.strengths.nicheContactCount).toBe(4);
  });

  it('fuzzy/alias-matches desired criteria against the natural ICP lists (e-commerce vs ecommerce)', async () => {
    const { query } = await import('@/lib/db/client');
    const { computeNaturalICP } = await import('@/lib/scoring/natural-icp');
    (computeNaturalICP as jest.Mock).mockResolvedValue({
      ...baseNaturalIcp,
      industries: ['ecommerce'],
    });
    (query as jest.MockedFunction<typeof query>).mockImplementation((sql: string) => {
      if (sql.includes('FROM owner_profiles')) {
        return resultOf([
          { metadata: { desiredIcpConfig: { nicheId: null, icpId: 'icp-1' } } },
        ]) as unknown as ReturnType<typeof query>;
      }
      if (sql.includes('FROM icp_profiles WHERE id')) {
        return resultOf([
          {
            id: 'icp-1',
            name: 'Target ICP',
            niche_id: null,
            criteria: { industries: ['E-Commerce'], roles: [], signals: [], nicheKeywords: [] },
          },
        ]) as unknown as ReturnType<typeof query>;
      }
      return resultOf([]) as unknown as ReturnType<typeof query>;
    });

    const svc = await import('@/lib/scoring/icp-gap-analysis');
    const result = await svc.runGapAnalysis();

    expect(result.gaps.missingIndustries).toEqual([]);
    expect(result.strengths.sharedIndustries).toEqual(['E-Commerce']);
  });

  it('populates strengths.sharedRoles (the live route always hardcoded this to [])', async () => {
    const { query } = await import('@/lib/db/client');
    const { computeNaturalICP } = await import('@/lib/scoring/natural-icp');
    (computeNaturalICP as jest.Mock).mockResolvedValue(baseNaturalIcp);
    (query as jest.MockedFunction<typeof query>).mockImplementation((sql: string) => {
      if (sql.includes('FROM owner_profiles')) {
        return resultOf([
          { metadata: { desiredIcpConfig: { nicheId: null, icpId: 'icp-1' } } },
        ]) as unknown as ReturnType<typeof query>;
      }
      if (sql.includes('FROM icp_profiles WHERE id')) {
        return resultOf([
          {
            id: 'icp-1',
            name: 'Target ICP',
            niche_id: null,
            criteria: { roles: ['CEO/Founder'], industries: [], signals: [], nicheKeywords: [] },
          },
        ]) as unknown as ReturnType<typeof query>;
      }
      return resultOf([]) as unknown as ReturnType<typeof query>;
    });

    const svc = await import('@/lib/scoring/icp-gap-analysis');
    const result = await svc.runGapAnalysis();

    expect(result.strengths.sharedRoles).toEqual(['CEO/Founder']);
    expect(result.gaps.missingRoles).toEqual([]);
  });

  it('attaches a taskTemplate to every generated suggestion', async () => {
    const { query } = await import('@/lib/db/client');
    const { computeNaturalICP } = await import('@/lib/scoring/natural-icp');
    (computeNaturalICP as jest.Mock).mockResolvedValue(baseNaturalIcp);
    (query as jest.MockedFunction<typeof query>).mockImplementation((sql: string) => {
      if (sql.includes('FROM owner_profiles')) {
        return resultOf([
          { metadata: { desiredIcpConfig: { nicheId: 'niche-1', icpId: 'icp-1' } } },
        ]) as unknown as ReturnType<typeof query>;
      }
      if (sql.includes('FROM icp_profiles WHERE id')) {
        return resultOf([
          {
            id: 'icp-1',
            name: 'Target ICP',
            niche_id: 'niche-1',
            criteria: {
              roles: ['Sales Rep'],
              industries: ['Healthcare'],
              signals: ['Sales Automation'],
              nicheKeywords: [],
            },
          },
        ]) as unknown as ReturnType<typeof query>;
      }
      if (sql.includes('SELECT name FROM niche_profiles WHERE id')) {
        return resultOf([{ name: 'Healthcare Buyers' }]) as unknown as ReturnType<typeof query>;
      }
      if (sql.includes('member_count')) {
        return resultOf([{ count: 2 }]) as unknown as ReturnType<typeof query>;
      }
      return resultOf([]) as unknown as ReturnType<typeof query>;
    });

    const svc = await import('@/lib/scoring/icp-gap-analysis');
    const result = await svc.runGapAnalysis();

    expect(result.suggestions.length).toBeGreaterThan(0);
    for (const s of result.suggestions) {
      expect(s.taskTemplate).toBeDefined();
      expect(s.taskTemplate.title).toBeTruthy();
      expect(s.taskTemplate.taskType).toBeTruthy();
    }
  });
});
