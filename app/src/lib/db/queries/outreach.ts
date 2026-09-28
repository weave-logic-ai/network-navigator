// Outreach system DB queries: templates, campaigns, states, events, sequences

import { query, transaction } from '../client';

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

export class TemplateUnavailableError extends Error {
  constructor() { super('Template is no longer available'); }
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
  campaign_name: string | null;
  outreach_state_id: string;
  pipeline_stage: PipelineStage;
  event_version: number;
}

export const PIPELINE_STAGES = [
  'not_started', 'contacted', 'replied', 'meeting_booked', 'won', 'lost',
] as const;
export type PipelineStage = typeof PIPELINE_STAGES[number];

/**
 * Presentation stage for one outreach state. Explicit operator moves own the
 * board stage until the next move. Reset starts a new tracking interval, so
 * delivery after Reset may advance the stage while earlier events stay in the
 * audit log. Terminal negative outcomes always show Lost. Delivery progress:
 * sent/opened/accepted < replied < meeting_booked, with negative outcomes
 * terminal. Accepted means connection acceptance, never campaign Won.
 * Keep this join scoped to `os` so campaigns never share an event stream.
 */
export const OUTREACH_STAGE_JOIN_SQL = `LEFT JOIN LATERAL (
  SELECT CASE
      WHEN os.id IS NULL THEN NULL
      WHEN delivery.negative_outcome OR os.state IN ('declined', 'bounced', 'opted_out') THEN 'lost'
      WHEN manual.event_type = 'pipeline_stage_changed'
        AND manual.event_data->>'stage' <> 'not_started'
        THEN manual.event_data->>'stage'
      WHEN delivery.progress = 3 THEN 'meeting_booked'
      WHEN delivery.progress >= 2 OR (manual.event_type IS NULL AND os.state = 'replied') THEN 'replied'
      WHEN delivery.progress >= 1 OR (manual.event_type IS NULL AND os.state IN ('sent', 'opened', 'accepted')) THEN 'contacted'
      ELSE 'not_started'
    END AS pipeline_stage
  FROM (SELECT 1) seed
  LEFT JOIN LATERAL (
    SELECT event_type, event_data, event_order FROM outreach_events
    WHERE outreach_state_id = os.id
      AND event_type = 'pipeline_stage_changed'
      AND event_data->>'stage' IN ('not_started', 'contacted', 'replied',
        'meeting_booked', 'won', 'lost')
    ORDER BY event_order DESC LIMIT 1
  ) manual ON TRUE
  LEFT JOIN LATERAL (
    SELECT MAX(CASE event_type
      WHEN 'meeting_booked' THEN 3
      WHEN 'replied' THEN 2
      WHEN 'accepted' THEN 1
      WHEN 'opened' THEN 1
      WHEN 'sent' THEN 1
      ELSE 0 END) AS progress,
      COALESCE(BOOL_OR(event_type IN ('declined', 'bounced', 'opted_out')), FALSE) AS negative_outcome
    FROM outreach_events
    WHERE outreach_state_id = os.id
      AND event_type IN ('queued', 'not_started', 'sent', 'opened', 'replied',
        'meeting_booked', 'accepted', 'declined', 'bounced', 'opted_out')
      AND (manual.event_data->>'stage' IS DISTINCT FROM 'not_started'
        OR event_order > manual.event_order)
  ) delivery ON TRUE
) presentation ON TRUE`;

/** Manual pipeline moves are tracking decisions, never delivery events. */
export type PipelineMoveResult = 'moved' | 'unchanged' | 'not_found' | 'terminal' | 'stale';

export async function movePipelineStage(
  stateId: string, stage: PipelineStage, expectedCampaignId: string | null, expectedVersion: number
): Promise<PipelineMoveResult> {
  return transaction(async (client) => {
    const state = await client.query<{ id: string }>(
      `SELECT os.id FROM outreach_states os
       WHERE os.id = $1 AND os.campaign_id IS NOT DISTINCT FROM $2::uuid
       FOR UPDATE OF os`,
      [stateId, expectedCampaignId]
    );
    if (!state.rows[0]) return 'not_found';
    // Read events after acquiring the row lock, so a retry observes the
    // previous writer's committed move, delivery, and terminal outcome.
    const current = await client.query<{ state: string; pipeline_stage: string; negative_outcome: boolean; event_version: string }>(
      `SELECT os.state, presentation.pipeline_stage,
         COALESCE((SELECT MAX(event_order) FROM outreach_events WHERE outreach_state_id = os.id), 0)::text AS event_version,
         EXISTS (SELECT 1 FROM outreach_events oe
           WHERE oe.outreach_state_id = os.id
             AND oe.event_type IN ('declined', 'bounced', 'opted_out')) AS negative_outcome
       FROM outreach_states os
       ${OUTREACH_STAGE_JOIN_SQL} WHERE os.id = $1`, [stateId]
    );
    if (current.rows[0].negative_outcome || ['declined', 'bounced', 'opted_out'].includes(current.rows[0].state)) {
      return 'terminal';
    }
    if (Number(current.rows[0].event_version) !== expectedVersion) return 'stale';
    if (current.rows[0].pipeline_stage === stage) return 'unchanged';
    await client.query('UPDATE outreach_states SET last_action_at = now_utc() WHERE id = $1', [stateId]);
    await client.query(
      `INSERT INTO outreach_events (outreach_state_id, event_type, event_data)
       VALUES ($1, 'pipeline_stage_changed', jsonb_build_object('stage', $2::text))`,
      [stateId, stage]
    );
    return 'moved';
  });
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
  return transaction(async (client) => {
    const template = await client.query<{ name: string }>(
      'SELECT name FROM outreach_templates WHERE id = $1 FOR UPDATE', [id]
    );
    if (!template.rows[0]) return false;
    // Keep names captured at event time. Only legacy events without a name
    // need the template's final name before the live row is deleted.
    await client.query(
      `UPDATE outreach_events SET event_data = jsonb_set(
         COALESCE(event_data, '{}'::jsonb), '{template_name}', to_jsonb($2::text), true)
       WHERE lower(event_data->>'template_id') = lower($1::text)
         AND NULLIF(event_data->>'template_name', '') IS NULL`,
      [id, template.rows[0].name]
    );
    const result = await client.query('DELETE FROM outreach_templates WHERE id = $1', [id]);
    return (result.rowCount ?? 0) > 0;
  });
}

// ---------------------------------------------------------------------------
// Campaigns
// ---------------------------------------------------------------------------

export async function listCampaigns(): Promise<CampaignRow[]> {
  const result = await query<CampaignRow>(
    `SELECT oc.id, oc.name, oc.description, oc.status, oc.created_at, oc.updated_at,
       COUNT(DISTINCT os.id)::int AS target_count,
       COUNT(DISTINCT os.id) FILTER (WHERE EXISTS
         (SELECT 1 FROM outreach_events oe WHERE oe.outreach_state_id = os.id AND oe.event_type = 'sent'))::int AS sent_count,
       COUNT(DISTINCT os.id) FILTER (WHERE EXISTS
         (SELECT 1 FROM outreach_events oe WHERE oe.outreach_state_id = os.id AND oe.event_type = 'replied'))::int AS response_count
     FROM outreach_campaigns oc LEFT JOIN outreach_states os ON os.campaign_id = oc.id
     GROUP BY oc.id ORDER BY oc.created_at DESC`
  );
  return result.rows;
}

export async function getCampaign(id: string): Promise<CampaignRow | null> {
  return (await listCampaigns()).find(c => c.id === id) ?? null;
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
    'name', 'description', 'status',
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
            os.campaign_id, oc.name AS campaign_name, os.id AS outreach_state_id,
            presentation.pipeline_stage,
            COALESCE((SELECT MAX(event_order) FROM outreach_events oe
              WHERE oe.outreach_state_id = os.id), 0)::int AS event_version
     FROM outreach_states os
     JOIN contacts c ON c.id = os.contact_id
     LEFT JOIN outreach_campaigns oc ON oc.id = os.campaign_id
     LEFT JOIN contact_scores cs ON cs.contact_id = c.id
     ${OUTREACH_STAGE_JOIN_SQL}
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

/** Record a delivery event and transition the same campaign state atomically. */
export async function recordEventAndTransition(data: {
  contact_id: string;
  campaign_id: string;
  event_type: string;
  event_data?: Record<string, unknown>;
  state: string;
}): Promise<OutreachEventRow> {
  return transaction(async (client) => {
    // template_name is server-derived from the live template; never trust a caller's label.
    let eventData: Record<string, unknown> = { ...(data.event_data ?? {}) };
    delete eventData.template_name;
    if (typeof eventData.template_id === 'string') {
      // Share-lock the live row until the event commits. Deletion takes an
      // exclusive row lock, then snapshots all committed events before delete.
      const template = await client.query<{ name: string }>(
        'SELECT name FROM outreach_templates WHERE id = $1 FOR SHARE', [eventData.template_id]
      );
      if (!template.rows[0]) throw new TemplateUnavailableError();
      eventData = { ...eventData, template_name: template.rows[0].name };
    }
    const state = await client.query<{ id: string }>(
      `INSERT INTO outreach_states (contact_id, campaign_id, state, last_action_at)
       VALUES ($1, $2, 'not_started', now_utc())
       ON CONFLICT (contact_id, campaign_id) DO UPDATE
         SET state = outreach_states.state
       RETURNING id`,
      [data.contact_id, data.campaign_id]
    );
    const stateId = state.rows[0].id;
    const event = await client.query<OutreachEventRow>(
      `INSERT INTO outreach_events (outreach_state_id, event_type, event_data)
       VALUES ($1, $2, $3) RETURNING *`,
      [stateId, data.event_type, JSON.stringify(eventData)]
    );
    await client.query(
      `UPDATE outreach_states SET state = CASE
         WHEN $2 = 'opted_out' OR state = 'opted_out' THEN 'opted_out'
         WHEN state IN ('declined', 'bounced') THEN state
         WHEN $2 IN ('declined', 'bounced') THEN $2
         WHEN state = 'replied' OR $2 = 'replied' THEN 'replied'
         WHEN state = 'accepted' OR $2 = 'accepted' THEN 'accepted'
         WHEN state = 'opened' OR $2 = 'opened' THEN 'opened'
         WHEN state = 'sent' OR $2 = 'sent' THEN 'sent'
         WHEN state = 'queued' OR $2 = 'queued' THEN 'queued'
         ELSE 'not_started' END,
       last_action_at = now_utc()
       WHERE id = $1`, [stateId, data.state]
    );
    return event.rows[0];
  });
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
    total_meetings: number;
  }>
> {
  const result = await query<{
    template_id: string;
    template_name: string;
    total_sent: string;
    total_opened: string;
    total_replied: string;
    total_meetings: string;
  }>(
    `WITH tagged AS (
       SELECT oe.outreach_state_id, oe.event_type,
         CASE WHEN oe.event_data->>'template_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
           THEN (oe.event_data->>'template_id')::uuid ELSE NULL END AS template_id,
         CASE WHEN oe.event_data->>'template_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
           THEN NULLIF(oe.event_data->>'template_name', '') ELSE NULL END AS template_name
       FROM outreach_events oe
       WHERE oe.event_type IN ('sent', 'opened', 'replied', 'meeting_booked')
     )
     SELECT COALESCE(tagged.template_id::text, 'unattributed') AS template_id,
            COALESCE(MAX(ot.name), MAX(tagged.template_name),
              CASE WHEN tagged.template_id IS NULL THEN 'Unattributed events'
                ELSE 'Deleted template (' || tagged.template_id::text || ')' END) AS template_name,
            COUNT(DISTINCT tagged.outreach_state_id) FILTER (WHERE tagged.event_type = 'sent')::text AS total_sent,
            COUNT(DISTINCT tagged.outreach_state_id) FILTER (WHERE tagged.event_type = 'opened')::text AS total_opened,
            COUNT(DISTINCT tagged.outreach_state_id) FILTER (WHERE tagged.event_type = 'replied')::text AS total_replied,
            COUNT(DISTINCT tagged.outreach_state_id) FILTER (WHERE tagged.event_type = 'meeting_booked')::text AS total_meetings
     FROM tagged LEFT JOIN outreach_templates ot ON ot.id = tagged.template_id
     GROUP BY tagged.template_id ORDER BY template_name`
  );
  return result.rows.map((r) => ({
    template_id: r.template_id,
    template_name: r.template_name,
    total_sent: parseInt(r.total_sent, 10),
    total_opened: parseInt(r.total_opened, 10),
    total_replied: parseInt(r.total_replied, 10),
    total_meetings: parseInt(r.total_meetings, 10),
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
