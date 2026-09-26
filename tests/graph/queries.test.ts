jest.mock('@/lib/db/client', () => ({ query: jest.fn() }));

import { query } from '@/lib/db/client';
import { getAllEdges, getDegreeCounts } from '@/lib/db/queries/graph';

const mockQuery = query as jest.MockedFunction<typeof query>;

beforeEach(() => {
  mockQuery.mockReset();
  mockQuery.mockResolvedValue({ rows: [] } as never);
});

describe('graph edge queries', () => {
  it('preserves the all-edge default for other callers', async () => {
    await getAllEdges();
    await getDegreeCounts();

    expect(mockQuery).toHaveBeenNthCalledWith(
      1,
      'SELECT * FROM edges WHERE target_contact_id IS NOT NULL'
    );
    expect(mockQuery.mock.calls[1][0]).not.toContain('edge_type NOT IN');
  });

  it('excludes both synthetic edge types from contact edges and both degree endpoints', async () => {
    await getAllEdges({ realEdgesOnly: true });
    await getDegreeCounts({ realEdgesOnly: true });

    const filter = "edge_type NOT IN ('mutual-proximity', 'same-cluster')";
    expect(mockQuery.mock.calls[0][0]).toContain(filter);
    expect(mockQuery.mock.calls[1][0].split(filter)).toHaveLength(3);
  });
});
