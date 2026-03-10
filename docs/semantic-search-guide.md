# Semantic Search Guide -- ruvector Integration

LinkedIn Prospector integrates with [ruvector](https://github.com/ruvnet/ruvector) to add semantic vector search across your contact network. Instead of matching exact keywords, semantic search understands the *meaning* of profiles and queries, finding relevant contacts even when they use different terminology.

---

## Table of Contents

1. [How It Works](#1-how-it-works)
2. [Installation](#2-installation)
3. [Building the Vector Store](#3-building-the-vector-store)
4. [Search Modes](#4-search-modes)
5. [Slash Command Reference](#5-slash-command-reference)
6. [Script Reference](#6-script-reference)
7. [Architecture](#7-architecture)
8. [Pipeline Integration](#8-pipeline-integration)
9. [Graceful Degradation](#9-graceful-degradation)
10. [Troubleshooting](#10-troubleshooting)

---

## 1. How It Works

Each contact's profile text (headline, role, company, about section, location) is converted into a 384-dimensional vector using the all-MiniLM-L6-v2 ONNX model. These vectors capture semantic meaning -- contacts with similar professional backgrounds produce similar vectors, even if they use different words.

The vectors are stored in a local `.rvf` file (RuVector Format) using HNSW indexing for fast approximate nearest-neighbor lookup. When you search, your query is embedded into the same vector space and the k most similar contacts are returned, ranked by cosine similarity.

### What Semantic Search Finds That Keywords Miss

| Keyword search for... | Also finds (via semantic similarity)... |
|---|---|
| "AI consultant" | "machine learning advisor", "data science practice lead" |
| "ecommerce founder" | "DTC brand builder", "Shopify agency owner" |
| "VP Engineering" | "Head of Platform", "Director of Software Development" |
| "growth marketing" | "demand generation", "customer acquisition", "performance marketing" |

---

## 2. Installation

ruvector is an optional dependency. All existing functionality works without it.

```bash
# Navigate to the skill directory
cd .claude/linkedin-prospector/skills/linkedin-prospector

# Install ruvector
npm i ruvector
```

On first run, the ONNX model (~30MB) is downloaded and cached in `.cache/`. Subsequent runs use the cached model.

### System Requirements

- **Node.js 18+** (same as the base skill)
- **~100MB RAM** for the embedding model during vectorization
- **~30MB disk** for the ONNX model cache (one-time download)
- Store size scales with contact count (~1KB per contact in the `.rvf` file)

### Verifying Installation

```bash
# Check if ruvector is available
node -e "import('ruvector').then(m => console.log('ruvector OK, version:', (m.default || m).getStats?.() || 'loaded'))"
```

---

## 3. Building the Vector Store

After installing ruvector, build the vector store from your scored contacts:

```bash
# Recommended: build from graph.json (includes all scoring metadata)
node scripts/vectorize.mjs --from-graph

# Alternative: build from contacts.json (raw contact data, no scores)
node scripts/vectorize.mjs
```

### vectorize.mjs Options

| Option | Default | Description |
|--------|---------|-------------|
| `--from-graph` | off | Load from `graph.json` instead of `contacts.json`. Includes scoring metadata in the vector store. |
| `--batch-size N` | 50 | Number of contacts to embed per batch. Lower if you hit memory limits. |
| `--verbose` | off | Show per-batch progress and timing. |

### Example Output

```
Embedder ready: 384d, SIMD=avx2
Loading from graph.json: 230 contacts
Contacts to embed: 230
  Progress: 100/230
  Progress: 200/230

Vectorization complete:
  Embedded: 230
  Errors: 0
  Store: /path/to/data/network.rvf
```

### When to Rebuild

Rebuild the vector store when:

- You add new contacts (search, enrich, deep-scan)
- You want updated scoring metadata in search results
- The store file is missing or corrupt

The `--rebuild` and `--full` pipeline modes include a vectorize step automatically (when ruvector is installed).

---

## 4. Search Modes

### Similar (k-NN from stored vector)

Find contacts whose profiles are most similar to a specific person. Uses the target contact's stored vector directly -- no embedder initialization needed, making this very fast.

```bash
node scripts/analyzer.mjs --mode similar --url "https://linkedin.com/in/someone" --top 20
```

**How it works:**
1. Looks up the target contact's pre-computed vector in the store
2. Runs k-NN search to find the closest vectors
3. Returns contacts ranked by cosine similarity

If the target contact hasn't been vectorized yet, it falls back to embedding their profile text on the fly.

**Example output:**

```
=== Contacts Similar to: Jane Smith ===
============================================================
  1. [gold] Alex Chen (similarity: 0.847)
     VP Engineering | Cloud Infrastructure | Scaling distributed systems
  2. [silver] Pat Johnson (similarity: 0.812)
     Director of Platform Engineering at DataCorp
  3. [bronze] Sam Lee (similarity: 0.789)
     Head of SRE | Building resilient systems at scale
```

### Semantic (free-text query)

Search for contacts by describing what you're looking for in natural language. Embeds your query text and finds the most relevant contacts.

```bash
node scripts/analyzer.mjs --mode semantic --query "AI transformation leaders" --top 20
```

**How it works:**
1. Initializes the ONNX embedder
2. Converts your query text into a 384-dim vector
3. Runs k-NN search against all stored contact vectors
4. Returns contacts ranked by relevance (cosine similarity)

**Example output:**

```
=== Semantic Search: "AI transformation leaders" ===
============================================================
  1. [gold] Maria Garcia (relevance: 0.723)
     Chief AI Officer | Driving enterprise AI adoption
  2. [silver] Chris Lee (relevance: 0.691)
     VP Digital Transformation | Machine Learning Strategy
  3. [bronze] Jordan Park (relevance: 0.654)
     Head of Applied AI at TechCorp
```

### DB Search (automatic vector enhancement)

The existing `db.mjs search` command automatically tries semantic search first when ruvector is available, then falls back to substring matching.

```bash
# Tries vector search first, falls back to keyword matching
node scripts/db.mjs search --keywords "cloud infrastructure"
node scripts/db.mjs search --niche saas
```

---

## 5. Slash Command Reference

### Via /network-intel

| What to say | What happens |
|---|---|
| `find contacts similar to [URL]` | `analyzer.mjs --mode similar --url <url>` |
| `who's like [name]?` | `analyzer.mjs --mode similar --url <url>` |
| `who talks about [topic]?` | `analyzer.mjs --mode semantic --query "topic"` |
| `search for people in [field]` | `analyzer.mjs --mode semantic --query "field"` |
| `semantic search for [description]` | `analyzer.mjs --mode semantic --query "description"` |
| `vectorize my contacts` | `vectorize.mjs --from-graph` |
| `build the vector store` | `vectorize.mjs --from-graph` |

### Via /linkedin-prospector

| What to say | What happens |
|---|---|
| `search for "[natural language]"` | `db.mjs search --keywords "..."` (uses vectors when available) |
| `vectorize my contacts` | `vectorize.mjs --from-graph` |
| `enable semantic search` | Checks ruvector installation, suggests install if missing, then runs vectorize |

---

## 6. Script Reference

### vectorize.mjs

Standalone embedding pipeline. Reads contacts from `graph.json` or `contacts.json`, generates 384-dim embeddings via the ONNX model, and stores them with full metadata in the RVF vector store.

```bash
node scripts/vectorize.mjs --from-graph [--batch-size 50] [--verbose]
```

### rvf-store.mjs

Central abstraction layer over ruvector's VectorDBWrapper. All ruvector interaction goes through this module. Not called directly from the CLI -- it is a library imported by other scripts.

**Exports:**

| Function | Description |
|----------|-------------|
| `isRvfAvailable()` | Synchronous check if ruvector is installed. Returns `true`/`false`. |
| `openStore()` | Open or create the VectorDB instance at `data/network.rvf`. |
| `closeStore()` | Release the store reference. |
| `queryStore(vector, k, filter?)` | k-NN search. Returns `[{ id, score, metadata }]`. |
| `ingestContacts(entries)` | Batch insert `[{ id, vector, metadata }]`. |
| `getContact(id)` | Get a single entry by profile URL. Returns `{ id, vector, metadata }`. |
| `deleteContact(id)` | Remove an entry by profile URL. |
| `storeLength()` | Number of entries in the store. |
| `upsertMetadata(id, partial)` | Merge metadata fields for an existing entry (preserves vector). Used by scorers. |
| `buildProfileText(contact)` | Build consistent profile text for embedding. |
| `buildMetadata(contact, url)` | Build full metadata object for storage. |
| `chunkArray(arr, size)` | Batch utility. |

### analyzer.mjs (modes: similar, semantic)

Two new analysis modes added to the existing 10:

```bash
# Similar: find contacts like a specific person
node scripts/analyzer.mjs --mode similar --url <profile-url> [--top 20]

# Semantic: free-text conceptual search
node scripts/analyzer.mjs --mode semantic --query "description" [--top 20]
```

### db.mjs (enhanced search)

The CLI `search` command tries semantic vector search first, then falls back to substring matching:

```bash
node scripts/db.mjs search --keywords "AI transformation"
node scripts/db.mjs search --niche saas
```

### Scorer RVF Updates

After scoring, each scorer (`scorer.mjs`, `behavioral-scorer.mjs`, `referral-scorer.mjs`) automatically writes updated score metadata into the RVF store via `upsertMetadata()`. This keeps vector store metadata current without requiring a full re-vectorization.

---

## 7. Architecture

### Data Flow

```
                                    +-------------------+
                                    |   ruvector        |
                                    |   (optional dep)  |
                                    +--------+----------+
                                             |
                                             v
+-------------------+   vectorize.mjs   +----+----+
|  graph.json       |----------------->| network  |
|  (scored contacts)|   embed + store  |  .rvf    |
+-------------------+                  +-+--+--+--+
                                         |  |  |
                    +--------------------+  |  +--------------------+
                    |                       |                       |
                    v                       v                       v
            analyzer.mjs            analyzer.mjs             db.mjs
            --mode similar          --mode semantic           search
            (stored vector)         (query embedding)        (auto fallback)
```

### Storage Format

The `.rvf` file stores:

- **Vector**: 384-dim float array per contact (cosine distance, HNSW indexed)
- **Metadata**: Full contact profile including identity, scoring from all three layers, graph position, and timestamps

Metadata fields stored per contact:

| Category | Fields |
|----------|--------|
| Identity | profileUrl, name, headline, title, location, currentRole, currentCompany, about, connections, mutualConnections |
| Enrichment | enriched, enrichedAt, degree, discoveredVia, searchTerms |
| Layer 1 (ICP) | icpFit, networkHub, relationshipStrength, signalBoost, goldScore, tier, persona |
| Layer 2 (Behavioral) | behavioralScore, behavioralPersona |
| Layer 3 (Referral) | referralLikelihood, referralTier, referralPersona |
| Graph | cluster, clusterLabel |
| Timestamps | createdAt, updatedAt, embeddedAt |

### HNSW Configuration

The vector index uses these parameters:

| Parameter | Value | Description |
|-----------|-------|-------------|
| Dimensions | 384 | all-MiniLM-L6-v2 output dimension |
| Distance metric | cosine | Cosine similarity (higher = more similar) |
| M | 16 | Max connections per HNSW layer |
| efConstruction | 200 | Construction-time search breadth |

---

## 8. Pipeline Integration

### Automatic Vectorization

When ruvector is installed, the `--rebuild` and `--full` pipeline modes automatically include a vectorize step:

```
Pipeline --rebuild:
  graph-builder -> scorer -> behavioral-scorer -> referral-scorer -> vectorize -> analyzer -> snapshot

Pipeline --full:
  search -> enrich -> graph-builder -> scorer -> behavioral-scorer -> referral-scorer -> vectorize -> analyzer -> snapshot
```

The vectorize step:
- Runs after all scorers complete (so metadata includes all scores)
- Is skipped if scorers failed (no point vectorizing stale data)
- Has a 5-minute timeout
- Warns on failure but does not block downstream steps (analyzer and snapshot still run)

### Standalone Vectorization

```bash
# Build/rebuild vector store independently
node scripts/vectorize.mjs --from-graph

# Or via pipeline
node scripts/pipeline.mjs --vectorize
```

### Score Metadata Sync

Each scorer automatically upserts its scores into the RVF store after scoring:

| Scorer | Fields Upserted |
|--------|----------------|
| `scorer.mjs` | icpFit, networkHub, relationshipStrength, signalBoost, goldScore, tier, persona |
| `behavioral-scorer.mjs` | behavioralScore, behavioralPersona |
| `referral-scorer.mjs` | referralLikelihood, referralTier, referralPersona |

This means the vector store stays up-to-date with scoring changes even without a full re-vectorization. Re-vectorization is only needed for new contacts (to generate their embedding vectors).

---

## 9. Graceful Degradation

The system operates in three tiers depending on what's available:

### Tier 1: Full RVF (ruvector installed + store built)

All features available:
- `similar` mode uses stored vectors for instant k-NN
- `semantic` mode embeds queries for conceptual search
- `db.mjs search` tries vector search first
- Scorers upsert metadata into the store
- Pipeline includes vectorize step

### Tier 2: ruvector Installed, Store Not Built

- `similar` and `semantic` modes prompt you to run `vectorize.mjs`
- Scorers silently skip RVF upsert (no store to write to)
- All keyword-based functionality works normally

### Tier 3: ruvector Not Installed (JSON-only mode)

- All 10 original analysis modes work identically
- `similar` and `semantic` modes print an install suggestion
- `db.mjs search` uses substring matching only
- Scorers skip RVF integration entirely
- Pipeline skips vectorize step
- Zero impact on existing workflows

**No code paths break.** Every ruvector interaction is wrapped in try/catch with graceful fallback. The `isRvfAvailable()` check is synchronous and runs before any async operations.

---

## 10. Troubleshooting

### Common Issues

| Issue | Cause | Fix |
|-------|-------|-----|
| `ruvector not available` | Not installed | `cd .claude/linkedin-prospector/skills/linkedin-prospector && npm i ruvector` |
| `RVF store not available or empty` | Store not built | `node scripts/vectorize.mjs --from-graph` |
| `RVF store is locked` | Another process has the store open | Close other processes, or delete `data/network.rvf.lock` |
| `Model download taking longer than expected` | First run downloading ONNX model | Wait for download (~30MB). Subsequent runs use cache. |
| `ONNX embedder failed to initialize` | Model file corrupt or missing | Delete `.cache/` and re-run to re-download |
| `No contacts to vectorize` | No contacts in DB | Run a search first: `/linkedin-prospector find me 20 [niche] contacts` |
| `Failed to open RVF store` | Store file corrupt | Delete `data/network.rvf` and rebuild: `node scripts/vectorize.mjs --from-graph` |
| Semantic results seem off | Store built from `contacts.json` without scores | Rebuild from graph: `node scripts/vectorize.mjs --from-graph` |

### Performance Notes

- **Vectorization**: ~50-200 contacts/second depending on hardware (batch embedding)
- **Similar search**: Near-instant (<50ms) when using stored vectors
- **Semantic search**: ~500ms (includes embedding the query text + HNSW lookup)
- **Store size**: ~1KB per contact (230 contacts = ~250KB)
- **Memory during vectorization**: ~100MB for the ONNX model, released after completion

### Rebuilding from Scratch

If the store gets into a bad state:

```bash
# Remove the store file
rm -f .claude/linkedin-prospector/skills/linkedin-prospector/data/network.rvf

# Rebuild
node scripts/vectorize.mjs --from-graph --verbose
```

### Checking Store Health

```bash
# Quick check -- does the store exist and have entries?
node -e "
import { isRvfAvailable, openStore, storeLength } from './.claude/linkedin-prospector/skills/linkedin-prospector/scripts/rvf-store.mjs';
console.log('ruvector available:', isRvfAvailable());
if (isRvfAvailable()) {
  const len = await storeLength();
  console.log('Store entries:', len);
}
"
```
