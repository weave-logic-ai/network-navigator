/**
 * targeted-plan.mjs - Intelligence Briefs + Outreach Plan Generator
 *
 * Generates actionable outreach plans with:
 * - Intelligence briefs: Per-contact dossier with context
 * - Outreach plan: Prioritized action list by tier
 * - State machine: Track outreach lifecycle (planned → sent → responded → engaged → converted)
 * - Multiple output formats: JSON, HTML report
 *
 * Usage:
 *   PROSPECTOR_DATA_DIR=... node targeted-plan.mjs [--tier gold|silver|all] [--max 50] [--format html|json|both]
 *   node targeted-plan.mjs --advance <url> <new-state>
 *   node targeted-plan.mjs --status
 *   node targeted-plan.mjs --pipeline
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { parseArgs, DATA_DIR } from './lib.mjs';
import { renderTemplate, selectTemplate, listMergeFields } from './template-engine.mjs';
import yaml from 'yaml';

const __dirname = dirname(fileURLToPath(import.meta.url));
const GRAPH_PATH = resolve(DATA_DIR, 'graph.json');
const STATE_PATH = resolve(DATA_DIR, 'outreach-state.json');
const CONFIG_PATH = resolve(DATA_DIR, 'outreach-config.json');
const TEMPLATES_PATH = resolve(DATA_DIR, 'outreach-templates.yaml');
const PLAN_JSON_PATH = resolve(DATA_DIR, 'outreach-plan.json');
const PLAN_HTML_PATH = resolve(DATA_DIR, 'outreach-plan.html');

const round = n => Math.round(n * 1000) / 1000;

// ---------------------------------------------------------------------------
// Load Data
// ---------------------------------------------------------------------------

function loadGraph() {
  if (!existsSync(GRAPH_PATH)) {
    console.error('graph.json not found. Run pipeline first.');
    process.exit(1);
  }
  return JSON.parse(readFileSync(GRAPH_PATH, 'utf-8'));
}

function loadConfig() {
  if (!existsSync(CONFIG_PATH)) {
    console.error('outreach-config.json not found.');
    process.exit(1);
  }
  return JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));
}

function loadTemplates() {
  if (!existsSync(TEMPLATES_PATH)) {
    console.error('outreach-templates.yaml not found.');
    process.exit(1);
  }
  const content = readFileSync(TEMPLATES_PATH, 'utf-8');
  return yaml.parse(content);
}

function loadState() {
  if (!existsSync(STATE_PATH)) {
    return { contacts: {}, version: '1.0', lastUpdated: new Date().toISOString() };
  }
  return JSON.parse(readFileSync(STATE_PATH, 'utf-8'));
}

function saveState(state) {
  state.lastUpdated = new Date().toISOString();
  writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

// ---------------------------------------------------------------------------
// Intelligence Brief Generation
// ---------------------------------------------------------------------------

/**
 * Generate intelligence brief for a contact
 */
function generateBrief(contact, graph, config) {
  const url = contact.url;
  const scores = contact.scores || {};
  const behavioral = contact.behavioralSignals || {};

  // Mutual connections analysis
  const mutuals = extractMutualConnections(contact, graph);

  // Shared interests
  const sharedInterests = contact.tags || [];

  // Bridge contacts (who discovered them)
  const bridges = extractBridgeContacts(contact, graph);

  // Company context
  const companyPeers = extractCompanyPeers(contact, graph);

  // Receptiveness score
  const receptiveness = computeReceptiveness(contact, config);

  // Recommended approach
  const approach = recommendApproach(contact, receptiveness);

  return {
    // Basic info
    name: contact.enrichedName || contact.name || 'Unknown',
    firstName: (contact.enrichedName || contact.name || '').split(' ')[0],
    headline: contact.headline || contact.currentRole || '',
    currentRole: contact.currentRole || contact.title || '',
    currentCompany: contact.currentCompany || '',
    location: contact.enrichedLocation || '',
    profileUrl: url,

    // Scoring
    goldScore: round(scores.goldScore || 0),
    tier: scores.tier || 'watch',
    persona: contact.personaType || 'unknown',
    icpFit: round(scores.icpFit || 0),
    networkHub: round(scores.networkHub || 0),
    relationshipStrength: round(scores.relationshipStrength || 0),

    // Network context
    degree: contact.degree || 1,
    mutualConnections: mutuals,
    mutualCount: contact.mutualConnections || 0,
    bridgeContacts: bridges,
    companyPeers: companyPeers,

    // Interests & tags
    sharedInterests: sharedInterests,
    clusters: contact.clusters || [],

    // Activity (if available)
    activityScore: contact.activityScore || null,
    lastActivity: contact.activityData?.lastActivityDate || null,

    // Receptiveness & approach
    receptiveness: round(receptiveness),
    recommendedApproach: approach,
    referralLikelihood: round(scores.referralLikelihood || 0),

    // Metadata
    enriched: !!contact.enrichedName,
    dataCompleteness: computeDataCompleteness(contact),
  };
}

/**
 * Extract mutual connections (top 5)
 */
function extractMutualConnections(contact, graph) {
  if (contact.degree === 1) {
    return []; // No mutual connections for 1st degree
  }

  const bridges = contact.discoveredVia || [];
  const mutuals = bridges
    .map(bridgeUrl => {
      const bridge = graph.contacts[bridgeUrl];
      if (!bridge) return null;
      return {
        name: bridge.enrichedName || bridge.name || 'Unknown',
        url: bridgeUrl,
        goldScore: bridge.scores?.goldScore || 0,
        tier: bridge.scores?.tier || 'watch',
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.goldScore - a.goldScore)
    .slice(0, 5);

  return mutuals;
}

/**
 * Extract bridge contacts (who discovered them)
 */
function extractBridgeContacts(contact, graph) {
  const bridges = contact.discoveredVia || [];
  return bridges
    .map(url => {
      const bridge = graph.contacts[url];
      if (!bridge) return null;
      return {
        name: bridge.enrichedName || bridge.name || 'Unknown',
        url,
        tier: bridge.scores?.tier || 'watch',
        relationshipWarmth: bridge.referralSignals?.relationshipWarmth || 0,
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.relationshipWarmth - a.relationshipWarmth);
}

/**
 * Extract other contacts at same company
 */
function extractCompanyPeers(contact, graph) {
  const company = contact.currentCompany;
  if (!company) return [];

  const peers = Object.entries(graph.contacts)
    .filter(([url, c]) => {
      return c.currentCompany === company && url !== contact.url && c.scores;
    })
    .map(([url, c]) => ({
      name: c.enrichedName || c.name || 'Unknown',
      url,
      role: c.currentRole || c.headline || '',
      tier: c.scores.tier || 'watch',
      goldScore: c.scores.goldScore || 0,
    }))
    .sort((a, b) => b.goldScore - a.goldScore)
    .slice(0, 5);

  return peers;
}

/**
 * Compute receptiveness score (likelihood of positive response)
 */
function computeReceptiveness(contact, config) {
  const weights = config.outreach.scoring.receptiveness.weights;
  const scores = contact.scores || {};

  const relStrength = scores.relationshipStrength || 0;
  const behavioral = contact.behavioralScore || 0;
  const activityRecency = computeActivityRecency(contact);
  const mutuals = Math.min((contact.mutualConnections || 0) / 50, 1.0);
  const referral = scores.referralLikelihood || 0;

  return (
    relStrength * weights.relationshipStrength +
    behavioral * weights.behavioralScore +
    activityRecency * weights.activityRecency +
    mutuals * weights.mutualConnections +
    referral * weights.referralLikelihood
  );
}

function computeActivityRecency(contact) {
  if (!contact.activityData?.lastActivityDate) return 0.1;

  const lastActivity = new Date(contact.activityData.lastActivityDate);
  const now = new Date();
  const daysAgo = (now - lastActivity) / (1000 * 60 * 60 * 24);

  if (daysAgo <= 7) return 1.0;
  if (daysAgo <= 30) return 0.7;
  if (daysAgo <= 90) return 0.4;
  return 0.1;
}

function recommendApproach(contact, receptiveness) {
  const persona = contact.personaType || 'unknown';
  const tier = contact.scores?.tier || 'watch';
  const degree = contact.degree || 1;

  if (tier === 'gold' && receptiveness > 0.6) {
    return 'Direct outreach with personalized value proposition';
  }

  if (degree === 2 && contact.discoveredVia?.length > 0) {
    return 'Request warm introduction via mutual connection';
  }

  if (persona === 'influencer') {
    return 'Engage with content first, then connect';
  }

  if (persona === 'decision-maker') {
    return 'Lead with specific ROI/value proposition';
  }

  if (receptiveness < 0.3) {
    return 'Monitor and engage with content before connecting';
  }

  return 'Standard connection request with personalization';
}

function computeDataCompleteness(contact) {
  let score = 0;
  let max = 10;

  if (contact.enrichedName) score++;
  if (contact.headline) score++;
  if (contact.currentRole) score++;
  if (contact.currentCompany) score++;
  if (contact.enrichedLocation) score++;
  if (contact.mutualConnections > 0) score++;
  if (contact.tags?.length > 0) score++;
  if (contact.scores?.goldScore) score++;
  if (contact.behavioralScore) score++;
  if (contact.discoveredVia?.length > 0) score++;

  return score / max;
}

// ---------------------------------------------------------------------------
// Outreach Plan Generation
// ---------------------------------------------------------------------------

/**
 * Generate outreach plan for filtered contacts
 */
function generateOutreachPlan(graph, config, templates, options = {}) {
  const { tier = 'all', max = 50 } = options;

  // Filter contacts
  let contacts = Object.entries(graph.contacts)
    .map(([url, c]) => ({ url, ...c }))
    .filter(c => c.scores);

  // Tier filter
  if (tier !== 'all') {
    contacts = contacts.filter(c => c.scores.tier === tier);
  }

  // Sort by priority score
  contacts = contacts
    .map(c => ({
      ...c,
      priority: computePriorityScore(c, config),
    }))
    .sort((a, b) => b.priority - a.priority)
    .slice(0, max);

  // Generate briefs and actions
  const actions = [];

  for (const contact of contacts) {
    const brief = generateBrief(contact, graph, config);

    // Select template
    const selectedTemplate = selectTemplate(
      contact,
      templates.templates ? Object.values(templates.templates) : [],
      config.outreach.templateSelection.rules
    );

    // Render template
    const contactData = {
      ...brief,
      mutualConnection: brief.mutualConnections[0]?.name || 'a mutual connection',
      sharedInterest: brief.sharedInterests[0] || 'AI and automation',
      personalNote: '', // User will customize
    };

    const rendered = selectedTemplate
      ? renderTemplate(selectedTemplate.template, contactData, {
          maxChars: selectedTemplate.maxChars || null,
        })
      : null;

    actions.push({
      tier: brief.tier,
      contact: brief,
      template: selectedTemplate?.name || 'default',
      message: rendered?.text || '',
      truncated: rendered?.truncated || false,
      priority: contact.priority,
      timing: recommendTiming(contact),
    });
  }

  // Group by tier
  const tierGroups = {
    gold: actions.filter(a => a.tier === 'gold'),
    silver: actions.filter(a => a.tier === 'silver'),
    bronze: actions.filter(a => a.tier === 'bronze'),
  };

  return {
    metadata: {
      generatedAt: new Date().toISOString(),
      totalActions: actions.length,
      tierCounts: {
        gold: tierGroups.gold.length,
        silver: tierGroups.silver.length,
        bronze: tierGroups.bronze.length,
      },
    },
    actions: {
      tier1: tierGroups.gold,
      tier2: tierGroups.silver,
      tier3: tierGroups.bronze,
    },
    allActions: actions,
  };
}

function computePriorityScore(contact, config) {
  const priorities = config.outreach.priorities;
  const scores = contact.scores || {};

  // Base priority from tier
  let priority = priorities.tier[scores.tier] || 0;

  // Add persona bonus
  priority += priorities.persona[contact.personaType] || priorities.persona.default;

  // Add recency bonus (if activity data exists)
  if (contact.activityData?.lastActivityDate) {
    const daysAgo = (Date.now() - new Date(contact.activityData.lastActivityDate)) / (1000 * 60 * 60 * 24);
    if (daysAgo <= 7) priority += priorities.recency.days_0_7;
    else if (daysAgo <= 30) priority += priorities.recency.days_8_30;
    else if (daysAgo <= 90) priority += priorities.recency.days_31_90;
  }

  // Boost by goldScore
  priority += (scores.goldScore || 0) * 20;

  return priority;
}

function recommendTiming(contact) {
  const persona = contact.personaType || 'unknown';
  const activityRecency = contact.activityData?.lastActivityDate
    ? (Date.now() - new Date(contact.activityData.lastActivityDate)) / (1000 * 60 * 60 * 24)
    : 999;

  if (activityRecency <= 3) {
    return 'Reach out within 24-48 hours (recent activity)';
  }

  if (persona === 'decision-maker') {
    return 'Tuesday-Wednesday 8-10am (optimal for decision makers)';
  }

  if (persona === 'influencer') {
    return 'Engage with 2-3 posts first, then connect';
  }

  return 'Standard timing (Tue-Thu mornings)';
}

// ---------------------------------------------------------------------------
// State Machine
// ---------------------------------------------------------------------------

/**
 * Advance contact to new state
 */
function advanceState(url, newState, config) {
  const state = loadState();

  if (!state.contacts[url]) {
    state.contacts[url] = {
      currentState: 'planned',
      history: [],
      createdAt: new Date().toISOString(),
    };
  }

  const contact = state.contacts[url];
  const currentState = contact.currentState;

  // Validate transition
  const validTransitions = config.outreach.lifecycle.transitions[currentState] || [];
  if (!validTransitions.includes(newState)) {
    console.error(`Invalid transition: ${currentState} → ${newState}`);
    console.error(`Valid transitions: ${validTransitions.join(', ')}`);
    return false;
  }

  // Record transition
  contact.history.push({
    from: currentState,
    to: newState,
    timestamp: new Date().toISOString(),
  });
  contact.currentState = newState;

  saveState(state);
  console.log(`✓ Advanced ${url} from ${currentState} → ${newState}`);
  return true;
}

/**
 * Get pipeline view (counts by state)
 */
function getPipeline() {
  const state = loadState();
  const pipeline = {};

  for (const contact of Object.values(state.contacts)) {
    const s = contact.currentState;
    pipeline[s] = (pipeline[s] || 0) + 1;
  }

  return pipeline;
}

// ---------------------------------------------------------------------------
// HTML Report Generation
// ---------------------------------------------------------------------------

function generateHTML(plan) {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Outreach Plan - ${new Date().toLocaleDateString()}</title>
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; max-width: 1200px; margin: 2rem auto; padding: 0 2rem; background: #f5f5f5; }
    h1, h2, h3 { color: #1a1a1a; }
    .header { background: white; padding: 2rem; border-radius: 8px; margin-bottom: 2rem; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
    .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1rem; margin-top: 1rem; }
    .stat-card { background: #f8f9fa; padding: 1rem; border-radius: 4px; border-left: 4px solid #007bff; }
    .stat-card h3 { margin: 0 0 0.5rem 0; font-size: 0.875rem; color: #666; text-transform: uppercase; }
    .stat-card .value { font-size: 2rem; font-weight: bold; color: #1a1a1a; }
    .tier-section { background: white; padding: 2rem; border-radius: 8px; margin-bottom: 2rem; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
    .tier-gold { border-left: 4px solid #ffd700; }
    .tier-silver { border-left: 4px solid #c0c0c0; }
    .tier-bronze { border-left: 4px solid #cd7f32; }
    .action-card { background: #f8f9fa; padding: 1.5rem; border-radius: 4px; margin-bottom: 1rem; }
    .contact-header { display: flex; justify-content: space-between; align-items: start; margin-bottom: 1rem; }
    .contact-name { font-size: 1.25rem; font-weight: bold; color: #1a1a1a; }
    .contact-role { color: #666; margin-top: 0.25rem; }
    .contact-company { color: #007bff; font-weight: 500; }
    .scores { display: flex; gap: 1rem; margin: 1rem 0; }
    .score-badge { background: white; padding: 0.5rem 1rem; border-radius: 4px; text-align: center; }
    .score-badge .label { font-size: 0.75rem; color: #666; text-transform: uppercase; }
    .score-badge .value { font-weight: bold; color: #1a1a1a; }
    .message-box { background: white; padding: 1rem; border-radius: 4px; border: 1px solid #dee2e6; margin: 1rem 0; font-family: monospace; font-size: 0.875rem; white-space: pre-wrap; }
    .meta { display: flex; gap: 2rem; margin-top: 1rem; font-size: 0.875rem; color: #666; }
    .meta-item { display: flex; align-items: center; gap: 0.5rem; }
    .badge { display: inline-block; padding: 0.25rem 0.75rem; border-radius: 12px; font-size: 0.75rem; font-weight: 500; }
    .badge-gold { background: #fff3cd; color: #856404; }
    .badge-silver { background: #e2e3e5; color: #383d41; }
    .badge-bronze { background: #f8d7da; color: #721c24; }
    .mutuals { margin: 1rem 0; }
    .mutual { background: white; padding: 0.5rem; border-radius: 4px; margin: 0.25rem 0; font-size: 0.875rem; }
    .timing { background: #d1ecf1; padding: 0.75rem; border-radius: 4px; margin-top: 1rem; font-size: 0.875rem; color: #0c5460; }
    .print-btn { background: #007bff; color: white; border: none; padding: 0.75rem 1.5rem; border-radius: 4px; cursor: pointer; font-size: 1rem; }
    .print-btn:hover { background: #0056b3; }
    @media print { .no-print { display: none; } }
  </style>
</head>
<body>
  <div class="header">
    <h1>Outreach Plan</h1>
    <p>Generated: ${new Date(plan.metadata.generatedAt).toLocaleString()}</p>
    <div class="stats">
      <div class="stat-card">
        <h3>Total Actions</h3>
        <div class="value">${plan.metadata.totalActions}</div>
      </div>
      <div class="stat-card">
        <h3>Gold Tier</h3>
        <div class="value">${plan.metadata.tierCounts.gold}</div>
      </div>
      <div class="stat-card">
        <h3>Silver Tier</h3>
        <div class="value">${plan.metadata.tierCounts.silver}</div>
      </div>
      <div class="stat-card">
        <h3>Bronze Tier</h3>
        <div class="value">${plan.metadata.tierCounts.bronze}</div>
      </div>
    </div>
    <button class="print-btn no-print" onclick="window.print()">Print Plan</button>
  </div>

  ${generateTierSection('Tier 1: Gold Contacts (Direct Outreach)', plan.actions.tier1, 'gold')}
  ${generateTierSection('Tier 2: Silver Contacts (Warm Introduction)', plan.actions.tier2, 'silver')}
  ${generateTierSection('Tier 3: Bronze Contacts (Monitor & Nurture)', plan.actions.tier3, 'bronze')}
</body>
</html>`;

  return html;
}

function generateTierSection(title, actions, tier) {
  if (actions.length === 0) return '';

  return `
  <div class="tier-section tier-${tier}">
    <h2>${title}</h2>
    ${actions.map(action => generateActionCard(action)).join('\n')}
  </div>`;
}

function generateActionCard(action) {
  const c = action.contact;

  return `
  <div class="action-card">
    <div class="contact-header">
      <div>
        <div class="contact-name">${c.name}</div>
        <div class="contact-role">${c.currentRole}</div>
        <div class="contact-company">${c.currentCompany}</div>
      </div>
      <span class="badge badge-${c.tier}">${c.tier.toUpperCase()}</span>
    </div>

    <div class="scores">
      <div class="score-badge">
        <div class="label">Gold Score</div>
        <div class="value">${c.goldScore}</div>
      </div>
      <div class="score-badge">
        <div class="label">ICP Fit</div>
        <div class="value">${c.icpFit}</div>
      </div>
      <div class="score-badge">
        <div class="label">Receptiveness</div>
        <div class="value">${c.receptiveness}</div>
      </div>
      <div class="score-badge">
        <div class="label">Mutuals</div>
        <div class="value">${c.mutualCount}</div>
      </div>
    </div>

    ${c.mutualConnections.length > 0 ? `
    <div class="mutuals">
      <strong>Mutual Connections:</strong>
      ${c.mutualConnections.map(m => `<div class="mutual">${m.name} (${m.tier})</div>`).join('')}
    </div>
    ` : ''}

    ${c.sharedInterests.length > 0 ? `
    <div class="meta">
      <div class="meta-item"><strong>Shared Interests:</strong> ${c.sharedInterests.join(', ')}</div>
    </div>
    ` : ''}

    <div style="margin-top: 1rem;">
      <strong>Recommended Approach:</strong> ${c.recommendedApproach}
    </div>

    <div class="message-box">${action.message}</div>

    <div class="timing">
      <strong>⏰ Timing:</strong> ${action.timing}
    </div>

    <div class="meta">
      <div class="meta-item"><strong>Template:</strong> ${action.template}</div>
      <div class="meta-item"><strong>Persona:</strong> ${c.persona}</div>
      <div class="meta-item"><a href="${c.profileUrl}" target="_blank">View Profile</a></div>
    </div>
  </div>`;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv);

  // Load data
  const graph = loadGraph();
  const config = loadConfig();
  const templates = loadTemplates();

  // Handle state commands
  if (args.advance) {
    const url = args.advance;
    const newState = args._ || process.argv[4];
    if (!newState) {
      console.error('Usage: --advance <url> <new-state>');
      process.exit(1);
    }
    advanceState(url, newState, config);
    return;
  }

  if (args.status) {
    const state = loadState();
    console.log('\n📊 Outreach Status\n');
    console.log(`Total contacts tracked: ${Object.keys(state.contacts).length}`);
    console.log(`Last updated: ${state.lastUpdated}\n`);
    return;
  }

  if (args.pipeline) {
    const pipeline = getPipeline();
    console.log('\n📈 Outreach Pipeline\n');
    for (const [state, count] of Object.entries(pipeline).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${state.padEnd(20)} ${count}`);
    }
    console.log('');
    return;
  }

  // Generate plan
  const tier = args.tier || 'all';
  const max = parseInt(args.max || '50', 10);
  const format = args.format || 'both';

  console.log(`\n🎯 Generating outreach plan...`);
  console.log(`   Tier filter: ${tier}`);
  console.log(`   Max actions: ${max}\n`);

  const plan = generateOutreachPlan(graph, config, templates, { tier, max });

  // Save JSON
  if (format === 'json' || format === 'both') {
    writeFileSync(PLAN_JSON_PATH, JSON.stringify(plan, null, 2));
    console.log(`✓ Saved JSON: ${PLAN_JSON_PATH}`);
  }

  // Save HTML
  if (format === 'html' || format === 'both') {
    const html = generateHTML(plan);
    writeFileSync(PLAN_HTML_PATH, html);
    console.log(`✓ Saved HTML: ${PLAN_HTML_PATH}`);
  }

  // Summary
  console.log(`\n📋 Plan Summary:`);
  console.log(`   Gold tier: ${plan.metadata.tierCounts.gold} contacts`);
  console.log(`   Silver tier: ${plan.metadata.tierCounts.silver} contacts`);
  console.log(`   Bronze tier: ${plan.metadata.tierCounts.bronze} contacts`);
  console.log(`   Total: ${plan.metadata.totalActions} actions\n`);
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
