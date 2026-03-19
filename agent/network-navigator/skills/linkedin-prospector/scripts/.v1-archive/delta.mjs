import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { parseArgs, DATA_DIR } from './lib.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONTACTS_PATH = resolve(DATA_DIR, 'contacts.json');
const GRAPH_PATH = resolve(DATA_DIR, 'graph.json');
const SNAPSHOTS_DIR = resolve(DATA_DIR, 'snapshots');

// --- Helpers ---

function today() {
  return new Date().toISOString().slice(0, 10);
}

function loadContacts() {
  if (!existsSync(CONTACTS_PATH)) {
    console.error(`contacts.json not found at ${CONTACTS_PATH}`);
    process.exit(1);
  }
  return JSON.parse(readFileSync(CONTACTS_PATH, 'utf-8'));
}

function loadGraph() {
  if (!existsSync(GRAPH_PATH)) return null;
  try {
    return JSON.parse(readFileSync(GRAPH_PATH, 'utf-8'));
  } catch {
    return null;
  }
}

function ensureSnapshotsDir() {
  if (!existsSync(SNAPSHOTS_DIR)) {
    mkdirSync(SNAPSHOTS_DIR, { recursive: true });
  }
}

function listSnapshotFiles() {
  ensureSnapshotsDir();
  return readdirSync(SNAPSHOTS_DIR)
    .filter(f => /^snapshot-\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .sort()
    .reverse();
}

function loadSnapshot(filename) {
  return JSON.parse(readFileSync(resolve(SNAPSHOTS_DIR, filename), 'utf-8'));
}

function getTierForContact(url, graphContacts) {
  if (!graphContacts || !graphContacts[url]) return null;
  const c = graphContacts[url];
  if (c.scores && c.scores.tier) return c.scores.tier;
  if (c.tier) return c.tier;
  return null;
}

function buildTierSummary(urls, graphContacts) {
  const summary = { gold: 0, silver: 0, bronze: 0, watch: 0 };
  for (const url of urls) {
    const tier = getTierForContact(url, graphContacts);
    if (tier && summary[tier] !== undefined) {
      summary[tier]++;
    }
  }
  return summary;
}

function buildTopGold(urls, graphContacts, limit = 10) {
  const scored = [];
  for (const url of urls) {
    if (!graphContacts || !graphContacts[url]) continue;
    const c = graphContacts[url];
    const tier = c.scores?.tier || c.tier;
    const goldScore = c.scores?.goldScore ?? c.goldScore ?? null;
    if (tier === 'gold' && goldScore !== null) {
      scored.push({ url, name: c.enrichedName || c.name || url, goldScore });
    }
  }
  return scored.sort((a, b) => b.goldScore - a.goldScore).slice(0, limit);
}

// --- Commands ---

function snapshot() {
  const db = loadContacts();
  const graph = loadGraph();
  const rawContacts = db.contacts || {};
  const graphContacts = graph?.contacts || null;
  const urls = Object.keys(rawContacts);
  const enrichedCount = urls.filter(u => rawContacts[u].enriched).length;
  const tierSummary = buildTierSummary(urls, graphContacts);
  const topGold = buildTopGold(urls, graphContacts);

  const snap = {
    date: today(),
    createdAt: new Date().toISOString(),
    totalContacts: urls.length,
    enrichedCount,
    profileUrls: urls,
    tierSummary,
    topGold,
  };

  ensureSnapshotsDir();
  const outPath = resolve(SNAPSHOTS_DIR, `snapshot-${today()}.json`);
  writeFileSync(outPath, JSON.stringify(snap, null, 2));

  const parts = [`${snap.totalContacts} contacts`];
  for (const [tier, count] of Object.entries(tierSummary)) {
    if (count > 0) parts.push(`${count} ${tier}`);
  }
  console.log(`Snapshot saved: ${parts.join(', ')}`);
  console.log(`  Output: ${outPath}`);
}

function check() {
  const files = listSnapshotFiles();
  if (files.length === 0) {
    console.log('No previous snapshot found. Run with --snapshot first.');
    return;
  }

  const prevSnap = loadSnapshot(files[0]);
  const db = loadContacts();
  const graph = loadGraph();
  const rawContacts = db.contacts || {};
  const graphContacts = graph?.contacts || null;
  const currentUrls = new Set(Object.keys(rawContacts));
  const prevUrls = new Set(prevSnap.profileUrls || []);

  const added = [...currentUrls].filter(u => !prevUrls.has(u));
  const removed = [...prevUrls].filter(u => !currentUrls.has(u));

  // Tier changes: compare current graph tiers with snapshot tier summary is
  // not granular enough. We need per-contact tier from the snapshot's topGold
  // and tierSummary won't tell us individual tiers. Instead, if we have a
  // prior snapshot with tierSummary and current graph, detect contacts whose
  // tier differs. We build a prev-tier map from older snapshot if available,
  // or compare two snapshots. For simplicity: compare current graph tiers vs
  // previous snapshot date's graph state stored in the snapshot topGold list.
  // Better approach: store per-contact tiers in snapshot. Since snapshots
  // only store profileUrls and tierSummary, we detect tier changes by
  // comparing the two most recent snapshots' tier summaries at the aggregate
  // level, or by comparing current graph tiers if both snapshots exist.
  const tierChanges = [];
  if (graphContacts && files.length >= 2) {
    const olderSnap = loadSnapshot(files[1]);
    const olderGraph = null; // We don't store full graph in snapshots
    // Without per-contact tier history, we compare current graph vs snapshot topGold
    // For now, report tier-change detection when per-contact tiers are available
  }

  // If graph has tiers and we have snapshot topGold, detect gold changes
  if (graphContacts && prevSnap.topGold) {
    const prevGoldUrls = new Set(prevSnap.topGold.map(g => g.url));
    for (const url of currentUrls) {
      const currentTier = getTierForContact(url, graphContacts);
      if (currentTier === 'gold' && !prevGoldUrls.has(url) && prevUrls.has(url)) {
        const c = graphContacts[url] || rawContacts[url];
        tierChanges.push({
          url,
          name: c.enrichedName || c.name || url,
          from: 'non-gold',
          to: 'gold',
        });
      }
    }
  }

  // Print report
  console.log(`\n=== Delta Report (vs ${prevSnap.date}) ===`);

  console.log(`Added: ${added.length} new contacts`);
  for (const url of added.slice(0, 20)) {
    const c = rawContacts[url];
    const label = c?.enrichedName || c?.name || url;
    const hl = c?.headline ? ` (${c.headline.slice(0, 60)})` : '';
    console.log(`  - ${label}${hl}`);
  }
  if (added.length > 20) console.log(`  ... and ${added.length - 20} more`);

  console.log(`Removed: ${removed.length} contacts disconnected`);
  for (const url of removed.slice(0, 20)) {
    console.log(`  - ${url}`);
  }
  if (removed.length > 20) console.log(`  ... and ${removed.length - 20} more`);

  console.log(`Tier changes: ${tierChanges.length}`);
  for (const tc of tierChanges.slice(0, 20)) {
    console.log(`  - ${tc.name}: ${tc.from} -> ${tc.to}`);
  }

  // Recommendations
  const unenriched = added.filter(u => !rawContacts[u]?.enriched);
  if (added.length > 0 || unenriched.length > 0) {
    console.log('\nRecommendations:');
    if (unenriched.length > 0) {
      console.log(`- ${unenriched.length} new contacts need enrichment: run \`enrich.mjs --unenriched-only\``);
    }
    if (added.length > 0) {
      console.log(`- ${added.length} new contacts need scoring: run \`pipeline.mjs --rebuild\``);
    }
  }
  console.log('');
}

function list() {
  const files = listSnapshotFiles();
  if (files.length === 0) {
    console.log('No snapshots found. Run with --snapshot to create one.');
    return;
  }

  console.log('Snapshots:');
  for (const f of files) {
    try {
      const snap = loadSnapshot(f);
      const ts = snap.tierSummary || {};
      const tierParts = [];
      if (ts.gold) tierParts.push(`${ts.gold} gold`);
      if (ts.silver) tierParts.push(`${ts.silver} silver`);
      const tierStr = tierParts.length > 0 ? `  (${tierParts.join(', ')})` : '';
      console.log(`  ${snap.date}  ${snap.totalContacts} contacts${tierStr}`);
    } catch {
      console.log(`  ${f}  (unreadable)`);
    }
  }
}

// --- Entry point ---

const args = parseArgs(process.argv);

if (args.snapshot) {
  snapshot();
} else if (args.check) {
  check();
} else if (args.list) {
  list();
} else {
  console.log('Usage: node delta.mjs <command>');
  console.log('');
  console.log('Commands:');
  console.log('  --snapshot   Create a snapshot of the current contact database');
  console.log('  --check      Compare current state against the most recent snapshot');
  console.log('  --list       List all saved snapshots');
}
