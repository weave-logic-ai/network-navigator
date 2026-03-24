# NetworkNav ECC Symposium: WeftOS Integration Analysis

**Date**: 2026-03-22
**Status**: COMPLETE — Research synthesized from 2 parallel agents (architecture + codebase)

---

## Executive Summary

NetworkNav is a working Next.js + PostgreSQL/pgvector application with 23 schema migrations, 90+ API routes, a Chrome extension, and ruvector graph integration. It already has the data model for network intelligence — contacts, companies, edges, clusters, scoring, enrichment, outreach. What it lacks is the **cognitive substrate** that transforms a static database into a living intelligence system.

**The fundamental insight**: Network prospecting IS a conversation. The researcher, data sources, scoring engine, and prospects are all actors exchanging information. Each research action is an utterance. Each enrichment result is evidence. Each scoring decision is a belief update. The growing network graph IS the causal graph.

WeftOS/ECC integration is **incremental, not rebuild**. The existing PostgreSQL data model stays. WeftOS layers cognitive capabilities on top: CausalGraph for scoring provenance, ExoChain for enrichment audit trails, Impulses for event-driven automation, and the conversation model for contextual research sessions.

---

## Current Architecture → WeftOS Mapping

### What Exists (Substantial)

| Component | Implementation | Lines/Tables |
|-----------|---------------|-------------|
| Database schema | 23 SQL migrations, pgvector, ruvector graph triggers | 25+ tables |
| Scoring pipeline | 9-dimension composite + 6-component referral | ~2000 lines TS |
| Enrichment waterfall | 7 providers with budget tracking | ~800 lines TS |
| Chrome extension | Manifest V3, content scripts, service worker | ~1500 lines TS |
| API routes | 90+ endpoints (contacts, scoring, enrichment, graph, outreach, Claude) | ~4000 lines TS |
| Agent skills | LinkedIn prospector + network intel commands | ~500 lines |
| Graph analytics | PageRank, betweenness, closeness, eigenvector, clustering coefficient | ~600 lines TS |
| Multi-tenant | RLS, Clerk auth, tenant isolation | ~800 lines SQL+TS |

### What WeftOS Adds (Layer On Top)

| Gap | WeftOS Primitive | Impact |
|-----|-----------------|--------|
| **Scoring is a black box** — numbers without explanation | CausalGraph traces every dimension contribution, enables counterfactuals | HIGH |
| **Enrichment decisions are opaque** — provider/cost recorded but not decision logic | ExoChain provenance chain: budget → provider selection → field coverage → decision | MEDIUM |
| **Event chaining is inline** — triggers fire-and-forget | Impulses for decoupled automation: tier transition → outreach task → campaign queue → notification | HIGH |
| **Claude integration is stateless** — each call is independent | Conversation model with memory across research sessions | HIGH |
| **RVF feedback loop is open** — pairwise comparisons stored but unused | ExoChain links human preferences → scoring model updates → measurable improvement | HIGH |
| **No temporal tracking** — snapshots but no causal chain | ExoChain temporal chain enables time-travel debugging | MEDIUM |
| **Cross-entity reasoning is SQL JOINs** — implicit, not semantic | CrossRefs with typed context (why entities are related, not just that they are) | MEDIUM |

---

## The Five Engines in Prospecting

| Engine | Prospecting Domain | Concrete Implementation |
|--------|-------------------|------------------------|
| **DCTE (Structure)** | Research session tree — campaign goal → research threads → contact discoveries | The prospecting campaign as a conversation tree with branching (explore niche A vs B), merging (combine parallel research), and wavefront (commit to outreach list) |
| **DSTE (Intent)** | Researcher's evolving objectives — which ICP, which vertical, what signals matter | Dynamic ICP re-weighting as intent shifts ("now I'm focused on healthcare CISOs"). Maps to 15+ vertical configurations |
| **RSTE (Coherence)** | Multi-source data consistency — does PDL match Apollo? Do enrichment results contradict? | Referential integrity across enrichment providers. Detect and resolve contradictions in multi-source data |
| **EMOT (Affect)** | Relationship warmth + prospect receptivity + outreach urgency | Behavioral personas (super-connector, content-creator) + outreach timing signals (just promoted, just posted about evaluating vendors) |
| **SCEN (Arc)** | Outreach lifecycle — discover → qualify → engage → convert | The outreach FSM (not_started → queued → sent → opened → replied → accepted) as dramatic arc stages |

---

## Integration Architecture

### Incremental, Not Rebuild

```
┌─────────────────────────────────────────────────┐
│            Existing NetworkNav                   │
│  ┌──────────┐  ┌──────────┐  ┌──────────────┐  │
│  │ Next.js  │  │ PostgreSQL│  │   Chrome     │  │
│  │ App      │  │ + pgvector│  │   Extension  │  │
│  │ (90+ API)│  │ + ruvector│  │   (Manifest  │  │
│  │          │  │ (25+ tbl) │  │    V3)       │  │
│  └────┬─────┘  └─────┬────┘  └──────┬───────┘  │
│       │               │              │           │
│  ═════╪═══════════════╪══════════════╪═══════    │
│       │      WeftOS Cognitive Layer  │           │
│  ┌────┴──────────────┴──────────────┴────────┐  │
│  │  CausalGraph    ExoChain    HNSW          │  │
│  │  (scoring       (enrichment (enhanced     │  │
│  │   provenance)    audit)      search)      │  │
│  │                                            │  │
│  │  CrossRefs      Impulses    CognitiveTick │  │
│  │  (entity        (event      (research     │  │
│  │   context)       chains)     session)     │  │
│  └────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────┘
```

The WeftOS layer sits between the existing app and database. It doesn't replace PostgreSQL — it adds cognitive capabilities that PostgreSQL can't provide (causal chains, event-driven automation, temporal provenance, conversational context).

### Chrome Extension as Browser Kernel Node

The extension becomes an active participant:
- **Content scripts** → Impulse sensors (detect profile views, page changes)
- **Service worker** → CognitiveTick (lightweight local scoring, HNSW similarity check before committing to enrichment)
- **Side panel** → Conversation UI (ask questions about the currently-viewed profile with full context from the CausalGraph)

---

## Act / Analyze / Generate in Prospecting

**Act**: Live research. Browsing LinkedIn, enriching profiles, Chrome extension capturing data in real-time. Each action creates CausalGraph nodes. DSTE tracks evolving research intent.

**Analyze**: Score the accumulated network. Run the 9-dimension composite + referral scoring. RSTE checks enrichment data coherence across providers. Lambda_2 measures network graph coherence. Identify gaps ("you have no contacts in the healthcare vertical despite ICP targeting it").

**Generate**: Produce outreach. Agent-driven campaign creation where expert actor-processes (messaging specialist, ICP matcher, referral pathfinder) converse toward the goal of a personalized outreach sequence. The committed MainLine IS the outreach plan, with full causal provenance of why each prospect was selected and what messaging angle was chosen.

---

## Broader Applications

The same engine handles any "research as conversation" domain:

| Domain | Network | Research Process | Output |
|--------|---------|-----------------|--------|
| **Sales prospecting** | LinkedIn contacts + companies | Enrich, score, qualify | Outreach sequences |
| **Competitive intelligence** | Companies + products + people | Track signals, map relationships | Competitive briefs |
| **Patent landscape** | Inventors + patents + citations | Map prior art, find white space | IP strategy |
| **Academic collaboration** | Researchers + papers + institutions | Find co-authors, reviewers | Collaboration proposals |
| **Market research** | Companies + technologies + funding | Build market map from multiple sources | Investment thesis |
| **Recruiting** | Candidates + companies + skills | Source, screen, qualify | Recruiting pipeline |
| **Supply chain mapping** | Suppliers + capabilities + certifications | Discover, verify, assess risk | Supplier scorecard |

All use the same primitives: CausalGraph for relationship tracking, HNSW for similarity search, ExoChain for research provenance, Impulses for event chains, and the 5-engine conversation model for structure/intent/coherence/affect/arc.

---

## Key Findings

1. **NetworkNav's existing data model maps naturally to CMVG** — contacts are nodes, edges are causal relationships, enrichment events are ExoChain entries, vector embeddings are already HNSW-indexed via ruvector

2. **The biggest value-add is scoring explainability** — CausalGraph turns the 9-dimension black-box scorer into a transparent, auditable decision chain with counterfactual reasoning

3. **Event-driven automation via Impulses** replaces the current inline trigger system with decoupled, chainable reactions (tier transition → task creation → campaign enrollment → notification)

4. **The Chrome extension as a browser kernel node** transforms it from a passive data collector into an active conversation participant with local intelligence

5. **The conversation model closes the Claude integration gap** — currently stateless API calls become contextual research sessions with memory and intent tracking

6. **"Research as conversation" generalizes to any network intelligence domain** — same engine, different DomainProfile parameterization
