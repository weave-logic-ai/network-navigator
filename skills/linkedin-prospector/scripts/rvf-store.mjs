/**
 * rvf-store.mjs -- Shared RVF (RuVector Format) store wrapper.
 *
 * All ruvector interaction goes through this module. Provides:
 *   - isRvfAvailable()  -- sync check if ruvector is installed
 *   - openStore()       -- open/create VectorDB instance
 *   - closeStore()      -- reset module-level reference
 *   - queryStore()      -- k-NN search
 *   - ingestContacts()  -- batch upsert vectors + metadata
 *   - getContact()      -- get single entry by ID
 *   - deleteContact()   -- remove entry by ID
 *   - storeLength()     -- entry count
 *   - upsertMetadata()  -- merge metadata for scorers (preserves vector)
 *   - buildProfileText() -- consistent profile text for embedding
 *   - buildMetadata()   -- full metadata builder
 *   - chunkArray()      -- batch utility
 *
 * API: VectorDBWrapper exclusively (Decision D-1)
 * Import: createRequire for sync check (D-2), cached dynamic import (D-5)
 * Single definition of isRvfAvailable (D-3)
 *
 * Minimum required ruvector API surface:
 *   VectorDB class: constructor, insertBatch, search, get, delete, len
 *   OnnxEmbedder class: constructor, init, embed, embedBatch, dimension, ready
 *   Module functions: getStats, shutdown
 */

import { createRequire } from 'module';
import { resolve } from 'path';
import { DATA_DIR } from './lib.mjs';

const require = createRequire(import.meta.url);

// Constants
export const RVF_PATH = resolve(DATA_DIR, 'network.rvf');
export const DIMENSIONS = 384;

// Module-level state
let _db = null;       // VectorDBWrapper instance
let _mod = null;      // cached ruvector module

// ──────────────────────────────────────────────
// Availability Check (sync, ESM-safe) -- D-2, D-3
// ──────────────────────────────────────────────

export function isRvfAvailable() {
  try {
    require.resolve('ruvector');
    return true;
  } catch {
    return false;
  }
}

// ──────────────────────────────────────────────
// Module Loader (handles CJS/ESM interop once) -- D-5
// ──────────────────────────────────────────────

async function loadRuvector() {
  if (_mod) return _mod;
  const m = await import('ruvector');
  _mod = m.default || m;
  return _mod;
}

// ──────────────────────────────────────────────
// Store Lifecycle -- D-1
// ──────────────────────────────────────────────

export async function openStore() {
  if (_db) return _db;
  if (!isRvfAvailable()) return null;

  try {
    const { VectorDB } = await loadRuvector();

    _db = new VectorDB({
      dimensions: DIMENSIONS,
      storagePath: RVF_PATH,
      distanceMetric: 'Cosine',
      hnswConfig: { m: 16, efConstruction: 200 },
    });

    return _db;
  } catch (err) {
    if (err.message && (err.message.includes('lock') || err.code === 'EBUSY')) {
      console.error(`RVF store is locked. Another process may be using it.`);
      console.error(`If no other process is running, delete ${RVF_PATH}.lock and retry.`);
    } else {
      console.error(`Failed to open RVF store: ${err.message}`);
      console.error(`The store may be corrupt. Rebuild with:`);
      console.error(`  node scripts/vectorize.mjs --from-graph`);
    }
    return null;
  }
}

export async function closeStore() {
  // VectorDBWrapper manages lifecycle internally.
  // Reset module-level reference so next openStore() creates fresh instance.
  _db = null;
}

// ──────────────────────────────────────────────
// Data Operations
// ──────────────────────────────────────────────

export async function queryStore(vector, k = 20, filter = null) {
  const db = await openStore();
  if (!db) return null;
  // VectorDBWrapper.search expects { vector, k, filter? }
  // Returns [{ id, score, metadata }]
  const opts = { vector, k };
  if (filter) opts.filter = filter;
  return db.search(opts);
}

export async function ingestContacts(entries) {
  // entries: [{ id, vector: number[], metadata }]
  const db = await openStore();
  if (!db) return null;
  await db.insertBatch(entries);
  return { accepted: entries.length };
}

export async function getContact(id) {
  // Returns { id, vector: number[], metadata } or null
  const db = await openStore();
  if (!db) return null;
  return db.get(id);
}

export async function deleteContact(id) {
  const db = await openStore();
  if (!db) return false;
  return db.delete(id);
}

export async function storeLength() {
  const db = await openStore();
  if (!db) return 0;
  return db.len();
}

// ──────────────────────────────────────────────
// Metadata Upsert (for scorers) -- D-4
//
// Gets existing entry (preserving vector), re-inserts
// with merged metadata. If entry doesn't exist, skips.
// ──────────────────────────────────────────────

export async function upsertMetadata(id, metadataPartial) {
  const db = await openStore();
  if (!db) return false;

  const existing = await db.get(id);
  if (!existing) return false;

  const merged = { ...existing.metadata, ...metadataPartial, updatedAt: new Date().toISOString() };
  await db.insertBatch([{ id, vector: existing.vector, metadata: merged }]);
  return true;
}

// ──────────────────────────────────────────────
// Shared Profile Text Builder -- D-4
//
// MUST be identical at vectorize-time and query-time
// to ensure embedding consistency.
// ──────────────────────────────────────────────

export function buildProfileText(contact) {
  const parts = [];
  if (contact.headline) parts.push(contact.headline);
  if (contact.currentRole && contact.currentCompany) {
    parts.push(`${contact.currentRole} at ${contact.currentCompany}`);
  } else if (contact.title) {
    parts.push(contact.title);
  }
  if (contact.about) {
    parts.push(contact.about.substring(0, 300));
  }
  if (contact.location) {
    parts.push(contact.location);
  }
  return parts.join(' | ') || contact.name || 'Unknown';
}

// ──────────────────────────────────────────────
// Metadata Builder -- D-4
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
  };
}

// ──────────────────────────────────────────────
// Utility
// ──────────────────────────────────────────────

export function chunkArray(arr, size) {
  const chunks = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}
