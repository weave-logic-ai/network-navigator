import { readFileSync, writeFileSync, existsSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { DATA_DIR, CONFIG_DIR } from './lib.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const GRAPH_PATH = resolve(DATA_DIR, 'graph.json');
const ICP_PATH = resolve(CONFIG_DIR, 'icp-config.json');
const VERBOSE = process.argv.includes('--verbose');
const log = (...a) => { if (VERBOSE) console.log('[scorer]', ...a); };
const round = n => Math.round(n * 1000) / 1000;
const cap = (v, max = 1.0) => Math.min(v, max);

function loadFiles() {
  if (!existsSync(GRAPH_PATH)) {
    console.error(`graph.json not found — run graph-builder.mjs first.`);
    process.exit(1);
  }
  if (!existsSync(ICP_PATH)) { console.error('icp-config.json not found.'); process.exit(1); }
  return {
    graph: JSON.parse(readFileSync(GRAPH_PATH, 'utf-8')),
    icp: JSON.parse(readFileSync(ICP_PATH, 'utf-8')),
  };
}

function contactText(c) {
  return [c.headline || '', c.title || '', c.about || '', c.currentRole || '',
    ...(c.searchTerms || [])].join(' ').toLowerCase();
}
function roleText(c) {
  return [c.currentRole || '', c.title || '', c.headline || ''].join(' ');
}
function percentile(sorted, pct) {
  if (!sorted.length) return 0;
  return sorted[Math.max(0, Math.ceil((pct / 100) * sorted.length) - 1)];
}

// ---- Baselines ----
function computeBaselines(graph) {
  const urls = Object.keys(graph.contacts);
  const allMutuals = urls.map(u => graph.contacts[u].mutualConnections || 0);
  const nonZero = allMutuals.filter(m => m > 0).sort((a, b) => a - b);
  const sorted = [...allMutuals].sort((a, b) => a - b);
  const edgeCounts = {};
  for (const url of urls) edgeCounts[url] = 0;
  for (const e of graph.edges) {
    edgeCounts[e.source] = (edgeCounts[e.source] || 0) + 1;
    edgeCounts[e.target] = (edgeCounts[e.target] || 0) + 1;
  }
  const contactClusters = {};
  for (const [cId, cl] of Object.entries(graph.clusters)) {
    for (const url of cl.contacts) {
      (contactClusters[url] ??= []).push(cId);
    }
  }
  const activeClusters = Object.keys(graph.clusters).filter(k => graph.clusters[k].contacts.length > 0).length;
  return {
    p90Mutuals: Math.max(nonZero.length > 0 ? percentile(nonZero, 90) : 113, 1),
    maxMutuals: sorted[sorted.length - 1] || 1,
    maxSearchTerms: Math.max(...urls.map(u => (graph.contacts[u].searchTerms || []).length), 1),
    maxEdges: Math.max(...Object.values(edgeCounts), 1),
    totalClusters: activeClusters || 1,
    edgeCounts,
    contactClusters,
  };
}

// ---- ICP Fit ----
function matchRoleLevel(role, patterns) {
  const r = role.toLowerCase();
  for (const p of (patterns.high || [])) { if (r.includes(p.toLowerCase())) return 1.0; }
  for (const p of (patterns.medium || [])) { if (r.includes(p.toLowerCase())) return 0.7; }
  for (const p of (patterns.low || [])) { if (r.includes(p.toLowerCase())) return 0.3; }
  return 0.1;
}
function matchIndustry(text, industries) {
  const t = text.toLowerCase();
  const n = industries.filter(i => t.includes(i.toLowerCase())).length;
  return n >= 2 ? 1.0 : n === 1 ? 0.5 : 0.0;
}
function matchSignals(text, signals) {
  const t = text.toLowerCase();
  return cap(signals.filter(s => t.includes(s.toLowerCase())).length / (signals.length || 1));
}
function fitForProfile(contact, profile) {
  return matchRoleLevel(roleText(contact), profile.rolePatterns) * 0.35 +
    matchIndustry(contactText(contact), profile.industries) * 0.25 +
    matchSignals(contactText(contact), profile.signals) * 0.25 +
    0.5 * 0.15; // companySizeScore defaults to 0.5 — no direct data
}
function computeIcpFit(contact, profiles) {
  let best = 0;
  for (const p of Object.values(profiles)) {
    best = Math.max(best, fitForProfile(contact, p) * (p.weight || 1.0));
  }
  return cap(best);
}
function computeIcpCategories(contact, profiles) {
  return Object.entries(profiles)
    .filter(([, p]) => fitForProfile(contact, p) * (p.weight || 1.0) >= 0.4)
    .map(([k]) => k);
}

// ---- Network Hub ----
function connectorIndex(contact) {
  const r = roleText(contact).toLowerCase();
  if (['partner', 'consultant', 'advisor', 'investor', 'advisory'].some(k => r.includes(k))) return 1.0;
  if (['ceo', 'founder', 'co-founder', 'owner', 'president'].some(k => r.includes(k))) return 0.7;
  if (['director', 'vp', 'vice president', 'head of'].some(k => r.includes(k))) return 0.5;
  return 0.2;
}
function computeNetworkHub(contact, url, bl) {
  return cap((contact.mutualConnections || 0) / bl.p90Mutuals) * 0.30 +
    ((bl.contactClusters[url] || []).length / bl.totalClusters) * 0.25 +
    connectorIndex(contact) * 0.25 +
    cap((bl.edgeCounts[url] || 0) / bl.maxEdges) * 0.20;
}

// ---- Relationship Strength ----
function recencyFactor(c) {
  if (!c.cachedAt) return 0.2;
  const d = (Date.now() - new Date(c.cachedAt).getTime()) / 86400000;
  return d <= 7 ? 1.0 : d <= 30 ? 0.7 : d <= 90 ? 0.4 : 0.2;
}
function proximityFactor(contact, icp) {
  let s = 0;
  const loc = (contact.enrichedLocation || contact.location || '').toLowerCase();
  const text = contactText(contact);
  if (['new york', 'san francisco', 'los angeles', 'austin', 'chicago',
    'seattle', 'boston', 'denver', 'atlanta', 'miami'].some(l => loc.includes(l))) s += 0.5;
  const allInd = new Set();
  for (const p of Object.values(icp.profiles)) p.industries.forEach(i => allInd.add(i.toLowerCase()));
  if ([...allInd].some(i => text.includes(i))) s += 0.5;
  return cap(s);
}
function computeRelationship(contact, bl, icp) {
  return cap((contact.mutualConnections || 0) / bl.maxMutuals) * 0.40 +
    cap((contact.searchTerms || []).length / bl.maxSearchTerms) * 0.20 +
    recencyFactor(contact) * 0.20 +
    proximityFactor(contact, icp) * 0.20;
}

// ---- Signal Boost & Gold Score ----
function computeSignalBoost(c) {
  const terms = ['ai', 'automation', 'scaling', 'growth'];
  const h = (c.headline || '').toLowerCase(), a = (c.about || '').toLowerCase();
  if (terms.some(t => h.includes(t))) return 1.0;
  if (terms.some(t => a.includes(t))) return 0.5;
  return 0.0;
}
function computeGoldScore(icp, hub, rel, boost, w) {
  return icp * (w.icpWeight || 0.35) + hub * (w.networkHubWeight || 0.30) +
    rel * (w.relationshipWeight || 0.25) + boost * (w.signalBoostWeight || 0.10);
}
function assignTier(gs, t) {
  return gs >= t.gold ? 'gold' : gs >= t.silver ? 'silver' : gs >= t.bronze ? 'bronze' : 'watch';
}
function assignPersona(contact, scores) {
  if (scores.icpFit >= 0.6 && scores.goldScore >= 0.5) return 'buyer';
  if (connectorIndex(contact) >= 0.8) return 'advisor';
  if (scores.networkHub >= 0.6 && scores.icpFit < 0.5) return 'hub';
  const r = roleText(contact).toLowerCase();
  if (['engineer', 'developer', 'architect'].some(k => r.includes(k))) return 'peer';
  return 'referral-partner';
}

// ---- Tags ----
const INDUSTRY_TAGS = {
  ecommerce: ['ecommerce', 'e-commerce', 'digital commerce'],
  dtc: ['dtc', 'direct to consumer', 'd2c'],
  saas: ['saas', 'software as a service'],
  shopify: ['shopify'], 'adobe-commerce': ['adobe commerce', 'magento'],
  retail: ['retail', 'omnichannel'], agency: ['agency', 'studio', 'consultancy'],
  php: ['php', 'laravel', 'symfony', 'zend'],
};
function deriveTags(contact, url, bl) {
  const tags = [], r = roleText(contact).toLowerCase(), text = contactText(contact);
  if (['ceo', 'vp', 'vice president', 'director', 'head of', 'president', 'founder']
    .some(k => r.includes(k))) tags.push('decision-maker');
  if (['cto', 'cio', 'chief technology', 'chief information'].some(k => r.includes(k)))
    tags.push('tech-leader');
  if (['consultant', 'advisor', 'advisory'].some(k => r.includes(k))) tags.push('influencer');
  for (const [tag, kws] of Object.entries(INDUSTRY_TAGS)) {
    if (kws.some(k => text.includes(k))) tags.push(tag);
  }
  if (text.includes('ai') || text.includes('artificial intelligence')) tags.push('ai-interest');
  if (text.includes('automation')) tags.push('automation-interest');
  if (text.includes('scaling') || text.includes('growth')) tags.push('growth-focus');
  if ((contact.mutualConnections || 0) >= bl.p90Mutuals) tags.push('high-mutual');
  if ((contact.searchTerms || []).length >= 3) tags.push('multi-search');
  return [...new Set(tags)];
}

// ---- Main ----
function score() {
  const { graph, icp } = loadFiles();
  const urls = Object.keys(graph.contacts);
  if (!urls.length) { console.error('No contacts in graph.json.'); process.exit(1); }

  log(`Scoring ${urls.length} contacts...`);
  const bl = computeBaselines(graph);
  log(`Baselines: P90=${bl.p90Mutuals}, max=${bl.maxMutuals}, maxSearch=${bl.maxSearchTerms}, ` +
    `maxEdges=${bl.maxEdges}, clusters=${bl.totalClusters}`);

  const tierCounts = { gold: 0, silver: 0, bronze: 0, watch: 0 };
  const personaCounts = {};
  const topGold = [];

  for (const url of urls) {
    const c = graph.contacts[url];
    const icpFit = computeIcpFit(c, icp.profiles);
    const networkHub = computeNetworkHub(c, url, bl);
    const rel = computeRelationship(c, bl, icp);
    const boost = computeSignalBoost(c);
    const gs = computeGoldScore(icpFit, networkHub, rel, boost, icp.goldScore);
    const tier = assignTier(gs, icp.tiers);

    c.scores = { icpFit: round(icpFit), networkHub: round(networkHub),
      relationshipStrength: round(rel), signalBoost: round(boost), goldScore: round(gs), tier };
    c.personaType = assignPersona(c, c.scores);
    c.icpCategories = computeIcpCategories(c, icp.profiles);
    c.tags = deriveTags(c, url, bl);

    tierCounts[tier]++;
    personaCounts[c.personaType] = (personaCounts[c.personaType] || 0) + 1;
    if (tier === 'gold') topGold.push({ url, name: c.enrichedName || c.name, goldScore: c.scores.goldScore });
    log(`  ${(c.enrichedName || c.name).padEnd(30)} gold=${c.scores.goldScore} tier=${tier} persona=${c.personaType}`);
  }

  // Update cluster hubContacts
  for (const cl of Object.values(graph.clusters)) {
    cl.hubContacts = cl.contacts.filter(u => (graph.contacts[u]?.scores?.networkHub || 0) >= 0.6);
  }
  graph.meta.lastScored = new Date().toISOString();
  graph.meta.scoringVersion = 1;
  writeFileSync(GRAPH_PATH, JSON.stringify(graph, null, 2));

  // Summary
  console.log('\n=== Scoring Complete ===\n');
  console.log(`Contacts scored: ${urls.length}`);
  console.log(`\nTier Distribution:`);
  for (const [tier, count] of Object.entries(tierCounts)) {
    const pct = ((count / urls.length) * 100).toFixed(1);
    console.log(`  ${tier.padEnd(8)} ${String(count).padStart(4)}  (${pct.padStart(5)}%)  ${'#'.repeat(Math.round(count / urls.length * 40))}`);
  }
  console.log(`\nPersona Distribution:`);
  for (const [p, count] of Object.entries(personaCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${p.padEnd(20)} ${String(count).padStart(4)}  (${((count / urls.length) * 100).toFixed(1).padStart(5)}%)`);
  }
  topGold.sort((a, b) => b.goldScore - a.goldScore);
  if (topGold.length) {
    const top5 = topGold.slice(0, 5);
    console.log(`\nTop ${top5.length} Gold Contacts:`);
    top5.forEach((e, i) => {
      const c = graph.contacts[e.url];
      console.log(`  ${i + 1}. ${e.name.padEnd(30)} score=${e.goldScore}  icp=${c.scores.icpFit} ` +
        `hub=${c.scores.networkHub} rel=${c.scores.relationshipStrength} persona=${c.personaType}`);
    });
  }
  console.log(`\nOutput: ${GRAPH_PATH}`);
}

score();
