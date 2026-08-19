// Tests for scoring/natural-icp — the Natural ICP auto-detection algorithm
// (60% owner profile / 40% network composition weighted merge).
//
// Regression coverage for the audit fix (#18 item 3): the owner's profile
// must be read from `owner_profiles` (the table every import/profile route
// actually populates), not `contacts WHERE degree = 0` (a row the import
// pipeline never creates), and the persisted row must be identified by
// `icp_profiles.source = 'natural'` rather than a fragile name-string match.

jest.mock('@/lib/db/client', () => ({
  query: jest.fn(),
  transaction: jest.fn(),
  healthCheck: jest.fn(),
  getPool: jest.fn(),
  shutdown: jest.fn(),
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

function makeQueryRouter(overrides: {
  owner?: Row[];
  titles?: Row[];
  industries?: Row[];
  sizes?: Row[];
  niches?: Row[];
  existingNaturalIcp?: Row[];
}): (sql: string, params?: unknown[]) => Promise<unknown> {
  return (sql: string) => {
    if (sql.includes('FROM owner_profiles')) {
      return resultOf(overrides.owner ?? []);
    }
    if (sql.includes('title_pattern')) {
      return resultOf(overrides.titles ?? []);
    }
    if (sql.includes('co.industry')) {
      return resultOf(overrides.industries ?? []);
    }
    if (sql.includes('co.size_range')) {
      return resultOf(overrides.sizes ?? []);
    }
    if (sql.includes('contact_icp_fits')) {
      return resultOf(overrides.niches ?? []);
    }
    if (sql.includes("WHERE source = 'natural'")) {
      return resultOf(overrides.existingNaturalIcp ?? []);
    }
    // UPDATE/INSERT into icp_profiles
    return resultOf([]);
  };
}

describe('scoring/natural-icp', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  it('returns null when there is no current owner profile', async () => {
    const { query } = await import('@/lib/db/client');
    const mockQuery = query as jest.MockedFunction<typeof query>;
    mockQuery.mockImplementation(makeQueryRouter({ owner: [] }) as unknown as typeof query);

    const svc = await import('@/lib/scoring/natural-icp');
    const result = await svc.computeNaturalICP();
    expect(result).toBeNull();
  });

  it('reads the owner from owner_profiles (is_current), not contacts.degree=0', async () => {
    const { query } = await import('@/lib/db/client');
    const mockQuery = query as jest.MockedFunction<typeof query>;
    mockQuery.mockImplementation(
      makeQueryRouter({
        owner: [
          {
            headline: 'Helping SaaS founders scale their fintech startups',
            summary: 'I love machine learning and data analytics',
            industry: 'Technology',
            skills: ['Leadership', 'Sales'],
          },
        ],
      }) as unknown as typeof query
    );

    const svc = await import('@/lib/scoring/natural-icp');
    await svc.computeNaturalICP();

    const ownerCall = mockQuery.mock.calls.find((c) =>
      (c[0] as string).includes('FROM owner_profiles')
    );
    expect(ownerCall).toBeDefined();
    expect(ownerCall![0] as string).toContain('is_current = TRUE');
    expect(ownerCall![0] as string).not.toContain('degree');

    // The old (dead) implementation queried `contacts WHERE degree = 0` —
    // make sure that query is gone entirely.
    const contactsDegreeZero = mockQuery.mock.calls.find((c) =>
      (c[0] as string).includes('degree = 0')
    );
    expect(contactsDegreeZero).toBeUndefined();
  });

  it('computes a weighted merge that prioritizes profile signals over network-only signals', async () => {
    const { query } = await import('@/lib/db/client');
    const mockQuery = query as jest.MockedFunction<typeof query>;
    mockQuery.mockImplementation(
      makeQueryRouter({
        owner: [
          {
            headline: 'Helping SaaS founders scale their fintech startups',
            summary: 'I love machine learning and data analytics',
            industry: 'Technology',
            skills: ['Leadership', 'Sales'],
          },
        ],
        titles: [
          { title_pattern: 'CEO/Founder', cnt: '5' },
          { title_pattern: 'Engineer', cnt: '3' },
        ],
        industries: [
          { industry: 'Fintech', cnt: '4' },
          { industry: 'Retail', cnt: '1' },
        ],
        sizes: [{ size_range: '11-50', cnt: '3' }],
        niches: [{ niche: 'Fintech Founders', cnt: '6' }],
      }) as unknown as typeof query
    );

    const svc = await import('@/lib/scoring/natural-icp');
    const result = await svc.computeNaturalICP();

    expect(result).not.toBeNull();
    expect(result!.roles.length).toBeGreaterThan(0);
    expect(result!.roles.length).toBeLessThanOrEqual(7);
    expect(result!.industries.length).toBeLessThanOrEqual(7);
    expect(result!.signals.length).toBeLessThanOrEqual(15);

    // "saas" comes from the headline's "Helping X" pattern (profile, 60%
    // weight, highest-ranked item) and should outrank "engineer", which is
    // a pure network-only signal (40% weight, second-ranked item).
    const saasIdx = result!.roles.indexOf('saas');
    const engineerIdx = result!.roles.indexOf('engineer');
    expect(saasIdx).toBeGreaterThanOrEqual(0);
    expect(engineerIdx).toBeGreaterThanOrEqual(0);
    expect(saasIdx).toBeLessThan(engineerIdx);

    // Real company-industry data (via the companies join) merges with
    // profile-derived industry keywords.
    expect(result!.industries.map((i) => i.toLowerCase())).toEqual(
      expect.arrayContaining(['fintech'])
    );

    // Company size ranges are a new signal the dead code never exposed to
    // the route before this consolidation.
    expect(result!.companySizeRanges).toEqual(['11-50']);

    // Network signals carry through real (not mislabeled) roles/industries,
    // plus the niche-fit distribution used for the UI's "Network" section.
    expect(result!.networkSignals.topRoles).toEqual([
      { role: 'CEO/Founder', count: 5 },
      { role: 'Engineer', count: 3 },
    ]);
    expect(result!.networkSignals.topIndustries).toEqual([
      { industry: 'Fintech', count: 4 },
      { industry: 'Retail', count: 1 },
    ]);
    expect(result!.networkSignals.topNiches).toEqual([
      { niche: 'Fintech Founders', count: 6 },
    ]);

    // profileSignals exposes about-derived keywords (the old live route
    // computed these but never merged or returned them).
    expect(result!.profileSignals.aboutKeywords.length).toBeGreaterThan(0);
  });

  it('inserts a new natural ICP row identified by source=natural when none exists', async () => {
    const { query } = await import('@/lib/db/client');
    const mockQuery = query as jest.MockedFunction<typeof query>;
    mockQuery.mockImplementation(
      makeQueryRouter({
        owner: [
          { headline: 'Helping founders', summary: null, industry: null, skills: [] },
        ],
        existingNaturalIcp: [],
      }) as unknown as typeof query
    );

    const svc = await import('@/lib/scoring/natural-icp');
    await svc.computeNaturalICP();

    const insertCall = mockQuery.mock.calls.find((c) =>
      (c[0] as string).includes('INSERT INTO icp_profiles')
    );
    expect(insertCall).toBeDefined();
    expect(insertCall![0] as string).toContain("'natural'");
    expect(insertCall![0] as string).not.toContain(
      "WHERE name = 'Natural ICP (auto-detected)'"
    );
  });

  it('updates the existing natural ICP row (matched by source, not name) when one exists', async () => {
    const { query } = await import('@/lib/db/client');
    const mockQuery = query as jest.MockedFunction<typeof query>;
    mockQuery.mockImplementation(
      makeQueryRouter({
        owner: [
          { headline: 'Helping founders', summary: null, industry: null, skills: [] },
        ],
        existingNaturalIcp: [{ id: 'existing-icp-id' }],
      }) as unknown as typeof query
    );

    const svc = await import('@/lib/scoring/natural-icp');
    await svc.computeNaturalICP();

    const updateCall = mockQuery.mock.calls.find((c) =>
      (c[0] as string).includes('UPDATE icp_profiles')
    );
    expect(updateCall).toBeDefined();
    expect((updateCall![1] as unknown[])[1]).toBe('existing-icp-id');

    const selectCall = mockQuery.mock.calls.find((c) =>
      (c[0] as string).includes("SELECT id FROM icp_profiles")
    );
    expect(selectCall![0] as string).toContain("source = 'natural'");
  });
});
