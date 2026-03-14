# RVF Engine Integration -- Specification

## 1. Problem Statement

LinkedIn Prospector currently stores all contact data, scores, and graph structure in flat JSON files (`contacts.json`, `graph.json`). Every operation (scoring, analysis, reporting) loads the entire JSON into memory and iterates linearly. This creates three problems:

1. **No semantic search** -- cannot answer "find contacts similar to X" or "who talks about AI transformation?"
2. **O(n) on everything** -- sorting, filtering, and clustering scan the full dataset every time
3. **Monolithic writes** -- any score update rewrites the entire multi-MB JSON file

## 2. Solution

Replace the JSON-based graph storage with an RVF (RuVector Format) vector store that provides:

- **HNSW-indexed k-NN search** (O(log n)) for similarity queries
- **384-dimensional semantic embeddings** via ruvector's built-in ONNX embedder (all-MiniLM-L6-v2)
- **Metadata storage** alongside vectors for scores, tiers, personas, profile data
- **COW branching** for delta snapshots (replaces snapshot JSON files)
- **Single-file persistence** (`.rvf`) with crash-safe writes

JSON remains as an import/export format for backward compatibility and portability.

## 3. Functional Requirements

### FR-1: Vectorization Pipeline
- Generate 384-dim embeddings from contact profile text (headline + about + currentRole + currentCompany + title)
- Store embeddings with full metadata (all scores, tiers, personas, profile fields) in `.rvf`
- Support incremental updates (new contacts, re-scored contacts) without full rebuild
- Batch embed with parallel workers for throughput

### FR-2: Semantic Search
- k-NN search: "find 20 contacts most similar to [contact X]"
- Text query search: embed a query string, search for nearest contacts
- Filtered search: combine vector similarity with metadata filters (e.g., tier=gold, industry=saas)

### FR-3: Score Storage
- All three scoring layers (ICP+Gold, behavioral, referral) write scores as metadata on the vector entry
- Scores are queryable/filterable without loading the full dataset
- Score updates modify metadata in-place, no full rewrite

### FR-4: Backward Compatibility
- Import from existing `contacts.json` and `graph.json` (migration path)
- Export to JSON at any time (`--format json`)
- Scripts that currently read `graph.json` can optionally read from RVF
- Graceful fallback if `ruvector` is not installed (JSON-only mode)

### FR-5: Delta Snapshots
- Use RVF COW branching (`rvfDerive`) for point-in-time snapshots
- Replace current JSON-based snapshot system in `delta.mjs`
- Support diff between two RVF snapshots

### FR-6: Dashboard Integration
- Report generator reads from RVF store for contact data and scores
- Similarity data can feed the 3D network graph visualization

## 4. Non-Functional Requirements

### NFR-1: Performance
- Embedding generation: < 100ms per contact (ONNX WASM)
- k-NN search (k=20): < 5ms for 10K contacts
- Full vectorization of 1,000 contacts: < 2 minutes (batch + parallel)
- Cold start (open store + first query): < 500ms

### NFR-2: Storage
- 1,000 contacts: < 5 MB (vectors + index + metadata)
- 10,000 contacts: < 50 MB
- Model cache (all-MiniLM-L6-v2): ~30 MB one-time download

### NFR-3: Dependency Size
- `ruvector` npm package: 8.8 MB unpacked (includes ONNX WASM runtime)
- No Rust toolchain required (pre-built native bindings, WASM fallback)
- Node.js 18+ required (same as current)

### NFR-4: Resilience
- All scripts work without ruvector installed (JSON fallback)
- Model download failure handled gracefully (hash-based fallback embeddings)
- Corrupt `.rvf` file detected with clear error message and rebuild instructions

## 5. Embedding Strategy

Use ruvector's built-in `OnnxEmbedder` (Option B from research):

```
Profile Text Construction:
  "{headline} | {currentRole} at {currentCompany} | {about}"

Example:
  "VP Engineering | VP of Engineering at Acme SaaS | Building scalable platforms for e-commerce. Previously led teams at Shopify and Stripe. Passionate about developer experience and cloud-native architecture."

  -> OnnxEmbedder.embed(text) -> Float32Array(384)
```

The `OnnxEmbedder`:
- Uses `all-MiniLM-L6-v2` (384 dimensions)
- Downloads model from HuggingFace on first use (~30 MB, cached)
- Runs in pure WASM (no native deps needed)
- Supports batch embedding with parallel workers (3.8x speedup)
- Falls back to hash embedding if ONNX unavailable

## 6. Data Model

### RVF Entry Per Contact

```
id:       profileUrl (e.g., "https://linkedin.com/in/janedoe")
vector:   Float32Array(384) -- semantic embedding of profile text
metadata: {
  // Identity
  name: string,
  enrichedName: string,
  headline: string,
  title: string,
  location: string,
  currentRole: string,
  currentCompany: string,
  about: string,
  connections: string,
  profileUrl: string,

  // Enrichment state
  enriched: boolean,
  enrichedAt: string,       // ISO timestamp
  degree: number,           // 1 or 2
  discoveredVia: string[],
  searchTerms: string[],

  // Layer 1: ICP + Gold Score
  icpFit: number,
  networkHub: number,
  relationshipStrength: number,
  signalBoost: number,
  goldScore: number,
  tier: string,             // "gold" | "silver" | "bronze" | "watch"
  persona: string,          // "buyer" | "advisor" | "hub" | "peer" | "referral-partner"

  // Layer 2: Behavioral
  behavioralScore: number,
  behavioralPersona: string,

  // Layer 3: Referral
  referralLikelihood: number,
  referralTier: string,
  referralPersona: string,

  // Graph
  cluster: number,
  clusterLabel: string,

  // Timestamps
  createdAt: string,
  updatedAt: string,
  embeddedAt: string,
}
```

## 7. File Layout

```
skills/linkedin-prospector/
  scripts/
    vectorize.mjs          NEW -- embedding generation + RVF store management
    rvf-store.mjs          NEW -- shared RVF store helpers (open/create/query/close)
    lib.mjs                MODIFIED -- add RVF_STORE_PATH, isRvfAvailable()
    graph-builder.mjs      MODIFIED -- optionally write to RVF alongside graph.json
    scorer.mjs             MODIFIED -- update RVF metadata after scoring
    behavioral-scorer.mjs  MODIFIED -- update RVF metadata after scoring
    referral-scorer.mjs    MODIFIED -- update RVF metadata after scoring
    analyzer.mjs           MODIFIED -- add --mode similar, --mode semantic
    delta.mjs              MODIFIED -- use COW branching for snapshots
    report-generator.mjs   MODIFIED -- read from RVF store
    pipeline.mjs           MODIFIED -- add vectorize step, --vectorize mode
    db.mjs                 MODIFIED -- search uses vector similarity

  data/
    network.rvf            NEW -- primary vector store (runtime, .gitignored)
    graph.json             KEPT -- export/import format, backward compat
    contacts.json          KEPT -- raw contact database

  package.json             NEW -- declares ruvector dependency
```

## 8. Migration Path

### From existing JSON data

1. User has existing `contacts.json` + `graph.json` from previous sessions
2. Run `/network-intel vectorize` or `node scripts/vectorize.mjs --from-graph`
3. Reads graph.json, generates embeddings for each contact, writes network.rvf
4. All subsequent operations use RVF as primary, JSON as export

### Without ruvector installed

1. All scripts check `isRvfAvailable()` at startup
2. If false, fall through to current JSON-only behavior
3. Warning message: "Install ruvector for semantic search: npm i ruvector"
4. No functionality lost, just no semantic search capability

## 9. API Surface (New Commands)

### Slash commands (additions)

```
/linkedin-prospector vectorize              Build/rebuild RVF store from contacts
/linkedin-prospector vectorize --incremental Only embed new/changed contacts

/network-intel find contacts similar to [name or URL]
/network-intel semantic search "AI transformation leaders"
/network-intel similar --to "https://linkedin.com/in/someone" --top 20
```

### Pipeline modes (additions)

```
node scripts/pipeline.mjs --vectorize      Embed all contacts, build RVF store
node scripts/pipeline.mjs --rebuild        Now includes vectorize step at end
node scripts/pipeline.mjs --full           Now includes vectorize step at end
```

### Analyzer modes (additions)

```
node scripts/analyzer.mjs --mode similar --url <profile-url> --top 20
node scripts/analyzer.mjs --mode semantic --query "AI consulting" --top 20
```
