# Agentic-Flow: Architecture Overview

**Repo**: https://github.com/ruvnet/agentic-flow
**Language**: TypeScript + Rust (NAPI/WASM bindings)

## Core Architecture

- 66 specialized agent types across development, security, coordination domains
- 213 MCP tools across swarm, memory, neural, GitHub, performance domains
- SONA (Self-Optimizing Neural Architecture) for adaptive learning
- AgentDB vector database (RuVector backend, 150x faster search)
- QUIC transport for low-latency agent communication
- 5 attention mechanisms (Flash, Multi-Head, Linear, Hyperbolic, MoE)

## Key Packages

### AgentDB (`packages/agentdb`)
- Vector DB for agent memory with self-learning
- 4 storage backends: RuVector (61us), RVF, HNSWLib, sql.js
- 6 cognitive memory patterns: Reflexion, Skills, Causal, Pattern Recognition, Transfer, Bandit
- 9 RL algorithms: Q-Learning, SARSA, DQN, PPO, Actor-Critic, Decision Transformer, MCTS
- QUIC real-time sync with 4 conflict resolution strategies
- WeftOS use: Memory subsystem reference, learning patterns for K5

### Swarm Coordination
- Hierarchical (queen-worker), Mesh (peer), Ring, Star topologies
- Consensus: Raft, BFT, Gossip, CRDT, Weighted/Majority voting
- Anti-drift: frequent checkpoints via post-task hooks
- WeftOS use: Topology patterns for K2 IPC routing

### Routing (LLM Router)
- Q-Learning router with 8 Mixture-of-Experts
- Quality-aware model selection (89% accuracy)
- 60% cost savings via intelligent routing
- WeftOS use: Reference for tool routing in K1

### Hooks System
- 12 context-triggered background workers
- Pre/post task, session start/end, file change detection
- Self-learning from hook outcomes
- WeftOS use: K5 app lifecycle hooks

## Where to Look

| Topic | Location |
|-------|----------|
| Agent spawning | `src/agents/` |
| MCP tools | `src/mcp/` (213 tools) |
| Swarm coordination | `src/swarm/` |
| Memory/AgentDB | `packages/agentdb/` |
| QUIC transport | `crates/agentic-flow-quic/` |
| Attention mechanisms | `src/attention/` |
| Hooks/workers | `src/hooks/` |
| Learning/SONA | `src/learning/` |
