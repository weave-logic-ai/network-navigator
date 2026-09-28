// Handler: notification
//
// Contract (unchanged, do not alter — parallel test agent depends on this shape):
//   executeNotification(impulse: Impulse, config: Record<string, unknown>)
//     => Promise<Record<string, unknown>>
//
// Behavior:
//   This codebase does not ship a dedicated notifications table (verified:
//   `grep -i notification data/db/init/*.sql` only returns impulse/extension
//   mentions, no CREATE TABLE notifications). Per instructions, we fall back
//   to inserting a row in the `tasks` table (task_type='notification') so the
//   user can see the message in the existing tasks UI.
//
//   Channels:
//     - 'log'  (default): console.log + tasks insert — always produces a
//       user-visible artifact.
//     - 'task': tasks insert only (no console spam in production).
//     - 'email':   deferred — no email provider wired up; returns without
//                  throwing so the dispatcher ack is 'success' with
//                  { sent: false, reason: 'not_implemented' }.
//     - 'webhook': deferred — webhook handler type exists separately in the
//                  dispatcher; this channel mirrors that and returns
//                  not_implemented.
//
// Deferred branches (documented for transparency):
//   - email / webhook fanout: deferred until a transport layer lands. They
//     still return gracefully so the dispatcher records a clean ack rather
//     than entering the dead-letter path.

import { transaction } from '../../../db/client';
import type { Impulse } from '../../types';

type Channel = 'log' | 'task' | 'email' | 'webhook';

export async function executeNotification(
  impulse: Impulse,
  config: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const channel = normalizeChannel(config.channel);
  const title = formatTitle(impulse);
  const body = formatBody(impulse);
  const priority = typeof config.priority === 'number' ? (config.priority as number) : 5;

  switch (channel) {
    case 'log': {
      // Always log AND persist so the user sees it in the tasks UI.
      console.log(`[notification] ${title} — ${body}`);
      const taskId = await persistAsTask(impulse, title, body, priority);
      return {
        sent: true,
        channel: 'log',
        title,
        taskId,
      };
    }

    case 'task': {
      const taskId = await persistAsTask(impulse, title, body, priority);
      return {
        sent: true,
        channel: 'task',
        title,
        taskId,
      };
    }

    case 'email': {
      // Deferred: no email transport. Still log + persist so the notification
      // is not lost.
      console.log(`[notification] (email deferred) ${title} — ${body}`);
      const taskId = await persistAsTask(impulse, title, body, priority);
      return {
        sent: false,
        channel: 'email',
        reason: 'not_implemented',
        taskId,
      };
    }

    case 'webhook': {
      // Deferred: the dispatcher has a separate 'webhook' handler_type which
      // is the proper place for HTTP fanout. Returning deferred here.
      console.log(`[notification] (webhook deferred) ${title} — ${body}`);
      const taskId = await persistAsTask(impulse, title, body, priority);
      return {
        sent: false,
        channel: 'webhook',
        reason: 'not_implemented',
        taskId,
      };
    }
  }
}

function normalizeChannel(raw: unknown): Channel {
  if (typeof raw !== 'string') return 'log';
  const lower = raw.toLowerCase();
  if (lower === 'log' || lower === 'task' || lower === 'email' || lower === 'webhook') {
    return lower;
  }
  return 'log';
}

async function persistAsTask(
  impulse: Impulse,
  title: string,
  body: string,
  priority: number
): Promise<string | null> {
  const contactId = isUuid(impulse.sourceEntityId) ? impulse.sourceEntityId : null;

  const metadata = JSON.stringify({
    impulseId: impulse.id,
    impulseType: impulse.impulseType,
    sourceEntityType: impulse.sourceEntityType,
    sourceEntityId: impulse.sourceEntityId,
    payload: impulse.payload,
  });

  return transaction(async client => {
    // The impulse row serializes concurrent retries of this same delivery.
    const locked = await client.query('SELECT id FROM impulses WHERE id = $1 FOR UPDATE', [impulse.id]);
    if (locked.rows.length === 0) throw new Error(`Impulse not found: ${impulse.id}`);
    const existing = await client.query<{ task_id: string | null }>(
      'SELECT task_id FROM impulse_notification_tasks WHERE impulse_id = $1', [impulse.id]
    );
    if (existing.rows[0]) return existing.rows[0].task_id;
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO tasks (title, description, task_type, status, priority, contact_id, source, metadata)
       VALUES ($1, $2, 'notification', 'pending', $3, $4, 'impulse', $5::jsonb)
       RETURNING id`,
      [title, body, priority, contactId, metadata]
    );
    const taskId = inserted.rows[0].id;
    await client.query(
      'INSERT INTO impulse_notification_tasks (impulse_id, task_id) VALUES ($1, $2)',
      [impulse.id, taskId]
    );
    return taskId;
  });
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function formatTitle(impulse: Impulse): string {
  const payload = impulse.payload;
  switch (impulse.impulseType) {
    case 'tier_changed':
      return `Tier changed: ${stringOr(payload.from, '?')} → ${stringOr(payload.to, '?')}`;
    case 'persona_assigned':
      return `Persona assigned: ${stringOr(payload.to, '?')}`;
    case 'score_computed':
      return `Score computed (${stringOr(payload.tier, 'unscored')})`;
    case 'enrichment_complete':
      return `Enrichment complete`;
    case 'contact_created':
      return `New contact added`;
    case 'edge_created':
      return `New relationship edge`;
    default:
      return `Impulse: ${impulse.impulseType}`;
  }
}

function formatBody(impulse: Impulse): string {
  const payload = impulse.payload;
  switch (impulse.impulseType) {
    case 'tier_changed':
      return `Contact ${impulse.sourceEntityId} moved from ${stringOr(payload.from, '?')} to ${stringOr(payload.to, '?')} tier.`;
    case 'persona_assigned':
      return `Contact ${impulse.sourceEntityId} assigned persona: ${stringOr(payload.to, '?')}.`;
    case 'score_computed':
      return `Contact ${impulse.sourceEntityId} scored ${stringOr(payload.composite, '?')} (${stringOr(payload.tier, 'unscored')}).`;
    case 'enrichment_complete':
      return `Contact ${impulse.sourceEntityId} enrichment complete: ${stringOr(payload.fieldsFound, '0')} fields.`;
    default:
      return `Impulse ${impulse.impulseType} for ${impulse.sourceEntityType}:${impulse.sourceEntityId}.`;
  }
}

function stringOr(value: unknown, fallback: string): string {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return fallback;
}
