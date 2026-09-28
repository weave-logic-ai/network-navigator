/** Next.js invokes register once when its Node server starts. */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { startScoringImpulseRecovery } = await import('./lib/scoring/recovery-worker');
    startScoringImpulseRecovery();
  }
}
