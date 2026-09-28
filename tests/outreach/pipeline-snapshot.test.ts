import { PipelineSnapshotLoader, type PipelineSnapshot } from '@/lib/outreach/pipeline-snapshot';

interface Contact { id: string }

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

const tick = () => new Promise(resolve => setTimeout(resolve, 0));

test('a slow A response cannot replace the selected B board, even when abort is ignored', async () => {
  const a = deferred<Response>();
  const b = deferred<Response>();
  const snapshots: PipelineSnapshot<Contact>[] = [];
  const loading: string[] = [];
  const fetcher = jest.fn()
    .mockImplementationOnce(() => a.promise)
    .mockImplementationOnce(() => b.promise);
  const loader = new PipelineSnapshotLoader<Contact>(
    id => loading.push(id), snapshot => snapshots.push(snapshot), () => { throw new Error('unexpected error'); }, fetcher,
  );

  loader.select('A');
  loader.select('B');
  expect(fetcher.mock.calls[0][1].signal.aborted).toBe(true);
  a.resolve({ ok: true, json: async () => ({ stages: { contacted: [{ id: 'A' }] } }) } as Response);
  await tick();
  expect(snapshots).toEqual([]);
  b.resolve({ ok: true, json: async () => ({ stages: { replied: [{ id: 'B' }] } }) } as Response);
  await tick();
  expect(loading).toEqual(['A', 'B']);
  expect(snapshots).toEqual([{ campaignId: 'B', stages: { replied: [{ id: 'B' }] } }]);
});

test('a completed move for A cannot refresh A after B is selected', async () => {
  const a = deferred<Response>();
  const b = deferred<Response>();
  const fetcher = jest.fn().mockImplementationOnce(() => a.promise).mockImplementationOnce(() => b.promise);
  const loader = new PipelineSnapshotLoader<Contact>(() => {}, () => {}, () => {}, fetcher);
  loader.select('A');
  loader.select('B');
  loader.refresh('A');
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(fetcher.mock.calls[1][0]).toBe('/api/outreach/pipeline?campaign_id=B');
  a.resolve({ ok: true, json: async () => ({ stages: {} }) } as Response);
  b.resolve({ ok: true, json: async () => ({ stages: {} }) } as Response);
  await tick();
});
