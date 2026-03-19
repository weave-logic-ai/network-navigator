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
    // Bridge normalization: use 3 so 1 bridge=0.33 (decent), 3+=1.0 (strong), cap handles overflow
    bridgeNorm: 3,
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
  // Added bridge density component using discoveredVia array
  const bridgeCount = (contact.discoveredVia || []).length;
  const bridgeDensity = cap(bridgeCount / 5); // 5 bridges = 1.0 (strong)

  // Original components weighted at 70%, bridge density at 30%
  const baseScore = cap((contact.mutualConnections || 0) / bl.p90Mutuals) * 0.30 +
    ((bl.contactClusters[url] || []).length / bl.totalClusters) * 0.25 +
    connectorIndex(contact) * 0.25 +
    cap((bl.edgeCounts[url] || 0) / bl.maxEdges) * 0.20;

  return baseScore * 0.7 + bridgeDensity * 0.3;
}

// ---- Skills Relevance ----
function computeSkillsRelevance(contact, config) {
  if (!contact.skills || contact.skills.length === 0) return null;

  const skillText = contact.skills.join(' ').toLowerCase();

  // Use word-boundary regex for short terms, .includes() for longer terms
  const matchTerm = (term) => {
    if (term.length <= 3) {
      // Escape special regex characters
      const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp('\\b' + escaped + '\\b', 'i');
      return regex.test(skillText);
    }
    return skillText.includes(term.toLowerCase());
  };

  // AI/ML skills (highest value)
  const AI_SKILLS = ['ai', 'machine learning', 'deep learning', 'nlp', 'pytorch',
    'tensorflow', 'data science', 'generative ai', 'llm', 'automation', 'rpa',
    'computer vision', 'neural network', 'artificial intelligence'];

  // Technical skills (medium value)
  const TECH_SKILLS = ['php', 'javascript', 'python', 'react', 'node.js', 'nodejs',
    'aws', 'azure', 'cloud computing', 'devops', 'kubernetes', 'docker',
    'typescript', 'java', 'golang', 'rust', 'c++'];

  // Business/management skills (lower value but still relevant)
  const BIZ_SKILLS = ['project management', 'agile', 'scrum', 'leadership',
    'business development', 'consulting', 'strategy', 'saas', 'e-commerce',
    'product management', 'marketing', 'sales'];

  // Also check against ICP signals from config
  const icpSignals = [];
  for (const profile of Object.values(config.profiles || {})) {
    icpSignals.push(...(profile.signals || []));
  }

  const aiMatches = AI_SKILLS.filter(s => matchTerm(s)).length;
  const techMatches = TECH_SKILLS.filter(s => matchTerm(s)).length;
  const bizMatches = BIZ_SKILLS.filter(s => matchTerm(s)).length;
  const icpMatches = icpSignals.filter(s => matchTerm(s)).length;

  // Weighted combination: AI skills most valuable, then tech, then biz, bonus for ICP alignment
  const score = cap((aiMatches / 3) * 0.40 +
    (techMatches / 4) * 0.25 +
    (bizMatches / 3) * 0.20 +
    (icpMatches / 2) * 0.15);

  return score;
}

// ---- Network Proximity ----
function computeNetworkProximity(contact, graph) {
  const discoveredVia = contact.discoveredVia || [];
  if (discoveredVia.length === 0) return null;

  // Bridge count: more bridges = higher proximity
  const bridgeCount = discoveredVia.length;
  const bridgeDensity = cap(bridgeCount / 5); // 5+ bridges = 1.0

  // Bridge quality: average goldScore of bridging contacts
  let qualitySum = 0;
  let validBridges = 0;
  for (const bridgeUrl of discoveredVia) {
    const bridge = graph.contacts[bridgeUrl];
    if (bridge && bridge.scores && bridge.scores.goldScore !== undefined) {
      qualitySum += bridge.scores.goldScore;
      validBridges++;
    }
  }
  const bridgeQuality = validBridges > 0 ? qualitySum / validBridges : 0.3; // default to 0.3 if no data

  // Bridge diversity: how many unique clusters are bridges from?
  const bridgeClusters = new Set();
  for (const bridgeUrl of discoveredVia) {
    const bridge = graph.contacts[bridgeUrl];
    if (bridge && bridge.cluster) {
      bridgeClusters.add(bridge.cluster);
    }
  }
  const clusterCount = bridgeClusters.size;
  const totalClusters = Object.keys(graph.clusters || {}).length || 1;
  const bridgeDiversity = cap(clusterCount / Math.min(totalClusters, 5)); // 5 different clusters = 1.0

  // Weighted combination
  return cap(bridgeDensity * 0.50 + bridgeQuality * 0.30 + bridgeDiversity * 0.20);
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
  const degree = contact.degree || 1;
  if (degree >= 2) {
    // 2nd-degree: bridge count replaces searchTerms, mutuals still matter
    const bridgeCount = (contact.discoveredVia || []).length;
    return cap(bridgeCount / bl.bridgeNorm) * 0.40 +
      cap((contact.mutualConnections || 0) / bl.maxMutuals) * 0.35 +
      proximityFactor(contact, icp) * 0.25;
  }
  return cap((contact.mutualConnections || 0) / bl.maxMutuals) * 0.40 +
    cap((contact.searchTerms || []).length / bl.maxSearchTerms) * 0.20 +
    recencyFactor(contact) * 0.20 +
    proximityFactor(contact, icp) * 0.20;
}

// ---- Signal Boost & Gold Score ----
function computeSignalBoost(c) {
  // Continuous scorer with tiered keywords and word-boundary matching for short terms
  const termWeights = {
    // Core AI/automation (highest weight)
    'ai': 0.15, 'machine learning': 0.15, 'deep learning': 0.15, 'llm': 0.15,
    'generative ai': 0.15, 'automation': 0.12, 'hyperautomation': 0.12, 'rpa': 0.12,
    // Applied tech (medium weight)
    'digital transformation': 0.10, 'workflow automation': 0.10, 'mlops': 0.10,
    'data science': 0.08, 'analytics': 0.08, 'nlp': 0.08,
    // Business/ecosystem (lower weight)
    'scaling': 0.06, 'growth': 0.06, 'innovation': 0.05, 'modernization': 0.05,
    'data-driven': 0.05, 'tech stack': 0.05,
  };

  const h = (c.headline || '').toLowerCase();
  const a = (c.about || '').toLowerCase();
  const combinedText = h + ' ' + a;

  let score = 0;
  let headlineBonus = 0;

  for (const [term, weight] of Object.entries(termWeights)) {
    let matched = false;

    // Use word-boundary regex for short terms (3 chars or less) to avoid false positives
    if (term.length <= 3) {
      const regex = new RegExp('\\b' + term + '\\b', 'i');
      if (regex.test(combinedText)) {
        matched = true;
        // Extra bonus if found in headline
        if (regex.test(h)) headlineBonus += weight * 0.3;
      }
    } else {
      // Use .includes() for longer terms (more specific, less prone to false positives)
      if (combinedText.includes(term)) {
        matched = true;
        if (h.includes(term)) headlineBonus += weight * 0.3;
      }
    }

    if (matched) score += weight;
  }

  // Add headline bonus and cap at 1.0
  score += headlineBonus;
  return cap(score);
}
function computeGoldScore(icp, hub, rel, boost, skillsRel, netProx, behavioral, w, degree) {
  // Gold Score V3 with new dimensions: skills relevance, network proximity, behavioral
  // Handle null values by redistributing weight proportionally among available dimensions

  const baseWeights = {
    icpFit: 0.28,
    networkHub: 0.22,
    relationship: 0.17,
    signalBoost: 0.08,
    skillsRelevance: 0.10,
    networkProximity: 0.08,
    behavioral: 0.07,
  };

  // Track which dimensions have data
  const dimensions = {
    icpFit: { value: icp, weight: baseWeights.icpFit, hasData: true },
    networkHub: { value: hub, weight: baseWeights.networkHub, hasData: true },
    relationship: { value: rel, weight: baseWeights.relationship, hasData: true },
    signalBoost: { value: boost, weight: baseWeights.signalBoost, hasData: true },
    skillsRelevance: { value: skillsRel, weight: baseWeights.skillsRelevance, hasData: skillsRel !== null },
    networkProximity: { value: netProx, weight: baseWeights.networkProximity, hasData: netProx !== null },
    behavioral: { value: behavioral, weight: baseWeights.behavioral, hasData: behavioral !== null },
  };

  // Calculate total weight of available dimensions
  let totalWeight = 0;
  let totalWithData = 0;
  for (const dim of Object.values(dimensions)) {
    totalWeight += dim.weight;
    if (dim.hasData) totalWithData += dim.weight;
  }

  // Redistribute weight proportionally
  let score = 0;
  for (const dim of Object.values(dimensions)) {
    if (dim.hasData) {
      const adjustedWeight = (dim.weight / totalWithData) * totalWeight;
      score += dim.value * adjustedWeight;
    }
  }

  return cap(score);
}
function assignTier(gs, t, degree) {
  // Use degree-specific thresholds if available, otherwise fall back to flat thresholds
  let thresholds;
  if (typeof t === 'object' && t !== null && (t['1'] || t['2'])) {
    // Degree-specific thresholds
    const degreeKey = degree >= 2 ? '2' : '1';
    thresholds = t[degreeKey] || t['1']; // default to degree-1 if degree missing
  } else {
    // Flat thresholds (backward compatibility)
    thresholds = t;
  }

  return gs >= thresholds.gold ? 'gold' :
    gs >= thresholds.silver ? 'silver' :
    gs >= thresholds.bronze ? 'bronze' : 'watch';
}
function assignPersona(contact, scores, graph) {
  // Refined persona taxonomy with new types
  if (scores.icpFit >= 0.6 && scores.goldScore >= 0.5) return 'buyer';

  // warm-lead: relationship >= 0.5 AND icpFit >= 0.3 (accessible + some fit)
  if (scores.relationshipStrength >= 0.5 && scores.icpFit >= 0.3) return 'warm-lead';

  if (connectorIndex(contact) >= 0.8) return 'advisor';

  // active-influencer: networkHub >= 0.6 AND has high behavioral scores
  const hasBehavioral = contact.goldScoreV2 && contact.goldScoreV2.behavioral >= 0.6;
  if (scores.networkHub >= 0.6 && hasBehavioral) return 'active-influencer';

  if (scores.networkHub >= 0.6 && scores.icpFit < 0.5) return 'hub';

  // ecosystem-contact: connected to 3+ gold-tier contacts
  const discoveredVia = contact.discoveredVia || [];
  let goldBridgeCount = 0;
  for (const bridgeUrl of discoveredVia) {
    const bridge = graph.contacts[bridgeUrl];
    if (bridge && bridge.scores && bridge.scores.tier === 'gold') {
      goldBridgeCount++;
    }
  }
  if (goldBridgeCount >= 3) return 'ecosystem-contact';

  const r = roleText(contact).toLowerCase();
  if (['engineer', 'developer', 'architect'].some(k => r.includes(k))) return 'peer';

  // Renamed default from 'referral-partner' to 'network-node'
  return 'network-node';
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

  // Fix 'ai' false positives using word-boundary regex
  const aiRegex = /\bai\b/i;
  if (aiRegex.test(text) || text.includes('artificial intelligence')) tags.push('ai-interest');

  if (text.includes('automation')) tags.push('automation-interest');
  if (text.includes('scaling') || text.includes('growth')) tags.push('growth-focus');
  if ((contact.mutualConnections || 0) >= bl.p90Mutuals) tags.push('high-mutual');
  if ((contact.searchTerms || []).length >= 3) tags.push('multi-search');
  return [...new Set(tags)];
}

// ---- Account Penetration ----
function seniorityLevel(contact) {
  const r = roleText(contact).toLowerCase();
  if (['c-level', 'ceo', 'cfo', 'cto', 'coo', 'cio', 'cmo', 'cpo', 'cro',
    'chief', 'founder', 'co-founder', 'owner', 'president'].some(k => r.includes(k))) return 'executive';
  if (['vp', 'svp', 'evp', 'vice president', 'senior vice', 'director']
    .some(k => r.includes(k))) return 'senior';
  if (['manager', 'lead', 'head of', 'team lead', 'principal']
    .some(k => r.includes(k))) return 'mid';
  return 'individual';
}
const SENIORITY_SCORE = { executive: 4, senior: 3, mid: 2, individual: 1 };
const NOISE_COMPANY_RE = /^(full-time|part-time|contract|freelance|self-employed|career break|\d+\s*(yrs?|mos?))/i;

function computeAccountPenetration(graph) {
  const companies = graph.companies || {};
  const companyKeys = Object.keys(companies).filter(k => {
    const name = companies[k].name || k;
    return name.length > 2 && !NOISE_COMPANY_RE.test(name) && !NOISE_COMPANY_RE.test(k);
  });

  const results = {};

  for (const key of companyKeys) {
    const co = companies[key];
    const contactUrls = (co.contacts || []).filter(u => graph.contacts[u]);
    if (contactUrls.length === 0) continue;

    const contactCount = contactUrls.length;

    // Seniority spread: unique levels present / 4
    const seniorityLevels = { executive: 0, senior: 0, mid: 0, individual: 0 };
    for (const url of contactUrls) {
      const level = seniorityLevel(graph.contacts[url]);
      seniorityLevels[level]++;
    }
    const uniqueLevels = Object.values(seniorityLevels).filter(n => n > 0).length;
    const senioritySpread = uniqueLevels / 4;

    // Degree spread: mix of degree-1 and degree-2
    let deg1 = 0;
    let deg2 = 0;
    for (const url of contactUrls) {
      const degree = graph.contacts[url].degree || 1;
      if (degree >= 2) deg2++;
      else deg1++;
    }
    const total = deg1 + deg2;
    let degreeSpread;
    if (total <= 0) {
      degreeSpread = 0.2;
    } else if (deg1 === 0 || deg2 === 0) {
      degreeSpread = 0.2; // all one degree, minimum
    } else {
      const deg1Pct = deg1 / total;
      degreeSpread = 1 - Math.abs(deg1Pct - 0.5) * 2;
    }

    // Average gold score
    let gsSum = 0;
    let gsCount = 0;
    let goldContacts = 0;
    let silverContacts = 0;
    for (const url of contactUrls) {
      const c = graph.contacts[url];
      if (c.scores && c.scores.goldScore !== undefined) {
        gsSum += c.scores.goldScore;
        gsCount++;
        if (c.scores.tier === 'gold') goldContacts++;
        if (c.scores.tier === 'silver') silverContacts++;
      }
    }
    const avgGoldScore = gsCount > 0 ? gsSum / gsCount : 0;

    // Tier presence: fraction of contacts in gold/silver
    const tierPresence = gsCount > 0 ? (goldContacts + silverContacts) / gsCount : 0;

    // Normalized contact count: caps at 10
    const contactCountNorm = cap(contactCount / 10);

    // Penetration score formula
    const penetration = contactCountNorm * 0.30 +
      senioritySpread * 0.25 +
      avgGoldScore * 0.20 +
      degreeSpread * 0.15 +
      tierPresence * 0.10;

    results[key] = {
      displayName: co.name || key,
      score: round(penetration),
      contactCount,
      contactUrls,
      senioritySpread: round(senioritySpread),
      degreeSpread: round(degreeSpread),
      avgGoldScore: round(avgGoldScore),
      tierPresence: round(tierPresence),
      seniorityLevels,
      goldContacts,
      silverContacts,
    };

    // Enhance graph.companies entry
    co.penetrationScore = round(penetration);
    co.seniorityLevels = seniorityLevels;
    co.goldContacts = goldContacts;
    co.silverContacts = silverContacts;
    co.avgGoldScore = round(avgGoldScore);

    // Store on each contact
    for (const url of contactUrls) {
      graph.contacts[url].accountPenetration = {
        company: co.name || key,
        score: round(penetration),
        contactCount,
        senioritySpread: round(senioritySpread),
        degreeSpread: round(degreeSpread),
        avgGoldScore: round(avgGoldScore),
        tierPresence: round(tierPresence),
      };
    }
  }

  // Console summary
  const scored = Object.keys(results);
  const sorted = scored
    .map(k => results[k])
    .sort((a, b) => b.score - a.score);

  console.log(`\n=== Account Penetration ===\n`);
  console.log(`Companies scored: ${scored.length}`);

  if (sorted.length > 0) {
    const top10 = sorted.slice(0, 10);
    console.log(`\nTop ${top10.length} by Penetration Score:`);
    top10.forEach((r, i) => {
      console.log(`  ${String(i + 1).padStart(2)}. ${r.displayName.padEnd(35)} score=${r.score}  contacts=${r.contactCount}  seniority=${r.senioritySpread}  avgGold=${r.avgGoldScore}`);
    });
  }

  const multiContact = sorted.filter(r => r.contactCount >= 3);
  if (multiContact.length > 0) {
    console.log(`\nCompanies with 3+ contacts (${multiContact.length}):`);
    multiContact.forEach(r => {
      console.log(`  ${r.displayName.padEnd(35)} contacts=${r.contactCount}  score=${r.score}  gold=${r.goldContacts}  silver=${r.silverContacts}`);
    });
  }

  return results;
}

// ---- RVF Update ----
async function updateRvfScores(contacts) {
  try {
    const { isRvfAvailable, upsertMetadata, closeStore } = await import('./rvf-store.mjs');
    if (!isRvfAvailable()) return;

    let updated = 0;
    for (const [url, contact] of Object.entries(contacts)) {
      const success = await upsertMetadata(url, {
        icpFit: contact.scores?.icpFit || 0,
        networkHub: contact.scores?.networkHub || 0,
        relationshipStrength: contact.scores?.relationshipStrength || 0,
        signalBoost: contact.scores?.signalBoost || 0,
        goldScore: contact.scores?.goldScore || 0,
        tier: contact.scores?.tier || 'watch',
        persona: contact.personaType || '',
      });
      if (success) updated++;
    }

    await closeStore();
    if (updated > 0) console.log(`  RVF: updated ${updated} contact scores`);
  } catch (err) {
    console.warn(`  RVF score update failed: ${err.message}`);
  }
}

// ---- Main ----
async function score() {
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

    // New scoring dimensions
    const skillsRel = computeSkillsRelevance(c, icp);
    const netProx = computeNetworkProximity(c, graph);
    const behavioral = c.goldScoreV2 && c.goldScoreV2.behavioral !== undefined
      ? c.goldScoreV2.behavioral : null;

    const gs = computeGoldScore(icpFit, networkHub, rel, boost, skillsRel, netProx,
      behavioral, icp.goldScore, c.degree || 1);
    const tier = assignTier(gs, icp.tiers, c.degree || 1);

    c.scores = {
      icpFit: round(icpFit),
      networkHub: round(networkHub),
      relationshipStrength: round(rel),
      signalBoost: round(boost),
      skillsRelevance: skillsRel !== null ? round(skillsRel) : null,
      networkProximity: netProx !== null ? round(netProx) : null,
      goldScore: round(gs),
      tier
    };
    c.personaType = assignPersona(c, c.scores, graph);
    c.icpCategories = computeIcpCategories(c, icp.profiles);
    c.tags = deriveTags(c, url, bl);

    tierCounts[tier]++;
    personaCounts[c.personaType] = (personaCounts[c.personaType] || 0) + 1;
    if (tier === 'gold') topGold.push({ url, name: c.enrichedName || c.name, goldScore: c.scores.goldScore });
    log(`  ${(c.enrichedName || c.name).padEnd(30)} gold=${c.scores.goldScore} tier=${tier} persona=${c.personaType}`);
  }

  // Account penetration scoring (after goldScore is available on all contacts)
  computeAccountPenetration(graph);

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

  await updateRvfScores(graph.contacts);
}

score().catch(e => { console.error(e); process.exit(1); });
