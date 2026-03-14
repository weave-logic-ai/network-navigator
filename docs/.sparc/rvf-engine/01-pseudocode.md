# RVF Engine Integration -- Pseudocode

## 1. rvf-store.mjs (New -- Shared RVF Store Helpers)

```
import { DATA_DIR } from './lib.mjs'

const RVF_PATH = resolve(DATA_DIR, 'network.rvf')
const DIMENSIONS = 384
let _store = null

function isRvfAvailable():
  try:
    require.resolve('ruvector')
    return true
  catch:
    return false

async function openStore():
  if _store: return _store
  if not isRvfAvailable(): return null

  const { createRvfStore, openRvfStore } = await import('ruvector')

  if existsSync(RVF_PATH):
    _store = await openRvfStore(RVF_PATH)
  else:
    _store = await createRvfStore(RVF_PATH, {
      dimensions: DIMENSIONS,
      metric: 'cosine',
      compression: 'scalar',
      m: 16,
      efConstruction: 200,
    })
  return _store

async function closeStore():
  if _store:
    await rvfClose(_store)
    _store = null

async function queryStore(vector, k=20, filter=null):
  store = await openStore()
  if not store: return null
  return rvfQuery(store, vector, k, { filter })

async function ingestContacts(entries):
  store = await openStore()
  if not store: return null
  return rvfIngest(store, entries)

async function deriveSnapshot(snapshotPath):
  store = await openStore()
  if not store: return null
  return rvfDerive(store, snapshotPath)

export { isRvfAvailable, openStore, closeStore, queryStore, ingestContacts, deriveSnapshot, RVF_PATH, DIMENSIONS }
```

## 2. vectorize.mjs (New -- Embedding Generation + RVF Build)

```
import { OnnxEmbedder } from 'ruvector'
import { openStore, ingestContacts, closeStore, DIMENSIONS } from './rvf-store.mjs'
import { load as loadDb } from './db.mjs'
import { DATA_DIR, parseArgs } from './lib.mjs'

function buildProfileText(contact):
  parts = []
  if contact.headline: parts.push(contact.headline)
  if contact.currentRole and contact.currentCompany:
    parts.push(`${contact.currentRole} at ${contact.currentCompany}`)
  elif contact.title:
    parts.push(contact.title)
  if contact.about:
    parts.push(contact.about.substring(0, 300))
  if contact.location:
    parts.push(contact.location)
  return parts.join(' | ') or contact.name or 'Unknown'

async function main():
  args = parseArgs(process.argv)  // --from-graph, --incremental, --batch-size N

  // Initialize embedder
  embedder = new OnnxEmbedder({
    enableParallel: true,
    parallelThreshold: 4,
  })
  await embedder.init()
  console.log(`Embedder ready: ${embedder.dimension}d, SIMD=${getStats().simd}`)

  // Load contacts from graph.json (has scores) or contacts.json (raw)
  if args.fromGraph and existsSync(resolve(DATA_DIR, 'graph.json')):
    source = JSON.parse(readFileSync(resolve(DATA_DIR, 'graph.json')))
    contacts = Object.entries(source.contacts)
    console.log(`Loading from graph.json: ${contacts.length} contacts`)
  else:
    db = loadDb()
    contacts = Object.entries(db.contacts)
    console.log(`Loading from contacts.json: ${contacts.length} contacts`)

  // Open or create RVF store
  store = await openStore()
  if not store:
    console.error('ruvector not available. Install: npm i ruvector')
    process.exit(1)

  // Check existing entries for incremental mode
  existingIds = new Set()
  if args.incremental:
    status = await rvfStatus(store)
    // TODO: query all IDs to build existingIds set
    console.log(`Incremental mode: ${status.totalVectors} existing vectors`)

  // Build embedding batches
  batchSize = args.batchSize || 50
  entries = []
  skipped = 0

  for [url, contact] of contacts:
    id = url.replace(/\/$/, '')
    if args.incremental and existingIds.has(id):
      skipped++
      continue

    profileText = buildProfileText(contact)
    entries.push({ id, text: profileText, contact })

  console.log(`Contacts to embed: ${entries.length} (skipped: ${skipped})`)

  // Batch embed
  embedded = 0
  errors = 0
  for batch of chunkArray(entries, batchSize):
    texts = batch.map(e => e.text)
    try:
      vectors = await embedder.embedBatch(texts)
      rvfEntries = batch.map((entry, i) => ({
        id: entry.id,
        vector: new Float32Array(vectors[i]),
        metadata: buildMetadata(entry.contact),
      }))
      result = await ingestContacts(rvfEntries)
      embedded += result.accepted
      if result.rejected > 0:
        console.log(`  Batch: ${result.accepted} accepted, ${result.rejected} rejected`)
    catch err:
      console.error(`  Batch error: ${err.message}`)
      errors += batch.length

    // Progress
    if embedded % 100 == 0 and embedded > 0:
      console.log(`  Progress: ${embedded}/${entries.length}`)

  await closeStore()
  await embedder.shutdown()  // Clean up parallel workers

  console.log(`\nVectorization complete:`)
  console.log(`  Embedded: ${embedded}`)
  console.log(`  Errors: ${errors}`)
  console.log(`  Store: ${RVF_PATH}`)

function buildMetadata(contact):
  return {
    name: contact.enrichedName || contact.name || '',
    headline: contact.headline || contact.title || '',
    location: contact.enrichedLocation || contact.location || '',
    currentRole: contact.currentRole || '',
    currentCompany: contact.currentCompany || '',
    about: (contact.about || '').substring(0, 300),
    connections: contact.connections || '',
    enriched: contact.enriched || false,
    degree: contact.degree || 1,
    searchTerms: contact.searchTerms || [],
    // Scores (from graph.json if available)
    icpFit: contact.scores?.icpFit || 0,
    networkHub: contact.scores?.networkHub || 0,
    relationshipStrength: contact.scores?.relationshipStrength || 0,
    signalBoost: contact.scores?.signalBoost || 0,
    goldScore: contact.scores?.goldScore || 0,
    tier: contact.scores?.tier || 'watch',
    persona: contact.scores?.persona || '',
    behavioralScore: contact.behavioralScore || 0,
    behavioralPersona: contact.behavioralPersona || '',
    referralLikelihood: contact.scores?.referralLikelihood || 0,
    referralTier: contact.referralTier || '',
    referralPersona: contact.referralPersona || '',
    cluster: contact.cluster ?? -1,
    clusterLabel: contact.clusterLabel || '',
    embeddedAt: new Date().toISOString(),
  }
```

## 3. analyzer.mjs Additions (Semantic Search Modes)

```
// New mode: similar -- find contacts similar to a given contact
async function analyzeSimilar(graph, opts):
  if not isRvfAvailable():
    console.log('Semantic search requires ruvector. Install: npm i ruvector')
    return

  const { OnnxEmbedder } = await import('ruvector')
  const { queryStore } = await import('./rvf-store.mjs')

  targetUrl = opts.url
  targetContact = graph.contacts[targetUrl]
  if not targetContact:
    console.log(`Contact not found: ${targetUrl}`)
    return

  // Get target's embedding by re-embedding their profile text
  embedder = new OnnxEmbedder()
  await embedder.init()
  profileText = buildProfileText(targetContact)
  targetVector = await embedder.embed(profileText)

  // k-NN search
  results = await queryStore(targetVector, opts.top || 20)
  if not results:
    console.log('RVF store not available. Run: node scripts/vectorize.mjs')
    return

  // Display results
  console.log(`\nContacts similar to: ${targetContact.enrichedName || targetContact.name}`)
  console.log(`${'='.repeat(60)}`)
  for (i, result) of results.entries():
    if result.id === targetUrl: continue  // skip self
    contact = graph.contacts[result.id] || {}
    name = contact.enrichedName || contact.name || result.id
    score = (1 - result.distance).toFixed(3)  // cosine: 1-distance = similarity
    tier = contact.scores?.tier || '?'
    console.log(`  ${i+1}. [${tier}] ${name} (similarity: ${score})`)
    if contact.headline:
      console.log(`     ${contact.headline.substring(0, 70)}`)

  await embedder.shutdown()


// New mode: semantic -- free-text query search
async function analyzeSemantic(graph, opts):
  if not isRvfAvailable():
    console.log('Semantic search requires ruvector. Install: npm i ruvector')
    return

  const { OnnxEmbedder } = await import('ruvector')
  const { queryStore } = await import('./rvf-store.mjs')

  query = opts.query
  if not query:
    console.log('Usage: --mode semantic --query "search text"')
    return

  embedder = new OnnxEmbedder()
  await embedder.init()
  queryVector = await embedder.embed(query)

  results = await queryStore(queryVector, opts.top || 20)

  console.log(`\nSemantic search: "${query}"`)
  console.log(`${'='.repeat(60)}`)
  for (i, result) of results.entries():
    contact = graph.contacts[result.id] || {}
    name = contact.enrichedName || contact.name || result.id
    score = (1 - result.distance).toFixed(3)
    tier = contact.scores?.tier || '?'
    console.log(`  ${i+1}. [${tier}] ${name} (relevance: ${score})`)
    if contact.headline:
      console.log(`     ${contact.headline.substring(0, 70)}`)

  await embedder.shutdown()
```

## 4. Scorer Modifications (Write to RVF)

```
// In scorer.mjs, after computing scores for each contact:
async function updateRvfScores(scoredContacts):
  if not isRvfAvailable(): return

  const { openStore, ingestContacts, closeStore } = await import('./rvf-store.mjs')
  store = await openStore()
  if not store: return

  // For each scored contact, update metadata
  // RVF ingest with same ID = update (upsert)
  entries = []
  for [url, contact] of Object.entries(scoredContacts):
    // Re-use existing vector (don't re-embed)
    existingEntry = await store.get(url)  // if API supports get-by-id
    if existingEntry:
      entries.push({
        id: url,
        vector: existingEntry.vector,  // keep existing embedding
        metadata: buildMetadata(contact),  // update scores
      })

  if entries.length > 0:
    result = await ingestContacts(entries)
    console.log(`  RVF: updated ${result.accepted} contact scores`)

  await closeStore()
```

## 5. Pipeline Integration

```
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

case 'vectorize':  // NEW mode
  return [
    { script: 'vectorize.mjs', args: ['--from-graph', ...v] },
  ]
```

## 6. Delta Snapshots via COW

```
// In delta.mjs, replace JSON snapshot with RVF derivation:
async function createSnapshot():
  if isRvfAvailable():
    snapshotPath = resolve(DATA_DIR, 'snapshots', `network-${timestamp}.rvf`)
    await deriveSnapshot(snapshotPath)
    console.log(`RVF snapshot: ${snapshotPath}`)
  else:
    // Fall back to current JSON snapshot behavior
    ...
```

## 7. lib.mjs Additions

```
// Add to existing lib.mjs exports:

export const RVF_STORE_PATH = resolve(DATA_DIR, 'network.rvf')

export function isRvfAvailable() {
  try {
    // Dynamic check - don't fail if not installed
    require.resolve('ruvector')
    return true
  } catch {
    return false
  }
}
```

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

Note: `ruvector` is an optional dependency. The skill works without it (JSON-only mode). Users opt in to semantic search by running `npm install`.
