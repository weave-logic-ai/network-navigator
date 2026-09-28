jest.mock('@/lib/db/client', () => ({ query: jest.fn() }));

const rows = <T,>(data: T[]) => Promise.resolve({ rows: data, rowCount: data.length });

describe('dashboard target comparison data', () => {
  beforeEach(() => jest.clearAllMocks());

  it('loads two CEOs from their own contact rows and highlights 20% deltas', async () => {
    const { query } = await import('@/lib/db/client');
    (query as jest.Mock).mockImplementation((_sql: string, params: string[]) => {
      if (params[0] === 'ceo-a') return rows([{ score: 60, degree: '14' }]);
      if (params[0] === 'ceo-b') return rows([{ score: 30, degree: '5' }]);
      return rows([]);
    });
    const { loadContactMetrics, relativeDelta, isSignificantDelta } = await import('@/components/dashboard/target-comparison-data');
    const [a, b] = await Promise.all([loadContactMetrics('ceo-a'), loadContactMetrics('ceo-b')]);
    expect(a).toEqual({ score: 60, degree: 14 });
    expect(b).toEqual({ score: 30, degree: 5 });
    expect(relativeDelta(b.score, a.score)).toBe(100);
    expect(relativeDelta(b.degree, a.degree)).toBe(180);
    expect(relativeDelta(10, 12)).toBe(20);
    expect(relativeDelta(10, 11.9)).toBeCloseTo(19);
    expect(isSignificantDelta(relativeDelta(10, 12))).toBe(true);
    expect(isSignificantDelta(relativeDelta(10, 11.9))).toBe(false);
    const calls = (query as jest.Mock).mock.calls;
    expect(calls.map((call) => call[1][0]).sort()).toEqual(['ceo-a', 'ceo-b']);
    expect(calls[0][0]).toContain('LEFT JOIN contact_scores cs ON cs.contact_id = c.id');
    expect(calls[0][0]).toContain('COUNT(DISTINCT CASE');
  });

  it('keeps missing score and missing contact unavailable', async () => {
    const { query } = await import('@/lib/db/client');
    (query as jest.Mock).mockImplementation((_sql: string, params: string[]) =>
      params[0] === 'unscored' ? rows([{ score: null, degree: '0' }]) : rows([])
    );
    const { loadContactMetrics, relativeDelta } = await import('@/components/dashboard/target-comparison-data');
    expect(await loadContactMetrics('unscored')).toEqual({ score: null, degree: 0 });
    expect(await loadContactMetrics('missing')).toMatchObject({ score: null, degree: null });
    expect(relativeDelta(40, null)).toBeNull();
    expect(relativeDelta(0, 20)).toBeNull();
  });

  it('uses a unique imported self contact and rejects an ambiguous one', async () => {
    const { query } = await import('@/lib/db/client');
    (query as jest.Mock).mockImplementation((sql: string, params?: string[]) => {
      if (sql.includes("linkedin_url LIKE 'self:%'")) return rows([{ id: 'self-contact' }]);
      if (params?.[0] === 'self-contact') return rows([{ score: 40, degree: '10' }]);
      return rows([]);
    });
    const { loadSelfContactMetrics } = await import('@/components/dashboard/target-comparison-data');
    expect(await loadSelfContactMetrics()).toEqual({ score: 40, degree: 10 });
    (query as jest.Mock).mockClear().mockResolvedValue(rows([{ id: 'one' }, { id: 'two' }]));
    expect(await loadSelfContactMetrics()).toMatchObject({ score: null, degree: null });
    expect((query as jest.Mock).mock.calls).toHaveLength(1);
  });
});
