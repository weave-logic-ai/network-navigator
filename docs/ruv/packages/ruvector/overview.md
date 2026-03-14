# RuVector: Architecture Overview

**Repo**: https://github.com/ruvnet/ruvector
**Language**: Rust (101 crates)
**Local Clone**: `/tmp/ruvector-analysis/`

## Architecture Layers

```
Application (AgenticDB API, REST/gRPC, CLI, MCP)
  |
Index (HNSW, Flat, Filtered, Hyperbolic)
  |
Quantization (Scalar 4x, Product 8x, Binary 32x)
  |
Distance (Euclidean, Cosine, Dot, Manhattan -- SIMD dispatched)
  |
Storage (REDB, Memory, PostgreSQL, RVF format)
  |
SIMD Intrinsics (AVX2/AVX-512, NEON, Scalar fallback, WASM)
```

## Key Crates for WeftOS

### ruvector-cognitive-container
- Path: `crates/ruvector-cognitive-container/src/`
- Files: `container.rs`, `epoch.rs`, `memory.rs`, `witness.rs`
- Pattern: Sealed container with epoch-budgeted tick loop
- Key types: `CognitiveContainer`, `ContainerConfig`, `TickResult`, `ComponentMask`, `EpochController`, `WitnessChain`
- WeftOS use: Boot sequence phasing, phase bitmask, witness audit trail

### cognitum-gate-tilezero
- Path: `crates/cognitum-gate-tilezero/src/`
- Files: `decision.rs`, `evidence.rs`, `permit.rs`, `receipt.rs`, `supergraph.rs`, `merge.rs`, `replay.rs`
- Pattern: 256-tile WASM arbiter with three-filter decision (structural + shift + evidence)
- Key types: `TileZero`, `GateDecision` (Permit/Defer/Deny), `PermitToken`, `WitnessReceipt`, `ActionContext`
- WeftOS use: RBAC three-way decisions, signed capability tokens, hash-chained receipts

### ruvector-cluster
- Path: `crates/ruvector-cluster/src/`
- Files: `consensus.rs`, `discovery.rs`, `shard.rs`
- Pattern: DashMap-based cluster with consistent hashing, health checks, service discovery
- Key types: `ClusterManager`, `ClusterNode`, `NodeStatus`, `DiscoveryService` trait, `ConsistentHashRing`
- WeftOS use: Service registry, health monitoring, discovery trait

### ruvector-delta-consensus
- Path: `crates/ruvector-delta-consensus/src/`
- Files: `causal.rs`, `conflict.rs`, `crdt.rs`
- Pattern: CRDT-based delta sync with vector clocks and causal ordering
- Key types: `DeltaConsensus`, `CausalDelta`, `VectorClock`, `DeltaGossip`, `DeliveryStatus`, `ConflictStrategy`
- WeftOS use: IPC message ordering, pub/sub dissemination, conflict resolution

### ruvector-raft
- Path: `crates/ruvector-raft/src/`
- Files: `election.rs`, `log.rs`, `node.rs`, `rpc.rs`, `state.rs`
- Pattern: Full Raft consensus implementation
- Key types: `RaftNode`, `RaftNodeConfig`, `AppendEntries`, `RequestVote`, `PersistentState`
- WeftOS use: Multi-node WeftOS consensus (future)

### ruvector-nervous-system
- Path: `crates/ruvector-nervous-system/src/`
- Files: `routing.rs`, `eventbus.rs`, `dendrite.rs`, `hdc.rs`, `hopfield.rs`, `plasticity/`
- Pattern: Bio-inspired routing with oscillatory patterns, budget guardrails, sharded event bus
- Key types: `OscillatoryRouter`, `BudgetGuardrail`, `ShardedEventBus`, `CircadianController`, `GlobalWorkspace`
- WeftOS use: IPC routing guardrails, high-throughput event delivery

### sona
- Path: `crates/sona/src/`
- Files: `engine.rs`, `ewc.rs`, `lora.rs`, `reasoning_bank.rs`, `trajectory.rs`, `loops/`
- Pattern: Self-optimizing neural architecture with LoRA + EWC++ + ReasoningBank
- Key types: `SonaEngine`, `MicroLoRA`, `BaseLoRA`, `EwcPlusPlus`, `ReasoningBank`, `TrajectoryBuilder`
- WeftOS use: App-level learning hooks in K5

### mcp-gate
- Path: `crates/mcp-gate/src/`
- Files: `server.rs`, `tools.rs`, `types.rs`
- Pattern: MCP server exposing coherence gate as tools (permit_action, get_receipt, replay_decision)
- WeftOS use: MCP tool pattern for capability checking

### ruvector-tiny-dancer-core
- Path: `crates/ruvector-tiny-dancer-core/src/`
- Pattern: FastGRNN sub-millisecond agent routing with uncertainty quantification
- Key types: `Router`, `Candidate`, `CircuitBreaker`, `AgentDbStore`, `RoutingRequest`, `RoutingResponse`
- Features: Candidate scoring, conformal prediction fallback, circuit breaker, learned routing via SQLite/AgentDB
- WeftOS use: K0/K1 syscall routing (which agent handles this request?), self-learning dispatch

### rvf (RuVector Format)
- Path: `crates/rvf/`
- Sub-crates: `rvf-wasm/`, `rvf-ebpf/`, `rvf-kernel/`, `rvf-crypto/`, `rvf-wire/`, `rvf-runtime/`
- Pattern: 24-segment self-describing container format (4 KB manifest, instant boot)
- Key segments: `MANIFEST_SEG`, `VEC_SEG`, `INDEX_SEG`, `KERNEL_SEG`, `WASM_SEG` (5.5 KB), `EBPF_SEG`, `WITNESS_SEG`, `CRYPTO_SEG`, `COW_MAP_SEG`, `MEMBERSHIP_SEG`
- Key types: `KernelBuilder`, `BuiltKernel`, `MembershipFilter` (bitmap capability enforcement), `EbpfCompiler`
- WeftOS use: K3 WASM sandbox reference, K4 container format reference, K1 MembershipFilter for capability bitmaps

### prime-radiant
- Path: `crates/prime-radiant/src/`
- Pattern: Coherence engine using sheaf Laplacian, persistence homology, Betti numbers
- Purpose: Detects AI hallucinations via topological data analysis
- WeftOS use: Reference for K1 agent health/coherence scoring

## Notable Examples

| Example | Path | Description |
|---------|------|-------------|
| OSpipe | `examples/OSpipe/` | Personal AI memory with safety pipeline |
| Agentic-Jujutsu | `examples/agentic-jujutsu/` | Lock-free VCS for multi-agent coordination |
| RVF Kernel | `examples/rvf-kernel-optimized/` | Optimized kernel boot from RVF |
| Neural Trader | `examples/neural-trader/` | Financial trading agent |
| Verified Apps | `examples/verified-applications/` | 10 proof-carrying applications |
| Spiking Network | `examples/spiking-network/` | Hybrid spiking + SIMD + attention |
| Edge Network | `examples/edge-net/` | Distributed collective AI |
| Ultra-Low Latency | `examples/ultra-low-latency-sim/` | Quadrillion sims/sec |
| Delta Behavior | `examples/delta-behavior/` | Agent drift detection + anomaly signatures |
| RV-DNA Genomics | `examples/dna/` | HNSW k-mer search in 12ms with witness chain |

## Where to Look for Specific Topics

| Topic | Primary Crate | Secondary |
|-------|--------------|-----------|
| Consensus | `ruvector-raft`, `ruvector-delta-consensus` | `ruvector-dag`, `ruvector-cluster` |
| IPC / Messaging | `ruvector-delta-consensus` | `ruvector-nervous-system` (EventBus) |
| RBAC / Permissions | `cognitum-gate-tilezero` | `mcp-gate` |
| WASM Sandbox | `ruvector-cognitive-container` | `rvf` (WASM_SEG) |
| Container / Boot | `ruvector-cognitive-container` | `rvf` (KERNEL_SEG) |
| Service Discovery | `ruvector-cluster` | - |
| Health Monitoring | `ruvector-cluster`, `ruvector-coherence` | `ruvector-metrics` |
| Self-Learning | `sona` | `ruvector-domain-expansion` |
| Agent Routing | `ruvector-tiny-dancer-core` | `ruvector-router-core` |
| Coherence Scoring | `prime-radiant` | `ruvector-coherence` |
| Wire Format | `rvf` (`rvf-wire`) | 64-byte SIMD-aligned segments |
| Capability Bitmaps | `rvf` (`rvf-runtime`, `MembershipFilter`) | - |
| eBPF Fast-Path | `rvf` (`rvf-ebpf`, `EbpfCompiler`) | XDP/socket/TC |
| Kernel Boot | `rvf` (`rvf-kernel`, `KernelBuilder`) | QEMU/Firecracker |
| Audit Trail | `cognitum-gate-tilezero` (receipts) | `ruvector-cognitive-container` (witness) |
| P2P Networking | See QuDAG package | - |
| Token Economy | `ruvector-economy-wasm` | See DAA package |
