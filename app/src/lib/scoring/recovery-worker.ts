import { ECC_FLAGS } from '../ecc/types';
import { drainPendingScoringImpulses } from './transition-writer';
import { drainPendingImportScoreJobs } from './import-job';

const RECOVERY_INTERVAL_MS = 30_000;
const workerState = globalThis as typeof globalThis & {
  __scoreImpulseRecovery?: { timer: ReturnType<typeof setInterval>; running: boolean };
};

/** Recover committed import jobs and impulses once per Node process. */
export function startScoringImpulseRecovery(): void {
  if (workerState.__scoreImpulseRecovery) return;
  const state = { timer: undefined as unknown as ReturnType<typeof setInterval>, running: false };
  const sweep = async () => {
    if (state.running) return;
    state.running = true;
    try {
      try {
        await drainPendingImportScoreJobs(2, 25);
      } catch (error) {
        console.error('[scoring] Import recovery sweep failed', error);
      }
      if (ECC_FLAGS.impulses) await drainPendingScoringImpulses(10, 50);
    } catch (error) {
      console.error('[scoring] Impulse recovery sweep failed', error);
    } finally {
      state.running = false;
    }
  };
  state.timer = setInterval(() => { void sweep(); }, RECOVERY_INTERVAL_MS);
  state.timer.unref?.();
  workerState.__scoreImpulseRecovery = state;
  void sweep();
}
