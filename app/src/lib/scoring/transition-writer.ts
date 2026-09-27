// Owner-score impulses are committed with the score, then dispatched in
// per-contact revision order. Pending rows survive a process interruption.

import type { PoolClient } from 'pg';
import { getPool } from '../db/client';
import { ECC_FLAGS } from '../ecc/types';
import { dispatchImpulse } from '../ecc/impulses/dispatcher';
import type { CompositeScore } from './types';

type ScoringImpulse = {
  type: 'score_computed' | 'tier_changed' | 'persona_assigned';
  payload: Record<string, unknown>;
};

export async function recordScoringImpulses(
  client: PoolClient,
  contactId: string,
  previous: CompositeScore | null,
  score: CompositeScore,
  revision: number
): Promise<void> {
  if (!ECC_FLAGS.impulses) return;
  const tenant = await client.query<{ id: string }>("SELECT id FROM tenants WHERE slug = 'default' LIMIT 1");
  if (!tenant.rows[0]) throw new Error('Default tenant is missing for scoring impulses');
  const events: ScoringImpulse[] = [{
    type: 'score_computed',
    payload: {
      composite: score.compositeScore, tier: score.tier, persona: score.persona,
      behavioralPersona: score.behavioralPersona, referralPersona: score.referralPersona,
      scoreTasksCommitted: true,
    },
  }];
  if (previous && previous.tier !== score.tier) {
    events.push({ type: 'tier_changed', payload: {
      from: previous.tier, to: score.tier, composite: score.compositeScore,
      scoreTasksCommitted: true,
    } });
  }
  if (previous && previous.persona !== score.persona) {
    events.push({ type: 'persona_assigned', payload: {
      from: previous.persona, to: score.persona,
      scoreTasksCommitted: true,
    } });
  }
  for (const [order, event] of events.entries()) {
    await client.query(
      `INSERT INTO impulses
         (tenant_id, impulse_type, source_entity_type, source_entity_id, payload,
          score_revision, score_event_order)
       VALUES ($1, $2, 'contact', $3, $4, $5, $6)`,
      [tenant.rows[0].id, event.type, contactId, JSON.stringify(event.payload), revision, order]
    );
  }
}

/** Dispatch all committed scoring impulses for a contact, oldest first. */
export async function drainScoringImpulses(contactId: string, maxEvents = 50): Promise<void> {
  if (!ECC_FLAGS.impulses) return;
  const client = await getPool().connect();
  try {
    // Session lock spans handler calls on other connections. The pending query
    // runs after lock acquisition, so a later scorer cannot overtake an older
    // committed transition even if it reaches this function first.
    await client.query('SELECT pg_advisory_lock(580058, hashtext($1))', [contactId]);
    try {
      const pending = await client.query<{ id: string }>(
        `SELECT id FROM impulses
         WHERE source_entity_type = 'contact' AND source_entity_id = $1
           AND score_revision IS NOT NULL AND score_dispatched_at IS NULL
         ORDER BY score_revision, score_event_order LIMIT $2`, [contactId, maxEvents]
      );
      for (const row of pending.rows) {
        const result = await dispatchImpulse(row.id);
        if (result.results.some(handler => handler.status === 'failed')) {
          throw new Error(`Scoring impulse ${row.id} has a failed handler`);
        }
        await client.query('UPDATE impulses SET score_dispatched_at = NOW() WHERE id = $1', [row.id]);
      }
    } finally {
      await client.query('SELECT pg_advisory_unlock(580058, hashtext($1))', [contactId]);
    }
  } finally {
    client.release();
  }
}

/** Bounded recovery pass over contacts with committed, undispatched scores. */
export async function drainPendingScoringImpulses(maxContacts = 10, maxEvents = 50): Promise<number> {
  if (!ECC_FLAGS.impulses) return 0;
  const limit = Math.max(1, Math.min(maxContacts, 50));
  const pending = await getPool().query<{ source_entity_id: string }>(
    `SELECT source_entity_id FROM impulses
     WHERE source_entity_type = 'contact' AND score_revision IS NOT NULL
       AND score_dispatched_at IS NULL
     ORDER BY COALESCE(score_last_attempt_at, created_at), id LIMIT $1`, [limit]
  );
  const contacts = [...new Set(pending.rows.map(row => row.source_entity_id))];
  for (const contactId of contacts) {
    try {
      // Rotate failed contacts behind still-untried ones; otherwise the
      // oldest failed contacts could monopolize every bounded sweep.
      await getPool().query(
        `UPDATE impulses SET score_last_attempt_at = NOW()
         WHERE source_entity_type = 'contact' AND source_entity_id = $1
           AND score_revision IS NOT NULL AND score_dispatched_at IS NULL`,
        [contactId]
      );
      await drainScoringImpulses(contactId, Math.max(1, Math.min(maxEvents, 50)));
    } catch (error) {
      console.error('[scoring] Pending impulse recovery deferred', {
        contactId, error,
      });
    }
  }
  return contacts.length;
}
