// Dispatcher tests: handler routing, failure handling, ack recording, dead-letter.

jest.mock('@/lib/db/client', () => ({
  query: jest.fn(),
  transaction: jest.fn(),
  healthCheck: jest.fn(),
  getPool: jest.fn(),
  shutdown: jest.fn(),
}));

jest.mock('@/lib/ecc/impulses/handlers/task-generator', () => ({
  executeTaskGenerator: jest.fn(),
}));

jest.mock('@/lib/ecc/impulses/handlers/campaign-enroller', () => ({
  executeCampaignEnroller: jest.fn(),
}));

jest.mock('@/lib/ecc/impulses/handlers/notification', () => ({
  executeNotification: jest.fn(),
}));

jest.mock('@/lib/ecc/impulses/handlers/webhook', () => ({
  executeWebhook: jest.fn(),
}));

import { query } from '@/lib/db/client';
import { dispatchImpulse } from '@/lib/ecc/impulses/dispatcher';
import { executeTaskGenerator } from '@/lib/ecc/impulses/handlers/task-generator';
import { executeCampaignEnroller } from '@/lib/ecc/impulses/handlers/campaign-enroller';
import { executeNotification } from '@/lib/ecc/impulses/handlers/notification';
import { executeWebhook } from '@/lib/ecc/impulses/handlers/webhook';

const mockQuery = query as jest.MockedFunction<typeof query>;

function mockRows<T>(rows: T[]): ReturnType<typeof query> {
  return Promise.resolve({ rows, command: '', rowCount: rows.length, oid: 0, fields: [] }) as ReturnType<typeof query>;
}

function impulseRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'imp-1', tenant_id: 't', impulse_type: 'tier_changed',
    source_entity_type: 'contact', source_entity_id: 'c1',
    payload: { from: 'silver', to: 'gold' }, created_at: '2026-01-01',
    ...overrides,
  };
}

function handlerRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'h-1', tenant_id: 't', impulse_type: 'tier_changed',
    handler_type: 'task_generator', config: {}, enabled: true, priority: 1,
    created_at: 'x', updated_at: 'x',
    ...overrides,
  };
}

describe('dispatchImpulse', () => {
  beforeEach(() => {
    mockQuery.mockReset();
    (executeTaskGenerator as jest.Mock).mockReset();
    (executeCampaignEnroller as jest.Mock).mockReset();
    (executeNotification as jest.Mock).mockReset();
    (executeWebhook as jest.Mock).mockReset();
  });

  it('throws when impulse is not found', async () => {
    mockQuery.mockReturnValueOnce(mockRows([])); // impulse lookup -> none
    await expect(dispatchImpulse('missing')).rejects.toThrow('Impulse not found');
  });

  it('warns loudly when no handler is registered for the impulse type', async () => {
    // Regression guard: an impulse with zero registered handlers returns
    // handlersExecuted: 0, which is indistinguishable from success. That is
    // how ECC_IMPULSES=true silently produced zero tasks while
    // impulse_handlers went unseeded. The dispatch must say so out loud.
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      mockQuery.mockReturnValueOnce(mockRows([impulseRow()])); // load impulse
      mockQuery.mockReturnValueOnce(mockRows([])); // load handlers -> NONE

      const result = await dispatchImpulse('imp-1');

      expect(result.handlersExecuted).toBe(0);
      expect(warn).toHaveBeenCalledTimes(1);
      const msg = String(warn.mock.calls[0][0]);
      expect(msg).toMatch(/\[ecc\/impulses\]/);
      expect(msg).toMatch(/No enabled handler registered/);
      expect(msg).toMatch(/tier_changed/); // names the impulse type
      expect(msg).toMatch(/048-seed-impulse-handlers\.sql/); // points at the fix
    } finally {
      warn.mockRestore();
    }
  });

  it('does not warn when a handler is registered', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      mockQuery.mockReturnValueOnce(mockRows([impulseRow()]));
      mockQuery.mockReturnValueOnce(mockRows([handlerRow()]));
      mockQuery.mockReturnValueOnce(mockRows([])); // ack insert
      (executeTaskGenerator as jest.Mock).mockResolvedValueOnce({ tasksCreated: 1 });

      await dispatchImpulse('imp-1');

      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it('routes tier_changed to task_generator and records success ack', async () => {
    mockQuery.mockReturnValueOnce(mockRows([impulseRow()])); // load impulse
    mockQuery.mockReturnValueOnce(mockRows([handlerRow()])); // load handlers
    mockQuery.mockReturnValueOnce(mockRows([])); // ack insert
    (executeTaskGenerator as jest.Mock).mockResolvedValueOnce({ tasksCreated: 1 });

    const result = await dispatchImpulse('imp-1');

    expect(executeTaskGenerator).toHaveBeenCalledTimes(1);
    expect(result.handlersExecuted).toBe(1);
    expect(result.results[0].status).toBe('success');
    expect(result.results[0].result).toEqual({ tasksCreated: 1 });

    // Ack insert with status=success
    const ackCall = mockQuery.mock.calls[2];
    expect(String(ackCall[0])).toMatch(/INSERT INTO impulse_acks/);
    expect(String(ackCall[0])).toMatch(/'success'/);
  });

  it('isolates handler failures and records failed ack', async () => {
    mockQuery.mockReturnValueOnce(mockRows([impulseRow()]));
    mockQuery.mockReturnValueOnce(mockRows([handlerRow()]));
    mockQuery.mockReturnValueOnce(mockRows([])); // ack insert
    // Handler failure check (count of failures in last hour) - return 1
    mockQuery.mockReturnValueOnce(mockRows([{ count: '1' }]));

    (executeTaskGenerator as jest.Mock).mockRejectedValueOnce(new Error('boom'));

    const result = await dispatchImpulse('imp-1');
    expect(result.results[0].status).toBe('failed');
    expect(result.results[0].result).toEqual({ error: 'boom' });

    // Ack insert must be status=failed
    const ackCall = mockQuery.mock.calls[2];
    expect(String(ackCall[0])).toMatch(/'failed'/);

    // Dead-letter check was run (COUNT query)
    const deadLetterCheck = mockQuery.mock.calls[3];
    expect(String(deadLetterCheck[0])).toMatch(/COUNT/);
  });

  it('auto-disables a handler after MAX_FAILURES_BEFORE_DISABLE (=3)', async () => {
    mockQuery.mockReturnValueOnce(mockRows([impulseRow()]));
    mockQuery.mockReturnValueOnce(mockRows([handlerRow()]));
    mockQuery.mockReturnValueOnce(mockRows([])); // ack insert
    mockQuery.mockReturnValueOnce(mockRows([{ count: '3' }])); // fail count reached
    mockQuery.mockReturnValueOnce(mockRows([])); // UPDATE impulse_handlers SET enabled=false

    (executeTaskGenerator as jest.Mock).mockRejectedValueOnce(new Error('boom'));

    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    await dispatchImpulse('imp-1');

    // The final UPDATE must disable the handler
    const updateCall = mockQuery.mock.calls[4];
    expect(String(updateCall[0])).toMatch(/UPDATE impulse_handlers SET enabled = false/);
    warnSpy.mockRestore();
  });

  it('routes to campaign_enroller and notification handlers by type', async () => {
    mockQuery.mockReturnValueOnce(mockRows([impulseRow()]));
    mockQuery.mockReturnValueOnce(mockRows([
      handlerRow({ id: 'h-c', handler_type: 'campaign_enroller', priority: 1 }),
      handlerRow({ id: 'h-n', handler_type: 'notification', priority: 2 }),
    ]));
    mockQuery.mockReturnValueOnce(mockRows([])); // ack for h-c
    mockQuery.mockReturnValueOnce(mockRows([])); // ack for h-n

    (executeCampaignEnroller as jest.Mock).mockResolvedValueOnce({ enrolled: true });
    (executeNotification as jest.Mock).mockResolvedValueOnce({ sent: true });

    const result = await dispatchImpulse('imp-1');
    expect(result.handlersExecuted).toBe(2);
    expect(executeCampaignEnroller).toHaveBeenCalledTimes(1);
    expect(executeNotification).toHaveBeenCalledTimes(1);
    expect(result.results.every(r => r.status === 'success')).toBe(true);
  });

  it('routes webhook handler type to executeWebhook and records success ack', async () => {
    mockQuery.mockReturnValueOnce(mockRows([impulseRow()]));
    mockQuery.mockReturnValueOnce(mockRows([handlerRow({ handler_type: 'webhook' })]));
    mockQuery.mockReturnValueOnce(mockRows([])); // ack

    (executeWebhook as jest.Mock).mockResolvedValueOnce({ dispatched: true, status: 200, durationMs: 12 });

    const result = await dispatchImpulse('imp-1');
    expect(executeWebhook).toHaveBeenCalledTimes(1);
    expect(result.results[0].status).toBe('success');
    expect(result.results[0].result).toEqual({ dispatched: true, status: 200, durationMs: 12 });
  });
});
