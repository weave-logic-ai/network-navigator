# Architecture Decision Records

This directory is the permanent record of architectural decisions for the
Network Navigator codebase. ADRs are written in Michael Nygard's template
(Status / Context / Decision / Consequences / Alternatives considered /
Related).

New ADRs must be numbered sequentially. Superseded ADRs remain in place;
their status is updated to `Superseded by ADR-NNN`.

## Index

| ADR | Title | Status |
|-----|-------|--------|
| [ADR-027](./ADR-027-research-target-model.md) | Research target model — one self per owner, primary/secondary split, primary immutable for v1 | Accepted (2026-04-17) — Updated 2026-08-19: re-root param unwired, see file |
| [ADR-028](./ADR-028-chrome-permission-model.md) | Chrome permission model — curated host_permissions plus optional_host_permissions plus sidebar "Add host" button | Accepted (2026-04-17) — Updated 2026-08-19: opt-in hotkey and revoke UI unbuilt, see file |
| [ADR-029](./ADR-029-exochain-snippet-chain-scope.md) | ExoChain snippet chain_id scope — per target, kind-qualified | Accepted (2026-04-17) — Updated 2026-08-19: verify endpoint and tenant chain scheme unbuilt, see file |
| [ADR-030](./ADR-030-source-trust-composite-weight.md) | Source trust resolution — composite final_weight = category_default × per_item_multiplier | Accepted (2026-04-17) — Updated 2026-08-19: final_weight is write-time not query-time, formula partial, see file |
| [ADR-031](./ADR-031-parser-telemetry-retention.md) | Parser telemetry retention — 90-day raw plus daily aggregate | Accepted (2026-04-17) — Updated 2026-08-19: daily roll-up job never built, table permanently empty, see file |
| [ADR-032](./ADR-032-conflict-resolution-banner.md) | Conflict resolution UI — banner, not silent override | Accepted (2026-04-17) — Updated 2026-08-19: no audit trail on clear, no persisted dismiss state, no impulse trigger, see file |
| [ADR-033](./ADR-033-research-mode-rollout.md) | Research-mode rollout — per-user flag plus suggestion-engine nudge | **Superseded by ADR-035 (2026-08-19)** — never implemented; drift warning retained in file |
| [ADR-034](./ADR-034-per-component-harness-strategy.md) | Per-component harness strategy — scoring, CI, and the no-op-metric rule | Accepted (2026-08-18) |
| [ADR-035](./ADR-035-research-mode-gating-supersedes-033.md) | Research-mode gating is per-deployment, not per-user (supersedes ADR-033) | Accepted (2026-08-19) |

## Sprint grouping

ADR-027 through ADR-033 cover the **research-tools sprint** (Phase 0 decision
set); source planning under `.planning/research-tools-sprint/`, principally
`10-decisions.md` which consolidates the operator's answers to the ten open
questions in `09-open-questions.md`.

ADR-034 is not part of that sprint; it documents the CI/harness/scoring
architecture adopted for the repo as a whole.

**Caution on numbering**: MetaHarness/ruflo tooling emits its own upstream
references such as "OIA manifest (ADR-034)" in scan output — that is a
*different* project's ADR sequence (ruflo's), not this repo's. This
repo's ADR-034 is the one indexed above.

## Conventions

- **Numbering**: zero-padded to three digits. Next available: ADR-036.
- **File name**: `ADR-NNN-<kebab-slug>.md` matching the decision title.
- **Status values**: `Proposed`, `Accepted`, `Deprecated`, `Superseded by ADR-NNN`.
- **Dates**: ISO 8601 (YYYY-MM-DD) in the Status line.
- **Cross-links**: use relative links (`./ADR-NNN-…md`) so the index renders
  correctly in GitHub, VS Code, and static-site generators.
- **Source citations**: include line ranges in planning docs
  (`10-decisions.md` Q1, lines 8-23) so future readers can verify.
