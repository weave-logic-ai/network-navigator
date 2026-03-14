# Exochain: Architecture Overview

**Repo**: https://github.com/exochain/exochain
**Language**: Rust (6 crates, ~1,621 LOC)
**Status**: MVP Phase (v2.2 spec, v0.1.0 code)

## Core Architecture

Cryptographic data fabric with DAG-BFT consensus, DID identity, and governance-first design. Not an execution engine -- an event-sourced audit/consent substrate.

### Key Components

| Component | Crate | Purpose |
|-----------|-------|---------|
| **Crypto** | `exo-core` | BLAKE3 hashing, Ed25519 signing, domain separators, HLC |
| **DAG Engine** | `exo-dag` | Event DAG, MMR accumulator, SMT state, checkpoints |
| **Identity** | `exo-identity` | W3C DIDs (`did:exo:`), key rotation, risk attestation |
| **Consent** | `exo-consent` | Bailment contracts, policies, access control |
| **API** | `exo-api` | GraphQL (stub), libp2p P2P (TCP+Noise+Yamux) |
| **Gatekeeper** | `exo-gatekeeper` | TEE interface, attestation verification (stub) |

### Cryptography

| Algorithm | Purpose | ruvector Compat |
|-----------|---------|-----------------|
| BLAKE3 | Hashing (32-byte) | Direct (same as ruvector) |
| Ed25519 | Signatures (ed25519-dalek v2.1) | Direct (same as ruvector) |
| XChaCha20-Poly1305 | Vault encryption (planned) | Matches QuDAG |
| Domain separators | Prevent cross-protocol attacks | Adopt for all signing |

**Missing (vs ruvector)**: ML-DSA-65, ML-KEM-768, SHAKE-256 -- needs dual-key extension for PQ

### Hybrid Logical Clock (HLC)

```rust
pub struct HybridLogicalClock {
    pub physical_ms: u64,  // Wall-clock
    pub logical: u32,      // Counter for concurrent events
}
```

Better than vector clocks for WeftOS IPC:
- Causal ordering without global consensus
- Handles clock skew gracefully
- O(1) storage (vs O(n) for vector clocks where n = agents)

### Data Structures

| Structure | Purpose | WeftOS Use |
|-----------|---------|------------|
| **MMR** (Merkle Mountain Range) | Append-only event accumulator with O(log n) proofs | K0 audit trail |
| **SMT** (Sparse Merkle Tree) | State root (key-value with proofs) | K2 IPC state |
| **EventInclusionProof** | Bottom-up hash reconstruction against event_root | Audit verification |

### Identity (DID)

```rust
pub type Did = String;  // "did:exo:<base58(blake3(pubkey)[0..20])>"
```

- DID derived from genesis key (immutable, survives key rotation)
- Key versioning with `valid_from` / `revoked_at`
- Risk attestation: score (0-100), confidence (basis points), signed + timestamped

### Consent & Access Control

```rust
pub struct Policy {
    pub effect: Effect,          // Allow | Deny
    pub subjects: AccessorSet,   // Any | Specific(Vec<Did>) | Group(String)
    pub resources: Vec<String>,
    pub conditions: Vec<Condition>,
}

pub trait Gatekeeper {
    fn request_access(&self, subject: &Did, resource_id: &str, context: &str)
        -> Result<AccessGrant, GatekeeperError>;
}
```

**Bailment model**: PII/data never touches ledger. Only content-addressed hashes + consent policies. GDPR-compliant audit trails.

### Governance Patterns

- **Domain separators**: `b"EXOCHAIN-EVENT-SIG-v1"` prevents signature confusion across protocols
- **Threat matrix**: 13 identified threats with mitigations mapped to code
- **Traceability matrix**: Spec section -> code mapping
- **Quality gates**: 80% coverage, zero clippy warnings, no unwrap/panic

## WeftOS Relevance

| Feature | WeftOS Phase | Application |
|---------|-------------|-------------|
| HLC causal ordering | **K2** | IPC message ordering (better than VectorClock for local) |
| DID identity | **K1** | Agent identity (persistent across restarts) |
| Gatekeeper trait | **K1** | Capability checking (maps to Permit/Deny/Defer) |
| Risk attestation | **K1** | Agent trust scoring |
| MMR event accumulator | **K0** | Hash-chained audit trail with proofs |
| Domain separators | **K0** | All signing operations |
| Bailment consent | **K5** | App data governance (GDPR compliance) |
| Policy model | **K5** | App rules in weftapp.toml `[rules]` section |
| DAG-BFT (stub) | Post-K5 | Distributed WeftOS consensus |
| libp2p transport | Post-K5 | Distributed agent networking |

## Integration Strategy

### Phase 1: Fork + Extend
- Fork exochain, add ML-DSA-65 dual-key signing alongside Ed25519
- Implement Gatekeeper using cognitum-gate-tilezero backend
- Route WeftOS kernel events through exochain's DAG

### Phase 2: Replace Consensus
- Replace BftGadget stub with ruvector-raft
- Use checkpoint structure as Raft snapshot format
- HLC replaces VectorClock for K2 IPC

### Phase 3: Full Integration
- Map WeftOS PIDs to exochain DIDs
- Use EventInclusionProof for audit compliance
- Bailment model for app data governance

## Where to Look

| Topic | Crate | File |
|-------|-------|------|
| BLAKE3 + Ed25519 + domain sep | `exo-core` | `crypto.rs` |
| Hybrid Logical Clock | `exo-core` | `hlc.rs` |
| Event structure | `exo-core` | `event.rs` |
| DAG append + causality | `exo-dag` | `append.rs` |
| MMR accumulator | `exo-dag` | `mmr.rs` |
| SMT state tree | `exo-dag` | `smt.rs` |
| Inclusion proofs | `exo-dag` | `proof.rs` |
| Checkpoint + finality | `exo-dag` | `checkpoint.rs` |
| BFT consensus (stub) | `exo-dag` | `consensus.rs` |
| DagStore trait | `exo-dag` | `store.rs` |
| DID derivation | `exo-identity` | `did.rs` |
| Key rotation | `exo-identity` | `key.rs` |
| Risk attestation | `exo-identity` | `risk.rs` |
| Bailment + consent | `exo-consent` | `bailment.rs` |
| Policy + AccessorSet | `exo-consent` | `policy.rs` |
| Gatekeeper trait | `exo-consent` | `gatekeeper.rs` |
| libp2p P2P | `exo-api` | `p2p.rs` |
| GraphQL schema | `exo-api` | `schema.rs` |
| Threat matrix | `governance/` | `threat_matrix.md` |
