# ruv Ecosystem: Complete Crate & Package Index

**Last Updated**: 2026-02-28
**Source**: `git clone --depth 1 https://github.com/ruvnet/ruvector` analysis

---

## ruvector (101 Rust crates)

### Core Database

| Crate | Purpose | WeftOS Relevance |
|-------|---------|-----------------|
| `ruvector-core` | Core vector DB (HNSW, storage, SIMD distance) | Reference for memory subsystem |
| `ruvector-collections` | Multi-tenant collection management | Service registry pattern |
| `ruvector-filter` | Metadata filtering engine | Capability filtering |
| `ruvector-math` | Math utilities (SIMD-optimized) | - |
| `ruvector-math-wasm` | WASM math target | - |
| `ruvector-metrics` | Prometheus metrics export | Health monitoring |
| `ruvector-profiler` | Performance profiling | Kernel profiling |

### Indexing & Search

| Crate | Purpose | WeftOS Relevance |
|-------|---------|-----------------|
| `ruvector-hyperbolic-hnsw` | Hyperbolic HNSW for hierarchy-aware search | - |
| `ruvector-hyperbolic-hnsw-wasm` | WASM target | - |
| `micro-hnsw-wasm` | Minimal HNSW for browser | - |
| `ruvector-solver` | Sublinear solvers (PageRank, CG, Laplacian) | - |
| `ruvector-solver-node` | Node.js N-API solver | - |
| `ruvector-solver-wasm` | WASM solver | - |

### Distributed Systems

| Crate | Purpose | WeftOS Relevance |
|-------|---------|-----------------|
| `ruvector-cluster` | Cluster management, consistent hashing, discovery | **K0**: Service registry, health, discovery |
| `ruvector-raft` | Raft consensus (leader election, log replication) | **K2**: Consensus for multi-node WeftOS |
| `ruvector-replication` | Multi-master replication, failover, conflict | **K4**: Container failover |
| `ruvector-delta-consensus` | CRDT-based delta sync, vector clocks | **K2**: Causal IPC ordering |
| `ruvector-delta-core` | Core delta types and operations | **K2**: Message delta types |
| `ruvector-delta-graph` | Graph-aware delta operations | - |
| `ruvector-delta-index` | Index-aware delta operations | - |
| `ruvector-delta-wasm` | WASM delta target | - |
| `ruvector-snapshot` | Point-in-time snapshots | **K3**: WASM state snapshots |
| `ruvector-dag` | DAG consensus (non-linear) | Reference for QuDAG |
| `ruvector-dag-wasm` | WASM DAG target | - |

### AI & Learning

| Crate | Purpose | WeftOS Relevance |
|-------|---------|-----------------|
| `sona` | SONA self-optimizing engine (LoRA, EWC++, ReasoningBank) | **K5**: App learning hooks |
| `ruvector-gnn` | Graph Neural Network engine | - |
| `ruvector-gnn-node` | Node.js GNN | - |
| `ruvector-gnn-wasm` | WASM GNN | - |
| `ruvector-attention` | 46 attention mechanisms | Reference for routing |
| `ruvector-attention-cli` | Attention CLI | - |
| `ruvector-attention-node` | Node.js attention | - |
| `ruvector-attention-wasm` | WASM attention | - |
| `ruvector-attention-unified-wasm` | Unified WASM attention | - |
| `ruvector-attn-mincut` | Min-cut gated attention | Coherence check |
| `ruvector-domain-expansion` | Cross-domain transfer learning | - |
| `ruvector-domain-expansion-wasm` | WASM target | - |
| `ruvector-learning-wasm` | WASM learning | - |
| `ruvector-sparse-inference` | PowerInfer-style sparse inference | - |
| `ruvector-sparse-inference-wasm` | WASM sparse inference | - |
| `ruvector-temporal-tensor` | Time-series tensor ops | - |
| `ruvector-temporal-tensor-wasm` | WASM target | - |

### Neural & Bio-inspired

| Crate | Purpose | WeftOS Relevance |
|-------|---------|-----------------|
| `ruvector-nervous-system` | Bio-inspired routing, EventBus, HDC | **K2**: Routing, BudgetGuardrail |
| `ruvector-nervous-system-wasm` | WASM target | - |
| `ruvector-coherence` | Spectral coherence metrics | Health/quality scoring |

### Graph Processing

| Crate | Purpose | WeftOS Relevance |
|-------|---------|-----------------|
| `ruvector-graph` | Graph storage and querying (Cypher) | - |
| `ruvector-graph-node` | Node.js graph | - |
| `ruvector-graph-wasm` | WASM graph | - |
| `ruvector-graph-transformer` | Physics/bio-informed transformers | - |
| `ruvector-graph-transformer-node` | Node.js target | - |
| `ruvector-graph-transformer-wasm` | WASM target | - |
| `ruvector-mincut` | Min-cut optimization | Coherence gate |
| `ruvector-mincut-node` | Node.js target | - |
| `ruvector-mincut-wasm` | WASM target | - |
| `ruvector-mincut-gated-transformer` | Mincut-gated attention | - |
| `ruvector-mincut-gated-transformer-wasm` | WASM target | - |

### Routing & Inference

| Crate | Purpose | WeftOS Relevance |
|-------|---------|-----------------|
| `ruvector-router-core` | Vector DB + HNSW indexing core | - |
| `ruvector-router-cli` | Router CLI | - |
| `ruvector-router-ffi` | FFI bindings | - |
| `ruvector-router-wasm` | WASM router | - |
| `ruvector-tiny-dancer-core` | FastGRNN semantic routing (<1ms), circuit breaker, learned dispatch | **K0/K1**: Agent routing, self-learning dispatch |
| `ruvector-tiny-dancer-node` | Node.js target | - |
| `ruvector-tiny-dancer-wasm` | WASM target | - |
| `ruvllm` | Local LLM inference (GGUF) | - |
| `ruvllm-cli` | LLM CLI | - |
| `ruvllm-wasm` | WASM LLM | - |

### Cognitum Gate (Coherence/Safety)

| Crate | Purpose | WeftOS Relevance |
|-------|---------|-----------------|
| `cognitum-gate-kernel` | Kernel-level coherence verification | **K0**: Audit trail |
| `cognitum-gate-tilezero` | 256-tile coherence arbiter (Permit/Defer/Deny) | **K1**: RBAC decisions |
| `mcp-gate` | MCP server for coherence gate | **K1**: MCP capability tools |

### RVF Format

| Crate | Purpose | WeftOS Relevance |
|-------|---------|-----------------|
| `rvf` | RVF format (24 segments, COW, witness, kernel, WASM, eBPF) | **K0-K5**: Universal container format |
| `rvf-wasm` | 5.5 KB WASM query runtime, no allocator, 14 C exports | **K3**: WASM sandbox reference |
| `rvf-ebpf` | eBPF compiler (XDP/socket/TC), sub-microsecond distance | **K2**: Kernel-space fast-path |
| `rvf-kernel` | Linux microkernel builder (bzImage + initramfs), 125ms boot | **K4**: Container kernel boot |
| `rvf-crypto` | SHAKE-256 witness chains + ML-DSA-65/Ed25519 dual-signing | **K0**: Audit trail crypto |
| `rvf-wire` | Segment-based wire format, 64-byte SIMD alignment, crash-safe | **K2**: IPC wire format |
| `rvf-runtime` | MembershipFilter bitmap capability enforcement | **K1**: Capability bitmaps |

### Cognitive Container

| Crate | Purpose | WeftOS Relevance |
|-------|---------|-----------------|
| `ruvector-cognitive-container` | Sealed container with epoch budgets, witness | **K0**: Boot sequence, audit |

### Verified Computing

| Crate | Purpose | WeftOS Relevance |
|-------|---------|-----------------|
| `ruvector-verified` | Proof-gated mutations, training certificates | Security patterns |
| `ruvector-verified-wasm` | WASM target | - |

### Edge & IoT

| Crate | Purpose | WeftOS Relevance |
|-------|---------|-----------------|
| `rvlite` | Minimal vector DB for edge | - |
| `ruvector-dither` | Dithering for edge display | - |
| `ruvector-crv` | Compact representation vectors | - |

### Specialized

| Crate | Purpose | WeftOS Relevance |
|-------|---------|-----------------|
| `ruvector-bench` | Benchmarking suite | Testing patterns |
| `ruvector-economy-wasm` | Token economy (WASM) | DAA integration |
| `ruvector-exotic-wasm` | Exotic distance metrics (WASM) | - |
| `ruvector-fpga-transformer` | FPGA inference | - |
| `ruvector-fpga-transformer-wasm` | WASM target | - |
| `ruvector-wasm` | Core WASM bindings | - |
| `ruvector-node` | Core Node.js bindings | - |
| `ruvector-server` | HTTP/REST server | - |
| `ruvector-cli` | CLI interface | - |
| `ruvector-postgres` | PostgreSQL integration (230+ functions) | - |
| `prime-radiant` | Sheaf Laplacian coherence engine, hallucination detection | **K1**: Agent coherence scoring |
| `thermorust` | Thermodynamic computing | - |
| `profiling` | Profiling utilities | - |

### Quantum Computing

| Crate | Purpose | WeftOS Relevance |
|-------|---------|-----------------|
| `ruQu` | Quantum computing core | - |
| `ruqu-algorithms` | Quantum algorithms | - |
| `ruqu-core` | Quantum core types | - |
| `ruqu-exotic` | Exotic quantum ops | - |
| `ruqu-wasm` | WASM quantum | - |

### Robotics

| Crate | Purpose | WeftOS Relevance |
|-------|---------|-----------------|
| `agentic-robotics-core` | Robotics agent core | - |
| `agentic-robotics-rt` | Real-time robotics | - |
| `agentic-robotics-embedded` | Embedded robotics | - |
| `agentic-robotics-mcp` | MCP robotics | - |
| `agentic-robotics-node` | Node.js robotics | - |
| `agentic-robotics-benchmarks` | Robotics benchmarks | - |

---

## agentic-flow (TypeScript/Rust packages)

| Package | Purpose | WeftOS Relevance |
|---------|---------|-----------------|
| `@agentic-flow/core` | Core orchestration engine | Agent spawning patterns |
| `@agentic-flow/agents` | 66 agent type definitions | Agent type reference |
| `agentdb` | Vector DB for agents (RuVector backend) | Memory subsystem |
| `@agentic-flow/quic` | QUIC transport layer | Future distributed IPC |
| `@agentic-flow/hooks` | Self-learning hooks system | K5 learning hooks |
| `@agentic-flow/attention` | 5 attention mechanisms | Routing |
| `@agentic-flow/gnn` | GNN query refinement | - |

---

## ruflo (TypeScript packages)

| Package | Purpose | WeftOS Relevance |
|---------|---------|-----------------|
| `ruflo` | Core orchestration | Swarm patterns |
| Hive-mind module | Queen/worker consensus | K2 topic consensus |
| ReasoningBank module | Pattern learning | K5 app learning |
| Memory module | SQLite + LRU cache | Memory subsystem |

---

## QuDAG (Rust crates)

| Crate | Purpose | WeftOS Relevance |
|-------|---------|-----------------|
| `qudag` | Core protocol | P2P agent messaging |
| `qudag-network` | LibP2P networking | Future distributed WeftOS |
| `qudag-crypto` | ML-KEM/ML-DSA crypto | Post-quantum security |
| `qudag-cli` | CLI for node management | - |

---

## DAA (Rust crates)

| Crate | Purpose | WeftOS Relevance |
|-------|---------|-----------------|
| `daa-orchestrator` | Core coordination | App lifecycle |
| `daa-rules` | Governance rule engine | **K5**: App rules |
| `daa-economy` | Token management | Resource budgets |
| `daa-ai` | AI advisor (MCP) | Agent reasoning |
| `daa-chain` | Blockchain abstraction | - |
| `daa-swarm` | Multi-agent coordination | Swarm patterns |
