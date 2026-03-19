/**
 * vectorize.mjs -- Embedding pipeline for contact profiles.
 *
 * Generates 384-dim semantic embeddings from contact profile text
 * and stores them with metadata in the RVF vector store.
 *
 * Usage:
 *   node vectorize.mjs --from-graph           Build from graph.json (incremental)
 *   node vectorize.mjs --from-graph --force   Rebuild all vectors from scratch
 *   node vectorize.mjs                        Build from contacts.json
 *   node vectorize.mjs --batch-size 100       Custom batch size
 *   node vectorize.mjs --verbose              Verbose logging
 *
 * Incremental mode (default with --from-graph):
 *   - Skips contacts already in the vector store with unchanged profile text
 *   - Only embeds new or modified contacts
 *   - Use --force to re-embed everything
 *
 * Requires ruvector (optional dependency).
 * OnnxEmbedder API: getStats() and shutdown() are module-level functions (D-6)
 * embed()/embedBatch() returns number[], NOT Float32Array (D-7)
 */

import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import os from 'os';
import { DATA_DIR, parseArgs } from './lib.mjs';
import { createHash } from 'crypto';
import {
  isRvfAvailable, openStore, closeStore, ingestContacts,
  buildProfileText, buildMetadata, chunkArray, RVF_PATH, DIMENSIONS,
  getContact, storeLength,
} from './rvf-store.mjs';

function textHash(text) {
  return createHash('md5').update(text).digest('hex').slice(0, 12);
}

async function main() {
  const args = parseArgs(process.argv);
  const VERBOSE = args.verbose || false;
  const log = (...a) => { if (VERBOSE) console.log('[vectorize]', ...a); };

  if (!isRvfAvailable()) {
    console.error('ruvector not available. Install: npm i ruvector');
    process.exit(1);
  }

  // Load ruvector module (CJS/ESM interop) -- D-5
  const ruvector = await import('ruvector');
  const mod = ruvector.default || ruvector;
  const { OnnxEmbedder, getStats, shutdown } = mod;

  // Initialize embedder -- D-6
  const maxWorkers = Math.min(os.cpus().length, 4);
  log(`Max parallel workers: ${maxWorkers}`);
  const embedder = new OnnxEmbedder({
    enableParallel: true,
    parallelThreshold: 4,
  });

  const initTimeout = setTimeout(() => {
    console.warn('Model download taking longer than expected...');
  }, 30000);
  const ready = await embedder.init();
  clearTimeout(initTimeout);

  if (!ready) {
    console.warn('ONNX embedder failed to initialize. Using hash fallback.');
  }

  const stats = getStats();  // module-level function, NOT embedder.getStats() -- D-6
  console.log(`Embedder ready: ${stats.dimension || DIMENSIONS}d, SIMD=${stats.simd || 'unknown'}`);

  // Load contacts from graph.json (has scores) or contacts.json (raw)
  let contacts;
  const graphPath = resolve(DATA_DIR, 'graph.json');
  const contactsPath = resolve(DATA_DIR, 'contacts.json');

  if (args['from-graph'] && existsSync(graphPath)) {
    const source = JSON.parse(readFileSync(graphPath, 'utf-8'));
    contacts = Object.entries(source.contacts);
    console.log(`Loading from graph.json: ${contacts.length} contacts`);
  } else if (existsSync(contactsPath)) {
    const source = JSON.parse(readFileSync(contactsPath, 'utf-8'));
    contacts = Object.entries(source);
    console.log(`Loading from contacts.json: ${contacts.length} contacts`);
  } else {
    console.error('No contacts to vectorize. Run a search first:');
    console.error('  /linkedin-prospector find me 20 [niche] contacts');
    process.exit(1);
  }

  if (contacts.length === 0) {
    console.error('No contacts found in data file.');
    process.exit(1);
  }

  // Open or create RVF store
  const store = await openStore();
  if (!store) {
    console.error('Failed to open RVF store.');
    process.exit(1);
  }

  // Build embedding entries with incremental check
  const batchSize = parseInt(args['batch-size'], 10) || 50;
  const forceRebuild = args.force || false;
  const entries = [];
  let skipped = 0;

  const currentStoreSize = await storeLength();
  console.log(`Current store size: ${currentStoreSize} vectors`);
  console.log(`Graph contacts: ${contacts.length}`);

  if (!forceRebuild && currentStoreSize > 0) {
    console.log(`Incremental mode: checking for new/changed contacts...`);
    for (const [url, contact] of contacts) {
      const id = url.replace(/\/$/, '').split('?')[0];
      const profileText = buildProfileText(contact);
      const hash = textHash(profileText);

      const existing = await getContact(id);
      if (existing && existing.metadata?.textHash === hash) {
        skipped++;
        continue;
      }

      entries.push({ id, text: profileText, contact, url, hash });
    }
    console.log(`  Skipped (unchanged): ${skipped}`);
    console.log(`  New/modified: ${entries.length}`);
  } else {
    if (forceRebuild) console.log(`Force rebuild: re-embedding all contacts`);
    for (const [url, contact] of contacts) {
      const id = url.replace(/\/$/, '').split('?')[0];
      const profileText = buildProfileText(contact);
      entries.push({ id, text: profileText, contact, url, hash: textHash(profileText) });
    }
    console.log(`Contacts to embed: ${entries.length}`);
  }

  if (entries.length === 0) {
    console.log(`\nAll contacts are up to date. Nothing to embed.`);
    await closeStore();
    await shutdown();
    return;
  }

  // Batch embed and ingest
  let embedded = 0;
  let errors = 0;

  for (const batch of chunkArray(entries, batchSize)) {
    const texts = batch.map(e => e.text);
    try {
      // embedBatch returns number[][] (NOT Float32Array[]) -- D-7
      const vectors = await embedder.embedBatch(texts);
      const rvfEntries = batch.map((entry, i) => ({
        id: entry.id,
        vector: vectors[i],  // number[] -- no Float32Array wrapping needed
        metadata: { ...buildMetadata(entry.contact, entry.url), textHash: entry.hash },
      }));
      await ingestContacts(rvfEntries);
      embedded += batch.length;
    } catch (batchErr) {
      console.warn(`  Batch embed failed, trying individually: ${batchErr.message}`);
      for (const entry of batch) {
        try {
          const vec = await embedder.embed(entry.text);
          await ingestContacts([{
            id: entry.id,
            vector: vec,
            metadata: { ...buildMetadata(entry.contact, entry.url), textHash: entry.hash },
          }]);
          embedded++;
        } catch {
          errors++;
        }
      }
    }

    // Progress
    if (embedded > 0 && embedded % 100 < batchSize) {
      console.log(`  Progress: ${embedded}/${entries.length}`);
    }
  }

  await closeStore();
  await shutdown();  // module-level function, NOT embedder.shutdown() -- D-6

  console.log(`\nVectorization complete:`);
  console.log(`  Embedded: ${embedded}`);
  console.log(`  Errors: ${errors}`);
  console.log(`  Store: ${RVF_PATH}`);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
