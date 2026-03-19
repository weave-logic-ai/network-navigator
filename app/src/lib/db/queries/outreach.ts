// Outreach system DB queries: templates, campaigns, states, events, sequences

import { query } from '../client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TemplateRow {
  id: string;
  name: string;
  category: string;
  subject_template: string | null;
  body_template: string;
  merge_variables: string[];
  tone: string;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface CampaignRow {
  id: string;
  name: string;
  description: string | null;
  status: string;
  target_count: number;
  sent_count: number;
  response_count: number;
  created_at: Date;
  updated_at: Date;
}

export interface OutreachStateRow {
  id: string;
  contact_id: string;
  campaign_id: string | null;
  sequence_id: string | null;
  current_step: number;
  state: string;
  last_action_at: Date | null;
  next_action_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface OutreachEventRow {
  id: string;
  outreach_state_id: string;
  event_type: string;
  event_data: Record<string, unknown>;
  created_at: Date;
}

export interface PipelineContact {
  id: string;
  full_name: string | null;
  first_name: string | null;
  last_name: string | null;
  title: string | null;
  current_company: string | null;
  tier: string | null;
  state: string;
  last_action_at: Date | null;
  campaign_id: string | null;
  outreach_state_id: string;
}

export interface SequenceRow {
  id: string;
  campaign_id: string;
  name: string;
  description: string | null;
  is_active: boolean;
  created_at: Date;
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

export async function listTemplates(): Promise<TemplateRow[]> {
  const result = await query<TemplateRow>(
    'SELECT * FROM outreach_templates ORDER BY created_at DESC'
  );
  return result.rows;
}

export async function getTemplate(id: string): Promise<TemplateRow | null> {
  const result = await query<TemplateRow>(
    'SELECT * FROM outreach_templates WHERE id = $1',
    [id]
  );
  return result.rows[0] ?? null;
}

export async function createTemplate(data: {
  name: string;
  category: string;
  subject_template?: string;
  body_template: string;
  merge_variables?: string[];
  tone?: string;
}): Promise<TemplateRow> {
  const result = await query<TemplateRow>(
    `INSERT INTO outreach_templates (name, category, subject_template, body_template, merge_variables, tone)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [
      data.name,
      data.category,
      data.subject_template ?? null,
      data.body_template,
      data.merge_variables ?? [],
      data.tone ?? 'professional',
    ]
  );
  return result.rows[0];
}

export async function updateTemplate(
  id: string,
  data: Record<string, unknown>
): Promise<TemplateRow | null> {
  const allowedFields = [
    'name', 'category', 'subject_template', 'body_template',
    'merge_variables', 'tone', 'is_active',
  ];

  const setClauses: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  for (const [key, value] of Object.entries(data)) {
    if (allowedFields.includes(key)) {
      setClauses.push(`${key} = $${idx++}`);
      values.push(value);
    }
  }

  if (setClauses.length === 0) return getTemplate(id);

  values.push(id);
  const result = await query<TemplateRow>(
    `UPDATE outreach_templates SET ${setClauses.join(', ')} WHERE id = $${idx} RETURNING *`,
    values
  );
  return result.rows[0] ?? null;
}

export async function deleteTemplate(id: string): Promise<boolean> {
  const result = await query(
    'DELETE FROM outreach_templates WHERE id = $1',
    [id]
  );
  return (result.rowCount ?? 0) > 0;
}

// ---------------------------------------------------------------------------
// Campaigns
// ---------------------------------------------------------------------------

export async function listCampaigns(): Promise<CampaignRow[]> {
  const result = await query<CampaignRow>(
    'SELECT * FROM outreach_campaigns ORDER BY created_at DESC'
  );
  return result.rows;
}

export async function getCampaign(id: string): Promise<CampaignRow | null> {
  const result = await query<CampaignRow>(
    'SELECT * FROM outreach_campaigns WHERE id = $1',
    [id]
  );
  return result.rows[0] ?? null;
}

export async function createCampaign(data: {
  name: string;
  description?: string;
  status?: string;
  target_count?: number;
}): Promise<CampaignRow> {
  const result = await query<CampaignRow>(
    `INSERT INTO outreach_campaigns (name, description, status, target_count)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [
      data.name,
      data.description ?? null,
      data.status ?? 'draft',
      data.target_count ?? 0,
    ]
  );
  return result.rows[0];
}

export async function updateCampaign(
  id: string,
  data: Record<string, unknown>
): Promise<CampaignRow | null> {
  const allowedFields = [
    'name', 'description', 'status', 'target_count',
    'sent_count', 'response_count',
  ];

  const setClauses: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  for (const [key, value] of Object.entries(data)) {
    if (allowedFields.includes(key)) {
      setClauses.push(`${key} = $${idx++}`);
      values.push(value);
    }
  }

  if (setClauses.length === 0) return getCampaign(id);

  values.push(id);
  const result = await query<CampaignRow>(
    `UPDATE outreach_campaigns SET ${setClauses.join(', ')} WHERE id = $${idx} RETURNING *`,
    values
  );
  return result.rows[0] ?? null;
}

// ---------------------------------------------------------------------------
// Outreach States (pipeline)
// ---------------------------------------------------------------------------

export async function getOutreachState(
  contactId: string,
  campaignId?: string
): Promise<OutreachStateRow | null> {
  if (campaignId) {
    const result = await query<OutreachStateRow>(
      'SELECT * FROM outreach_states WHERE contact_id = $1 AND campaign_id = $2',
      [contactId, campaignId]
    );
    return result.rows[0] ?? null;
  }
  const result = await query<OutreachStateRow>(
    'SELECT * FROM outreach_states WHERE contact_id = $1 ORDER BY updated_at DESC LIMIT 1',
    [contactId]
  );
  return result.rows[0] ?? null;
}

export async function upsertOutreachState(data: {
  contact_id: string;
  campaign_id?: string;
  state: string;
  last_action_at?: string;
}): Promise<OutreachStateRow> {
  const result = await query<OutreachStateRow>(
    `INSERT INTO outreach_states (contact_id, campaign_id, state, last_action_at)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (contact_id, campaign_id)
     DO UPDATE SET state = EXCLUDED.state, last_action_at = EXCLUDED.last_action_at
     RETURNING *`,
    [
      data.contact_id,
      data.campaign_id ?? null,
      data.state,
      data.last_action_at ?? new Date().toISOString(),
    ]
  );
  return result.rows[0];
}

export async function getPipelineContacts(
  campaignId?: string
): Promise<PipelineContact[]> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  let idx = 1;

  if (campaignId) {
    conditions.push(`os.campaign_id = $${idx++}`);
    params.push(campaignId);
  }

  const whereClause = conditions.length > 0
    ? `WHERE ${conditions.join(' AND ')}`
    : '';

  const result = await query<PipelineContact>(
    `SELECT c.id, c.full_name, c.first_name, c.last_name, c.title,
            c.current_company, cs.tier, os.state, os.last_action_at,
            os.campaign_id, os.id AS outreach_state_id
     FROM outreach_states os
     JOIN contacts c ON c.id = os.contact_id
     LEFT JOIN contact_scores cs ON cs.contact_id = c.id
     ${whereClause}
     ORDER BY os.updated_at DESC`,
    params
  );
  return result.rows;
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

export async function recordOutreachEvent(data: {
  outreach_state_id: string;
  event_type: string;
  event_data?: Record<string, unknown>;
}): Promise<OutreachEventRow> {
  const result = await query<OutreachEventRow>(
    `INSERT INTO outreach_events (outreach_state_id, event_type, event_data)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [
      data.outreach_state_id,
      data.event_type,
      JSON.stringify(data.event_data ?? {}),
    ]
  );
  return result.rows[0];
}

export async function listEventsByContact(
  contactId: string
): Promise<OutreachEventRow[]> {
  const result = await query<OutreachEventRow>(
    `SELECT oe.*
     FROM outreach_events oe
     JOIN outreach_states os ON os.id = oe.outreach_state_id
     WHERE os.contact_id = $1
     ORDER BY oe.created_at DESC`,
    [contactId]
  );
  return result.rows;
}

// ---------------------------------------------------------------------------
// Template Performance
// ---------------------------------------------------------------------------

export async function getTemplatePerformanceStats(): Promise<
  Array<{
    template_id: string;
    template_name: string;
    total_sent: number;
    total_opened: number;
    total_replied: number;
    total_accepted: number;
  }>
> {
  const result = await query<{
    template_id: string;
    template_name: string;
    total_sent: string;
    total_opened: string;
    total_replied: string;
    total_accepted: string;
  }>(
    `SELECT ot.id AS template_id, ot.name AS template_name,
            COALESCE(SUM(tp.sent_count), 0)::text AS total_sent,
            COALESCE(SUM(tp.open_count), 0)::text AS total_opened,
            COALESCE(SUM(tp.reply_count), 0)::text AS total_replied,
            COALESCE(SUM(tp.accept_count), 0)::text AS total_accepted
     FROM outreach_templates ot
     LEFT JOIN template_performance tp ON tp.template_id = ot.id
     GROUP BY ot.id, ot.name
     ORDER BY ot.name`
  );
  return result.rows.map((r) => ({
    template_id: r.template_id,
    template_name: r.template_name,
    total_sent: parseInt(r.total_sent, 10),
    total_opened: parseInt(r.total_opened, 10),
    total_replied: parseInt(r.total_replied, 10),
    total_accepted: parseInt(r.total_accepted, 10),
  }));
}

// ---------------------------------------------------------------------------
// Sequences
// ---------------------------------------------------------------------------

export async function listSequences(
  campaignId?: string
): Promise<SequenceRow[]> {
  if (campaignId) {
    const result = await query<SequenceRow>(
      'SELECT * FROM outreach_sequences WHERE campaign_id = $1 ORDER BY created_at DESC',
      [campaignId]
    );
    return result.rows;
  }
  const result = await query<SequenceRow>(
    'SELECT * FROM outreach_sequences ORDER BY created_at DESC'
  );
  return result.rows;
}

export async function getSequence(id: string): Promise<SequenceRow | null> {
  const result = await query<SequenceRow>(
    'SELECT * FROM outreach_sequences WHERE id = $1',
    [id]
  );
  return result.rows[0] ?? null;
}
