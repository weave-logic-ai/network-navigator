# RVF Engine Integration -- Architecture

## 1. System Architecture

```
  Integration architecture

  contacts.json (raw data)
        |
        v
    vectorize.mjs (new)          <-- generates embeddings from profile text
        |
        v
    network.rvf (single file)    <-- replaces graph.json
        |  Contains:
        |  VEC_SEG     -- 384-dim embeddings per contact
        |  INDEX_SEG   -- HNSW graph for k-NN search
        |  META_SEG    -- all scores, tiers, personas, metadata
        |  COW_MAP_SEG -- delta snapshots (replaces snapshots/ dir)
        |
        v
    analyzer.mjs (enhanced)      <-- adds semantic search modes
    scorer.mjs (enhanced)        <-- writes scores to RVF metadata
    report-generator.mjs         <-- reads from RVF instead of graph.json



                         ┌─────────────────────────────────────┐
                         │        Claude Code User             │
                         │  /linkedin-prospector vectorize     │
                         │  /network-intel similar to [X]      │
                         └───────────────┬─────────────────────┘
                                         │
                    ┌────────────────────┼────────────────────┐
                    │            Pipeline Orchestrator        │
                    │              (pipeline.mjs)             │
                    └────┬──────┬──────┬──────┬──────┬────────┘
                         │      │      │      │      │
              ┌──────────┘  ┌───┘  ┌───┘  ┌───┘  ┌───┘
              ▼             ▼      ▼      ▼      ▼
         ┌──────────┐  ┌────────┐ ┌────┐ ┌────┐ ┌──────────┐
         │ search   │  │enrich  │ │scor│ │beha│ │vectorize │
         │ enrich   │  │        │ │er  │ │vior│ │  (NEW)   │
         └────┬─────┘  └───┬────┘ └─┬──┘ └─┬──┘ └────┬─────┘
              │             │        │      │         │
              ▼             ▼        ▼      ▼         ▼
         ┌──────────────────────────────────────────────────┐
         │                   Data Layer                     │
         │                                                  │
         │  ┌──────────────┐    ┌──────────────────────────┐│
         │  │contacts.json │    │    network.rvf           ││
         │  │(raw profiles)│    │  ┌────────────────────┐  ││
         │  └──────────────┘    │  │VEC_SEG  384-dim    │  ││
         │                      │  │INDEX_SEG HNSW      │  ││
         │  ┌──────────────┐    │  │META_SEG  scores    │  ││
         │  │ graph.json   │    │  │COW_MAP   snapshots │  ││
         │  │(export/compat)│   │  └────────────────────┘  ││
         │  └──────────────┘    └──────────────────────────┘│
         └──────────────────────────────────────────────────┘
```

## 2. Component Diagram

### New Components

```
rvf-store.mjs (NEW)
├── openStore()          Open or create network.rvf
├── closeStore()         Flush and close
├── queryStore()         k-NN search with optional filters
├── ingestContacts()     Batch upsert vectors + metadata
├── deriveSnapshot()     COW branch for delta tracking
├── getContact()         Get single contact by ID
└── isRvfAvailable()     Check if ruvector is installed

vectorize.mjs (NEW)
├── buildProfileText()   Concatenate profile fields into embed-ready text
├── buildMetadata()      Extract score/profile metadata for RVF storage
├── main()               Orchestrate batch embedding + ingest
│   ├── Load contacts from graph.json or contacts.json
│   ├── Initialize OnnxEmbedder (384-dim, WASM, parallel workers)
│   ├── Batch embed profile texts
│   ├── Ingest into RVF store
│   └── Report statistics
└── CLI flags: --from-graph, --incremental, --batch-size N
```

### Modified Components

```
lib.mjs
├── (existing exports)
├── RVF_STORE_PATH       Path to network.rvf
└── isRvfAvailable()     Dynamic ruvector detection

analyzer.mjs
├── (existing 10 modes)
├── similar (NEW)        k-NN from a contact's embedding
└── semantic (NEW)       Free-text query embedding search

scorer.mjs
├── (existing scoring logic)
└── updateRvfScores()    Write scores to RVF metadata after scoring

behavioral-scorer.mjs
├── (existing scoring logic)
└── updateRvfScores()    Write behavioral scores to RVF metadata

referral-scorer.mjs
├── (existing scoring logic)
└── updateRvfScores()    Write referral scores to RVF metadata

pipeline.mjs
├── (existing modes)
├── --vectorize (NEW)    Run vectorize.mjs standalone
└── rebuild/full         Now includes vectorize step

delta.mjs
├── (existing snapshot logic)
└── RVF COW branch       Derive snapshot.rvf instead of snapshot JSON

report-generator.mjs
├── (existing report logic)
└── Read from RVF        Use vector similarity for graph edge weights

db.mjs
├── (existing subcommands)
└── search               Uses vector similarity when RVF available
```

## 3. Data Flow

### Initial Setup (first vectorize)

```
contacts.json ──► graph-builder.mjs ──► graph.json
                                            │
                                            ▼
                                      scorer.mjs ──► graph.json (updated with scores)
                                            │
                                            ▼
                                  behavioral-scorer.mjs ──► graph.json (updated)
                                            │
                                            ▼
                                   referral-scorer.mjs ──► graph.json (updated)
                                            │
                                            ▼
                                     vectorize.mjs
                                       │         │
                                       │    OnnxEmbedder
                                       │    (all-MiniLM-L6-v2)
                                       │         │
                                       ▼         ▼
                                    network.rvf
                                    (vectors + index + metadata)
```

### Incremental Update (new contacts added)

```
search.mjs ──► contacts.json (new contacts)
                    │
                    ▼
              enrich.mjs ──► contacts.json (enriched)
                    │
                    ▼
             graph-builder.mjs ──► graph.json (rebuilt)
                    │
                    ▼
               scorer.mjs ──► graph.json + network.rvf (metadata update)
                    │
                    ▼
          vectorize.mjs --incremental
                    │
                    ▼
               network.rvf (new vectors ingested, existing unchanged)
```

### Semantic Search Query

```
User: "find contacts similar to Jane Doe"
  │
  ▼
analyzer.mjs --mode similar --url linkedin.com/in/janedoe
  │
  ├──► OnnxEmbedder.embed("VP Engineering | ...")
  │         │
  │         ▼
  │    Float32Array(384) -- query vector
  │         │
  │         ▼
  ├──► rvfQuery(store, queryVector, k=20)
  │         │
  │         ▼
  │    [{id, distance}, {id, distance}, ...]
  │         │
  │         ▼
  └──► Display ranked results with similarity scores
```

## 4. Dependency Graph

```
                    ruvector (npm, optional)
                    ├── @ruvector/core     ──► HNSW, VectorDb
                    ├── @ruvector/rvf      ──► RvfDatabase, segments
                    ├── @ruvector/sona     ──► (future: adaptive learning)
                    ├── @ruvector/gnn      ──► (future: graph neural net)
                    └── @ruvector/attention ──► (future: attention mechanisms)

                    playwright (npm, required)
                    └── chromium           ──► LinkedIn browser automation

New dependency chain:
  vectorize.mjs ──► rvf-store.mjs ──► ruvector (optional import)
  analyzer.mjs  ──► rvf-store.mjs ──► ruvector (optional import)
  scorer.mjs    ──► rvf-store.mjs ──► ruvector (optional import)

No script hard-depends on ruvector. All imports are dynamic with fallback.
```

## 5. Error Handling Strategy

### Graceful Degradation Tiers

```
Tier 1: Full RVF (ruvector installed + model downloaded)
  - Semantic search, k-NN, metadata queries
  - ONNX WASM embeddings (384-dim)
  - COW snapshots

Tier 2: RVF without ONNX (ruvector installed, model download fails)
  - Hash-based embeddings (OnnxEmbedder fallback)
  - k-NN still works but similarity is approximate
  - All other features work

Tier 3: JSON only (ruvector not installed)
  - Current behavior preserved exactly
  - Warning printed on first use: "Install ruvector for semantic search"
  - No semantic search, no k-NN
  - All scoring, analysis, reporting works as before
```

### Error Boundaries

```
Every RVF operation is wrapped:

async function safeRvfOp(operation, fallback) {
  if (!isRvfAvailable()) return fallback()
  try {
    return await operation()
  } catch (err) {
    console.warn(`RVF: ${err.message} — falling back to JSON`)
    return fallback()
  }
}
```

## 6. Performance Architecture

### Embedding Pipeline (Batch)

```
Contacts (N=1000)
  │
  ▼ chunk into batches of 50
  │
  ├──► Batch 1:  50 texts ──► OnnxEmbedder.embedBatch() ──► 50 vectors
  ├──► Batch 2:  50 texts ──► OnnxEmbedder.embedBatch() ──► 50 vectors
  │    ...
  └──► Batch 20: 50 texts ──► OnnxEmbedder.embedBatch() ──► 50 vectors
  │
  ▼ ingest all 1000 vectors in bulk
  │
  network.rvf
```

Parallel workers (3.8x speedup) kick in automatically for batches >= 4 texts.

### Query Path

```
Query: embed("AI consulting") ──► Float32Array(384)
  │
  ▼ HNSW traversal (O(log n))
  │   Layer 0: ~16 comparisons
  │   Layer 1: ~16 comparisons
  │   ...
  │   ef_search=50 candidates evaluated
  │
  ▼ Return top-k results
  │
  [{id, distance, metadata}, ...]
  │
  Total: < 5ms for 10K contacts
```

## 7. Security Considerations

- `.rvf` files contain the same PII as graph.json (names, profiles, scores)
- `.rvf` path follows `PROSPECTOR_DATA_DIR` (same as other runtime data)
- `.gitignore` already covers `data/` runtime files
- No API keys needed for embedding (ONNX runs locally)
- Model download is from HuggingFace CDN (HTTPS, checksum verified by ruvector)

## 8. Testing Strategy

### Unit Tests
- `buildProfileText()` with various contact shapes (missing fields, empty, etc.)
- `buildMetadata()` mapping from graph.json format to RVF metadata
- Fallback behavior when ruvector not installed

### Integration Tests
- Vectorize 10 test contacts, verify RVF store has 10 entries
- Query by similar contact, verify self is highest similarity
- Score update propagates to RVF metadata
- Incremental vectorize skips existing contacts
- JSON export from RVF matches expected format

### Smoke Tests
- Full pipeline with `--rebuild` includes vectorize step
- Analyzer `--mode similar` returns reasonable results
- Analyzer `--mode semantic` with free-text query returns results
- `delta.mjs --snapshot` creates COW branch
- Pipeline works correctly with ruvector not installed (JSON fallback)
