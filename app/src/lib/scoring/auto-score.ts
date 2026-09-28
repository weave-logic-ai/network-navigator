// Auto-scoring hooks — fire-and-forget scoring triggers
// Called from enrichment, import, and extension capture endpoints.

import { assertOwnerBaseline, captureOwnerScoringBasis, scoreContact } from './pipeline';
import * as scoringQueries from '../db/queries/scoring';

/**
 * Trigger scoring for a contact in the background.
 * Does not block the caller. Errors are logged but don't propagate.
 */
export function triggerAutoScore(contactId: string): void {
  scoreContact(contactId).catch((err) => {
    console.error(`[auto-score] Failed to score contact ${contactId}:`, err);
  });
}

/**
 * Trigger scoring for multiple contacts in the background.
 */
export function triggerBatchAutoScore(contactIds: string[]): void {
  if (contactIds.length === 0) return;
  // Capture once so an import run cannot mix owner settings across contacts.
  const CONCURRENCY = 5;
  (async () => {
    const basis = await captureOwnerScoringBasis();
    let idx = 0;
    async function next(): Promise<void> {
      while (idx < contactIds.length) {
        const id = contactIds[idx++];
        try {
          await scoreContact(id, undefined, undefined, basis);
        } catch (err) {
          console.error(`[auto-score] Failed to score contact ${id}:`, err);
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, contactIds.length) }, () => next()));
  })().catch((err) => {
    console.error('[auto-score] Batch scoring failed:', err);
  });
}

/**
 * Trigger a full rescore of all contacts in the background.
 * Creates a scoring_run record and updates progress.
 * Returns the run ID for status polling.
 *
 * Only the owner baseline may be persisted by a full rescore.
 */
export async function triggerRescoreAll(targetId?: string): Promise<string> {
  assertOwnerBaseline(targetId);
  const contactIds = await scoringQueries.getAllContactIds();
  const basis = await captureOwnerScoringBasis();
  const runId = await scoringQueries.createScoringRun('rescore-all', contactIds.length);

  // Run in background
  (async () => {
    let scored = 0;
    let failed = 0;

    for (const id of contactIds) {
      try {
        await scoreContact(id, undefined, undefined, basis);
        scored++;
      } catch (err) {
        failed++;
        console.error(`[rescore-all] Failed to score ${id}:`, err);
      }

      // Update progress every 10 contacts
      if ((scored + failed) % 10 === 0 || scored + failed === contactIds.length) {
        await scoringQueries.updateScoringRun(runId, {
          scoredContacts: scored,
          failedContacts: failed,
        }).catch(() => {});
      }
    }

    await scoringQueries.updateScoringRun(runId, {
      scoredContacts: scored,
      failedContacts: failed,
      status: failed > 0 && scored === 0 ? 'failed' : 'completed',
    }).catch(() => {});
  })();

  return runId;
}
