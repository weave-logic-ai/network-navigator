import { ECC_FLAGS } from '../types';
import { emitImpulse } from './emitter';
import type { CompositeScore } from '../../scoring/types';

const DEFAULT_TENANT_ID = 'default';

/**
 * Emit impulses based on scoring state changes.
 * Called after a contact's score is computed and saved.
 */
export async function emitScoringImpulses(
  contactId: string,
  oldScore: CompositeScore | null,
  newScore: CompositeScore,
  tenantId: string = DEFAULT_TENANT_ID
): Promise<void> {
  if (!ECC_FLAGS.impulses) return;

  // Always emit score_computed
  await emitImpulse(tenantId, 'score_computed', 'contact', contactId, {
    composite: newScore.compositeScore,
    tier: newScore.tier,
    persona: newScore.persona,
    behavioralPersona: newScore.behavioralPersona,
    referralPersona: newScore.referralPersona,
  });

  // Emit tier_changed if tier differs
  if (oldScore && oldScore.tier !== newScore.tier) {
    await emitImpulse(tenantId, 'tier_changed', 'contact', contactId, {
      from: oldScore.tier,
      to: newScore.tier,
      composite: newScore.compositeScore,
    });
  }

  // Emit persona_assigned if persona differs
  if (oldScore && oldScore.persona !== newScore.persona) {
    await emitImpulse(tenantId, 'persona_assigned', 'contact', contactId, {
      from: oldScore.persona,
      to: newScore.persona,
    });
  }
}
