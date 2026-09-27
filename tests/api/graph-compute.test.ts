jest.mock('@/lib/graph/compute-snapshot', () => {
  class GraphComputeBusyError extends Error {
    constructor() { super('Graph computation is already running. Retry when it finishes.'); }
  }
  class GraphComputePublicationUncertainError extends Error {
    constructor() { super('Graph computation ended, but its publication could not be verified. Refresh the graph before retrying.'); }
  }
  return { computeGraphSnapshot: jest.fn(), GraphComputeBusyError, GraphComputePublicationUncertainError };
});

import { computeGraphSnapshot, GraphComputeBusyError, GraphComputePublicationUncertainError } from '@/lib/graph/compute-snapshot';
import { POST } from '@/app/api/graph/compute/route';

describe('POST /api/graph/compute', () => {
  const compute = computeGraphSnapshot as jest.Mock;
  beforeEach(() => compute.mockReset());

  it('returns completed result only after publication', async () => {
    compute.mockResolvedValue({ metricsComputed: 3, communitiesDetected: 1, communityMethod: 'spectral', metricsMethod: 'node-atomic' });
    const response = await POST();
    expect(response.status).toBe(200);
    expect((await response.json()).data).toMatchObject({ metricsComputed: 3, communityMethod: 'spectral' });
  });

  it('reports a concurrent run as retryable without claiming success', async () => {
    compute.mockRejectedValue(new GraphComputeBusyError());
    const response = await POST();
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ retryable: true });
  });

  it('reports publication failure and retained prior results', async () => {
    compute.mockRejectedValue(new Error('injected failure'));
    const response = await POST();
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ error: expect.stringContaining('Prior results were retained'), retryable: true });
  });

  it('reports an unverifiable publication without claiming the prior graph is active', async () => {
    compute.mockRejectedValue(new GraphComputePublicationUncertainError());
    const response = await POST();
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body).toMatchObject({ outcome: 'uncertain', retryable: true });
    expect(body.error).not.toMatch(/Prior results were retained/);
  });
});
