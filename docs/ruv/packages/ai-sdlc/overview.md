# AI-SDLC-SOPs: Architecture Overview

**Repo**: https://github.com/AISDLC/AI-SDLC-SOPs
**Language**: Rust (AEGIS backend), TypeScript (web UI), Markdown (43 SOPs)
**Status**: Active governance framework

## Core Architecture

"Digital Constitution" framework with three-branch separation of powers, 43 SOPs across 5 series, and a Combinator Graph Reduction (CGR) engine that mathematically enforces governance invariants. Not a suggestions engine -- a type-safe constraint system where violations are impossible states.

### Three-Branch Separation

| Branch | Role | Implementation |
|--------|------|----------------|
| **Legislative** (Rules & Policies) | Define boundaries | Natural language prompts, configuration files, SOPs, AI-IRB governance |
| **Executive** (Agent/AI System) | Act within boundaries | LLM/model interprets and executes rules within constraints |
| **Judicial** (Validation Engine) | Enforce boundaries | CGR engine that mathematically proves actions don't violate invariants |

Key principle: No branch can modify another's constraints. Agents execute, they cannot rewrite the rules they execute under.

### SOP Series

| Series | Focus | Count |
|--------|-------|-------|
| 1000 | Program/Project Management & Governance | ~20 |
| 1100 | Training & Documentation | 2 |
| 1200 | Engineering Lifecycle (Dev/QA/Deploy) | 3 |
| 1300 | Ethical & Regulatory Oversight | 7 |
| 2000 | Quality Records & Control | 1 |

### AEGIS CGR Engine (Rust/WASM)

Combinator Graph Reduction engine enforcing 5 constitutional rules:

| Rule | Check | On Failure |
|------|-------|------------|
| Empty Graph | Reject if no nodes present | REJECT |
| Cycle Detection | DFS to identify circular dependencies | REJECT |
| Signature Verification | Proposal nodes must include author_id | REJECT |
| Risk Threshold | `effects.risk > 0.8` | REJECT |
| Fairness Floor | `effects.fairness < 0.3` | REJECT |

Violations are type errors, not audit findings. Non-compliant actions are prevented, not logged after the fact.

### Effect Algebra

Five-dimensional scoring on every governance decision:

| Dimension | Range | Constraint |
|-----------|-------|------------|
| RISK | 0.0-1.0 | Probability x Impact |
| FAIRNESS | 0.0-1.0 | Minimum floor = 0.3 |
| PRIVACY | 0.0-1.0 | Data protection compliance |
| NOVELTY | 0.0-1.0 | Degree of innovation |
| SECURITY | 0.0-1.0 | Access control, vulnerability management |

### Constitutional Invariants (Non-Negotiable)

1. Audit trails must be immutable
2. Human oversight required for High Risk actions
3. Self-modification requires Supermajority Consensus

### Genesis Protocol (YAML-based rule specification)

```yaml
invariants:
  - "Audit trails must be immutable"
  - "Human oversight is required for High Risk actions"
  - "Self-modification requires Supermajority Consensus"

policies:
  PROPOSAL_SUBMISSION:
    rules:
      - rule: "RiskCheck"
        condition: "proposal.effects.risk < 0.8"
        action: "APPROVE"
        else: "ESCALATE_TO_IRB"
```

### Governance Bodies

| Body | Authority |
|------|-----------|
| **AI-IRB** | Final ethical/compliance/regulatory authority. Decisions: Approve, Conditionally Approve, Reject, Defer |
| **AI-IRB Liaison** | Primary coordinator between teams and IRB |
| **AI Governance Office** | Decision repository, compliance tracking |
| **Security Administrator** | Access control, vulnerability management |
| **Project Sponsor** | Budget, resources, strategic alignment |

### Lifecycle Gates

| Gate | Authority | Trigger |
|------|-----------|---------|
| Gate 12 (Project Start) | Sponsor + AI-IRB Liaison | Initiation |
| Gate 6 (Requirements Locked) | Sponsor + AI-IRB + QA | Requirement completion |
| Gate 2 (Pre-Deployment) | QA + Operations | Staging validation |
| Gate 0 (Production) | Operations + Sponsor | Final sign-off |
| Post-Deploy (30-90 days) | AI-IRB + Operations | Performance review |

### Compliance Frameworks Referenced

GDPR, HIPAA, ISO 27001, SOC2, NIST

### Directory Structure

```
AI-SDLC-SOPs/
├── sops/                    (43 SOP documents, series: 1000, 1100, 1200, 1300, 2000)
├── diagrams/                (Sequence diagrams in PNG/SVG/PlantUML)
├── aegis_backend/           (Governance rule engine implementation)
│   ├── core/                (CGR engine, types, genesis protocol)
│   ├── vm/                  (Virtual machine for rule execution)
│   ├── crypto/              (Cryptographic verification)
│   └── exochain/            (Immutable audit ledger)
├── syntaxis_web/            (Web UI for governance visualization/editing)
├── aeonsynthesis_mcp/       (Network/protocol implementation)
├── docs/                    (Strategic documentation)
└── whitepaper.md + whitepaper_agi.md
```

## WeftOS Relevance

| Feature | WeftOS Phase | Application |
|---------|-------------|-------------|
| Constitutional invariants | **K0** | Kernel-level governance rules (immutable) |
| Immutable audit ledger | **K0** | Witness chain integration with exochain |
| CGR rule engine | **K1** | Capability decision enforcement (type-safe) |
| Three-branch separation | **K1** | Agents can't modify their own governance rules |
| Effect algebra | **K1** | Quantified risk/fairness scoring on capability requests |
| Permit/Defer/Deny decisions | **K1** | Maps directly to cognitum-gate three-way decisions |
| Role-based escalation | **K1** | Agent capability escalation paths |
| Lifecycle gates | **K5** | App deployment gates in weftapp.toml [rules] |
| Genesis protocol YAML | **K5** | Template for governance rule specification |
| Drift detection triggers | **K5** | Model re-validation in SONA learning |
| Compliance frameworks | **K5** | App compliance requirements |

## Integration Strategy

### Phase 1: Governance Types
- Define `GovernancePolicy`, `EffectVector`, `GovernanceDecision` types in clawft-kernel
- Map to cognitum-gate Permit/Defer/Deny decisions
- Genesis protocol YAML parser for weftapp.toml `[rules]`

### Phase 2: CGR Rule Engine
- Port AEGIS CGR engine concepts to Rust (already Rust backend)
- Integrate with cognitum-gate for enforcement
- Constitutional invariants as kernel-level types (violations = compile errors)

### Phase 3: Full Governance
- Witness chain audit trail for all governance decisions
- Effect algebra scoring on every capability request
- Compliance framework selection in app manifests
- Lifecycle gates for app deployment

## Where to Look

| Topic | Location |
|-------|----------|
| CGR Engine | `aegis_backend/core/` |
| Genesis Protocol | `aegis_backend/core/` (genesis.rs or types.rs) |
| VM for rule execution | `aegis_backend/vm/` |
| Crypto verification | `aegis_backend/crypto/` |
| Exochain audit ledger | `aegis_backend/exochain/` |
| Web UI | `syntaxis_web/` |
| SOPs (governance rules) | `sops/` (43 documents) |
| Whitepaper (philosophy) | `whitepaper.md` |
| AGI whitepaper | `whitepaper_agi.md` |
| Diagrams | `diagrams/` |
| MeshCORE protocol | `AI_README_MeshCORE.md` |

## Key Design Insight

Hard constraints (mathematically enforced) replace soft constraints (easily bypassed). The CGR engine makes governance violations impossible at the type level, not just audited after the fact. This is the "safe kernel that cannot be hacked the same way agents can" -- agents execute within bounds defined by an immutable governance layer they cannot modify.

Combined with exochain's cryptographic substrate (HLC, DID, MMR audit), this creates a governance-first kernel where:
- Agents are the "Executive" branch (they act)
- The CGR engine is the "Judicial" branch (it validates)
- SOPs/rules are the "Legislative" branch (they define boundaries)
- No branch can modify another's constraints
