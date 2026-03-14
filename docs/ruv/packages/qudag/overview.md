# QuDAG: Architecture Overview

**Repo**: https://github.com/ruvnet/QuDAG
**Language**: Rust
**Published**: crates.io as `qudag`

## Core Architecture

Quantum-resistant DAG-based anonymous communication platform for AI agent swarms.

### Key Components

| Component | Purpose |
|-----------|---------|
| **DAG Consensus** | QR-Avalanche: recursive quorum sampling, no leader election |
| **P2P Networking** | LibP2P with Kademlia DHT for peer discovery |
| **Onion Routing** | Multi-hop encrypted routing for anonymity |
| **Dark Domains** | `.dark` address system for decentralized naming |
| **Token Economy** | rUv tokens for resource trading (CPU, storage, bandwidth) |
| **MCP Server** | Native MCP over stdio/HTTP/WS for AI agent integration |

### Cryptography

| Algorithm | Purpose |
|-----------|---------|
| ML-KEM-768 | Key encapsulation (post-quantum) |
| ML-DSA | Digital signatures (post-quantum) |
| BLAKE3 | Hashing |
| ChaCha20Poly1305 | Symmetric encryption |
| Ed25519 | Classical signatures |

### Testnet

4 global nodes: Toronto (bootstrap + MCP), Amsterdam, Singapore, San Francisco.
MCP endpoint: `https://qudag-testnet-node1.fly.dev/mcp`

## WeftOS Relevance

| Feature | WeftOS Phase | Application |
|---------|-------------|-------------|
| LibP2P peer discovery | Post-K5 | Distributed WeftOS agent discovery |
| DAG consensus (leaderless) | Post-K5 | Multi-node WeftOS without leader |
| .dark domains | Post-K5 | Agent naming in distributed deployments |
| MCP server pattern | K2 | MCP tools for IPC |
| Token economy | Post-K5 | Agent resource trading |

## Where to Look

| Topic | Crate |
|-------|-------|
| P2P networking | `qudag-network` |
| Consensus | `qudag` (core) |
| Cryptography | `qudag-crypto` |
| CLI / node mgmt | `qudag-cli` |
