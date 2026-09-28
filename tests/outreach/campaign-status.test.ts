import { NextRequest } from '../../app/node_modules/next/server';
import { PUT } from '@/app/api/outreach/campaigns/[id]/route';
import { POST } from '@/app/api/outreach/campaigns/route';
import { createCampaign, updateCampaign } from '@/lib/db/queries/outreach';

jest.mock('@/lib/auth/local-request-boundary', () => ({ requireLocalDashboardRequest: jest.fn(async () => null) }));
jest.mock('@/lib/db/queries/outreach', () => ({
  ...jest.requireActual('@/lib/db/queries/outreach'),
  createCampaign: jest.fn(async (data: object) => ({ id: 'new', ...data })),
  updateCampaign: jest.fn(async (id: string, data: object) => ({ id, ...data })),
  getCampaign: jest.fn(),
  listCampaigns: jest.fn(),
}));

const id = '123e4567-e89b-42d3-a456-426614174000';
const json = (url: string, method: string, body: unknown) => new NextRequest(`http://localhost${url}`, {
  method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
});
const put = (body: unknown) => PUT(json(`/api/outreach/campaigns/${id}`, 'PUT', body), { params: Promise.resolve({ id }) });

beforeEach(() => jest.clearAllMocks());

test('status alone can be changed without touching name or description', async () => {
  const response = await put({ status: 'active' });
  expect(response.status).toBe(200);
  expect(updateCampaign).toHaveBeenCalledWith(id, { status: 'active' });
});

test('rename and status change can be combined', async () => {
  expect((await put({ name: ' Q4 ', description: null, status: 'paused' })).status).toBe(200);
  expect(updateCampaign).toHaveBeenCalledWith(id, { name: 'Q4', description: null, status: 'paused' });
});

test('invalid status, empty update and description without name are rejected before writing', async () => {
  for (const body of [{ status: 'launched' }, { status: 3 }, {}, { description: 'x' }, { name: '' }, []]) {
    expect((await put(body)).status).toBe(400);
  }
  expect(updateCampaign).not.toHaveBeenCalled();
});

test('create validates an explicit status instead of relying on the database check', async () => {
  expect((await POST(json('/api/outreach/campaigns', 'POST', { name: 'X', status: 'bogus' }))).status).toBe(400);
  expect(createCampaign).not.toHaveBeenCalled();
  expect((await POST(json('/api/outreach/campaigns', 'POST', { name: 'X', status: 'active' }))).status).toBe(201);
});
