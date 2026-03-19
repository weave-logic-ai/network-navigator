/**
 * icp-niche-report.mjs -- Reverse ICP & Niche Discovery Report
 *
 * Analyzes your vector store to discover your ideal customer profile and
 * strongest niches based on semantic proximity of your actual contacts.
 *
 * Usage:
 *   node icp-niche-report.mjs [--output path]
 *
 * Default: --output ../data/icp-niche-report.html
 */

import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { parseArgs, DATA_DIR } from './lib.mjs';
import {
  isRvfAvailable, openStore, getContact, queryStore,
  storeLength, closeStore,
} from './rvf-store.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const GRAPH_PATH = resolve(DATA_DIR, 'graph.json');
const DEFAULT_OUTPUT = resolve(DATA_DIR, 'icp-niche-report.html');

// ---------------------------------------------------------------------------
// Data loading
// ---------------------------------------------------------------------------

function loadGraph() {
  return JSON.parse(readFileSync(GRAPH_PATH, 'utf-8'));
}

// ---------------------------------------------------------------------------
// Keyword extraction
// ---------------------------------------------------------------------------

const STOP = new Set(
  'the and for with that this from have been will more than also based over into about their your what when where which while each most some only just very them these those other like make made many much then here well work help best lead self team high area part full time year years new first last next using across does used able sure open sure'.split(' ')
);

function words(text) {
  if (!text) return [];
  return text.toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').split(/\s+/).filter(w => w.length > 3 && !STOP.has(w));
}

function topKw(obj, n) {
  return Object.entries(obj).sort((a, b) => b[1] - a[1]).slice(0, n);
}

// ---------------------------------------------------------------------------
// Compute report data
// ---------------------------------------------------------------------------

async function computeData(graph) {
  const contacts = Object.entries(graph.contacts)
    .map(([url, c]) => ({ url, ...c }))
    .filter(c => c.scores);

  const tiers = { gold: [], silver: [], bronze: [], watch: [] };
  contacts.forEach(c => {
    const t = c.scores?.tier || 'watch';
    if (tiers[t]) tiers[t].push(c);
  });

  // ── Keyword analysis (gold-score weighted) ──
  const roleKw = {}, headlineKw = {}, aboutKw = {};
  contacts.forEach(c => {
    const w = c.scores?.goldScore || 0;
    words(c.currentRole || '').forEach(k => { roleKw[k] = (roleKw[k] || 0) + w; });
    words(c.headline || '').forEach(k => { headlineKw[k] = (headlineKw[k] || 0) + w; });
    words((c.about || '').substring(0, 300)).forEach(k => { aboutKw[k] = (aboutKw[k] || 0) + w; });
  });

  // ── Cluster analysis ──
  const clusters = Object.entries(graph.clusters || {}).map(([id, cl]) => {
    const clContacts = cl.contacts.map(u => graph.contacts[u]).filter(Boolean);
    const goldCount = clContacts.filter(c => c.scores?.tier === 'gold').length;
    const silverCount = clContacts.filter(c => c.scores?.tier === 'silver').length;
    const bronzeCount = clContacts.filter(c => c.scores?.tier === 'bronze').length;
    const avgGold = clContacts.reduce((s, c) => s + (c.scores?.goldScore || 0), 0) / (clContacts.length || 1);
    const goldDensity = clContacts.length > 0 ? (goldCount + silverCount * 0.5) / clContacts.length : 0;
    return {
      id, size: cl.contacts.length,
      keywords: cl.keywords || [],
      goldCount, silverCount, bronzeCount,
      watchCount: clContacts.length - goldCount - silverCount - bronzeCount,
      avgGold, goldDensity,
    };
  }).sort((a, b) => b.goldDensity - a.goldDensity);

  // ── Company analysis ──
  const companyMap = {};
  contacts.forEach(c => {
    let co = (c.currentCompany || '').trim();
    // Clean up LinkedIn company format artifacts
    if (!co || co.startsWith('Full-time') || co === 'Self-employed' || co === 'Career Break') return;
    co = co.replace(/ · Full-time$/, '').replace(/ · Part-time$/, '').replace(/ · Contract$/, '').replace(/ · Freelance$/, '').trim();
    if (!co) return;
    if (!companyMap[co]) companyMap[co] = { count: 0, goldSum: 0, tiers: { gold: 0, silver: 0, bronze: 0, watch: 0 } };
    companyMap[co].count++;
    companyMap[co].goldSum += c.scores?.goldScore || 0;
    companyMap[co].tiers[c.scores?.tier || 'watch']++;
  });
  const topCompanies = Object.entries(companyMap)
    .filter(([, v]) => v.count >= 2)
    .sort((a, b) => b[1].goldSum - a[1].goldSum)
    .slice(0, 20)
    .map(([name, v]) => ({ name, ...v, avgGold: v.goldSum / v.count }));

  // ── Persona distribution ──
  const personaCounts = {};
  contacts.forEach(c => {
    const p = c.personaType || 'unknown';
    personaCounts[p] = (personaCounts[p] || 0) + 1;
  });
  const behCounts = {};
  contacts.forEach(c => {
    const p = c.behavioralPersona || 'unknown';
    behCounts[p] = (behCounts[p] || 0) + 1;
  });

  // ── Vector analysis ──
  let vectorData = null;
  if (isRvfAvailable()) {
    const storeSize = await storeLength();
    if (storeSize > 0) {
      vectorData = { storeSize };

      // Gold centroid
      const goldVectors = [];
      for (const gc of tiers.gold) {
        const nUrl = gc.url.replace(/\/$/, '').split('?')[0];
        const stored = await getContact(nUrl);
        if (stored) goldVectors.push(stored.vector);
      }

      if (goldVectors.length > 0) {
        const dim = goldVectors[0].length;
        const centroid = new Array(dim).fill(0);
        for (const v of goldVectors) for (let i = 0; i < dim; i++) centroid[i] += v[i];
        for (let i = 0; i < dim; i++) centroid[i] /= goldVectors.length;
        const norm = Math.sqrt(centroid.reduce((s, x) => s + x * x, 0));
        for (let i = 0; i < dim; i++) centroid[i] /= norm;

        // Contacts nearest to gold centroid
        const centroidResults = await queryStore(centroid, 40);
        vectorData.centroidContacts = (centroidResults || []).map(r => ({
          name: r.metadata?.name || 'Unknown',
          url: r.id,
          tier: r.metadata?.tier || 'watch',
          degree: r.metadata?.degree || (graph.contacts[r.id]?.degree) || 1,
          similarity: Math.max(0, 1 - (r.score || 0)),
          goldScore: r.metadata?.goldScore || 0,
          role: r.metadata?.currentRole || r.metadata?.headline || '',
          company: r.metadata?.currentCompany || '',
          persona: r.metadata?.persona || '',
        }));

        // Promotion candidates (non-gold nearest to gold centroid)
        vectorData.promotionCandidates = vectorData.centroidContacts
          .filter(c => c.tier !== 'gold')
          .slice(0, 20);

        // Network centroid (broader sample)
        const allVectors = [];
        for (const c of contacts.slice(0, 300)) {
          const nUrl = c.url.replace(/\/$/, '').split('?')[0];
          const stored = await getContact(nUrl);
          if (stored) allVectors.push(stored.vector);
        }

        if (allVectors.length > 0) {
          const netCentroid = new Array(dim).fill(0);
          for (const v of allVectors) for (let i = 0; i < dim; i++) netCentroid[i] += v[i];
          for (let i = 0; i < dim; i++) netCentroid[i] /= allVectors.length;
          const nNorm = Math.sqrt(netCentroid.reduce((s, x) => s + x * x, 0));
          for (let i = 0; i < dim; i++) netCentroid[i] /= nNorm;

          // Gold-Network alignment
          let dot = 0;
          for (let i = 0; i < dim; i++) dot += centroid[i] * netCentroid[i];
          vectorData.goldNetAlignment = dot;
          vectorData.networkSampleSize = allVectors.length;

          // Network centroid contacts
          const netResults = await queryStore(netCentroid, 15);
          vectorData.networkCenter = (netResults || []).map(r => ({
            name: r.metadata?.name || 'Unknown',
            url: r.id,
            tier: r.metadata?.tier || 'watch',
            similarity: Math.max(0, 1 - (r.score || 0)),
            role: r.metadata?.currentRole || r.metadata?.headline || '',
          }));
        }

        // Niche centroids — compute centroid per cluster and find representative contacts
        vectorData.nicheCentroids = [];
        for (const cl of clusters.slice(0, 8)) {
          const clVectors = [];
          const clUrls = (graph.clusters[cl.id]?.contacts || []);
          for (const u of clUrls.slice(0, 50)) {
            const nUrl = u.replace(/\/$/, '').split('?')[0];
            const stored = await getContact(nUrl);
            if (stored) clVectors.push(stored.vector);
          }
          if (clVectors.length < 3) continue;

          const clCentroid = new Array(dim).fill(0);
          for (const v of clVectors) for (let i = 0; i < dim; i++) clCentroid[i] += v[i];
          for (let i = 0; i < dim; i++) clCentroid[i] /= clVectors.length;
          const clNorm = Math.sqrt(clCentroid.reduce((s, x) => s + x * x, 0));
          for (let i = 0; i < dim; i++) clCentroid[i] /= clNorm;

          // How close is this niche centroid to the gold centroid?
          let clDot = 0;
          for (let i = 0; i < dim; i++) clDot += centroid[i] * clCentroid[i];

          // Find representative contacts for this niche
          const clResults = await queryStore(clCentroid, 5);
          const reps = (clResults || []).map(r => ({
            name: r.metadata?.name || 'Unknown',
            tier: r.metadata?.tier || 'watch',
            degree: r.metadata?.degree || (graph.contacts[r.id]?.degree) || 1,
            similarity: Math.max(0, 1 - (r.score || 0)),
            role: r.metadata?.currentRole || r.metadata?.headline || '',
          }));

          vectorData.nicheCentroids.push({
            id: cl.id,
            keywords: cl.keywords,
            size: cl.size,
            goldCount: cl.goldCount,
            silverCount: cl.silverCount,
            goldDensity: cl.goldDensity,
            icpAlignment: clDot,
            representatives: reps,
          });
        }
        vectorData.nicheCentroids.sort((a, b) => b.icpAlignment - a.icpAlignment);
      }

      await closeStore();
    }
  }

  return {
    meta: {
      generated: new Date().toISOString(),
      totalContacts: contacts.length,
    },
    tierCounts: {
      gold: tiers.gold.length,
      silver: tiers.silver.length,
      bronze: tiers.bronze.length,
      watch: tiers.watch.length,
    },
    goldContacts: tiers.gold
      .sort((a, b) => (b.scores?.goldScore || 0) - (a.scores?.goldScore || 0))
      .map(c => ({
        name: c.enrichedName || c.name,
        url: c.url,
        goldScore: c.scores?.goldScore || 0,
        degree: c.degree || 1,
        role: c.currentRole || c.headline || '',
        company: c.currentCompany || '',
        persona: c.personaType || '',
      })),
    silverContacts: tiers.silver.map(c => ({ degree: c.degree || 1 })),
    bronzeContacts: tiers.bronze.map(c => ({ degree: c.degree || 1 })),
    watchContacts: tiers.watch.map(c => ({ degree: c.degree || 1 })),
    roleKeywords: topKw(roleKw, 25).map(([word, weight]) => ({ word, weight })),
    headlineKeywords: topKw(headlineKw, 25).map(([word, weight]) => ({ word, weight })),
    aboutKeywords: topKw(aboutKw, 20).map(([word, weight]) => ({ word, weight })),
    clusters,
    topCompanies,
    personaCounts,
    behCounts,
    vectorData,
  };
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
<title>ICP & Niche Discovery Report</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"><\/script>
<style>
:root {
  --bg: #0f1117; --surface: #1a1d27; --surface2: #232633; --border: #2d3148;
  --text: #e1e4ed; --text-dim: #8b8fa3;
  --gold: #FFD700; --silver: #C0C0C0; --bronze: #CD7F32; --watch: #666;
  --accent: #6366f1; --accent2: #818cf8; --green: #22c55e; --blue: #3b82f6;
  --orange: #f59e0b; --red: #ef4444; --pink: #ec4899;
}
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: var(--bg); color: var(--text); line-height: 1.6; }
a { color: var(--accent2); text-decoration: none; }
a:hover { text-decoration: underline; }

.sidebar { position: fixed; top: 0; left: 0; width: 220px; height: 100vh; background: var(--surface); border-right: 1px solid var(--border); padding: 20px 0; overflow-y: auto; z-index: 100; }
.sidebar h2 { font-size: 14px; color: var(--accent2); padding: 0 16px; margin-bottom: 16px; letter-spacing: 0.5px; }
.sidebar a { display: block; padding: 8px 16px; font-size: 13px; color: var(--text-dim); transition: all 0.2s; }
.sidebar a:hover, .sidebar a.active { color: var(--text); background: var(--surface2); text-decoration: none; }
.main { margin-left: 220px; padding: 32px 40px; max-width: 1200px; }

.header { margin-bottom: 40px; padding-bottom: 24px; border-bottom: 1px solid var(--border); }
.header h1 { font-size: 28px; font-weight: 700; margin-bottom: 4px; }
.header .subtitle { color: var(--text-dim); font-size: 14px; }

.stat-cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 16px; margin: 20px 0; }
.stat-card { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 16px; text-align: center; }
.stat-card .value { font-size: 28px; font-weight: 700; }
.stat-card .label { font-size: 12px; color: var(--text-dim); margin-top: 4px; }
.stat-card.gold .value { color: var(--gold); }
.stat-card.silver .value { color: var(--silver); }
.stat-card.accent .value { color: var(--accent2); }
.stat-card.green .value { color: var(--green); }

.section { margin-bottom: 48px; }
.section h2 { font-size: 22px; font-weight: 600; margin-bottom: 16px; padding-bottom: 8px; border-bottom: 2px solid var(--accent); display: inline-block; }
.section h3 { font-size: 16px; font-weight: 600; margin: 24px 0 10px; color: var(--accent2); }

.chart-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(380px, 1fr)); gap: 24px; }
.chart-card { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 20px; }
.chart-card h3 { font-size: 14px; color: var(--text-dim); margin: 0 0 12px; }
.chart-card canvas { max-height: 280px; }

.data-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.data-table th { text-align: left; padding: 10px 12px; background: var(--surface2); color: var(--text-dim); font-weight: 600; white-space: nowrap; border-bottom: 2px solid var(--border); }
.data-table td { padding: 8px 12px; border-bottom: 1px solid var(--border); max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.data-table tr:hover { background: var(--surface2); }
.tier-badge { display: inline-block; padding: 2px 8px; border-radius: 12px; font-size: 11px; font-weight: 600; text-transform: uppercase; }
.tier-badge.gold { background: rgba(255,215,0,0.2); color: var(--gold); }
.tier-badge.silver { background: rgba(192,192,192,0.2); color: var(--silver); }
.tier-badge.bronze { background: rgba(205,127,50,0.2); color: var(--bronze); }
.tier-badge.watch { background: rgba(102,102,102,0.2); color: var(--watch); }

.info-card { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 16px; margin-bottom: 12px; }
.info-card .card-name { font-weight: 600; font-size: 15px; margin-bottom: 4px; }
.info-card .card-role { color: var(--text-dim); font-size: 13px; margin-bottom: 8px; }

.kw-bar-container { display: flex; flex-direction: column; gap: 6px; }
.kw-row { display: flex; align-items: center; gap: 10px; font-size: 13px; }
.kw-label { width: 140px; text-align: right; color: var(--text-dim); flex-shrink: 0; }
.kw-bar { height: 20px; border-radius: 3px; transition: width 0.5s ease; }
.kw-value { width: 50px; font-size: 12px; color: var(--text-dim); }

.niche-card { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 20px; margin-bottom: 16px; }
.niche-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
.niche-title { font-size: 18px; font-weight: 700; text-transform: capitalize; }
.niche-meta { display: flex; gap: 12px; font-size: 12px; color: var(--text-dim); flex-wrap: wrap; }
.niche-meta span { background: var(--surface2); padding: 2px 8px; border-radius: 4px; }
.alignment-bar { height: 8px; background: var(--surface2); border-radius: 4px; overflow: hidden; margin: 8px 0; }
.alignment-fill { height: 100%; border-radius: 4px; transition: width 0.5s ease; }

.promo-card { display: flex; justify-content: space-between; align-items: center; padding: 10px 0; border-bottom: 1px solid var(--border); }
.promo-card:last-child { border-bottom: none; }
.promo-info { flex: 1; min-width: 0; }
.promo-name { font-weight: 600; font-size: 14px; }
.promo-role { font-size: 12px; color: var(--text-dim); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.promo-scores { display: flex; gap: 12px; align-items: center; flex-shrink: 0; }
.promo-sim { font-size: 18px; font-weight: 700; color: var(--accent2); }
.promo-gold { font-size: 12px; color: var(--text-dim); }

.exec-summary { background: linear-gradient(135deg, rgba(99,102,241,0.1), rgba(129,140,248,0.05)); border: 1px solid rgba(99,102,241,0.3); border-radius: 12px; padding: 24px; margin-bottom: 32px; }
.exec-summary h3 { color: var(--accent2); margin: 0 0 12px; font-size: 18px; }
.exec-summary p { color: var(--text); line-height: 1.8; }
.exec-summary .highlight { color: var(--gold); font-weight: 600; }
.exec-summary .metric { color: var(--accent2); font-weight: 600; }

/* Degree badges */
.degree-badge { display: inline-block; padding: 1px 6px; border-radius: 10px; font-size: 10px; font-weight: 600; margin-left: 4px; vertical-align: middle; }
.degree-badge.d1 { background: rgba(34,197,94,0.2); color: #22c55e; }
.degree-badge.d2 { background: rgba(59,130,246,0.2); color: #3b82f6; }
.degree-badge.d3 { background: rgba(245,158,11,0.2); color: #f59e0b; }

/* Export button */
.export-btn { display: inline-block; padding: 6px 14px; background: var(--accent); color: white; border: none; border-radius: 6px; font-size: 12px; font-weight: 600; cursor: pointer; transition: all 0.2s; margin-bottom: 12px; }
.export-btn:hover { background: var(--accent2); }

/* Navigation bar */
.nav-bar { background: var(--surface); border-bottom: 1px solid var(--border); padding: 12px 0; margin-bottom: 24px; position: sticky; top: 0; z-index: 50; }
.nav-bar-inner { max-width: 1200px; margin: 0 auto; display: flex; gap: 16px; align-items: center; padding: 0 40px; }
.nav-link { padding: 6px 16px; border-radius: 6px; font-size: 13px; font-weight: 600; color: var(--text-dim); transition: all 0.2s; }
.nav-link:hover { background: var(--surface2); color: var(--text); text-decoration: none; }
.nav-link.active { background: var(--accent); color: white; }

/* Niche badges */
.niche-badges { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 8px; }
.count-badge { display: inline-block; padding: 3px 10px; border-radius: 12px; font-size: 11px; font-weight: 600; background: var(--surface2); color: var(--text-dim); }
.count-badge.gold-avg { background: rgba(255,215,0,0.2); color: var(--gold); }

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

@media print {
  .sidebar { display: none; }
  .main { margin-left: 0; }
  body { background: #fff; color: #000; }
  .contact-modal-overlay { display: none !important; }
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

<nav class="sidebar">
  <h2>ICP & NICHE</h2>
  <a href="#header">Overview</a>
  <a href="#exec-summary">Executive Summary</a>
  <a href="#gold-profile">Gold ICP Profile</a>
  <a href="#niche-map">Niche Map</a>
  <a href="#keywords">Keyword DNA</a>
  <a href="#centroid">ICP Centroid</a>
  <a href="#promotion">Promotion Candidates</a>
  <a href="#companies">Company Clusters</a>
  <a href="#personas">Network Personas</a>
</nav>

<div class="main">
<script>const DATA = ${dataJSON};<\/script>

<!-- Navigation Bar -->
<div class="nav-bar">
  <div class="nav-bar-inner">
    <a href="network-report.html" class="nav-link">Network Report</a>
    <a href="icp-niche-report.html" class="nav-link active">ICP Niche Report</a>
  </div>
</div>

<div class="header" id="header">
  <h1>ICP & Niche Discovery Report</h1>
  <p class="subtitle">Reverse-engineered from <span id="total-contacts"></span> scored contacts &middot; Generated <span id="gen-date"></span></p>
  <div class="stat-cards" id="header-cards"></div>
</div>

<div id="exec-summary"></div>

<div class="section" id="gold-profile">
  <h2>Your Gold ICP Profile</h2>
  <p style="color:var(--text-dim);margin-bottom:16px;">These are your highest-scoring contacts — the pattern they share defines your ideal customer profile.</p>
  <div id="gold-list"></div>
</div>

<div class="section" id="niche-map">
  <h2>Niche Map</h2>
  <p style="color:var(--text-dim);margin-bottom:16px;">Your network clusters ranked by ICP alignment — higher alignment means the niche is closer to your gold contacts in semantic space.</p>
  <div id="niche-list"></div>
  <div class="chart-grid" style="margin-top:24px;">
    <div class="chart-card"><h3>Niche Size & Gold Density</h3><canvas id="chart-niches"></canvas></div>
    <div class="chart-card"><h3>Niche ICP Alignment</h3><canvas id="chart-alignment"></canvas></div>
  </div>
</div>

<div class="section" id="keywords">
  <h2>Keyword DNA</h2>
  <p style="color:var(--text-dim);margin-bottom:16px;">Most frequent keywords across your contacts, weighted by gold score — this is the language of your ICP.</p>
  <div class="chart-grid">
    <div class="chart-card"><h3>Role Keywords</h3><div id="kw-roles" class="kw-bar-container"></div></div>
    <div class="chart-card"><h3>Headline Keywords</h3><div id="kw-headlines" class="kw-bar-container"></div></div>
  </div>
  <div class="chart-grid" style="margin-top:24px;">
    <div class="chart-card"><h3>About Section Keywords</h3><div id="kw-about" class="kw-bar-container"></div></div>
    <div class="chart-card"><h3>Tier Breakdown</h3><canvas id="chart-tiers"></canvas></div>
  </div>
</div>

<div class="section" id="centroid">
  <h2>ICP Centroid Analysis</h2>
  <p style="color:var(--text-dim);margin-bottom:16px;">The semantic center of your gold contacts — anyone near this point in vector space matches your ideal customer profile.</p>
  <div id="centroid-contacts"></div>
</div>

<div class="section" id="promotion">
  <h2>Promotion Candidates</h2>
  <p style="color:var(--text-dim);margin-bottom:16px;">Non-gold contacts who semantically match your gold ICP — consider upgrading engagement with these contacts.</p>
  <div id="promo-list"></div>
</div>

<div class="section" id="companies">
  <h2>Company Clusters</h2>
  <p style="color:var(--text-dim);margin-bottom:16px;">Companies with the highest concentration of ICP-aligned contacts — potential beachheads for account-based outreach.</p>
  <div style="overflow-x:auto;">
    <table class="data-table" id="company-table">
      <thead><tr>
        <th>Company</th><th>Contacts</th><th>Gold</th><th>Silver</th><th>Avg Gold Score</th>
      </tr></thead>
      <tbody id="company-tbody"></tbody>
    </table>
  </div>
</div>

<div class="section" id="personas">
  <h2>Network Persona Composition</h2>
  <p style="color:var(--text-dim);margin-bottom:16px;">How your contacts break down by strategic persona and behavioral type.</p>
  <div class="chart-grid">
    <div class="chart-card"><h3>Strategic Personas</h3><canvas id="chart-personas"></canvas></div>
    <div class="chart-card"><h3>Behavioral Personas</h3><canvas id="chart-beh"></canvas></div>
  </div>
</div>

</div>

<script>
(function() {
  function esc(s) { return s ? String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;') : ''; }

  // --- CSV Export functionality ---
  window.exportTableToCSV = function(tableId, filename) {
    var table = document.getElementById(tableId);
    if (!table) {
      console.error('Table not found:', tableId);
      return;
    }
    var rows = table.querySelectorAll('tr');
    var csv = '';
    rows.forEach(function(row) {
      var cells = row.querySelectorAll('th, td');
      var rowData = [];
      cells.forEach(function(cell) {
        var text = cell.textContent.replace(/\s+/g, ' ').trim();
        text = text.replace(/"/g, '""');
        rowData.push('"' + text + '"');
      });
      csv += rowData.join(',') + '\n';
    });
    var blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    var link = document.createElement('a');
    if (link.download !== undefined) {
      var url = URL.createObjectURL(blob);
      link.setAttribute('href', url);
      link.setAttribute('download', filename);
      link.style.visibility = 'hidden';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  };

  window.exportDataToCSV = function(data, headers, filename) {
    var csv = headers.join(',') + '\n';
    data.forEach(function(row) {
      var rowData = row.map(function(cell) {
        var text = String(cell).replace(/"/g, '""');
        return '"' + text + '"';
      });
      csv += rowData.join(',') + '\n';
    });
    var blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    var link = document.createElement('a');
    if (link.download !== undefined) {
      var url = URL.createObjectURL(blob);
      link.setAttribute('href', url);
      link.setAttribute('download', filename);
      link.style.visibility = 'hidden';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  };

  // --- Contact detail modal helpers ---
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

  // Header
  document.getElementById('gen-date').textContent = new Date(DATA.meta.generated).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  document.getElementById('total-contacts').textContent = DATA.meta.totalContacts;

  var tc = DATA.tierCounts;
  var alignment = DATA.vectorData ? (DATA.vectorData.goldNetAlignment * 100).toFixed(0) : '?';
  var cards = document.getElementById('header-cards');
  [
    { v: tc.gold, l: 'Gold Contacts', cls: 'gold' },
    { v: tc.silver, l: 'Silver Contacts', cls: 'silver' },
    { v: DATA.clusters.length, l: 'Niches Identified', cls: 'accent' },
    { v: DATA.vectorData ? DATA.vectorData.storeSize : '—', l: 'Vectorized', cls: 'accent' },
    { v: alignment + '%', l: 'ICP Alignment', cls: 'green' },
  ].forEach(function(s) {
    var d = document.createElement('div');
    d.className = 'stat-card ' + s.cls;
    d.innerHTML = '<div class="value">' + s.v + '</div><div class="label">' + s.l + '</div>';
    cards.appendChild(d);
  });

  // Executive Summary with Degree Distribution
  var topRoles = DATA.roleKeywords.slice(0, 5).map(function(k) { return k.word; });
  var topHeadlines = DATA.headlineKeywords.slice(0, 5).map(function(k) { return k.word; });
  var topNiche = DATA.clusters[0] || { id: 'unknown', size: 0 };
  var bestNiche = DATA.vectorData && DATA.vectorData.nicheCentroids && DATA.vectorData.nicheCentroids[0];
  var alignPct = DATA.vectorData ? (DATA.vectorData.goldNetAlignment * 100).toFixed(0) : '?';

  // Calculate degree distribution by tier
  var degreeDist = { gold: { d1: 0, d2: 0 }, silver: { d1: 0, d2: 0 }, bronze: { d1: 0, d2: 0 }, watch: { d1: 0, d2: 0 } };

  // Helper to safely increment degree distribution
  function addToDist(tier, degree) {
    if (degreeDist[tier]) {
      if (degree === 1) degreeDist[tier].d1++;
      else degreeDist[tier].d2++;
    }
  }

  // Process all tiers
  DATA.goldContacts.forEach(function(c) { addToDist('gold', c.degree); });
  if (DATA.silverContacts) DATA.silverContacts.forEach(function(c) { addToDist('silver', c.degree); });
  if (DATA.bronzeContacts) DATA.bronzeContacts.forEach(function(c) { addToDist('bronze', c.degree); });
  if (DATA.watchContacts) DATA.watchContacts.forEach(function(c) { addToDist('watch', c.degree); });

  var execDiv = document.getElementById('exec-summary');
  execDiv.innerHTML = '<div class="exec-summary">' +
    '<h3>Your Ideal Customer Profile</h3>' +
    '<p>Based on semantic analysis of <span class="metric">' + DATA.meta.totalContacts + '</span> contacts across <span class="metric">' + DATA.clusters.length + '</span> niches, your network gravitates toward ' +
    '<span class="highlight">' + topHeadlines.join(', ') + '</span> professionals. ' +
    'Your gold contacts cluster around roles in <span class="highlight">' + topRoles.slice(0, 4).join(', ') + '</span>.</p>' +
    '<p style="margin-top:12px;">Your strongest niche is <span class="highlight">' + (bestNiche ? bestNiche.id : topNiche.id) + '</span>' +
    (bestNiche ? ' with <span class="metric">' + (bestNiche.icpAlignment * 100).toFixed(0) + '%</span> ICP alignment' : '') +
    '. Your overall network-to-ICP alignment is <span class="metric">' + alignPct + '%</span>' +
    (parseFloat(alignPct) > 80 ? ' — highly focused.' : parseFloat(alignPct) > 60 ? ' — moderately focused with room for expansion.' : ' — broadly diverse.') +
    '</p>' +
    (DATA.vectorData && DATA.vectorData.promotionCandidates && DATA.vectorData.promotionCandidates.length > 0 ?
      '<p style="margin-top:12px;">We found <span class="metric">' + DATA.vectorData.promotionCandidates.length + '</span> non-gold contacts who semantically match your gold ICP — these are your strongest promotion candidates.</p>' : '') +
    '</div>' +
    '<div style="margin-top:20px;"><button class="export-btn" onclick="exportExecutiveSummary()">Export Summary CSV</button></div>' +
    '<div class="chart-grid" style="margin-top:16px;">' +
      '<div class="chart-card"><h3>Degree Distribution by Tier</h3><canvas id="chart-degree-dist"></canvas></div>' +
    '</div>';

  // Export executive summary function
  window.exportExecutiveSummary = function() {
    var headers = ['Metric', 'Value'];
    var rows = [
      ['Total Contacts', DATA.meta.totalContacts],
      ['Gold Contacts', DATA.tierCounts.gold],
      ['Silver Contacts', DATA.tierCounts.silver],
      ['Bronze Contacts', DATA.tierCounts.bronze],
      ['Watch Contacts', DATA.tierCounts.watch],
      ['Niches Identified', DATA.clusters.length],
      ['ICP Alignment', alignPct + '%'],
      ['Strongest Niche', bestNiche ? bestNiche.id : topNiche.id],
      ['Top Role Keywords', topRoles.join(', ')],
      ['Top Headline Keywords', topHeadlines.join(', ')],
    ];
    if (DATA.vectorData) {
      rows.push(['Vectorized Contacts', DATA.vectorData.storeSize]);
      if (DATA.vectorData.promotionCandidates) {
        rows.push(['Promotion Candidates', DATA.vectorData.promotionCandidates.length]);
      }
    }
    exportDataToCSV(rows, headers, 'icp-executive-summary.csv');
  };

  // Degree Distribution Chart
  new Chart(document.getElementById('chart-degree-dist'), {
    type: 'bar',
    data: {
      labels: ['Gold', 'Silver', 'Bronze', 'Watch'],
      datasets: [
        { label: '1st Degree', data: [degreeDist.gold.d1, degreeDist.silver.d1, degreeDist.bronze.d1, degreeDist.watch.d1], backgroundColor: 'rgba(34,197,94,0.7)', borderWidth: 0 },
        { label: '2nd Degree', data: [degreeDist.gold.d2, degreeDist.silver.d2, degreeDist.bronze.d2, degreeDist.watch.d2], backgroundColor: 'rgba(59,130,246,0.7)', borderWidth: 0 }
      ]
    },
    options: {
      plugins: { legend: { position: 'top' } },
      scales: {
        x: { stacked: true, grid: { display: false } },
        y: { stacked: true, beginAtZero: true, grid: { color: '#2d3148' } }
      }
    }
  });

  // Gold contacts
  var goldList = document.getElementById('gold-list');
  goldList.innerHTML = '<button class="export-btn" onclick="exportGoldContacts()">Export Gold Contacts CSV</button>';
  DATA.goldContacts.forEach(function(gc) {
    goldList.innerHTML += '<div class="info-card">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;">' +
        '<div>' +
          '<div class="card-name">' + clickableName(gc.name, gc) + ' ' + degreeBadge(gc.degree) + ' <span class="tier-badge gold">GOLD</span></div>' +
          '<div class="card-role">' + esc(gc.role) + (gc.company ? ' @ ' + esc(gc.company) : '') + '</div>' +
        '</div>' +
        '<div style="text-align:right;">' +
          '<div style="font-size:22px;font-weight:700;color:var(--gold);">' + gc.goldScore.toFixed(3) + '</div>' +
          '<div style="font-size:11px;color:var(--text-dim);">' + esc(gc.persona) + '</div>' +
        '</div>' +
      '</div>' +
    '</div>';
  });

  window.exportGoldContacts = function() {
    var headers = ['Name', 'Degree', 'Gold Score', 'Role', 'Company', 'Persona', 'LinkedIn URL'];
    var rows = DATA.goldContacts.map(function(gc) {
      return [
        gc.name,
        gc.degree === 1 ? '1st' : gc.degree === 2 ? '2nd' : '3rd+',
        gc.goldScore.toFixed(3),
        gc.role,
        gc.company,
        gc.persona,
        gc.url
      ];
    });
    exportDataToCSV(rows, headers, 'gold-contacts.csv');
  };

  // Niche map with improved badges and sorting
  var nicheList = document.getElementById('niche-list');
  var niches = DATA.vectorData && DATA.vectorData.nicheCentroids ? DATA.vectorData.nicheCentroids : DATA.clusters;
  var useVector = DATA.vectorData && DATA.vectorData.nicheCentroids && DATA.vectorData.nicheCentroids.length > 0;

  // Add CSV export button
  nicheList.innerHTML = '<button class="export-btn" onclick="exportNicheMap()">Export Niche Map CSV</button>';

  // Sort niches by total gold score (gold count * avg gold score) for better prioritization
  var sortedNiches = niches.slice().sort(function(a, b) {
    var scoreA = (a.goldCount || 0) * (a.avgGold || a.goldDensity || 0);
    var scoreB = (b.goldCount || 0) * (b.avgGold || b.goldDensity || 0);
    return scoreB - scoreA;
  });

  sortedNiches.forEach(function(n) {
    var alignVal = useVector ? n.icpAlignment : n.goldDensity;
    var alignPct = (alignVal * 100).toFixed(1);
    var barColor = alignVal > 0.85 ? 'var(--gold)' : alignVal > 0.7 ? 'var(--accent2)' : alignVal > 0.5 ? 'var(--blue)' : 'var(--watch)';
    var avgGoldScore = n.avgGold || (n.goldCount > 0 ? alignVal : 0);

    var repsHtml = '';
    if (n.representatives) {
      repsHtml = '<div style="margin-top:12px;font-size:12px;color:var(--text-dim);">Representative contacts:</div>';
      n.representatives.forEach(function(r) {
        repsHtml += '<div style="font-size:12px;padding:2px 0;">' +
          '<span class="tier-badge ' + r.tier + '" style="font-size:10px;">' + r.tier + '</span> ' +
          clickableName(r.name, r) + ' ' + degreeBadge(r.degree) + ' — ' + esc(r.role) + '</div>';
      });
    }

    nicheList.innerHTML += '<div class="niche-card">' +
      '<div class="niche-header">' +
        '<div class="niche-title">' + esc(n.id) + '</div>' +
        '<div style="font-size:22px;font-weight:700;color:' + barColor + ';">' + alignPct + '%</div>' +
      '</div>' +
      '<div class="niche-badges">' +
        '<span class="count-badge">' + n.size + ' contacts</span>' +
        '<span class="count-badge" style="background:rgba(255,215,0,0.15);color:var(--gold);">' + (n.goldCount || 0) + ' gold</span>' +
        '<span class="count-badge" style="background:rgba(192,192,192,0.15);color:var(--silver);">' + (n.silverCount || 0) + ' silver</span>' +
        '<span class="count-badge gold-avg">Avg: ' + avgGoldScore.toFixed(3) + '</span>' +
      '</div>' +
      '<div class="niche-meta" style="margin-top:8px;">' +
        '<span>' + (n.keywords || []).join(', ') + '</span>' +
      '</div>' +
      '<div class="alignment-bar"><div class="alignment-fill" style="width:' + alignPct + '%;background:' + barColor + ';"></div></div>' +
      repsHtml +
    '</div>';
  });

  window.exportNicheMap = function() {
    var headers = ['Niche ID', 'Total Contacts', 'Gold Count', 'Silver Count', 'Bronze Count', 'Avg Gold Score', 'ICP Alignment %', 'Keywords'];
    var rows = sortedNiches.map(function(n) {
      var alignVal = useVector ? n.icpAlignment : n.goldDensity;
      var avgGoldScore = n.avgGold || (n.goldCount > 0 ? alignVal : 0);
      return [
        n.id,
        n.size,
        n.goldCount || 0,
        n.silverCount || 0,
        n.bronzeCount || 0,
        avgGoldScore.toFixed(3),
        (alignVal * 100).toFixed(1),
        (n.keywords || []).join('; ')
      ];
    });
    exportDataToCSV(rows, headers, 'niche-map.csv');
  };

  // Niche charts
  Chart.defaults.color = '#8b8fa3';
  var nicheLabels = DATA.clusters.map(function(c) { return c.id; });
  var nicheSizes = DATA.clusters.map(function(c) { return c.size; });
  var nicheGold = DATA.clusters.map(function(c) { return c.goldCount + c.silverCount; });

  new Chart(document.getElementById('chart-niches'), {
    type: 'bar',
    data: {
      labels: nicheLabels,
      datasets: [
        { label: 'Gold+Silver', data: nicheGold, backgroundColor: 'rgba(255,215,0,0.6)', borderWidth: 0 },
        { label: 'Total', data: nicheSizes, backgroundColor: 'rgba(99,102,241,0.2)', borderWidth: 0 },
      ]
    },
    options: { indexAxis: 'y', plugins: { legend: { position: 'top' } }, scales: { x: { beginAtZero: true, grid: { color: '#2d3148' } }, y: { grid: { display: false } } } }
  });

  if (useVector) {
    var alignLabels = DATA.vectorData.nicheCentroids.map(function(n) { return n.id; });
    var alignVals = DATA.vectorData.nicheCentroids.map(function(n) { return (n.icpAlignment * 100).toFixed(1); });
    var alignColors = DATA.vectorData.nicheCentroids.map(function(n) {
      return n.icpAlignment > 0.85 ? 'rgba(255,215,0,0.7)' : n.icpAlignment > 0.7 ? 'rgba(99,102,241,0.7)' : 'rgba(102,102,102,0.5)';
    });
    new Chart(document.getElementById('chart-alignment'), {
      type: 'bar',
      data: {
        labels: alignLabels,
        datasets: [{ label: 'ICP Alignment %', data: alignVals, backgroundColor: alignColors, borderWidth: 0 }]
      },
      options: { indexAxis: 'y', plugins: { legend: { display: false } }, scales: { x: { beginAtZero: true, max: 100, grid: { color: '#2d3148' } }, y: { grid: { display: false } } } }
    });
  }

  // Keyword bars
  function renderKwBars(containerId, keywords, color) {
    var el = document.getElementById(containerId);
    var maxWeight = keywords.length > 0 ? keywords[0].weight : 1;
    keywords.slice(0, 15).forEach(function(kw) {
      var pct = (kw.weight / maxWeight * 100).toFixed(0);
      el.innerHTML += '<div class="kw-row">' +
        '<div class="kw-label">' + esc(kw.word) + '</div>' +
        '<div class="kw-bar" style="width:' + pct + '%;background:' + color + ';"></div>' +
        '<div class="kw-value">' + kw.weight.toFixed(1) + '</div>' +
      '</div>';
    });
  }

  // Add export buttons for keywords
  var kwRolesDiv = document.getElementById('kw-roles');
  kwRolesDiv.innerHTML = '<button class="export-btn" onclick="exportKeywords(\'role\')">Export CSV</button>';
  renderKwBars('kw-roles', DATA.roleKeywords, 'rgba(99,102,241,0.7)');

  var kwHeadlinesDiv = document.getElementById('kw-headlines');
  kwHeadlinesDiv.innerHTML = '<button class="export-btn" onclick="exportKeywords(\'headline\')">Export CSV</button>';
  renderKwBars('kw-headlines', DATA.headlineKeywords, 'rgba(34,197,94,0.7)');

  var kwAboutDiv = document.getElementById('kw-about');
  kwAboutDiv.innerHTML = '<button class="export-btn" onclick="exportKeywords(\'about\')">Export CSV</button>';
  renderKwBars('kw-about', DATA.aboutKeywords, 'rgba(245,158,11,0.7)');

  window.exportKeywords = function(type) {
    var headers = ['Keyword', 'Weight'];
    var data = type === 'role' ? DATA.roleKeywords : type === 'headline' ? DATA.headlineKeywords : DATA.aboutKeywords;
    var rows = data.map(function(kw) {
      return [kw.word, kw.weight.toFixed(3)];
    });
    exportDataToCSV(rows, headers, 'keywords-' + type + '.csv');
  };

  // Tier donut
  new Chart(document.getElementById('chart-tiers'), {
    type: 'doughnut',
    data: {
      labels: ['Gold', 'Silver', 'Bronze', 'Watch'],
      datasets: [{ data: [tc.gold, tc.silver, tc.bronze, tc.watch], backgroundColor: ['#FFD700','#C0C0C0','#CD7F32','#555'], borderWidth: 0 }]
    },
    options: { plugins: { legend: { position: 'bottom' } } }
  });

  // Centroid contacts
  if (DATA.vectorData && DATA.vectorData.centroidContacts) {
    var centDiv = document.getElementById('centroid-contacts');
    centDiv.innerHTML = '<button class="export-btn" onclick="exportCentroidContacts()">Export Centroid Analysis CSV</button>' +
      '<div style="overflow-x:auto;"><table class="data-table" id="centroid-table"><thead><tr>' +
      '<th>#</th><th>Name</th><th>ICP Similarity</th><th>Tier</th><th>Gold Score</th><th>Role</th><th>Company</th>' +
      '</tr></thead><tbody>' +
      DATA.vectorData.centroidContacts.slice(0, 25).map(function(c, i) {
        var simPct = (c.similarity * 100).toFixed(1);
        return '<tr>' +
          '<td>' + (i + 1) + '</td>' +
          '<td style="font-weight:600;">' + clickableName(c.name, c) + ' ' + degreeBadge(c.degree) + '</td>' +
          '<td style="color:var(--accent2);font-weight:600;">' + simPct + '%</td>' +
          '<td><span class="tier-badge ' + c.tier + '">' + c.tier + '</span></td>' +
          '<td>' + c.goldScore.toFixed(3) + '</td>' +
          '<td title="' + esc(c.role) + '">' + esc(c.role) + '</td>' +
          '<td title="' + esc(c.company) + '">' + esc(c.company) + '</td>' +
          '</tr>';
      }).join('') +
      '</tbody></table></div>';

    window.exportCentroidContacts = function() {
      var headers = ['Rank', 'Name', 'Degree', 'ICP Similarity %', 'Tier', 'Gold Score', 'Role', 'Company', 'LinkedIn URL'];
      var rows = DATA.vectorData.centroidContacts.slice(0, 25).map(function(c, i) {
        return [
          i + 1,
          c.name,
          c.degree === 1 ? '1st' : c.degree === 2 ? '2nd' : '3rd+',
          (c.similarity * 100).toFixed(1),
          c.tier,
          c.goldScore.toFixed(3),
          c.role,
          c.company,
          c.url
        ];
      });
      exportDataToCSV(rows, headers, 'icp-centroid-analysis.csv');
    };
  }

  // Promotion candidates
  if (DATA.vectorData && DATA.vectorData.promotionCandidates) {
    var promoList = document.getElementById('promo-list');
    promoList.innerHTML = '<button class="export-btn" onclick="exportPromotionCandidates()">Export Promotion Candidates CSV</button>';
    DATA.vectorData.promotionCandidates.forEach(function(c) {
      var simPct = (c.similarity * 100).toFixed(1);
      promoList.innerHTML += '<div class="promo-card">' +
        '<div class="promo-info">' +
          '<div class="promo-name">' + clickableName(c.name, c) + ' ' + degreeBadge(c.degree) + ' <span class="tier-badge ' + c.tier + '" style="font-size:10px;">' + c.tier + '</span></div>' +
          '<div class="promo-role">' + esc(c.role) + (c.company ? ' @ ' + esc(c.company) : '') + '</div>' +
        '</div>' +
        '<div class="promo-scores">' +
          '<div><div class="promo-sim">' + simPct + '%</div><div style="font-size:10px;color:var(--text-dim);text-align:center;">ICP match</div></div>' +
          '<div style="margin-left:12px;text-align:center;"><div class="promo-gold">' + c.goldScore.toFixed(3) + '</div><div style="font-size:10px;color:var(--text-dim);">gold score</div></div>' +
        '</div>' +
      '</div>';
    });

    window.exportPromotionCandidates = function() {
      var headers = ['Name', 'Degree', 'Current Tier', 'ICP Similarity %', 'Gold Score', 'Role', 'Company', 'LinkedIn URL'];
      var rows = DATA.vectorData.promotionCandidates.map(function(c) {
        return [
          c.name,
          c.degree === 1 ? '1st' : c.degree === 2 ? '2nd' : '3rd+',
          c.tier,
          (c.similarity * 100).toFixed(1),
          c.goldScore.toFixed(3),
          c.role,
          c.company,
          c.url
        ];
      });
      exportDataToCSV(rows, headers, 'promotion-candidates.csv');
    };
  }

  // Company table
  var compSection = document.getElementById('companies');
  var exportBtn = document.createElement('button');
  exportBtn.className = 'export-btn';
  exportBtn.textContent = 'Export Companies CSV';
  exportBtn.onclick = function() { exportTableToCSV('company-table', 'company-clusters.csv'); };
  compSection.insertBefore(exportBtn, compSection.querySelector('.data-table').parentElement);

  var compTbody = document.getElementById('company-tbody');
  DATA.topCompanies.forEach(function(c) {
    compTbody.innerHTML += '<tr>' +
      '<td style="font-weight:600;">' + esc(c.name) + '</td>' +
      '<td>' + c.count + '</td>' +
      '<td style="color:var(--gold);">' + c.tiers.gold + '</td>' +
      '<td style="color:var(--silver);">' + c.tiers.silver + '</td>' +
      '<td>' + c.avgGold.toFixed(3) + '</td>' +
      '</tr>';
  });

  // Persona charts
  var pLabels = Object.keys(DATA.personaCounts);
  var pValues = Object.values(DATA.personaCounts);
  var pColors = ['#6366f1','#22c55e','#f59e0b','#ef4444','#3b82f6','#ec4899'];
  new Chart(document.getElementById('chart-personas'), {
    type: 'doughnut',
    data: { labels: pLabels, datasets: [{ data: pValues, backgroundColor: pColors.slice(0, pLabels.length), borderWidth: 0 }] },
    options: { plugins: { legend: { position: 'bottom' } } }
  });

  var bLabels = Object.keys(DATA.behCounts);
  var bValues = Object.values(DATA.behCounts);
  new Chart(document.getElementById('chart-beh'), {
    type: 'doughnut',
    data: { labels: bLabels, datasets: [{ data: bValues, backgroundColor: pColors.slice(0, bLabels.length), borderWidth: 0 }] },
    options: { plugins: { legend: { position: 'bottom' } } }
  });

  // Sidebar tracking
  var sidebarLinks = document.querySelectorAll('.sidebar a');
  var sections = Array.from(document.querySelectorAll('.section, .header'));
  window.addEventListener('scroll', function() {
    var current = '';
    for (var i = 0; i < sections.length; i++) {
      if (sections[i].getBoundingClientRect().top <= 100) current = sections[i].id;
    }
    sidebarLinks.forEach(function(a) { a.classList.toggle('active', a.getAttribute('href') === '#' + current); });
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
  const outputPath = args.output
    ? resolve(process.cwd(), args.output)
    : DEFAULT_OUTPUT;

  console.log('Loading graph.json...');
  const graph = loadGraph();

  console.log('Computing ICP & Niche data...');
  const data = await computeData(graph);

  console.log('  Clusters:', data.clusters.length);
  console.log('  Gold contacts:', data.tierCounts.gold);
  if (data.vectorData) {
    console.log('  Vector store:', data.vectorData.storeSize, 'contacts');
    console.log('  ICP alignment:', (data.vectorData.goldNetAlignment * 100).toFixed(1) + '%');
    console.log('  Promotion candidates:', data.vectorData.promotionCandidates?.length || 0);
    console.log('  Niche centroids:', data.vectorData.nicheCentroids?.length || 0);
  }

  console.log('Generating HTML...');
  const html = generateHTML(data);

  writeFileSync(outputPath, html, 'utf-8');
  console.log(`Report written to ${outputPath}`);
  console.log(`Open in browser: file://${outputPath}`);
})();
