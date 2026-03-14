# ruv Ecosystem Research Index

**Last Updated**: 2026-02-28
**Researcher Skill**: `skills/ruv-researcher/SKILL.md`

## Purpose

This directory contains ongoing research notes on the ruv (ruvnet) ecosystem of Rust crates, TypeScript packages, and agent frameworks. The goal is to maintain an up-to-date reference for WeftOS development, identifying reusable patterns, integration points, and architecture inspiration.

## Directory Structure

```
.planning/ruv/
  README.md                     -- This file (high-level index)
  crate-index.md                -- Complete crate/package listing with descriptions
  packages/
    ruvector/                   -- RuVector: vector DB + self-learning engine
      overview.md               -- Architecture, key patterns, crate map
    agentic-flow/               -- Agentic-Flow: agent orchestration
      overview.md               -- MCP tools, swarm patterns, AgentDB
    ruflo/                      -- Ruflo: Claude agent platform
      overview.md               -- Queen/worker, ReasoningBank, consensus
    qudag/                      -- QuDAG: quantum-resistant communication
      overview.md               -- P2P, DAG consensus, .dark domains
    daa/                        -- DAA: Decentralized Autonomous Applications
      overview.md               -- MRAP loop, governance, token economy
    exochain/                   -- Exochain: cryptographic data fabric
      overview.md               -- DAG-BFT, DID, HLC, consent, governance
    ai-sdlc/                    -- AI-SDLC-SOPs: AI governance framework
      overview.md               -- SOPs, compliance, lifecycle gates
```

## Repos

| Repo | URL | Language | Crates/Packages |
|------|-----|----------|-----------------|
| ruvector | https://github.com/ruvnet/ruvector | Rust | 101 crates |
| agentic-flow | https://github.com/ruvnet/agentic-flow | TypeScript/Rust | ~15 packages |
| ruflo | https://github.com/ruvnet/ruflo | TypeScript | ~10 packages |
| QuDAG | https://github.com/ruvnet/QuDAG | Rust | 4 crates |
| DAA | https://github.com/ruvnet/daa | Rust | 6 crates |
| exochain | https://github.com/exochain/exochain | Rust | 6 crates |
| AI-SDLC-SOPs | https://github.com/AISDLC/AI-SDLC-SOPs | Markdown/Rust (AEGIS) | 43 SOPs |

## Key Concepts for WeftOS

| Concept | Source | WeftOS Phase |
|---------|--------|-------------|
| Cognitive Containers | ruvector `ruvector-cognitive-container` | K0 (boot) |
| Witness Chains | ruvector `cognitum-gate-tilezero` | K0 (audit) |
| Cluster Manager | ruvector `ruvector-cluster` | K0 (services) |
| Coherence Gate (Permit/Deny/Defer) | ruvector `cognitum-gate-tilezero` | K1 (RBAC) |
| MRAP Autonomy Loop | DAA | K1 (supervisor) |
| Delta Consensus + CRDTs | ruvector `ruvector-delta-consensus` | K2 (IPC) |
| Vector Clocks | ruvector `ruvector-delta-consensus` | K2 (ordering) |
| Gossip Protocol | ruvector `ruvector-delta-consensus` | K2 (pub/sub) |
| Nervous System Routing | ruvector `ruvector-nervous-system` | K2 (routing) |
| Epoch Budget / Fuel | ruvector `ruvector-cognitive-container` | K3 (WASM) |
| Service Discovery | ruvector `ruvector-cluster` | K4 (containers) |
| SONA Self-Optimization | ruvector `sona` | K5 (learning) |
| Governance Rules | DAA | K5 (app rules) |
| HLC Causal Ordering | exochain `exo-core` | K2 (IPC ordering) |
| DID Identity | exochain `exo-identity` | K1 (agent identity) |
| Gatekeeper Trait | exochain `exo-consent` | K1 (capability checking) |
| MMR Audit Trail | exochain `exo-dag` | K0 (audit) |
| Bailment Consent | exochain `exo-consent` | K5 (data governance) |
| CGR Rule Engine | AI-SDLC (AEGIS) | K1 (governance) |
| Effect Algebra | AI-SDLC (AEGIS) | K1 (risk scoring) |
| Three-Branch Governance | AI-SDLC | K6 (distributed governance) |
| Environment-Scoped RBAC | WeftOS (09-environments) | K1/K6 (environments) |
| Self-Learning Loop | WeftOS (09-environments) + SONA | K5/K6 (learning) |

## Updating This Research

Use the `ruv-researcher` skill:
```
/ruv-researcher update ruvector    -- Re-analyze ruvector repo, update notes
/ruv-researcher search "consensus" -- Find where consensus is implemented across repos
/ruv-researcher compare K2         -- Cross-reference K2 plan with ruv ecosystem
```
