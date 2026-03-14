# Exochain Deep Analysis for WeftOS Integration

**Repo**: https://github.com/exochain/exochain
**Language**: Rust (6 crates, workspace resolver v2)
**Version**: v0.1.0 (spec v2.2, green-field implementation)
**License**: Apache-2.0
**Analysis Date**: 2026-03-01
**Purpose**: Evaluate exochain as the cryptographic substrate for WeftOS

---

## 1. Crate Inventory

| Crate | Path | Purpose | Dependencies (internal) | Dependencies (external) |
|-------|------|---------|------------------------|------------------------|
| **exo-core** | `crates/exo-core/` | Cryptographic primitives, event model, HLC | None | serde, serde_cbor, blake3, ed25519-dalek, thiserror, bs58, hex |
| **exo-dag** | `crates/exo-dag/` | DAG engine, MMR/SMT accumulators, checkpoints, BFT stub, storage trait | exo-core | serde, thiserror, async-trait, ed25519-dalek |
| **exo-identity** | `crates/exo-identity/` | DID lifecycle, key management, risk attestation | exo-core | serde, thiserror, ed25519-dalek, serde_cbor, blake3, bs58 |
| **exo-consent** | `crates/exo-consent/` | Bailment contracts, policies, gatekeeper logic | exo-core, exo-identity | serde, thiserror |
| **exo-api** | `crates/exo-api/` | GraphQL schema (stub), libp2p P2P networking | exo-core, exo-identity, exo-dag | async-graphql, axum, tokio, tracing, hex, libp2p |
| **exo-gatekeeper** | `crates/exo-gatekeeper/` | TEE/enclave interfaces (stub) | exo-core | serde, thiserror, async-trait |

### Dependency Graph

```
exo-core (leaf crate, no internal deps)
  |
  +---> exo-dag (depends on exo-core)
  +---> exo-identity (depends on exo-core)
  |       |
  |       +---> exo-consent (depends on exo-core, exo-identity)
  |
  +---> exo-api (depends on exo-core, exo-identity, exo-dag)
  +---> exo-gatekeeper (depends on exo-core)
```

---

## 2. Core Data Structures

### 2.1 Blake3Hash (`exo-core::crypto`)

```rust
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct Blake3Hash(pub [u8; 32]);
```

- 32-byte BLAKE3 hash wrapper
- Serde-aware: hex encoding for human-readable, raw bytes for binary (CBOR)
- Implements `From<[u8; 32]>`, `AsRef<[u8]>`, `Debug` (hex display)
- Foundation hash type used everywhere: event IDs, Merkle roots, attestation hashes

### 2.2 HybridLogicalClock (`exo-core::hlc`)

```rust
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq, Copy, PartialOrd, Ord)]
pub struct HybridLogicalClock {
    pub physical_ms: u64,  // Wall-clock milliseconds
    pub logical: u32,      // Lamport-style counter
}
```

- Total ordering: physical_ms first, then logical counter
- `new_event(node_time, parent_times)` follows Spec 9.2: takes max of node clock and parent clocks, increments logical counter when physical time ties
- Handles clock skew: catches up to parent time when node clock is behind
- O(1) storage (unlike vector clocks at O(n))

### 2.3 EventEnvelope (`exo-core::event`)

```rust
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct EventEnvelope {
    pub parents: Vec<Blake3Hash>,           // DAG causality links
    pub logical_time: HybridLogicalClock,   // Causal ordering
    pub author: Did,                        // DID of event creator
    pub key_version: u64,                   // Signing key version
    pub payload: EventPayload,             // Polymorphic payload
}
```

- The hashable portion of an event (excludes event_id and signature to avoid circularity)
- Parents vector establishes DAG structure (multi-parent support)
- Author is a DID string (currently `type Did = String`)

### 2.4 EventPayload (`exo-core::event`)

```rust
#[derive(Clone, Debug, Serialize, Deserialize)]
pub enum EventPayload {
    Genesis { network_id: String },
    IdentityCreated { did_doc_cid: String },
    Opaque(Vec<u8>),  // Generic payload
}
```

- Extensible enum with versioning rules from spec: additive changes in minor versions, breaking changes require major version bump
- `Opaque(Vec<u8>)` variant is the key extensibility point for WeftOS integration
- Nodes MUST accept unknown payload types (future versions) but MAY skip processing

### 2.5 LedgerEvent (`exo-core::event`)

```rust
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct LedgerEvent {
    pub envelope: EventEnvelope,
    pub event_id: Blake3Hash,    // BLAKE3(canonical_cbor(envelope))
    pub signature: Signature,     // Ed25519 signature
}
```

- Immutable, signed, content-addressed record
- `event_id = BLAKE3(canonical_cbor(EventEnvelope))` computed via `compute_event_id()`
- Signature uses domain separator `b"EXOCHAIN-EVENT-SIG-v1"` + protocol version byte

### 2.6 Merkle Mountain Range (`exo-dag::mmr`)

```rust
#[derive(Default, Debug, Clone, Serialize, Deserialize)]
pub struct Mmr {
    pub size: u64,
    pub peaks: Vec<Option<Blake3Hash>>,
}
```

- Append-only accumulator with O(log n) proofs
- Binary-indexed peaks: `peaks[i]` is `Some(hash)` when the i-th bit of size is 1
- `append(leaf)` cascades up through matching peaks
- `get_root()` bags peaks right-to-left
- Used for `event_root` in checkpoints (Spec 9.4)

### 2.7 Sparse Merkle Tree (`exo-dag::smt`)

```rust
#[derive(Default, Debug)]
pub struct Smt {
    pub leaves: HashMap<Blake3Hash, Blake3Hash>,
}
```

- Simplified "Merkle Map" implementation (not a full 256-level SMT)
- Key-value store with sorted-key Merkleization
- `get_root()` sorts keys, hashes (key|value) pairs, then builds binary tree
- Used for `state_root` in checkpoints (derived state: active keys, consents, etc.)
- **Note**: MVP implementation. Full production SMT would need proof generation/verification.

### 2.8 EventInclusionProof (`exo-dag::proof`)

```rust
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct EventInclusionProof {
    pub leaf_index: u64,
    pub mmr_size: u64,
    pub path: Vec<Blake3Hash>,
    pub siblings: Vec<Blake3Hash>,
}
```

- Verifies event inclusion against MMR root
- `verify(root, leaf)` reconstructs hash path bottom-up using index parity (left/right child)
- Simplified MMR proof for MVP; production needs peak bagging integration

### 2.9 CheckpointPayload (`exo-dag::checkpoint`)

```rust
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct CheckpointPayload {
    pub event_root: Blake3Hash,           // MMR root over finalized event_ids
    pub state_root: Blake3Hash,           // SMT root over derived state
    pub height: u64,                       // Sequence number
    pub finalized_events: u64,            // Count of finalized events
    pub frontier: Vec<Blake3Hash>,        // Frontier hashes
    pub validator_sigs: Vec<ValidatorSignature>,
}
```

- Split roots design (Spec 9.4): separate event_root (MMR) and state_root (SMT)
- Domain separator: `b"EXOCHAIN-CHECKPOINT-v1"`
- Contains validator signatures for BFT finality

### 2.10 DID System (`exo-identity::did`)

```rust
pub type Did = String;  // "did:exo:<base58(blake3(pubkey)[0..20])>"

pub struct DidDocument {
    pub id: Did,
    pub verification_methods: Vec<VerificationMethod>,
    pub services: Vec<ServiceEndpoint>,
    pub created: u64,
    pub updated: u64,
}

pub struct VerificationMethod {
    pub id: String,           // "{did}#key-{version}"
    pub key_type: String,     // "Ed25519VerificationKey2020"
    pub controller: Did,
    pub public_key_multibase: String,  // "z" + base58(pubkey)
    pub version: u64,
    pub active: bool,
    pub valid_from: u64,
    pub revoked_at: Option<u64>,
}
```

- DID derivation: `did:exo:<base58(blake3(pubkey)[0..20])>`
- Immutable DID (survives key rotation, derived from genesis key)
- Key versioning with monotonic increment
- Multibase encoding (z-prefix for base58btc)

### 2.11 RiskAttestation (`exo-identity::risk`)

```rust
pub struct RiskAttestation {
    pub subject: Did,
    pub audience: Did,           // Audience binding (prevents replay)
    pub score: u8,               // 0-100 (higher = more trusted)
    pub confidence_bps: u16,     // Basis points (0-10000)
    pub factors_hash: Blake3Hash,
    pub context_hash: Blake3Hash,
    pub nonce: u64,              // Anti-replay
    pub issued_at: u64,
    pub expires_at: u64,
    pub issuer: Did,
    pub signature: Signature,
}
```

- Signed trust score with audience binding
- Expiration checking via `is_expired(current_time)`
- CBOR-serialized preimage for signing (excludes signature field)
- Currently uses raw Ed25519 signing (not domain-separated; TODO in codebase)

### 2.12 Policy System (`exo-consent::policy`)

```rust
pub enum Effect { Allow, Deny }

pub struct Policy {
    pub id: String,
    pub description: String,
    pub effect: Effect,
    pub subjects: AccessorSet,
    pub resources: Vec<String>,
    pub conditions: Vec<Condition>,
}

pub enum AccessorSet {
    Any,
    Specific(Vec<Did>),
    Group(String),
}

pub struct Condition {
    pub type_: String,  // "MFA", "RiskScore", "TimeOfDay"
    pub value: String,  // "true", ">80", "AM"
}
```

- Allow/Deny effect model
- Subject matching: Any, Specific DIDs, or Group
- Condition-based evaluation (MFA, risk score, temporal)
- Default deny (no matching policy = deny)

### 2.13 Bailment (`exo-consent::bailment`)

```rust
pub struct Bailment {
    pub resource_id: String,
    pub depositor: Did,      // Data owner
    pub custodian: Did,      // Custodian holding data off-chain
    pub payload_hash: Blake3Hash,
    pub policy: Policy,
    pub created_at: u64,
}
```

- Legal bailment model for data sovereignty
- PII never touches ledger -- only consent hashes and policies
- GDPR-compliant: data owner retains control via policy

### 2.14 Gatekeeper Trait (`exo-consent::gatekeeper`)

```rust
pub trait Gatekeeper {
    fn request_access(&self, subject: &Did, resource_id: &str, context: &str)
        -> Result<AccessGrant, GatekeeperError>;
    fn attest(&self) -> Result<TeeReport, GatekeeperError>;
}
```

- Policy enforcement interface
- `MockGatekeeper` provided for development (matches policies, default deny)
- TEE attestation verification via `TeeReport { measurement: Blake3Hash, signature }`
- Production: runs in SGX/TrustZone/Nitro

---

## 3. Append-Only / Temporal-Immutable Logging

### How It Works

1. **Event Creation**: Create `EventEnvelope` with parent event_ids, HLC timestamp, author DID, and payload
2. **Canonical Hashing**: `compute_event_id()` serializes envelope to canonical CBOR, then BLAKE3 hashes it
3. **Signing**: `compute_signature()` signs `DOMAIN_SEPARATOR || PROTOCOL_VERSION || event_id` with Ed25519
4. **Validation** (`exo-dag::append`):
   - Verify all parent event_ids exist in store
   - Verify HLC causality: event time > all parent times (strict)
   - TODO: signature verification (requires identity resolution)
   - TODO: HLC physical skew checks
5. **Storage**: Persist via `DagStore::insert_event()`
6. **Integrity Verification** (`verify_integrity()`):
   - Recompute event_id from envelope, compare against stored
   - Verify all parents exist
   - Recursive verification possible

### Key Properties

- **Append-only**: No event can be modified after insertion (content-addressed by BLAKE3 hash)
- **Causality-enforced**: HLC ordering prevents backdating
- **Parent-linked**: Every event (except genesis) references parent events
- **Domain-separated signing**: Prevents cross-protocol signature confusion
- **Canonical encoding**: CBOR ensures deterministic serialization across implementations

### Storage Abstraction

```rust
#[async_trait]
pub trait DagStore: Send + Sync {
    async fn get_event(&self, id: &Blake3Hash) -> Result<LedgerEvent, StoreError>;
    async fn contains_event(&self, id: &Blake3Hash) -> Result<bool, StoreError>;
    async fn insert_event(&self, event: LedgerEvent) -> Result<(), StoreError>;
}
```

- `MemoryStore` provided (HashMap behind `Arc<RwLock<>>`)
- Trait is `async` + `Send + Sync` -- ready for pluggable backends (disk, network)
- No delete/update operations (append-only by design)

---

## 4. Local Chain vs Global/Root Chain

Exochain does NOT have an explicit "local chain" vs "global chain" separation in code. However, the architecture implicitly supports this pattern:

### DAG as Unified Structure

- The DAG allows multiple concurrent branches (events with different parents)
- Each participant (identified by DID) produces their own event stream
- Events from different participants merge when they share parent references
- This naturally creates "per-agent local streams" within a "global DAG"

### Checkpoints as Finality Boundaries

- `CheckpointPayload` with `validator_sigs` acts as the "global root" commitment
- Events below a checkpoint are permanently finalized
- Events above a checkpoint are tentative until the next checkpoint
- The `frontier` field in checkpoints tracks the DAG tips

### WeftOS Mapping

For WeftOS integration, the natural pattern would be:
- **Local chain**: Each agent's event stream (filtered by `author` DID) -- their personal audit trail
- **Global chain**: Checkpoints committed by the kernel validator, finalizing all agent events
- **Cross-agent causality**: Agent B references Agent A's event as parent to establish happened-before

The `HybridLogicalClock` provides causal ordering within and across agent streams without requiring global consensus for every event.

---

## 5. Consensus Mechanisms

### Current State: BFT Stub

```rust
pub struct BftGadget {
    pub current_epoch: u64,
}

impl BftGadget {
    pub fn is_finalized(&self, _checkpoint: &CheckpointPayload) -> bool {
        true  // Stub: always finalized
    }
}
```

The consensus layer is a minimal stub. The spec calls for a HotStuff-derivative BFT protocol with:
- 2f+1 quorum for finality (tolerates f < n/3 Byzantine nodes)
- Checkpoint-based finality (not per-event)
- Leaderless DAG + HotStuff checkpoints
- Target: <2 second deterministic finality

### Checkpoint Finality Model

```rust
pub struct ValidatorSignature {
    pub validator_did: Did,
    pub key_version: u64,
    pub signature: Signature,
}
```

- Checkpoint finality requires collecting `validator_sigs` from 2f+1 validators
- Domain separator `b"EXOCHAIN-CHECKPOINT-v1"` prevents signature reuse
- Signing preimage: domain_sep || event_root || state_root || height || finalized_events || frontier

### Integration Notes for WeftOS

For single-node WeftOS (current scope), the BFT stub is sufficient. The kernel itself is the sole validator. For multi-node WeftOS (future), two paths exist:
1. Use ruvector-raft for leader-based consensus with checkpoint format as Raft snapshot
2. Use exochain's planned HotStuff-derivative for leaderless DAG consensus

---

## 6. Serialization Formats

### Primary: CBOR (Canonical)

- **Crate**: `serde_cbor` v0.11
- **Usage**: Canonical encoding for event_id computation (`serde_cbor::to_vec(envelope)`)
- **Determinism**: serde_cbor with sorted map keys produces canonical output
- **Binary efficiency**: More compact than JSON for wire and storage

### Secondary: Hex Encoding

- Blake3Hash serializes as hex string in human-readable contexts
- Blake3Hash serializes as raw bytes in binary contexts (CBOR)
- DID uses base58 encoding: `did:exo:<base58(blake3(pubkey)[0..20])>`

### Cross-Implementation Compatibility

The `tools/cross-impl-test/` directory contains a Node.js test harness using `blake3` and `cbor` npm packages to verify hash consistency between Rust and JavaScript implementations.

### Embeddability

Yes, exochain entries can be embedded in other formats:
- `EventPayload::Opaque(Vec<u8>)` accepts arbitrary byte payloads
- `LedgerEvent` is fully serializable via serde (CBOR, JSON, MessagePack, etc.)
- The content-addressed design means events can be stored in any backend that supports key-value semantics
- Blake3Hash is a standard 32-byte value, embeddable anywhere

### WeftOS-Specific Considerations

- WeftOS IPC messages can be wrapped in `EventPayload::Opaque` for audit trails
- RVF containers could store exochain events in the `WITNESS_SEG` segment
- New `EventPayload` variants (e.g., `ProcessSpawned`, `CapabilityGranted`) can be added in minor versions

---

## 7. Public API Surface

### Key Traits

| Trait | Crate | Purpose |
|-------|-------|---------|
| `DagStore` | exo-dag | Storage backend abstraction (get, contains, insert events) |
| `Gatekeeper` | exo-consent | Policy enforcement (request_access, attest) |
| `KeyVault` | exo-identity | Secure key storage (get_key, store_key) |

### Key Structs

| Struct | Crate | Purpose |
|--------|-------|---------|
| `Blake3Hash` | exo-core | 32-byte hash wrapper |
| `HybridLogicalClock` | exo-core | Causal ordering clock |
| `EventEnvelope` | exo-core | Hashable event data |
| `LedgerEvent` | exo-core | Complete signed event |
| `Mmr` | exo-dag | Merkle Mountain Range accumulator |
| `Smt` | exo-dag | Sparse Merkle Tree state root |
| `EventInclusionProof` | exo-dag | Merkle proof for event inclusion |
| `CheckpointPayload` | exo-dag | BFT-finalized DAG snapshot |
| `BftGadget` | exo-dag | Consensus finality (stub) |
| `MemoryStore` | exo-dag | In-memory DagStore impl |
| `DidDocument` | exo-identity | W3C DID document |
| `VerificationMethod` | exo-identity | Key with version/revocation |
| `RiskAttestation` | exo-identity | Signed trust score |
| `Bailment` | exo-consent | Data custody agreement |
| `Policy` | exo-consent | Access control rule |
| `MockGatekeeper` | exo-consent | Development gatekeeper |

### Key Enums

| Enum | Crate | Purpose |
|------|-------|---------|
| `EventPayload` | exo-core | Polymorphic event data (Genesis, IdentityCreated, Opaque) |
| `Effect` | exo-consent | Allow / Deny |
| `AccessorSet` | exo-consent | Any / Specific(Vec<Did>) / Group(String) |

### Key Functions

| Function | Crate | Signature |
|----------|-------|-----------|
| `hash_bytes` | exo-core | `fn(data: &[u8]) -> Blake3Hash` |
| `compute_event_id` | exo-core | `fn(envelope: &EventEnvelope) -> Result<Blake3Hash, serde_cbor::Error>` |
| `compute_signature` | exo-core | `fn(signing_key: &SigningKey, event_id: &Blake3Hash) -> Signature` |
| `verify_signature` | exo-core | `fn(public_key: &VerifyingKey, event_id: &Blake3Hash, signature: &Signature) -> Result<()>` |
| `derive_did` | exo-identity | `fn(public_key_bytes: &[u8]) -> Did` |
| `verify_did_signature` | exo-identity | `fn(doc: &DidDocument, key_id: &str, message_hash: &Blake3Hash, signature: &Signature) -> Result<()>` |
| `rotate_key` | exo-identity | `fn(doc: &mut DidDocument, old_key_id: &str, new_public_key: &[u8; 32], controller: &Did) -> Result<VerificationMethod>` |
| `append_event` | exo-dag | `async fn(store: &impl DagStore, event: LedgerEvent) -> Result<()>` |
| `verify_integrity` | exo-dag | `async fn(store: &impl DagStore, event_id: &Blake3Hash) -> Result<bool>` |
| `create_schema` | exo-api | `fn() -> ApiSchema` (GraphQL) |

---

## 8. Feature Flags and Optional Dependencies

### Current State: None

Exochain currently has **zero feature flags** defined in any crate's Cargo.toml. All dependencies are unconditional.

### Implications for WeftOS

This is a gap. For WeftOS integration, the following feature gates would be needed:

| Proposed Feature | Scope | Purpose |
|-----------------|-------|---------|
| `wasm` | exo-core | Replace `serde_cbor` with `ciborium` (WASM-compatible), gate `ed25519-dalek` features |
| `std` / `no_std` | exo-core | Allow `no_std` for embedded/WASM contexts |
| `tokio` | exo-dag | Gate async runtime dependency |
| `libp2p` | exo-api | Gate heavy P2P networking dependency |
| `graphql` | exo-api | Gate async-graphql + axum dependencies |
| `tee` | exo-gatekeeper | Gate TEE-specific dependencies |

### External Dependencies Analysis

| Dependency | Version | WASM-Safe? | Notes |
|-----------|---------|------------|-------|
| serde | 1.0 | Yes | Core serialization |
| serde_cbor | 0.11 | Mostly | Unmaintained; `ciborium` is the successor |
| blake3 | 1.5 | Yes (with `no_std`) | Has WASM target support |
| ed25519-dalek | 2.1 | Yes (with feature gates) | Needs `rand_core` feature for WASM |
| thiserror | 1.0 | Yes | Error derivation |
| bs58 | 0.5 | Yes | Base58 encoding |
| hex | 0.4 | Yes | Hex encoding |
| async-trait | 0.1 | Yes | Async trait support |
| tokio | 1.32 (full) | No | Needs `wasm-bindgen` features for WASM |
| async-graphql | 7.0 | Partial | Server-side only |
| axum | 0.7 | No | HTTP server |
| libp2p | 0.53 | Partial | Some transports work in WASM |
| chrono | 0.4 | Yes | Time handling (workspace dep, not used in crates) |

---

## 9. WASM Compatibility Considerations

### Current State: Not WASM-Ready

Exochain does **not** currently target WASM. Key blockers:

1. **serde_cbor v0.11**: Unmaintained. The successor `ciborium` has better WASM support. WeftOS already uses modern dependencies; this would need replacement.

2. **tokio with `features = ["full"]`**: The `full` feature includes OS-specific features (file I/O, signals) that don't work in WASM. Would need `wasm-bindgen` feature or alternative runtime.

3. **libp2p with TCP transport**: TCP transport requires OS sockets. WASM needs WebSocket or WebRTC transport instead.

4. **`std::sync::RwLock`**: Used in `MemoryStore`. For WASM single-threaded context, this works but could be simplified.

### What IS WASM-Safe

- **exo-core**: All logic is WASM-compatible (blake3, ed25519-dalek, serde, hex, bs58). Just needs serde_cbor -> ciborium swap.
- **exo-dag** (minus async): The data structures (Mmr, Smt, EventInclusionProof, CheckpointPayload) are all pure computation. Only the `DagStore` trait with `async_trait` needs attention.
- **exo-identity**: All logic is WASM-compatible.
- **exo-consent**: All logic is WASM-compatible.

### WeftOS Integration Path

Since WeftOS already has a `native` / `browser` feature split, the pattern would be:
- `exo-core`: Use unconditionally (both native and browser)
- `exo-dag`: Use data structures unconditionally; gate `DagStore` async trait behind `native` feature
- `exo-identity`, `exo-consent`: Use unconditionally
- `exo-api`: Gate behind `native` feature (axum, libp2p, graphql are server-only)
- `exo-gatekeeper`: Gate behind `native` feature

---

## 10. Hooks / Event Registration

### Current State: No Hook System

Exochain has **no explicit hook/callback/listener/observer system**. There are no `on_event`, `subscribe`, or `register_handler` APIs.

### Implicit Extension Points

1. **DagStore trait**: Custom implementations can intercept events at `insert_event()` -- a natural point for event-driven hooks.

2. **EventPayload enum**: New variants can be added to trigger specific behaviors.

3. **Gatekeeper trait**: Custom implementations can add pre-access hooks.

4. **BftGadget**: The `is_finalized()` method is a hook point for consensus-driven actions.

### WeftOS Integration Approach

For WeftOS, hooks would be implemented at the integration layer:

```rust
// Proposed: Wrap DagStore to fire hooks on append
pub struct HookedDagStore<S: DagStore> {
    inner: S,
    on_append: Vec<Box<dyn Fn(&LedgerEvent) + Send + Sync>>,
    on_finalize: Vec<Box<dyn Fn(&CheckpointPayload) + Send + Sync>>,
}
```

This aligns with WeftOS's existing `ShardedEventBus` (from ruvector-nervous-system) pattern.

---

## 11. Ruvector Cross-References

### Direct Dependencies: None

Exochain has **zero references** to ruvector crates. No `ruvector` string appears anywhere in the exochain codebase (source, Cargo.toml, documentation).

### Shared Cryptographic Primitives

| Primitive | Exochain | Ruvector | Compatible? |
|-----------|----------|----------|-------------|
| BLAKE3 | `blake3` v1.5 | `blake3` (same) | Yes, identical |
| Ed25519 | `ed25519-dalek` v2.1 | `ed25519-dalek` (same) | Yes, identical |
| CBOR | `serde_cbor` v0.11 | N/A | N/A |
| Base58 | `bs58` v0.5 | N/A | N/A |

### Conceptual Overlap

| Concept | Exochain Component | Ruvector Component |
|---------|-------------------|-------------------|
| Witness/Audit Chain | `LedgerEvent` + `DagStore` | `WitnessChain` (cognitive-container) |
| Access Control | `Gatekeeper` + `Policy` | `TileZero` + `GateDecision` |
| Consensus | `BftGadget` (stub) | `RaftNode` (full), `DeltaConsensus` (CRDT) |
| Causal Ordering | `HybridLogicalClock` | `VectorClock` (delta-consensus) |
| Content Addressing | `Blake3Hash` + `EventId` | `rvf` CIDs |
| DID/Identity | `DidDocument` + `derive_did` | N/A |
| Service Discovery | `libp2p` (stub) | `DiscoveryService` trait (cluster) |
| Event Bus | N/A | `ShardedEventBus` (nervous-system) |

### Integration Points

The ruvector `exo-ai-2025` example (in `.planning/ruv/packages/ruvector/ruvector/examples/exo-ai-2025/`) contains experimental exochain integration code with crates like `exo-temporal`, `exo-wasm`, `exo-federation`, `exo-hypergraph`, `exo-manifold`, and `exo-node`. These are experimental/example code, not production, but indicate that ruvector has explored exochain-style patterns.

---

## 12. Code Maturity Assessment

### What's Production-Ready

| Component | Maturity | Notes |
|-----------|----------|-------|
| `Blake3Hash` type | High | Clean, well-tested, serde-aware |
| `HybridLogicalClock` | High | Correct ordering, good tests |
| `EventEnvelope` + `LedgerEvent` | Medium-High | Clean model, CBOR serialization works |
| `compute_event_id` | Medium-High | Canonical CBOR hashing is correct |
| `compute_signature` / `verify_signature` | High | Domain-separated, tested |
| `Mmr` (Merkle Mountain Range) | Medium | Append works, root works; missing proof generation |
| `EventInclusionProof` | Medium | Verification works; missing proof generation from MMR |
| `derive_did` | Medium | Correct derivation; DID is still `type Did = String` |
| `DidDocument` + key rotation | Medium | Logic correct; timestamps hardcoded to 0 |
| `RiskAttestation` | Medium | Full lifecycle; missing domain-separated signing |
| `Policy` + `AccessorSet` | Medium | Basic matching; conditions not evaluated |

### What's Stub/Incomplete

| Component | Status | Gap |
|-----------|--------|-----|
| `BftGadget` | Stub | Always returns `true`. No real consensus. |
| `Smt` | Simplified | Naive sorted-key Merkle, not true sparse tree |
| `DagStore` append validation | Partial | Signature verification skipped (needs identity resolution) |
| `exo-gatekeeper` | Empty | Only `hello()` function; no TEE logic |
| `exo-api` GraphQL | Stub | Health query works; event query returns None |
| `exo-api` P2P | Scaffold | libp2p setup + ping; no gossip/kademlia |
| Feature flags | Missing | No conditional compilation |
| WASM support | Missing | Not tested or gated |
| Cross-impl tests | Scaffold | Hash test exists; no CI integration |
| HLC skew checks | Missing | TODO in append.rs |
| Condition evaluation | Missing | `Condition` struct exists but `is_match()` ignores conditions |
| Group resolution | Missing | `AccessorSet::Group` always returns false |

---

## 13. Threat Model Summary

From `governance/threat_matrix.md` (13 threats):

| ID | Threat | Status |
|----|--------|--------|
| T-01 | Key Exfiltration | Planned (KeyVault trait defined) |
| T-02 | Score Replay | Partial (nonce + audience in RiskAttestation) |
| T-03 | BFT Liveness | Planned (stub consensus) |
| T-04 | Sybil Attack | Planned (DID derivation cost) |
| T-05 | Vault Breach | Planned (XChaCha20 not implemented) |
| T-06 | Eclipse Attack | Planned (libp2p peer auth stub) |
| T-07 | Replay (Events) | Partial (HLC + event_id uniqueness) |
| T-08 | Signature Forgery | Implemented (ed25519-dalek) |
| T-09 | HLC Manipulation | Partial (ordering correct, skew checks missing) |
| T-10 | DoS API | Planned (no rate limiting) |
| T-11 | Admin Bypass | Design (no admin keys in code) |
| T-12 | Holon Key Theft | Planned (TEE not implemented) |
| T-13 | Capability Escalation | Planned (CGR kernel not implemented) |

---

## 14. Governance / Spec Alignment

- Spec version: v2.2 (code says v2.2, fabric platform doc says v2.1)
- All development governed by `EXOCHAIN_Specification_v2.2.pdf` (65-page spec)
- Traceability matrix maps 11 spec sections to code (all "Planned" status)
- Quality gates: 80% coverage, zero clippy, no unsafe, cargo-audit
- Sub-agent charter defines 11 specialized development agents
- Invariants: no PII on ledger, no admins, no floats in exo-core, no unsafe

---

## 15. WeftOS Integration Recommendations

### 15.1 Immediate Adoption (No Changes to Exochain)

These exochain components can be used directly in WeftOS:

| Component | WeftOS Use | Kernel Phase |
|-----------|-----------|--------------|
| `Blake3Hash` | Universal hash type | K0 |
| `HybridLogicalClock` | IPC message ordering (replace VectorClock) | K2 |
| `compute_signature` / `verify_signature` | All signing operations with domain separation | K0 |
| `derive_did` | Agent identity derivation | K1 |
| `Mmr` | Kernel audit trail accumulator | K0 |
| `EventPayload::Opaque` | Wrap IPC messages for audit | K2 |

### 15.2 Required Modifications

| Change | Effort | Priority |
|--------|--------|----------|
| Add `wasm` feature gate to exo-core (replace serde_cbor with ciborium) | Small | High |
| Add feature gates to exo-api (gate libp2p, axum, graphql) | Small | High |
| Add WeftOS-specific `EventPayload` variants | Small | Medium |
| Implement `DagStore` backed by persistent storage (redb or similar) | Medium | Medium |
| Implement proper `Smt` with proof generation | Medium | Low |
| Replace BftGadget with ruvector-raft integration | Large | Low (post-K5) |
| Add hook system via `HookedDagStore` wrapper | Small | Medium |

### 15.3 Repository Strategy

**Recommendation**: Fork exochain/exochain to ruvnet/exochain and maintain as a WeftOS-specific fork:

1. The upstream repo (exochain/exochain) is Apache-2.0 licensed
2. WeftOS needs modifications (WASM gates, custom payloads, hook system) that may diverge from upstream's governance model
3. Pin to specific commit hash for reproducibility
4. Periodically merge upstream improvements

### 15.4 `exo-resource-tree` Crate (New)

The SPARC doc 13 defines a comprehensive `exo-resource-tree` crate that unifies all WeftOS access control through the exochain substrate. This is the key architectural integration point -- it maps every WeftOS concept (agents, processes, IPC topics, containers, apps) into a single content-addressed, Merkle-verified, DAG-persisted resource tree.

Key decision: This crate should live in the WeftOS workspace (not exochain upstream) since it's WeftOS-specific but depends on exochain crates.

### 15.5 Crypto Alignment

| Algorithm | Exochain | WeftOS Current | Action |
|-----------|----------|---------------|--------|
| BLAKE3 | Yes | Yes (same crate) | Adopt exochain's `Blake3Hash` type |
| Ed25519 | Yes (ed25519-dalek v2.1) | Yes (same crate) | Adopt domain separator pattern |
| HLC | Yes | VectorClock (ruvector) | Replace VectorClock with HLC for local ordering |
| CBOR | serde_cbor v0.11 | N/A | Migrate to ciborium for WASM compat |
| ML-DSA-65 | No | Planned | Add as extension (post-quantum) |
| XChaCha20 | Planned (not impl) | Planned | Add for vault encryption |

---

## 16. Risk Assessment for Integration

| Risk | Severity | Likelihood | Mitigation |
|------|----------|------------|------------|
| serde_cbor unmaintained | Medium | High | Replace with ciborium in fork |
| Upstream diverges from WeftOS needs | Medium | Medium | Fork strategy; adapter layer |
| BFT consensus never matures | Low | Medium | Use ruvector-raft instead |
| libp2p dependency bloat | Medium | High | Feature-gate behind `p2p` flag |
| Breaking EventPayload changes | High | Low | Pin commit hash; versioning rules |
| No WASM target testing | Medium | High | Add WASM CI in fork |
| DID as String type is weak | Low | Medium | Newtype wrapper in WeftOS layer |
| Missing condition evaluation | Medium | Medium | Implement in fork or WeftOS layer |

---

## 17. Summary

Exochain provides a solid foundation as a cryptographic substrate for WeftOS:

**Strengths**:
- Clean, well-typed Rust code with zero unsafe
- BLAKE3 + Ed25519 + domain separators match WeftOS crypto requirements exactly
- HLC is superior to vector clocks for WeftOS's single-node-with-many-agents model
- DAG + MMR + checkpoint model is a natural fit for append-only kernel audit trails
- DID + Policy + Bailment model aligns with WeftOS agent identity and access control
- Apache-2.0 license permits forking and modification

**Weaknesses**:
- Early MVP stage (~1,600 LOC across 6 crates)
- No WASM support, no feature flags
- serde_cbor is unmaintained
- BFT consensus is a stub
- No hook/event system
- Missing production storage backend

**Verdict**: Fork and extend. The core data model and cryptographic primitives are architecturally sound and well-aligned with WeftOS requirements. The gaps are in production readiness (WASM, storage, consensus, hooks), which WeftOS would need to fill regardless of substrate choice. The `exo-resource-tree` crate (SPARC doc 13) is the key integration design that unifies exochain with the WeftOS kernel.
