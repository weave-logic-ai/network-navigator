# RVF (RuVector Format) Binary Container Format -- Deep Analysis

Source: `/home/aepod/dev/ruvector/crates/rvf/`
Analyzed from: commit `b64c2172` (latest on `main`)
Date: 2026-03-01

---

## 1. Crate Topology

The RVF workspace (`crates/rvf/Cargo.toml`) contains 21 member crates plus an
integration test suite and a benchmark crate.

### Core Crates

| Crate | Path | Purpose |
|-------|------|---------|
| **rvf-types** | `rvf-types/` | Foundational types: segment headers, enums, flags, error codes, format constants. `no_std` compatible. Published as v0.2.0. |
| **rvf-wire** | `rvf-wire/` | Binary encoding/decoding: segment reader, writer, varint, delta coding, hash computation, tail-scan, per-segment codecs. |
| **rvf-manifest** | `rvf-manifest/` | Manifest management: Level 0/1 roots, overlay chain, boot sequence, directory writer. |
| **rvf-index** | `rvf-index/` | HNSW index: builder, layers, distance functions, progressive recall, codec for INDEX_SEG. |
| **rvf-quant** | `rvf-quant/` | Quantization: scalar, binary, product quantization, sketch, tier system, codec. |
| **rvf-crypto** | `rvf-crypto/` | Cryptography: SHAKE-256 hashing, witness chains, Ed25519/HMAC signing, attestation, lineage verification, signature footers. |
| **rvf-runtime** | `rvf-runtime/` | Main user-facing API (`RvfStore`): append-only writes, progressive reads, compaction, deletion, witness bundles, COW branching, AGI containers. Published as v0.2.0. |

### Execution / Embedding Crates

| Crate | Path | Purpose |
|-------|------|---------|
| **rvf-kernel** | `rvf-kernel/` | Embedded unikernel support: config, initramfs, Docker-to-kernel packaging. |
| **rvf-wasm** | `rvf-wasm/` | WASM runtime: memory management, top-k, segment parsing, distance, store, bootstrap -- all for wasm32 targets. |
| **rvf-solver-wasm** | `rvf-solver-wasm/` | WASM constraint solver: policy engine, types. |
| **rvf-launch** | `rvf-launch/` | QEMU/KVM launcher: extract kernel from RVF, QMP control, boot self-contained RVF files. |
| **rvf-ebpf** | `rvf-ebpf/` | eBPF programs: XDP distance computation, TC query routing, socket filter. |

### Server / CLI / Import

| Crate | Path | Purpose |
|-------|------|---------|
| **rvf-server** | `rvf-server/` | HTTP/WebSocket/TCP server for hosting RVF stores. |
| **rvf-cli** | `rvf-cli/` | CLI tool: create, inspect, ingest, query, compact, derive, freeze, launch, serve, embed-kernel, embed-ebpf, verify-witness, verify-attestation, filter, delete, status, rebuild-refcounts. |
| **rvf-import** | `rvf-import/` | Ingest from CSV, JSON, NumPy formats. |
| **rvf-node** | `rvf-node/` | NAPI-RS bindings for Node.js (pre-built for linux-x64, linux-arm64, darwin-x64, darwin-arm64, win32-x64). |

### Adapter Crates (`rvf-adapters/`)

| Adapter | Purpose |
|---------|---------|
| **claude-flow** | Memory store + witness integration for claude-flow MCP. |
| **agentdb** | Pattern store, vector store, index adapter for AgentDB. |
| **ospipe** | Observation store + pipeline for observability. |
| **agentic-flow** | Swarm store, coordination, learning for agentic workflows. |
| **rvlite** | Lightweight embedded collection adapter. |
| **sona** | Experience, trajectory, pattern storage for SONA agent memory. |

### Federation

| Crate | Path | Purpose |
|-------|------|---------|
| **rvf-federation** | `rvf-federation/` | Federated learning: aggregation, differential privacy, PII stripping, policy enforcement. |

---

## 2. Segment Types

RVF defines segment types as a `#[repr(u8)]` enum in
`/home/aepod/dev/ruvector/crates/rvf/rvf-types/src/segment_type.rs`.

Values `0x00` and `0xF0..=0xFF` are reserved.

### Complete Segment Type Map

| Discriminant | Name | Description |
|-------------|------|-------------|
| `0x00` | Invalid | Uninitialized / zeroed region |
| `0x01` | Vec | Raw vector payloads (embeddings) |
| `0x02` | Index | HNSW adjacency lists, entry points, routing tables |
| `0x03` | Overlay | Graph overlay deltas, partition updates, min-cut witnesses |
| `0x04` | Journal | Metadata mutations (label changes, deletions, moves) |
| `0x05` | Manifest | Segment directory, hotset pointers, epoch state |
| `0x06` | Quant | Quantization dictionaries and codebooks |
| `0x07` | Meta | Arbitrary key-value metadata (tags, provenance, lineage) |
| `0x08` | Hot | Temperature-promoted hot data (vectors + neighbors) |
| `0x09` | Sketch | Access counter sketches for temperature decisions |
| **`0x0A`** | **Witness** | **Capability manifests, proof of computation, audit trails** |
| `0x0B` | Profile | Domain profile declarations (RVDNA, RVText, etc.) |
| `0x0C` | Crypto | Key material, signature chains, certificate anchors |
| `0x0D` | MetaIdx | Metadata inverted indexes for filtered search |
| `0x0E` | Kernel | Embedded kernel / unikernel image for self-booting |
| `0x0F` | Ebpf | Embedded eBPF program for kernel fast path |
| **`0x10`** | **Wasm** | **Embedded WASM bytecode for self-bootstrapping execution** |
| `0x11` | Dashboard | Embedded web dashboard bundle (HTML/JS/CSS assets) |
| `0x20` | CowMap | COW cluster mapping |
| `0x21` | Refcount | Cluster reference counts |
| `0x22` | Membership | Vector membership filter |
| `0x23` | Delta | Sparse delta patches |
| `0x30` | TransferPrior | Serialized transfer prior (cross-domain posterior summaries) |
| `0x31` | PolicyKernel | Policy kernel configuration and performance history |
| `0x32` | CostCurve | Cost curve convergence data for acceleration tracking |
| `0x33` | FederatedManifest | Federated learning export manifest |
| `0x34` | DiffPrivacyProof | Differential privacy attestation (epsilon/delta) |
| `0x35` | RedactionLog | PII stripping attestation |
| `0x36` | AggregateWeights | Federated-averaged SONA weights |

### Available Discriminant Ranges for New Segment Types

- `0x12..=0x1F` -- 14 slots (near the "embedded execution" cluster)
- `0x24..=0x2F` -- 12 slots (near the "COW/branching" cluster)
- `0x37..=0xEF` -- 185 slots (general purpose)
- `0xF0..=0xFF` -- reserved (spec says must not be used)

**Key finding**: There is ample room for an ExoChain segment type. The range
`0x40..=0x4F` would be ideal as a new "audit/chain" cluster.

---

## 3. Wire Format

### 3.1 Segment Header (64 bytes)

Defined in `/home/aepod/dev/ruvector/crates/rvf/rvf-types/src/segment.rs`.

```
Offset  Size  Type    Field              Notes
0x00    4     u32     magic              Must be 0x52564653 ("RVFS" big-endian)
0x04    1     u8      version            Currently 1
0x05    1     u8      seg_type           SegmentType discriminant
0x06    2     u16     flags              SegmentFlags bitfield
0x08    8     u64     segment_id         Monotonically increasing ordinal
0x10    8     u64     payload_length     Byte length of payload
0x18    8     u64     timestamp_ns       Nanosecond UNIX timestamp
0x20    1     u8      checksum_algo      0=CRC32C, 1=XXH3-128, 2=SHAKE-256
0x21    1     u8      compression        0=none, 1=LZ4, 2=ZSTD, 3=custom
0x22    2     u16     reserved_0         Must be zero
0x24    4     u32     reserved_1         Must be zero
0x28    16    [u8;16] content_hash       First 128 bits of payload hash
0x38    4     u32     uncompressed_len   Original size (0 if not compressed)
0x3C    4     u32     alignment_pad      Padding to 64-byte boundary
```

**Compile-time assertion**: `size_of::<SegmentHeader>() == 64`

### 3.2 SIMD Alignment

All segments must start at 64-byte aligned boundaries. This matches:
- AVX-512 register width (512 bits = 64 bytes)
- Typical CPU cache line size (64 bytes)

```rust
pub const SEGMENT_ALIGNMENT: usize = 64;
```

The writer (`rvf-wire/src/writer.rs`) computes padded sizes:

```rust
pub fn calculate_padded_size(header_size: usize, payload_size: usize) -> usize {
    let raw = header_size + payload_size;
    (raw + SEGMENT_ALIGNMENT - 1) & !(SEGMENT_ALIGNMENT - 1)
}
```

Zero-padding fills the gap between payload end and the next 64-byte boundary.

### 3.3 Checksums

Three supported algorithms (in `/home/aepod/dev/ruvector/crates/rvf/rvf-types/src/checksum.rs`):

| Code | Algorithm | Output | Properties |
|------|-----------|--------|------------|
| 0 | CRC32C | 4 bytes (zero-padded to 16) | SSE4.2 hardware-accelerated |
| 1 | XXH3-128 | 16 bytes | Fast, good distribution (default) |
| 2 | SHAKE-256 | 16 bytes (first 128 bits) | Post-quantum safe, cryptographic |

The writer defaults to XXH3-128 (`checksum_algo = 1`). The reader always
verifies the content hash (the SEALED flag is NOT treated as a bypass -- this
is an explicit security decision documented in the reader source).

### 3.4 Append-Only Properties

The write path (`rvf-runtime/src/write_path.rs`) enforces strict append-only
semantics:

1. **Monotonic segment IDs**: A `SegmentWriter` allocates IDs via
   `checked_add(1)` -- overflow panics (would require 2^64 segments).

2. **Two-fsync protocol**:
   - Write segment header + payload, fsync
   - Write new MANIFEST_SEG, fsync
   This ensures crash consistency: either the old manifest is valid or the
   new one is.

3. **No in-place edits**: All mutations append new segments. Deletions are
   recorded as JOURNAL_SEG entries with tombstone markers.

4. **Compaction**: Creates a new temp file with live data + new manifest, then
   atomically replaces the original. Unknown segment types are currently
   **dropped** during compaction (this is a known gap documented in the
   `unknown_segment_preservation.rs` integration test).

### 3.5 Segment Flags

Defined in `/home/aepod/dev/ruvector/crates/rvf/rvf-types/src/flags.rs`:

| Bit | Constant | Description |
|-----|----------|-------------|
| 0 | COMPRESSED | Payload is compressed |
| 1 | ENCRYPTED | Payload is encrypted |
| 2 | SIGNED | Signature footer follows payload |
| 3 | SEALED | Immutable (compaction output) |
| 4 | PARTIAL | Streaming write |
| 5 | TOMBSTONE | Logically deletes a prior segment |
| 6 | HOT | Temperature-promoted hot data |
| 7 | OVERLAY | Overlay / delta data |
| 8 | SNAPSHOT | Full snapshot (not delta) |
| 9 | CHECKPOINT | Safe rollback point |
| 10 | ATTESTED | Produced inside attested TEE |
| 11 | HAS_LINEAGE | DNA-style lineage provenance |
| 12-15 | Reserved | Must be zero |

### 3.6 Signature Footer

When the SIGNED flag is set, a variable-length footer follows the payload:

```
Offset  Type    Field
0x00    u16     sig_algo     (0=Ed25519, 1=ML-DSA-65, 2=SLH-DSA-128s)
0x02    u16     sig_length
0x04    [u8]    signature    (sig_length bytes)
var     u32     footer_length (for backward scanning)
```

Post-quantum algorithms are supported: ML-DSA-65 (NIST Level 3) and
SLH-DSA-128s (NIST Level 1).

### 3.7 Manifest and Boot Sequence

- **Root manifest magic**: `0x52564D30` ("RVM0")
- **Root manifest size**: 4096 bytes (one OS page / disk sector)
- **Tail-scan**: File discovery starts from the tail. Fast path checks last
  4096 bytes for RVM0 magic; slow path scans backward at 64-byte boundaries.
- **Overlay chain**: Each manifest links to its predecessor via
  `OverlayChain` records (epoch, prev_manifest_offset, prev_manifest_id,
  checkpoint_hash), enabling point-in-time recovery.

---

## 4. Can Arbitrary Data Be Embedded as RVF Segments?

**Yes, unequivocally.** The format is explicitly designed for this:

1. **Generic segment model**: Any `u8` discriminant in the `seg_type` field is
   valid at the wire level. The `SegmentType::try_from()` returns `Err(u8)`
   for unknown types rather than panicking.

2. **Forward-compatibility contract**: The integration test
   `unknown_segment_preservation.rs` documents the expectation that unknown
   segment types must survive read/compaction cycles. The read path
   (`read_path.rs`) explicitly skips unrecognized segments when scanning for
   manifests.

3. **Existing precedent**: The format already embeds many non-vector data
   types:
   - Kernel images (0x0E) -- up to 128 MiB
   - eBPF bytecode (0x0F) -- up to 16 MiB
   - WASM modules (0x10) -- up to 8 MiB
   - Dashboard bundles (0x11) -- up to 64 MiB
   - Federated learning manifests (0x33)
   - Differential privacy proofs (0x34)
   - PII redaction logs (0x35)

4. **Witness segments (0x0A)** already store arbitrary audit data with the
   following payload layout:
   ```
   witness_type (u8) + timestamp_ns (u64 LE) +
   action_len (u32 LE) + action (bytes) + prev_hash (32 bytes)
   ```

5. **Maximum payload**: 4 GiB per segment (`MAX_SEGMENT_PAYLOAD = 0x1_0000_0000`).

### Embedding ExoChain Blocks/Entries

ExoChain entries (temporal-immutable event records) can be embedded as RVF
segments in multiple ways:

- **As Witness segments (0x0A)**: Use the existing witness chain mechanism.
  Each entry chains to the previous via SHAKE-256 hashes. This is the
  path of least resistance.

- **As a new ExoChain segment type**: Allocate a dedicated discriminant for
  richer semantics (see Section 9).

- **As Meta segments (0x07)**: Use the arbitrary key-value metadata segment
  for lightweight event storage.

---

## 5. WASM Segment Type

**Yes, there is a full WASM segment type** (`SegmentType::Wasm = 0x10`).

### WasmHeader (64 bytes)

Defined in `/home/aepod/dev/ruvector/crates/rvf/rvf-types/src/wasm_bootstrap.rs`:

| Field | Type | Description |
|-------|------|-------------|
| wasm_magic | u32 | 0x5256574D ("RVWM") |
| header_version | u16 | Currently 1 |
| role | u8 | WasmRole enum |
| target | u8 | WasmTarget enum |
| required_features | u16 | WASM feature bitfield |
| export_count | u16 | Number of WASM exports |
| bytecode_size | u32 | Uncompressed bytecode size |
| compressed_size | u32 | Compressed size (0 if uncompressed) |
| compression | u8 | Compression algorithm |
| min_memory_pages | u8 | Minimum 64KB pages |
| max_memory_pages | u8 | Maximum pages (0 = unlimited) |
| table_count | u8 | WASM tables |
| bytecode_hash | [u8;32] | SHAKE-256-256 of bytecode |
| bootstrap_priority | u8 | Lower = tried first |
| interpreter_type | u8 | 0=generic, 1=wasm3, 2=wamr, 3=wasmi |
| reserved | [u8;6] | Must be zero |

### WasmRole Enum

| Value | Role | Description |
|-------|------|-------------|
| 0x00 | Microkernel | RVF query engine compiled to WASM (~5.5 KB) |
| 0x01 | Interpreter | Minimal WASM interpreter (~50 KB) for self-bootstrap |
| 0x02 | Combined | Interpreter + microkernel in one module |
| 0x03 | Extension | Domain-specific extension (custom distance, codon decoder) |
| 0x04 | ControlPlane | Store management, export, segment parsing |

### WasmTarget Enum

Wasm32, WasiP1, WasiP2, Browser, BareTile

### Self-Bootstrapping Architecture

```
Layer 0: Raw bytes (the .rvf file)
Layer 1: Embedded WASM interpreter (runs on bare hardware)
Layer 2: WASM microkernel (query engine, 14+ exports)
Layer 3: RVF data segments (vectors, indexes, manifests)
```

Two WASM_SEGs make a file fully self-bootstrapping: an interpreter + a
microkernel. Any host with raw execution capability can boot the file.

---

## 6. Witness / Audit Segment

**Yes, there is a comprehensive witness/audit system** spanning multiple
layers.

### 6.1 WITNESS_SEG (0x0A) -- rvf-types + rvf-runtime

The segment payload uses this layout (in `write_path.rs`):
```
witness_type (u8) + timestamp_ns (u64 LE) +
action_len (u32 LE) + action (bytes) + prev_hash (32 bytes)
```

Each witness entry chains to the previous via `prev_hash`, forming a
tamper-evident hash chain using SHAKE-256.

### 6.2 Witness Bundles (ADR-035) -- rvf-runtime/src/witness.rs

A higher-level witness abstraction:

**WitnessHeader** (64 bytes, magic "RVWW"):
- task_id (UUID), policy_hash, created_ns, outcome, governance_mode
- tool_call_count, total_cost_microdollars, total_latency_ms, total_tokens
- retry_count, section_count, total_bundle_size

**TLV Sections**: Spec, Plan, Trace, Diff, TestLog, Postmortem

**ToolCallEntry**: action, args_hash, result_hash, latency, cost, tokens,
policy_check

**Governance Modes**: Restricted, Approved, Autonomous -- with policy
enforcement and violation tracking.

**Scorecard**: Aggregates bundles into capability reports (solve rate,
evidence coverage, cost per solve, P95 latency).

### 6.3 Witness Chain (rvf-crypto/src/witness.rs)

A cryptographic hash chain where each entry is 73 bytes:
```
prev_hash (32) + action_hash (32) + timestamp_ns (8) + witness_type (1)
```

`create_witness_chain()` links entries via SHAKE-256 hashes.
`verify_witness_chain()` validates the entire chain.

### 6.4 Attestation (rvf-types/src/attestation.rs)

**AttestationHeader** (112 bytes):
- TEE platform (SGX, SEV-SNP, TDX, ARM CCA, SoftwareTee)
- measurement (MRENCLAVE/launch digest), signer_id (MRSIGNER)
- nonce, SVN, quote blob
- Flags: debuggable, has_report_data, multi_platform

---

## 7. Versioning and Backward Compatibility

### 7.1 Format Versioning

- **Segment version**: Currently `SEGMENT_VERSION = 1`. The reader rejects
  any version other than 1.
- **Sub-header versions**: Each sub-header (WasmHeader, WitnessHeader, etc.)
  has its own `header_version` field, allowing independent evolution.

### 7.2 Forward Compatibility Mechanisms

1. **Unknown segment type tolerance**: The read path skips segments it does
   not recognize (scanning for manifests only checks `seg_type == 0x05`).

2. **Reserved fields**: Headers contain explicit `reserved_0`, `reserved_1`,
   and `alignment_pad` fields that must be zero. Future versions can use
   these without breaking old readers.

3. **Reserved flag bits**: Bits 12-15 of SegmentFlags are reserved and
   masked off by `SegmentFlags::from_raw()`.

4. **TLV extensibility**: Witness bundles use a TLV (tag-length-value) format
   for sections. Unknown tags are silently skipped:
   ```rust
   _ => {} // forward-compat: ignore unknown tags
   ```

5. **FileIdentity trailer**: The manifest payload uses a magic marker
   (`0x46494449` = "FIDI") to optionally append a 68-byte FileIdentity. Old
   readers that do not understand this marker simply ignore it.

### 7.3 Known Backward Compatibility Gap

**Compaction drops unknown segments.** The current `store.rs` compaction
implementation rewrites the file with only known segment types (VEC_SEG +
manifest). The integration test
`unknown_segment_preserved_after_compaction` documents this as a known gap.
Any new segment type (including ExoChain) needs compaction support before
it can be considered durable.

---

## 8. Public API for Creating, Reading, and Appending Segments

### 8.1 Low-Level Wire API (rvf-wire)

```rust
// Write a segment
use rvf_wire::write_segment;
let bytes = write_segment(seg_type, payload, flags, segment_id);

// Read a segment header
use rvf_wire::read_segment_header;
let header = read_segment_header(data)?;

// Read header + payload
use rvf_wire::read_segment;
let (header, payload) = read_segment(data)?;

// Validate content hash
use rvf_wire::validate_segment;
validate_segment(&header, payload)?;

// Find latest manifest (tail scan)
use rvf_wire::find_latest_manifest;
let (offset, header) = find_latest_manifest(data)?;
```

### 8.2 Runtime Store API (rvf-runtime)

```rust
use rvf_runtime::RvfStore;

// Create
let mut store = RvfStore::create(path, options)?;

// Open (read-write)
let mut store = RvfStore::open(path)?;

// Open (read-only)
let store = RvfStore::open_readonly(path)?;

// Ingest vectors
store.ingest_batch(&vectors, &ids, metadata)?;

// Query
let results = store.query(&query_vec, k, &query_options)?;

// Delete
store.delete(&ids)?;

// Compact
let result = store.compact()?;

// Close
store.close()?;
```

### 8.3 Internal Segment Writing (rvf-runtime/src/write_path.rs)

The `SegmentWriter` struct provides typed write methods (all `pub(crate)`):

```rust
write_vec_seg(writer, vectors, ids, dimension)
write_journal_seg(writer, deleted_ids, epoch)
write_meta_seg(writer, payload)
write_manifest_seg(writer, epoch, dimension, ...)
write_manifest_seg_with_identity(writer, ..., file_identity)
write_kernel_seg(writer, header, image, cmdline)
write_ebpf_seg(writer, header, bytecode, btf)
write_wasm_seg(writer, header, bytecode)
write_dashboard_seg(writer, header, bundle)
write_witness_seg(writer, witness_type, timestamp_ns, action, prev_hash)
```

### 8.4 Witness API (rvf-runtime/src/witness.rs)

```rust
use rvf_runtime::{WitnessBuilder, GovernancePolicy, TaskOutcome};

let builder = WitnessBuilder::new(task_id, GovernancePolicy::autonomous())
    .with_spec(b"task description")
    .with_plan(b"plan text")
    .with_diff(b"code diff")
    .with_test_log(b"test output")
    .with_outcome(TaskOutcome::Solved);

// Unsigned
let (payload, header) = builder.build()?;

// Signed (HMAC-SHA256)
let (payload, header) = builder.build_and_sign(key)?;

// Parse
let parsed = ParsedWitness::parse(&payload)?;
parsed.verify_all(key, &payload)?;
```

---

## 9. References to ExoChain / Exo-Core / Exo-DAG

**None found.** A grep for `exochain|exo.chain|exo.core|exo.dag|ExoChain`
(case-insensitive) across the entire `crates/rvf/` directory returned zero
matches.

The closest conceptual analogs are:
- **Witness chain** (rvf-crypto): Hash-linked tamper-evident audit log
- **Lineage chain** (rvf-types/rvf-crypto): DNA-style provenance chains
- **Overlay chain** (rvf-manifest): Manifest rollback pointers for
  point-in-time recovery

---

## 10. Feature Flags and WASM Compatibility

### rvf-types Features

```toml
default = []
alloc = []           # Enables Vec, format!, etc.
std = ["alloc"]      # Full std library
serde = ["dep:serde"]
ed25519 = ["dep:ed25519-dalek", "dep:rand_core"]
```

The crate is `#![cfg_attr(not(feature = "std"), no_std)]` -- fully
`no_std`/`no_alloc` compatible for embedded and WASM targets.

### rvf-wire Features

```toml
default = ["std"]
std = ["rvf-types/std"]
```

### rvf-runtime Features

```toml
default = ["std"]
std = []
wasm = []           # WASM-specific code paths
qr = []             # QR code encoding for seeds
ed25519 = ["rvf-types/ed25519"]
```

### rvf-wasm (Dedicated WASM Crate)

Contains WASM-specific implementations:
- `alloc_setup.rs` -- custom allocator for WASM
- `memory.rs` -- linear memory management
- `segment.rs` -- segment parsing in WASM context
- `distance.rs` -- SIMD distance computation
- `store.rs` -- WASM-compatible store operations
- `bootstrap.rs` -- self-bootstrapping sequence
- `topk.rs` -- top-k heap for queries

---

## 11. ExoChain Segment Type Proposal

### Can We Define an "ExoChain Segment" for RVF?

**Yes.** Here is a concrete proposal based on the analysis.

### 11.1 Proposed Discriminant

```rust
/// Temporal-immutable event log (ExoChain entries).
ExoChain = 0x40,
```

Rationale: `0x40` starts a new cluster in an unused range (`0x37..=0xEF`),
establishing an "event/audit/chain" semantic group at `0x40..=0x4F`.

### 11.2 Proposed ExoChainHeader (64 bytes)

```rust
#[repr(C)]
pub struct ExoChainHeader {
    /// Magic: "RVXC" (0x52565843).
    pub exo_magic: u32,
    /// Header version (start at 1).
    pub header_version: u16,
    /// Chain type: 0=linear, 1=DAG, 2=tree.
    pub chain_type: u8,
    /// Entry format: 0=raw, 1=CBOR, 2=bincode, 3=protobuf.
    pub entry_format: u8,
    /// Number of entries in this segment.
    pub entry_count: u32,
    /// Total payload size of all entries (excl. this header).
    pub entries_size: u32,
    /// Epoch of the first entry in this segment.
    pub epoch_start: u64,
    /// Epoch of the last entry in this segment.
    pub epoch_end: u64,
    /// SHAKE-256 hash of the previous ExoChain segment's header+payload.
    pub prev_segment_hash: [u8; 16],
    /// Root hash of the Merkle tree over all entries (first 16 bytes).
    pub merkle_root: [u8; 16],
}
```

### 11.3 Entry Wire Format (Variable Length)

```
Offset  Size    Field
0x00    8       timestamp_ns (u64 LE, nanosecond UNIX epoch)
0x04    16      entry_id (UUID or hash)
0x14    16      prev_entry_hash (chain link, first 128 bits of SHAKE-256)
0x24    1       entry_type (0=event, 1=state, 2=command, 3=query)
0x25    1       flags (0x01=signed, 0x02=encrypted, 0x04=tombstone)
0x26    2       payload_len (u16 LE)
0x28    var     payload (entry_format-encoded data)
```

### 11.4 Integration Points

1. **Witness chain linkage**: Each ExoChain segment can reference a
   WITNESS_SEG for governance/audit metadata. Use the existing `prev_hash`
   chain mechanism.

2. **Lineage integration**: ExoChain entries naturally participate in the
   FileIdentity lineage system -- each RVF file with ExoChain segments
   carries its own verifiable audit trail.

3. **Compaction handling**: ExoChain segments should be flagged as
   `SegmentFlags::SEALED` and preserved byte-for-byte during compaction.
   This requires a one-line addition to the compaction code to preserve
   segments with `seg_type == ExoChain`.

4. **WASM compatibility**: The `no_std` design of `rvf-types` means
   ExoChain types compile to WASM out of the box. The WASM microkernel
   can parse and verify ExoChain segments.

5. **Signature support**: Use the existing SignatureFooter mechanism with
   the SIGNED flag to sign individual ExoChain segments.

### 11.5 What Would Need to Change in RVF

| Change | File | Effort |
|--------|------|--------|
| Add `ExoChain = 0x40` variant | `rvf-types/src/segment_type.rs` | 3 lines |
| Add `ExoChainHeader` type | `rvf-types/src/exochain.rs` (new) | ~80 lines |
| Add `write_exochain_seg()` | `rvf-runtime/src/write_path.rs` | ~30 lines |
| Preserve in compaction | `rvf-runtime/src/store.rs` | ~5 lines |
| CLI `embed-exochain` command | `rvf-cli/src/cmd/` | ~100 lines |
| Wire codec | `rvf-wire/src/exochain_codec.rs` (new) | ~60 lines |

**Total estimated effort**: ~280 lines of Rust, no breaking changes.

### 11.6 Key Design Properties

- **Temporal immutability**: Once written, ExoChain segments are SEALED and
  never modified. New events append new segments.
- **Hash chaining**: Each segment's `prev_segment_hash` creates a
  tamper-evident chain across segments, and each entry's `prev_entry_hash`
  creates a chain within segments.
- **Self-contained audit trail**: Every RVF file carries its own ExoChain
  segments -- no external database needed.
- **Forward-compatible**: Old readers that do not understand `0x40` will
  skip ExoChain segments gracefully (already verified by the unknown
  segment read tolerance test).
- **`no_std` / WASM compatible**: Following the same pattern as all other
  RVF types.

---

## 12. Summary of Key Findings

1. **RVF is a mature, well-designed binary container** with 28+ segment types,
   64-byte SIMD-aligned headers, three checksum algorithms, post-quantum
   signatures, and `no_std`/WASM compatibility.

2. **The segment type system is extensible by design** -- unknown types are
   tolerated on read and have explicit discriminant ranges available.

3. **A dedicated ExoChain segment type is feasible** and would integrate
   naturally with the existing witness chain, lineage, and signature systems.

4. **The main integration risk** is compaction: the current implementation
   drops unknown segments. This must be fixed (preserve-by-default) before
   any new segment type can be considered durable. The test infrastructure
   for validating this is already in place.

5. **No ExoChain references exist** in the current codebase -- this would be
   a greenfield addition.

6. **WASM support is deep**: dedicated crate, self-bootstrapping architecture,
   5 target platforms, 8 feature flags, and a WASM segment type that embeds
   entire execution runtimes into the file.
