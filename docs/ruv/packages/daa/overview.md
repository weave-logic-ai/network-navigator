# DAA: Decentralized Autonomous Applications

**Repo**: https://github.com/ruvnet/daa
**Language**: Rust

## Core Architecture

SDK for building self-managing AI applications with built-in governance, economic incentives, and autonomous operation.

### MRAP Autonomy Loop

```
Monitor -> Reason -> Act -> Reflect -> Adapt
  |          |        |        |         |
  env      AI/LLM   execute  metrics   strategy
  data     decision  actions  evaluate  update
```

### Key Components

| Component | Purpose |
|-----------|---------|
| **Orchestrator** | Core coordination and lifecycle |
| **Rule Engine** | Governance constraints (time, budget, behavior) |
| **Token Manager** | Budget allocation, rebalancing, rewards |
| **AI Advisor** | Claude/LLM integration via MCP |
| **Chain** | Blockchain abstraction for state |
| **Swarm** | Multi-agent coordination |

### Governance Rules

```rust
// Rule types supported
TimeConstraint { start: "09:00", end: "17:00" }
BudgetLimit { max_per_hour: 100 }
BehaviorPolicy { require_approval_above: 0.8 }
```

### Builder Pattern

```rust
agent.with_role("reviewer")
     .with_rules(governance_rules)
     .with_ai_advisor(claude_config)
     .with_economy(token_budget)
```

## WeftOS Relevance

| Feature | WeftOS Phase | Application |
|---------|-------------|-------------|
| MRAP loop | K1 | Supervisor Reflect/Adapt hooks |
| Rule engine | K5 | App governance `[rules]` in manifest |
| Token budget | K1 | `ResourceBudget` for agents |
| Builder pattern | K5 | App manifest -> agent config |
| Federated learning | Post-K5 | Distributed agent learning |

## Where to Look

| Topic | Crate |
|-------|-------|
| Lifecycle | `daa-orchestrator` |
| Governance | `daa-rules` |
| Economics | `daa-economy` |
| AI integration | `daa-ai` |
| Multi-agent | `daa-swarm` |
