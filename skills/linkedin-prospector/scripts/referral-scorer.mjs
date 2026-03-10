/**
 * referral-scorer.mjs -- Computes referral likelihood scores for all contacts.
 *
 * Runs after behavioral-scorer.mjs. Scores 6 components:
 *   referralRole (0.25)       — Agency/partner/consultant/advisor roles
 *   clientOverlap (0.20)      — Serves the same industries you target
 *   networkReach (0.20)       — Connection count + cluster breadth + edge density
 *   amplificationPower (0.15) — Super-connector traits, helping language, content creation
 *   relationshipWarmth (0.10) — Mutual connections + recency + relationship strength
 *   buyerInversion (0.10)     — Low ICP fit + ecosystem presence = referral, not buyer
 *
 * Outputs per contact:
 *   c.scores.referralLikelihood (0-1)
 *   c.referralTier: gold-referral / silver-referral / bronze-referral / null
 *   c.referralPersona: white-label-partner / warm-introducer / co-seller / amplifier / passive-referral
 *   c.referralSignals: breakdown of all 6 component scores
 *
 * Usage:
 *   node referral-scorer.mjs [--verbose]
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

import { DATA_DIR, CONFIG_DIR } from './lib.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const GRAPH_PATH = resolve(DATA_DIR, 'graph.json');
const REFERRAL_CONFIG_PATH = resolve(CONFIG_DIR, 'referral-config.json');
const ICP_PATH = resolve(CONFIG_DIR, 'icp-config.json');
const VERBOSE = process.argv.includes('--verbose');
const log = (...a) => { if (VERBOSE) console.log('[referral]', ...a); };
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
  if (!existsSync(REFERRAL_CONFIG_PATH)) {
    console.error('referral-config.json not found.');
    process.exit(1);
  }
  if (!existsSync(ICP_PATH)) {
    console.error('icp-config.json not found.');
    process.exit(1);
  }
  return {
    graph: JSON.parse(readFileSync(GRAPH_PATH, 'utf-8')),
    config: JSON.parse(readFileSync(REFERRAL_CONFIG_PATH, 'utf-8')),
    icp: JSON.parse(readFileSync(ICP_PATH, 'utf-8')),
  };
}

// ---------------------------------------------------------------------------
// Component 1: Referral Role Score (0.25)
// ---------------------------------------------------------------------------

function scoreReferralRole(contact, config) {
  const text = [
    contact.headline || '',
    contact.currentRole || '',
    contact.title || '',
    contact.about || '',
  ].join(' ').toLowerCase();

  // Check role tiers from highest to lowest
  for (const tier of ['high', 'medium', 'low']) {
    const tierConfig = config.roleTiers[tier];
    for (const pattern of tierConfig.patterns) {
      if (text.includes(pattern)) {
        return { score: tierConfig.score, matchedPattern: pattern, tier };
      }
    }
  }
  return { score: 0, matchedPattern: null, tier: null };
}

// ---------------------------------------------------------------------------
// Component 2: Client Overlap Score (0.20)
// ---------------------------------------------------------------------------

function scoreClientOverlap(contact, config) {
  const text = [
    contact.headline || '',
    contact.currentRole || '',
    contact.about || '',
    contact.currentCompany || '',
    ...(contact.tags || []),
    ...(contact.searchTerms || []),
  ].join(' ').toLowerCase();

  // Check if they serve target industries
  const targetIndustries = config.targetIndustries;
  let industryMatches = 0;
  const matchedIndustries = [];
  for (const ind of targetIndustries) {
    if (text.includes(ind)) {
      industryMatches++;
      matchedIndustries.push(ind);
    }
  }

  // Check service-provider signals
  const serviceSignals = config.industrySignals.servesTargetClients;
  let serviceMatches = 0;
  for (const sig of serviceSignals) {
    if (text.includes(sig)) serviceMatches++;
  }

  // Combine: industry keyword overlap + service provider signals
  const industryScore = cap(industryMatches / 3); // 3+ industries = 1.0
  const serviceScore = cap(serviceMatches / 2);    // 2+ service signals = 1.0
  const combined = industryScore * 0.6 + serviceScore * 0.4;

  return {
    score: round(cap(combined)),
    matchedIndustries,
    industryMatchCount: industryMatches,
    serviceMatchCount: serviceMatches,
  };
}

// ---------------------------------------------------------------------------
// Component 3: Network Reach Score (0.20)
// ---------------------------------------------------------------------------

function scoreNetworkReach(contact, baselines, config) {
  const nrConfig = config.networkReachBaselines;

  // Connection count (from behavioral signals or raw data)
  const connCount = contact.behavioralSignals?.connectionCount || 0;
  const connScore = cap(connCount / nrConfig.connectionCountNorm);

  // Cluster breadth (how many clusters they belong to)
  const clusterCount = baselines.contactClusters[contact._url]?.length || 0;
  const totalClusters = Math.max(baselines.activeClusters, 1);
  const clusterScore = cap(clusterCount / Math.max(totalClusters * 0.3, 1));

  // Edge density (how many graph edges they have)
  const edgeCount = baselines.edgeCounts[contact._url] || 0;
  const edgeScore = cap(edgeCount / Math.max(baselines.p90Edges, 1));

  const score = connScore * nrConfig.connectionCountWeight +
    clusterScore * nrConfig.clusterBreadthWeight +
    edgeScore * nrConfig.edgeDensityWeight;

  return {
    score: round(cap(score)),
    connectionCount: connCount,
    clusterCount,
    edgeCount,
  };
}

// ---------------------------------------------------------------------------
// Component 4: Amplification Power Score (0.15)
// ---------------------------------------------------------------------------

function scoreAmplificationPower(contact) {
  let score = 0;
  const signals = [];

  // Super-connector traits from behavioral scorer
  const traitCount = contact.behavioralSignals?.traitCount || 0;
  if (traitCount >= 3) {
    score += 0.4;
    signals.push('super-connector-traits');
  } else if (traitCount >= 1) {
    score += traitCount * 0.12;
    signals.push('some-traits');
  }

  // Helping/connecting language in about/headline
  const text = ((contact.about || '') + ' ' + (contact.headline || '')).toLowerCase();
  const helpingWords = ['helping', 'connecting', 'introducing', 'empowering',
    'enabling', 'supporting', 'bridging', 'matchmaking'];
  let helpingCount = 0;
  for (const word of helpingWords) {
    if (text.includes(word)) helpingCount++;
  }
  if (helpingCount >= 2) {
    score += 0.3;
    signals.push('helping-language');
  } else if (helpingCount === 1) {
    score += 0.15;
    signals.push('some-helping');
  }

  // Content creation signals
  const contentWords = ['speaker', 'author', 'writer', 'podcast', 'blogger',
    'content creator', 'keynote', 'thought leader', 'published'];
  let contentCount = 0;
  for (const word of contentWords) {
    if (text.includes(word)) contentCount++;
  }
  if (contentCount >= 1) {
    score += 0.3;
    signals.push('content-creator');
  }

  return { score: round(cap(score)), signals };
}

// ---------------------------------------------------------------------------
// Component 5: Relationship Warmth Score (0.10)
// ---------------------------------------------------------------------------

function scoreRelationshipWarmth(contact, baselines) {
  // Mutual connections (normalized by P90)
  const mutuals = contact.mutualConnections || 0;
  const mutualScore = cap(mutuals / Math.max(baselines.p90Mutuals, 1));

  // Existing relationship strength from scorer.mjs
  const relStrength = contact.scores?.relationshipStrength || 0;

  // Recency from behavioral scorer
  const daysAgo = contact.behavioralSignals?.connectedDaysAgo;
  let recencyScore = 0.1; // default for unknown
  if (daysAgo !== null && daysAgo !== undefined) {
    if (daysAgo <= 90) recencyScore = 1.0;
    else if (daysAgo <= 180) recencyScore = 0.7;
    else if (daysAgo <= 365) recencyScore = 0.4;
    else recencyScore = 0.2;
  }

  const score = mutualScore * 0.35 + relStrength * 0.35 + recencyScore * 0.30;
  return {
    score: round(cap(score)),
    mutuals,
    relStrength: round(relStrength),
    recencyScore: round(recencyScore),
  };
}

// ---------------------------------------------------------------------------
// Component 6: Buyer Inversion Score (0.10)
// ---------------------------------------------------------------------------

function scoreBuyerInversion(contact) {
  // High ICP fit = they're a buyer, not a referrer
  // Low ICP fit + ecosystem signals = referral partner
  const icpFit = contact.scores?.icpFit || 0;
  const invertedIcp = cap(1.0 - icpFit); // low ICP = high inversion

  // Ecosystem presence: do they have tags/signals that show they're in the ecosystem?
  const text = [
    contact.headline || '',
    contact.about || '',
    ...(contact.tags || []),
  ].join(' ').toLowerCase();

  const ecosystemKeywords = [
    'ecosystem', 'partner', 'community', 'network', 'alliance',
    'integration', 'marketplace', 'channel', 'reseller', 'agency',
    'consultancy', 'service provider', 'implementation',
  ];
  let ecosystemCount = 0;
  for (const kw of ecosystemKeywords) {
    if (text.includes(kw)) ecosystemCount++;
  }
  const ecosystemScore = cap(ecosystemCount / 3);

  // Only high inversion if BOTH low ICP and ecosystem presence
  const score = invertedIcp * 0.5 + ecosystemScore * 0.5;
  return {
    score: round(cap(score)),
    invertedIcp: round(invertedIcp),
    ecosystemScore: round(ecosystemScore),
  };
}

// ---------------------------------------------------------------------------
// Referral Persona Assignment
// ---------------------------------------------------------------------------

function assignReferralPersona(contact, components, referralScore, config) {
  const { referralRole, clientOverlap, networkReach, amplificationPower,
    relationshipWarmth } = components;
  const personaConfigs = config.personas;

  // 1. White-label partner: agency/consultancy + serves target industries
  const wlpConfig = personaConfigs['white-label-partner'];
  const text = ((contact.headline || '') + ' ' + (contact.about || '') + ' ' +
    (contact.currentRole || '')).toLowerCase();
  const matchesWlpRole = wlpConfig.requires.rolePatterns.some(p => text.includes(p));
  if (matchesWlpRole && referralRole.score >= wlpConfig.requires.minReferralRole &&
      clientOverlap.score >= wlpConfig.requires.minClientOverlap) {
    return 'white-label-partner';
  }

  // 2. Warm introducer: strong relationship + broad network
  const wiConfig = personaConfigs['warm-introducer'];
  if (relationshipWarmth.score >= wiConfig.requires.minRelationshipWarmth &&
      networkReach.score >= wiConfig.requires.minNetworkReach) {
    return 'warm-introducer';
  }

  // 3. Co-seller: consultant/advisor serving overlapping clients
  const csConfig = personaConfigs['co-seller'];
  const matchesCsRole = csConfig.requires.rolePatterns.some(p => text.includes(p));
  if (matchesCsRole && clientOverlap.score >= csConfig.requires.minClientOverlap) {
    return 'co-seller';
  }

  // 4. Amplifier: super-connector or content creator behavioral persona
  const ampConfig = personaConfigs['amplifier'];
  const behPersona = contact.behavioralPersona || '';
  if (amplificationPower.score >= ampConfig.requires.minAmplificationPower ||
      ampConfig.requires.behavioralPersonas.includes(behPersona)) {
    return 'amplifier';
  }

  // 5. Default
  return 'passive-referral';
}

// ---------------------------------------------------------------------------
// Baselines
// ---------------------------------------------------------------------------

function computeBaselines(graph) {
  const urls = Object.keys(graph.contacts);

  // Mutual connections P90
  const allMutuals = urls.map(u => graph.contacts[u].mutualConnections || 0)
    .filter(m => m > 0).sort((a, b) => a - b);
  const p90Mutuals = allMutuals.length > 0
    ? allMutuals[Math.max(0, Math.ceil(0.9 * allMutuals.length) - 1)]
    : 1;

  // Edge counts per contact
  const edgeCounts = {};
  for (const url of urls) edgeCounts[url] = 0;
  for (const e of (graph.edges || [])) {
    edgeCounts[e.source] = (edgeCounts[e.source] || 0) + 1;
    edgeCounts[e.target] = (edgeCounts[e.target] || 0) + 1;
  }
  const edgeValues = Object.values(edgeCounts).filter(e => e > 0).sort((a, b) => a - b);
  const p90Edges = edgeValues.length > 0
    ? edgeValues[Math.max(0, Math.ceil(0.9 * edgeValues.length) - 1)]
    : 1;

  // Cluster membership per contact
  const contactClusters = {};
  for (const [cId, cl] of Object.entries(graph.clusters || {})) {
    for (const url of cl.contacts) {
      (contactClusters[url] ??= []).push(cId);
    }
  }
  const activeClusters = Object.keys(graph.clusters || {})
    .filter(k => graph.clusters[k].contacts.length > 0).length;

  return {
    p90Mutuals: Math.max(p90Mutuals, 1),
    edgeCounts,
    p90Edges: Math.max(p90Edges, 1),
    contactClusters,
    activeClusters,
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function score() {
  const { graph, config, icp } = loadFiles();
  const urls = Object.keys(graph.contacts);
  if (!urls.length) { console.error('No contacts in graph.json.'); process.exit(1); }

  // Verify behavioral scoring exists
  const firstContact = graph.contacts[urls[0]];
  if (firstContact.behavioralScore === undefined) {
    console.error('Behavioral scores not found — run behavioral-scorer.mjs first.');
    process.exit(1);
  }

  log(`Referral scoring ${urls.length} contacts...`);
  const baselines = computeBaselines(graph);
  log(`Baselines: P90 mutuals=${baselines.p90Mutuals}, P90 edges=${baselines.p90Edges}, clusters=${baselines.activeClusters}`);

  const personaCounts = {};
  const tierCounts = { 'gold-referral': 0, 'silver-referral': 0, 'bronze-referral': 0, none: 0 };
  const topReferrals = [];
  let totalReferral = 0;

  for (const url of urls) {
    const c = graph.contacts[url];
    c._url = url; // temp reference for baselines lookup

    // Compute 6 components
    const referralRole = scoreReferralRole(c, config);
    const clientOverlap = scoreClientOverlap(c, config);
    const networkReach = scoreNetworkReach(c, baselines, config);
    const amplificationPower = scoreAmplificationPower(c);
    const relationshipWarmth = scoreRelationshipWarmth(c, baselines);
    const buyerInversion = scoreBuyerInversion(c);

    // Composite referral likelihood
    const w = config.weights;
    const referralLikelihood = round(
      referralRole.score * w.referralRole +
      clientOverlap.score * w.clientOverlap +
      networkReach.score * w.networkReach +
      amplificationPower.score * w.amplificationPower +
      relationshipWarmth.score * w.relationshipWarmth +
      buyerInversion.score * w.buyerInversion
    );

    // Components for persona assignment
    const components = {
      referralRole, clientOverlap, networkReach,
      amplificationPower, relationshipWarmth, buyerInversion,
    };

    // Assign referral persona
    const referralPersona = assignReferralPersona(c, components, referralLikelihood, config);

    // Assign referral tier
    const tiers = config.referralTiers;
    const referralTier = referralLikelihood >= tiers['gold-referral'] ? 'gold-referral'
      : referralLikelihood >= tiers['silver-referral'] ? 'silver-referral'
      : referralLikelihood >= tiers['bronze-referral'] ? 'bronze-referral'
      : null;

    // Store on contact
    c.scores.referralLikelihood = referralLikelihood;
    c.referralTier = referralTier;
    c.referralPersona = referralPersona;
    c.referralSignals = {
      referralRole: round(referralRole.score),
      referralRoleMatch: referralRole.matchedPattern,
      clientOverlap: round(clientOverlap.score),
      clientOverlapIndustries: clientOverlap.matchedIndustries,
      networkReach: round(networkReach.score),
      networkReachDetail: {
        connections: networkReach.connectionCount,
        clusters: networkReach.clusterCount,
        edges: networkReach.edgeCount,
      },
      amplificationPower: round(amplificationPower.score),
      amplificationSignals: amplificationPower.signals,
      relationshipWarmth: round(relationshipWarmth.score),
      buyerInversion: round(buyerInversion.score),
    };

    // Clean up temp field
    delete c._url;

    // Track stats
    personaCounts[referralPersona] = (personaCounts[referralPersona] || 0) + 1;
    tierCounts[referralTier || 'none']++;
    totalReferral += referralLikelihood;
    topReferrals.push({
      url,
      name: c.enrichedName || c.name,
      referralLikelihood,
      persona: referralPersona,
      tier: referralTier,
    });

    log(`  ${(c.enrichedName || c.name || '').padEnd(30)} ref=${referralLikelihood} ` +
      `persona=${referralPersona} tier=${referralTier || '-'} ` +
      `role=${referralRole.score} overlap=${clientOverlap.score}`);
  }

  // Save
  graph.meta.lastReferralScored = new Date().toISOString();
  graph.meta.referralVersion = 1;
  writeFileSync(GRAPH_PATH, JSON.stringify(graph, null, 2));

  // Summary
  console.log('\n=== Referral Scoring Complete ===\n');
  console.log(`Contacts scored: ${urls.length}`);
  console.log(`Avg referral likelihood: ${(totalReferral / urls.length).toFixed(3)}`);

  console.log(`\nReferral Tier Distribution:`);
  for (const [tier, count] of Object.entries(tierCounts)) {
    const pct = ((count / urls.length) * 100).toFixed(1);
    console.log(`  ${tier.padEnd(16)} ${String(count).padStart(4)}  (${pct.padStart(5)}%)  ${'#'.repeat(Math.round(count / urls.length * 40))}`);
  }

  console.log(`\nReferral Persona Distribution:`);
  for (const [p, count] of Object.entries(personaCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${p.padEnd(22)} ${String(count).padStart(4)}  (${((count / urls.length) * 100).toFixed(1).padStart(5)}%)`);
  }

  topReferrals.sort((a, b) => b.referralLikelihood - a.referralLikelihood);
  const top10 = topReferrals.slice(0, 10);
  console.log(`\nTop 10 Referral Partners:`);
  top10.forEach((e, i) => {
    const c = graph.contacts[e.url];
    console.log(`  ${i + 1}. ${e.name.padEnd(30)} ref=${e.referralLikelihood} ` +
      `persona=${e.persona} tier=${e.tier || '-'} ` +
      `role=${c.referralSignals.referralRole} overlap=${c.referralSignals.clientOverlap}`);
  });

  console.log(`\nOutput: ${GRAPH_PATH}`);
}

score();
