# Phase 1 — WS-4: Impulse System

**Completed**: 2026-03-24
**Agent**: ws4-impulses

## Files Created

| File | Purpose |
|------|---------|
| `app/src/lib/ecc/impulses/types.ts` | EmitImpulseParams, HandlerExecutionResult, DispatchResult |
| `app/src/lib/ecc/impulses/emitter.ts` | emitImpulse (sync insert + async dispatch), emitImpulses (batch) |
| `app/src/lib/ecc/impulses/dispatcher.ts` | dispatchImpulse: loads handlers, executes with 5s timeout, records acks, dead letter after 3 failures |
| `app/src/lib/ecc/impulses/handlers/task-generator.ts` | Migrated task-triggers logic: tier_changed → gold task, persona_assigned → buyer task, score_computed → referral/connector tasks |
| `app/src/lib/ecc/impulses/handlers/campaign-enroller.ts` | Stub: reads campaign_id from config, creates outreach_states enrollment |
| `app/src/lib/ecc/impulses/handlers/notification.ts` | Stub: log channel (console), email/webhook placeholders |
| `app/src/lib/ecc/impulses/scoring-adapter.ts` | emitScoringImpulses: called post-score, emits score_computed + conditional tier_changed/persona_assigned |

## Files Modified

| File | Change |
|------|--------|
| `app/src/lib/scoring/task-triggers.ts` | Added ECC_IMPULSES_ENABLED guard; early return when impulse system active |

## Decisions Made

- Task-generator handler uses `source = 'impulse'` (vs `'auto-score'` for old path) — both can coexist
- Handler timeout is 5 seconds (configurable via constant)
- Dead letter: auto-disable after 3 failures within 1 hour
- Campaign enroller checks outreach_states for existing enrollment
- Notification handler is log-only for v1

## Known Issues

- Uses hardcoded `DEFAULT_TENANT_ID = 'default'` in scoring-adapter
- Campaign enroller assumes outreach_states table schema — needs verification
- No webhook handler implementation yet (returns skipped)

## Acceptance Status

- [x] Impulse emitter with sync insert + async dispatch
- [x] Dispatcher with per-handler error isolation
- [x] Task-generator handler migrated from task-triggers
- [x] Campaign enroller stub
- [x] Notification stub
- [x] Scoring adapter emits tier_changed/persona_assigned
- [x] Old task-triggers bypassed when ECC_IMPULSES=true
- [x] Dead letter auto-disable
