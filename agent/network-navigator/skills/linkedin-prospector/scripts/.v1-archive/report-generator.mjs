/**
 * report-generator.mjs -- Generates a self-contained interactive HTML dashboard
 * from graph.json data. Includes 3D force-directed graph (Three.js via 3d-force-graph),
 * Chart.js charts, sortable tables, and full report sections.
 *
 * Usage:
 *   node report-generator.mjs [--top N] [--output path]
 *
 * Default: --top 200 --output ../data/network-report.html
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { parseArgs, DATA_DIR } from './lib.mjs';
import { isRvfAvailable, queryStore, getContact, storeLength, closeStore } from './rvf-store.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const GRAPH_PATH = resolve(DATA_DIR, 'graph.json');
const DEFAULT_OUTPUT = resolve(DATA_DIR, 'network-report.html');

// ---------------------------------------------------------------------------
// Load & compute report data
// ---------------------------------------------------------------------------

function loadGraph() {
  if (!existsSync(GRAPH_PATH)) {
    console.error('graph.json not found. Run pipeline.mjs --rebuild first.');
    process.exit(1);
  }
  return JSON.parse(readFileSync(GRAPH_PATH, 'utf-8'));
}

function clustersForContact(url, graph) {
  const out = [];
  for (const [id, cl] of Object.entries(graph.clusters || {})) {
    if (cl.contacts.includes(url)) out.push(id);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Smart edge pruning — converts dense cliques into a sparse, readable graph
// ---------------------------------------------------------------------------

function computeEdgeAffinity(edge, contactMap, clusterMap) {
  const a = contactMap[edge.source];
  const b = contactMap[edge.target];
  if (!a || !b) return 0;

  let score = 0;

  // 1. Direct connection evidence (discoveredVia) — strongest signal
  const dViaA = new Set(a.discoveredVia || []);
  const dViaB = new Set(b.discoveredVia || []);
  if (dViaA.has(edge.target) || dViaB.has(edge.source)) {
    score += 0.35;
  }
  // Shared discoverers (both discovered by the same 1st-degree contact)
  const sharedDiscoverers = [...dViaA].filter(v => dViaB.has(v)).length;
  if (sharedDiscoverers > 0) score += Math.min(0.2, sharedDiscoverers * 0.05);

  // 2. Mutual connection similarity (Jaccard-ish)
  const mutA = a.mutualConnections || 0;
  const mutB = b.mutualConnections || 0;
  if (mutA > 0 && mutB > 0) {
    score += 0.1 * Math.min(mutA, mutB) / Math.max(mutA, mutB);
  }

  // 3. Edge type bonuses for known strong ties
  if (edge.type === 'same-company') score += 0.3;
  if (edge.type === 'discovered-connection') score += 0.25;
  if (edge.type === 'shared-connection') score += 0.2;

  // 4. Tag overlap (Jaccard)
  const tagsA = new Set(a.tags || []);
  const tagsB = new Set(b.tags || []);
  if (tagsA.size > 0 && tagsB.size > 0) {
    const inter = [...tagsA].filter(t => tagsB.has(t)).length;
    const union = new Set([...tagsA, ...tagsB]).size;
    score += 0.1 * (inter / union);
  }

  // 5. Cluster specificity bonus — edges between nodes that share RARE clusters
  //    are more meaningful than edges in the giant 'technology' cluster
  const cA = clusterMap[edge.source] || [];
  const cB = clusterMap[edge.target] || [];
  const sharedClusters = cA.filter(c => cB.includes(c));
  if (sharedClusters.length > 0) {
    // Smaller clusters = more specific = higher weight
    score += 0.05 * sharedClusters.length;
  }

  // 6. Skills overlap
  const skillsA = new Set((a.skills || []).map(s => s.toLowerCase()));
  const skillsB = new Set((b.skills || []).map(s => s.toLowerCase()));
  if (skillsA.size > 0 && skillsB.size > 0) {
    const sInter = [...skillsA].filter(s => skillsB.has(s)).length;
    const sUnion = new Set([...skillsA, ...skillsB]).size;
    score += 0.1 * (sInter / sUnion);
  }

  return Math.min(1.0, score);
}

function pruneEdgesToKNN(edges, contactMap, clusterMap, k = 6) {
  const MIN_EDGES = 2; // every node gets at least this many edges

  // Recompute meaningful weights
  const weighted = edges.map(e => ({
    ...e,
    affinity: computeEdgeAffinity(e, contactMap, clusterMap),
  }));

  // Classify each edge as intra-cluster or inter-cluster (bridge)
  // Only treat as bridge if BOTH nodes have cluster membership — otherwise it's just an unknown
  const classified = weighted.map(e => {
    const cA = clusterMap[e.source] || [];
    const cB = clusterMap[e.target] || [];
    const hasClustersA = cA.length > 0;
    const hasClustersB = cB.length > 0;
    let isBridge = false;
    if (hasClustersA && hasClustersB) {
      // Both have clusters — bridge if no overlap
      const setA = new Set(cA);
      isBridge = !cB.some(c => setA.has(c));
    }
    return { ...e, isBridge };
  });

  // For each node, keep top-K edges by affinity
  const nodeEdges = {};
  classified.forEach(e => {
    if (!nodeEdges[e.source]) nodeEdges[e.source] = [];
    if (!nodeEdges[e.target]) nodeEdges[e.target] = [];
    nodeEdges[e.source].push(e);
    nodeEdges[e.target].push(e);
  });

  const kept = new Set();

  // Always keep same-company and discovered-connection edges (high-signal real connections)
  classified
    .filter(e => e.type === 'same-company' || e.type === 'discovered-connection')
    .forEach(e => kept.add(e));

  // Count existing edges per node from the always-keep set
  function edgeCountFor(nodeId) {
    let c = 0;
    for (const e of kept) {
      if (e.source === nodeId || e.target === nodeId) c++;
    }
    return c;
  }

  // KNN selection: each node gets top-K edges
  for (const [nodeId, edgeList] of Object.entries(nodeEdges)) {
    edgeList.sort((a, b) => b.affinity - a.affinity);
    let count = edgeCountFor(nodeId);
    for (const e of edgeList) {
      if (count >= k) break;
      if (!kept.has(e)) {
        kept.add(e);
      }
      count++;
    }
  }

  // Guarantee minimum connectivity — any node still under MIN_EDGES gets more
  for (const [nodeId, edgeList] of Object.entries(nodeEdges)) {
    let count = 0;
    for (const e of kept) {
      if (e.source === nodeId || e.target === nodeId) count++;
    }
    if (count >= MIN_EDGES) continue;
    // Add highest-affinity edges until we reach MIN_EDGES
    edgeList.sort((a, b) => b.affinity - a.affinity);
    for (const e of edgeList) {
      if (count >= MIN_EDGES) break;
      if (!kept.has(e)) {
        kept.add(e);
      }
      count++;
    }
  }

  return [...kept].map(e => ({
    source: e.source,
    target: e.target,
    type: e.type,
    weight: e.affinity,
    isBridge: e.isBridge,
  }));
}

function computeReportData(graph, topN) {
  const allContacts = Object.entries(graph.contacts)
    .map(([url, c]) => ({ url, ...c }))
    .filter(c => c.scores);

  // Sort by goldScore desc, take top N
  const topContacts = [...allContacts]
    .sort((a, b) => (b.scores.goldScore || 0) - (a.scores.goldScore || 0))
    .slice(0, topN);

  const topUrls = new Set(topContacts.map(c => c.url));

  // Build lookup maps for edge pruning
  const contactMap = {};
  topContacts.forEach(c => { contactMap[c.url] = c; });
  const clusterMap = {};
  topContacts.forEach(c => { clusterMap[c.url] = clustersForContact(c.url, graph); });

  // Raw edges between top contacts
  const rawEdges = (graph.edges || []).filter(
    e => topUrls.has(e.source) && topUrls.has(e.target)
  );

  // Synthesize discovered-connection edges from discoveredVia data
  // (may be missing from graph.edges if graph wasn't rebuilt after deep-scan)
  const edgeSet = new Set(rawEdges.map(e => e.source < e.target
    ? `${e.type}|${e.source}|${e.target}` : `${e.type}|${e.target}|${e.source}`));

  // Direct discovered-connection: A discovered B (both in top 200)
  for (const c of topContacts) {
    if (!c.discoveredVia) continue;
    for (const via of c.discoveredVia) {
      if (!topUrls.has(via)) continue;
      const key = c.url < via
        ? `discovered-connection|${c.url}|${via}`
        : `discovered-connection|${via}|${c.url}`;
      if (!edgeSet.has(key)) {
        edgeSet.add(key);
        rawEdges.push({ source: via, target: c.url, type: 'discovered-connection', weight: 0.9 });
      }
    }
  }

  // Shared-discoverer edges: two top-200 contacts discovered by the SAME degree-1 contact
  // This connects degree-2 contacts that share a common connector (even if connector isn't in top 200)
  const discovererToContacts = {};
  for (const c of topContacts) {
    if (!c.discoveredVia) continue;
    for (const via of c.discoveredVia) {
      if (!discovererToContacts[via]) discovererToContacts[via] = [];
      discovererToContacts[via].push(c.url);
    }
  }
  let sharedEdgeCount = 0;
  for (const [via, urls] of Object.entries(discovererToContacts)) {
    if (urls.length < 2) continue;
    // Connect pairs discovered by same person (limit to avoid O(n^2) explosion)
    const limit = Math.min(urls.length, 15);
    for (let i = 0; i < limit; i++) {
      for (let j = i + 1; j < limit; j++) {
        const key = urls[i] < urls[j]
          ? `shared-connection|${urls[i]}|${urls[j]}`
          : `shared-connection|${urls[j]}|${urls[i]}`;
        if (!edgeSet.has(key)) {
          edgeSet.add(key);
          rawEdges.push({ source: urls[i], target: urls[j], type: 'shared-connection', weight: 0.7 });
          sharedEdgeCount++;
        }
      }
    }
  }

  // Smart pruning: KNN with affinity-based weights (default K=6 per node)
  const edges = pruneEdgesToKNN(rawEdges, contactMap, clusterMap, 6);
  console.log(`  Edge pruning: ${rawEdges.length} raw (${sharedEdgeCount} shared-discoverer) → ${edges.length} kept (K=6 per node)`);

  // Nodes for graph
  const nodes = topContacts.map(c => ({
    id: c.url,
    name: c.enrichedName || c.name || 'Unknown',
    role: c.currentRole || c.headline || '',
    company: c.currentCompany || '',
    location: c.enrichedLocation || '',
    goldScore: c.scores.goldScore || 0,
    icpFit: c.scores.icpFit || 0,
    networkHub: c.scores.networkHub || 0,
    relStrength: c.scores.relationshipStrength || 0,
    behavioral: c.behavioralScore || 0,
    tier: c.scores.tier || 'watch',
    persona: c.personaType || 'unknown',
    behavioralPersona: c.behavioralPersona || 'unknown',
    mutuals: c.mutualConnections || 0,
    clusters: clustersForContact(c.url, graph),
    tags: (c.tags || []).slice(0, 5),
    traitCount: c.behavioralSignals?.traitCount || 0,
    superConnectorTraits: c.behavioralSignals?.superConnectorTraits || [],
    degree: c.degree || 1,
    discoveredVia: (c.discoveredVia || []).length,
    referralLikelihood: c.scores?.referralLikelihood || 0,
    referralTier: c.referralTier || null,
    referralPersona: c.referralPersona || null,
  }));

  // Tier counts (full dataset)
  const tierCounts = { gold: 0, silver: 0, bronze: 0, watch: 0 };
  for (const c of allContacts) {
    const t = c.scores.tier || 'watch';
    tierCounts[t] = (tierCounts[t] || 0) + 1;
  }

  // Persona counts (full dataset)
  const personaCounts = {};
  for (const c of allContacts) {
    const p = c.personaType || 'unknown';
    personaCounts[p] = (personaCounts[p] || 0) + 1;
  }

  // Behavioral persona counts (full dataset)
  const behPersonaCounts = {};
  for (const c of allContacts) {
    const p = c.behavioralPersona || 'unknown';
    behPersonaCounts[p] = (behPersonaCounts[p] || 0) + 1;
  }

  // Referral tier counts (full dataset)
  const referralTierCounts = { 'gold-referral': 0, 'silver-referral': 0, 'bronze-referral': 0, none: 0 };
  for (const c of allContacts) {
    const t = c.referralTier || 'none';
    referralTierCounts[t] = (referralTierCounts[t] || 0) + 1;
  }

  // Referral persona counts (full dataset)
  const referralPersonaCounts = {};
  for (const c of allContacts) {
    if (c.referralPersona) {
      referralPersonaCounts[c.referralPersona] = (referralPersonaCounts[c.referralPersona] || 0) + 1;
    }
  }

  // Referral score distribution
  const refScores = allContacts.map(c => c.scores?.referralLikelihood || 0).filter(v => v > 0);
  const refScoreDist = buildHistogram(refScores, 0, 1, 10);

  // Top 20 referral partners
  const topReferrals = allContacts
    .filter(c => c.scores?.referralLikelihood > 0)
    .sort((a, b) => (b.scores.referralLikelihood || 0) - (a.scores.referralLikelihood || 0))
    .slice(0, 20)
    .map(c => ({
      name: c.enrichedName || c.name,
      url: c.url,
      referralLikelihood: c.scores.referralLikelihood || 0,
      referralTier: c.referralTier || 'none',
      referralPersona: c.referralPersona || 'unknown',
      goldScore: c.scores.goldScore || 0,
      tier: c.scores.tier || 'watch',
      degree: c.degree || 1,
      role: c.currentRole || c.headline || '',
      company: c.currentCompany || '',
      signals: c.referralSignals || {},
    }));

  // Clusters with sizes and hub counts
  const clusterData = {};
  for (const [id, cl] of Object.entries(graph.clusters || {})) {
    if (cl.contacts.length === 0) continue;
    let hubCount = 0, amplifierCount = 0, totalBeh = 0;
    const tc = { gold: 0, silver: 0, bronze: 0, watch: 0 };
    for (const u of cl.contacts) {
      const c = graph.contacts[u];
      if (!c?.scores) continue;
      tc[c.scores.tier || 'watch']++;
      if (c.personaType === 'hub') hubCount++;
      if ((c.behavioralScore || 0) >= 0.3) amplifierCount++;
      totalBeh += c.behavioralScore || 0;
    }
    clusterData[id] = {
      size: cl.contacts.length,
      keywords: cl.keywords || [],
      hubCount,
      amplifierCount,
      avgBehavioral: cl.contacts.length > 0 ? totalBeh / cl.contacts.length : 0,
      tiers: tc,
    };
  }

  // Gold score distribution (histogram buckets)
  const goldScoreDist = buildHistogram(allContacts.map(c => c.scores.goldScore || 0), 0, 0.7, 14);
  const behScoreDist = buildHistogram(
    allContacts.map(c => c.behavioralScore || 0).filter(v => v > 0), 0, 1, 10
  );

  // All contacts for tables (full data for modal + explorer) — not limited to topN
  const allSorted = [...allContacts].sort((a, b) => (b.scores.goldScore || 0) - (a.scores.goldScore || 0));
  const tableContacts = allSorted.map(c => ({
    name: c.enrichedName || c.name || 'Unknown',
    url: c.url,
    goldScore: c.scores.goldScore || 0,
    tier: c.scores.tier || 'watch',
    icpFit: c.scores.icpFit || 0,
    networkHub: c.scores.networkHub || 0,
    relStrength: c.scores.relationshipStrength || 0,
    behavioral: c.behavioralScore || 0,
    persona: c.personaType || 'unknown',
    behPersona: c.behavioralPersona || 'unknown',
    role: c.currentRole || c.headline || '',
    company: c.currentCompany || '',
    degree: c.degree || 1,
    mutuals: c.mutualConnections || 0,
    discoveredVia: (c.discoveredVia || []).length,
    location: c.enrichedLocation || '',
    traits: c.behavioralSignals?.superConnectorTraits || [],
    clusters: clustersForContact(c.url, graph),
    referralLikelihood: c.scores?.referralLikelihood || 0,
    referralTier: c.referralTier || null,
    referralPersona: c.referralPersona || null,
  }));

  // Top 10 hubs
  const hubs = [...allContacts]
    .sort((a, b) => (b.scores.networkHub || 0) - (a.scores.networkHub || 0))
    .slice(0, 10)
    .map(c => ({
      name: c.enrichedName || c.name,
      url: c.url,
      goldScore: c.scores.goldScore || 0,
      networkHub: c.scores.networkHub || 0,
      tier: c.scores.tier,
      degree: c.degree || 1,
      mutuals: c.mutualConnections || 0,
      clusters: clustersForContact(c.url, graph),
      role: c.currentRole || c.headline || '',
      company: c.currentCompany || '',
    }));

  // Top 15 super-connectors
  const superConnectors = allContacts
    .filter(c => c.behavioralPersona === 'super-connector')
    .sort((a, b) => (b.behavioralScore || 0) - (a.behavioralScore || 0))
    .slice(0, 15)
    .map(c => ({
      name: c.enrichedName || c.name,
      url: c.url,
      behavioral: c.behavioralScore || 0,
      goldScore: c.scores.goldScore || 0,
      tier: c.scores.tier,
      degree: c.degree || 1,
      traits: c.behavioralSignals?.superConnectorTraits || [],
      role: c.currentRole || c.headline || '',
      company: c.currentCompany || '',
    }));

  // Top 10 employers by ENV
  const companies = graph.companies || {};
  const companyScores = [];
  for (const [compId, comp] of Object.entries(companies)) {
    if (comp.contacts.length < 2) continue;
    let totalBeh = 0, totalMutuals = 0, goldCount = 0;
    const clusterSet = new Set();
    for (const u of comp.contacts) {
      const c = graph.contacts[u];
      if (!c) continue;
      totalBeh += c.behavioralScore || 0;
      totalMutuals += c.mutualConnections || 0;
      if (c.scores?.tier === 'gold') goldCount++;
      for (const [clId, cl] of Object.entries(graph.clusters || {})) {
        if (cl.contacts.includes(u)) clusterSet.add(clId);
      }
    }
    const n = comp.contacts.length;
    const avgBeh = totalBeh / n;
    const avgMutuals = totalMutuals / n;
    const goldPct = goldCount / n;
    const clusterBreadth = clusterSet.size / Math.max(Object.keys(graph.clusters).length, 1);
    const env = n * 0.30 / 10 + avgBeh * 0.25 + Math.min(avgMutuals / 200, 1) * 0.20 +
      goldPct * 0.15 + clusterBreadth * 0.10;
    companyScores.push({
      name: comp.name, count: n, avgBehavioral: avgBeh,
      avgMutuals, goldCount, goldPct, env, clusters: [...clusterSet],
    });
  }
  companyScores.sort((a, b) => b.env - a.env);
  const topEmployers = companyScores.slice(0, 10);

  // Bridge connectors
  const bridges = allContacts
    .filter(c => {
      const cls = clustersForContact(c.url, graph);
      return cls.length >= 3 && (c.behavioralScore || 0) >= 0.2;
    })
    .sort((a, b) => {
      const clsA = clustersForContact(a.url, graph).length;
      const clsB = clustersForContact(b.url, graph).length;
      return clsB - clsA || (b.behavioralScore || 0) - (a.behavioralScore || 0);
    })
    .slice(0, 10)
    .map(c => ({
      name: c.enrichedName || c.name,
      behavioral: c.behavioralScore || 0,
      degree: c.degree || 1,
      clusters: clustersForContact(c.url, graph),
      role: c.currentRole || c.headline || '',
    }));

  // Silent influencers
  const silentInfluencers = allContacts
    .filter(c => c.behavioralPersona === 'silent-influencer')
    .sort((a, b) => (b.behavioralSignals?.connectionCount || 0) - (a.behavioralSignals?.connectionCount || 0))
    .slice(0, 10)
    .map(c => ({
      name: c.enrichedName || c.name,
      connections: c.behavioralSignals?.connectionCount || 0,
      behavioral: c.behavioralScore || 0,
      degree: c.degree || 1,
      role: c.currentRole || c.headline || '',
    }));

  // Rising stars
  const risingStars = allContacts
    .filter(c => c.behavioralPersona === 'rising-connector')
    .sort((a, b) => (b.behavioralScore || 0) - (a.behavioralScore || 0))
    .slice(0, 10)
    .map(c => ({
      name: c.enrichedName || c.name,
      behavioral: c.behavioralScore || 0,
      degree: c.degree || 1,
      daysAgo: c.behavioralSignals?.connectedDaysAgo,
      role: c.currentRole || c.headline || '',
    }));

  // Degree-2 discovered contacts
  const degree2Contacts = allContacts
    .filter(c => (c.degree || 1) >= 2)
    .sort((a, b) => (b.scores?.goldScore || 0) - (a.scores?.goldScore || 0))
    .map(c => {
      const introducers = (c.discoveredVia || []).map(url => {
        const intro = graph.contacts[url];
        return intro ? (intro.enrichedName || intro.name || 'Unknown') : 'Unknown';
      });
      return {
        name: c.enrichedName || c.name || 'Unknown',
        url: c.url,
        goldScore: c.scores?.goldScore || 0,
        tier: c.scores?.tier || 'watch',
        behavioral: c.behavioralScore || 0,
        degree: c.degree || 2,
        mutuals: c.mutualConnections || 0,
        discoveredVia: (c.discoveredVia || []).length,
        introducers: introducers,
        role: c.currentRole || c.headline || '',
        company: c.currentCompany || '',
      };
    });

  // Warm intro paths (top 20 gold/silver degree-2 contacts)
  const warmIntroPaths = degree2Contacts
    .filter(c => c.tier === 'gold' || c.tier === 'silver')
    .slice(0, 20)
    .map(c => ({
      name: c.name,
      url: c.url,
      tier: c.tier,
      goldScore: c.goldScore,
      introducers: c.introducers,
      bestIntroPath: c.introducers.length > 0 ? c.introducers[0] : 'None',
      role: c.role,
      company: c.company,
    }));

  // Recommendations
  const recommendations = buildRecommendations(graph, allContacts);

  // Precompute cluster 3D positions (Fibonacci sphere distribution for even spacing)
  const clusterNameList = Object.keys(clusterData).sort();
  const clusterPositions = {};
  const R = 300;
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  clusterNameList.forEach((c, i) => {
    const y = 1 - (i / Math.max(1, clusterNameList.length - 1)) * 2; // -1 to 1
    const radiusAtY = Math.sqrt(1 - y * y);
    const theta = goldenAngle * i;
    clusterPositions[c] = {
      x: Math.round(R * Math.cos(theta) * radiusAtY),
      y: Math.round(R * y),
      z: Math.round(R * Math.sin(theta) * radiusAtY),
    };
  });

  return {
    meta: {
      generated: new Date().toISOString(),
      totalContacts: allContacts.length,
      graphNodes: nodes.length,
      edgeCount: edges.length,
      totalEdges: (graph.edges || []).length,
    },
    tierCounts,
    personaCounts,
    behPersonaCounts,
    goldScoreDist,
    behScoreDist,
    clusterData,
    clusterPositions,
    clusterNames: clusterNameList,
    nodes,
    edges: edges.map(e => ({
      source: e.source,
      target: e.target,
      type: e.type,
      weight: e.weight || 0.5,
      bridge: e.isBridge || false,
    })),
    tableContacts,
    hubs,
    superConnectors,
    topEmployers,
    bridges,
    silentInfluencers,
    risingStars,
    degree2Contacts,
    warmIntroPaths,
    referralTierCounts,
    referralPersonaCounts,
    refScoreDist,
    topReferrals,
    recommendations,
  };
}

function buildHistogram(values, min, max, buckets) {
  const step = (max - min) / buckets;
  const counts = new Array(buckets).fill(0);
  const labels = [];
  for (let i = 0; i < buckets; i++) {
    const lo = min + i * step;
    labels.push(lo.toFixed(2));
    for (const v of values) {
      if (v >= lo && (i === buckets - 1 ? v <= lo + step : v < lo + step)) {
        counts[i]++;
      }
    }
  }
  return { labels, counts };
}

function buildRecommendations(graph, allContacts) {
  const recs = [];

  // Gold buyers to pursue
  const goldBuyers = allContacts
    .filter(c => c.scores?.tier === 'gold' && c.personaType === 'buyer')
    .sort((a, b) => (b.scores.goldScore || 0) - (a.scores.goldScore || 0))
    .slice(0, 5);
  if (goldBuyers.length > 0) {
    recs.push({
      category: 'Immediate Pursuit',
      icon: 'target',
      items: goldBuyers.map(c => ({
        name: c.enrichedName || c.name,
        degree: c.degree || 1,
        detail: `Gold buyer — goldScore ${c.scores.goldScore?.toFixed(2)}`,
        action: 'Schedule intro call or send personalized outreach',
      })),
    });
  }

  // Hub activation
  const hubPersonas = allContacts
    .filter(c => c.personaType === 'hub')
    .sort((a, b) => (b.scores.networkHub || 0) - (a.scores.networkHub || 0))
    .slice(0, 5);
  if (hubPersonas.length > 0) {
    recs.push({
      category: 'Hub Activation',
      icon: 'network',
      items: hubPersonas.map(c => ({
        name: c.enrichedName || c.name,
        degree: c.degree || 1,
        detail: `networkHub ${c.scores.networkHub?.toFixed(2)} — ${c.mutualConnections || 0} mutuals`,
        action: 'Request introductions to their gold-tier connections',
      })),
    });
  }

  // Quick wins (silver near gold)
  const quickWins = allContacts
    .filter(c => c.scores?.tier === 'silver')
    .filter(c => (c.scores.relationshipStrength || 0) >= 0.5 && (c.scores.icpFit || 0) >= 0.4)
    .sort((a, b) => (b.scores.goldScore || 0) - (a.scores.goldScore || 0))
    .slice(0, 5);
  if (quickWins.length > 0) {
    recs.push({
      category: 'Quick Wins (Silver Near Gold)',
      icon: 'trending',
      items: quickWins.map(c => ({
        name: c.enrichedName || c.name,
        degree: c.degree || 1,
        detail: `goldScore ${c.scores.goldScore?.toFixed(2)} — close to gold threshold`,
        action: 'Deepen engagement to push into gold tier',
      })),
    });
  }

  // Referral partnerships
  const refPartners = allContacts
    .filter(c => c.referralTier === 'gold-referral' || c.referralTier === 'silver-referral')
    .sort((a, b) => (b.scores?.referralLikelihood || 0) - (a.scores?.referralLikelihood || 0))
    .slice(0, 5);
  if (refPartners.length > 0) {
    const actionMap = {
      'white-label-partner': 'Propose white-label/reseller arrangement',
      'warm-introducer': 'Ask for warm introductions to their network',
      'co-seller': 'Set up mutual referral arrangement',
      'amplifier': 'Engage their content + propose co-marketing',
      'passive-referral': 'Deepen relationship before asking for referrals',
    };
    recs.push({
      category: 'Referral Partnerships',
      icon: 'handshake',
      items: refPartners.map(c => ({
        name: c.enrichedName || c.name,
        degree: c.degree || 1,
        detail: `${c.referralPersona} — referral ${c.scores.referralLikelihood?.toFixed(2)} (${c.referralTier})`,
        action: actionMap[c.referralPersona] || 'Build referral relationship',
      })),
    });
  }

  // Super-connectors to engage
  const scEngagement = allContacts
    .filter(c => c.behavioralPersona === 'super-connector')
    .sort((a, b) => (b.behavioralScore || 0) - (a.behavioralScore || 0))
    .slice(0, 5);
  if (scEngagement.length > 0) {
    recs.push({
      category: 'Content Amplification',
      icon: 'megaphone',
      items: scEngagement.map(c => ({
        name: c.enrichedName || c.name,
        degree: c.degree || 1,
        detail: `Super-connector — behavioral ${c.behavioralScore?.toFixed(2)}`,
        action: 'Comment on their posts to leverage their amplification power',
      })),
    });
  }

  return recs;
}

// ---------------------------------------------------------------------------
// Pipeline Data (from outreach-state.json)
// ---------------------------------------------------------------------------

function computePipelineData() {
  const OUTREACH_STATE_PATH = resolve(DATA_DIR, 'outreach-state.json');
  const ALL_STATES = [
    'planned', 'sent', 'pending_response', 'responded',
    'engaged', 'converted', 'declined', 'deferred', 'closed_lost'
  ];
  const FUNNEL_STAGES = ['planned', 'sent', 'responded', 'engaged', 'converted'];

  const states = {};
  ALL_STATES.forEach(s => { states[s] = 0; });

  let totalContacts = 0;
  let lastUpdated = null;
  let hasData = false;

  if (existsSync(OUTREACH_STATE_PATH)) {
    try {
      const raw = JSON.parse(readFileSync(OUTREACH_STATE_PATH, 'utf-8'));
      const contacts = raw.contacts || {};
      lastUpdated = raw.lastUpdated || null;

      for (const [url, entry] of Object.entries(contacts)) {
        const state = entry.currentState || entry.state || 'planned';
        if (states[state] !== undefined) {
          states[state]++;
        }
        totalContacts++;
      }
      hasData = totalContacts > 0;
    } catch (e) {
      console.warn(`  Warning: Could not parse outreach-state.json: ${e.message}`);
    }
  }

  // Funnel computation: progressive stages only
  const funnelBase = Math.max(states.planned + states.sent + states.pending_response +
    states.responded + states.engaged + states.converted, 1);
  const funnel = FUNNEL_STAGES.map(stage => {
    // Count contacts at this stage or beyond
    const idx = FUNNEL_STAGES.indexOf(stage);
    let count = 0;
    for (let i = idx; i < FUNNEL_STAGES.length; i++) {
      count += states[FUNNEL_STAGES[i]];
    }
    // For 'sent', also include pending_response since it's between sent and responded
    if (stage === 'sent') count += states.pending_response;
    // For 'planned', the base is everyone in the forward funnel
    if (stage === 'planned') count = funnelBase;
    return {
      stage: stage.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
      key: stage,
      count,
      pct: parseFloat((count / funnelBase * 100).toFixed(1)),
    };
  });

  // Conversion rates between adjacent funnel stages
  const conversionRates = {};
  for (let i = 0; i < funnel.length - 1; i++) {
    const from = funnel[i];
    const to = funnel[i + 1];
    const key = `${from.key}_to_${to.key}`;
    conversionRates[key] = from.count > 0
      ? parseFloat((to.count / from.count * 100).toFixed(1))
      : 0;
  }

  // Active outreach = all minus terminal states
  const terminalStates = ['converted', 'declined', 'closed_lost'];
  const activeOutreach = totalContacts - terminalStates.reduce((s, st) => s + states[st], 0);

  return {
    states,
    funnel,
    conversionRates,
    totalContacts,
    activeOutreach,
    lastUpdated: lastUpdated || new Date().toISOString().split('T')[0],
    hasData,
  };
}

// ---------------------------------------------------------------------------
// Vector Intelligence (requires ruvector + built store)
// ---------------------------------------------------------------------------

async function computeVectorData(graph) {
  if (!isRvfAvailable()) return { available: false };

  const size = await storeLength();
  if (size === 0) return { available: false, reason: 'empty' };

  const result = {
    available: true,
    storeSize: size,
    goldNeighbors: [],
    hubReach: [],
    hiddenGems: [],
  };

  const allContacts = Object.entries(graph.contacts)
    .map(([url, c]) => ({ url, ...c }))
    .filter(c => c.scores);

  function normalizeUrl(u) { return u.replace(/\/$/, '').split('?')[0]; }

  // Gold contact similarity neighborhoods (top 10)
  const goldContacts = [...allContacts]
    .filter(c => c.scores?.tier === 'gold')
    .sort((a, b) => (b.scores.goldScore || 0) - (a.scores.goldScore || 0))
    .slice(0, 10);

  for (const gc of goldContacts) {
    const nUrl = normalizeUrl(gc.url);
    const stored = await getContact(nUrl);
    if (!stored) continue;
    const results = await queryStore(stored.vector, 6);
    if (!results) continue;
    const neighbors = results
      .filter(r => r.id !== nUrl)
      .slice(0, 5)
      .map(r => ({
        name: r.metadata?.name || 'Unknown',
        url: r.id,
        tier: r.metadata?.tier || 'watch',
        similarity: Math.max(0, 1 - (r.score || 0)),  // cosine distance → similarity
        role: r.metadata?.currentRole || r.metadata?.headline || '',
        company: r.metadata?.currentCompany || '',
        goldScore: r.metadata?.goldScore || 0,
      }));
    result.goldNeighbors.push({
      name: gc.enrichedName || gc.name,
      url: gc.url,
      goldScore: gc.scores.goldScore,
      role: gc.currentRole || gc.headline || '',
      company: gc.currentCompany || '',
      neighbors,
    });
  }

  // Hub semantic reach (top 10 hubs)
  const hubs = [...allContacts]
    .sort((a, b) => (b.scores.networkHub || 0) - (a.scores.networkHub || 0))
    .slice(0, 10);

  for (const hub of hubs) {
    const nUrl = normalizeUrl(hub.url);
    const stored = await getContact(nUrl);
    if (!stored) continue;
    const results = await queryStore(stored.vector, 11);
    if (!results) continue;
    const neighbors = results
      .filter(r => r.id !== nUrl)
      .slice(0, 10)
      .map(r => ({
        name: r.metadata?.name || 'Unknown',
        url: r.id,
        tier: r.metadata?.tier || 'watch',
        similarity: Math.max(0, 1 - (r.score || 0)),  // cosine distance → similarity
        goldScore: r.metadata?.goldScore || 0,
      }));
    const tierSet = new Set(neighbors.map(n => n.tier));
    result.hubReach.push({
      name: hub.enrichedName || hub.name,
      url: hub.url,
      hubScore: hub.scores.networkHub || 0,
      goldScore: hub.scores.goldScore || 0,
      semanticDiversity: tierSet.size,
      avgSimilarity: neighbors.length > 0
        ? neighbors.reduce((s, n) => s + n.similarity, 0) / neighbors.length : 0,
      neighbors,
    });
  }

  // Hidden gems: bronze/watch contacts similar to gold contacts
  const gemCandidates = new Map();
  for (const gn of result.goldNeighbors) {
    for (const n of gn.neighbors) {
      if (n.tier === 'gold' || n.tier === 'silver') continue;
      const existing = gemCandidates.get(n.url);
      if (!existing || n.similarity > existing.similarity) {
        gemCandidates.set(n.url, { ...n, similarTo: gn.name, similarToScore: gn.goldScore });
      }
    }
  }
  result.hiddenGems = [...gemCandidates.values()]
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, 15);

  await closeStore();
  return result;
}

// ---------------------------------------------------------------------------
// HTML helpers (server-side — these generate HTML strings during report build)
// ---------------------------------------------------------------------------

function esc(s) { return s ? String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;') : ''; }

function degreeBadge(degree) {
  const d = degree || 1;
  if (d === 1) return '<span class="degree-badge d1">1st</span>';
  if (d === 2) return '<span class="degree-badge d2">2nd</span>';
  return '<span class="degree-badge d3">3rd+</span>';
}

function clickableName(name, contactData) {
  const safeData = {};
  const keys = ['name','url','tier','degree','goldScore','icpFit','networkHub','relStrength',
    'behavioral','mutuals','discoveredVia','persona','behPersona','role','company','location',
    'clusters','traits','referralTier','referralPersona','referralLikelihood','similarity'];
  for (const k of keys) { if (contactData[k] !== undefined) safeData[k] = contactData[k]; }
  const encoded = encodeURIComponent(JSON.stringify(safeData));
  return '<span class="clickable-name" onclick="showContactModal(this)" data-contact="' + encoded + '">' + esc(name) + '</span>';
}

// ---------------------------------------------------------------------------
// HTML generation
// ---------------------------------------------------------------------------

function generateHTML(data) {
  const dataJSON = JSON.stringify(data);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Network Intelligence Report</title>
<script src="https://unpkg.com/three@0.160.0/build/three.min.js"><\/script>
<script src="https://unpkg.com/3d-force-graph@1.73.3/dist/3d-force-graph.min.js"><\/script>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"><\/script>
<style>
:root {
  --bg: #0f1117;
  --surface: #1a1d27;
  --surface2: #232633;
  --border: #2d3148;
  --text: #e1e4ed;
  --text-dim: #8b8fa3;
  --gold: #FFD700;
  --silver: #C0C0C0;
  --bronze: #CD7F32;
  --watch: #666;
  --accent: #6366f1;
  --accent2: #818cf8;
  --green: #22c55e;
  --blue: #3b82f6;
  --red: #ef4444;
}
* { margin: 0; padding: 0; box-sizing: border-box; }
body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  background: var(--bg);
  color: var(--text);
  line-height: 1.6;
}
a { color: var(--accent2); text-decoration: none; }
a:hover { text-decoration: underline; }

/* Layout */
.sidebar {
  position: fixed;
  top: 0; left: 0;
  width: 220px;
  height: 100vh;
  background: var(--surface);
  border-right: 1px solid var(--border);
  padding: 20px 0;
  overflow-y: auto;
  z-index: 100;
}
.sidebar h2 {
  font-size: 14px;
  color: var(--accent2);
  padding: 0 16px;
  margin-bottom: 16px;
  letter-spacing: 0.5px;
}
.sidebar a {
  display: block;
  padding: 8px 16px;
  font-size: 13px;
  color: var(--text-dim);
  transition: all 0.2s;
}
.sidebar a:hover, .sidebar a.active {
  color: var(--text);
  background: var(--surface2);
  text-decoration: none;
}
.cluster-link { display: block; padding: 6px 16px; font-size: 12px; color: var(--text-dim); cursor: pointer; transition: all 0.2s; }
.cluster-link:hover { color: var(--text); background: var(--surface2); }
.cluster-link.active { color: var(--accent2); background: var(--surface2); }
.main {
  margin-left: 220px;
  padding: 32px 40px;
  max-width: 1400px;
}

/* Header */
.header {
  margin-bottom: 40px;
  padding-bottom: 24px;
  border-bottom: 1px solid var(--border);
}
.header h1 {
  font-size: 28px;
  font-weight: 700;
  margin-bottom: 8px;
}
.header .subtitle {
  color: var(--text-dim);
  font-size: 14px;
}
.stat-cards {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 16px;
  margin-top: 20px;
}
.stat-card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 16px;
  text-align: center;
}
.stat-card .value {
  font-size: 28px;
  font-weight: 700;
}
.stat-card .label {
  font-size: 12px;
  color: var(--text-dim);
  margin-top: 4px;
}
.stat-card.gold .value { color: var(--gold); }
.stat-card.silver .value { color: var(--silver); }
.stat-card.bronze .value { color: var(--bronze); }
.stat-card.accent .value { color: var(--accent2); }

/* Sections */
.section {
  margin-bottom: 48px;
}
.section h2 {
  font-size: 22px;
  font-weight: 600;
  margin-bottom: 16px;
  padding-bottom: 8px;
  border-bottom: 2px solid var(--accent);
  display: inline-block;
}
.section h3 {
  font-size: 16px;
  font-weight: 600;
  margin: 20px 0 10px;
  color: var(--accent2);
}

/* 3D Graph */
#graph-container {
  width: 100%;
  height: 700px;
  background: var(--surface);
  border-radius: 12px;
  border: 1px solid var(--border);
  position: relative;
  overflow: hidden;
}
.graph-controls {
  display: flex;
  gap: 12px;
  margin-bottom: 12px;
  flex-wrap: wrap;
  align-items: center;
}
.graph-controls label {
  font-size: 13px;
  color: var(--text-dim);
  display: flex;
  align-items: center;
  gap: 4px;
  cursor: pointer;
}
.graph-controls select {
  background: var(--surface2);
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 4px 8px;
  font-size: 13px;
}
.graph-controls input[type="checkbox"] {
  accent-color: var(--accent);
}
.node-info {
  position: absolute;
  top: 12px;
  right: 12px;
  background: rgba(15, 17, 23, 0.95);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 16px;
  max-width: 320px;
  font-size: 13px;
  display: none;
  z-index: 10;
}
.node-info h4 { font-size: 15px; margin-bottom: 8px; }
.node-info .score-row {
  display: flex;
  justify-content: space-between;
  padding: 3px 0;
  border-bottom: 1px solid var(--border);
}
.node-info .close-btn {
  position: absolute;
  top: 8px;
  right: 12px;
  cursor: pointer;
  color: var(--text-dim);
  font-size: 16px;
}

/* Charts */
.chart-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(400px, 1fr));
  gap: 24px;
}
.chart-card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 20px;
}
.chart-card h3 {
  font-size: 14px;
  color: var(--text-dim);
  margin: 0 0 12px;
}
.chart-card canvas {
  max-height: 280px;
}

/* Tables */
.data-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}
.data-table th {
  text-align: left;
  padding: 10px 12px;
  background: var(--surface2);
  color: var(--text-dim);
  font-weight: 600;
  cursor: pointer;
  user-select: none;
  white-space: nowrap;
  border-bottom: 2px solid var(--border);
}
.data-table th:hover { color: var(--text); }
.data-table th .sort-arrow { margin-left: 4px; font-size: 10px; }
.data-table td {
  padding: 8px 12px;
  border-bottom: 1px solid var(--border);
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.data-table tr:hover { background: var(--surface2); }
.tier-badge {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 12px;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
}
.tier-badge.gold { background: rgba(255,215,0,0.2); color: var(--gold); }
.tier-badge.silver { background: rgba(192,192,192,0.2); color: var(--silver); }
.tier-badge.bronze { background: rgba(205,127,50,0.2); color: var(--bronze); }
.tier-badge.watch { background: rgba(102,102,102,0.2); color: var(--watch); }

/* Info cards */
.info-list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(350px, 1fr));
  gap: 16px;
}
.info-card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 16px;
}
.info-card .card-name {
  font-weight: 600;
  font-size: 15px;
  margin-bottom: 4px;
}
.info-card .card-role {
  color: var(--text-dim);
  font-size: 13px;
  margin-bottom: 8px;
}
.info-card .card-stats {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
  font-size: 12px;
}
.info-card .card-stats span {
  background: var(--surface2);
  padding: 2px 8px;
  border-radius: 4px;
}

/* Recommendations */
.rec-category {
  margin-bottom: 24px;
}
.rec-category h3 {
  font-size: 16px;
  margin-bottom: 12px;
}
.rec-item {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 12px 16px;
  margin-bottom: 8px;
}
.rec-item .rec-name { font-weight: 600; }
.rec-item .rec-detail { color: var(--text-dim); font-size: 13px; margin: 4px 0; }
.rec-item .rec-action {
  font-size: 13px;
  color: var(--green);
}

/* Tabs */
.tab-bar { display: flex; gap: 0; border-bottom: 2px solid var(--border); margin-bottom: 20px; overflow-x: auto; }
.tab-btn { padding: 10px 20px; background: none; border: none; color: var(--text-dim); font-size: 14px; cursor: pointer; border-bottom: 2px solid transparent; margin-bottom: -2px; transition: all 0.2s; white-space: nowrap; font-family: inherit; }
.tab-btn:hover { color: var(--text); }
.tab-btn.active { color: var(--accent2); border-bottom-color: var(--accent); }
.tab-panel { display: none; }
.tab-panel.active { display: block; }

/* Modal */
.modal-overlay { position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.75); z-index: 1000; display: none; align-items: center; justify-content: center; }
.modal-overlay.show { display: flex; }
.modal-content { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 32px; max-width: 560px; width: 90%; max-height: 85vh; overflow-y: auto; position: relative; }
.modal-close { position: absolute; top: 12px; right: 16px; font-size: 24px; cursor: pointer; color: var(--text-dim); background: none; border: none; line-height: 1; font-family: inherit; }
.modal-close:hover { color: var(--text); }
.modal-name { font-size: 22px; font-weight: 700; margin-bottom: 4px; padding-right: 40px; }
.modal-role { color: var(--text-dim); font-size: 14px; margin-bottom: 16px; }
.modal-scores { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 16px; }
.modal-score-item { display: flex; justify-content: space-between; padding: 6px 10px; background: var(--surface2); border-radius: 6px; font-size: 13px; }
.modal-score-item .ms-label { color: var(--text-dim); }
.modal-score-item .ms-value { font-weight: 600; }
.modal-tags { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 16px; }
.modal-linkedin { display: inline-flex; align-items: center; gap: 8px; padding: 10px 20px; background: #0077B5; color: white; border-radius: 8px; font-size: 14px; font-weight: 600; text-decoration: none; margin-top: 8px; transition: background 0.2s; }
.modal-linkedin:hover { background: #005f8d; text-decoration: none; color: white; }
.table-search { background: var(--surface2); border: 1px solid var(--border); color: var(--text); padding: 8px 12px; border-radius: 6px; font-size: 14px; width: 300px; margin-bottom: 12px; }
.table-search::placeholder { color: var(--text-dim); }
.table-count { color: var(--text-dim); font-size: 13px; margin-left: 12px; }
.clickable-row { cursor: pointer; }
.clickable-row:hover td { background: var(--surface2); }

/* Degree badges */
.degree-badge { display: inline-block; padding: 1px 6px; border-radius: 10px; font-size: 10px; font-weight: 600; margin-left: 4px; vertical-align: middle; }
.degree-badge.d1 { background: rgba(34,197,94,0.2); color: #22c55e; }
.degree-badge.d2 { background: rgba(59,130,246,0.2); color: #3b82f6; }
.degree-badge.d3 { background: rgba(245,158,11,0.2); color: #f59e0b; }

/* Contact detail modal */
.contact-modal-overlay { position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.7); z-index: 1000; display: none; align-items: center; justify-content: center; }
.contact-modal-overlay.active { display: flex; }
.contact-modal { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 0; max-width: 600px; width: 90%; max-height: 85vh; overflow-y: auto; box-shadow: 0 20px 60px rgba(0,0,0,0.5); }
.contact-modal-header { display: flex; justify-content: space-between; align-items: flex-start; padding: 24px 24px 16px; border-bottom: 1px solid var(--border); }
.contact-modal-header h3 { font-size: 20px; font-weight: 700; }
.contact-modal-close { background: none; border: none; color: var(--text-dim); font-size: 24px; cursor: pointer; padding: 0 4px; line-height: 1; }
.contact-modal-close:hover { color: var(--text); }
.contact-modal-body { padding: 20px 24px 24px; }
.contact-modal-row { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid var(--border); font-size: 13px; }
.contact-modal-row:last-child { border-bottom: none; }
.contact-modal-row .label { color: var(--text-dim); }
.contact-modal-row .value { font-weight: 600; text-align: right; max-width: 60%; }
.contact-modal-badges { display: flex; gap: 8px; flex-wrap: wrap; margin: 12px 0; }
.contact-modal-section { margin-top: 16px; padding-top: 12px; border-top: 1px solid var(--border); }
.contact-modal-section h4 { font-size: 14px; color: var(--accent2); margin-bottom: 8px; }
.contact-modal-linkedin { display: inline-block; margin-top: 16px; padding: 8px 20px; background: var(--accent); color: white; border-radius: 6px; font-weight: 600; font-size: 14px; text-decoration: none; }
.contact-modal-linkedin:hover { background: var(--accent2); text-decoration: none; }
.clickable-name { cursor: pointer; border-bottom: 1px dashed rgba(129,140,248,0.3); }
.clickable-name:hover { color: var(--accent2); border-bottom-color: var(--accent2); }
.export-btn { padding: 6px 12px; background: var(--accent); color: white; border: none; border-radius: 4px; font-size: 12px; font-weight: 600; cursor: pointer; margin-bottom: 8px; font-family: inherit; }
.export-btn:hover { background: var(--accent2); }

/* Top navigation */
.top-nav { position: fixed; top: 0; left: 220px; right: 0; height: 48px; background: var(--surface); border-bottom: 1px solid var(--border); display: flex; align-items: center; padding: 0 24px; gap: 16px; z-index: 99; }
.top-nav a { padding: 8px 16px; border-radius: 6px; font-size: 14px; font-weight: 600; color: var(--text-dim); transition: all 0.2s; }
.top-nav a:hover { background: var(--surface2); color: var(--text); text-decoration: none; }
.top-nav a.active { background: var(--accent); color: white; }
.main { padding-top: 80px; }

/* Print */
@media print {
  .sidebar { display: none; }
  .main { margin-left: 0; }
  #graph-container { display: none; }
  .graph-controls { display: none; }
  .modal-overlay { display: none !important; }
  .contact-modal-overlay { display: none !important; }
  body { background: #fff; color: #000; }
  .section h2 { border-color: #000; }
}
</style>
</head>
<body>

<!-- Contact Detail Modal -->
<div class="contact-modal-overlay" id="contact-modal-overlay" onclick="if(event.target===this)closeContactModal()">
  <div class="contact-modal">
    <div class="contact-modal-header" id="contact-modal-header"></div>
    <div class="contact-modal-body" id="contact-modal-body"></div>
  </div>
</div>

<!-- Modal Overlay -->
<div class="modal-overlay" id="modal-overlay">
  <div class="modal-content">
    <button class="modal-close" id="modal-close">&times;</button>
    <div id="modal-name" class="modal-name"></div>
    <div id="modal-role" class="modal-role"></div>
    <div id="modal-tier" style="margin-bottom:16px;"></div>
    <div id="modal-scores" class="modal-scores"></div>
    <div id="modal-tags" class="modal-tags"></div>
    <div id="modal-extra" style="font-size:13px;color:var(--text-dim);margin-bottom:16px;"></div>
    <a id="modal-linkedin" class="modal-linkedin" href="#" target="_blank" rel="noopener">View on LinkedIn &rarr;</a>
  </div>
</div>

<!-- Top Navigation -->
<nav class="top-nav">
  <a href="network-report.html" class="active">Network Report</a>
  <a href="icp-niche-report.html">ICP Niche Report</a>
</nav>

<!-- Sidebar Navigation -->
<nav class="sidebar">
  <h2>NETWORK INTEL</h2>
  <a href="#header">Overview</a>
  <a href="#graph">3D Network Graph</a>
  <a href="#distributions">Score Distributions</a>
  <a href="#vector-intel" id="nav-vector" style="display:none">Vector Intelligence</a>
  <a href="#contacts">Top Contacts</a>
  <a href="#hubs">Network Hubs</a>
  <a href="#super-connectors">Super-Connectors</a>
  <a href="#warm-intros">Warm Intro Paths</a>
  <a href="#referral-partners">Referral Partners</a>
  <a href="#employers">Company Beachheads</a>
  <a href="#visibility">Visibility Strategy</a>
  <a href="#data-explorer">Data Explorer</a>
  <a href="#recommendations">Recommended Actions</a>
  <a href="#pipeline">Pipeline Dashboard</a>
  <h2 style="margin-top:24px;">CLUSTERS</h2>
  <div id="cluster-filter-links"></div>
</nav>

<div class="main">

<!-- Data Injection -->
<script>const DATA = ${dataJSON};<\/script>

<!-- Header -->
<div class="header" id="header">
  <h1>Network Intelligence Report</h1>
  <p class="subtitle">Generated <span id="gen-date"></span> &middot; <span id="contact-count"></span> contacts &middot; <span id="edge-count"></span> edges</p>
  <div class="stat-cards" id="stat-cards"></div>
</div>

<!-- Section 1: 3D Graph -->
<div class="section" id="graph">
  <h2>Interactive Network Graph</h2>
  <div class="graph-controls">
    <label><input type="checkbox" id="f-gold" checked> <span class="tier-badge gold">Gold</span></label>
    <label><input type="checkbox" id="f-silver" checked> <span class="tier-badge silver">Silver</span></label>
    <label><input type="checkbox" id="f-bronze" checked> <span class="tier-badge bronze">Bronze</span></label>
    <label><input type="checkbox" id="f-watch" checked> <span class="tier-badge watch">Watch</span></label>
    <select id="f-cluster"><option value="">All Clusters</option></select>
    <select id="f-persona"><option value="">All Personas</option></select>
    <select id="color-by" style="margin-left:16px;">
      <option value="cluster">Color by Cluster</option>
      <option value="tier">Color by Tier</option>
      <option value="persona">Color by Persona</option>
      <option value="degree">Color by Degree</option>
    </select>
    <div class="edge-filters" style="display:flex;gap:12px;margin-left:16px;flex-wrap:wrap;">
      <label><input type="checkbox" id="edge-company" checked> Same Company</label>
      <label><input type="checkbox" id="edge-cluster" checked> Same Cluster</label>
      <label><input type="checkbox" id="edge-mutual" checked> Mutual Proximity</label>
      <label><input type="checkbox" id="edge-discovered" checked> Discovered</label>
      <label><input type="checkbox" id="edge-bridges" checked> Bridges</label>
    </div>
    <div style="display:flex;gap:12px;margin-left:16px;align-items:center;flex-wrap:wrap;">
      <label><input type="checkbox" id="degree-1" checked> 1st Degree</label>
      <label><input type="checkbox" id="degree-2" checked> 2nd Degree</label>
      <label style="margin-left:16px;">Cluster Spacing: <input type="range" id="cluster-spacing" min="0" max="100" value="60" style="width:100px;vertical-align:middle;"></label>
      <label>Edge Weight: <input type="range" id="weight-threshold" min="0" max="100" value="0" style="width:100px;vertical-align:middle;"> <span id="weight-label">0%</span></label>
    </div>
  </div>
  <div id="graph-container"></div>
</div>

<!-- Section 2: Distributions -->
<div class="section" id="distributions">
  <h2>Score Distributions</h2>
  <div class="chart-grid">
    <div class="chart-card"><h3>Gold Score Distribution</h3><canvas id="chart-gold"></canvas></div>
    <div class="chart-card"><h3>Behavioral Score Distribution</h3><canvas id="chart-beh"></canvas></div>
    <div class="chart-card"><h3>Tier Breakdown</h3><canvas id="chart-tier"></canvas></div>
    <div class="chart-card"><h3>Behavioral Persona Breakdown</h3><canvas id="chart-persona"></canvas></div>
  </div>
</div>

<!-- Section: Vector Intelligence -->
<div class="section" id="vector-intel" style="display:none;">
  <h2>Vector Intelligence</h2>
  <p style="color:var(--text-dim);margin-bottom:16px;">Semantic insights powered by 384-dim ONNX embeddings — discovering connections invisible to keyword matching.</p>
  <div class="stat-cards" id="vector-stat-cards"></div>

  <h3>Similar to Your Gold Contacts</h3>
  <p style="color:var(--text-dim);margin-bottom:16px;">Each gold contact's semantic nearest neighbors — people whose profiles are most similar in meaning.</p>
  <div id="gold-neighbors-list" class="info-list" style="grid-template-columns:1fr;"></div>

  <h3 style="margin-top:32px;">Hidden Gems</h3>
  <p style="color:var(--text-dim);margin-bottom:16px;">Bronze/watch contacts with high semantic similarity to your gold contacts — potential undiscovered prospects worth investigating.</p>
  <button class="export-btn" onclick="exportTableToCSV('gems-table', 'hidden-gems.csv')">Export CSV</button>
  <div style="overflow-x:auto;">
    <table class="data-table" id="gems-table">
      <thead><tr>
        <th>Name</th><th>Similarity</th><th>Similar To</th><th>Current Tier</th><th>Gold Score</th><th>Role</th><th>Company</th>
      </tr></thead>
      <tbody id="gems-tbody"></tbody>
    </table>
  </div>

  <h3 style="margin-top:32px;">Hub Semantic Reach</h3>
  <p style="color:var(--text-dim);margin-bottom:16px;">How far each hub's influence extends across semantic space — broader diversity means wider introductions.</p>
  <div id="hub-reach-list" class="info-list" style="grid-template-columns:1fr;"></div>
</div>

<!-- Section 3: Top Contacts Table -->
<div class="section" id="contacts">
  <h2>Top Contacts</h2>
  <button class="export-btn" onclick="exportTableToCSV('contacts-table', 'top-contacts.csv')">Export CSV</button>
  <div style="overflow-x:auto;">
    <table class="data-table" id="contacts-table">
      <thead>
        <tr>
          <th data-key="name">Name <span class="sort-arrow"></span></th>
          <th data-key="goldScore">Gold Score <span class="sort-arrow"></span></th>
          <th data-key="tier">Tier <span class="sort-arrow"></span></th>
          <th data-key="icpFit">ICP Fit <span class="sort-arrow"></span></th>
          <th data-key="networkHub">Network Hub <span class="sort-arrow"></span></th>
          <th data-key="behavioral">Behavioral <span class="sort-arrow"></span></th>
          <th data-key="persona">Persona <span class="sort-arrow"></span></th>
          <th data-key="role">Role <span class="sort-arrow"></span></th>
          <th data-key="company">Company <span class="sort-arrow"></span></th>
        </tr>
      </thead>
      <tbody id="contacts-tbody"></tbody>
    </table>
  </div>
</div>

<!-- Section 4: Hubs -->
<div class="section" id="hubs">
  <h2>Network Hubs</h2>
  <p style="color:var(--text-dim);margin-bottom:16px;">Top 10 contacts by network centrality — key connectors who bridge multiple communities.</p>
  <button class="export-btn" onclick="exportTableToCSV('hubs-explorer-table', 'network-hubs.csv')">Export CSV</button>
  <div class="info-list" id="hubs-list"></div>
  <table class="data-table" id="hubs-explorer-table" style="display:none;"><thead><tr>
    <th>Name</th><th>Hub Score</th><th>Gold Score</th><th>Tier</th><th>Mutuals</th><th>Role</th><th>Company</th><th>Clusters</th>
  </tr></thead><tbody id="hubs-export-tbody"></tbody></table>
</div>

<!-- Section 5: Super-Connectors -->
<div class="section" id="super-connectors">
  <h2>Super-Connectors</h2>
  <p style="color:var(--text-dim);margin-bottom:16px;">Top behavioral super-connectors — engage their content to amplify your visibility.</p>
  <div class="info-list" id="sc-list"></div>
</div>

<!-- Section: Warm Introduction Paths -->
<div class="section" id="warm-intros">
  <h2>Warm Introduction Paths</h2>
  <p style="color:var(--text-dim);margin-bottom:16px;">Gold and silver degree-2 contacts reachable through your 1st-degree connections. These are your best warm intro opportunities.</p>
  <button class="export-btn" onclick="exportTableToCSV('warm-intros-table', 'warm-intro-paths.csv')">Export CSV</button>
  <div style="overflow-x:auto;">
    <table class="data-table" id="warm-intros-table">
      <thead><tr>
        <th>Contact</th>
        <th>Tier</th>
        <th>Gold Score</th>
        <th>Introducers</th>
        <th>Best Intro Path</th>
        <th>Role</th>
        <th>Company</th>
      </tr></thead>
      <tbody id="warm-intros-tbody"></tbody>
    </table>
  </div>
</div>

<!-- Section 6: Referral Partners -->
<div class="section" id="referral-partners">
  <h2>Referral Partners</h2>
  <p style="color:var(--text-dim);margin-bottom:16px;">Contacts most likely to refer business — agency owners, consultants, and ecosystem partners.</p>
  <div class="stat-cards" id="referral-stat-cards"></div>
  <div class="chart-grid" style="margin:24px 0;">
    <div class="chart-card"><h3>Referral Score Distribution</h3><canvas id="chart-ref-score"></canvas></div>
    <div class="chart-card"><h3>Referral Persona Breakdown</h3><canvas id="chart-ref-persona"></canvas></div>
  </div>
  <h3>Top 20 Referral Partners</h3>
  <button class="export-btn" onclick="exportTableToCSV('referral-table', 'referral-partners.csv')">Export CSV</button>
  <div style="overflow-x:auto;">
    <table class="data-table" id="referral-table">
      <thead>
        <tr>
          <th>Name</th>
          <th>Referral Score</th>
          <th>Ref Tier</th>
          <th>Persona</th>
          <th>Role</th>
          <th>Overlap</th>
          <th>Reach</th>
          <th>Amp</th>
          <th>Warmth</th>
          <th>ICP Tier</th>
        </tr>
      </thead>
      <tbody id="referral-tbody"></tbody>
    </table>
  </div>
</div>

<!-- Section 7: Company Beachheads -->
<div class="section" id="employers">
  <h2>Company Beachheads</h2>
  <p style="color:var(--text-dim);margin-bottom:16px;">Top employers by Employer Network Value (ENV) — companies with highest contact density and gold coverage.</p>
  <button class="export-btn" onclick="exportTableToCSV('employers-table', 'company-beachheads.csv')">Export CSV</button>
  <div style="overflow-x:auto;">
    <table class="data-table" id="employers-table">
      <thead>
        <tr>
          <th>Company</th>
          <th>ENV</th>
          <th>Contacts</th>
          <th>Gold</th>
          <th>Gold %</th>
          <th>Avg Behavioral</th>
          <th>Avg Mutuals</th>
          <th>Clusters</th>
        </tr>
      </thead>
      <tbody id="employers-tbody"></tbody>
    </table>
  </div>
</div>

<!-- Section 7: Visibility Strategy -->
<div class="section" id="visibility">
  <h2>Visibility Strategy</h2>
  <div class="chart-grid" style="margin-bottom:24px;">
    <div class="chart-card"><h3>Cluster Amplifiers</h3><canvas id="chart-amplifiers"></canvas></div>
  </div>
  <h3>Bridge Connectors</h3>
  <p style="color:var(--text-dim);margin-bottom:12px;">Contacts spanning 3+ clusters who amplify across communities.</p>
  <div class="info-list" id="bridges-list"></div>
  <h3>Silent Influencers to Activate</h3>
  <p style="color:var(--text-dim);margin-bottom:12px;">High-connection contacts with low engagement — tag them, engage their rare posts.</p>
  <div class="info-list" id="silent-list"></div>
  <h3>Rising Stars</h3>
  <p style="color:var(--text-dim);margin-bottom:12px;">Recently connected with high engagement potential.</p>
  <div class="info-list" id="rising-list"></div>
</div>

<!-- Section 8: Data Explorer -->
<div class="section" id="data-explorer">
  <h2>Data Explorer</h2>
  <div class="tab-bar" id="explorer-tabs">
    <button class="tab-btn active" data-tab="tab-all">All Contacts</button>
    <button class="tab-btn" data-tab="tab-hubs">Hubs</button>
    <button class="tab-btn" data-tab="tab-sc">Super-Connectors</button>
    <button class="tab-btn" data-tab="tab-companies">Companies</button>
    <button class="tab-btn" data-tab="tab-referrals">Referrals</button>
    <button class="tab-btn" data-tab="tab-deg2">Degree-2 Network</button>
  </div>
  <div class="tab-panel active" id="tab-all">
    <input class="table-search" id="search-all" placeholder="Search by name, role, or company..."><span class="table-count" id="count-all"></span>
    <button class="export-btn" onclick="exportTableToCSV('table-all', 'all-contacts.csv')">Export CSV</button>
    <div style="overflow-x:auto;">
      <table class="data-table" id="table-all"><thead><tr>
        <th data-sort="name">Name</th><th data-sort="goldScore">Gold</th><th data-sort="tier">Tier</th>
        <th data-sort="icpFit">ICP</th><th data-sort="networkHub">Hub</th><th data-sort="behavioral">Behav</th>
        <th data-sort="degree">Deg</th><th data-sort="persona">Persona</th><th data-sort="role">Role</th><th data-sort="company">Company</th>
      </tr></thead><tbody></tbody></table>
    </div>
  </div>
  <div class="tab-panel" id="tab-hubs">
    <button class="export-btn" onclick="exportTableToCSV('table-hubs', 'hubs-explorer.csv')">Export CSV</button>
    <div style="overflow-x:auto;">
      <table class="data-table" id="table-hubs"><thead><tr>
        <th>Name</th><th>Hub Score</th><th>Gold Score</th><th>Tier</th><th>Mutuals</th><th>Role</th><th>Company</th><th>Clusters</th>
      </tr></thead><tbody id="tbody-hubs"></tbody></table>
    </div>
  </div>
  <div class="tab-panel" id="tab-sc">
    <button class="export-btn" onclick="exportTableToCSV('table-sc', 'super-connectors-explorer.csv')">Export CSV</button>
    <div style="overflow-x:auto;">
      <table class="data-table" id="table-sc"><thead><tr>
        <th>Name</th><th>Behavioral</th><th>Gold Score</th><th>Tier</th><th>Traits</th><th>Role</th><th>Company</th>
      </tr></thead><tbody id="tbody-sc"></tbody></table>
    </div>
  </div>
  <div class="tab-panel" id="tab-companies">
    <button class="export-btn" onclick="exportTableToCSV('table-companies', 'companies-explorer.csv')">Export CSV</button>
    <div style="overflow-x:auto;">
      <table class="data-table" id="table-companies"><thead><tr>
        <th>Company</th><th>ENV</th><th>Contacts</th><th>Gold</th><th>Gold %</th><th>Avg Behavioral</th><th>Avg Mutuals</th>
      </tr></thead><tbody id="tbody-companies"></tbody></table>
    </div>
  </div>
  <div class="tab-panel" id="tab-referrals">
    <button class="export-btn" onclick="exportTableToCSV('table-referrals', 'referrals-explorer.csv')">Export CSV</button>
    <div style="overflow-x:auto;">
      <table class="data-table" id="table-referrals"><thead><tr>
        <th>Name</th><th>Referral Score</th><th>Ref Tier</th><th>Persona</th><th>Gold Score</th><th>ICP Tier</th><th>Role</th><th>Company</th>
      </tr></thead><tbody id="tbody-referrals"></tbody></table>
    </div>
  </div>
  <div class="tab-panel" id="tab-deg2">
    <p style="color:var(--text-dim);margin-bottom:12px;">Contacts discovered via deep-scan of your 1st-degree network. These are reachable through warm introductions.</p>
    <button class="export-btn" onclick="exportTableToCSV('table-deg2', 'degree-2-contacts.csv')">Export CSV</button>
    <div style="overflow-x:auto;">
      <table class="data-table" id="table-deg2"><thead><tr>
        <th>Name</th><th>Gold Score</th><th>Tier</th><th>Behavioral</th><th>Degree</th><th>Intro Paths</th><th>Mutuals</th><th>Role</th><th>Company</th>
      </tr></thead><tbody id="tbody-deg2"></tbody></table>
    </div>
  </div>
</div>

<!-- Section 9: Recommendations -->
<div class="section" id="recommendations">
  <h2>Recommended Actions</h2>
  <div id="recs-list"></div>
</div>

<!-- Section 10: Pipeline Dashboard -->
<div class="section" id="pipeline">
  <h2>Pipeline Dashboard</h2>
  <div id="pipeline-content"></div>
</div>

</div><!-- .main -->

<script>
(function() {
  // ---------------------------------------------------------------------------
  // Utility & Modal helpers (must be defined before renderTable/renderExplorerTable)
  // ---------------------------------------------------------------------------
  function esc(s) {
    if (!s) return '';
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  window.degreeBadge = function(degree) {
    var d = degree || 1;
    if (d === 1) return '<span class="degree-badge d1">1st</span>';
    if (d === 2) return '<span class="degree-badge d2">2nd</span>';
    return '<span class="degree-badge d3">3rd+</span>';
  };

  window.clickableName = function(name, contactData) {
    var dataAttr = encodeURIComponent(JSON.stringify(contactData));
    return '<span class="clickable-name" onclick="showContactModal(this)" data-contact="' + dataAttr + '">' + esc(name) + '</span>';
  };

  window.showContactModal = function(el) {
    var data = JSON.parse(decodeURIComponent(el.getAttribute('data-contact')));
    var overlay = document.getElementById('contact-modal-overlay');
    var body = document.getElementById('contact-modal-body');
    var header = document.getElementById('contact-modal-header');

    var degree = data.degree || 1;
    var degreeTxt = degree === 1 ? '1st Degree' : degree === 2 ? '2nd Degree' : '3rd+ Degree';

    header.innerHTML = '<div>' +
      '<h3>' + esc(data.name || 'Unknown') + '</h3>' +
      '<div style="margin-top:4px;">' +
        '<span class="tier-badge ' + (data.tier || 'watch') + '">' + (data.tier || 'watch') + '</span> ' +
        degreeBadge(degree) +
      '</div>' +
    '</div>' +
    '<button class="contact-modal-close" onclick="closeContactModal()">&times;</button>';

    var rows = '';
    if (data.role) rows += contactModalRow('Role', data.role);
    if (data.company) rows += contactModalRow('Company', data.company);
    if (data.location) rows += contactModalRow('Location', data.location);
    rows += contactModalRow('Degree', degreeTxt);
    if (data.goldScore !== undefined) rows += contactModalRow('Gold Score', (data.goldScore || 0).toFixed(3));
    if (data.icpFit !== undefined) rows += contactModalRow('ICP Fit', (data.icpFit || 0).toFixed(3));
    if (data.networkHub !== undefined) rows += contactModalRow('Network Hub', (data.networkHub || 0).toFixed(3));
    if (data.relStrength !== undefined) rows += contactModalRow('Relationship', (data.relStrength || 0).toFixed(3));
    if (data.behavioral !== undefined && data.behavioral > 0) rows += contactModalRow('Behavioral', (data.behavioral || 0).toFixed(3));
    if (data.mutuals) rows += contactModalRow('Mutual Connections', data.mutuals);
    if (data.discoveredVia) rows += contactModalRow('Discovered Via', data.discoveredVia + ' contact(s)');
    if (data.persona && data.persona !== 'unknown') rows += contactModalRow('Persona', data.persona);
    if (data.behPersona && data.behPersona !== 'unknown') rows += contactModalRow('Behavioral Persona', data.behPersona);
    if (data.referralTier) rows += contactModalRow('Referral Tier', data.referralTier);
    if (data.referralPersona) rows += contactModalRow('Referral Persona', data.referralPersona);
    if (data.referralLikelihood) rows += contactModalRow('Referral Likelihood', (data.referralLikelihood || 0).toFixed(3));
    if (data.similarity !== undefined) rows += contactModalRow('ICP Similarity', ((data.similarity || 0) * 100).toFixed(1) + '%');

    var badges = '';
    if (data.clusters && data.clusters.length > 0) {
      badges += '<div class="contact-modal-section"><h4>Clusters</h4><div class="contact-modal-badges">';
      data.clusters.forEach(function(cl) { badges += '<span class="tier-badge silver" style="font-size:10px;">' + esc(cl) + '</span>'; });
      badges += '</div></div>';
    }
    if (data.traits && data.traits.length > 0) {
      badges += '<div class="contact-modal-section"><h4>Super-Connector Traits</h4><div class="contact-modal-badges">';
      data.traits.forEach(function(t) { badges += '<span class="tier-badge bronze" style="font-size:10px;">' + esc(t) + '</span>'; });
      badges += '</div></div>';
    }

    var linkedin = '';
    if (data.url) {
      linkedin = '<a href="' + esc(data.url) + '" target="_blank" rel="noopener" class="contact-modal-linkedin">View on LinkedIn &#8599;</a>';
    }

    body.innerHTML = rows + badges + linkedin;
    overlay.classList.add('active');
  };

  window.contactModalRow = function(label, value) {
    return '<div class="contact-modal-row"><span class="label">' + esc(String(label)) + '</span><span class="value">' + esc(String(value)) + '</span></div>';
  };

  window.closeContactModal = function() {
    document.getElementById('contact-modal-overlay').classList.remove('active');
  };

  document.addEventListener('keydown', function(e) { if (e.key === 'Escape') closeContactModal(); });

  // ---------------------------------------------------------------------------
  // CSV Export Helper
  // ---------------------------------------------------------------------------
  window.exportTableToCSV = function(tableId, filename) {
    var table = document.getElementById(tableId);
    if (!table) return;
    var rows = [];
    var headers = [];
    table.querySelectorAll('thead th').forEach(function(th) {
      headers.push(th.textContent.trim().replace(/\s+/g, ' '));
    });
    rows.push(headers.join(','));
    table.querySelectorAll('tbody tr').forEach(function(tr) {
      var cols = [];
      tr.querySelectorAll('td').forEach(function(td) {
        var text = td.textContent.trim().replace(/\s+/g, ' ').replace(/"/g, '""');
        if (text.includes(',') || text.includes('"') || text.includes('\\n')) {
          text = '"' + text + '"';
        }
        cols.push(text);
      });
      rows.push(cols.join(','));
    });
    var csv = rows.join('\\n');
    var blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    var link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename || 'export.csv';
    link.click();
  };

  // ---------------------------------------------------------------------------
  // Header
  // ---------------------------------------------------------------------------
  document.getElementById('gen-date').textContent = new Date(DATA.meta.generated).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  document.getElementById('contact-count').textContent = DATA.meta.totalContacts;
  document.getElementById('edge-count').textContent = DATA.meta.totalEdges;

  const cards = document.getElementById('stat-cards');
  const tc = DATA.tierCounts;
  [
    { v: tc.gold, l: 'Gold', cls: 'gold' },
    { v: tc.silver, l: 'Silver', cls: 'silver' },
    { v: tc.bronze, l: 'Bronze', cls: 'bronze' },
    { v: tc.watch, l: 'Watch', cls: '' },
    { v: DATA.meta.graphNodes, l: 'Graph Nodes', cls: 'accent' },
    { v: DATA.meta.edgeCount, l: 'Graph Edges', cls: 'accent' },
  ].forEach(s => {
    const d = document.createElement('div');
    d.className = 'stat-card ' + s.cls;
    d.innerHTML = '<div class="value">' + s.v + '</div><div class="label">' + s.l + '</div>';
    cards.appendChild(d);
  });

  // ---------------------------------------------------------------------------
  // 3D Force Graph
  // ---------------------------------------------------------------------------
  const TIER_COLORS = { gold: '#FFD700', silver: '#C0C0C0', bronze: '#CD7F32', watch: '#666' };
  const DEGREE_COLORS = { 1: '#4CAF50', 2: '#2196F3', 3: '#f59e0b' };
  const PERSONA_COLORS = {
    buyer: '#FFD700',
    hub: '#22c55e',
    amplifier: '#f59e0b',
    influencer: '#ec4899',
    connector: '#6366f1',
    technical: '#3b82f6',
    champion: '#8b5cf6',
    unknown: '#888'
  };
  const CLUSTER_COLORS = ['#6366f1', '#22c55e', '#f59e0b', '#ef4444', '#3b82f6', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316', '#06b6d4'];
  const EDGE_COLORS = {
    'same-company': '#4a9eff',
    'same-cluster': '#22c55e',
    'mutual-proximity': '#777',
    'discovered-connection': '#f59e0b',
    'shared-connection': '#ec4899',
  };

  function getNodeColor(node, colorMode) {
    if (colorMode === 'tier') {
      return TIER_COLORS[node.tier] || '#8888AA';
    } else if (colorMode === 'persona') {
      return PERSONA_COLORS[node.persona] || '#888';
    } else if (colorMode === 'degree') {
      const deg = node.degree || 1;
      return DEGREE_COLORS[deg] || DEGREE_COLORS[3];
    } else {
      // cluster (default)
      const clusterIdx = node.clusters && node.clusters.length > 0 ? parseInt(node.clusters[0].replace(/\D/g, ''), 10) || 0 : 0;
      return CLUSTER_COLORS[clusterIdx % CLUSTER_COLORS.length];
    }
  }

  // Populate filter dropdowns
  const clusterSelect = document.getElementById('f-cluster');
  const personaSelect = document.getElementById('f-persona');
  const allClusters = Object.keys(DATA.clusterData);
  allClusters.forEach(c => {
    const o = document.createElement('option');
    o.value = c; o.textContent = c;
    clusterSelect.appendChild(o);
  });

  // Populate cluster filter links in sidebar
  const clusterLinksContainer = document.getElementById('cluster-filter-links');
  if (clusterLinksContainer) {
    allClusters.forEach(c => {
      const link = document.createElement('div');
      link.className = 'cluster-link';
      link.textContent = c + ' (' + DATA.clusterData[c].size + ')';
      link.onclick = function() {
        if (activeCluster === c) {
          activeCluster = null;
          document.querySelectorAll('.cluster-link').forEach(l => l.classList.remove('active'));
        } else {
          activeCluster = c;
          document.querySelectorAll('.cluster-link').forEach(l => l.classList.remove('active'));
          link.classList.add('active');
        }
        updateGraph();
      };
      clusterLinksContainer.appendChild(link);
    });
  }
  const allPersonas = [...new Set(DATA.nodes.map(n => n.persona))].sort();
  allPersonas.forEach(p => {
    const o = document.createElement('option');
    o.value = p; o.textContent = p;
    personaSelect.appendChild(o);
  });

  let graph3d;
  let neighborhoodMode = null; // null or { nodeId, neighbors }
  let activeCluster = null; // null or cluster ID

  // 3d-force-graph mutates link source/target from strings to object refs.
  // We must deep-clone from the raw DATA each time to avoid broken filters.
  // Precompute primary cluster per node (smallest/most specific cluster)
  var nodePrimaryCluster = {};
  var clusterSizes = {};
  DATA.nodes.forEach(function(n) {
    (n.clusters || []).forEach(function(c) { clusterSizes[c] = (clusterSizes[c] || 0) + 1; });
  });
  DATA.nodes.forEach(function(n) {
    var cls = (n.clusters || []).slice();
    cls.sort(function(a, b) { return (clusterSizes[a] || 999) - (clusterSizes[b] || 999); });
    nodePrimaryCluster[n.id] = cls[0] || 'none';
  });

  var clusterNames = DATA.clusterNames || Object.keys(DATA.clusterData || {}).sort();
  var clusterPositions = DATA.clusterPositions || {};
  var clusterIndex = {};
  clusterNames.forEach(function(c, i) { clusterIndex[c] = i; });

  // Build label texture cache
  var labelCache = {};
  function makeLabel(text, color, fontSize) {
    var key = text + '|' + color + '|' + fontSize;
    if (labelCache[key]) return labelCache[key].clone();
    var canvas = document.createElement('canvas');
    var ctx = canvas.getContext('2d');
    ctx.font = 'bold ' + fontSize + 'px Arial, sans-serif';
    var w = ctx.measureText(text).width;
    canvas.width = Math.min(512, Math.ceil(w) + 16);
    canvas.height = fontSize + 12;
    ctx.font = 'bold ' + fontSize + 'px Arial, sans-serif';
    ctx.fillStyle = color;
    ctx.fillText(text, 8, fontSize);
    var tex = new THREE.CanvasTexture(canvas);
    tex.needsUpdate = true;
    var mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
    var sprite = new THREE.Sprite(mat);
    sprite.scale.set(canvas.width / 6, canvas.height / 6, 1);
    labelCache[key] = sprite;
    return sprite.clone();
  }

  function getFilteredData() {
    var tiers = {};
    ['gold','silver','bronze','watch'].forEach(function(t) {
      tiers[t] = document.getElementById('f-' + t).checked;
    });
    var cluster = clusterSelect.value;
    var persona = personaSelect.value;
    var edgeFilters = {
      company: document.getElementById('edge-company') ? document.getElementById('edge-company').checked : true,
      cluster: document.getElementById('edge-cluster') ? document.getElementById('edge-cluster').checked : true,
      mutual: document.getElementById('edge-mutual') ? document.getElementById('edge-mutual').checked : true,
      discovered: document.getElementById('edge-discovered') ? document.getElementById('edge-discovered').checked : true,
      bridges: document.getElementById('edge-bridges') ? document.getElementById('edge-bridges').checked : true,
    };
    var wtSlider = document.getElementById('weight-threshold');
    var weightThreshold = wtSlider ? parseInt(wtSlider.value) / 100 : 0;
    var degreeFilters = {
      1: document.getElementById('degree-1') ? document.getElementById('degree-1').checked : true,
      2: document.getElementById('degree-2') ? document.getElementById('degree-2').checked : true,
    };

    var filtered = DATA.nodes.filter(function(n) {
      if (tiers[n.tier] === false) return false;
      if (cluster && (n.clusters || []).indexOf(cluster) === -1) return false;
      if (persona && n.persona !== persona) return false;
      var deg = n.degree || 1;
      if (deg === 1 && degreeFilters[1] === false) return false;
      if (deg >= 2 && degreeFilters[2] === false) return false;
      return true;
    });
    if (activeCluster) {
      filtered = filtered.filter(function(n) { return (n.clusters || []).indexOf(activeCluster) >= 0; });
    }
    if (neighborhoodMode) {
      var allowed = new Set([neighborhoodMode.nodeId].concat(neighborhoodMode.neighbors));
      filtered = filtered.filter(function(n) { return allowed.has(n.id); });
    }
    var ids = new Set(filtered.map(function(n) { return n.id; }));

    // Clone contact nodes with cluster metadata
    var contactNodes = filtered.map(function(n) {
      return Object.assign({}, n, {
        _cluster: nodePrimaryCluster[n.id],
        _clusterIdx: clusterIndex[nodePrimaryCluster[n.id]] || 0,
        _isAnchor: false,
      });
    });

    // Add invisible cluster anchor nodes (fixed positions)
    var anchorNodes = [];
    clusterNames.forEach(function(c) {
      var pos = clusterPositions[c];
      if (!pos) return;
      // Only add anchor if we have nodes in this cluster
      var hasNodes = contactNodes.some(function(n) { return n._cluster === c; });
      if (!hasNodes) return;
      anchorNodes.push({
        id: '__anchor_' + c,
        _isAnchor: true,
        _cluster: c,
        _clusterLabel: c,
        fx: pos.x, fy: pos.y, fz: pos.z,
        goldScore: 0, tier: 'anchor', clusters: [c],
      });
    });

    var allNodes = contactNodes.concat(anchorNodes);

    // Build links
    var contactLinks = DATA.edges
      .filter(function(e) {
        if (ids.has(e.source) === false || ids.has(e.target) === false) return false;
        if ((e.weight || 0) < weightThreshold) return false;
        if (e.bridge && edgeFilters.bridges === false) return false;
        if (e.type === 'same-company' && edgeFilters.company === false) return false;
        if (e.type === 'same-cluster' && edgeFilters.cluster === false) return false;
        if (e.type === 'mutual-proximity' && edgeFilters.mutual === false) return false;
        if (e.type === 'discovered-connection' && edgeFilters.discovered === false) return false;
        return true;
      })
      .map(function(e) { return { source: e.source, target: e.target, type: e.type, weight: e.weight, bridge: e.bridge, _isGravity: false }; });

    // Add invisible gravity edges (each contact → its cluster anchor)
    var gravityLinks = [];
    contactNodes.forEach(function(n) {
      var anchorId = '__anchor_' + n._cluster;
      if (anchorNodes.some(function(a) { return a.id === anchorId; })) {
        gravityLinks.push({
          source: n.id,
          target: anchorId,
          type: 'gravity',
          weight: 0.5 + (n.goldScore || 0) * 0.5, // higher score = stronger pull to center
          _isGravity: true,
          bridge: false,
        });
      }
    });

    return { nodes: allNodes, links: contactLinks.concat(gravityLinks) };
  }

  function initGraph() {
    var container = document.getElementById('graph-container');
    if (!container || container.clientWidth === 0) {
      setTimeout(initGraph, 500);
      return;
    }
    var gData = getFilteredData();
    var colorMode = document.getElementById('color-by') ? document.getElementById('color-by').value : 'cluster';
    console.log('initGraph: nodes=' + gData.nodes.length + ' links=' + gData.links.length + ' container=' + container.clientWidth + 'x600');

    graph3d = ForceGraph3D()(container)
      .graphData(gData)
      .nodeId('id')
      .nodeVisibility(function(n) { return n._isAnchor !== true; })
      .nodeVal(function(n) {
        if (n._isAnchor) return 0;
        var base = 1;
        if (n.tier === 'gold') base = 6 + (n.goldScore || 0) * 14;
        else if (n.tier === 'silver') base = 3 + (n.goldScore || 0) * 8;
        else if (n.tier === 'bronze') base = 1.5 + (n.goldScore || 0) * 4;
        else base = 0.8;
        return base;
      })
      .nodeColor(function(n) { return n._isAnchor ? 'rgba(0,0,0,0)' : getNodeColor(n, colorMode); })
      .nodeLabel(function(n) {
        if (n._isAnchor) return n._clusterLabel;
        return '<b>' + n.name + '</b><br>' + (n.role || '') + (n.company ? ' @ ' + n.company : '')
          + '<br>' + n.tier + ' | gold: ' + (n.goldScore || 0).toFixed(2)
          + ' | degree: ' + (n.degree || 1)
          + (n.mutuals ? ' | mutuals: ' + n.mutuals : '');
      })
      .nodeOpacity(0.9)
      .nodeThreeObject(function(n) {
        if (n._isAnchor) {
          // Cluster label sprite at anchor position
          var label = makeLabel(n._clusterLabel.toUpperCase(), '#ffffff', 28);
          label.material.opacity = 0.7;
          return label;
        }
        if (n.tier === 'gold') {
          // Gold nodes get a visible name label
          var group = new THREE.Group();
          // Glow ring
          var ringGeo = new THREE.RingGeometry(4 + (n.goldScore || 0) * 6, 5 + (n.goldScore || 0) * 7, 32);
          var ringMat = new THREE.MeshBasicMaterial({ color: 0xFFD700, transparent: true, opacity: 0.3, side: THREE.DoubleSide });
          var ring = new THREE.Mesh(ringGeo, ringMat);
          group.add(ring);
          // Name label above node
          var sprite = makeLabel(n.name, '#FFD700', 20);
          sprite.position.y = 8 + (n.goldScore || 0) * 4;
          group.add(sprite);
          return group;
        }
        return false; // use default sphere for non-gold
      })
      .nodeThreeObjectExtend(true)
      .linkSource('source')
      .linkTarget('target')
      .linkVisibility(function(l) { return l._isGravity !== true; })
      .linkColor(function(l) {
        if (l.bridge) return '#ff6b6b';
        return EDGE_COLORS[l.type] || '#444';
      })
      .linkOpacity(function(l) { return 0.15 + (l.weight || 0) * 0.45; })
      .linkWidth(function(l) {
        if (l.bridge) return 1.2;
        return 0.2 + (l.weight || 0) * 1.5;
      })
      .linkDirectionalParticles(function(l) { return (l.weight || 0) > 0.4 ? 1 : 0; })
      .linkDirectionalParticleWidth(1)
      .linkDirectionalParticleSpeed(0.003)
      .backgroundColor('#0a0c14')
      .width(container.clientWidth)
      .height(700)
      .onNodeClick(function(node) { if (node && !node._isAnchor) showNodeInfo(node); });

    // Force tuning
    var chargeForce = graph3d.d3Force('charge');
    if (chargeForce) chargeForce.strength(-80);
    var linkForce = graph3d.d3Force('link');
    if (linkForce) {
      linkForce.distance(function(link) {
        if (link._isGravity) {
          // Gravity: gold pulled closer to center, watch further
          var w = link.weight || 0.5;
          return 30 + (1 - w) * 80; // gold ~30-50, watch ~80-110
        }
        if (link.bridge) return 180;
        if (link.type === 'same-company') return 30;
        if (link.type === 'discovered-connection') return 40;
        if (link.type === 'same-cluster') return 50;
        return 60;
      }).strength(function(link) {
        if (link._isGravity) return 0.4; // gravity pull
        if (link.bridge) return 0.08;
        return 0.2 + (link.weight || 0) * 0.3;
      });
    }

    // Remove center force so clusters spread out (default d3 adds a centering force)
    graph3d.d3Force('center', null);

    console.log('initGraph complete');
  }

  function updateGraph() {
    if (!graph3d) return;
    var gData = getFilteredData();
    var colorMode = document.getElementById('color-by') ? document.getElementById('color-by').value : 'cluster';
    graph3d.graphData(gData)
      .nodeColor(function(n) { return n._isAnchor ? 'rgba(0,0,0,0)' : getNodeColor(n, colorMode); });
  }

  ['f-gold','f-silver','f-bronze','f-watch'].forEach(id => {
    document.getElementById(id).addEventListener('change', updateGraph);
  });
  clusterSelect.addEventListener('change', updateGraph);
  personaSelect.addEventListener('change', updateGraph);
  ['edge-company','edge-cluster','edge-mutual','edge-discovered','edge-bridges'].forEach(id => {
    var el = document.getElementById(id);
    if (el) el.addEventListener('change', updateGraph);
  });
  ['degree-1','degree-2'].forEach(id => {
    var el = document.getElementById(id);
    if (el) el.addEventListener('change', updateGraph);
  });
  var colorBySelect = document.getElementById('color-by');
  if (colorBySelect) colorBySelect.addEventListener('change', updateGraph);
  var spacingSlider = document.getElementById('cluster-spacing');
  if (spacingSlider) spacingSlider.addEventListener('input', function() { updateGraph(); });
  var weightSlider = document.getElementById('weight-threshold');
  if (weightSlider) weightSlider.addEventListener('input', function() {
    var lbl = document.getElementById('weight-label');
    if (lbl) lbl.textContent = this.value + '%';
    updateGraph();
  });

  // ---------------------------------------------------------------------------
  // Modal
  // ---------------------------------------------------------------------------
  const modalOverlay = document.getElementById('modal-overlay');
  document.getElementById('modal-close').addEventListener('click', () => modalOverlay.classList.remove('show'));
  modalOverlay.addEventListener('click', (e) => { if (e.target === modalOverlay) modalOverlay.classList.remove('show'); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') modalOverlay.classList.remove('show'); });

  function showModal(item) {
    var url = item.id || item.url || '';
    document.getElementById('modal-name').textContent = item.name || 'Unknown';
    document.getElementById('modal-role').textContent = [item.role || '', item.company || ''].filter(Boolean).join(' @ ');
    var tier = item.tier || 'watch';
    document.getElementById('modal-tier').innerHTML =
      '<span class="tier-badge ' + tier + '">' + tier.toUpperCase() + '</span> ' +
      degreeBadge(item.degree) +
      (item.persona ? ' <span style="color:var(--text-dim);font-size:13px;margin-left:8px;">' + esc(item.persona) + '</span>' : '');
    var scoreRows = [
      ['Gold Score', (item.goldScore || 0).toFixed(3)],
      ['ICP Fit', (item.icpFit || 0).toFixed(3)],
      ['Network Hub', (item.networkHub || 0).toFixed(3)],
      ['Rel. Strength', (item.relStrength || 0).toFixed(3)],
      ['Behavioral', (item.behavioral || 0).toFixed(3)],
      ['Beh. Persona', item.behavioralPersona || item.behPersona || 'unknown'],
      ['Referral Score', (item.referralLikelihood || 0).toFixed(3)],
      ['Referral Tier', item.referralTier || 'none'],
      ['Ref. Persona', item.referralPersona || 'none'],
      ['Mutual Connections', item.mutuals || 0],
      ['Clusters', (item.clusters || []).join(', ') || 'none'],
    ];
    document.getElementById('modal-scores').innerHTML = scoreRows.map(function(r) {
      return '<div class="modal-score-item"><span class="ms-label">' + r[0] + '</span><span class="ms-value">' + r[1] + '</span></div>';
    }).join('');
    var tags = item.superConnectorTraits || item.traits || [];
    document.getElementById('modal-tags').innerHTML = tags.length > 0 ?
      tags.map(function(t) { return '<span class="tier-badge" style="background:rgba(99,102,241,0.2);color:var(--accent2);">' + esc(t) + '</span>'; }).join('') : '';
    var extra = [];
    if ((item.discoveredVia || 0) > 0) extra.push('Discovered via ' + item.discoveredVia + ' connection(s)');
    if (item.location) extra.push(item.location);
    document.getElementById('modal-extra').textContent = extra.join(' \\u00B7 ');
    document.getElementById('modal-linkedin').href = url;
    modalOverlay.classList.add('show');
  }

  function showNodeInfo(node) { showModal(node); }

  // Init graph after short delay for DOM
  setTimeout(initGraph, 100);

  // ---------------------------------------------------------------------------
  // Charts
  // ---------------------------------------------------------------------------
  const chartDefaults = {
    color: '#e1e4ed',
    borderColor: 'transparent',
    responsive: true,
    maintainAspectRatio: true,
  };
  Chart.defaults.color = '#8b8fa3';

  // Gold score histogram
  new Chart(document.getElementById('chart-gold'), {
    type: 'bar',
    data: {
      labels: DATA.goldScoreDist.labels,
      datasets: [{
        label: 'Contacts',
        data: DATA.goldScoreDist.counts,
        backgroundColor: 'rgba(99, 102, 241, 0.6)',
        borderColor: 'rgba(99, 102, 241, 1)',
        borderWidth: 1,
      }]
    },
    options: { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, grid: { color: '#2d3148' } }, x: { grid: { display: false } } } }
  });

  // Behavioral score histogram
  new Chart(document.getElementById('chart-beh'), {
    type: 'bar',
    data: {
      labels: DATA.behScoreDist.labels,
      datasets: [{
        label: 'Contacts',
        data: DATA.behScoreDist.counts,
        backgroundColor: 'rgba(34, 197, 94, 0.6)',
        borderColor: 'rgba(34, 197, 94, 1)',
        borderWidth: 1,
      }]
    },
    options: { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, grid: { color: '#2d3148' } }, x: { grid: { display: false } } } }
  });

  // Tier donut
  new Chart(document.getElementById('chart-tier'), {
    type: 'doughnut',
    data: {
      labels: ['Gold', 'Silver', 'Bronze', 'Watch'],
      datasets: [{
        data: [tc.gold, tc.silver, tc.bronze, tc.watch],
        backgroundColor: ['#FFD700', '#C0C0C0', '#CD7F32', '#555'],
        borderWidth: 0,
      }]
    },
    options: { plugins: { legend: { position: 'bottom' } } }
  });

  // Behavioral persona donut
  const bpLabels = Object.keys(DATA.behPersonaCounts);
  const bpValues = Object.values(DATA.behPersonaCounts);
  const bpColors = ['#6366f1', '#22c55e', '#f59e0b', '#ef4444', '#3b82f6', '#8b5cf6', '#ec4899'];
  new Chart(document.getElementById('chart-persona'), {
    type: 'doughnut',
    data: {
      labels: bpLabels,
      datasets: [{
        data: bpValues,
        backgroundColor: bpColors.slice(0, bpLabels.length),
        borderWidth: 0,
      }]
    },
    options: { plugins: { legend: { position: 'bottom' } } }
  });

  // Cluster amplifiers bar chart
  const clLabels = Object.keys(DATA.clusterData);
  const clAmps = clLabels.map(c => DATA.clusterData[c].amplifierCount);
  const clSizes = clLabels.map(c => DATA.clusterData[c].size);
  new Chart(document.getElementById('chart-amplifiers'), {
    type: 'bar',
    data: {
      labels: clLabels,
      datasets: [
        { label: 'Amplifiers', data: clAmps, backgroundColor: 'rgba(99, 102, 241, 0.7)', borderWidth: 0 },
        { label: 'Total', data: clSizes, backgroundColor: 'rgba(99, 102, 241, 0.2)', borderWidth: 0 },
      ]
    },
    options: {
      plugins: { legend: { position: 'top' } },
      scales: { y: { beginAtZero: true, grid: { color: '#2d3148' } }, x: { grid: { display: false } } }
    }
  });

  // ---------------------------------------------------------------------------
  // Sortable Contacts Table
  // ---------------------------------------------------------------------------
  let sortKey = 'goldScore';
  let sortAsc = false;

  function renderTable() {
    const sorted = [...DATA.tableContacts].sort((a, b) => {
      let va = a[sortKey], vb = b[sortKey];
      if (typeof va === 'string') { va = va.toLowerCase(); vb = (vb||'').toLowerCase(); }
      if (va < vb) return sortAsc ? -1 : 1;
      if (va > vb) return sortAsc ? 1 : -1;
      return 0;
    });
    const tbody = document.getElementById('contacts-tbody');
    tbody.innerHTML = sorted.map(c => {
      return '<tr class="clickable-row" data-url="' + esc(c.url) + '">' +
        '<td>' + clickableName(c.name, c) + ' ' + degreeBadge(c.degree) + '</td>' +
        '<td>' + c.goldScore.toFixed(3) + '</td>' +
        '<td><span class="tier-badge ' + c.tier + '">' + c.tier + '</span></td>' +
        '<td>' + c.icpFit.toFixed(3) + '</td>' +
        '<td>' + c.networkHub.toFixed(3) + '</td>' +
        '<td>' + c.behavioral.toFixed(3) + '</td>' +
        '<td>' + esc(c.persona) + '</td>' +
        '<td title="' + esc(c.role) + '">' + esc(c.role) + '</td>' +
        '<td title="' + esc(c.company) + '">' + esc(c.company) + '</td>' +
        '</tr>';
    }).join('');

    // Update sort arrows
    document.querySelectorAll('#contacts-table th').forEach(th => {
      const key = th.dataset.key;
      const arrow = th.querySelector('.sort-arrow');
      if (arrow) arrow.textContent = key === sortKey ? (sortAsc ? '\\u25B2' : '\\u25BC') : '';
    });
  }

  document.querySelectorAll('#contacts-table th[data-key]').forEach(th => {
    th.addEventListener('click', () => {
      const key = th.dataset.key;
      if (sortKey === key) { sortAsc = !sortAsc; }
      else { sortKey = key; sortAsc = false; }
      renderTable();
    });
  });
  renderTable();

  // ---------------------------------------------------------------------------
  // Hub Cards
  // ---------------------------------------------------------------------------
  const hubsList = document.getElementById('hubs-list');
  DATA.hubs.forEach(h => {
    hubsList.innerHTML += '<div class="info-card">' +
      '<div class="card-name">' + clickableName(h.name, h) + ' ' + degreeBadge(h.degree) + '</div>' +
      '<div class="card-role">' + esc([h.role, h.company].filter(Boolean).join(' @ ')) + '</div>' +
      '<div class="card-stats">' +
        '<span>Hub: ' + h.networkHub.toFixed(2) + '</span>' +
        '<span>Gold: ' + h.goldScore.toFixed(2) + '</span>' +
        '<span class="tier-badge ' + h.tier + '">' + h.tier + '</span>' +
        '<span>Mutuals: ' + h.mutuals + '</span>' +
        '<span>Clusters: ' + (h.clusters.join(', ') || 'none') + '</span>' +
      '</div></div>';
  });

  // ---------------------------------------------------------------------------
  // Super-Connector Cards
  // ---------------------------------------------------------------------------
  const scList = document.getElementById('sc-list');
  DATA.superConnectors.forEach(s => {
    scList.innerHTML += '<div class="info-card">' +
      '<div class="card-name">' + clickableName(s.name, s) + ' ' + degreeBadge(s.degree) + '</div>' +
      '<div class="card-role">' + esc([s.role, s.company].filter(Boolean).join(' @ ')) + '</div>' +
      '<div class="card-stats">' +
        '<span>Behavioral: ' + s.behavioral.toFixed(2) + '</span>' +
        '<span>Gold: ' + s.goldScore.toFixed(2) + '</span>' +
        '<span class="tier-badge ' + s.tier + '">' + s.tier + '</span>' +
        '<span>Traits: ' + (s.traits.join(', ') || 'none') + '</span>' +
      '</div></div>';
  });

  // ---------------------------------------------------------------------------
  // Employers Table
  // ---------------------------------------------------------------------------
  const empTbody = document.getElementById('employers-tbody');
  DATA.topEmployers.forEach(e => {
    empTbody.innerHTML += '<tr>' +
      '<td>' + esc(e.name) + '</td>' +
      '<td>' + e.env.toFixed(3) + '</td>' +
      '<td>' + e.count + '</td>' +
      '<td>' + e.goldCount + '</td>' +
      '<td>' + (e.goldPct * 100).toFixed(0) + '%</td>' +
      '<td>' + e.avgBehavioral.toFixed(2) + '</td>' +
      '<td>' + e.avgMutuals.toFixed(0) + '</td>' +
      '<td>' + (e.clusters.join(', ') || '-') + '</td>' +
      '</tr>';
  });

  // ---------------------------------------------------------------------------
  // Warm Introduction Paths
  // ---------------------------------------------------------------------------
  const warmIntrosTbody = document.getElementById('warm-intros-tbody');
  if (warmIntrosTbody && DATA.warmIntroPaths) {
    DATA.warmIntroPaths.forEach(function(w) {
      warmIntrosTbody.innerHTML += '<tr>' +
        '<td>' + clickableName(w.name, w) + '</td>' +
        '<td><span class="tier-badge ' + w.tier + '">' + w.tier + '</span></td>' +
        '<td>' + w.goldScore.toFixed(3) + '</td>' +
        '<td>' + w.introducers.join(', ') + '</td>' +
        '<td style="font-weight:600;">' + esc(w.bestIntroPath) + '</td>' +
        '<td title="' + esc(w.role) + '">' + esc(w.role) + '</td>' +
        '<td title="' + esc(w.company) + '">' + esc(w.company) + '</td>' +
        '</tr>';
    });
  }

  // ---------------------------------------------------------------------------
  // Referral Partners Section
  // ---------------------------------------------------------------------------
  var refTc = DATA.referralTierCounts || {};
  var refCards = document.getElementById('referral-stat-cards');
  if (refCards) {
    [
      { v: refTc['gold-referral'] || 0, l: 'Gold Referrals', cls: 'gold' },
      { v: refTc['silver-referral'] || 0, l: 'Silver Referrals', cls: 'silver' },
      { v: refTc['bronze-referral'] || 0, l: 'Bronze Referrals', cls: 'bronze' },
    ].forEach(function(s) {
      var d = document.createElement('div');
      d.className = 'stat-card ' + s.cls;
      d.innerHTML = '<div class="value">' + s.v + '</div><div class="label">' + s.l + '</div>';
      refCards.appendChild(d);
    });
  }

  // Referral score histogram
  if (DATA.refScoreDist) {
    new Chart(document.getElementById('chart-ref-score'), {
      type: 'bar',
      data: {
        labels: DATA.refScoreDist.labels,
        datasets: [{
          label: 'Contacts',
          data: DATA.refScoreDist.counts,
          backgroundColor: 'rgba(245, 158, 11, 0.6)',
          borderColor: 'rgba(245, 158, 11, 1)',
          borderWidth: 1,
        }]
      },
      options: { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, grid: { color: '#2d3148' } }, x: { grid: { display: false } } } }
    });
  }

  // Referral persona donut
  var rpLabels = Object.keys(DATA.referralPersonaCounts || {});
  var rpValues = Object.values(DATA.referralPersonaCounts || {});
  var rpColors = ['#f59e0b', '#22c55e', '#6366f1', '#ec4899', '#8b5cf6'];
  if (rpLabels.length > 0) {
    new Chart(document.getElementById('chart-ref-persona'), {
      type: 'doughnut',
      data: {
        labels: rpLabels,
        datasets: [{
          data: rpValues,
          backgroundColor: rpColors.slice(0, rpLabels.length),
          borderWidth: 0,
        }]
      },
      options: { plugins: { legend: { position: 'bottom' } } }
    });
  }

  // Top referral partners table
  var refTbody = document.getElementById('referral-tbody');
  if (refTbody && DATA.topReferrals) {
    DATA.topReferrals.forEach(function(r) {
      var tierClass = r.referralTier === 'gold-referral' ? 'gold' : r.referralTier === 'silver-referral' ? 'silver' : r.referralTier === 'bronze-referral' ? 'bronze' : 'watch';
      var icpTierClass = r.tier || 'watch';
      refTbody.innerHTML += '<tr class="clickable-row" data-url="' + esc(r.url) + '">' +
        '<td>' + clickableName(r.name, r) + ' ' + degreeBadge(r.degree) + '</td>' +
        '<td>' + r.referralLikelihood.toFixed(3) + '</td>' +
        '<td><span class="tier-badge ' + tierClass + '">' + (r.referralTier || 'none') + '</span></td>' +
        '<td>' + esc(r.referralPersona) + '</td>' +
        '<td title="' + esc(r.role) + '">' + esc(r.role) + '</td>' +
        '<td>' + (r.signals.clientOverlap || 0).toFixed(2) + '</td>' +
        '<td>' + (r.signals.networkReach || 0).toFixed(2) + '</td>' +
        '<td>' + (r.signals.amplificationPower || 0).toFixed(2) + '</td>' +
        '<td>' + (r.signals.relationshipWarmth || 0).toFixed(2) + '</td>' +
        '<td><span class="tier-badge ' + icpTierClass + '">' + r.tier + '</span></td>' +
        '</tr>';
    });
  }

  // ---------------------------------------------------------------------------
  // Visibility Lists
  // ---------------------------------------------------------------------------
  function renderInfoList(containerId, items, statsFn) {
    const el = document.getElementById(containerId);
    items.forEach(item => {
      el.innerHTML += '<div class="info-card">' +
        '<div class="card-name">' + clickableName(item.name, item) + ' ' + degreeBadge(item.degree) + '</div>' +
        '<div class="card-role">' + esc(item.role || '') + '</div>' +
        '<div class="card-stats">' + statsFn(item) + '</div></div>';
    });
  }

  renderInfoList('bridges-list', DATA.bridges, b =>
    '<span>Behavioral: ' + b.behavioral.toFixed(2) + '</span>' +
    '<span>Clusters: ' + b.clusters.join(', ') + '</span>'
  );
  renderInfoList('silent-list', DATA.silentInfluencers, s =>
    '<span>Connections: ' + (s.connections || '500+') + '</span>' +
    '<span>Behavioral: ' + s.behavioral.toFixed(2) + '</span>'
  );
  renderInfoList('rising-list', DATA.risingStars, r =>
    '<span>Behavioral: ' + r.behavioral.toFixed(2) + '</span>' +
    '<span>Connected: ' + (r.daysAgo != null ? r.daysAgo + 'd ago' : 'recently') + '</span>'
  );

  // ---------------------------------------------------------------------------
  // Recommendations
  // ---------------------------------------------------------------------------
  const recsList = document.getElementById('recs-list');
  DATA.recommendations.forEach(cat => {
    let html = '<div class="rec-category"><h3>' + esc(cat.category) + '</h3>';
    cat.items.forEach(item => {
      html += '<div class="rec-item">' +
        '<div class="rec-name">' + clickableName(item.name, item) + ' ' + degreeBadge(item.degree) + '</div>' +
        '<div class="rec-detail">' + esc(item.detail) + '</div>' +
        '<div class="rec-action">&rarr; ' + esc(item.action) + '</div>' +
        '</div>';
    });
    html += '</div>';
    recsList.innerHTML += html;
  });

  // ---------------------------------------------------------------------------
  // Tab Switching
  // ---------------------------------------------------------------------------
  document.querySelectorAll('.tab-bar').forEach(function(bar) {
    bar.querySelectorAll('.tab-btn').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var tabId = btn.dataset.tab;
        var section = btn.closest('.section');
        section.querySelectorAll('.tab-btn').forEach(function(b) { b.classList.remove('active'); });
        section.querySelectorAll('.tab-panel').forEach(function(p) { p.classList.remove('active'); });
        btn.classList.add('active');
        document.getElementById(tabId).classList.add('active');
      });
    });
  });

  // ---------------------------------------------------------------------------
  // Data Explorer Tables
  // ---------------------------------------------------------------------------
  // All Contacts table (searchable, sortable)
  var explorerSort = { key: 'goldScore', asc: false };

  function renderExplorerTable() {
    var search = (document.getElementById('search-all').value || '').toLowerCase();
    var filtered = DATA.tableContacts.filter(function(c) {
      if (!search) return true;
      return (c.name||'').toLowerCase().indexOf(search) >= 0 ||
        (c.role||'').toLowerCase().indexOf(search) >= 0 ||
        (c.company||'').toLowerCase().indexOf(search) >= 0;
    });
    filtered.sort(function(a, b) {
      var va = a[explorerSort.key], vb = b[explorerSort.key];
      if (typeof va === 'string') { va = (va||'').toLowerCase(); vb = (vb||'').toLowerCase(); }
      if (va < vb) return explorerSort.asc ? -1 : 1;
      if (va > vb) return explorerSort.asc ? 1 : -1;
      return 0;
    });
    document.getElementById('count-all').textContent = filtered.length + ' contacts';
    document.querySelector('#table-all tbody').innerHTML = filtered.map(function(c) {
      return '<tr class="clickable-row" data-url="' + esc(c.url) + '">' +
        '<td>' + clickableName(c.name, c) + ' ' + degreeBadge(c.degree) + '</td>' +
        '<td>' + c.goldScore.toFixed(3) + '</td>' +
        '<td><span class="tier-badge ' + c.tier + '">' + c.tier + '</span></td>' +
        '<td>' + c.icpFit.toFixed(3) + '</td>' +
        '<td>' + c.networkHub.toFixed(3) + '</td>' +
        '<td>' + c.behavioral.toFixed(3) + '</td>' +
        '<td>' + (c.degree || 1) + '</td>' +
        '<td>' + esc(c.persona) + '</td>' +
        '<td title="' + esc(c.role) + '">' + esc(c.role) + '</td>' +
        '<td title="' + esc(c.company) + '">' + esc(c.company) + '</td>' +
        '</tr>';
    }).join('');
  }
  document.getElementById('search-all').addEventListener('input', renderExplorerTable);
  document.querySelectorAll('#table-all th[data-sort]').forEach(function(th) {
    th.style.cursor = 'pointer';
    th.addEventListener('click', function() {
      var key = th.dataset.sort;
      if (explorerSort.key === key) explorerSort.asc = !explorerSort.asc;
      else { explorerSort.key = key; explorerSort.asc = false; }
      renderExplorerTable();
    });
  });
  renderExplorerTable();

  // Populate hidden hubs export table
  const hubsExportTbody = document.getElementById('hubs-export-tbody');
  if (hubsExportTbody) {
    hubsExportTbody.innerHTML = DATA.hubs.map(function(h) {
      return '<tr>' +
        '<td>' + esc(h.name) + '</td>' +
        '<td>' + h.networkHub.toFixed(3) + '</td>' +
        '<td>' + h.goldScore.toFixed(3) + '</td>' +
        '<td>' + h.tier + '</td>' +
        '<td>' + h.mutuals + '</td>' +
        '<td>' + esc(h.role) + '</td>' +
        '<td>' + esc(h.company) + '</td>' +
        '<td>' + (h.clusters.join(', ') || '-') + '</td>' +
        '</tr>';
    }).join('');
  }

  // Hubs explorer table
  const hubsExpTbody = document.querySelector('#tab-hubs tbody');
  if (hubsExpTbody) {
    hubsExpTbody.innerHTML = DATA.hubs.map(function(h) {
      return '<tr class="clickable-row" data-url="' + esc(h.url || '') + '">' +
      '<td>' + clickableName(h.name, h) + ' ' + degreeBadge(h.degree) + '</td>' +
      '<td>' + h.networkHub.toFixed(3) + '</td>' +
      '<td>' + h.goldScore.toFixed(3) + '</td>' +
      '<td><span class="tier-badge ' + h.tier + '">' + h.tier + '</span></td>' +
      '<td>' + h.mutuals + '</td>' +
      '<td title="' + esc(h.role) + '">' + esc(h.role) + '</td>' +
      '<td title="' + esc(h.company) + '">' + esc(h.company) + '</td>' +
      '<td>' + (h.clusters.join(', ') || '-') + '</td>' +
      '</tr>';
    }).join('');
  }

  // Super-connectors explorer table (update table ID to table-sc)
  const scTbody = document.querySelector('#tab-sc tbody');
  if (scTbody) {
    scTbody.innerHTML = DATA.superConnectors.map(function(s) {
    return '<tr class="clickable-row" data-url="' + esc(s.url || '') + '">' +
      '<td>' + clickableName(s.name, s) + ' ' + degreeBadge(s.degree) + '</td>' +
      '<td>' + s.behavioral.toFixed(3) + '</td>' +
      '<td>' + s.goldScore.toFixed(3) + '</td>' +
      '<td><span class="tier-badge ' + s.tier + '">' + s.tier + '</span></td>' +
      '<td>' + (s.traits.join(', ') || '-') + '</td>' +
      '<td title="' + esc(s.role) + '">' + esc(s.role) + '</td>' +
      '<td title="' + esc(s.company) + '">' + esc(s.company) + '</td>' +
      '</tr>';
    }).join('');
  }

  // Companies explorer table (update to table-companies)
  const companiesTbody = document.querySelector('#tab-companies tbody');
  if (companiesTbody) {
    companiesTbody.innerHTML = DATA.topEmployers.map(function(e) {
    return '<tr>' +
      '<td>' + esc(e.name) + '</td>' +
      '<td>' + e.env.toFixed(3) + '</td>' +
      '<td>' + e.count + '</td>' +
      '<td>' + e.goldCount + '</td>' +
      '<td>' + (e.goldPct * 100).toFixed(0) + '%</td>' +
      '<td>' + e.avgBehavioral.toFixed(2) + '</td>' +
      '<td>' + e.avgMutuals.toFixed(0) + '</td>' +
      '</tr>';
    }).join('');
  }

  // Referrals explorer table (update to table-referrals)
  var refExplorer = DATA.topReferrals || [];
  const referralsTbody = document.querySelector('#tab-referrals tbody');
  if (referralsTbody) {
    referralsTbody.innerHTML = refExplorer.length > 0 ? refExplorer.map(function(r) {
    var tierClass = r.referralTier === 'gold-referral' ? 'gold' : r.referralTier === 'silver-referral' ? 'silver' : r.referralTier === 'bronze-referral' ? 'bronze' : 'watch';
    return '<tr class="clickable-row" data-url="' + esc(r.url) + '">' +
      '<td>' + clickableName(r.name, r) + ' ' + degreeBadge(r.degree) + '</td>' +
      '<td>' + r.referralLikelihood.toFixed(3) + '</td>' +
      '<td><span class="tier-badge ' + tierClass + '">' + (r.referralTier || 'none') + '</span></td>' +
      '<td>' + esc(r.referralPersona) + '</td>' +
      '<td>' + r.goldScore.toFixed(3) + '</td>' +
      '<td><span class="tier-badge ' + r.tier + '">' + r.tier + '</span></td>' +
      '<td title="' + esc(r.role) + '">' + esc(r.role) + '</td>' +
      '<td title="' + esc(r.company) + '">' + esc(r.company) + '</td>' +
      '</tr>';
    }).join('') : '<tr><td colspan="8" style="text-align:center;color:var(--text-dim);padding:24px;">No referral scores yet. Run referral-scorer.mjs first.</td></tr>';
  }

  // Degree-2 explorer table (update to table-deg2)
  var deg2 = DATA.degree2Contacts || [];
  const deg2Tbody = document.querySelector('#tab-deg2 tbody');
  if (deg2Tbody) {
    deg2Tbody.innerHTML = deg2.length > 0 ? deg2.map(function(c) {
    return '<tr class="clickable-row" data-url="' + esc(c.url) + '">' +
      '<td>' + clickableName(c.name, c) + ' ' + degreeBadge(c.degree) + '</td>' +
      '<td>' + c.goldScore.toFixed(3) + '</td>' +
      '<td><span class="tier-badge ' + c.tier + '">' + c.tier + '</span></td>' +
      '<td>' + c.behavioral.toFixed(3) + '</td>' +
      '<td>' + c.degree + '</td>' +
      '<td>' + c.discoveredVia + '</td>' +
      '<td>' + c.mutuals + '</td>' +
      '<td title="' + esc(c.role) + '">' + esc(c.role) + '</td>' +
      '<td title="' + esc(c.company) + '">' + esc(c.company) + '</td>' +
      '</tr>';
    }).join('') : '<tr><td colspan="9" style="text-align:center;color:var(--text-dim);padding:24px;">No degree-2 contacts yet. Run deep-scan to discover 2nd-degree connections.</td></tr>';
  }

  // Clickable table rows -> open modal
  document.addEventListener('click', function(e) {
    var row = e.target.closest('.clickable-row');
    if (!row) return;
    var url = row.dataset.url;
    if (!url) return;
    var node = DATA.nodes.find(function(n) { return n.id === url; });
    var contact = node || DATA.tableContacts.find(function(c) { return c.url === url; });
    if (contact) showModal(contact);
  });

  // ---------------------------------------------------------------------------
  // Vector Intelligence
  // ---------------------------------------------------------------------------
  if (DATA.vectorInsights && DATA.vectorInsights.available) {
    document.getElementById('vector-intel').style.display = '';
    document.getElementById('nav-vector').style.display = '';

    // Stats cards
    var vCards = document.getElementById('vector-stat-cards');
    [
      { v: DATA.vectorInsights.storeSize, l: 'Vectorized Contacts', cls: 'accent' },
      { v: DATA.vectorInsights.goldNeighbors.length, l: 'Gold Neighborhoods', cls: 'gold' },
      { v: DATA.vectorInsights.hiddenGems.length, l: 'Hidden Gems Found', cls: 'accent' },
      { v: DATA.vectorInsights.hubReach.length, l: 'Hub Reach Maps', cls: 'accent' },
    ].forEach(function(s) {
      var d = document.createElement('div');
      d.className = 'stat-card ' + s.cls;
      d.innerHTML = '<div class="value">' + s.v + '</div><div class="label">' + s.l + '</div>';
      vCards.appendChild(d);
    });

    // Gold similarity neighborhoods
    var gnList = document.getElementById('gold-neighbors-list');
    DATA.vectorInsights.goldNeighbors.forEach(function(gn) {
      var rows = gn.neighbors.map(function(n) {
        var simPct = (n.similarity * 100).toFixed(1);
        var barW = Math.max(n.similarity * 100, 5);
        return '<div style="display:flex;align-items:center;gap:12px;padding:8px 0;border-bottom:1px solid var(--border);">' +
          '<div style="flex:1;min-width:0;">' +
            '<div style="font-weight:600;">' + clickableName(n.name, n) + ' <span class="tier-badge ' + n.tier + '" style="font-size:10px;">' + n.tier + '</span></div>' +
            '<div style="font-size:12px;color:var(--text-dim);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + esc(n.role) + (n.company ? ' @ ' + esc(n.company) : '') + '</div>' +
          '</div>' +
          '<div style="width:120px;display:flex;align-items:center;gap:8px;">' +
            '<div style="flex:1;height:6px;background:var(--surface2);border-radius:3px;overflow:hidden;">' +
              '<div style="height:100%;width:' + barW + '%;background:var(--accent);border-radius:3px;"></div>' +
            '</div>' +
            '<span style="font-size:13px;font-weight:600;color:var(--accent2);white-space:nowrap;">' + simPct + '%</span>' +
          '</div>' +
        '</div>';
      }).join('');

      gnList.innerHTML +=
        '<div class="info-card" style="margin-bottom:16px;max-width:100%;">' +
          '<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:12px;">' +
            '<div>' +
              '<div class="card-name">' + clickableName(gn.name, gn) + ' <span class="tier-badge gold" style="font-size:10px;">GOLD</span></div>' +
              '<div class="card-role">' + esc(gn.role) + (gn.company ? ' @ ' + esc(gn.company) : '') + '</div>' +
            '</div>' +
            '<div style="text-align:right;"><span style="font-size:12px;color:var(--text-dim);">Gold Score</span><div style="font-size:18px;font-weight:700;color:var(--gold);">' + gn.goldScore.toFixed(3) + '</div></div>' +
          '</div>' +
          '<div style="font-size:11px;color:var(--accent2);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px;">Nearest Semantic Neighbors</div>' +
          rows +
        '</div>';
    });

    // Hidden gems table
    var gemsTbody = document.getElementById('gems-tbody');
    DATA.vectorInsights.hiddenGems.forEach(function(g) {
      var simPct = (g.similarity * 100).toFixed(1);
      gemsTbody.innerHTML += '<tr>' +
        '<td style="font-weight:600;">' + clickableName(g.name, g) + '</td>' +
        '<td style="color:var(--accent2);font-weight:600;">' + simPct + '%</td>' +
        '<td>' + esc(g.similarTo) + ' <span class="tier-badge gold" style="font-size:10px;">GOLD</span></td>' +
        '<td><span class="tier-badge ' + g.tier + '">' + g.tier + '</span></td>' +
        '<td>' + (g.goldScore || 0).toFixed(3) + '</td>' +
        '<td title="' + esc(g.role) + '">' + esc(g.role) + '</td>' +
        '<td title="' + esc(g.company) + '">' + esc(g.company) + '</td>' +
        '</tr>';
    });

    // Hub semantic reach
    var hrList = document.getElementById('hub-reach-list');
    DATA.vectorInsights.hubReach.forEach(function(h) {
      var tierColors = { gold: '#FFD700', silver: '#C0C0C0', bronze: '#CD7F32', watch: '#555' };
      var barSegments = h.neighbors.map(function(n) {
        var c = tierColors[n.tier] || '#555';
        var op = (0.4 + n.similarity * 0.6).toFixed(2);
        return '<div title="' + esc(n.name) + ' (' + (n.similarity * 100).toFixed(0) + '% sim, ' + n.tier + ')" style="flex:1;height:28px;background:' + c + ';opacity:' + op + ';border-radius:3px;cursor:help;transition:opacity 0.2s;" onmouseover="this.style.opacity=1" onmouseout="this.style.opacity=' + op + '"></div>';
      }).join('');

      var tierBreakdown = {};
      h.neighbors.forEach(function(n) { tierBreakdown[n.tier] = (tierBreakdown[n.tier] || 0) + 1; });
      var breakdown = Object.entries(tierBreakdown).map(function(e) {
        return '<span class="tier-badge ' + e[0] + '" style="font-size:10px;">' + e[1] + ' ' + e[0] + '</span>';
      }).join(' ');

      hrList.innerHTML +=
        '<div class="info-card" style="margin-bottom:12px;max-width:100%;">' +
          '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">' +
            '<div class="card-name">' + clickableName(h.name, h) + '</div>' +
            '<div class="card-stats">' +
              '<span>Hub: ' + h.hubScore.toFixed(2) + '</span>' +
              '<span>Avg Sim: ' + (h.avgSimilarity * 100).toFixed(1) + '%</span>' +
              '<span>Diversity: ' + h.semanticDiversity + ' tiers</span>' +
            '</div>' +
          '</div>' +
          '<div style="font-size:11px;color:var(--text-dim);margin-bottom:4px;">Semantic Neighborhood — color = tier, opacity = similarity strength</div>' +
          '<div style="display:flex;gap:3px;margin-bottom:8px;">' + barSegments + '</div>' +
          '<div>' + breakdown + '</div>' +
        '</div>';
    });
  }

  // ---------------------------------------------------------------------------
  // Pipeline Dashboard
  // ---------------------------------------------------------------------------
  (function renderPipeline() {
    var container = document.getElementById('pipeline-content');
    if (!container || !DATA.pipeline) return;
    var p = DATA.pipeline;

    if (!p.hasData) {
      container.innerHTML =
        '<div style="background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:32px;text-align:center;">' +
          '<p style="color:var(--text-dim);font-size:15px;margin-bottom:8px;">No outreach data yet.</p>' +
          '<p style="color:var(--text-dim);font-size:13px;">Run <code style="background:var(--surface2);padding:2px 8px;border-radius:4px;">node targeted-plan.mjs</code> to generate outreach plans.</p>' +
        '</div>';
      return;
    }

    var STAGE_COLORS = {
      planned: '#4CAF50',
      sent: '#2196F3',
      pending_response: '#FF9800',
      responded: '#9C27B0',
      engaged: '#E91E63',
      converted: '#FFD700',
      declined: '#f44336',
      deferred: '#9E9E9E',
      closed_lost: '#795548'
    };

    var html = '';

    // --- Stat cards ---
    html += '<div class="stat-cards" style="margin-bottom:24px;">';
    [
      { v: p.totalContacts, l: 'Total Contacts', cls: 'accent' },
      { v: p.activeOutreach, l: 'Active Outreach', cls: '' },
      { v: p.states.converted, l: 'Converted', color: '#FFD700' },
      { v: p.states.responded + p.states.engaged, l: 'Responded/Engaged', color: '#9C27B0' },
      { v: p.states.declined + p.states.closed_lost, l: 'Lost', color: '#f44336' },
    ].forEach(function(s) {
      var colorStyle = s.color ? 'color:' + s.color : '';
      html += '<div class="stat-card ' + (s.cls || '') + '">' +
        '<div class="value" style="' + colorStyle + '">' + s.v + '</div>' +
        '<div class="label">' + s.l + '</div></div>';
    });
    html += '</div>';

    // --- Funnel Visualization ---
    html += '<div style="background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:20px;margin-bottom:24px;">';
    html += '<h3 style="font-size:16px;font-weight:600;color:var(--accent2);margin:0 0 16px;">Outreach Funnel</h3>';
    p.funnel.forEach(function(stage) {
      var color = STAGE_COLORS[stage.key] || '#666';
      var widthPct = Math.max(stage.pct, 4); // min width for visibility
      html += '<div style="margin-bottom:8px;">';
      html += '<div style="display:flex;align-items:center;gap:12px;">';
      html += '<div style="width:100px;font-size:13px;color:var(--text-dim);text-align:right;flex-shrink:0;">' + esc(stage.stage) + '</div>';
      html += '<div style="flex:1;position:relative;height:32px;background:var(--surface2);border-radius:6px;overflow:hidden;">';
      html += '<div style="height:100%;width:' + widthPct + '%;background:' + color + ';border-radius:6px;transition:width 0.3s ease;display:flex;align-items:center;padding:0 10px;min-width:60px;">';
      html += '<span style="font-size:12px;font-weight:600;color:#fff;white-space:nowrap;">' + stage.count + ' (' + stage.pct + '%)</span>';
      html += '</div></div></div></div>';
    });
    html += '</div>';

    // --- State Summary Cards ---
    html += '<h3 style="font-size:16px;font-weight:600;color:var(--accent2);margin:0 0 12px;">State Breakdown</h3>';
    html += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:12px;margin-bottom:24px;">';
    var stateOrder = ['planned','sent','pending_response','responded','engaged','converted','declined','deferred','closed_lost'];
    stateOrder.forEach(function(state) {
      var count = p.states[state] || 0;
      var color = STAGE_COLORS[state] || '#666';
      var label = state.replace(/_/g, ' ').replace(/\b\w/g, function(c) { return c.toUpperCase(); });
      html += '<div style="background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:14px;text-align:center;border-left:3px solid ' + color + ';">';
      html += '<div style="font-size:24px;font-weight:700;color:' + color + ';">' + count + '</div>';
      html += '<div style="font-size:11px;color:var(--text-dim);margin-top:4px;">' + esc(label) + '</div>';
      html += '</div>';
    });
    html += '</div>';

    // --- Conversion Rate Table ---
    html += '<div style="background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:20px;margin-bottom:24px;">';
    html += '<h3 style="font-size:16px;font-weight:600;color:var(--accent2);margin:0 0 12px;">Stage-to-Stage Conversion Rates</h3>';
    html += '<table class="data-table" id="pipeline-conversion-table"><thead><tr>';
    html += '<th>From</th><th>To</th><th>Conversion Rate</th><th>Visual</th>';
    html += '</tr></thead><tbody>';
    var convEntries = Object.entries(p.conversionRates);
    convEntries.forEach(function(entry) {
      var key = entry[0];
      var rate = entry[1];
      var parts = key.split('_to_');
      var from = parts[0].replace(/_/g, ' ').replace(/\b\w/g, function(c) { return c.toUpperCase(); });
      var to = parts[1].replace(/_/g, ' ').replace(/\b\w/g, function(c) { return c.toUpperCase(); });
      var barColor = rate >= 50 ? '#22c55e' : rate >= 20 ? '#f59e0b' : '#ef4444';
      html += '<tr>';
      html += '<td>' + esc(from) + '</td>';
      html += '<td>' + esc(to) + '</td>';
      html += '<td style="font-weight:600;">' + rate + '%</td>';
      html += '<td style="width:200px;"><div style="height:8px;background:var(--surface2);border-radius:4px;overflow:hidden;">';
      html += '<div style="height:100%;width:' + Math.max(rate, 2) + '%;background:' + barColor + ';border-radius:4px;"></div>';
      html += '</div></td>';
      html += '</tr>';
    });
    html += '</tbody></table></div>';

    // --- CSV Export ---
    html += '<button class="export-btn" onclick="exportPipelineCSV()">Export Pipeline CSV</button>';
    html += '<p style="color:var(--text-dim);font-size:12px;margin-top:8px;">Last updated: ' + esc(p.lastUpdated) + '</p>';

    container.innerHTML = html;
  })();

  // Pipeline CSV export
  window.exportPipelineCSV = function() {
    if (!DATA.pipeline || !DATA.pipeline.hasData) return;
    var p = DATA.pipeline;
    var rows = ['State,Count'];
    var stateOrder = ['planned','sent','pending_response','responded','engaged','converted','declined','deferred','closed_lost'];
    stateOrder.forEach(function(s) {
      rows.push(s + ',' + (p.states[s] || 0));
    });
    rows.push('');
    rows.push('Funnel Stage,Count,Percentage');
    p.funnel.forEach(function(f) {
      rows.push(f.stage + ',' + f.count + ',' + f.pct + '%');
    });
    rows.push('');
    rows.push('Conversion,Rate');
    Object.entries(p.conversionRates).forEach(function(e) {
      var label = e[0].replace(/_to_/g, ' -> ').replace(/_/g, ' ');
      rows.push(label + ',' + e[1] + '%');
    });
    rows.push('');
    rows.push('Total Contacts,' + p.totalContacts);
    rows.push('Active Outreach,' + p.activeOutreach);
    var csv = rows.join('\\n');
    var blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    var link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'pipeline-dashboard.csv';
    link.click();
  };

  // ---------------------------------------------------------------------------
  // Active sidebar link tracking
  // ---------------------------------------------------------------------------
  const sidebarLinks = document.querySelectorAll('.sidebar a');
  const sections = [...document.querySelectorAll('.section, .header')];
  window.addEventListener('scroll', () => {
    let current = '';
    for (const s of sections) {
      if (s.getBoundingClientRect().top <= 100) current = s.id;
    }
    sidebarLinks.forEach(a => {
      a.classList.toggle('active', a.getAttribute('href') === '#' + current);
    });
  });

})();
<\/script>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

(async () => {
  const args = parseArgs(process.argv);
  const topN = parseInt(args.top, 10) || 200;
  const outputPath = args.output
    ? resolve(process.cwd(), args.output)
    : DEFAULT_OUTPUT;

  console.log(`Loading graph.json...`);
  const graph = loadGraph();

  console.log(`Computing report data (top ${topN} contacts)...`);
  const data = computeReportData(graph, topN);

  // Pipeline data from outreach-state.json
  console.log(`Computing pipeline data...`);
  data.pipeline = computePipelineData();

  console.log(`Computing vector intelligence...`);
  data.vectorInsights = await computeVectorData(graph);
  if (data.vectorInsights.available) {
    console.log(`  Vector store: ${data.vectorInsights.storeSize} contacts`);
    console.log(`  Gold neighborhoods: ${data.vectorInsights.goldNeighbors.length}`);
    console.log(`  Hidden gems found: ${data.vectorInsights.hiddenGems.length}`);

    // Add vector-powered recommendation
    if (data.vectorInsights.hiddenGems.length > 0) {
      data.recommendations.push({
        category: 'Vector-Discovered Prospects',
        icon: 'search',
        items: data.vectorInsights.hiddenGems.slice(0, 5).map(g => ({
          name: g.name,
          detail: `${(g.similarity * 100).toFixed(0)}% similar to ${g.similarTo} — currently ${g.tier}`,
          action: 'Review and potentially upgrade — their profile closely matches your gold contacts',
        })),
      });
    }
  } else {
    console.log(`  Vector store not available — skipping vector sections`);
  }

  console.log(`Generating HTML...`);
  const html = generateHTML(data);

  writeFileSync(outputPath, html, 'utf-8');
  console.log(`Report written to ${outputPath}`);
  console.log(`  Nodes: ${data.meta.graphNodes}, Edges: ${data.meta.edgeCount}`);
  console.log(`  Open in browser: file://${outputPath}`);
})();
