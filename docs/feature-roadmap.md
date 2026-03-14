# LinkedIn Prospector: Feature Development Roadmap

**Document Type**: Living Product Roadmap
**Version**: 1.0
**Created**: 2026-03-10
**Last Updated**: 2026-03-10
**Horizon**: 18 months (6 phases)
**Status**: Active

---

## 1. Vision Statement

LinkedIn Prospector evolves from a personal network intelligence tool into a **privacy-first, self-hosted relationship intelligence platform** that transforms raw LinkedIn connection data into actionable business development strategy.

At full maturity, the platform will:

- **Score and classify** every contact in a professional network across three dimensions: buyer potential, referral likelihood, and strategic relationship value
- **Generate AI-powered** outreach recommendations, conversation starters, and relationship nurturing sequences tailored to each contact's persona and engagement history
- **Visualize network topology** through interactive 3D graphs, cluster maps, and strategic gap analysis to reveal hidden opportunities
- **Track conversion outcomes** and continuously improve scoring accuracy through a self-learning feedback loop
- **Integrate with CRM systems** and outreach tools to bridge the gap between network intelligence and revenue operations
- **Operate entirely locally** with encrypted storage, no cloud dependencies, and full GDPR compliance by design

The differentiating principle: **intelligence about relationships, not automation of relationships.** The platform helps humans make better decisions about who to talk to and why -- it never sends messages or makes connections on the user's behalf.

---

## 2. Current State Assessment

### 2.1 What Works Today

The platform currently exists as a collection of Node.js ESM scripts organized as a Claude Code skill, operating in two deployment locations:

**Foundation Layer** (`~/.claude/skills/linkedin-prospector/scripts/`):

| Script | Lines | Status | Capability |
|--------|-------|--------|------------|
| `search.mjs` | 398 | Production | LinkedIn keyword search + all-connections extraction via Playwright |
| `enrich.mjs` | 136 | Production | Profile page scraping for detailed contact data |
| `db.mjs` | 294 | Production | JSON database with CRUD, merge/dedup, search, export, prune |
| `sheets.mjs` | 190 | Production | Google Sheets export with Gold List scoring |
| `lib.mjs` | 110 | Production | Shared utilities: parseArgs, launchBrowser, Google token, niche keywords |

**Advanced Pipeline** (`.claude/linkedin-prospector/skills/linkedin-prospector/scripts/`):

| Script | Lines | Status | Capability |
|--------|-------|--------|------------|
| `graph-builder.mjs` | ~300 | Production | Network graph construction, company normalization, cluster detection, 5 edge types |
| `scorer.mjs` | 263 | Production | ICP scoring, network hub, relationship strength, Gold Score v1, tier assignment |
| `behavioral-scorer.mjs` | 378 | Production | 6-component behavioral scoring, persona assignment, Gold Score v2 |
| `referral-scorer.mjs` | 507 | Production | 6-component referral likelihood scoring, referral personas/tiers |
| `analyzer.mjs` | 697 | Production | 10 CLI analysis modes (summary, hubs, prospects, referrals, recommend, etc.) |
| `report-generator.mjs` | 1762 | Production | Self-contained HTML dashboard with 3D graph, Chart.js, sortable tables |
| `pipeline.mjs` | 342 | Production | Multi-mode pipeline orchestrator (full, rebuild, rescore, referrals, deep-scan) |
| `batch-deep-scan.mjs` | 301 | Production | Criteria-driven batch scanning with 4 targeting modes |
| `deep-scan.mjs` | ~350 | Production | Single-contact connection list scraping with pagination |
| `cache.mjs` | ~100 | Production | HTML cache for scraped LinkedIn pages |
| `delta.mjs` | ~150 | Production | Network snapshot and diff tracking |
| `configure.mjs` | ~200 | Production | Interactive config wizard for ICP, behavioral, referral configs |
| `reparse.mjs` | ~100 | Production | Re-extract data from cached HTML |

**Data Assets**:

| Asset | Size | Description |
|-------|------|-------------|
| `contacts.json` | 928 contacts | Raw contact database with enrichment data |
| `graph.json` | ~15 MB | Scored network graph with 1,858 edges, 10 clusters |
| `icp-config.json` | 5 ICP profiles | ai-assessment, automation-assessment, fractional-cto, training, development |
| `behavioral-config.json` | Full config | 6-component behavioral scoring parameters |
| `referral-config.json` | 105 lines | 6-component referral scoring parameters |
| `network-report.html` | ~2 MB | Interactive HTML dashboard |

### 2.2 Current Network Metrics

| Metric | Value |
|--------|-------|
| Total contacts | 928 |
| Total graph edges | 1,858 |
| Active clusters | 10 |
| Degree-2 contacts (discovered) | 31 |
| Gold ICP tier | Variable (configurable at 0.55 threshold) |
| Gold referral tier | 15 (1.7%) |
| Silver referral tier | 203 (22.6%) |
| Bronze referral tier | 311 (34.7%) |
| White-label partners identified | 109 |
| Deep-scan expansion candidates | 121 |
| Scoring pipeline runtime | ~8 seconds (rebuild mode, excl. browser automation) |

### 2.3 Known Limitations (from .sparc Completion Review)

1. **Rule-based only** -- All scoring uses deterministic keyword matching, no ML
2. **No feedback loop** -- Cannot track whether referral recommendations led to actual conversions
3. **Rate-limited expansion** -- Deep-scan limited to sequential processing with 10s delays
4. **Batch-only scoring** -- No incremental or real-time scoring on new connections
5. **JSON file storage** -- Ceiling of ~10,000 contacts before I/O bottleneck
6. **English-only pattern matching** -- Non-English profiles unscored for role/industry signals
7. **No deduplication of discovered contacts** -- Near-duplicate detection not implemented
8. **Dual-location deployment** -- Scripts split between two directories (skill vs project-local)
9. **No test suite** -- Unit and integration tests defined in refinement.md but not yet implemented
10. **No automated scheduling** -- All operations manually triggered

---

## 3. Phase-by-Phase Roadmap

### Phase 1: Foundation and Data Hygiene (Months 1-2)

**Theme**: Harden what exists, eliminate tech debt, establish a testable architecture.

**Goals**:
- Consolidate script locations into a single canonical directory
- Implement the test suite defined in refinement.md
- Add config validation and graceful degradation
- Resolve PII handling concerns

#### 1.1 Script Consolidation and Project Structure

| Task | Priority | Effort | Description |
|------|----------|--------|-------------|
| Unify script locations | P0 | 4h | Merge `~/.claude/skills/` and `.claude/linkedin-prospector/` into a single canonical path |
| Create package.json | P0 | 1h | Proper Node.js project with bin entries for CLI commands |
| Add .gitignore | P0 | 30m | Exclude data/, .browser-data/, cache/, snapshots/ |
| Implement CLI entry point | P1 | 3h | Single `prospector` command with subcommands (search, enrich, score, analyze, report, scan) |
| Add npm scripts | P1 | 1h | `npm run pipeline`, `npm test`, `npm run lint` |

#### 1.2 Test Suite Implementation

| Task | Priority | Effort | Description |
|------|----------|--------|-------------|
| Export refactoring | P0 | 2h | Refactor referral-scorer.mjs, behavioral-scorer.mjs, scorer.mjs to export scoring functions |
| Unit tests: referral scorer | P0 | 4h | 31 test cases from refinement.md Section 2.2 |
| Unit tests: behavioral scorer | P0 | 3h | Per-component scoring function tests |
| Unit tests: ICP scorer | P1 | 3h | ICP fit, network hub, relationship strength tests |
| Integration tests: pipeline | P0 | 3h | Pipeline mode tests from refinement.md Section 2.3 |
| Quality gate tests | P1 | 2h | Distribution validation from refinement.md Section 5.5 |
| Performance benchmarks | P2 | 2h | Wall-time and memory benchmarks from refinement.md Section 3.4 |
| Test fixtures | P0 | 2h | Deterministic contact objects from refinement.md Section 2.1 |

#### 1.3 Error Handling and Resilience

| Task | Priority | Effort | Description |
|------|----------|--------|-------------|
| Config validation on load | P0 | 2h | Weight sum, threshold ordering, persona completeness checks |
| Fallback config | P1 | 1h | Hardcoded defaults when config files are missing/corrupt |
| Graceful weight redistribution | P1 | 2h | Reweight scoring when upstream scores are missing |
| NaN guard | P0 | 1h | Clamp invalid computed scores to 0 with warnings |
| Structured logging | P2 | 2h | Replace console.log with leveled logger (error/warn/info/debug) |

#### 1.4 PII Remediation

| Task | Priority | Effort | Description |
|------|----------|--------|-------------|
| Audit data fields for PII | P0 | 2h | Classify each field in contacts.json as public/semi-public/private |
| Separate PII from analytics | P1 | 4h | Split graph.json into scoring-only and identity stores |
| Add data retention policy | P1 | 2h | Auto-expire enrichment data older than configurable threshold |
| Redaction mode for reports | P2 | 3h | Generate reports with anonymized names/URLs for sharing |

**Phase 1 Success Metrics**:
- All unit tests pass (>90% coverage on scoring functions)
- Pipeline runs cleanly from a single directory
- Config validation catches all invalid configurations
- No NaN or undefined values in any scored output
- PII audit complete with documented data classification

**Estimated Total Effort**: ~50 person-hours

---

### Phase 2: Scoring Engine Advancement (Months 2-4)

**Theme**: Make scoring smarter, more configurable, and outcome-aware.

**Goals**:
- Implement referral conversion tracking (feedback loop)
- Add temporal decay to relationship scores
- Build the configuration wizard
- Prepare data infrastructure for ML training

#### 2.1 Referral Conversion Tracking

| Task | Priority | Effort | Description |
|------|----------|--------|-------------|
| Create referral-outcomes.json schema | P0 | 1h | Track referrer, referred-to, date, outcome, value |
| CLI: track-referral command | P0 | 3h | `prospector track --url <contact> --status <converted/pending/declined>` |
| Outcome dashboard section | P1 | 4h | Conversion funnel in HTML report: recommended -> contacted -> referred -> converted |
| Monthly diff report | P2 | 3h | Referral pipeline health trends over time |
| Scorer feedback integration | P1 | 4h | Boost scores for contacts with successful referral history |

#### 2.2 Temporal Scoring Enhancements

| Task | Priority | Effort | Description |
|------|----------|--------|-------------|
| Exponential decay for relationship warmth | P0 | 2h | Half-life of 180 days on connection recency |
| Activity recency signals | P1 | 3h | Factor in when a contact was last observed active (enrichment recency, deep-scan recency) |
| Score trend tracking | P1 | 4h | Track how each contact's scores change across scoring runs (delta.mjs extension) |
| Stale contact detection | P2 | 2h | Flag contacts whose data hasn't been refreshed in >90 days |

#### 2.3 Configuration System

| Task | Priority | Effort | Description |
|------|----------|--------|-------------|
| Interactive config wizard | P0 | 4h | Guided setup for ICP profiles, scoring weights, and referral criteria |
| Config presets | P1 | 2h | Industry-specific templates (SaaS, eCommerce, Agency, B2B Services) |
| A/B weight testing | P1 | 3h | Run scoring with two weight sets, compare tier distributions side-by-side |
| Config export/import | P2 | 2h | Share configurations between installations |

#### 2.4 Scoring Model Improvements

| Task | Priority | Effort | Description |
|------|----------|--------|-------------|
| Composite relationship score | P1 | 4h | Unified score combining ICP fit, referral likelihood, and behavioral signals |
| Engagement potential score | P1 | 3h | Predict how likely a contact is to respond based on warmth + recency + activity |
| Network gap score | P2 | 4h | Identify which clusters/industries are underrepresented in the network |
| Influence propagation | P2 | 6h | PageRank-style algorithm to propagate influence through graph edges |

**Phase 2 Success Metrics**:
- Referral outcomes tracked for at least 20 contacts
- Score trends visible in report across 3+ scoring runs
- Config wizard generates valid configs in <5 minutes
- Temporal decay produces measurably different rankings vs static scoring
- A/B weight comparison tool operational

**Estimated Total Effort**: ~60 person-hours

---

### Phase 3: Analysis and Reports (Months 4-6)

**Theme**: Transform data into actionable visual intelligence.

**Goals**:
- Build comprehensive network gap analysis
- Generate publication-quality HTML reports with D3.js
- Add strategic recommendation engine
- Create export formats for external tools

#### 3.1 Advanced Network Analysis

| Task | Priority | Effort | Description |
|------|----------|--------|-------------|
| Network coverage analysis | P0 | 6h | Identify which ICP profiles have weak coverage, suggest expansion targets |
| Bridge contact identification | P0 | 4h | Contacts connecting otherwise isolated clusters (betweenness centrality) |
| Community detection refinement | P1 | 6h | Replace keyword-based clusters with algorithmic community detection (Louvain) |
| Network health score | P1 | 3h | Aggregate metric: diversity, depth, recency, engagement potential of entire network |
| Competitive landscape mapping | P2 | 4h | Identify which competitors share the most contacts |

#### 3.2 Enhanced HTML Report

| Task | Priority | Effort | Description |
|------|----------|--------|-------------|
| D3.js force-directed graph | P0 | 8h | Replace 3d-force-graph CDN with custom D3.js implementation for better control |
| Network evolution timeline | P1 | 6h | Animated visualization of network growth over time using snapshot data |
| Cluster heatmap | P1 | 4h | Grid visualization of score distributions per cluster |
| Interactive score explorer | P1 | 4h | Drag sliders to adjust score weights and see real-time tier changes |
| PDF export | P2 | 4h | Generate printable PDF from HTML dashboard using Playwright |
| Dark mode | P2 | 2h | Toggle between light and dark dashboard themes |

#### 3.3 Strategic Recommendation Engine

| Task | Priority | Effort | Description |
|------|----------|--------|-------------|
| Prioritized action list | P0 | 4h | Top 10 actions ranked by expected value (tier x warmth x recency) |
| Persona-specific playbooks | P0 | 3h | Detailed engagement strategies for each of the 5 referral personas |
| Weekly focus list | P1 | 3h | Auto-generated "connect with these 5 people this week" list |
| Relationship decay warnings | P1 | 2h | Alert when high-value contacts are going cold (no interaction in 90+ days) |
| Expansion recommendations | P2 | 3h | Suggest which contacts to deep-scan next based on network gap analysis |

#### 3.4 Export and Integration Prep

| Task | Priority | Effort | Description |
|------|----------|--------|-------------|
| CSV export with all scores | P0 | 2h | Full scored contact export with configurable columns |
| JSON API output | P1 | 3h | Machine-readable scored output for integration with other tools |
| Google Sheets v2 | P1 | 4h | Push scored data (not just raw contacts) to Sheets with tier coloring |
| vCard export | P2 | 2h | Export top-tier contacts as vCards for CRM import |

**Phase 3 Success Metrics**:
- Network gap analysis identifies at least 3 underserved ICP segments
- HTML report loads in <3 seconds with 1000+ contacts
- Weekly focus list generates actionable 5-contact recommendations
- PDF export produces readable output for offline sharing
- CSV export consumed successfully by at least one external tool

**Estimated Total Effort**: ~80 person-hours

---

### Phase 4: AI and Intelligence Layer (Months 6-9)

**Theme**: Add LLM-powered intelligence to move from data to decisions.

**Goals**:
- LLM-based message drafting and conversation starters
- Intent signal detection from profile data
- Content intelligence and thought leadership scoring
- Semi-supervised scoring model using conversion data

#### 4.1 LLM-Powered Outreach Intelligence

| Task | Priority | Effort | Description |
|------|----------|--------|-------------|
| Conversation starter generator | P0 | 6h | Generate personalized opening messages based on contact's headline, about, mutual connections, shared clusters |
| Relationship insight cards | P0 | 4h | Per-contact AI summary: "why this person matters to you" based on scoring signals |
| Message template engine | P1 | 6h | Persona-specific message templates with variable substitution and tone adjustment |
| Follow-up suggestion engine | P1 | 4h | Based on time since last interaction and contact persona, suggest next best action |
| Meeting prep briefs | P2 | 4h | Generate 1-page briefing document before calls/meetings with a scored contact |

**Implementation Note**: All LLM features use the Claude Code environment's built-in model access. No external API keys required. Messages are generated but never automatically sent -- the user copies and personalizes each one.

#### 4.2 Intent Signal Detection

| Task | Priority | Effort | Description |
|------|----------|--------|-------------|
| Job change detection | P0 | 4h | Compare enrichment snapshots to detect role/company changes (buying signal) |
| Company growth signals | P1 | 3h | Detect hiring keywords in headlines/about (scaling, hiring, launching) |
| Technology adoption signals | P1 | 3h | Detect platform migration language (replatforming, migrating, evaluating) |
| Funding/investment signals | P2 | 3h | Detect fundraising and investment language |
| Pain point detection | P2 | 4h | NLP analysis of about/headline for problem-statement language |

#### 4.3 Content Intelligence

| Task | Priority | Effort | Description |
|------|----------|--------|-------------|
| Thought leadership score | P1 | 4h | Score contacts based on speaker/author/podcast keywords and content creation signals |
| Topic mapping | P1 | 6h | Extract topic themes from about sections using keyword clustering |
| Content alignment score | P2 | 4h | How well does a contact's content focus align with your positioning |
| InfraNodus integration | P2 | 4h | Use existing infranodus-analyze.mjs for network ontology and gap analysis |
| Engagement prediction | P2 | 6h | Based on content signals, predict which contacts are most likely to engage with your posts |

#### 4.4 Semi-Supervised Scoring

| Task | Priority | Effort | Description |
|------|----------|--------|-------------|
| Feature engineering pipeline | P0 | 4h | Convert 6 scoring components + engagement recency + referral history into training features |
| Logistic regression model | P1 | 6h | Train lightweight model on conversion data (requires 50+ tracked outcomes from Phase 2) |
| A/B scoring comparison | P1 | 3h | Compare ML scores vs rule-based scores on holdout set |
| Model confidence intervals | P2 | 4h | Add uncertainty estimates to ML-based scores |
| Continuous retraining | P2 | 4h | Auto-retrain model when new conversion data is added |

**Phase 4 Success Metrics**:
- Conversation starters generated for top 50 contacts
- Intent signals detected for at least 10% of contacts
- Thought leadership scores assigned to all contacts with about/headline data
- ML model trained on 50+ conversion outcomes (if available)
- ML score AUC > 0.65 (better than random on conversion prediction)

**Estimated Total Effort**: ~100 person-hours

---

### Phase 5: Scale and Integration (Months 9-12)

**Theme**: Connect the platform to external systems and handle larger networks.

**Goals**:
- CRM integration (Salesforce, HubSpot, Pipedrive)
- Database migration from JSON to SQLite
- Multi-network data ingestion
- Outreach sequence builder

#### 5.1 CRM Integration

| Task | Priority | Effort | Description |
|------|----------|--------|-------------|
| CRM data model abstraction | P0 | 4h | Define a normalized contact schema that maps to Salesforce/HubSpot/Pipedrive |
| HubSpot connector | P0 | 8h | Bidirectional sync: push scored contacts, pull deal stage updates |
| Salesforce connector | P1 | 8h | Push contacts as leads with custom score fields |
| Pipedrive connector | P1 | 6h | Create persons/deals from scored contacts |
| CRM outcome tracking | P0 | 4h | Pull conversion data from CRM to feed the ML scoring model |
| Deduplication across CRM | P1 | 4h | Match LinkedIn contacts to existing CRM records by name+company+email |

#### 5.2 Database Migration

| Task | Priority | Effort | Description |
|------|----------|--------|-------------|
| SQLite schema design | P0 | 4h | Tables: contacts, scores, edges, clusters, companies, outcomes, snapshots |
| Migration script | P0 | 4h | Convert contacts.json + graph.json into SQLite database |
| Query layer | P0 | 6h | Replace JSON file reads with SQL queries for all scoring and analysis operations |
| Indexed search | P1 | 3h | Full-text search index on name, headline, about, company |
| Concurrent write support | P1 | 3h | WAL mode for safe concurrent reads during pipeline execution |
| Backward compatibility | P1 | 3h | JSON import/export for data portability |

#### 5.3 Multi-Network Expansion

| Task | Priority | Effort | Description |
|------|----------|--------|-------------|
| Platform abstraction layer | P0 | 6h | Normalize contact data from multiple sources into unified schema |
| Twitter/X profile import | P1 | 6h | Import followers/following list, extract bio and engagement signals |
| GitHub profile import | P2 | 4h | Import contributors from repos, extract tech stack and activity signals |
| Email contact import | P1 | 4h | Import from CSV/vCard with name+company matching to LinkedIn contacts |
| Cross-platform deduplication | P0 | 6h | Match contacts across networks by name+company+role fuzzy matching |
| Unified scoring | P1 | 4h | Blend signals from all platforms into composite scores |

#### 5.4 Outreach Sequence Builder

| Task | Priority | Effort | Description |
|------|----------|--------|-------------|
| Sequence template engine | P1 | 6h | Define multi-step outreach sequences with timing and conditions |
| Persona-specific sequences | P1 | 4h | Pre-built sequences for each of the 5 referral personas |
| A/B message variants | P2 | 4h | Store multiple message variants per step for manual A/B testing |
| Sequence tracker | P1 | 4h | Track which step each contact is on (all manual execution, no automation) |
| Follow-up reminders | P1 | 3h | Generate reminders for pending follow-ups |

**Phase 5 Success Metrics**:
- At least one CRM connector syncing bidirectionally
- SQLite database handles 5,000+ contacts without performance degradation
- At least one non-LinkedIn network integrated
- Cross-platform deduplication matches >80% of shared contacts
- Outreach sequences defined for all 5 referral personas

**Estimated Total Effort**: ~120 person-hours

---

### Phase 6: Platform and Ecosystem (Months 12-18)

**Theme**: Transform from a tool into a platform with extensibility and team support.

**Goals**:
- Plugin system for custom scoring models
- Team collaboration with multi-user support
- Analytics dashboard with conversion tracking
- Real-time monitoring and alerts
- Privacy-first architecture hardening

#### 6.1 Plugin System

| Task | Priority | Effort | Description |
|------|----------|--------|-------------|
| Plugin architecture design | P0 | 8h | Define plugin lifecycle: register, configure, execute, report |
| Scoring plugin API | P0 | 6h | Interface for custom scoring components that integrate into the composite score |
| Data source plugin API | P1 | 6h | Interface for custom data importers (conference attendee lists, webinar registrants, etc.) |
| Analysis plugin API | P1 | 4h | Interface for custom analysis modes in the analyzer |
| Report widget plugin API | P2 | 6h | Interface for custom dashboard sections |
| Plugin registry and discovery | P2 | 4h | Local registry of installed plugins with version management |

#### 6.2 Team Collaboration

| Task | Priority | Effort | Description |
|------|----------|--------|-------------|
| Multi-user data model | P0 | 6h | User accounts with separate contact ownership + shared team graph |
| Role-based access control | P0 | 4h | Admin, contributor, viewer roles |
| Shared graph mode | P1 | 6h | Team members contribute contacts to a shared network graph |
| Contact assignment | P1 | 3h | Assign contacts to team members for outreach ownership |
| Activity feed | P2 | 4h | Team-visible log of scoring runs, outreach updates, and conversion events |
| Conflict resolution | P2 | 4h | Merge strategies when multiple team members update the same contact |

#### 6.3 Analytics Dashboard

| Task | Priority | Effort | Description |
|------|----------|--------|-------------|
| Real-time metrics server | P0 | 8h | Lightweight HTTP server serving live scoring data and pipeline status |
| Conversion funnel dashboard | P0 | 6h | Visualize full funnel: network -> scored -> contacted -> meeting -> converted |
| ROI measurement | P1 | 4h | Track revenue attributed to network intelligence recommendations |
| Pipeline health monitoring | P1 | 3h | Dashboard showing scoring run history, data freshness, and quality metrics |
| Comparative analytics | P2 | 4h | Compare scoring effectiveness across time periods, ICP profiles, or team members |
| Custom report builder | P2 | 6h | Drag-and-drop interface for building custom dashboard views |

#### 6.4 Real-Time Monitoring

| Task | Priority | Effort | Description |
|------|----------|--------|-------------|
| Connection change detection | P1 | 6h | Periodic polling of connection count to detect new connections |
| Incremental scoring | P0 | 6h | Score only new/changed contacts instead of full-graph rescoring |
| Trigger-based alerts | P1 | 4h | Notifications when a new connection scores above silver threshold |
| Job change alerts | P1 | 4h | Detect and alert on role/company changes among high-value contacts |
| Score drift alerts | P2 | 3h | Alert when a contact's score changes significantly between runs |

#### 6.5 Privacy-First Architecture

| Task | Priority | Effort | Description |
|------|----------|--------|-------------|
| Encrypted storage | P0 | 6h | AES-256 encryption at rest for contact database |
| GDPR data subject requests | P0 | 4h | CLI command to delete all data for a specific contact URL |
| Data minimization audit | P1 | 3h | Review each stored field for necessity; remove unnecessary data collection |
| Consent tracking | P1 | 3h | Record the basis for storing each contact's data |
| Self-hosted deployment guide | P1 | 4h | Docker container with all dependencies for portable deployment |
| Audit logging | P2 | 3h | Immutable log of all data access and modification operations |

**Phase 6 Success Metrics**:
- At least 2 custom scoring plugins developed and operational
- 3+ team members collaborating on shared graph
- Conversion funnel visible from scored contacts through to revenue
- Incremental scoring runs in <2 seconds for individual contact updates
- All stored data encrypted at rest
- GDPR deletion request completes in <5 seconds

**Estimated Total Effort**: ~160 person-hours

---

## 4. Feature Priority Matrix

### Impact vs Effort Assessment

Features are scored on two axes:
- **Impact** (1-5): Business value, user demand, competitive differentiation
- **Effort** (1-5): Development complexity, time required, dependency depth

#### Quick Wins (High Impact, Low Effort)

| Feature | Impact | Effort | Phase | Notes |
|---------|--------|--------|-------|-------|
| Config validation | 4 | 1 | 1 | Prevents silent scoring errors |
| NaN guard | 4 | 1 | 1 | Eliminates corrupt scores |
| CSV export with scores | 4 | 1 | 3 | Immediate integration value |
| Weekly focus list | 4 | 2 | 3 | Actionable daily value |
| Conversation starters | 5 | 2 | 4 | High perceived value, LLM-native |
| Job change detection | 5 | 2 | 4 | High signal-to-noise buying intent |
| Referral tracking CLI | 4 | 2 | 2 | Enables feedback loop |

#### Strategic Bets (High Impact, High Effort)

| Feature | Impact | Effort | Phase | Notes |
|---------|--------|--------|-------|-------|
| HubSpot/Salesforce integration | 5 | 4 | 5 | Revenue attribution |
| SQLite migration | 4 | 4 | 5 | Unlocks scale beyond 5K contacts |
| ML-based scoring | 5 | 4 | 4 | Requires conversion data from Phase 2 |
| Plugin system | 4 | 5 | 6 | Platform play, enables ecosystem |
| Team collaboration | 4 | 5 | 6 | Required for enterprise adoption |
| D3.js graph overhaul | 3 | 4 | 3 | Visual polish, not core value |

#### Nice-to-Haves (Lower Impact)

| Feature | Impact | Effort | Phase | Notes |
|---------|--------|--------|-------|-------|
| Dark mode | 2 | 1 | 3 | User preference, low priority |
| vCard export | 2 | 1 | 3 | Niche use case |
| GitHub import | 2 | 2 | 5 | Only relevant for tech networks |
| PDF export | 3 | 2 | 3 | Offline sharing scenario |
| Custom report builder | 2 | 4 | 6 | Drag-and-drop complexity |
| Audit logging | 2 | 2 | 6 | Enterprise requirement |

#### Critical Dependencies (Must-Do Regardless of Impact)

| Feature | Impact | Effort | Phase | Notes |
|---------|--------|--------|-------|-------|
| Test suite | 3 | 3 | 1 | Quality foundation for all future work |
| Script consolidation | 3 | 2 | 1 | Prevents confusion and drift |
| PII audit | 3 | 2 | 1 | Compliance risk if deferred |
| Export refactoring | 2 | 1 | 1 | Required for testability |

---

## 5. Competitive Differentiation

### 5.1 Competitive Landscape

| Tool | Pricing | Approach | Key Strength | Key Weakness |
|------|---------|----------|------------|--------------|
| **LinkedIn Sales Navigator** | $99-$180/mo | Platform-native | Direct LinkedIn integration, InMail | No network graph analysis, no referral scoring |
| **Apollo.io** | $49-$119/mo | Data enrichment + outreach | Massive B2B database, email sequences | Generic scoring, not relationship-based |
| **Lusha** | $49-$79/mo | Contact finder | Direct dial and email data | No network intelligence |
| **Crystal Knows** | $49/mo | Personality insights | DISC profiling for communication | Single-dimensional, no network context |
| **Clay.com** | $149-$349/mo | Data enrichment orchestration | 75+ data sources | Complex, expensive, no graph analysis |
| **Dux-Soup** | $15-$55/mo | LinkedIn automation | Auto-visit, auto-connect | Automation risk, banned frequently |
| **PhantomBuster** | $56-$352/mo | Multi-platform scraping | Broad social media extraction | No scoring, raw data only |
| **LinkedIn Prospector** | $0 (self-hosted) | Network intelligence | See below | Early stage, single-user |

### 5.2 Unique Differentiators

**1. Relationship Graph Intelligence (No Competitor Has This)**

No commercial tool builds a scored, multi-layer network graph from your actual LinkedIn connections. Sales Navigator shows 2nd-degree connections but doesn't score them against your ICP, analyze referral likelihood, or detect hidden bridge contacts through deep-scan discovery.

**2. Buyer Inversion / Referral Scoring (Novel Concept)**

The "buyer inversion" scoring component is a genuinely novel idea: contacts who score LOW on ICP fit but HIGH on ecosystem presence are reclassified as referral partners rather than discarded. Commercial tools sort contacts by "fit to buy" and ignore the referral channel entirely.

**3. Privacy-First Architecture**

All data stays local. No cloud account required. No data leaves the machine. This is impossible with SaaS tools that require uploading your contacts to their servers. For privacy-conscious professionals and regulated industries, this is a meaningful differentiator.

**4. Explainable Scoring**

Every score has a full component breakdown: "This contact scored 0.72 on referral likelihood because: referralRole=0.85 (matched 'agency' in high tier), clientOverlap=0.65 (matched ecommerce + shopify), networkReach=0.60...". Commercial tools provide opaque "fit scores" with no explanation.

**5. Claude Code Native Integration**

The tool runs as a Claude Code skill, meaning the AI assistant directly interprets results, generates insights, and helps with follow-up actions. The workflow is: run pipeline -> ask Claude to analyze results -> get conversation starters -> execute outreach. No tool switching.

**6. Cost Structure**

$0 base cost vs $50-$350/month for commercial alternatives. For an individual consultant or small team, this represents $600-$4,200/year in savings. The only cost is the Claude Code subscription the user already has.

### 5.3 What Competitors Do Better (Honest Assessment)

| Capability | Best Competitor | Gap to Close |
|-----------|----------------|--------------|
| Email/phone data | Apollo, Lusha | Phase 5: data enrichment partnerships |
| Multi-user collaboration | Clay, Apollo | Phase 6: team features |
| Automated outreach | Dux-Soup, PhantomBuster | Intentional non-goal (intelligence, not automation) |
| Scale (100K+ contacts) | Apollo, Clay | Phase 5: SQLite migration |
| Real-time alerts | LinkedIn Sales Navigator | Phase 6: monitoring system |
| Personality insights | Crystal Knows | Phase 4: LLM-based relationship insights |
| UI polish | All SaaS tools | Phase 3: HTML report improvements |

---

## 6. Technical Dependencies

### 6.1 Dependency Graph

```
Phase 1: Foundation
  |
  |-- Test Suite -------> Required for safe changes in all later phases
  |-- Export Refactor --> Required for Test Suite
  |-- Config Validation -> Required for Config Wizard (Phase 2)
  |-- PII Audit --------> Required for Privacy features (Phase 6)
  |-- Script Consolidation -> Required for CLI entry point (Phase 1)
  |
  v
Phase 2: Scoring
  |
  |-- Referral Tracking --> Required for ML Scoring (Phase 4)
  |-- Temporal Decay -----> Standalone (no dependencies)
  |-- Config Wizard ------> Depends on Config Validation (Phase 1)
  |-- A/B Weight Testing --> Standalone
  |
  v
Phase 3: Analysis
  |
  |-- Network Gap Analysis -> Depends on community detection
  |-- D3.js Graph ---------> Standalone (replaces 3d-force-graph)
  |-- PDF Export -----------> Depends on HTML report (existing)
  |-- CSV Export -----------> Standalone
  |-- Recommendation Engine -> Depends on Network Gap Analysis
  |
  v
Phase 4: AI/Intelligence
  |
  |-- Conversation Starters -> Standalone (uses Claude Code LLM)
  |-- Intent Signals --------> Depends on enrichment snapshots (delta.mjs)
  |-- Content Intelligence --> Depends on InfraNodus integration
  |-- ML Scoring ------------> HARD DEPENDENCY: Requires 50+ tracked outcomes from Phase 2
  |                            If conversion data is insufficient, defer to Phase 5
  |
  v
Phase 5: Scale/Integration
  |
  |-- CRM Integration ------> Depends on normalized data model
  |-- SQLite Migration ------> Required before handling >5K contacts
  |-- Multi-Network ---------> Depends on platform abstraction layer
  |-- Cross-Platform Dedup --> Depends on Multi-Network + SQLite
  |-- Outreach Sequences ----> Depends on Conversation Starters (Phase 4)
  |
  v
Phase 6: Platform
  |
  |-- Plugin System ---------> Depends on SQLite (Phase 5) + stable scoring API
  |-- Team Collaboration ----> Depends on SQLite (Phase 5) + user model
  |-- Analytics Dashboard ---> Depends on CRM Integration (Phase 5) for conversion data
  |-- Real-Time Monitoring --> Depends on Incremental Scoring
  |-- Encrypted Storage -----> Can be done independently but better after SQLite
```

### 6.2 Critical Path

The critical path through the roadmap is:

```
Export Refactor (Phase 1)
  -> Test Suite (Phase 1)
    -> Referral Tracking (Phase 2)
      -> ML Feature Engineering (Phase 4)
        -> ML Model Training (Phase 4)
          -> CRM Outcome Tracking (Phase 5)
            -> Conversion Funnel Dashboard (Phase 6)
```

This path represents the longest chain of hard dependencies and is the primary constraint on delivering the self-learning scoring vision.

### 6.3 External Dependencies

| Dependency | Version | Used In | Risk |
|-----------|---------|---------|------|
| Node.js | >= 18.0 | All phases | Low -- stable, widely available |
| Playwright | >= 1.40 | LinkedIn scraping | Medium -- LinkedIn may change DOM structure |
| Chromium | (via Playwright) | LinkedIn session | Medium -- browser updates may break selectors |
| Chart.js | CDN | Report generation | Low -- stable library |
| 3d-force-graph | CDN | 3D visualization | Low (replaced in Phase 3) |
| SQLite (better-sqlite3) | >= 9.0 | Phase 5+ | Low -- mature, stable |
| Claude Code LLM | Current model | Phase 4+ | Low -- built into Claude Code environment |
| InfraNodus API | MCP server | Phase 4 | Medium -- external service dependency |

---

## 7. Risk Assessment

### Phase 1: Foundation

| Risk | Probability | Impact | Mitigation |
|------|------------|--------|------------|
| Script consolidation breaks existing workflows | Medium | High | Create migration script, test all pipeline modes before/after |
| Test suite reveals scoring bugs | High | Medium | Actually a positive outcome; fix bugs before they compound |
| PII audit reveals over-collection | Medium | Medium | Implement data minimization; delete unnecessary fields |

### Phase 2: Scoring

| Risk | Probability | Impact | Mitigation |
|------|------------|--------|------------|
| Users don't track referral outcomes | High | High | Make tracking as frictionless as possible (single CLI command); consider CRM auto-tracking in Phase 5 |
| Temporal decay produces unintuitive rankings | Medium | Medium | A/B test with/without decay; make half-life configurable |
| Config complexity overwhelms users | Medium | Low | Provide sensible defaults; wizard handles common cases |

### Phase 3: Analysis

| Risk | Probability | Impact | Mitigation |
|------|------------|--------|------------|
| D3.js migration increases report size | Medium | Low | Lazy-load visualization; compress data payload |
| PDF export quality insufficient | Medium | Low | Use Playwright's page.pdf() with custom CSS @media print |
| Community detection algorithms too slow | Low | Medium | Profile on 5K contacts; fall back to keyword clusters if needed |

### Phase 4: AI/Intelligence

| Risk | Probability | Impact | Mitigation |
|------|------------|--------|------------|
| Insufficient conversion data for ML (< 50 outcomes) | High | High | Extend rule-based scoring with manual weight tuning; defer ML until data accumulates |
| LLM conversation starters feel generic | Medium | Medium | Include specific contact details in prompts; allow user to iterate and customize |
| Intent signals produce false positives | Medium | Medium | Require multiple signal types before flagging; include confidence scores |
| LLM costs for large-scale generation | Low | Low | Batch generate for top-tier contacts only; cache results |

### Phase 5: Scale/Integration

| Risk | Probability | Impact | Mitigation |
|------|------------|--------|------------|
| CRM API changes break integration | Medium | High | Abstract behind interface; version-pin API clients; integration tests |
| SQLite migration data loss | Low | Critical | JSON backup before migration; validation checksums; rollback script |
| Multi-network deduplication accuracy | High | Medium | Require manual confirmation for uncertain matches; confidence scoring |
| LinkedIn blocks Playwright scraping | Medium | High | Conservative rate limiting; session rotation; accept graceful degradation |

### Phase 6: Platform

| Risk | Probability | Impact | Mitigation |
|------|------------|--------|------------|
| Plugin API too restrictive/complex | Medium | High | Start with 2-3 internal plugins to validate API before opening |
| Team features require server infrastructure | High | Medium | Start with file-based multi-user using SQLite; defer server to v3.0 |
| Encryption performance overhead | Low | Low | AES-256 is fast; benchmark impact on scoring pipeline |
| Feature scope creep | High | High | Enforce phase boundaries; defer "nice-to-haves" rigorously |

### Cross-Cutting Risks

| Risk | Probability | Impact | Mitigation |
|------|------------|--------|------------|
| LinkedIn ToS enforcement | Medium | Critical | Stay read-only; never automate actions; conservative rate limits; manual session |
| Single developer bottleneck | High | High | Comprehensive docs; modular architecture; standardized interfaces |
| Technical debt from rapid iteration | High | Medium | Phase 1 test suite prevents regression; enforce 500-line file limit |
| Privacy regulations (GDPR, CCPA) | Low | High | Privacy-by-design from Phase 1; data minimization; deletion capabilities |

---

## 8. Success Metrics

### Phase 1: Foundation (Months 1-2)

| KPI | Target | Measurement |
|-----|--------|-------------|
| Test coverage | >90% of scoring functions | Line coverage via c8/istanbul |
| Pipeline reliability | 0 crashes on production data | Run 10 consecutive rebuilds without error |
| Config error detection | 100% of invalid configs caught | Test suite with 10+ invalid config fixtures |
| Script locations | Single canonical directory | ls -la verification |
| PII classification | 100% of fields classified | Audit document complete |

### Phase 2: Scoring (Months 2-4)

| KPI | Target | Measurement |
|-----|--------|-------------|
| Referral outcomes tracked | >= 20 contacts | Count of referral-outcomes.json entries |
| Score stability | <5% score variance between runs on unchanged data | Consecutive run diff comparison |
| Config wizard completion rate | <5 minutes for new setup | Manual timing |
| Temporal decay impact | Measurable ranking difference vs. static | Top-20 list comparison before/after |
| A/B test capability | Run 2 weight sets and compare | CLI output shows side-by-side tier distributions |

### Phase 3: Analysis (Months 4-6)

| KPI | Target | Measurement |
|-----|--------|-------------|
| Report load time | <3 seconds for 1000 contacts | Browser performance tab |
| Network gaps identified | >= 3 underserved segments | Gap analysis output count |
| Weekly focus list quality | 4/5 contacts actionable | Manual review of 4 consecutive weeks |
| Export usability | Successfully imported by 1 external tool | End-to-end test |
| Recommendation relevance | >70% of recommendations marked "useful" | Manual tracking over 1 month |

### Phase 4: AI/Intelligence (Months 6-9)

| KPI | Target | Measurement |
|-----|--------|-------------|
| Conversation starters quality | >60% used without major edits | User feedback tracking |
| Intent signals precision | >50% true positive rate | Manual validation of flagged contacts |
| ML model AUC | >0.65 | Test set evaluation |
| Content intelligence coverage | >80% of contacts with about sections scored | Scored count / total with about |
| LLM generation latency | <5 seconds per contact brief | Wall-clock timing |

### Phase 5: Scale/Integration (Months 9-12)

| KPI | Target | Measurement |
|-----|--------|-------------|
| CRM sync reliability | >95% successful syncs over 30 days | Sync log analysis |
| SQLite query performance | <100ms for any single query | Query timing |
| Contact capacity | 5000+ contacts without degradation | Performance benchmark at 5K |
| Cross-platform match rate | >80% of shared contacts matched | Manual verification sample |
| Sequence completion rate | >50% of started sequences completed | Tracker analysis |

### Phase 6: Platform (Months 12-18)

| KPI | Target | Measurement |
|-----|--------|-------------|
| Plugin API stability | 0 breaking changes after initial release | Semantic versioning compliance |
| Team adoption | 3+ active users on shared graph | Activity log analysis |
| Conversion funnel visibility | End-to-end funnel tracked | Dashboard screenshot |
| Incremental scoring speed | <2 seconds for single contact | Wall-clock timing |
| Encryption overhead | <10% scoring pipeline slowdown | Benchmark comparison |

---

## 9. Open Questions

These decisions require user input before implementation proceeds:

### Architecture Decisions

1. **Script consolidation target**: Should the canonical location be `~/.claude/skills/linkedin-prospector/` (global skill) or `/home/aepod/dev/ctox/.claude/linkedin-prospector/` (project-local)? The global location enables use across projects; the project-local location keeps everything versioned together.

2. **Database timing**: Should SQLite migration happen in Phase 5 as planned, or should it be pulled into Phase 2 to establish a solid data foundation earlier? The JSON file approach works for 928 contacts but may become painful if deep-scanning grows the network significantly.

3. **Plugin architecture scope**: Is the plugin system (Phase 6) an overengineered vision, or is there genuine intent to open this to third-party contributors? The design effort is significant and should be skipped if the tool remains personal-use only.

### Product Decisions

4. **Outreach automation boundary**: The roadmap explicitly avoids automated message sending. Should this remain a hard boundary, or should Phase 5 include optional integration with LinkedIn messaging automation tools (with full ToS risk acknowledgment)?

5. **Multi-user scope**: Is team collaboration (Phase 6) needed for the near-term use case? If the tool remains single-user for 12+ months, Phase 6 team features should be deprioritized in favor of deeper single-user intelligence.

6. **CRM priority**: Which CRM is the primary integration target? HubSpot, Salesforce, and Pipedrive have different API models and different user bases. Implementing one well is better than three partially.

7. **Monetization intent**: Is there any plan to commercialize this tool (open-source, paid SaaS, consulting toolkit)? This affects architecture decisions around multi-tenancy, documentation depth, and API design.

### Data Decisions

8. **Referral tracking discipline**: The ML scoring model (Phase 4) depends entirely on tracked outcomes from Phase 2. What is the realistic expectation for tracking volume? If fewer than 50 outcomes are expected in 6 months, the ML path should be replaced with improved heuristics.

9. **Multi-network priority**: Which non-LinkedIn network provides the most value? Twitter/X for influence mapping, GitHub for tech community, or email/calendar for relationship warmth signals?

10. **Data retention policy**: How long should contact data be retained? Indefinitely (useful for trend analysis), 12 months (reasonable default), or user-configurable? This affects storage requirements and privacy compliance.

### Technical Decisions

11. **Test framework**: The refinement.md specifies Node.js built-in `node:test`. Should the project adopt a more feature-rich framework (vitest, jest) for better DX, or stay with zero-dependency testing?

12. **Report technology**: Should the Phase 3 HTML report remain a single self-contained file (current approach), or should it become a small web app served via a local HTTP server? The single-file approach is simpler but limits interactivity.

13. **LLM model choice for Phase 4**: Should conversation starters and relationship insights use the Claude Code environment's built-in model (zero cost, integrated workflow) or support external model APIs (OpenAI, local models) for flexibility?

---

## Appendix A: Timeline Summary

```
Month  1    2    3    4    5    6    7    8    9   10   11   12   13-18
      |----Phase 1----|
           |-------Phase 2-------|
                       |-------Phase 3-------|
                                 |----------Phase 4----------|
                                              |----------Phase 5----------|
                                                                  |--Phase 6--|
```

| Phase | Duration | Focus | Key Deliverable |
|-------|----------|-------|-----------------|
| 1 | Months 1-2 | Foundation | Test suite, consolidated project, config validation |
| 2 | Months 2-4 | Scoring | Referral tracking, temporal decay, config wizard |
| 3 | Months 4-6 | Analysis | Network gap analysis, enhanced reports, recommendations |
| 4 | Months 6-9 | AI | Conversation starters, intent signals, ML scoring |
| 5 | Months 9-12 | Scale | CRM integration, SQLite, multi-network |
| 6 | Months 12-18 | Platform | Plugins, teams, analytics, real-time monitoring |

**Total estimated effort**: ~570 person-hours across all phases

## Appendix B: File Location Reference

Current script locations (to be consolidated in Phase 1):

**Primary skill (foundation scripts)**:
```
~/.claude/skills/linkedin-prospector/scripts/
  search.mjs, enrich.mjs, db.mjs, sheets.mjs, lib.mjs
```

**Project-local (advanced pipeline)**:
```
/home/aepod/dev/ctox/.claude/linkedin-prospector/skills/linkedin-prospector/scripts/
  graph-builder.mjs, scorer.mjs, behavioral-scorer.mjs, referral-scorer.mjs,
  analyzer.mjs, report-generator.mjs, pipeline.mjs, batch-deep-scan.mjs,
  deep-scan.mjs, cache.mjs, delta.mjs, configure.mjs, reparse.mjs,
  lib.mjs, db.mjs, search.mjs, enrich.mjs
```

**Backup (previous versions)**:
```
/home/aepod/dev/ctox/.claude/skill_bak/linkedin-prospector/scripts/
  (full previous version of all scripts)
```

**SPARC documentation**:
```
/home/aepod/dev/ctox/.sparc/
  specification.md, architecture.md, completion.md, refinement.md
```

**Data directory**:
```
~/.claude/skills/linkedin-prospector/data/
  contacts.json, icp-config.json

/home/aepod/dev/ctox/.claude/linkedin-prospector/skills/linkedin-prospector/data/
  contacts.json, graph.json, icp-config.json, behavioral-config.json,
  referral-config.json, network-report.html, cache/, snapshots/
```

## Appendix C: Glossary

| Term | Definition |
|------|-----------|
| **ICP** | Ideal Customer Profile -- a description of the type of company/person most likely to buy |
| **Gold Score** | Composite score (0-1) blending ICP fit, network centrality, relationship strength, and behavioral signals |
| **Referral Likelihood** | Composite score (0-1) measuring how likely a contact is to generate referral business |
| **Buyer Inversion** | Scoring principle: low ICP fit + high ecosystem presence = referral partner, not buyer |
| **Deep Scan** | Browser automation that visits a contact's LinkedIn connections page to discover 2nd-degree contacts |
| **Bridge Contact** | A contact discovered through multiple deep scans, connecting otherwise separate network clusters |
| **Persona** | Categorical classification: buyer, advisor, hub, peer, referral-partner (ICP); super-connector, content-creator, silent-influencer, rising-connector, passive-network (behavioral); white-label-partner, warm-introducer, co-seller, amplifier, passive-referral (referral) |
| **Pipeline Mode** | One of: full, rebuild, rescore, behavioral, referrals, report, deep-scan, configure, validate, reparse |
| **SPARC** | Specification, Pseudocode, Architecture, Refinement, Completion -- the development methodology used for this project |

---

*This is a living document. Update it as decisions are made, priorities shift, and phases are completed. Last reviewed: 2026-03-10.*
