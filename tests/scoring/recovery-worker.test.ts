jest.mock('@/lib/scoring/transition-writer', () => ({ drainPendingScoringImpulses: jest.fn() }));
jest.mock('@/lib/scoring/import-job', () => ({ drainPendingImportScoreJobs: jest.fn() }));

import { ECC_FLAGS } from '@/lib/ecc/types';
import { drainPendingScoringImpulses } from '@/lib/scoring/transition-writer';
import { drainPendingImportScoreJobs } from '@/lib/scoring/import-job';
import { startScoringImpulseRecovery } from '@/lib/scoring/recovery-worker';

const state = globalThis as typeof globalThis & {
  __scoreImpulseRecovery?: { timer: ReturnType<typeof setInterval>; running: boolean };
};

describe('scoring impulse startup recovery', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    (drainPendingScoringImpulses as jest.Mock).mockReset();
    (drainPendingImportScoreJobs as jest.Mock).mockReset().mockResolvedValue(0);
    ECC_FLAGS.impulses = true;
  });

  afterEach(() => {
    if (state.__scoreImpulseRecovery) clearInterval(state.__scoreImpulseRecovery.timer);
    delete state.__scoreImpulseRecovery;
    ECC_FLAGS.impulses = false;
    jest.useRealTimers();
  });

  it('starts immediately, bounds each pass, and never overlaps a slow pass', async () => {
    let release!: () => void;
    (drainPendingScoringImpulses as jest.Mock)
      .mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve; }))
      .mockResolvedValue(0);
    startScoringImpulseRecovery();
    startScoringImpulseRecovery();
    await Promise.resolve();
    expect(drainPendingScoringImpulses).toHaveBeenCalledTimes(1);
    expect(drainPendingScoringImpulses).toHaveBeenCalledWith(10, 50);
    jest.advanceTimersByTime(60_000);
    expect(drainPendingScoringImpulses).toHaveBeenCalledTimes(1);
    release();
    await Promise.resolve();
    await Promise.resolve();
    jest.advanceTimersByTime(30_000);
    await Promise.resolve();
    expect(drainPendingScoringImpulses).toHaveBeenCalledTimes(2);
  });

  it('recovers import jobs even when scoring impulses are disabled', async () => {
    ECC_FLAGS.impulses = false;
    startScoringImpulseRecovery();
    await Promise.resolve();
    expect(drainPendingImportScoreJobs).toHaveBeenCalledWith(2, 25);
    expect(drainPendingScoringImpulses).not.toHaveBeenCalled();
  });
});
