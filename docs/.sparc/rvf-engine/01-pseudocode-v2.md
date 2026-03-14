# RVF Engine Integration -- Pseudocode v2 (Revised)

Changes from v1: Addresses all 7 critical issues, 14 important issues, and key architectural
concerns from the expert review panel. See `05-consensus.md` for decision rationale.

**API Surface**: VectorDBWrapper exclusively (Decision D-1)
**Import Pattern**: createRequire for sync check, cached dynamic import for module access (D-2, D-5)
**Shared Functions**: buildProfileText, buildMetadata, upsertMetadata, chunkArray in rvf-store.mjs (D-4)

---

## 1. rvf-store.mjs (New -- Shared RVF Store Wrapper)

```javascript
import { createRequire } from 'module'
import { existsSync } from 'fs'
import { resolve } from 'path'
import { DATA_DIR } from './lib.mjs'

const require = createRequire(import.meta.url)

// Constants
export const RVF_PATH = resolve(DATA_DIR, 'network.rvf')
export const DIMENSIONS = 384

// Module-level state
let _db = null       // VectorDBWrapper instance
let _mod = null       // cached ruvector module

// ──────────────────────────────────────────────
// Availability Check (sync, ESM-safe)
// ──────────────────────────────────────────────

export function isRvfAvailable() {
  try {
    require.resolve('ruvector')
    return true
  } catch {
    return false
  }
}

// ──────────────────────────────────────────────
// Module Loader (handles CJS/ESM interop once)
// ──────────────────────────────────────────────

async function loadRuvector() {
  if (_mod) return _mod
  const m = await import('ruvector')
  _mod = m.default || m
  return _mod
}

// ──────────────────────────────────────────────
// Store Lifecycle
// ──────────────────────────────────────────────

export async function openStore() {
  if (_db) return _db
  if (!isRvfAvailable()) return null

  try {
    const { VectorDB } = await loadRuvector()

    _db = new VectorDB({
      dimensions: DIMENSIONS,
      storagePath: RVF_PATH,
      distanceMetric: 'cosine',
      hnswConfig: { m: 16, efConstruction: 200 },
    })

    return _db
  } catch (err) {
    if (err.message && (err.message.includes('lock') || err.code === 'EBUSY')) {
      console.error(`RVF store is locked. Another process may be using it.`)
      console.error(`If no other process is running, delete ${RVF_PATH}.lock and retry.`)
    } else {
      console.error(`Failed to open RVF store: ${err.message}`)
      console.error(`The store may be corrupt. Rebuild with:`)
      console.error(`  node scripts/vectorize.mjs --from-graph`)
    }
    return null
  }
}

export async function closeStore() {
  // VectorDBWrapper manages lifecycle internally.
  // Reset module-level reference so next openStore() creates fresh instance.
  _db = null
}

// ──────────────────────────────────────────────
// Data Operations
// ──────────────────────────────────────────────

export async function queryStore(vector, k = 20, filter = null) {
  const db = await openStore()
  if (!db) return null
  // VectorDBWrapper.search returns [{ id, score, metadata }]
  // score = cosine similarity (higher = more similar)
  return db.search(vector, k, filter)
}

export async function ingestContacts(entries) {
  // entries: [{ id, vector: number[], metadata }]
  const db = await openStore()
  if (!db) return null
  await db.insertBatch(entries)
  return { accepted: entries.length }
}

export async function getContact(id) {
  // Returns { id, vector: number[], metadata } or null
  const db = await openStore()
  if (!db) return null
  return db.get(id)
}

export async function deleteContact(id) {
  const db = await openStore()
  if (!db) return false
  return db.delete(id)
}

export async function storeLength() {
  const db = await openStore()
  if (!db) return 0
  return db.len()
}

// ──────────────────────────────────────────────
// Metadata Upsert (for scorers)
//
// Gets existing entry (preserving vector), re-inserts
// with merged metadata. If entry doesn't exist, skips.
// ──────────────────────────────────────────────

export async function upsertMetadata(id, metadataPartial) {
  const db = await openStore()
  if (!db) return false

  const existing = await db.get(id)
  if (!existing) return false

  const merged = { ...existing.metadata, ...metadataPartial, updatedAt: new Date().toISOString() }
  await db.insertBatch([{ id, vector: existing.vector, metadata: merged }])
  return true
}

// ──────────────────────────────────────────────
// Shared Profile Text Builder
//
// MUST be identical at vectorize-time and query-time
// to ensure embedding consistency.
// ──────────────────────────────────────────────

export function buildProfileText(contact) {
  const parts = []
  if (contact.headline) parts.push(contact.headline)
  if (contact.currentRole && contact.currentCompany) {
    parts.push(`${contact.currentRole} at ${contact.currentCompany}`)
  } else if (contact.title) {
    parts.push(contact.title)
  }
  if (contact.about) {
    parts.push(contact.about.substring(0, 300))
  }
  if (contact.location) {
    parts.push(contact.location)
  }
  return parts.join(' | ') || contact.name || 'Unknown'
}

// ──────────────────────────────────────────────
// Metadata Builder
//
// Field paths verified against actual scorer output:
//   scorer.mjs:       c.scores = { icpFit, networkHub, relationshipStrength,
//                                  signalBoost, goldScore, tier }
//                     c.personaType = string
//   behavioral:       c.behavioralScore = number (top-level)
//                     c.behavioralPersona = string (top-level)
//   referral:         c.scores.referralLikelihood = number (under .scores)
//                     c.referralTier = string (top-level)
//                     c.referralPersona = string (top-level)
// ──────────────────────────────────────────────

export function buildMetadata(contact, url) {
  return {
    // Identity
    profileUrl: url || '',
    name: contact.enrichedName || contact.name || '',
    headline: contact.headline || '',
    title: contact.title || '',
    location: contact.enrichedLocation || contact.location || '',
    currentRole: contact.currentRole || '',
    currentCompany: contact.currentCompany || '',
    about: (contact.about || '').substring(0, 300),
    connections: contact.connections || '',
    mutualConnections: contact.mutualConnections || 0,

    // Enrichment state
    enriched: contact.enriched || false,
    enrichedAt: contact.enrichedAt || '',
    degree: contact.degree || 1,
    discoveredVia: contact.discoveredVia || [],
    searchTerms: contact.searchTerms || [],

    // Layer 1: ICP + Gold Score (all under contact.scores)
    icpFit: contact.scores?.icpFit || 0,
    networkHub: contact.scores?.networkHub || 0,
    relationshipStrength: contact.scores?.relationshipStrength || 0,
    signalBoost: contact.scores?.signalBoost || 0,
    goldScore: contact.scores?.goldScore || 0,
    tier: contact.scores?.tier || 'watch',
    persona: contact.personaType || '',  // NOTE: personaType, not scores.persona

    // Layer 2: Behavioral (top-level on contact)
    behavioralScore: contact.behavioralScore || 0,
    behavioralPersona: contact.behavioralPersona || '',

    // Layer 3: Referral (mixed: likelihood under scores, tier/persona top-level)
    referralLikelihood: contact.scores?.referralLikelihood || 0,
    referralTier: contact.referralTier || '',
    referralPersona: contact.referralPersona || '',

    // Graph
    cluster: contact.cluster ?? -1,
    clusterLabel: contact.clusterLabel || '',

    // Timestamps
    createdAt: contact.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    embeddedAt: new Date().toISOString(),
  }
}

// ──────────────────────────────────────────────
// Utility
// ──────────────────────────────────────────────

export function chunkArray(arr, size) {
  const chunks = []
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size))
  }
  return chunks
}
```

---

## 2. vectorize.mjs (New -- Embedding Pipeline)

```javascript
import { existsSync, readFileSync } from 'fs'
import { resolve } from 'path'
import os from 'os'
import { DATA_DIR, parseArgs } from './lib.mjs'
import {
  isRvfAvailable, openStore, closeStore, ingestContacts,
  buildProfileText, buildMetadata, chunkArray, RVF_PATH, DIMENSIONS
} from './rvf-store.mjs'

async function main() {
  const args = parseArgs(process.argv)

  if (!isRvfAvailable()) {
    console.error('ruvector not available. Install: npm i ruvector')
    process.exit(1)
  }

  // Load ruvector module (CJS/ESM interop handled by loadRuvector pattern)
  const ruvector = await import('ruvector')
  const mod = ruvector.default || ruvector
  const { OnnxEmbedder, getStats, shutdown } = mod

  // Initialize embedder
  const maxWorkers = Math.min(os.cpus().length, 4)
  const embedder = new OnnxEmbedder({
    enableParallel: true,
    parallelThreshold: 4,
    // maxWorkers: maxWorkers,  // if supported by API
  })

  const initTimeout = setTimeout(() => {
    console.warn('Model download taking longer than expected...')
  }, 30000)
  const ready = await embedder.init()
  clearTimeout(initTimeout)

  if (!ready) {
    console.warn('ONNX embedder failed to initialize. Using hash fallback.')
    // embedder still works with hash-based fallback
  }

  const stats = getStats()  // module-level function, NOT embedder.getStats()
  console.log(`Embedder ready: ${stats.dimension || DIMENSIONS}d, SIMD=${stats.simd || 'unknown'}`)

  // Load contacts from graph.json (has scores) or contacts.json (raw)
  let contacts
  const graphPath = resolve(DATA_DIR, 'graph.json')
  const contactsPath = resolve(DATA_DIR, 'contacts.json')

  if (args['from-graph'] && existsSync(graphPath)) {
    const source = JSON.parse(readFileSync(graphPath, 'utf-8'))
    contacts = Object.entries(source.contacts)
    console.log(`Loading from graph.json: ${contacts.length} contacts`)
  } else if (existsSync(contactsPath)) {
    const source = JSON.parse(readFileSync(contactsPath, 'utf-8'))
    contacts = Object.entries(source)
    console.log(`Loading from contacts.json: ${contacts.length} contacts`)
  } else {
    console.error('No contacts to vectorize. Run a search first:')
    console.error('  /linkedin-prospector find me 20 [niche] contacts')
    process.exit(1)
  }

  if (contacts.length === 0) {
    console.error('No contacts found in data file.')
    process.exit(1)
  }

  // Open or create RVF store
  const store = await openStore()
  if (!store) {
    console.error('Failed to open RVF store.')
    process.exit(1)
  }

  // Build embedding entries
  const batchSize = parseInt(args['batch-size'], 10) || 50
  const entries = []

  for (const [url, contact] of contacts) {
    const id = url.replace(/\/$/, '').split('?')[0]  // normalize URL
    const profileText = buildProfileText(contact)
    entries.push({ id, text: profileText, contact, url })
  }

  console.log(`Contacts to embed: ${entries.length}`)

  // Batch embed and ingest
  let embedded = 0
  let errors = 0

  for (const batch of chunkArray(entries, batchSize)) {
    const texts = batch.map(e => e.text)
    try {
      // embedBatch returns number[][] (NOT Float32Array[])
      const vectors = await embedder.embedBatch(texts)
      const rvfEntries = batch.map((entry, i) => ({
        id: entry.id,
        vector: vectors[i],  // number[] -- no Float32Array wrapping needed
        metadata: buildMetadata(entry.contact, entry.url),
      }))
      await ingestContacts(rvfEntries)
      embedded += batch.length
    } catch (batchErr) {
      console.warn(`  Batch embed failed, trying individually: ${batchErr.message}`)
      for (const entry of batch) {
        try {
          const vec = await embedder.embed(entry.text)
          await ingestContacts([{
            id: entry.id,
            vector: vec,
            metadata: buildMetadata(entry.contact, entry.url),
          }])
          embedded++
        } catch {
          errors++
        }
      }
    }

    // Progress
    if (embedded > 0 && embedded % 100 < batchSize) {
      console.log(`  Progress: ${embedded}/${entries.length}`)
    }
  }

  await closeStore()
  await shutdown()  // module-level function, NOT embedder.shutdown()

  console.log(`\nVectorization complete:`)
  console.log(`  Embedded: ${embedded}`)
  console.log(`  Errors: ${errors}`)
  console.log(`  Store: ${RVF_PATH}`)
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
```

---

## 3. analyzer.mjs Additions (Two New Modes)

### 3a. Similar Mode (k-NN from stored contact vector)

```javascript
// Uses stored vector from db.get() -- NO embedder initialization needed (D-8)
async function analyzeSimilar(graph, opts) {
  const { isRvfAvailable, openStore, getContact, queryStore, buildProfileText }
    = await import('./rvf-store.mjs')

  if (!isRvfAvailable()) {
    console.log('Semantic search requires ruvector. Install: npm i ruvector')
    return
  }

  const targetUrl = opts.url
  const targetContact = graph.contacts[targetUrl]
  if (!targetContact) {
    console.log(`Contact not found: ${targetUrl}`)
    return
  }

  // Try to get the stored vector (fast path -- no embedder needed)
  let targetVector
  const stored = await getContact(targetUrl)
  if (stored) {
    targetVector = stored.vector
  } else {
    // Fallback: embed the contact (only if not yet vectorized)
    console.log('  Contact not in vector store, embedding...')
    const ruvector = await import('ruvector')
    const mod = ruvector.default || ruvector
    const embedder = new mod.OnnxEmbedder({ enableParallel: false })
    await embedder.init()
    targetVector = await embedder.embed(buildProfileText(targetContact))
    await mod.shutdown()
  }

  // k-NN search
  const k = opts.top || 20
  const results = await queryStore(targetVector, k + 1)  // +1 to account for self
  if (!results || results.length === 0) {
    console.log('RVF store not available or empty. Run: node scripts/vectorize.mjs --from-graph')
    return
  }

  // Display results
  const name = targetContact.enrichedName || targetContact.name
  console.log(`\nContacts similar to: ${name}`)
  console.log('='.repeat(60))
  let rank = 0
  for (const result of results) {
    if (result.id === targetUrl) continue  // skip self
    rank++
    // VectorDBWrapper.search() returns metadata in results
    const contact = result.metadata || graph.contacts[result.id] || {}
    const displayName = contact.name || result.id
    const similarity = result.score.toFixed(3)  // score = similarity (higher = better)
    const tier = contact.tier || '?'
    console.log(`  ${rank}. [${tier}] ${displayName} (similarity: ${similarity})`)
    if (contact.headline) {
      console.log(`     ${contact.headline.substring(0, 70)}`)
    }
  }
}
```

### 3b. Semantic Mode (free-text query embedding search)

```javascript
// Requires OnnxEmbedder to embed the query text
async function analyzeSemantic(graph, opts) {
  const { isRvfAvailable, queryStore } = await import('./rvf-store.mjs')

  if (!isRvfAvailable()) {
    console.log('Semantic search requires ruvector. Install: npm i ruvector')
    return
  }

  const query = opts.query
  if (!query) {
    console.log('Usage: --mode semantic --query "search text"')
    return
  }

  // Embed query text
  const ruvector = await import('ruvector')
  const mod = ruvector.default || ruvector
  const embedder = new mod.OnnxEmbedder({ enableParallel: false })
  await embedder.init()
  const queryVector = await embedder.embed(query)

  // k-NN search
  const k = opts.top || 20
  const results = await queryStore(queryVector, k)

  if (!results || results.length === 0) {
    console.log('No results found. Is the store built? Run: node scripts/vectorize.mjs')
    await mod.shutdown()
    return
  }

  console.log(`\nSemantic search: "${query}"`)
  console.log('='.repeat(60))
  for (let i = 0; i < results.length; i++) {
    const result = results[i]
    const contact = result.metadata || graph.contacts[result.id] || {}
    const name = contact.name || result.id
    const relevance = result.score.toFixed(3)  // score = similarity
    const tier = contact.tier || '?'
    console.log(`  ${i + 1}. [${tier}] ${name} (relevance: ${relevance})`)
    if (contact.headline) {
      console.log(`     ${contact.headline.substring(0, 70)}`)
    }
  }

  await mod.shutdown()  // module-level shutdown
}
```

### Integration into analyzer.mjs main switch

```javascript
// In the existing mode switch:
case 'similar':
  await analyzeSimilar(graph, opts)
  break

case 'semantic':
  await analyzeSemantic(graph, opts)
  break
```

---

## 4. Scorer Modifications (All Three Scorers)

All three scorers follow the same pattern. Each calls `upsertMetadata()` from `rvf-store.mjs`
after computing scores, passing only the fields that scorer is responsible for.

### 4a. scorer.mjs (Layer 1: ICP + Gold Score)

```javascript
// At the end of the scoring loop, after graph.json is written:

async function updateRvfScores(contacts) {
  let { isRvfAvailable, upsertMetadata, closeStore } = await import('./rvf-store.mjs')

  if (!isRvfAvailable()) return

  let updated = 0
  for (const [url, contact] of Object.entries(contacts)) {
    // Only update the fields this scorer is responsible for
    const success = await upsertMetadata(url, {
      icpFit: contact.scores?.icpFit || 0,
      networkHub: contact.scores?.networkHub || 0,
      relationshipStrength: contact.scores?.relationshipStrength || 0,
      signalBoost: contact.scores?.signalBoost || 0,
      goldScore: contact.scores?.goldScore || 0,
      tier: contact.scores?.tier || 'watch',
      persona: contact.personaType || '',
    })
    if (success) updated++
  }

  await closeStore()
  if (updated > 0) console.log(`  RVF: updated ${updated} contact scores`)
}

// Call at the end of main():
// await updateRvfScores(graph.contacts)
```

### 4b. behavioral-scorer.mjs (Layer 2: Behavioral)

```javascript
async function updateRvfScores(contacts) {
  const { isRvfAvailable, upsertMetadata, closeStore } = await import('./rvf-store.mjs')

  if (!isRvfAvailable()) return

  let updated = 0
  for (const [url, contact] of Object.entries(contacts)) {
    const success = await upsertMetadata(url, {
      behavioralScore: contact.behavioralScore || 0,
      behavioralPersona: contact.behavioralPersona || '',
    })
    if (success) updated++
  }

  await closeStore()
  if (updated > 0) console.log(`  RVF: updated ${updated} behavioral scores`)
}
```

### 4c. referral-scorer.mjs (Layer 3: Referral)

```javascript
async function updateRvfScores(contacts) {
  const { isRvfAvailable, upsertMetadata, closeStore } = await import('./rvf-store.mjs')

  if (!isRvfAvailable()) return

  let updated = 0
  for (const [url, contact] of Object.entries(contacts)) {
    const success = await upsertMetadata(url, {
      referralLikelihood: contact.scores?.referralLikelihood || 0,
      referralTier: contact.referralTier || '',
      referralPersona: contact.referralPersona || '',
    })
    if (success) updated++
  }

  await closeStore()
  if (updated > 0) console.log(`  RVF: updated ${updated} referral scores`)
}
```

---

## 5. Pipeline Integration

```javascript
// In pipeline.mjs buildSteps(), add vectorize to rebuild and full modes:

case 'rebuild':
  return [
    { script: 'graph-builder.mjs', args: [...v] },
    { script: 'scorer.mjs', args: [...v] },
    { script: 'behavioral-scorer.mjs', args: [...v] },
    { script: 'referral-scorer.mjs', args: [...v] },
    { script: 'vectorize.mjs', args: ['--from-graph', ...v] },  // NEW
    { script: 'analyzer.mjs', args: ['--mode', 'summary', ...v] },
    { script: 'delta.mjs', args: ['--snapshot', ...v] },
  ]

case 'full':
  return [
    { script: 'search.mjs', args: [...searchArgs] },
    { script: 'enrich.mjs', args: [...v] },
    { script: 'graph-builder.mjs', args: [...v] },
    { script: 'scorer.mjs', args: [...v] },
    { script: 'behavioral-scorer.mjs', args: [...v] },
    { script: 'referral-scorer.mjs', args: [...v] },
    { script: 'vectorize.mjs', args: ['--from-graph', ...v] },  // NEW
    { script: 'analyzer.mjs', args: ['--mode', 'summary', ...v] },
    { script: 'delta.mjs', args: ['--snapshot', ...v] },
  ]

case 'vectorize':  // NEW standalone mode
  return [
    { script: 'vectorize.mjs', args: ['--from-graph', ...v] },
  ]

// Pipeline failure cascade:
// In the step execution loop, add vectorize tracking:

let vectorizeOk = true

// After executing vectorize.mjs:
if (step.script === 'vectorize.mjs') {
  if (exitCode !== 0) {
    vectorizeOk = false
    console.warn('  Vectorize failed -- continuing without vector store')
    // Do NOT skip analyzer or delta. They still work from graph.json.
  }
}
// vectorize failure does NOT gate any downstream step
```

---

## 6. db.mjs Search Enhancement

```javascript
// In the existing find() function, add vector search when RVF available:

async function findSemantic(searchTerm, contacts, limit) {
  const { isRvfAvailable, queryStore } = await import('./rvf-store.mjs')

  if (!isRvfAvailable()) return null  // fall through to substring search

  try {
    const ruvector = await import('ruvector')
    const mod = ruvector.default || ruvector
    const embedder = new mod.OnnxEmbedder({ enableParallel: false })
    await embedder.init()
    const queryVector = await embedder.embed(searchTerm)

    const results = await queryStore(queryVector, limit)
    await mod.shutdown()
    return results
  } catch {
    return null  // fall through to substring search
  }
}

// In the existing search command handler:
// const semanticResults = await findSemantic(term, contacts, limit)
// if (semanticResults) {
//   displaySemanticResults(semanticResults)
// } else {
//   // existing substring search
// }
```

---

## 7. lib.mjs Additions

```javascript
// Add to existing exports (minimal -- isRvfAvailable moved to rvf-store.mjs):

export const RVF_STORE_PATH = resolve(DATA_DIR, 'network.rvf')

// NOTE: isRvfAvailable() is now in rvf-store.mjs, NOT here.
// Import from rvf-store.mjs when needed.
```

---

## 8. package.json (New)

```json
{
  "name": "linkedin-prospector",
  "version": "1.0.0",
  "type": "module",
  "description": "Claude Code skill for LinkedIn network intelligence",
  "private": true,
  "dependencies": {
    "playwright": "^1.40.0"
  },
  "optionalDependencies": {
    "ruvector": "^0.2.12"
  },
  "engines": {
    "node": ">=18.0.0"
  }
}
```

**Note**: `ruvector` is an optional dependency. The skill works without it (JSON-only mode).
Users opt in to semantic search by running `npm install` in the skill directory. The package.json
is used for dependency declaration; playwright is assumed to be available in the Claude Code
environment but is listed for explicit documentation.

**Minimum required ruvector API surface** (document in rvf-store.mjs):
- `VectorDB` class: constructor, insertBatch, search, get, delete, len
- `OnnxEmbedder` class: constructor, init, embed, embedBatch, dimension, ready
- Module functions: getStats, shutdown

---

## 9. .gitignore Additions

```
# RVF stores (runtime, contains PII)
data/network.rvf
data/snapshots/*.rvf

# ONNX model cache
.cache/

# Node modules (if package.json is used)
node_modules/
package-lock.json
```

---

## Deferred from MVP

The following items are explicitly out of scope for the initial implementation:

1. **COW snapshots** (`rvfDerive`) -- delta.mjs continues using JSON snapshots
2. **--incremental mode** -- vectorize.mjs always does full re-vectorize
3. **report-generator.mjs** -- continues reading graph.json
4. **graph-builder.mjs** -- no modification needed (vectorize runs after scorers)
5. **db.mjs export --format rvf** -- JSON export only
6. **AdaptiveEmbedder / SONA integration** -- future enhancement
