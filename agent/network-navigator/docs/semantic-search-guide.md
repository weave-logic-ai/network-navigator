# Semantic Search Guide -- ruvector Integration

NetworkNav uses [ruvector](https://github.com/ruvnet/ruvector), built into the ruvector-postgres Docker image, to provide semantic vector search across your contact network. Instead of matching exact keywords, semantic search understands the *meaning* of profiles and queries, finding relevant contacts even when they use different terminology.

---

## Table of Contents

1. [How It Works](#1-how-it-works)
2. [Building and Managing Embeddings](#2-building-and-managing-embeddings)
3. [Search Modes](#3-search-modes)
4. [Architecture](#4-architecture)
5. [Pipeline Integration](#5-pipeline-integration)
6. [Troubleshooting](#6-troubleshooting)

---

## 1. How It Works

Each contact's profile text (headline, role, company, about section, location) is converted into a 384-dimensional vector using the all-MiniLM-L6-v2 model. These vectors capture semantic meaning -- contacts with similar professional backgrounds produce similar vectors, even if they use different words.

The vectors are stored in the `profile_embeddings` table in PostgreSQL with HNSW indexes for fast approximate nearest-neighbor lookup. When you search, your query is embedded into the same vector space and the most similar contacts are returned, ranked by cosine similarity.

ruvector is always available -- it ships as part of the ruvector-postgres Docker image used by the database container. There is no separate installation step.

### What Semantic Search Finds That Keywords Miss

| Keyword search for... | Also finds (via semantic similarity)... |
|---|---|
| "AI consultant" | "machine learning advisor", "data science practice lead" |
| "ecommerce founder" | "DTC brand builder", "Shopify agency owner" |
| "VP Engineering" | "Head of Platform", "Director of Software Development" |
| "growth marketing" | "demand generation", "customer acquisition", "performance marketing" |

---

## 2. Building and Managing Embeddings

### How Embeddings Are Created

Embeddings are generated automatically when contacts are scored or enriched. The scoring pipeline includes an embedding step that converts each contact's profile text into a vector and stores it in the `profile_embeddings` table.

### When Embeddings Update

- **New contact captured** -- Embedding generated during initial scoring.
- **Contact enriched** -- Embedding regenerated with richer profile text.
- **Rescore-all triggered** -- All embeddings refreshed.

### Manual Refresh

To force-regenerate all embeddings, trigger a full rescore:

```bash
POST /api/scoring/rescore-all
```

### Storage Details

Embeddings live in PostgreSQL alongside your contact data:

| Table | Contents |
|-------|----------|
| `profile_embeddings` | 384-dim float vectors, one per contact |
| HNSW index | Approximate nearest-neighbor index for fast search |

There are no local `.rvf` files to manage. Everything is in the database.

---

## 3. Search Modes

### Hybrid Search (recommended)

Combines keyword matching and vector similarity for the best results:

```
GET /api/contacts/hybrid-search?q=AI+transformation+leaders&limit=20
```

Returns contacts ranked by a blend of keyword relevance and semantic similarity. This is the default search mode used by the dashboard and the agent.

### Semantic-Only Search

For pure meaning-based search (no keyword matching):

```
/network-intel who talks about AI transformation?
/network-intel search for people in cloud infrastructure
```

The agent uses the hybrid search endpoint internally.

### Similar Contacts

Find contacts whose profiles are most similar to a specific person:

```
/network-intel find contacts similar to Jane Smith
```

This looks up the target contact's stored vector and runs k-NN search against all other contacts.

**Example output:**

```
Contacts Similar to: Jane Smith
  1. [gold] Alex Chen (similarity: 0.847)
     VP Engineering | Cloud Infrastructure | Scaling distributed systems
  2. [silver] Pat Johnson (similarity: 0.812)
     Director of Platform Engineering at DataCorp
  3. [bronze] Sam Lee (similarity: 0.789)
     Head of SRE | Building resilient systems at scale
```

### Semantic Query Search

Search by describing what you are looking for in natural language:

```
/network-intel who talks about AI transformation?
```

**Example output:**

```
Semantic Search: "AI transformation leaders"
  1. [gold] Maria Garcia (relevance: 0.723)
     Chief AI Officer | Driving enterprise AI adoption
  2. [silver] Chris Lee (relevance: 0.691)
     VP Digital Transformation | Machine Learning Strategy
  3. [bronze] Jordan Park (relevance: 0.654)
     Head of Applied AI at TechCorp
```

---

## 4. Architecture

### Data Flow

```
+-------------------+   scoring pipeline    +-------------------+
|  Contact created  |--------------------->|  PostgreSQL        |
|  or enriched      |   embed profile text  |                   |
+-------------------+                      |  profile_embeddings|
                                           |  (384-dim vectors) |
                                           |  HNSW index        |
                                           +--------+----------+
                                                    |
                                  +-----------------+------------------+
                                  |                                    |
                                  v                                    v
                          Hybrid search                       Similar contacts
                          GET /api/contacts/                  k-NN from stored
                          hybrid-search?q=...                 vector
```

### Embedding Model

| Parameter | Value |
|-----------|-------|
| Model | all-MiniLM-L6-v2 |
| Dimensions | 384 |
| Distance metric | Cosine similarity |

### HNSW Index Configuration

| Parameter | Value | Description |
|-----------|-------|-------------|
| Dimensions | 384 | all-MiniLM-L6-v2 output dimension |
| Distance metric | cosine | Higher = more similar |
| M | 16 | Max connections per HNSW layer |
| efConstruction | 200 | Construction-time search breadth |

### What Gets Embedded

The embedding input for each contact is built from:
- Headline
- Current role and company
- About section
- Location
- Skills/tags

This text is concatenated and embedded into a single 384-dim vector.

### Metadata Stored Alongside Vectors

| Category | Fields |
|----------|--------|
| Identity | profileUrl, name, headline, title, location, currentCompany |
| Scoring | compositeScore, tier, persona, behavioralPersona |
| Referral | referralLikelihood, referralTier, referralPersona |
| Graph | clusterIds, edgeCount, mutualConnectionCount |
| Timestamps | createdAt, updatedAt, embeddedAt |

---

## 5. Pipeline Integration

### Automatic Embedding

The scoring pipeline includes an embedding step that runs after all dimension scorers complete:

```
Contact captured/enriched
  --> 9 dimension scorers
  --> Composite score computed
  --> Referral scoring
  --> Profile text embedded (384-dim vector)
  --> Stored in profile_embeddings with HNSW index
```

Embeddings include the latest scoring metadata, so search results always reflect current scores and tiers.

### Rescore and Re-embed

When you trigger `POST /api/scoring/rescore-all`, all contacts are re-scored and their embeddings are regenerated. This ensures the vector store reflects any changes to:
- ICP criteria
- Scoring weights
- Enrichment data

---

## 6. Troubleshooting

### Common Issues

| Issue | Cause | Fix |
|-------|-------|-----|
| Search returns no results | No embeddings generated yet | Run `POST /api/scoring/rescore-all` to generate embeddings |
| Search results seem off | Stale embeddings | Rescore to regenerate: `POST /api/scoring/rescore-all` |
| Database container won't start | Port conflict or volume issue | Check `docker compose logs db` |
| Hybrid search endpoint 404 | App not running | Ensure `docker compose up -d` and app is healthy |
| Slow search queries | HNSW index not built | The index builds automatically; check DB logs for errors |

### Performance Notes

- **Embedding generation**: Runs as part of the scoring pipeline; no separate step needed.
- **Hybrid search**: Typically <100ms for networks under 10,000 contacts.
- **Similar-contact search**: Near-instant (<50ms) using stored vectors.
- **Storage**: Roughly 1.5KB per contact in the embeddings table.

### Checking Embedding Health

Query the database directly to verify embeddings exist:

```sql
SELECT COUNT(*) FROM profile_embeddings;
```

Compare against total contact count:

```sql
SELECT COUNT(*) FROM contacts;
```

If the embedding count is significantly lower than the contact count, trigger a rescore to regenerate missing embeddings.
