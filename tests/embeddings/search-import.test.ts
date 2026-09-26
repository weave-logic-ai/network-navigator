jest.mock('@/lib/db/client', () => ({ query: jest.fn() }));
jest.mock('@/lib/embeddings/generator', () => ({
  embedText: jest.fn(),
  embedTexts: jest.fn(),
  toRuvectorLiteral: (vector: number[]) => `[${vector.join(',')}]`,
}));

const mockQuery = jest.requireMock('@/lib/db/client').query as jest.Mock;
const embedding = jest.requireMock('@/lib/embeddings/generator') as {
  embedText: jest.Mock;
  embedTexts: jest.Mock;
};

describe('profile embedding search and import', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('binds an in-process query vector to hybrid search', async () => {
    embedding.embedText.mockResolvedValue([0.6, 0.8]);
    mockQuery.mockResolvedValue({ rows: [{
      id: 'contact-1', keyword_score: 0.2, vector_score: 1, fusion_score: 0.68,
    }] });

    const { GET } = await import('@/app/api/contacts/hybrid-search/route');
    const response = await GET(new Request('http://localhost/api/contacts/hybrid-search?q=Alice') as import('next/server').NextRequest);

    expect(response.status).toBe(200);
    expect(embedding.embedText).toHaveBeenCalledWith('Alice');
    expect(mockQuery.mock.calls[0][0]).toContain('pe.embedding <=> $2::ruvector');
    expect(mockQuery.mock.calls[0][1]).toEqual(['Alice', '[0.6,0.8]', 20]);
    expect((await response.json()).data.results[0].vectorScore).toBe(1);
  });

  it('uses keyword search when the embedding model is unavailable', async () => {
    embedding.embedText.mockRejectedValue(new Error('model unavailable'));
    mockQuery.mockResolvedValue({ rows: [{ id: 'contact-1', keyword_score: 0.4 }] });
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    try {
      const { GET } = await import('@/app/api/contacts/hybrid-search/route');
      const response = await GET(new Request('http://localhost/api/contacts/hybrid-search?q=Alice') as import('next/server').NextRequest);
      expect(response.status).toBe(200);
      expect(mockQuery).toHaveBeenCalledTimes(1);
      expect(mockQuery.mock.calls[0][1]).toEqual(['Alice', 20]);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('query embedding unavailable'), 'model unavailable');
    } finally {
      warn.mockRestore();
    }
  });

  it('surfaces unrelated database errors instead of disguising them as results', async () => {
    embedding.embedText.mockResolvedValue([0.6, 0.8]);
    mockQuery.mockRejectedValue(new Error('permission denied for contacts'));

    const { GET } = await import('@/app/api/contacts/hybrid-search/route');
    const response = await GET(new Request('http://localhost/api/contacts/hybrid-search?q=Alice') as import('next/server').NextRequest);
    expect(response.status).toBe(500);
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it('embeds an import batch and stores the same vector literal', async () => {
    embedding.embedTexts.mockResolvedValue([[0.6, 0.8]]);
    const client = { query: jest.fn()
      .mockResolvedValueOnce({ rows: [{ id: 'contact-1', headline: 'Researcher', title: null, current_company: null, about: null }] })
      .mockResolvedValueOnce({ rows: [] }) };

    const { generateEmbeddings } = await import('@/lib/import/embedding-generator');
    const result = await generateEmbeddings(client as unknown as import('pg').PoolClient);

    expect(result).toEqual({ generated: 1, skipped: 0, errors: 0 });
    expect(embedding.embedTexts).toHaveBeenCalledWith(['Researcher']);
    expect(client.query.mock.calls[1][0]).toContain('$2::ruvector');
    expect(client.query.mock.calls[1][1]).toEqual(['contact-1', '[0.6,0.8]', 'Researcher']);
  });
});
