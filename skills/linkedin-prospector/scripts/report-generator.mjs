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

function computeReportData(graph, topN) {
  const allContacts = Object.entries(graph.contacts)
    .map(([url, c]) => ({ url, ...c }))
    .filter(c => c.scores);

  // Sort by goldScore desc, take top N
  const topContacts = [...allContacts]
    .sort((a, b) => (b.scores.goldScore || 0) - (a.scores.goldScore || 0))
    .slice(0, topN);

  const topUrls = new Set(topContacts.map(c => c.url));

  // Edges between top contacts only
  const edges = (graph.edges || []).filter(
    e => topUrls.has(e.source) && topUrls.has(e.target)
  );

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

  // All top contacts for tables (full data for modal + explorer)
  const tableContacts = topContacts.map(c => ({
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
      daysAgo: c.behavioralSignals?.connectedDaysAgo,
      role: c.currentRole || c.headline || '',
    }));

  // Degree-2 discovered contacts
  const degree2Contacts = allContacts
    .filter(c => (c.degree || 1) >= 2)
    .sort((a, b) => (b.scores?.goldScore || 0) - (a.scores?.goldScore || 0))
    .map(c => ({
      name: c.enrichedName || c.name || 'Unknown',
      url: c.url,
      goldScore: c.scores?.goldScore || 0,
      tier: c.scores?.tier || 'watch',
      behavioral: c.behavioralScore || 0,
      degree: c.degree || 2,
      mutuals: c.mutualConnections || 0,
      discoveredVia: (c.discoveredVia || []).length,
      role: c.currentRole || c.headline || '',
      company: c.currentCompany || '',
    }));

  // Recommendations
  const recommendations = buildRecommendations(graph, allContacts);

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
    nodes,
    edges: edges.map(e => ({
      source: e.source,
      target: e.target,
      type: e.type,
      weight: e.weight || 0.5,
    })),
    tableContacts,
    hubs,
    superConnectors,
    topEmployers,
    bridges,
    silentInfluencers,
    risingStars,
    degree2Contacts,
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
        detail: `Super-connector — behavioral ${c.behavioralScore?.toFixed(2)}`,
        action: 'Comment on their posts to leverage their amplification power',
      })),
    });
  }

  return recs;
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
  height: 600px;
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

/* Print */
@media print {
  .sidebar { display: none; }
  .main { margin-left: 0; }
  #graph-container { display: none; }
  .graph-controls { display: none; }
  .modal-overlay { display: none !important; }
  body { background: #fff; color: #000; }
  .section h2 { border-color: #000; }
}
</style>
</head>
<body>

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

<!-- Sidebar Navigation -->
<nav class="sidebar">
  <h2>NETWORK INTEL</h2>
  <a href="#header">Overview</a>
  <a href="#graph">3D Network Graph</a>
  <a href="#distributions">Score Distributions</a>
  <a href="#contacts">Top Contacts</a>
  <a href="#hubs">Network Hubs</a>
  <a href="#super-connectors">Super-Connectors</a>
  <a href="#referral-partners">Referral Partners</a>
  <a href="#employers">Company Beachheads</a>
  <a href="#visibility">Visibility Strategy</a>
  <a href="#data-explorer">Data Explorer</a>
  <a href="#recommendations">Recommended Actions</a>
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

<!-- Section 3: Top Contacts Table -->
<div class="section" id="contacts">
  <h2>Top Contacts</h2>
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
  <div class="info-list" id="hubs-list"></div>
</div>

<!-- Section 5: Super-Connectors -->
<div class="section" id="super-connectors">
  <h2>Super-Connectors</h2>
  <p style="color:var(--text-dim);margin-bottom:16px;">Top behavioral super-connectors — engage their content to amplify your visibility.</p>
  <div class="info-list" id="sc-list"></div>
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
    <div style="overflow-x:auto;">
      <table class="data-table" id="table-all"><thead><tr>
        <th data-sort="name">Name</th><th data-sort="goldScore">Gold</th><th data-sort="tier">Tier</th>
        <th data-sort="icpFit">ICP</th><th data-sort="networkHub">Hub</th><th data-sort="behavioral">Behav</th>
        <th data-sort="degree">Deg</th><th data-sort="persona">Persona</th><th data-sort="role">Role</th><th data-sort="company">Company</th>
      </tr></thead><tbody></tbody></table>
    </div>
  </div>
  <div class="tab-panel" id="tab-hubs">
    <div style="overflow-x:auto;">
      <table class="data-table"><thead><tr>
        <th>Name</th><th>Hub Score</th><th>Gold Score</th><th>Tier</th><th>Mutuals</th><th>Role</th><th>Company</th><th>Clusters</th>
      </tr></thead><tbody id="tbody-hubs"></tbody></table>
    </div>
  </div>
  <div class="tab-panel" id="tab-sc">
    <div style="overflow-x:auto;">
      <table class="data-table"><thead><tr>
        <th>Name</th><th>Behavioral</th><th>Gold Score</th><th>Tier</th><th>Traits</th><th>Role</th><th>Company</th>
      </tr></thead><tbody id="tbody-sc"></tbody></table>
    </div>
  </div>
  <div class="tab-panel" id="tab-companies">
    <div style="overflow-x:auto;">
      <table class="data-table"><thead><tr>
        <th>Company</th><th>ENV</th><th>Contacts</th><th>Gold</th><th>Gold %</th><th>Avg Behavioral</th><th>Avg Mutuals</th>
      </tr></thead><tbody id="tbody-companies"></tbody></table>
    </div>
  </div>
  <div class="tab-panel" id="tab-referrals">
    <div style="overflow-x:auto;">
      <table class="data-table"><thead><tr>
        <th>Name</th><th>Referral Score</th><th>Ref Tier</th><th>Persona</th><th>Gold Score</th><th>ICP Tier</th><th>Role</th><th>Company</th>
      </tr></thead><tbody id="tbody-referrals"></tbody></table>
    </div>
  </div>
  <div class="tab-panel" id="tab-deg2">
    <p style="color:var(--text-dim);margin-bottom:12px;">Contacts discovered via deep-scan of your 1st-degree network. These are reachable through warm introductions.</p>
    <div style="overflow-x:auto;">
      <table class="data-table"><thead><tr>
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

</div><!-- .main -->

<script>
(function() {
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
  const TIER_COLORS = { gold: '#FFD700', silver: '#C0C0C0', bronze: '#CD7F32', watch: '#8888AA' };
  const EDGE_COLORS = {
    'same-company': '#4a9eff',
    'same-cluster': '#22c55e',
    'mutual-proximity': '#777',
    'discovered-connection': '#f59e0b',
    'shared-connection': '#ec4899',
  };

  // Populate filter dropdowns
  const clusterSelect = document.getElementById('f-cluster');
  const personaSelect = document.getElementById('f-persona');
  const allClusters = Object.keys(DATA.clusterData);
  allClusters.forEach(c => {
    const o = document.createElement('option');
    o.value = c; o.textContent = c;
    clusterSelect.appendChild(o);
  });
  const allPersonas = [...new Set(DATA.nodes.map(n => n.persona))].sort();
  allPersonas.forEach(p => {
    const o = document.createElement('option');
    o.value = p; o.textContent = p;
    personaSelect.appendChild(o);
  });

  let graph3d;

  // 3d-force-graph mutates link source/target from strings to object refs.
  // We must deep-clone from the raw DATA each time to avoid broken filters.
  function getFilteredData() {
    const tiers = {};
    ['gold','silver','bronze','watch'].forEach(t => {
      tiers[t] = document.getElementById('f-' + t).checked;
    });
    const cluster = clusterSelect.value;
    const persona = personaSelect.value;

    const filtered = DATA.nodes.filter(n => {
      if (!tiers[n.tier]) return false;
      if (cluster && !n.clusters.includes(cluster)) return false;
      if (persona && n.persona !== persona) return false;
      return true;
    });
    const ids = new Set(filtered.map(n => n.id));
    // Deep-clone nodes and links so the force engine can mutate them freely
    const clonedNodes = filtered.map(n => Object.assign({}, n));
    const clonedLinks = DATA.edges
      .filter(e => ids.has(e.source) && ids.has(e.target))
      .map(e => ({ source: e.source, target: e.target, type: e.type, weight: e.weight }));
    return { nodes: clonedNodes, links: clonedLinks };
  }

  function initGraph() {
    const container = document.getElementById('graph-container');
    const gData = getFilteredData();
    graph3d = ForceGraph3D()(container)
      .graphData(gData)
      .nodeId('id')
      .nodeVal(n => 2 + (n.goldScore || 0) * 12)
      .nodeColor(n => TIER_COLORS[n.tier] || '#8888AA')
      .nodeLabel(n => n.name + ' [' + n.degree + '\\u00B0] ' + n.tier + ' \\u00B7 gold: ' + n.goldScore.toFixed(2))
      .nodeOpacity(0.9)
      .linkSource('source')
      .linkTarget('target')
      .linkColor(l => EDGE_COLORS[l.type] || '#777')
      .linkOpacity(0.6)
      .linkWidth(l => 0.5 + (l.weight || 0.5) * 1.5)
      .linkDirectionalParticles(l => l.weight > 0.6 ? 2 : 0)
      .linkDirectionalParticleWidth(1.5)
      .linkDirectionalParticleSpeed(0.005)
      .backgroundColor('#0a0c14')
      .onNodeClick(showNodeInfo)
      .width(container.clientWidth)
      .height(600);

    // Tune forces: connected nodes cluster together via shorter link distance
    var chargeForce = graph3d.d3Force('charge');
    if (chargeForce) chargeForce.strength(-40);
    var linkForce = graph3d.d3Force('link');
    if (linkForce) linkForce.distance(60).strength(0.7);
  }

  function updateGraph() {
    if (!graph3d) return;
    const gData = getFilteredData();
    graph3d.graphData(gData);
  }

  ['f-gold','f-silver','f-bronze','f-watch'].forEach(id => {
    document.getElementById(id).addEventListener('change', updateGraph);
  });
  clusterSelect.addEventListener('change', updateGraph);
  personaSelect.addEventListener('change', updateGraph);

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
      '<span class="tier-badge ' + tier + '">' + tier.toUpperCase() + '</span>' +
      ' <span style="color:var(--text-dim);font-size:13px;margin-left:8px;">Degree ' + (item.degree || 1) + '</span>' +
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
        '<td title="' + esc(c.name) + '">' + esc(c.name) + '</td>' +
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
      '<div class="card-name">' + esc(h.name) + '</div>' +
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
      '<div class="card-name">' + esc(s.name) + '</div>' +
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
        '<td>' + esc(r.name) + '</td>' +
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
        '<div class="card-name">' + esc(item.name) + '</div>' +
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
        '<div class="rec-name">' + esc(item.name) + '</div>' +
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
        '<td>' + esc(c.name) + '</td>' +
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

  // Hubs explorer table
  document.getElementById('tbody-hubs').innerHTML = DATA.hubs.map(function(h) {
    return '<tr class="clickable-row" data-url="' + esc(h.url || '') + '">' +
      '<td>' + esc(h.name) + '</td>' +
      '<td>' + h.networkHub.toFixed(3) + '</td>' +
      '<td>' + h.goldScore.toFixed(3) + '</td>' +
      '<td><span class="tier-badge ' + h.tier + '">' + h.tier + '</span></td>' +
      '<td>' + h.mutuals + '</td>' +
      '<td title="' + esc(h.role) + '">' + esc(h.role) + '</td>' +
      '<td title="' + esc(h.company) + '">' + esc(h.company) + '</td>' +
      '<td>' + (h.clusters.join(', ') || '-') + '</td>' +
      '</tr>';
  }).join('');

  // Super-connectors explorer table
  document.getElementById('tbody-sc').innerHTML = DATA.superConnectors.map(function(s) {
    return '<tr class="clickable-row" data-url="' + esc(s.url || '') + '">' +
      '<td>' + esc(s.name) + '</td>' +
      '<td>' + s.behavioral.toFixed(3) + '</td>' +
      '<td>' + s.goldScore.toFixed(3) + '</td>' +
      '<td><span class="tier-badge ' + s.tier + '">' + s.tier + '</span></td>' +
      '<td>' + (s.traits.join(', ') || '-') + '</td>' +
      '<td title="' + esc(s.role) + '">' + esc(s.role) + '</td>' +
      '<td title="' + esc(s.company) + '">' + esc(s.company) + '</td>' +
      '</tr>';
  }).join('');

  // Companies explorer table
  document.getElementById('tbody-companies').innerHTML = DATA.topEmployers.map(function(e) {
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

  // Referrals explorer table
  var refExplorer = DATA.topReferrals || [];
  document.getElementById('tbody-referrals').innerHTML = refExplorer.length > 0 ? refExplorer.map(function(r) {
    var tierClass = r.referralTier === 'gold-referral' ? 'gold' : r.referralTier === 'silver-referral' ? 'silver' : r.referralTier === 'bronze-referral' ? 'bronze' : 'watch';
    return '<tr class="clickable-row" data-url="' + esc(r.url) + '">' +
      '<td>' + esc(r.name) + '</td>' +
      '<td>' + r.referralLikelihood.toFixed(3) + '</td>' +
      '<td><span class="tier-badge ' + tierClass + '">' + (r.referralTier || 'none') + '</span></td>' +
      '<td>' + esc(r.referralPersona) + '</td>' +
      '<td>' + r.goldScore.toFixed(3) + '</td>' +
      '<td><span class="tier-badge ' + r.tier + '">' + r.tier + '</span></td>' +
      '<td title="' + esc(r.role) + '">' + esc(r.role) + '</td>' +
      '<td title="' + esc(r.company) + '">' + esc(r.company) + '</td>' +
      '</tr>';
  }).join('') : '<tr><td colspan="8" style="text-align:center;color:var(--text-dim);padding:24px;">No referral scores yet. Run referral-scorer.mjs first.</td></tr>';

  // Degree-2 explorer table
  var deg2 = DATA.degree2Contacts || [];
  document.getElementById('tbody-deg2').innerHTML = deg2.length > 0 ? deg2.map(function(c) {
    return '<tr class="clickable-row" data-url="' + esc(c.url) + '">' +
      '<td>' + esc(c.name) + '</td>' +
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

  // Utility
  function esc(s) {
    if (!s) return '';
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }
})();
<\/script>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const args = parseArgs(process.argv);
const topN = parseInt(args.top, 10) || 200;
const outputPath = args.output
  ? resolve(process.cwd(), args.output)
  : DEFAULT_OUTPUT;

console.log(`Loading graph.json...`);
const graph = loadGraph();

console.log(`Computing report data (top ${topN} contacts)...`);
const data = computeReportData(graph, topN);

console.log(`Generating HTML...`);
const html = generateHTML(data);

writeFileSync(outputPath, html, 'utf-8');
console.log(`Report written to ${outputPath}`);
console.log(`  Nodes: ${data.meta.graphNodes}, Edges: ${data.meta.edgeCount}`);
console.log(`  Open in browser: file://${outputPath}`);
