import { NextRequest } from '../../app/node_modules/next/server';
import { createElement } from 'react';
import { renderToStaticMarkup } from '../../app/node_modules/react-dom/server';
import { KanbanColumn } from '@/components/outreach/kanban-column';
import { createOperatorSession, OPERATOR_COOKIE } from '@/lib/auth/operator-session';
import { GET } from '../../app/src/app/api/outreach/pipeline/route';
import { PUT } from '../../app/src/app/api/outreach/pipeline/[id]/route';
import { POST as recordEvent } from '../../app/src/app/api/outreach/events/route';
import { GET as getContacts } from '../../app/src/app/api/contacts/route';
import { GET as getCampaigns, POST as postCampaign } from '../../app/src/app/api/outreach/campaigns/route';
import { getPipelineContacts, movePipelineStage, recordEventAndTransition } from '@/lib/db/queries/outreach';
import { listCampaigns, createCampaign } from '@/lib/db/queries/outreach';

jest.mock('@/lib/db/queries/outreach', () => ({
  PIPELINE_STAGES: ['not_started', 'contacted', 'replied', 'meeting_booked', 'won', 'lost'],
  getPipelineContacts: jest.fn(),
  movePipelineStage: jest.fn(),
  recordEventAndTransition: jest.fn(),
  TemplateUnavailableError: class TemplateUnavailableError extends Error {},
  listCampaigns: jest.fn(),
  createCampaign: jest.fn(),
}));
jest.mock('@/lib/db/queries/contacts', () => ({ listContacts: jest.fn() }));
jest.mock('@/lib/scoring/outreach-feedback', () => ({ processOutreachFeedback: jest.fn().mockResolvedValue(undefined) }));

const first = '11111111-1111-4111-8111-111111111111';
const second = '22222222-2222-4222-8222-222222222222';
const campaignA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const campaignB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const priorSecret = process.env.LOCAL_OPERATOR_SECRET;
const list = getPipelineContacts as jest.Mock;
const move = movePipelineStage as jest.Mock;
const record = recordEventAndTransition as jest.Mock;

function request(path: string, method = 'GET', cookie?: string, body?: string, origin = 'http://localhost:3750') {
  return new NextRequest(`http://localhost:3750${path}`, {
    method,
    headers: {
      host: 'localhost:3750', origin, 'sec-fetch-site': 'same-origin',
      ...(cookie ? { cookie: `${OPERATOR_COOKIE}=${cookie}` } : {}),
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body,
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  process.env.LOCAL_OPERATOR_SECRET = 'synthetic-operator-secret-for-outreach-tests';
});
afterAll(() => {
  if (priorSecret === undefined) delete process.env.LOCAL_OPERATOR_SECRET;
  else process.env.LOCAL_OPERATOR_SECRET = priorSecret;
});

test('pipeline reads and moves require a local operator session before any query', async () => {
  const route = { params: Promise.resolve({ id: first }) };
  expect((await GET(request('/api/outreach/pipeline'))).status).toBe(401);
  expect((await PUT(request(`/api/outreach/pipeline/${first}`, 'PUT', undefined, '{"stage":"won"}'), route)).status).toBe(401);
  const session = await createOperatorSession();
  expect((await PUT(request(`/api/outreach/pipeline/${first}`, 'PUT', session!, '{"stage":"won"}', 'https://example.com'), route)).status).toBe(403);
  expect((await recordEvent(request('/api/outreach/events', 'POST', undefined,
    '{"contact_id":"11111111-1111-4111-8111-111111111111","event_type":"sent"}'))).status).toBe(401);
  expect((await getContacts(request('/api/contacts'))).status).toBe(401);
  expect((await getContacts(request('/api/contacts', 'GET', session!, undefined, 'https://example.com'))).status).toBe(403);
  expect(list).not.toHaveBeenCalled();
  expect(move).not.toHaveBeenCalled();
});

test('campaign listing and creation require a same-origin operator session', async () => {
  const body = JSON.stringify({ name: 'New campaign' });
  expect((await getCampaigns(request('/api/outreach/campaigns'))).status).toBe(401);
  expect((await postCampaign(request('/api/outreach/campaigns', 'POST', undefined, body))).status).toBe(401);
  const session = await createOperatorSession();
  expect((await getCampaigns(request('/api/outreach/campaigns', 'GET', session!, undefined, 'https://example.com'))).status).toBe(403);
  expect((await postCampaign(request('/api/outreach/campaigns', 'POST', session!, body, 'https://example.com'))).status).toBe(403);
  expect(listCampaigns).not.toHaveBeenCalled();
  expect(createCampaign).not.toHaveBeenCalled();

  (listCampaigns as jest.Mock).mockResolvedValue([{ id: campaignA, name: 'Existing' }]);
  (createCampaign as jest.Mock).mockResolvedValue({ id: campaignB, name: 'New campaign' });
  expect((await getCampaigns(request('/api/outreach/campaigns', 'GET', session!))).status).toBe(200);
  expect((await postCampaign(request('/api/outreach/campaigns', 'POST', session!, body))).status).toBe(201);
  expect(listCampaigns).toHaveBeenCalledTimes(1);
  expect(createCampaign).toHaveBeenCalledTimes(1);
});

test('Won, Reset and campaign filtering use exact state IDs and persist on reload', async () => {
  const session = await createOperatorSession();
  const rows = [
    { id: first, outreach_state_id: first, campaign_id: campaignA, state: 'not_started', pipeline_stage: 'not_started' },
    { id: first, outreach_state_id: second, campaign_id: campaignB, state: 'replied', pipeline_stage: 'replied' },
  ];
  list.mockImplementation(async (campaignId?: string) => rows.filter(row => !campaignId || row.campaign_id === campaignId));
  move.mockImplementation(async (stateId: string, stage: string, expectedCampaignId: string | null) => {
    const row = rows.find(item => item.outreach_state_id === stateId);
    if (!row || row.campaign_id !== expectedCampaignId) return 'not_found';
    row.pipeline_stage = stage;
    return 'moved';
  });
  const route = { params: Promise.resolve({ id: first }) };
  const put = (stage: string, campaignId = campaignA) => PUT(request(`/api/outreach/pipeline/${first}`, 'PUT',
    session!, JSON.stringify({ stage, campaign_id: campaignId, event_version: 0 })), route);
  expect((await put('won', campaignB)).status).toBe(409);
  expect(rows[0].pipeline_stage).toBe('not_started');
  expect((await put('won')).status).toBe(200);
  const won = await GET(request(`/api/outreach/pipeline?campaign_id=${campaignA}`, 'GET', session!));
  expect((await won.json()).stages.won).toHaveLength(1);
  const other = await GET(request(`/api/outreach/pipeline?campaign_id=${campaignB}`, 'GET', session!));
  expect((await other.json()).stages.replied).toHaveLength(1);
  expect((await put('not_started')).status).toBe(200);
  const reset = await GET(request(`/api/outreach/pipeline?campaign_id=${campaignA}`, 'GET', session!));
  expect((await reset.json()).stages.not_started).toHaveLength(1);
  expect(rows[1].pipeline_stage).toBe('replied');
  expect(move).toHaveBeenCalledWith(first, 'not_started', campaignA, 0);
});

test('terminal negative outcomes reject later manual moves', async () => {
  const session = await createOperatorSession();
  move.mockResolvedValue('terminal');
  const response = await PUT(request(`/api/outreach/pipeline/${first}`, 'PUT', session!,
    JSON.stringify({ stage: 'won', campaign_id: campaignA, event_version: 0 })),
  { params: Promise.resolve({ id: first }) });
  expect(response.status).toBe(409);
  expect(move).toHaveBeenCalledWith(first, 'won', campaignA, 0);
});

test('invalid IDs and stages fail without mutation', async () => {
  const session = await createOperatorSession();
  expect((await GET(request('/api/outreach/pipeline?campaign_id=bad', 'GET', session!))).status).toBe(400);
  expect((await PUT(request('/api/outreach/pipeline/bad', 'PUT', session!, '{"stage":"won"}'),
    { params: Promise.resolve({ id: 'bad' }) })).status).toBe(400);
  expect((await PUT(request(`/api/outreach/pipeline/${first}`, 'PUT', session!, '{"stage":"sent"}'),
    { params: Promise.resolve({ id: first }) })).status).toBe(400);
  expect((await PUT(request(`/api/outreach/pipeline/${first}`, 'PUT', session!, '{"stage":"won"}'),
    { params: Promise.resolve({ id: first }) })).status).toBe(400);
  expect(list).not.toHaveBeenCalled();
  expect(move).not.toHaveBeenCalled();
});

test('event recording requires an explicit campaign and transitions that campaign', async () => {
  const session = await createOperatorSession();
  const post = (body: Record<string, string>) => recordEvent(request('/api/outreach/events', 'POST', session!, JSON.stringify(body)));
  expect((await post({ contact_id: first, event_type: 'replied' })).status).toBe(400);
  expect(record).not.toHaveBeenCalled();
  record.mockResolvedValue({ id: second });
  expect((await post({ contact_id: first, campaign_id: campaignB, event_type: 'replied' })).status).toBe(201);
  expect(record).toHaveBeenCalledWith(expect.objectContaining({
    contact_id: first, campaign_id: campaignB, state: 'replied',
  }));
});

test('all-campaign cards visibly distinguish duplicate contacts by campaign', () => {
  const base = {
    id: first, full_name: 'Synthetic Contact', first_name: null, last_name: null,
    title: null, current_company: null, tier: null, state: 'sent', last_action_at: null,
  };
  const contacts = [
    { ...base, outreach_state_id: first, campaign_id: campaignA, campaign_name: 'Campaign A' },
    { ...base, outreach_state_id: second, campaign_id: campaignB, campaign_name: 'Campaign B' },
  ];
  const markup = renderToStaticMarkup(createElement(KanbanColumn, {
    stage: 'contacted', contacts, showCampaign: true, onMoveContact: () => {},
  }));
  expect(markup).toContain('Campaign: Campaign A');
  expect(markup).toContain('Campaign: Campaign B');
  expect(markup.match(/Synthetic Contact/g)).toHaveLength(2);
});
