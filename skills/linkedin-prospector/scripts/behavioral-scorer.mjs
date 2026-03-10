import { readFileSync, writeFileSync, existsSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { DATA_DIR, CONFIG_DIR } from './lib.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const GRAPH_PATH = resolve(DATA_DIR, 'graph.json');
const CONFIG_PATH = resolve(CONFIG_DIR, 'behavioral-config.json');
const ICP_PATH = resolve(CONFIG_DIR, 'icp-config.json');
const VERBOSE = process.argv.includes('--verbose');
const log = (...a) => { if (VERBOSE) console.log('[behavioral]', ...a); };
const round = n => Math.round(n * 1000) / 1000;
const cap = (v, max = 1.0) => Math.min(Math.max(v, 0), max);

// ---------------------------------------------------------------------------
// Load
// ---------------------------------------------------------------------------

function loadFiles() {
  if (!existsSync(GRAPH_PATH)) {
    console.error('graph.json not found — run scorer.mjs first.');
    process.exit(1);
  }
  if (!existsSync(CONFIG_PATH)) {
    console.error('behavioral-config.json not found.');
    process.exit(1);
  }
  if (!existsSync(ICP_PATH)) {
    console.error('icp-config.json not found.');
    process.exit(1);
  }
  return {
    graph: JSON.parse(readFileSync(GRAPH_PATH, 'utf-8')),
    config: JSON.parse(readFileSync(CONFIG_PATH, 'utf-8')),
    icp: JSON.parse(readFileSync(ICP_PATH, 'utf-8')),
  };
}

// ---------------------------------------------------------------------------
// Parsers
// ---------------------------------------------------------------------------

/**
 * Parse "500+ connections" -> 500, "277 connections" -> 277,
 * "17,936 followers" -> 17936 (creator mode), missing -> 0
 */
function parseConnectionCount(raw) {
  if (!raw || typeof raw !== 'string') return 0;
  const cleaned = raw.replace(/,/g, '').toLowerCase();
  const m = cleaned.match(/(\d+)\+?\s*(connections?|followers?)/);
  if (!m) return 0;
  return parseInt(m[1], 10);
}

function isFollowerMode(raw) {
  return typeof raw === 'string' && /followers?/i.test(raw);
}

/**
 * Parse "Connected on March 5, 2026" -> Date, or null
 */
function parseConnectedTime(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const m = raw.match(/Connected on (.+)/i);
  if (!m) return null;
  const d = new Date(m[1]);
  return isNaN(d.getTime()) ? null : d;
}

function daysSince(date) {
  if (!date) return Infinity;
  return (Date.now() - date.getTime()) / 86400000;
}

// ---------------------------------------------------------------------------
// Component Scores
// ---------------------------------------------------------------------------

function scoreConnectionPower(contact, config) {
  const count = parseConnectionCount(contact.connections);
  const isFollower = isFollowerMode(contact.connections);
  const t = config.connectionPower.thresholds;

  let score;
  if (count >= 500) score = t['500+'];
  else if (count >= 300) score = t['300'];
  else if (count >= 100) score = t['100'];
  else score = t['0'];

  if (isFollower) score *= config.connectionPower.followerMultiplier;
  return { score: cap(score), count, isFollower };
}

function scoreConnectionRecency(contact, config) {
  const date = parseConnectedTime(contact.connectedTime);
  const days = daysSince(date);
  const ranges = config.connectionRecency.ranges;

  if (days <= 30) return { score: ranges['30'], days: Math.round(days), date };
  if (days <= 90) return { score: ranges['90'], days: Math.round(days), date };
  if (days <= 180) return { score: ranges['180'], days: Math.round(days), date };
  if (days <= 365) return { score: ranges['365'], days: Math.round(days), date };
  return { score: ranges['older'], days: Math.round(days), date };
}

function scoreAboutSignals(contact, config) {
  const about = (contact.about || '').toLowerCase();
  if (!about || about.length < 10) return { score: 0, matchedCategories: [] };

  const matched = [];
  for (const [category, keywords] of Object.entries(config.aboutSignals.keywords)) {
    if (keywords.some(kw => about.includes(kw))) {
      matched.push(category);
    }
  }

  const total = Object.keys(config.aboutSignals.keywords).length;
  return {
    score: cap(matched.length / Math.max(total * 0.4, 1)),
    matchedCategories: matched,
  };
}

function scoreHeadlineSignals(contact, config) {
  const headline = (contact.headline || '').toLowerCase();
  if (!headline) return { score: 0, matchedPatterns: [] };

  const patterns = config.headlineSignals.patterns;
  const matched = [];
  let maxScore = 0;

  // Multi-role (pipe separator)
  if (/\|/.test(contact.headline || '')) {
    matched.push('multi-role');
    maxScore = Math.max(maxScore, patterns['multi-role'].score);
  }
  // Helping language
  if (patterns['helping-language'].keywords.some(kw => headline.includes(kw))) {
    matched.push('helping-language');
    maxScore = Math.max(maxScore, patterns['helping-language'].score);
  }
  // Credentials
  if (patterns['credentials'].keywords.some(kw => headline.includes(kw.toLowerCase()))) {
    matched.push('credentials');
    maxScore = Math.max(maxScore, patterns['credentials'].score);
  }
  // Creator mode
  if (patterns['creator-mode'].keywords.some(kw => headline.includes(kw))) {
    matched.push('creator-mode');
    maxScore = Math.max(maxScore, patterns['creator-mode'].score);
  }

  // Use average of matched scores rather than just max for multi-match bonus
  const avgScore = matched.length > 0
    ? matched.reduce((s, p) => s + (patterns[p]?.score || 0), 0) / matched.length
    : 0;
  const blended = matched.length > 1 ? (maxScore * 0.6 + avgScore * 0.4) : maxScore;

  return { score: cap(blended), matchedPatterns: matched };
}

function scoreSuperConnectorIndex(contact, aboutResult, headlineResult, connectionPowerResult, config) {
  const traits = new Set();

  // From about signals
  for (const cat of aboutResult.matchedCategories) {
    if (config.superConnectorIndex.traitSources.includes(cat)) traits.add(cat);
  }
  // From headline
  for (const p of headlineResult.matchedPatterns) {
    if (config.superConnectorIndex.traitSources.includes(p)) traits.add(p);
  }
  // Connection power (500+ = trait)
  if (connectionPowerResult.count >= 500) traits.add('500+');

  const minTraits = config.superConnectorIndex.minTraits;
  const score = cap(traits.size / (minTraits + 2)); // 5 traits = 1.0 with minTraits=3
  return { score, traits: [...traits], traitCount: traits.size };
}

function scoreNetworkAmplifier(contact, connectionPowerResult, baselines) {
  const mutuals = contact.mutualConnections || 0;
  const normalizedMutuals = cap(mutuals / baselines.p90Mutuals);
  return { score: cap(normalizedMutuals * connectionPowerResult.score) };
}

// ---------------------------------------------------------------------------
// Behavioral Persona
// ---------------------------------------------------------------------------

function assignBehavioralPersona(contact, behavioralScore, components, config) {
  const { connectionPower, aboutSignals, connectionRecency } = components;
  const personas = config.behavioralPersonas;

  // Super-connector: 3+ traits AND 500+ connections
  if (components.superConnector.traitCount >= personas['super-connector'].minTraits &&
      connectionPower.count >= personas['super-connector'].minConnections) {
    return 'super-connector';
  }

  // Content-creator: speaker/author in about or headline
  const allText = ((contact.about || '') + ' ' + (contact.headline || '')).toLowerCase();
  if (personas['content-creator'].keywords.some(kw => allText.includes(kw))) {
    return 'content-creator';
  }

  // Silent-influencer: 500+ but low about signals
  if (connectionPower.count >= personas['silent-influencer'].minConnections &&
      aboutSignals.matchedCategories.length <= personas['silent-influencer'].maxAboutSignals) {
    return 'silent-influencer';
  }

  // Rising-connector: <500 AND connected recently
  if (connectionPower.count < (personas['rising-connector'].maxConnections || 500) &&
      connectionRecency.days <= (personas['rising-connector'].recencyDays || 180) &&
      connectionRecency.days < Infinity) {
    return 'rising-connector';
  }

  return 'passive-network';
}

// ---------------------------------------------------------------------------
// Baselines
// ---------------------------------------------------------------------------

function computeBaselines(graph) {
  const urls = Object.keys(graph.contacts);
  const allMutuals = urls.map(u => graph.contacts[u].mutualConnections || 0)
    .filter(m => m > 0).sort((a, b) => a - b);
  const p90 = allMutuals.length > 0
    ? allMutuals[Math.max(0, Math.ceil(0.9 * allMutuals.length) - 1)]
    : 1;
  return { p90Mutuals: Math.max(p90, 1) };
}

// ---------------------------------------------------------------------------
// RVF Update
// ---------------------------------------------------------------------------

async function updateRvfScores(contacts) {
  try {
    const { isRvfAvailable, upsertMetadata, closeStore } = await import('./rvf-store.mjs');
    if (!isRvfAvailable()) return;

    let updated = 0;
    for (const [url, contact] of Object.entries(contacts)) {
      const success = await upsertMetadata(url, {
        behavioralScore: contact.behavioralScore || 0,
        behavioralPersona: contact.behavioralPersona || '',
      });
      if (success) updated++;
    }

    await closeStore();
    if (updated > 0) console.log(`  RVF: updated ${updated} behavioral scores`);
  } catch (err) {
    console.warn(`  RVF behavioral update failed: ${err.message}`);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function score() {
  const { graph, config, icp } = loadFiles();
  const urls = Object.keys(graph.contacts);
  if (!urls.length) { console.error('No contacts in graph.json.'); process.exit(1); }

  // Verify Phase 1 scoring exists
  const firstContact = graph.contacts[urls[0]];
  if (!firstContact.scores) {
    console.error('Contacts not scored yet — run scorer.mjs first.');
    process.exit(1);
  }

  log(`Behavioral scoring ${urls.length} contacts...`);
  const baselines = computeBaselines(graph);
  log(`Baselines: P90 mutuals=${baselines.p90Mutuals}`);

  const personaCounts = {};
  const topBehavioral = [];
  let totalBehavioral = 0;

  for (const url of urls) {
    const c = graph.contacts[url];

    // Compute behavioral components
    const connPower = scoreConnectionPower(c, config);
    const connRecency = scoreConnectionRecency(c, config);
    const aboutSig = scoreAboutSignals(c, config);
    const headlineSig = scoreHeadlineSignals(c, config);
    const superConn = scoreSuperConnectorIndex(c, aboutSig, headlineSig, connPower, config);
    const amplifier = scoreNetworkAmplifier(c, connPower, baselines);

    // Composite behavioral score
    const behavioralScore = round(
      connPower.score * config.connectionPower.weight +
      connRecency.score * config.connectionRecency.weight +
      aboutSig.score * config.aboutSignals.weight +
      headlineSig.score * config.headlineSignals.weight +
      superConn.score * config.superConnectorIndex.weight +
      amplifier.score * config.networkAmplifier.weight
    );

    // Behavioral persona
    const components = {
      connectionPower: connPower,
      connectionRecency: connRecency,
      aboutSignals: aboutSig,
      headlineSignals: headlineSig,
      superConnector: superConn,
      amplifier,
    };
    const behavioralPersona = assignBehavioralPersona(c, behavioralScore, components, config);

    // Store on contact
    c.behavioralScore = behavioralScore;
    c.behavioralPersona = behavioralPersona;
    c.behavioralSignals = {
      connectionCount: connPower.count,
      connectionPower: round(connPower.score),
      connectionRecency: round(connRecency.score),
      connectedDaysAgo: connRecency.days === Infinity ? null : connRecency.days,
      aboutSignals: aboutSig.matchedCategories,
      headlineSignals: headlineSig.matchedPatterns,
      superConnectorTraits: superConn.traits,
      traitCount: superConn.traitCount,
      amplification: round(amplifier.score),
    };

    // Recompute goldScore v2 (weighted with behavioral)
    const w = config.goldScoreV2;
    const oldScores = c.scores;
    const goldScoreV2 = round(
      (oldScores.icpFit || 0) * w.icpWeight +
      (oldScores.networkHub || 0) * w.networkHubWeight +
      (oldScores.relationshipStrength || 0) * w.relationshipWeight +
      behavioralScore * w.behavioralWeight +
      (oldScores.signalBoost || 0) * w.signalBoostWeight
    );

    // Update scores
    oldScores.behavioral = behavioralScore;
    oldScores.goldScoreV1 = oldScores.goldScore; // preserve original
    oldScores.goldScore = goldScoreV2;

    // Re-tier based on v2 goldScore (thresholds from icp-config.json)
    const tiers = icp.tiers || { gold: 0.55, silver: 0.40, bronze: 0.28 };
    oldScores.tier = goldScoreV2 >= tiers.gold ? 'gold'
      : goldScoreV2 >= tiers.silver ? 'silver'
      : goldScoreV2 >= tiers.bronze ? 'bronze' : 'watch';

    personaCounts[behavioralPersona] = (personaCounts[behavioralPersona] || 0) + 1;
    totalBehavioral += behavioralScore;
    topBehavioral.push({ url, name: c.enrichedName || c.name, behavioralScore, persona: behavioralPersona });

    log(`  ${(c.enrichedName || c.name || '').padEnd(30)} beh=${behavioralScore} gold=${oldScores.goldScore} ` +
      `persona=${behavioralPersona} traits=${superConn.traitCount}`);
  }

  // Update cluster hubContacts with new scores
  for (const cl of Object.values(graph.clusters)) {
    cl.hubContacts = cl.contacts.filter(u => (graph.contacts[u]?.scores?.networkHub || 0) >= 0.6);
  }

  graph.meta.lastBehavioralScored = new Date().toISOString();
  graph.meta.behavioralVersion = 1;
  writeFileSync(GRAPH_PATH, JSON.stringify(graph, null, 2));

  // Summary
  console.log('\n=== Behavioral Scoring Complete ===\n');
  console.log(`Contacts scored: ${urls.length}`);
  console.log(`Avg behavioral score: ${(totalBehavioral / urls.length).toFixed(3)}`);

  // Tier redistribution
  const tierCounts = { gold: 0, silver: 0, bronze: 0, watch: 0 };
  for (const url of urls) tierCounts[graph.contacts[url].scores.tier]++;
  console.log(`\nTier Distribution (v2 goldScore):`);
  for (const [tier, count] of Object.entries(tierCounts)) {
    const pct = ((count / urls.length) * 100).toFixed(1);
    console.log(`  ${tier.padEnd(8)} ${String(count).padStart(4)}  (${pct.padStart(5)}%)  ${'#'.repeat(Math.round(count / urls.length * 40))}`);
  }

  console.log(`\nBehavioral Persona Distribution:`);
  for (const [p, count] of Object.entries(personaCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${p.padEnd(22)} ${String(count).padStart(4)}  (${((count / urls.length) * 100).toFixed(1).padStart(5)}%)`);
  }

  topBehavioral.sort((a, b) => b.behavioralScore - a.behavioralScore);
  const top10 = topBehavioral.slice(0, 10);
  console.log(`\nTop 10 Behavioral Scores:`);
  top10.forEach((e, i) => {
    const c = graph.contacts[e.url];
    console.log(`  ${i + 1}. ${e.name.padEnd(30)} beh=${e.behavioralScore} gold=${c.scores.goldScore} ` +
      `persona=${e.persona} traits=[${c.behavioralSignals.superConnectorTraits.join(',')}]`);
  });

  console.log(`\nOutput: ${GRAPH_PATH}`);

  await updateRvfScores(graph.contacts);
}

score().catch(e => { console.error(e); process.exit(1); });
