-- ADR-032 correction (2026-08-19 update note, item 2): the Neutral section
-- promised a per-user, per-target, per-field `banner_state` row server-side
-- for the main app so a dismissed conflict banner survives a page reload.
-- No such table existed — `SourceConflictBanner`
-- (app/src/components/targets/source-conflict-banner.tsx) tracked dismissal
-- in an in-memory `useState<Set<string>>` only, lost on every refresh.
--
-- This table makes dismissal durable and gives it the exact re-trigger
-- semantics ADR-032's Negative/Consequences section describes as the
-- fatigue mitigation ("banners only re-appear on a new source arrival, not
-- on every page load"): each dismissal is stamped with a fingerprint of the
-- conflicting-candidate set at dismiss time
-- (`conflict_fingerprint` — sorted candidate values, joined). The banner
-- treats a field as dismissed only while the *current* conflict's
-- fingerprint still matches; once a new source changes the candidate set,
-- the fingerprint no longer matches and the banner reappears even though
-- the old dismissal row is still there. This turns the ADR's previously
-- "accidental" re-show-on-every-reload behavior into a deliberate,
-- content-addressed one.
--
-- Uniqueness is scoped to (tenant_id, target_id, field_name) — NOT
-- per-user — matching the precedent already set by
-- `source_field_overrides` (045-source-field-overrides.sql), whose active-
-- override uniqueness is also tenant+entity+field only despite recording
-- `set_by_user_id` for provenance. This app's ownership model is a single
-- "current" owner_profiles row per tenant (see
-- `getCurrentOwnerProfileId()` in lib/targets/service.ts), so a stricter
-- per-user partition would add a dimension nothing else in the schema
-- currently uses. `user_id` is still recorded on every row for audit /
-- future multi-user support.

CREATE TABLE IF NOT EXISTS banner_state (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             UUID NOT NULL REFERENCES tenants(id),
  target_id             UUID NOT NULL REFERENCES research_targets(id) ON DELETE CASCADE,
  field_name            TEXT NOT NULL,
  conflict_fingerprint  TEXT NOT NULL,
  dismissed_by_user_id  UUID,
  dismissed_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One dismissal row per (tenant, target, field) — a fresh dismiss upserts
-- over the previous one (new fingerprint, new timestamp) rather than
-- accumulating history. Unlike source_field_overrides this state has no
-- audit-history requirement of its own; the causal_nodes trail (ADR-032
-- gap 1 fix) is where override provenance lives.
CREATE UNIQUE INDEX IF NOT EXISTS uq_banner_state_dismissal
  ON banner_state (tenant_id, target_id, field_name);
