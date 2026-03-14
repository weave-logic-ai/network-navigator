# RVF Engine Integration -- Refinement

## 1. Edge Cases & Boundary Conditions

### Empty / Minimal Profiles

Some contacts have almost no profile text (name only, no headline, no about):

```
Contact: { name: "John Smith", profileUrl: "...", title: "", about: "", headline: "" }
→ buildProfileText() returns "John Smith"
→ Embedding is mostly noise (no semantic signal)
```

**Decision**: Still embed these contacts. Their vectors will be low-quality but:
- They still participate in k-NN (might cluster with other sparse profiles)
- Metadata search (scores, tiers) still works on them
- When enriched later, re-vectorize updates the embedding

**Guard**: `buildProfileText()` must always return a non-empty string. Minimum fallback: the contact's name.

### Duplicate Profile URLs

Contacts keyed by URL may have trailing slashes or query params:
- `https://linkedin.com/in/janedoe`
- `https://linkedin.com/in/janedoe/`
- `https://linkedin.com/in/janedoe?miniProfileUrn=...`

**Decision**: Normalize in `vectorize.mjs` before using as RVF entry ID:
```javascript
const id = url.replace(/\/$/, '').split('?')[0];
```
This matches what `db.mjs` already does for contacts.json keys.

### graph.json vs contacts.json Source Mismatch

`graph.json` has scores but may be stale. `contacts.json` is always current but has no scores.

**Decision**:
- `--from-graph` (default for `--rebuild` pipeline): Use graph.json. Scores are embedded in metadata.
- `--from-contacts`: Use contacts.json. No scores in metadata yet (will be populated after scoring).
- `--incremental`: Checks both sources for new contacts not yet in RVF store.

### RVF Store Larger Than graph.json

For 10K contacts, RVF (~15-50 MB) may exceed graph.json (~5-10 MB) due to index overhead.

**Decision**: Acceptable tradeoff. The HNSW index enables O(log n) search vs O(n). Users with storage constraints can skip ruvector entirely (JSON-only mode).

### First-Time User (No Data Yet)

User installs skill, runs `/linkedin-prospector vectorize` before any contacts exist.

**Decision**: vectorize.mjs checks contact count. If zero:
```
No contacts to vectorize. Run a search first:
  /linkedin-prospector find me 20 [niche] contacts
```

### ruvector Package Version Drift

ruvector is rapidly iterating (113 versions). API may change.

**Decision**:
- Pin to `^0.2.12` in optionalDependencies (allows patch updates, not major)
- All ruvector calls go through `rvf-store.mjs` (single wrapper point)
- If API changes, only rvf-store.mjs needs updating

## 2. CJS/ESM Compatibility

The skill uses ESM (`type: "module"` in package.json, `.mjs` extensions). ruvector publishes CJS (`exports.X = ...`).

**Problem**: `import { OnnxEmbedder } from 'ruvector'` in ESM importing CJS.

**Solution**: Use dynamic import which handles CJS→ESM interop automatically:
```javascript
const ruvector = await import('ruvector');
const { OnnxEmbedder } = ruvector.default || ruvector;
```

**Fallback**: If default export wrapping causes issues:
```javascript
const { createRequire } = await import('module');
const require = createRequire(import.meta.url);
const ruvector = require('ruvector');
```

This is exactly how ruvector's own onnx-embedder.js handles it (see line 71 of the source).

## 3. Model Download & Offline Support

The ONNX model (`all-MiniLM-L6-v2`) downloads from HuggingFace on first use (~30 MB).

**Scenarios**:
- **First run with internet**: Model downloads, caches locally. Subsequent runs are instant.
- **First run without internet**: OnnxEmbedder falls back to hash-based embedding. Warning printed. Semantic quality is reduced but k-NN still works for finding structurally similar profiles.
- **Cache location**: `~/.cache/ruvector/models/` (or custom via `OnnxEmbedderConfig.cacheDir`)
- **Air-gapped environments**: User can pre-download model and set `cacheDir` in vectorize.mjs config.

## 4. Metadata Size Limits

RVF metadata is stored as JSON per vector. Large `about` sections could bloat the store.

**Decision**: Cap `about` at 300 characters in metadata (matching current extractProfileFromHtml limit). Full about text is still in contacts.json for reference.

Other fields are naturally bounded:
- name: < 80 chars
- headline: < 200 chars
- location: < 100 chars
- currentRole/currentCompany: < 100 chars each

Total metadata per contact: ~1-2 KB. For 10K contacts: ~10-20 MB metadata overhead.

## 5. Concurrent Access

Multiple scripts could access network.rvf simultaneously (e.g., scorer running while analyzer queries).

**Decision**: rvf-store.mjs uses a module-level singleton with open/close lifecycle. Within a single script run, this is safe. Across scripts (pipeline runs them sequentially via execFileSync), each script opens/closes the store independently.

If future work enables parallel script execution, RVF's crash-safe writes and single-writer model prevent corruption. Readers and the writer can coexist.

## 6. Incremental Vectorize Strategy

For `--incremental` mode, we need to know which contacts are already in the store.

**Option A**: Query RVF for all IDs (if API supports listing).
**Option B**: Keep a sidecar `embedded-ids.json` tracking what's been embedded.
**Option C**: Try to get each contact by ID; if found, skip.

**Decision**: Option C is simplest and works with the current RVF API. For batch efficiency, we can collect IDs to check in batches rather than one-by-one. If RVF adds a `listIds()` API, switch to Option A.

Alternatively: always re-embed everything. The ONNX embedder is fast enough (~100ms per contact) that 1K contacts takes ~2 minutes. For most LinkedIn networks (< 5K contacts), full re-vectorization is acceptable.

**Revised decision**: Default to full re-vectorize. `--incremental` is a future optimization, not MVP.

## 7. Scoring Pipeline Order

Current pipeline: graph-builder → scorer → behavioral → referral → analyze

With vectorize added: graph-builder → scorer → behavioral → referral → **vectorize** → analyze

**Rationale**: Vectorize runs after all scorers so that metadata includes complete scores from all three layers. This means one pass: embed + ingest with full metadata.

**Alternative considered**: Vectorize after graph-builder, then scorers update RVF metadata separately. Rejected because:
- Requires 3 extra RVF update passes (one per scorer)
- More complex, more error-prone
- No benefit since vectorize is fast anyway

## 8. Report Generator Integration

The HTML report currently reads graph.json to build charts and the 3D network graph.

**Decision for MVP**: Report generator continues reading graph.json. The RVF store is an additive layer, not a replacement for graph.json in the report pipeline.

**Future enhancement**: Report generator could query RVF for "similar contacts" edges to add to the 3D graph, creating a richer visualization showing semantic clusters alongside structural clusters.

## 9. Export Format

`db.mjs export` currently outputs contacts.json as-is.

**Enhancement**: Add `--format rvf` option to export the RVF store, and `--format json` (default) to export contacts as JSON.

For JSON export from RVF: iterate all entries, extract metadata, format as the same JSON structure graph.json uses. This enables round-tripping: JSON → RVF → JSON.

## 10. .gitignore Updates

Add to existing .gitignore:
```
# RVF stores (runtime, contains PII)
skills/linkedin-prospector/data/network.rvf
skills/linkedin-prospector/data/snapshots/*.rvf

# ONNX model cache
.cache/
```

## 11. Checklist Before Implementation

- [ ] Verify `npm install ruvector` works on current platform (Linux WSL2 x64)
- [ ] Verify OnnxEmbedder initializes and produces 384-dim vectors
- [ ] Verify createRvfStore / openRvfStore / rvfIngest / rvfQuery work
- [ ] Verify CJS import from ESM works (`await import('ruvector')`)
- [ ] Verify model download from HuggingFace (or fallback behavior)
- [ ] Verify existing pipeline still works with ruvector installed but no network.rvf yet
- [ ] Verify existing pipeline works without ruvector installed at all
