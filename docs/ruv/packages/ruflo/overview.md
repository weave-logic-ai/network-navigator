# Ruflo: Architecture Overview

**Repo**: https://github.com/ruvnet/ruflo
**Language**: TypeScript
**Note**: Formerly claude-flow. Renamed by ruv.

## Core Architecture

- Claude agent orchestration platform
- 54+ specialized agents in coordinated swarms
- Hive-mind with three queen types (Strategic, Tactical, Adaptive)
- Eight worker types (Researcher, Coder, Analyst, Tester, Architect, Reviewer, Optimizer, Documenter)
- Shared memory via LRU cache + SQLite with WAL
- ReasoningBank for pattern learning

## Key Features for WeftOS

### Hive-Mind Consensus
- Three queen types for different coordination needs
- Five consensus algorithms: Raft, BFT, Weighted, Majority, Gossip
- Queen receives 3x weight in decisions
- WeftOS use: Supervisor agent weighting in K1

### ReasoningBank Learning Loop
```
RETRIEVE -> JUDGE -> DISTILL -> CONSOLIDATE -> ROUTE
```
- Pattern storage from task outcomes
- Retrieve similar past experiences
- Judge quality of retrieved patterns
- Distill generalizable knowledge
- Consolidate across sessions
- Route to appropriate future tasks
- WeftOS use: K5 app learning framework

### Anti-Drift Mechanisms
- Hierarchical coordination with frequent checkpoints
- Post-task hooks verify goal alignment
- Drift detection triggers re-planning
- WeftOS use: Supervisor health checks in K1

### Memory Architecture
- Three scopes: project, local, user
- LRU cache for hot data
- SQLite with write-ahead logging for persistence
- Cross-agent knowledge transfer
- WeftOS use: Per-agent memory isolation in K1

### Agent Scoping
- Project scope: shared across all agents in project
- Local scope: per-agent private state
- User scope: persists across sessions
- WeftOS use: `AgentCapabilities.service_access` scoping

## Where to Look

| Topic | Location |
|-------|----------|
| Queen/worker patterns | `src/hive-mind/` |
| Consensus | `src/consensus/` |
| ReasoningBank | `src/learning/` |
| Memory scoping | `src/memory/` |
| Anti-drift | `src/hooks/` |
| Agent types | `src/agents/` |
| Swarm topologies | `src/swarm/` |
