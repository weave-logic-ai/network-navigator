import { readFileSync, existsSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { parseArgs, DATA_DIR } from './lib.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const GRAPH_PATH = resolve(DATA_DIR, 'graph.json');

function loadGraph() {
  if (!existsSync(GRAPH_PATH)) {
    console.error('graph.json not found. Run pipeline.mjs --rebuild first.');
    process.exit(1);
  }
  return JSON.parse(readFileSync(GRAPH_PATH, 'utf-8'));
}

function contactLabel(c) {
  const name = c.enrichedName || c.name || 'Unknown';
  const role = c.currentRole || c.headline || '';
  const company = c.currentCompany || '';
  const loc = c.enrichedLocation || '';
  return { name, roleLine: [role, company].filter(Boolean).join(' @ '), loc };
}

function clustersForContact(url, graph) {
  const out = [];
  for (const [id, cl] of Object.entries(graph.clusters || {})) {
    if (cl.contacts.includes(url)) out.push(id);
  }
  return out;
}

function tierCounts(urls, graph) {
  const counts = { gold: 0, silver: 0, bronze: 0, watch: 0 };
  for (const url of urls) {
    const tier = graph.contacts[url]?.scores?.tier || 'watch';
    counts[tier] = (counts[tier] || 0) + 1;
  }
  return counts;
}

function personaCounts(graph) {
  const counts = {};
  for (const c of Object.values(graph.contacts)) {
    const p = c.personaType || 'unknown';
    counts[p] = (counts[p] || 0) + 1;
  }
  return counts;
}

function sortedDesc(entries) {
  return [...entries].sort((a, b) => b[1] - a[1]);
}

// ---- Mode: hubs ----
function modeHubs(graph, opts) {
  const top = parseInt(opts.top, 10) || 10;
  const clusterFilter = opts.cluster || null;
  let urls = Object.keys(graph.contacts);
  if (clusterFilter && graph.clusters[clusterFilter]) {
    urls = graph.clusters[clusterFilter].contacts;
  }
  const ranked = urls
    .map(url => ({ url, c: graph.contacts[url] }))
    .filter(({ c }) => c.scores)
    .sort((a, b) => (b.c.scores.networkHub || 0) - (a.c.scores.networkHub || 0))
    .slice(0, top);

  console.log(`=== Top ${ranked.length} Network Hubs${clusterFilter ? ` [${clusterFilter}]` : ''} ===\n`);
  ranked.forEach(({ url, c }, i) => {
    const { name, roleLine, loc } = contactLabel(c);
    const s = c.scores;
    const cls = clustersForContact(url, graph).join(', ') || 'none';
    console.log(`${i + 1}. ${name} (networkHub: ${s.networkHub?.toFixed(2)}, goldScore: ${s.goldScore?.toFixed(2)}, tier: ${s.tier})`);
    console.log(`   ${roleLine}${loc ? ' | ' + loc : ''}`);
    console.log(`   Mutual: ${c.mutualConnections || 0} | Clusters: ${cls}`);
    const reasons = [];
    if ((c.mutualConnections || 0) > 100) reasons.push('High mutual connections');
    if (clustersForContact(url, graph).length > 2) reasons.push('Broad niche coverage');
    if (/connect|network|partner|alliance/i.test(c.headline || '')) reasons.push('Connector role');
    if (reasons.length === 0) reasons.push('Strong network centrality');
    console.log(`   Why hub: ${reasons.join(', ')}\n`);
  });
}

// ---- Mode: prospects ----
function modeProspects(graph, opts) {
  const top = parseInt(opts.top, 10) || 10;
  const icpFilter = opts.icp || null;
  const tierFilter = opts.tier || null;
  let urls = Object.keys(graph.contacts);
  if (tierFilter) urls = urls.filter(u => graph.contacts[u].scores?.tier === tierFilter);
  const ranked = urls
    .map(url => ({ url, c: graph.contacts[url] }))
    .filter(({ c }) => c.scores)
    .filter(({ c }) => !icpFilter || (c.icpCategories || []).includes(icpFilter))
    .sort((a, b) => (b.c.scores.icpFit || 0) - (a.c.scores.icpFit || 0))
    .slice(0, top);

  console.log(`=== Top ${ranked.length} ICP-Fit Prospects${icpFilter ? ` [${icpFilter}]` : ''}${tierFilter ? ` (${tierFilter})` : ''} ===\n`);
  ranked.forEach(({ url, c }, i) => {
    const { name, roleLine, loc } = contactLabel(c);
    const s = c.scores;
    const icpCats = (c.icpCategories || []).map(cat => `${cat} (${s.icpFit?.toFixed(2)})`).join(', ') || 'none';
    const headline = (c.headline || '').toLowerCase();
    const signals = (c.tags || []).filter(t => headline.includes(t));
    const signalStr = signals.length ? `"${signals.join('", "')}" found in headline` : 'Profile signals match';
    console.log(`${i + 1}. ${name} (icpFit: ${s.icpFit?.toFixed(2)}, goldScore: ${s.goldScore?.toFixed(2)}, tier: ${s.tier})`);
    console.log(`   ${roleLine}${loc ? ' | ' + loc : ''}`);
    console.log(`   ICP match: ${icpCats}`);
    console.log(`   Signals: ${signalStr}\n`);
  });
}

// ---- Mode: recommend ----
function modeRecommend(graph) {
  const contacts = Object.entries(graph.contacts).map(([url, c]) => ({ url, ...c }));
  console.log('=== Strategic Recommendations ===\n');

  // Immediate pursuit: top 5 gold-tier buyers
  const goldBuyers = contacts
    .filter(c => c.scores?.tier === 'gold' && c.personaType === 'buyer')
    .sort((a, b) => (b.scores.goldScore || 0) - (a.scores.goldScore || 0))
    .slice(0, 5);
  console.log('-- Immediate Pursuit (Gold Buyers) --');
  if (goldBuyers.length === 0) { console.log('  No gold-tier buyers found.\n'); }
  else {
    goldBuyers.forEach((c, i) => {
      const { name, roleLine } = contactLabel(c);
      console.log(`  ${i + 1}. ${name} (goldScore: ${c.scores.goldScore?.toFixed(2)}) - ${roleLine}`);
    });
    console.log();
  }

  // Hub activation: top 5 hubs
  const hubs = contacts
    .filter(c => c.personaType === 'hub')
    .sort((a, b) => (b.scores.networkHub || 0) - (a.scores.networkHub || 0))
    .slice(0, 5);
  console.log('-- Hub Activation (Request Intros) --');
  if (hubs.length === 0) { console.log('  No hub personas found.\n'); }
  else {
    hubs.forEach((c, i) => {
      const { name, roleLine } = contactLabel(c);
      const cls = clustersForContact(c.url, graph);
      const buyerCount = cls.reduce((sum, cl) => {
        return sum + (graph.clusters[cl]?.contacts || []).filter(
          u => graph.contacts[u]?.personaType === 'buyer' && graph.contacts[u]?.scores?.tier === 'gold'
        ).length;
      }, 0);
      console.log(`  ${i + 1}. ${name} (networkHub: ${c.scores.networkHub?.toFixed(2)}) - ${roleLine}`);
      console.log(`     Clusters: ${cls.join(', ')} | Gold buyers reachable: ~${buyerCount}`);
    });
    console.log();
  }

  // Cluster opportunities
  console.log('-- Cluster Opportunities --');
  for (const [id, cl] of Object.entries(graph.clusters)) {
    if (cl.contacts.length === 0) continue;
    const tc = tierCounts(cl.contacts, graph);
    const gaps = [];
    if (tc.gold === 0) gaps.push('no gold contacts - needs prospecting');
    if (tc.gold > 0 && tc.gold < 3) gaps.push('few gold contacts - grow coverage');
    console.log(`  [${id}] ${cl.contacts.length} total | G:${tc.gold} S:${tc.silver} B:${tc.bronze} W:${tc.watch}${gaps.length ? ' | ' + gaps.join('; ') : ''}`);
  }
  console.log();

  // Quick wins: silver tier, close to gold
  const quickWins = contacts
    .filter(c => c.scores?.tier === 'silver')
    .filter(c => (c.scores.relationshipStrength || 0) >= 0.5 && (c.scores.icpFit || 0) >= 0.4)
    .sort((a, b) => (b.scores.goldScore || 0) - (a.scores.goldScore || 0))
    .slice(0, 5);
  console.log('-- Quick Wins (Silver, Near Gold) --');
  if (quickWins.length === 0) { console.log('  No quick-win candidates found.\n'); }
  else {
    quickWins.forEach((c, i) => {
      const { name, roleLine } = contactLabel(c);
      const s = c.scores;
      console.log(`  ${i + 1}. ${name} (goldScore: ${s.goldScore?.toFixed(2)}, icpFit: ${s.icpFit?.toFixed(2)}, relStrength: ${s.relationshipStrength?.toFixed(2)}) - ${roleLine}`);
    });
    console.log();
  }

  // Referral Partnerships
  const referralPartners = contacts
    .filter(c => c.referralTier === 'gold-referral' || c.referralTier === 'silver-referral')
    .sort((a, b) => (b.scores?.referralLikelihood || 0) - (a.scores?.referralLikelihood || 0))
    .slice(0, 5);
  console.log('-- Referral Partnerships --');
  if (referralPartners.length === 0) { console.log('  No referral partners scored. Run referral-scorer.mjs first.\n'); }
  else {
    referralPartners.forEach((c, i) => {
      const { name, roleLine } = contactLabel(c);
      const persona = c.referralPersona || 'unknown';
      const actionMap = {
        'white-label-partner': 'Propose white-label/reseller arrangement',
        'warm-introducer': 'Ask for warm introductions to their network',
        'co-seller': 'Set up mutual referral arrangement',
        'amplifier': 'Engage their content + propose co-marketing',
        'passive-referral': 'Deepen relationship before asking for referrals',
      };
      console.log(`  ${i + 1}. ${name} (ref: ${c.scores.referralLikelihood?.toFixed(2)}, ${c.referralTier}) - ${roleLine}`);
      console.log(`     Persona: ${persona} | Action: ${actionMap[persona] || 'Build relationship'}`);
    });
    console.log();
  }

  // Enrich next
  const unenriched = contacts
    .filter(c => !c.enriched)
    .sort((a, b) => (b.mutualConnections || 0) - (a.mutualConnections || 0))
    .slice(0, 5);
  console.log('-- Enrich Next (Prioritized Unenriched) --');
  if (unenriched.length === 0) { console.log('  All contacts enriched.\n'); }
  else {
    unenriched.forEach((c, i) => {
      const { name, roleLine } = contactLabel(c);
      console.log(`  ${i + 1}. ${name} (mutuals: ${c.mutualConnections || 0}) - ${roleLine}`);
    });
    console.log();
  }
}

// ---- Mode: clusters ----
function modeClusters(graph) {
  console.log('=== Cluster Map ===\n');
  const entries = Object.entries(graph.clusters).filter(([, cl]) => cl.contacts.length > 0);
  entries.sort((a, b) => b[1].contacts.length - a[1].contacts.length);

  for (const [id, cl] of entries) {
    const tc = tierCounts(cl.contacts, graph);
    console.log(`[${id}] ${cl.contacts.length} contacts | ${tc.gold} gold, ${tc.silver} silver, ${tc.bronze} bronze, ${tc.watch} watch`);
    const ranked = cl.contacts
      .map(u => ({ url: u, c: graph.contacts[u] }))
      .filter(({ c }) => c.scores);
    const topHub = [...ranked].sort((a, b) => (b.c.scores.networkHub || 0) - (a.c.scores.networkHub || 0))[0];
    if (topHub) console.log(`  Top hub: ${contactLabel(topHub.c).name} (networkHub: ${topHub.c.scores.networkHub?.toFixed(2)})`);
    const topProspect = [...ranked].sort((a, b) => (b.c.scores.icpFit || 0) - (a.c.scores.icpFit || 0))[0];
    if (topProspect) console.log(`  Top prospect: ${contactLabel(topProspect.c).name} (icpFit: ${topProspect.c.scores.icpFit?.toFixed(2)})`);
    const companyCounts = {};
    for (const u of cl.contacts) {
      const comp = graph.contacts[u]?.currentCompany;
      if (comp) companyCounts[comp] = (companyCounts[comp] || 0) + 1;
    }
    const topCompanies = sortedDesc(Object.entries(companyCounts))
      .slice(0, 5).map(([n, cnt]) => `${n} (${cnt})`).join(', ');
    if (topCompanies) console.log(`  Companies: ${topCompanies}`);
    console.log();
  }
}

// ---- Mode: summary ----
function modeSummary(graph) {
  const contacts = Object.values(graph.contacts);
  const total = contacts.length;
  const tc = tierCounts(Object.keys(graph.contacts), graph);
  const enriched = contacts.filter(c => c.enriched).length;
  const personas = personaCounts(graph);
  const activeClusters = Object.values(graph.clusters).filter(cl => cl.contacts.length > 0).length;
  const companyCount = Object.keys(graph.companies || {}).length;
  const edgeCount = (graph.edges || []).length;

  console.log('=== Network Intelligence Summary ===');
  console.log(`Total: ${total} contacts | Gold: ${tc.gold} | Silver: ${tc.silver} | Bronze: ${tc.bronze} | Watch: ${tc.watch}`);
  console.log(`Enriched: ${enriched}/${total}\n`);
  const personaLine = Object.entries(personas).map(([k, v]) => `${k[0].toUpperCase() + k.slice(1)}: ${v}`).join(' | ');
  console.log(`Personas: ${personaLine}`);
  console.log(`Clusters: ${activeClusters} | Companies: ${companyCount} | Edges: ${edgeCount}\n`);

  const topGold = Object.entries(graph.contacts)
    .filter(([, c]) => c.scores?.tier === 'gold')
    .sort((a, b) => (b[1].scores.goldScore || 0) - (a[1].scores.goldScore || 0))
    .slice(0, 3);
  console.log('Top 3 Gold Prospects:');
  topGold.forEach(([, c], i) => {
    const { name, roleLine } = contactLabel(c);
    console.log(`  ${i + 1}. ${name} (${c.scores.goldScore?.toFixed(2)}) - ${roleLine}`);
  });
  const topHubs = Object.entries(graph.contacts)
    .filter(([, c]) => c.scores)
    .sort((a, b) => (b[1].scores.networkHub || 0) - (a[1].scores.networkHub || 0))
    .slice(0, 3);
  console.log('\nTop 3 Network Hubs:');
  topHubs.forEach(([, c], i) => {
    const { name, roleLine } = contactLabel(c);
    console.log(`  ${i + 1}. ${name} (${c.scores.networkHub?.toFixed(2)}) - ${roleLine}`);
  });

  // Referral tier counts
  const refTierCounts = { 'gold-referral': 0, 'silver-referral': 0, 'bronze-referral': 0 };
  for (const c of contacts) {
    if (c.referralTier && refTierCounts[c.referralTier] !== undefined) {
      refTierCounts[c.referralTier]++;
    }
  }
  const hasReferrals = Object.values(refTierCounts).some(v => v > 0);
  if (hasReferrals) {
    console.log(`\nReferral Partners: Gold: ${refTierCounts['gold-referral']} | Silver: ${refTierCounts['silver-referral']} | Bronze: ${refTierCounts['bronze-referral']}`);
    const topReferral = Object.entries(graph.contacts)
      .filter(([, c]) => c.referralTier === 'gold-referral')
      .sort((a, b) => (b[1].scores?.referralLikelihood || 0) - (a[1].scores?.referralLikelihood || 0))[0];
    if (topReferral) {
      const { name, roleLine } = contactLabel(topReferral[1]);
      console.log(`Top referral: ${name} (ref: ${topReferral[1].scores.referralLikelihood?.toFixed(2)}, ${topReferral[1].referralPersona}) - ${roleLine}`);
    }
  }

  console.log(`\nLast scored: ${graph.meta?.lastBuilt || 'unknown'}`);
}

// ---- Mode: company ----
function modeCompany(graph, opts) {
  const search = (opts.name || '').toLowerCase();
  if (!search) { console.error('Usage: --mode company --name <company>'); process.exit(1); }
  const matches = Object.entries(graph.companies || {}).filter(
    ([key, co]) => key.includes(search) || co.name.toLowerCase().includes(search)
  );
  if (matches.length === 0) { console.log(`No company matching "${opts.name}" found.`); return; }
  for (const [, co] of matches) {
    console.log(`=== ${co.name} (${co.contacts.length} contacts) ===\n`);
    const ranked = co.contacts
      .map(url => ({ url, c: graph.contacts[url] }))
      .filter(({ c }) => c)
      .sort((a, b) => (b.c.scores?.goldScore || 0) - (a.c.scores?.goldScore || 0));
    ranked.forEach(({ c }, i) => {
      const { name, roleLine, loc } = contactLabel(c);
      const s = c.scores || {};
      console.log(`  ${i + 1}. ${name} (tier: ${s.tier || '-'}, goldScore: ${s.goldScore?.toFixed(2) || '-'}, icpFit: ${s.icpFit?.toFixed(2) || '-'})`);
      console.log(`     ${roleLine}${loc ? ' | ' + loc : ''}`);
      if (c.personaType) console.log(`     Persona: ${c.personaType}`);
      console.log();
    });
  }
}

// ---- Mode: behavioral ----
function modeBehavioral(graph, opts) {
  const top = parseInt(opts.top, 10) || 20;
  const personaFilter = opts.persona || null;
  let urls = Object.keys(graph.contacts);

  const ranked = urls
    .map(url => ({ url, c: graph.contacts[url] }))
    .filter(({ c }) => c.behavioralScore !== undefined)
    .filter(({ c }) => !personaFilter || c.behavioralPersona === personaFilter)
    .sort((a, b) => (b.c.behavioralScore || 0) - (a.c.behavioralScore || 0))
    .slice(0, top);

  if (ranked.length === 0) {
    console.log('No behavioral scores found. Run behavioral-scorer.mjs first.');
    return;
  }

  console.log(`=== Top ${ranked.length} by Behavioral Score${personaFilter ? ` [${personaFilter}]` : ''} ===\n`);
  ranked.forEach(({ url, c }, i) => {
    const { name, roleLine, loc } = contactLabel(c);
    const bs = c.behavioralSignals || {};
    const s = c.scores || {};
    console.log(`${i + 1}. ${name} (behavioral: ${c.behavioralScore?.toFixed(2)}, goldScore: ${s.goldScore?.toFixed(2)}, tier: ${s.tier})`);
    console.log(`   ${roleLine}${loc ? ' | ' + loc : ''}`);
    console.log(`   Persona: ${c.behavioralPersona} | Connections: ${bs.connectionCount || '?'} | Traits: ${bs.traitCount || 0}`);
    const signals = [];
    if (bs.aboutSignals?.length) signals.push(`About: ${bs.aboutSignals.join(', ')}`);
    if (bs.headlineSignals?.length) signals.push(`Headline: ${bs.headlineSignals.join(', ')}`);
    if (bs.superConnectorTraits?.length) signals.push(`Traits: ${bs.superConnectorTraits.join(', ')}`);
    if (signals.length) console.log(`   Signals: ${signals.join(' | ')}`);
    console.log(`   Amplification: ${bs.amplification?.toFixed(2) || '-'} | Recency: ${bs.connectedDaysAgo != null ? bs.connectedDaysAgo + 'd ago' : 'unknown'}\n`);
  });

  // Persona summary
  const allWithBehavioral = urls.filter(u => graph.contacts[u].behavioralScore !== undefined);
  const personaSummary = {};
  for (const u of allWithBehavioral) {
    const p = graph.contacts[u].behavioralPersona || 'unknown';
    personaSummary[p] = (personaSummary[p] || 0) + 1;
  }
  console.log('Behavioral Persona Breakdown:');
  for (const [p, count] of Object.entries(personaSummary).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${p.padEnd(22)} ${count}`);
  }
}

// ---- Mode: visibility ----
function modeVisibility(graph, opts) {
  const clusterFilter = opts.cluster || null;
  const contacts = Object.entries(graph.contacts)
    .map(([url, c]) => ({ url, ...c }))
    .filter(c => c.behavioralScore !== undefined);

  if (contacts.length === 0) {
    console.log('No behavioral scores found. Run behavioral-scorer.mjs first.');
    return;
  }

  console.log('=== Content Visibility Strategy ===\n');

  // 1. Engage These People's Content (super-connectors to comment on)
  console.log('-- 1. Engage Their Content (Super-Connectors) --');
  const superConnectors = contacts
    .filter(c => c.behavioralPersona === 'super-connector')
    .sort((a, b) => (b.behavioralScore || 0) - (a.behavioralScore || 0))
    .slice(0, 10);
  if (superConnectors.length === 0) {
    console.log('  No super-connectors found.\n');
  } else {
    superConnectors.forEach((c, i) => {
      const { name, roleLine } = contactLabel(c);
      const traits = (c.behavioralSignals?.superConnectorTraits || []).join(', ');
      console.log(`  ${i + 1}. ${name} (beh: ${c.behavioralScore?.toFixed(2)}) - ${roleLine}`);
      console.log(`     Traits: ${traits} | Connections: ${c.behavioralSignals?.connectionCount || '?'}`);
    });
    console.log();
  }

  // 2. Post Topics Targeting These Clusters
  console.log('-- 2. Post Topics Targeting These Clusters --');
  const clusterAmplifiers = {};
  for (const [clId, cl] of Object.entries(graph.clusters)) {
    if (cl.contacts.length === 0) continue;
    if (clusterFilter && clId !== clusterFilter) continue;
    let totalBeh = 0, amplifierCount = 0;
    for (const u of cl.contacts) {
      const c = graph.contacts[u];
      if (c?.behavioralScore) {
        totalBeh += c.behavioralScore;
        if (c.behavioralScore >= 0.3) amplifierCount++;
      }
    }
    clusterAmplifiers[clId] = {
      totalContacts: cl.contacts.length,
      avgBehavioral: cl.contacts.length > 0 ? totalBeh / cl.contacts.length : 0,
      amplifiers: amplifierCount,
    };
  }
  const rankedClusters = Object.entries(clusterAmplifiers)
    .sort((a, b) => b[1].amplifiers - a[1].amplifiers);
  for (const [clId, stats] of rankedClusters) {
    const topTopics = (graph.clusters[clId]?.keywords || []).join(', ');
    console.log(`  [${clId}] ${stats.amplifiers} amplifiers / ${stats.totalContacts} total (avg beh: ${stats.avgBehavioral.toFixed(2)})`);
    console.log(`     Topics to post about: ${topTopics}`);
  }
  console.log();

  // 3. Company Beachheads (companies with 3+ contacts for internal amplification)
  console.log('-- 3. Company Beachheads (3+ Contacts) --');
  const companyStats = {};
  for (const [compId, comp] of Object.entries(graph.companies || {})) {
    if (comp.contacts.length < 3) continue;
    let totalBeh = 0, goldCount = 0;
    for (const u of comp.contacts) {
      const c = graph.contacts[u];
      totalBeh += c?.behavioralScore || 0;
      if (c?.scores?.tier === 'gold') goldCount++;
    }
    companyStats[compId] = {
      name: comp.name,
      count: comp.contacts.length,
      avgBehavioral: totalBeh / comp.contacts.length,
      goldCount,
    };
  }
  const rankedCompanies = Object.entries(companyStats)
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 10);
  if (rankedCompanies.length === 0) {
    console.log('  No companies with 3+ contacts.\n');
  } else {
    for (const [, stats] of rankedCompanies) {
      console.log(`  ${stats.name} — ${stats.count} contacts (${stats.goldCount} gold, avg beh: ${stats.avgBehavioral.toFixed(2)})`);
    }
    console.log();
  }

  // 4. Bridge Connectors (in 3+ clusters, amplify across communities)
  console.log('-- 4. Bridge Connectors (3+ Clusters) --');
  const bridges = contacts
    .filter(c => {
      const cls = clustersForContact(c.url, graph);
      return cls.length >= 3 && (c.behavioralScore || 0) >= 0.2;
    })
    .sort((a, b) => {
      const clsA = clustersForContact(a.url, graph).length;
      const clsB = clustersForContact(b.url, graph).length;
      return clsB - clsA || (b.behavioralScore || 0) - (a.behavioralScore || 0);
    })
    .slice(0, 10);
  if (bridges.length === 0) {
    console.log('  No bridge connectors found.\n');
  } else {
    bridges.forEach((c, i) => {
      const { name, roleLine } = contactLabel(c);
      const cls = clustersForContact(c.url, graph);
      console.log(`  ${i + 1}. ${name} (beh: ${c.behavioralScore?.toFixed(2)}) — spans ${cls.length} clusters: ${cls.join(', ')}`);
      console.log(`     ${roleLine}`);
    });
    console.log();
  }

  // 5. Rising Stars to Engage Now (recent + high behavioral potential)
  console.log('-- 5. Rising Stars (Recent + High Potential) --');
  const risers = contacts
    .filter(c => c.behavioralPersona === 'rising-connector')
    .sort((a, b) => (b.behavioralScore || 0) - (a.behavioralScore || 0))
    .slice(0, 10);
  if (risers.length === 0) {
    console.log('  No rising connectors found.\n');
  } else {
    risers.forEach((c, i) => {
      const { name, roleLine } = contactLabel(c);
      const days = c.behavioralSignals?.connectedDaysAgo;
      console.log(`  ${i + 1}. ${name} (beh: ${c.behavioralScore?.toFixed(2)}) — connected ${days != null ? days + 'd ago' : 'recently'}`);
      console.log(`     ${roleLine}`);
    });
    console.log();
  }

  // 6. Silent Influencers to Activate (500+ connections, low engagement)
  console.log('-- 6. Silent Influencers to Activate --');
  const silent = contacts
    .filter(c => c.behavioralPersona === 'silent-influencer')
    .sort((a, b) => (b.behavioralSignals?.connectionCount || 0) - (a.behavioralSignals?.connectionCount || 0))
    .slice(0, 10);
  if (silent.length === 0) {
    console.log('  No silent influencers found.\n');
  } else {
    silent.forEach((c, i) => {
      const { name, roleLine } = contactLabel(c);
      console.log(`  ${i + 1}. ${name} (${c.behavioralSignals?.connectionCount || '500+'}+ connections, beh: ${c.behavioralScore?.toFixed(2)})`);
      console.log(`     ${roleLine}`);
      console.log(`     Strategy: Engage their rare posts, tag in relevant content, request warm intros`);
    });
    console.log();
  }
}

// ---- Mode: referrals ----
function modeReferrals(graph, opts) {
  const top = parseInt(opts.top, 10) || 20;
  const personaFilter = opts.persona || null;
  const tierFilter = opts.tier || null;
  let urls = Object.keys(graph.contacts);

  const ranked = urls
    .map(url => ({ url, c: graph.contacts[url] }))
    .filter(({ c }) => c.scores?.referralLikelihood !== undefined)
    .filter(({ c }) => !personaFilter || c.referralPersona === personaFilter)
    .filter(({ c }) => !tierFilter || c.referralTier === tierFilter)
    .sort((a, b) => (b.c.scores.referralLikelihood || 0) - (a.c.scores.referralLikelihood || 0))
    .slice(0, top);

  if (ranked.length === 0) {
    console.log('No referral scores found. Run referral-scorer.mjs first.');
    return;
  }

  console.log(`=== Top ${ranked.length} Referral Partners${personaFilter ? ` [${personaFilter}]` : ''}${tierFilter ? ` (${tierFilter})` : ''} ===\n`);
  ranked.forEach(({ url, c }, i) => {
    const { name, roleLine, loc } = contactLabel(c);
    const s = c.scores || {};
    const rs = c.referralSignals || {};
    console.log(`${i + 1}. ${name} (referral: ${s.referralLikelihood?.toFixed(2)}, tier: ${c.referralTier || '-'})`);
    console.log(`   ${roleLine}${loc ? ' | ' + loc : ''}`);
    console.log(`   Persona: ${c.referralPersona} | Gold Score: ${s.goldScore?.toFixed(2)} | ICP tier: ${s.tier}`);
    console.log(`   Components: role=${rs.referralRole} overlap=${rs.clientOverlap} reach=${rs.networkReach} amp=${rs.amplificationPower} warmth=${rs.relationshipWarmth} inv=${rs.buyerInversion}`);

    // Why referral explanation
    const reasons = [];
    if (rs.referralRole >= 0.7) reasons.push(`Agency/partner role (${rs.referralRoleMatch})`);
    if (rs.clientOverlap >= 0.4) reasons.push(`Serves target industries (${(rs.clientOverlapIndustries || []).slice(0, 3).join(', ')})`);
    if (rs.networkReach >= 0.5) reasons.push(`Broad network (${rs.networkReachDetail?.connections} conn, ${rs.networkReachDetail?.clusters} clusters)`);
    if (rs.amplificationPower >= 0.4) reasons.push(`Amplification power (${(rs.amplificationSignals || []).join(', ')})`);
    if (rs.relationshipWarmth >= 0.5) reasons.push('Strong existing relationship');
    if (rs.buyerInversion >= 0.5) reasons.push('Ecosystem partner (not a buyer)');
    if (reasons.length === 0) reasons.push('General referral potential');
    console.log(`   Why referral: ${reasons.join('; ')}\n`);
  });

  // Persona summary
  const allWithReferral = urls.filter(u => graph.contacts[u].scores?.referralLikelihood !== undefined);
  const refPersonaSummary = {};
  const refTierSummary = { 'gold-referral': 0, 'silver-referral': 0, 'bronze-referral': 0, none: 0 };
  for (const u of allWithReferral) {
    const c = graph.contacts[u];
    const p = c.referralPersona || 'unknown';
    refPersonaSummary[p] = (refPersonaSummary[p] || 0) + 1;
    refTierSummary[c.referralTier || 'none']++;
  }

  console.log('Referral Tier Breakdown:');
  for (const [t, count] of Object.entries(refTierSummary)) {
    console.log(`  ${t.padEnd(16)} ${count}`);
  }

  console.log('\nReferral Persona Breakdown:');
  for (const [p, count] of Object.entries(refPersonaSummary).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${p.padEnd(22)} ${count}`);
  }
}

// ---- Mode: employers ----
function modeEmployers(graph, opts) {
  const top = parseInt(opts.top, 10) || 15;
  const companies = graph.companies || {};
  const contacts = graph.contacts;

  if (Object.keys(companies).length === 0) {
    console.log('No companies in graph. Run graph-builder.mjs first.');
    return;
  }

  // Compute Employer Network Value for each company
  const companyScores = [];
  for (const [compId, comp] of Object.entries(companies)) {
    if (comp.contacts.length < 2) continue;

    let totalBeh = 0, totalMutuals = 0, goldCount = 0;
    const clusterSet = new Set();
    for (const u of comp.contacts) {
      const c = contacts[u];
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

    // ENV = contactCount*0.30 + avgBehavioral*0.25 + avgMutuals(normalized)*0.20 + goldPct*0.15 + clusterBreadth*0.10
    const env = n * 0.30 / 10 + // normalize count (10 contacts = 0.30)
      avgBeh * 0.25 +
      Math.min(avgMutuals / 200, 1) * 0.20 +
      goldPct * 0.15 +
      clusterBreadth * 0.10;

    companyScores.push({
      id: compId,
      name: comp.name,
      count: n,
      avgBehavioral: avgBeh,
      avgMutuals,
      goldCount,
      goldPct,
      clusterBreadth,
      clusters: [...clusterSet],
      env,
    });
  }

  companyScores.sort((a, b) => b.env - a.env);
  const topN = companyScores.slice(0, top);

  console.log(`=== Top ${topN.length} Employers by Network Value ===\n`);
  topN.forEach((co, i) => {
    console.log(`${i + 1}. ${co.name} (ENV: ${co.env.toFixed(3)})`);
    console.log(`   Contacts: ${co.count} | Gold: ${co.goldCount} (${(co.goldPct * 100).toFixed(0)}%) | Avg behavioral: ${co.avgBehavioral.toFixed(2)}`);
    console.log(`   Avg mutuals: ${co.avgMutuals.toFixed(0)} | Clusters: ${co.clusters.join(', ') || 'none'}`);

    // Show top contact at this company
    const compObj = companies[co.id];
    if (compObj) {
      const topContact = compObj.contacts
        .map(u => contacts[u])
        .filter(Boolean)
        .sort((a, b) => (b.scores?.goldScore || 0) - (a.scores?.goldScore || 0))[0];
      if (topContact) {
        const { name, roleLine } = contactLabel(topContact);
        console.log(`   Top contact: ${name} (gold: ${topContact.scores?.goldScore?.toFixed(2)}) - ${roleLine}`);
      }
    }
    console.log();
  });
}

// ---- Mode: similar (k-NN from stored vector) ----
// Uses stored vector from db.get() -- NO embedder initialization needed (D-8)
async function modeSimilar(graph, opts) {
  const { isRvfAvailable, getContact, queryStore, buildProfileText }
    = await import('./rvf-store.mjs');

  if (!isRvfAvailable()) {
    console.log('Semantic search requires ruvector. Install: npm i ruvector');
    return;
  }

  const targetUrl = opts.url;
  if (!targetUrl) {
    console.log('Usage: --mode similar --url <profile-url> --top N');
    return;
  }

  const targetContact = graph.contacts[targetUrl];
  if (!targetContact) {
    console.log(`Contact not found: ${targetUrl}`);
    return;
  }

  // Try to get the stored vector (fast path -- no embedder needed)
  let targetVector;
  const stored = await getContact(targetUrl);
  if (stored) {
    targetVector = stored.vector;
  } else {
    // Fallback: embed the contact (only if not yet vectorized)
    console.log('  Contact not in vector store, embedding...');
    const ruvector = await import('ruvector');
    const mod = ruvector.default || ruvector;
    const embedder = new mod.OnnxEmbedder({ enableParallel: false });
    await embedder.init();
    targetVector = await embedder.embed(buildProfileText(targetContact));
    await mod.shutdown();
  }

  // k-NN search
  const k = parseInt(opts.top, 10) || 20;
  const results = await queryStore(targetVector, k + 1);  // +1 to account for self
  if (!results || results.length === 0) {
    console.log('RVF store not available or empty. Run: node scripts/vectorize.mjs --from-graph');
    return;
  }

  // Display results
  const name = targetContact.enrichedName || targetContact.name;
  console.log(`\n=== Contacts Similar to: ${name} ===`);
  console.log('='.repeat(60));
  let rank = 0;
  for (const result of results) {
    if (result.id === targetUrl) continue;  // skip self
    rank++;
    const contact = result.metadata || graph.contacts[result.id] || {};
    const displayName = contact.name || result.id;
    const similarity = result.score?.toFixed(3) || '?';
    const tier = contact.tier || '?';
    const headline = (contact.headline || '').substring(0, 70);
    console.log(`  ${rank}. [${tier}] ${displayName} (similarity: ${similarity})`);
    if (headline) console.log(`     ${headline}`);
  }
}

// ---- Mode: semantic (free-text query embedding search) ----
// Requires OnnxEmbedder to embed the query text
async function modeSemantic(graph, opts) {
  const { isRvfAvailable, queryStore } = await import('./rvf-store.mjs');

  if (!isRvfAvailable()) {
    console.log('Semantic search requires ruvector. Install: npm i ruvector');
    return;
  }

  const query = opts.query;
  if (!query) {
    console.log('Usage: --mode semantic --query "search text" --top N');
    return;
  }

  // Embed query text
  const ruvector = await import('ruvector');
  const mod = ruvector.default || ruvector;
  const embedder = new mod.OnnxEmbedder({ enableParallel: false });
  await embedder.init();
  const queryVector = await embedder.embed(query);

  // k-NN search
  const k = parseInt(opts.top, 10) || 20;
  const results = await queryStore(queryVector, k);

  if (!results || results.length === 0) {
    console.log('No results found. Is the store built? Run: node scripts/vectorize.mjs --from-graph');
    await mod.shutdown();
    return;
  }

  console.log(`\n=== Semantic Search: "${query}" ===`);
  console.log('='.repeat(60));
  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    const contact = result.metadata || graph.contacts[result.id] || {};
    const name = contact.name || result.id;
    const relevance = result.score?.toFixed(3) || '?';
    const tier = contact.tier || '?';
    const headline = (contact.headline || '').substring(0, 70);
    console.log(`  ${i + 1}. [${tier}] ${name} (relevance: ${relevance})`);
    if (headline) console.log(`     ${headline}`);
  }

  await mod.shutdown();  // module-level shutdown -- D-6
}

// ---- CLI dispatch ----
const MODES = {
  hubs: modeHubs, prospects: modeProspects, recommend: modeRecommend,
  clusters: modeClusters, summary: modeSummary, company: modeCompany,
  behavioral: modeBehavioral, visibility: modeVisibility, employers: modeEmployers,
  referrals: modeReferrals, similar: modeSimilar, semantic: modeSemantic,
};
const args = parseArgs(process.argv);
const mode = args.mode || 'summary';
if (!MODES[mode]) {
  console.error(`Unknown mode: ${mode}\nAvailable: ${Object.keys(MODES).join(', ')}`);
  process.exit(1);
}
const graph = loadGraph();
Promise.resolve(MODES[mode](graph, args)).catch(e => { console.error(e); process.exit(1); });
