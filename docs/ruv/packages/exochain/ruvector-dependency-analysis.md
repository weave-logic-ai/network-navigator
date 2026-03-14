# Exochain / RuVector / DAA Dependency Analysis

Date: 2026-03-01
Repos analyzed:
- `github.com/ruvnet/exochain` (cloned to `/tmp/ruv-research/exochain`)
- `github.com/ruvnet/ruvector` (cloned to `/tmp/ruv-research/ruvector`)
- `github.com/ruvnet/daa` (cloned to `/tmp/ruv-research/daa`)

---

## 1. Cross-Dependency Summary

### 1.1 Cargo.toml Cross-References

| Direction | Status |
|-----------|--------|
| exochain Cargo.toml references ruvector crates | **None found** |
| ruvector Cargo.toml references exochain crates | **None found** (see note below) |
| DAA Cargo.toml references exochain crates | **None found** |
| exochain Cargo.toml references DAA crates | **None found** |

**Note on exo-ai-2025**: Ruvector contains an `examples/exo-ai-2025/` directory with
crates named `exo-core`, `exo-federation`, `exo-manifold`, etc. These are part of
a separate "EXO-AI cognitive substrate" project (IIT consciousness measurement,
Landauer thermodynamics) and share **no code or types** with the blockchain-oriented
exochain repo. The namespace collision is superficial -- the crate purposes,
dependencies, and authors are entirely different.

### 1.2 Source-Level Cross-References

Grepping for `ruvector` across all exochain source files: **zero matches**.
Grepping for `exochain` across all ruvector Cargo.toml files: **zero matches**
(only the exo-ai-2025 example above).
Grepping for `exochain` or `exo-core`/`exo-dag` across all DAA source files:
**zero matches**.

**Conclusion**: The three repos are currently **fully decoupled** with no shared
crate dependencies, no import references, and no common types.

---

## 2. Serialization Format Comparison

### 2.1 Exochain Serialization

| Aspect | Detail |
|--------|--------|
| Primary format | **CBOR** via `serde_cbor` (canonical encoding) |
| Hash function | **BLAKE3** (32-byte digests) |
| Signatures | **Ed25519** via `ed25519-dalek` with domain separator (`EXOCHAIN-EVENT-SIG-v1`) |
| Encoding style | `#[derive(Serialize, Deserialize)]` on all core types |
| Human-readable mode | Hex-encoded hashes for JSON; raw bytes for CBOR |
| Key encoding | Base58 for DID derivation (`did:exo:<base58(blake3(pubkey)[0..20])>`) |

Key files:
- `/tmp/ruv-research/exochain/crates/exo-core/src/crypto.rs` -- Blake3Hash, signature
- `/tmp/ruv-research/exochain/crates/exo-core/src/event.rs` -- EventEnvelope, LedgerEvent
- `/tmp/ruv-research/exochain/crates/exo-dag/src/checkpoint.rs` -- CheckpointPayload

### 2.2 RVF (RuVector Format) Serialization

| Aspect | Detail |
|--------|--------|
| Primary format | **Custom binary wire format** with 64-byte aligned segments |
| Hash function | **XXH3-128** (default), SHAKE-256-256 for crypto, CRC32C as option |
| Signatures | **Ed25519** (optional feature), HMAC-SHA256 for witness bundles |
| Encoding style | `repr(C)` structs, little-endian, manual byte-level serialization |
| Magic number | `0x52564653` ("RVFS") for segments |
| Alignment | All segments padded to 64-byte boundaries (cache-line / SIMD friendly) |
| no_std support | Yes -- rvf-types is `#![cfg_attr(not(feature = "std"), no_std)]` |

Key files:
- `/tmp/ruv-research/ruvector/crates/rvf/rvf-types/src/segment.rs` -- SegmentHeader (64 bytes)
- `/tmp/ruv-research/ruvector/crates/rvf/rvf-wire/src/writer.rs` -- segment serialization
- `/tmp/ruv-research/ruvector/crates/rvf/rvf-types/src/segment_type.rs` -- 28 segment type discriminators

### 2.3 DAA Serialization

| Aspect | Detail |
|--------|--------|
| Primary format | **bincode** for internal state, **serde_json** for API |
| Hash function | **BLAKE3** |
| Consensus | QuDAG-based BFT with 2/3 majority stake threshold |

---

## 3. Data Structure Mapping: Exochain to RVF Segments

### 3.1 Natural Segment Mappings

The following table maps exochain data structures to existing RVF segment types:

| Exochain Type | Size | RVF Segment Type | Discriminator | Rationale |
|---------------|------|------------------|---------------|-----------|
| `LedgerEvent` (envelope + sig) | ~200-500 bytes | `Journal` (0x04) | Metadata mutations | Events are state mutations; Journal is the "mutation log" segment |
| `CheckpointPayload` | ~300+ bytes | `Witness` (0x0A) | Capability/audit | Checkpoints are audit anchors with validator signatures |
| `Mmr` (peaks + root) | ~256 bytes | `Index` (0x02) | Adjacency/routing | MMR is a tree index structure |
| `Smt` (state root) | Variable | `Meta` (0x07) | Key-value metadata | SMT is a k/v state map |
| `EventInclusionProof` | ~128+ bytes | `Crypto` (0x0C) | Key/signature/cert | Merkle proofs are cryptographic evidence |
| `Bailment` (consent record) | ~200 bytes | `Witness` (0x0A) | Audit trail | Consent records are governance evidence |
| `Policy` (access control) | ~150 bytes | `PolicyKernel` (0x31) | Policy config | Direct semantic match |
| `DidDocument` | ~500 bytes | `Profile` (0x0B) | Domain declaration | Identity profiles map to domain profiles |
| `TeeReport` | ~64 bytes | Attestation in `Witness` | TEE attestation | RVF has `AttestationHeader` (112 bytes) for TEE reports |

### 3.2 Serialization Bridge Strategy

Exochain uses CBOR + BLAKE3. RVF uses custom binary + XXH3-128. A bridge would:

1. **Serialize exochain types via serde_cbor** to get the canonical byte payload.
2. **Wrap the CBOR blob as an RVF segment payload** using `rvf_wire::write_segment()`.
3. **Use SegmentType::Journal (0x04)** for events, **Witness (0x0A)** for checkpoints.
4. **Store the BLAKE3 hash in the segment's Meta** (since RVF content_hash is XXH3-128,
   the BLAKE3 event_id would be stored as part of the payload or in a companion
   Meta segment).

The hash algorithm mismatch (BLAKE3 vs XXH3-128) is **not a conflict** because:
- RVF's `content_hash` field is for **transport integrity** (fast hash, not crypto).
- Exochain's BLAKE3 hash is for **content identity** (crypto-grade).
- Both can coexist: the RVF header checks transport integrity; the exochain
  event_id inside the payload provides cryptographic identity.

### 3.3 Proposed New Segment Type (Optional)

If a dedicated exochain segment is desired, a new discriminator could be allocated
in the reserved range `0x40-0xEF`:

```
ExochainEvent = 0x40,   // CBOR-encoded LedgerEvent
ExochainCheckpoint = 0x41,  // CBOR-encoded CheckpointPayload
ExochainProof = 0x42,   // EventInclusionProof
```

This would avoid overloading existing RVF segment semantics but requires
coordination with the rvf-types maintainer.

---

## 4. Multi-Chain / Federated Model Analysis

### 4.1 Does Exochain Support Multi-Chain?

**Current state: No, but the architecture accommodates it.**

The exochain spec (EXOCHAIN-FABRIC-PLATFORM.md v2.1) describes:

- **Genesis event** contains a `network_id` field (see `EventPayload::Genesis`),
  which scopes a DAG to a specific network.
- **DAG sharding** is planned for Phase 4 (Section 15.3): partition by SubjectID
  prefix, 256 shards max, each shard runs independent BFT.
- **Cross-shard communication** uses `BridgeEvent` with inclusion proofs
  (async, non-atomic).
- **Validator sets per shard** are supported: "Each shard can have independent
  validator set; global coordination via periodic cross-shard checkpoints."

However, the current implementation is **single-DAG, single-validator-set MVP**:
- `DagStore` trait has no chain/shard discrimination.
- `BftGadget` is a stub that always returns `is_finalized = true`.
- No `BridgeEvent` variant exists in `EventPayload` yet.
- P2P layer (`exo-api/src/p2p.rs`) is a bare libp2p ping scaffold.

### 4.2 WeftOS Local + Global Root Chain Model

**Desired**: Each WeftOS node has a local exochain AND participates in a global
root chain agreed upon by cluster nodes.

**Gap analysis**:

| Requirement | Exochain Support | Work Needed |
|-------------|-----------------|-------------|
| Per-node local chain | Genesis with unique `network_id` | **Ready**: Create a local genesis per node |
| Global root chain | Separate genesis, shared validators | **Ready**: Create a global genesis with cluster validator set |
| Cross-chain event anchoring | `BridgeEvent` stub in spec | **Needs implementation**: Add `BridgeEvent` to `EventPayload` |
| Checkpoint cross-references | `CheckpointPayload.frontier` | **Partially ready**: Frontier hashes could reference external chains |
| Shared validator coordination | Spec supports per-shard validators | **Needs implementation**: Validator set management |
| Inclusion proofs across chains | `EventInclusionProof` exists | **Ready**: MMR proofs work cross-chain if roots are shared |

**Architecture recommendation**:

```
                     Global Root Chain
                    (cluster consensus)
                   /         |          \
              Checkpoint  Checkpoint  Checkpoint
             (BridgeEvent) anchors    anchors
                /            |            \
   Node-A Local       Node-B Local       Node-C Local
   Exochain           Exochain           Exochain
   (network_id:       (network_id:       (network_id:
    "weftos-a")        "weftos-b")        "weftos-c")
```

Each local chain:
- Has its own genesis with `network_id: "weftos-<node-id>"`.
- Runs without BFT (single-node, append-only).
- Periodically produces a local `CheckpointPayload` with `event_root` and `state_root`.

The global root chain:
- Has genesis with `network_id: "weftos-cluster-<cluster-id>"`.
- Validators are all cluster nodes running BFT.
- Receives `BridgeEvent` payloads containing local checkpoint proofs.
- Produces global checkpoints that anchor all local chains.

### 4.3 Implementation Path

1. **Add `BridgeEvent` to `EventPayload`**:
   ```rust
   BridgeEvent {
       source_network_id: String,
       checkpoint: CheckpointPayload,
       inclusion_proof: Option<EventInclusionProof>,
   }
   ```

2. **Parameterize `DagStore` with `network_id`**:
   ```rust
   pub trait DagStore: Send + Sync {
       fn network_id(&self) -> &str;
       // ... existing methods
   }
   ```

3. **Multi-store manager** in weaver daemon:
   ```rust
   struct ChainManager {
       local_chain: Box<dyn DagStore>,
       global_chain: Box<dyn DagStore>,
   }
   ```

---

## 5. DAA Governance/Consent Patterns

### 5.1 DAA Rules Engine

The DAA repo provides a comprehensive rules engine (`daa-rules`) with:

- **Policy conditions**: `Equals`, `GreaterThan`, `Matches` (regex), `TimeCondition`,
  composable `And`/`Or`/`Not`.
- **Policy actions**: `SetField`, `Log`, `Notify`, `Webhook`, `ModifyContext`, `Abort`.
- **Governance results**: `Allow`, `Deny(reason)`, `Modified(changes)`, `Skipped`, `Failed`.

File: `/tmp/ruv-research/daa/daa-rules/src/lib.rs`

### 5.2 DAA Chain Consensus

The DAA chain (`daa-chain`) implements BFT consensus with:
- **Epoch/round-based** Tendermint-style voting (Prevote -> Precommit -> Commit).
- **Stake-weighted 2/3 majority** threshold.
- **Validator reputation** tracking (`ValidatorInfo.reputation: f64`).
- **Round-robin leader selection**.

File: `/tmp/ruv-research/daa/daa-chain/src/consensus.rs`

### 5.3 Connection to Exochain

| DAA Feature | Exochain Equivalent | Integration Path |
|-------------|-------------------|------------------|
| `daa-rules::Rule` | `exo-consent::Policy` | Exochain policies are simpler; DAA rules could enrich them |
| `daa-rules::RuleCondition` | `exo-consent::Condition` | DAA has 11 condition types vs exochain's 2-field stub |
| `daa-chain::ConsensusEngine` | `exo-dag::BftGadget` | DAA has full BFT; exochain has a stub |
| `daa-chain::Vote` | Not in exochain yet | Could port DAA's vote types into exo-dag |
| `daa-rules::RuleResult` | `exo-consent::Effect` | DAA has 5 outcomes vs exochain's Allow/Deny |

**Key finding**: DAA's `daa-rules` engine is significantly more mature than exochain's
`exo-consent` policy module. For WeftOS, the DAA rules engine could be used as the
policy evaluation backend, with exochain's consent framework providing the
on-chain audit trail.

### 5.4 DAA/Exochain Integration Architecture

```
WeftOS Node
  |
  +-- DAA Rules Engine (policy evaluation)
  |     - Evaluates complex conditions (regex, time, threshold)
  |     - Returns Allow/Deny/Modified decisions
  |
  +-- Exochain Consent Layer (audit trail)
  |     - Records consent decisions as LedgerEvents
  |     - Stores Bailment records for data custody
  |     - Gatekeeper enforces TEE-bound access
  |
  +-- RVF Witness Bundles (evidence)
        - Packages governance decisions as Witness segments
        - GovernanceMode enum maps to DAA's Allow/Deny/Modified
        - PolicyCheck enum maps per-tool-call decisions
```

---

## 6. RVF Federation Relevance

### 6.1 RVF Federation Segments (0x33-0x36)

RVF already has federation-aware segment types that could carry exochain data:

| Segment | Discriminator | WeftOS Use |
|---------|---------------|------------|
| `FederatedManifest` | 0x33 | Metadata for federated exochain checkpoint exports |
| `DiffPrivacyProof` | 0x34 | Privacy attestation for shared chain state |
| `RedactionLog` | 0x35 | PII stripping audit when exporting chain events |
| `AggregateWeights` | 0x36 | Not directly applicable (ML weights) |

Files:
- `/tmp/ruv-research/ruvector/crates/rvf/rvf-federation/src/types.rs`
- `/tmp/ruv-research/ruvector/crates/rvf/rvf-federation/src/federation.rs`

### 6.2 RVF Lineage as Chain Provenance

RVF's `FileIdentity` / `LineageRecord` system (in `rvf-types/src/lineage.rs` and
`rvf-crypto/src/lineage.rs`) provides a DAG-style provenance chain that is
structurally similar to exochain's event DAG:

| RVF Lineage | Exochain DAG |
|-------------|-------------|
| `FileIdentity.file_id` (16 bytes) | `LedgerEvent.event_id` (32 bytes BLAKE3) |
| `FileIdentity.parent_id` (16 bytes) | `EventEnvelope.parents` (Vec<Blake3Hash>) |
| `FileIdentity.parent_hash` (32 bytes) | Implied by parent event_id |
| `LineageRecord.derivation_type` | `EventPayload` variant discriminator |
| `verify_lineage_chain()` | `verify_integrity()` in exo-dag |

**Difference**: RVF lineage is single-parent (linear chain). Exochain supports
multi-parent DAG (multiple parents per event). A `DerivationType::Merge` could
represent multi-parent events, but would need an extension to list multiple parent IDs.

### 6.3 RVF Attestation/TEE Layer

RVF has first-class TEE attestation support (`rvf-types/src/attestation.rs`):
- `AttestationHeader` (112 bytes, repr(C)) with platform, measurement, signer_id, nonce.
- Supports SGX, SEV-SNP, TDX, ARM CCA, SoftwareTee platforms.
- Attestation witness types: PlatformAttestation, KeyBinding, ComputationProof, DataProvenance.

Exochain's `TeeReport` is a simple stub (`measurement: Blake3Hash, signature: Vec<u8>`).
RVF's attestation types are far more complete and could replace exochain's stub.

---

## 7. Recommendations

### 7.1 Short-Term (WeftOS Kernel Sprint)

1. **No direct crate dependency needed yet**. Exochain types can be serialized to
   CBOR and wrapped in RVF segments without coupling the crate graphs.

2. **Use RVF Journal segments (0x04)** for persisting exochain events in the WeftOS
   kernel's local store. The CBOR payload goes inside the segment; the RVF header
   provides transport integrity and segment indexing.

3. **Use RVF Witness segments (0x0A)** for checkpoints and governance decisions,
   leveraging the existing `WitnessHeader` and `GovernanceMode` types.

### 7.2 Medium-Term (Multi-Chain Integration)

4. **Implement `BridgeEvent` in exochain** to support local-to-global chain anchoring.

5. **Create `exo-rvf` bridge crate** that provides:
   - `fn ledger_event_to_rvf_segment(event: &LedgerEvent) -> Vec<u8>`
   - `fn checkpoint_to_witness_segment(cp: &CheckpointPayload) -> Vec<u8>`
   - `fn rvf_segment_to_ledger_event(seg: &[u8]) -> Result<LedgerEvent>`

6. **Adopt DAA rules engine** for complex policy evaluation, with exochain
   recording the outcomes as consent events on-chain.

### 7.3 Long-Term (Full Federation)

7. **Register exochain-specific segment types** (0x40-0x42) in rvf-types if the
   bridge crate proves its value.

8. **Extend RVF lineage** to support multi-parent derivations, aligning with
   exochain's DAG causality model.

9. **Replace exochain's TeeReport stub** with RVF's `AttestationHeader` types,
   unifying the TEE attestation model across the stack.

10. **Use RVF federation segments** (0x33-0x35) for privacy-preserving export of
    exochain state across WeftOS clusters.

---

## 8. Key Architectural Answer

**Q: Can each WeftOS node have its own local exochain AND participate in a global
root chain agreed upon by cluster nodes?**

**A: Yes, with targeted work.**

Exochain's architecture already supports this conceptually:
- `network_id` in Genesis discriminates chains.
- `DagStore` is trait-based and can be instantiated per chain.
- `CheckpointPayload` can anchor external chain roots via `frontier` hashes.
- The spec plans DAG sharding with per-shard validators and cross-shard proofs.

What needs to be built:
1. `BridgeEvent` payload variant (~50 LOC in exo-core).
2. Multi-store management in the weaver daemon (~100 LOC).
3. Periodic local-checkpoint-to-global-chain anchoring logic (~200 LOC).
4. BFT consensus upgrade from stub to real (can port from DAA's implementation).

The RVF format provides the persistence and transport layer: local chain events
stored as Journal segments, cross-chain proofs as Witness segments, and federation
exports using the 0x33-0x35 segment types.
