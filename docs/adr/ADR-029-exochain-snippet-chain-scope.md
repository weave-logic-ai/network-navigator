# ADR-029: ExoChain snippet chain_id scope — per target, kind-qualified

**Status**: Accepted (date: 2026-04-17) — **Updated: 2026-08-19**

> **Update 2026-08-19**: Three corrections verified against code and
> migrations.
> 1. The Neutral section's claim "no schema migration is needed" for the
>    TEXT `chain_id` was wrong even at the time it was written:
>    `data/db/init/026-ecc-exo-chain.sql` declared `chain_id` as `UUID`, and
>    `data/db/init/038-exo-chain-text-chain-id.sql` was in fact required to
>    widen it to `TEXT` (`ALTER TABLE exo_chain_entries ALTER COLUMN
>    chain_id TYPE TEXT USING chain_id::TEXT`) before this ADR's namespaced
>    string form (`snippet:contact:<uuid>`, `source:<tenant_id>`, etc.)
>    could be stored at all.
> 2. `GET /api/ecc/exo-chain/verify/:chainId`, named in the Neutral section
>    as forthcoming, is unbuilt — no `app/src/app/api/ecc/exo-chain/`
>    directory exists anywhere in the app. The only chain-adjacent route is
>    `app/src/app/api/enrichment/chain/[chainId]/route.ts`.
> 3. The per-tenant `source:<tenant_id>` chain scheme this ADR treats as an
>    existing, out-of-scope sibling ("Source-fetch events use `chain_id =
>    'source:<tenant_id>'`") is unbuilt — that chain_id form does not occur
>    anywhere in `app/src/lib`.

## Context

The ECC sprint gave the app an append-only hash-linked event log
(`exo_chain_entries`, `026-ecc-exo-chain.sql`) that groups entries by
`chain_id`. Each chain is independently verifiable: re-hashing its sequence
must match the recorded hashes or the chain is tampered.

`06-evidence-and-provenance.md` §5 proposes grouping snippet-save entries by
target so a tenant can ask "is Acme's snippet record intact?" rather than only
"is any snippet anywhere intact?" Three chain boundaries were considered
(`09-open-questions.md` Q3, lines 62-88):

- **A**: per-target chain (`snippet:<target_id>`).
- **B**: per-tenant chain (one chain for the whole tenant's snippets).
- **C**: per-session chain (chain lifetime = research session lifetime).

The operator confirmed per-target and added that targets include companies as
well as contacts:

> "On chains, I would assume it's per user. On question three, you've got that
> boundary sitting at the edge of the user, so when you do a snippet and you're
> grabbing it, it would be across or attached to that user's chain. It's also
> possible that it would be attached to a company's chain, so I think we've
> got both users and companies. Per target, I think." (`10-decisions.md` Q3,
> lines 55-57)

## Decision

Chain scope is per-target AND kind-qualified. The `chain_id` for a snippet is
formed at write time:

```
chain_id = 'snippet:' + target.kind + ':' + target.id
```

Examples (`10-decisions.md` Q3, lines 59-65):

- `snippet:contact:a8f2-…` — a snippet captured about a contact target
- `snippet:company:de91-…` — a snippet captured about a company target
- `snippet:self:<owner_id>` — a snippet the user takes about themselves
  (rare but supported)

`kind` values are `self | contact | company`, matching `research_targets.kind`
(ADR-027). `chain_id` is generated at insert time in the snippet service
(`app/src/lib/snippets/service.ts`) and not precomputed on the target row.

Non-snippet chains are out of scope for this ADR:

- ~~Source-fetch events use `chain_id = 'source:<tenant_id>'` per
  `06-evidence-and-provenance.md` §5.1 (one chain per tenant, not per
  target).~~ **Not implemented (2026-08-19)**: this chain_id form does not
  occur anywhere in `app/src/lib`. See the update note at the top of this
  file.
- Scoring and enrichment chains remain as the existing ECC adapters define
  them.

## Consequences

### Positive

- **Directly-answerable audit question**: "has anyone altered an Acme
  snippet?" → verify the single chain `snippet:company:<acme-id>`. One
  verification call, bounded sequence, clear result.
- **Write contention bounded by target activity**. Each target's snippet chain
  serializes its own appends but chains are independent across targets. A
  tenant researching many targets in parallel does not serialize against a
  single tenant-wide chain.
  (`06-evidence-and-provenance.md` §5.1, lines 82-86)
- **Kind-qualification future-proofs the space**. If a new `research_targets`
  kind is added (e.g. `event`, `document`), its snippet chain_id form is
  obvious and collision-free.
- **Cross-target verification is still possible** — just run multiple chain
  verifications and join. The UI admin page can display a list.

### Negative

- A snippet is bound to the target that was active at capture time. If the
  user re-attributes a snippet to a different target later, the chain it
  lives on does not change — and cannot (appending to a different chain
  would break the original). We treat re-attribution as a separate edit
  (`snippet` entity, `operation='edited'`) on the original chain, not a
  migration of entries between chains.
- No single "snippet verification" per tenant. A tenant-wide "are all my
  snippets clean" is a fan-out over every `snippet:*:*` chain. Admin UI
  must iterate; acceptable given chain counts are O(number of researched
  targets) per tenant.
- Self-target snippet chains (`snippet:self:<owner_id>`) create a chain that
  is often nearly empty. Accepted — an empty or one-entry chain still
  verifies trivially.

### Neutral

- ~~`exo_chain_entries.chain_id` remains a TEXT column; no schema migration
  is needed to support the new format.~~ **Correction 2026-08-19**: the
  column started as `UUID` (`026-ecc-exo-chain.sql`) and migration
  `038-exo-chain-text-chain-id.sql` was required to widen it to `TEXT`
  before this ADR's format could be stored. See the update note at the top
  of this file.
- ~~The existing `GET /api/enrichment/chain/:chainId` endpoint works unchanged.
  A new `GET /api/ecc/exo-chain/verify/:chainId` (`06-evidence-and-provenance.md`
  §5.3) will accept any chain_id — snippet chains included.~~ **Not
  implemented (2026-08-19)**: no `verify/:chainId` endpoint exists. See the
  update note at the top of this file.

## Alternatives considered

### Q3 Option B — per-tenant snippet chain

One chain per tenant, all snippets in it. Rejected: the audit claim "no one
altered any snippet in this tenant" is less actionable than per-target, and a
busy tenant serializes every snippet write against one chain. Contention at
tenant-scale is real; at target-scale it is fine.
(`09-open-questions.md` Q3 Option B trade-off, lines 80-82)

### Q3 Option C — per-session snippet chain

Each research session starts a fresh chain. Rejected for two reasons:

1. Snippets are frequently captured outside a session (the sidebar is
   always available). A session-chain model needs a fallback chain for these
   cases, which re-introduces another chain boundary.
2. The audit question users actually ask is target-scoped, not session-scoped.
   "During session X, what evidence was gathered?" is answered by filtering
   `causal_nodes.session_id` — no separate chain needed.
   (`09-open-questions.md` Q3 Option C trade-off, lines 82-86)

### Drop the kind-qualifier — `snippet:<target_id>` alone

Target ids are UUIDs and globally unique, so kind is technically redundant.
Rejected: the kind qualifier is cheap, makes chain_ids human-readable in
logs and audit UIs, and avoids ambiguity if target-id namespaces ever change
(e.g. future tenant sharding). Per operator wording "both users and
companies" the kind is meaningful domain vocabulary, not just a tag.

## Related

- Source: `.planning/research-tools-sprint/06-evidence-and-provenance.md`
  §5 (ExoChain integration, lines 79-112)
- Source: `.planning/research-tools-sprint/10-decisions.md`
  Q3 (lines 51-65)
- Source: `.planning/research-tools-sprint/09-open-questions.md`
  Q3 (lines 62-88)
- Migration dependency: `026-ecc-exo-chain.sql` (chain_id column exists)
- Writer: `app/src/lib/snippets/service.ts` (computes chain_id on insert)
- Cross-ref: ADR-027 (target kinds: self, contact, company — this ADR's
  qualifier values)
- Cross-ref: ADR-028 (snippets flow in via the permission model defined there)
