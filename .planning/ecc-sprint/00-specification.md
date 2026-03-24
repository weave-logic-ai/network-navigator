# ECC Sprint — Specification

**Date**: 2026-03-24
**Sprint Goal**: Layer WeftOS/ECC cognitive substrate onto NetworkNav's existing PostgreSQL + Next.js architecture
**Reference Implementations**: mentra (CMVG/DEMOCRITUS), clawstage (5-engine polyglot ensemble)

---

## Problem Statement

NetworkNav is a working LinkedIn prospecting platform with 25+ tables, 90+ API routes, 9-dimension scoring, 7-provider enrichment waterfall, graph analytics, and a Chrome extension. It has the data — but lacks the cognitive substrate that transforms a static database into a living intelligence system.

**Seven gaps identified in the ECC Symposium + taxonomy audit**:

| Gap | Current State | Impact |
|-----|--------------|--------|
| Scoring is a black box | Numbers without explanation | Users can't trust or tune scores |
| Enrichment decisions opaque | Provider/cost recorded, logic hidden | No learning from enrichment outcomes |
| Event chaining is inline | Fire-and-forget triggers | Hard to extend automation |
| Claude integration stateless | Each call independent | No research session continuity |
| RVF feedback loop open | Pairwise comparisons stored, unused | Scores never improve from outcomes |
| No temporal tracking | Snapshots only | Can't trace how a contact's profile evolved |
| **ICP/Niche taxonomy broken** | No vertical hierarchy; duplicate ICPs on every discover call; niche has flat `industry` text with no FK; tenant migrations reference nonexistent tables (`icp_configs` vs `icp_profiles`) | Scoring targets wrong profiles; niche is unusable; data model inconsistent |

## Scope

### In Scope (This Sprint)

1. **CausalGraph for Scoring Provenance** (HIGH priority)
   - Trace every dimension contribution through composite scoring
   - Enable counterfactual queries ("what if ICP weight was 0.3 instead of 0.2?")
   - Adapted from: mentra's DEMOCRITUS sparse causal graph + clawstage's typed CausalEdge

2. **ExoChain for Enrichment Audit Trail** (HIGH priority)
   - Append-only, hash-linked event log for enrichment decisions
   - Chain: budget check → provider selection → field coverage → outcome
   - Adapted from: mentra's SHAKE-256 + Ed25519 ExoChain, clawstage's ScoredWitnessEntry

3. **Impulse System for Decoupled Automation** (HIGH priority)
   - Replace inline tier-transition → task-generation with impulse-driven event chains
   - Enable: score change → impulse → task creation → campaign enrollment → notification
   - Adapted from: clawstage's 12 impulse types with HLC ordering

4. **CognitiveTick for Research Sessions** (MEDIUM priority)
   - Stateful Claude integration with conversation memory across research sessions
   - Track researcher intent (ICP focus shifts) across API calls
   - Adapted from: mentra's 50ms tick (relaxed to request-driven for web context)

5. **CrossRefs for Typed Entity Relationships** (MEDIUM priority)
   - Annotate edges with semantic context (co-worker, referrer, shared-company, mutual-connection)
   - Enable "why are these people related?" queries beyond raw SQL JOINs
   - Adapted from: clawstage's bidirectional CrossRef store with engine-tag filtering

6. **Vertical→Niche→ICP→Offering Taxonomy Fix** (HIGH priority — prerequisite for scoring)
   - Introduce `verticals` table as top-level market taxonomy
   - Niche becomes a focused subset of a vertical (`vertical_id` FK replaces flat `industry` text)
   - ICP belongs to a niche (`niche_id` FK replaces standalone profiles)
   - Fix ICP discovery to de-duplicate against existing profiles before creating
   - Fix tenant migration table names (`icp_configs`→`icp_profiles`, `niche_configs`→`niche_profiles`, `offering_configs`→`offerings`)
   - Offering many-to-many stays at ICP level (via `icp_offerings`)

### Out of Scope (Future Sprints)

- HNSW-based semantic ICP matching (requires embedding pipeline)
- Real-time WebSocket presence / collaboration
- Specialized agent team (research, scoring, outreach, engagement, relationship)
- SCEN engine (outreach lifecycle as dramatic arc)
- EMOT engine (relationship warmth as VAD model)
- RVF container format (binary persistence — stay with PostgreSQL)
- Quantum-ready cryptography (ML-KEM)
- Multi-device distributed consensus

## Requirements

### Functional

**FR-1**: Score any contact and receive a CausalGraph trace alongside the numeric score
- Input: contact_id
- Output: CompositeScore + CausalNode[] with typed edges showing dimension → composite flow
- Counterfactual: re-score with modified weights, diff the causal graphs

**FR-2**: Enrich any contact and receive an ExoChain audit trail
- Input: contact_id + target fields
- Output: EnrichmentResult + ExoChainEntry[] showing each decision point
- Replay: given the same inputs, produce identical chain

**FR-3**: Score changes emit Impulses consumed by decoupled handlers
- Tier transition (e.g., silver → gold) emits `TierChanged` impulse
- Persona assignment emits `PersonaAssigned` impulse
- Handlers: task generation, campaign enrollment, notification (independently subscribable)

**FR-4**: Claude API calls maintain session context via CognitiveTick
- Session tracks: researcher intent, accumulated evidence, ICP focus, contact list
- Context survives across multiple API calls within a research session
- Session can be resumed after interruption

**FR-5**: Vertical→Niche→ICP→Offering hierarchy enforced in schema and code
- `verticals` table: name, description, slug (UNIQUE)
- `niche_profiles.vertical_id` FK replaces `niche_profiles.industry` text
- `icp_profiles.niche_id` FK links ICP to its parent niche
- ICP discovery checks `(name, niche_id)` uniqueness before creating
- Scoring pipeline resolves ICP via: active ICP → parent niche → parent vertical
- Offering association stays at ICP level (`icp_offerings`)
- Example hierarchy: Healthcare (vertical) → Hospital IT Modernization (niche) → CISO at mid-market hospitals (ICP) → Fractional CTO (offering)

**FR-6**: Edges carry CrossRef annotations with typed context
- Types: co-worker, referrer, shared-company, mutual-connection, reported-to, invested-in
- Bidirectional: query from either side
- Source attribution: which enrichment provider or user action created this relationship

### Non-Functional

**NFR-1**: CausalGraph adds <50ms to scoring pipeline (currently ~200ms for full score)
**NFR-2**: ExoChain entries stored in PostgreSQL (no separate storage system)
**NFR-3**: Impulse dispatch <10ms; handler execution async (no scoring latency impact)
**NFR-4**: All new tables tenant-scoped with RLS policies
**NFR-5**: Zero breaking changes to existing API contracts (additive only)
**NFR-6**: All causal data queryable via SQL (no opaque binary formats)

## Success Criteria

1. Score a contact → receive explainable causal trace with dimension attributions
2. Enrich a contact → receive hash-linked audit trail of every provider decision
3. Score crosses tier boundary → impulse fires → task auto-created (decoupled)
4. Two Claude analyze calls in same session → second call has context from first
5. Query "why are contact A and B related?" → get typed CrossRef with source attribution

## Domain Model (from existing codebase)

```
Vertical (name, slug, description)                    [NEW — top-level taxonomy]
  └─ Niche (vertical_id FK, name, affordability/fitability/buildability)  [FIX — add vertical_id]
       └─ ICP (niche_id FK, name, criteria, weight_overrides)             [FIX — add niche_id]
            └─ Offering (name, description)  via icp_offerings M:M

Contact ──scores──→ ContactScore (composite, tier, persona)
    │                    └── ScoreDimension[] (9 dims + 6 referral)
    │                    └── ContactIcpFit[] (icp_profile_id, fit_score, breakdown)
    │
    ├──enrichments──→ PersonEnrichment[] (provider, cost, fields)
    │
    ├──edges──→ Edge[] (source, target, type, weight)
    │              └── [NEW] CrossRef (relation_type, context, source_attribution)
    │
    ├──observations──→ BehavioralObservation[]
    │
    └──outreach──→ OutreachState (campaign, sequence, step, state)

[NEW] CausalNode (id, entity_type, entity_id, operation, inputs, output, timestamp)
[NEW] CausalEdge (source_node, target_node, relation, weight)
[NEW] ExoChainEntry (id, prev_hash, entry_hash, operation, data, actor, timestamp)
[NEW] Impulse (id, type, source_entity, payload, timestamp, acknowledged_by[])
[NEW] ResearchSession (id, tenant_id, intent, context, messages[], created/updated_at)
```

## Constraints

- PostgreSQL is the sole persistence layer (no Redis, no separate graph DB)
- All new tables must have `tenant_id` + RLS policies (existing pattern from 020-023 migrations)
- Chrome extension changes must maintain MV3 compatibility
- No new npm dependencies >50KB gzipped without justification
- Existing scoring/enrichment APIs must remain backward-compatible
