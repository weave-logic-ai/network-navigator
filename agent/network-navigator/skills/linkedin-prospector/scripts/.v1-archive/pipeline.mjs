/**
 * pipeline.mjs -- Network Intelligence pipeline orchestrator.
 *
 * Modes:
 *   --full       search -> enrich -> graph -> score -> behavioral -> referral -> vectorize -> analyze -> snapshot
 *   --rebuild    graph -> score -> behavioral -> referral -> vectorize -> analyze -> snapshot  (default)
 *   --rescore    score -> behavioral -> referral -> analyze
 *   --behavioral behavioral -> analyze(behavioral) -> analyze(visibility)
 *   --referrals  referral-scorer -> analyzer(referrals)
 *   --vectorize  vectorize scored graph data into vector store (standalone)
 *   --report     generate interactive HTML dashboard from graph.json
 *   --deep-scan  deep-scan a single contact + rebuild graph + report
 *   --visualize  (Phase 2 - not yet implemented)
 *
 * GDPR Compliance:
 *   --forget <url>   purge all data for a contact (right to erasure)
 *   --auto-archive   archive terminal-state contacts older than 180 days
 *   --consent <url> --basis <type>  record consent basis for a contact
 *
 * Options:
 *   --niche <name>   filter niche for search step (full mode only)
 *   --verbose        pass-through to sub-scripts
 */

import { execFileSync } from 'child_process';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function elapsed(startMs) {
  const s = ((Date.now() - startMs) / 1000).toFixed(1);
  return `${s}s`;
}

function run(script, args = [], timeout = 120_000) {
  const scriptPath = resolve(__dirname, script);
  const label = `${script} ${args.join(' ')}`.trim();
  console.log(`\n${'='.repeat(60)}`);
  console.log(`  STEP: ${label}`);
  console.log(`${'='.repeat(60)}`);

  const stepStart = Date.now();
  try {
    const output = execFileSync('node', [scriptPath, ...args], {
      cwd: __dirname,
      encoding: 'utf-8',
      stdio: 'pipe',
      timeout: timeout,
    });
    if (output.trim()) console.log(output);
    console.log(`  -> completed in ${elapsed(stepStart)}`);
    return true;
  } catch (err) {
    console.error(`  !! ERROR in ${script}: ${err.message}`);
    if (err.stdout) console.log(err.stdout);
    if (err.stderr) console.error(err.stderr);
    console.log(`  -> failed after ${elapsed(stepStart)}`);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Parse CLI args
// ---------------------------------------------------------------------------

function parseCliArgs(argv) {
  const opts = {
    mode: 'rebuild', // default
    niche: null,
    verbose: false,
  };

  for (let i = 2; i < argv.length; i++) {
    switch (argv[i]) {
      case '--full':
        opts.mode = 'full';
        break;
      case '--rebuild':
        opts.mode = 'rebuild';
        break;
      case '--rescore':
        opts.mode = 'rescore';
        break;
      case '--behavioral':
        opts.mode = 'behavioral';
        break;
      case '--referrals':
        opts.mode = 'referrals';
        break;
      case '--report':
        opts.mode = 'report';
        break;
      case '--deep-scan':
        opts.mode = 'deep-scan';
        break;
      case '--configure':
        opts.mode = 'configure';
        break;
      case '--init':
        opts.mode = 'init';
        break;
      case '--validate':
        opts.mode = 'validate';
        break;
      case '--reparse':
        opts.mode = 'reparse';
        break;
      case '--url':
        opts.url = argv[++i] || null;
        break;
      case '--vectorize':
        opts.mode = 'vectorize';
        break;
      case '--visualize':
        opts.mode = 'visualize';
        break;
      case '--niche':
        opts.niche = argv[++i] || null;
        break;
      case '--output':
        opts.output = argv[++i] || null;
        break;
      case '--top':
        opts.top = argv[++i] || null;
        break;
      case '--verbose':
        opts.verbose = true;
        break;
      case '--forget':
        opts.mode = 'forget';
        opts.forgetUrl = argv[++i] || null;
        break;
      case '--auto-archive':
        opts.mode = 'auto-archive';
        break;
      case '--consent':
        opts.mode = 'consent';
        opts.consentUrl = argv[++i] || null;
        break;
      case '--basis':
        opts.consentBasis = argv[++i] || null;
        break;
      default:
        console.warn(`Unknown flag: ${argv[i]}`);
    }
  }
  return opts;
}

// ---------------------------------------------------------------------------
// Pipeline definitions
// ---------------------------------------------------------------------------

function buildSteps(opts) {
  const v = opts.verbose ? ['--verbose'] : [];

  switch (opts.mode) {
    case 'full': {
      const steps = [];
      // 1. Search (optionally filtered by niche)
      if (opts.niche) {
        steps.push({ script: 'search.mjs', args: ['--niche', opts.niche, ...v] });
      }
      // 2. Enrich
      steps.push({ script: 'enrich.mjs', args: ['--unenriched-only', '--max', '50', ...v] });
      // 3-8. Graph -> Score -> Behavioral -> Referral -> Analyze -> Snapshot
      steps.push({ script: 'graph-builder.mjs', args: [...v] });
      steps.push({ script: 'scorer.mjs', args: [...v] });
      steps.push({ script: 'behavioral-scorer.mjs', args: [...v] });
      steps.push({ script: 'referral-scorer.mjs', args: [...v] });
      steps.push({ script: 'vectorize.mjs', args: ['--from-graph', ...v] });
      steps.push({ script: 'analyzer.mjs', args: ['--mode', 'summary', ...v] });
      steps.push({ script: 'delta.mjs', args: ['--snapshot', ...v] });
      return steps;
    }

    case 'rebuild':
      return [
        { script: 'graph-builder.mjs', args: [...v] },
        { script: 'scorer.mjs', args: [...v] },
        { script: 'behavioral-scorer.mjs', args: [...v] },
        { script: 'referral-scorer.mjs', args: [...v] },
        { script: 'vectorize.mjs', args: ['--from-graph', ...v] },
        { script: 'analyzer.mjs', args: ['--mode', 'summary', ...v] },
        { script: 'delta.mjs', args: ['--snapshot', ...v] },
      ];

    case 'rescore':
      return [
        { script: 'scorer.mjs', args: [...v] },
        { script: 'behavioral-scorer.mjs', args: [...v] },
        { script: 'referral-scorer.mjs', args: [...v] },
        { script: 'analyzer.mjs', args: ['--mode', 'summary', ...v] },
      ];

    case 'behavioral':
      return [
        { script: 'behavioral-scorer.mjs', args: [...v] },
        { script: 'analyzer.mjs', args: ['--mode', 'behavioral', ...v] },
        { script: 'analyzer.mjs', args: ['--mode', 'visibility', ...v] },
      ];

    case 'report':
      return [
        { script: 'report-generator.mjs', args: [...v] },
      ];

    case 'deep-scan': {
      const steps = [];
      if (opts.url) {
        steps.push({ script: 'deep-scan.mjs', args: ['--url', opts.url, ...v] });
      }
      steps.push({ script: 'graph-builder.mjs', args: [...v] });
      steps.push({ script: 'scorer.mjs', args: [...v] });
      steps.push({ script: 'behavioral-scorer.mjs', args: [...v] });
      steps.push({ script: 'referral-scorer.mjs', args: [...v] });
      steps.push({ script: 'report-generator.mjs', args: [...v] });
      return steps;
    }

    case 'referrals':
      return [
        { script: 'referral-scorer.mjs', args: [...v] },
        { script: 'analyzer.mjs', args: ['--mode', 'referrals', ...v] },
      ];

    case 'configure':
      // NOTE: wizard/init require interactive stdin — they won't work via execFileSync.
      // From pipeline, only validate is safe. For config generation, use configure.mjs generate directly.
      console.log('\n  Configure mode requires interactive input.');
      console.log('  Use one of:');
      console.log('    node scripts/configure.mjs wizard     (interactive terminal)');
      console.log('    node scripts/configure.mjs generate --json \'...\'  (non-interactive)');
      return [];

    case 'init':
      console.log('\n  Init mode requires interactive input.');
      console.log('  Use: node scripts/configure.mjs init    (interactive terminal)');
      console.log('  Or:  node scripts/configure.mjs generate --json \'...\'  (non-interactive)');
      return [];

    case 'validate':
      return [{ script: 'configure.mjs', args: ['validate'] }];

    case 'reparse':
      return [{ script: 'reparse.mjs', args: ['--all'] }];

    case 'vectorize':
      return [
        { script: 'vectorize.mjs', args: ['--from-graph', ...v] },
      ];

    case 'visualize':
      return []; // handled separately

    case 'forget':
    case 'auto-archive':
    case 'consent':
      return []; // handled directly in main()

    default:
      return [];
  }
}

// ---------------------------------------------------------------------------
// GDPR Compliance
// ---------------------------------------------------------------------------

/**
 * Normalize a LinkedIn URL or slug to a canonical URL.
 */
function normalizeUrl(input) {
  let url = input.trim();
  if (!url.startsWith('https://')) {
    // Strip leading slashes or "in/" prefix for bare slugs
    url = url.replace(/^\/+/, '').replace(/^in\//, '');
    url = `https://www.linkedin.com/in/${url}`;
  }
  // Strip trailing slash for consistent matching
  return url.replace(/\/+$/, '');
}

/**
 * Safely read a JSON file. Returns null if it doesn't exist or can't be parsed.
 */
function safeReadJson(filePath) {
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, 'utf-8'));
  } catch {
    return null;
  }
}

/**
 * Safely write a JSON file, creating parent dirs if needed.
 */
function safeWriteJson(filePath, data) {
  writeFileSync(filePath, JSON.stringify(data, null, 2));
}

/**
 * Purge ALL data for a contact across every data file (GDPR right to erasure).
 */
async function forgetContact(rawUrl) {
  const { DATA_DIR } = await import('./lib.mjs');
  const url = normalizeUrl(rawUrl);
  const startMs = Date.now();

  console.log(`\nGDPR Forget: ${url}`);
  console.log('='.repeat(60));

  const summary = [];

  // --- graph.json ---
  const graphPath = resolve(DATA_DIR, 'graph.json');
  const graph = safeReadJson(graphPath);
  if (graph) {
    let contactRemoved = 0;
    let edgesRemoved = 0;
    let clusterMemberships = 0;
    let discoveredViaRefs = 0;

    // Remove contact entry
    if (graph.contacts && graph.contacts[url]) {
      delete graph.contacts[url];
      contactRemoved = 1;
    }

    // Remove edges referencing this contact
    if (graph.edges && Array.isArray(graph.edges)) {
      const before = graph.edges.length;
      graph.edges = graph.edges.filter(
        e => e.source !== url && e.target !== url
      );
      edgesRemoved = before - graph.edges.length;
    }

    // Remove from cluster contact arrays
    if (graph.clusters) {
      for (const [clusterId, cluster] of Object.entries(graph.clusters)) {
        if (cluster.contacts && Array.isArray(cluster.contacts)) {
          const before = cluster.contacts.length;
          cluster.contacts = cluster.contacts.filter(c => c !== url);
          if (cluster.contacts.length < before) {
            clusterMemberships++;
          }
        }
      }
    }

    // Remove from discoveredVia arrays in other contacts
    if (graph.contacts) {
      for (const [, contact] of Object.entries(graph.contacts)) {
        if (contact.discoveredVia && Array.isArray(contact.discoveredVia)) {
          const before = contact.discoveredVia.length;
          contact.discoveredVia = contact.discoveredVia.filter(v => v !== url);
          if (contact.discoveredVia.length < before) {
            discoveredViaRefs++;
          }
        }
      }
    }

    if (contactRemoved || edgesRemoved || clusterMemberships || discoveredViaRefs) {
      safeWriteJson(graphPath, graph);
      const parts = [];
      if (contactRemoved) parts.push(`${contactRemoved} contact`);
      if (edgesRemoved) parts.push(`${edgesRemoved} edges`);
      if (clusterMemberships) parts.push(`${clusterMemberships} cluster memberships`);
      if (discoveredViaRefs) parts.push(`${discoveredViaRefs} discoveredVia refs`);
      summary.push(`Removed from graph.json (${parts.join(', ')})`);
    } else {
      summary.push('Not found in graph.json (no changes)');
    }
  } else {
    console.log('  graph.json not found, skipping');
  }

  // --- outreach-state.json ---
  const statePath = resolve(DATA_DIR, 'outreach-state.json');
  const state = safeReadJson(statePath);
  if (state) {
    if (state.contacts && state.contacts[url]) {
      delete state.contacts[url];
      state.lastUpdated = new Date().toISOString();
      safeWriteJson(statePath, state);
      summary.push('Removed from outreach-state.json');
    } else {
      summary.push('Not found in outreach-state.json (no changes)');
    }
  } else {
    console.log('  outreach-state.json not found, skipping');
  }

  // --- outreach-plan.json ---
  const planPath = resolve(DATA_DIR, 'outreach-plan.json');
  const plan = safeReadJson(planPath);
  if (plan) {
    let planRemoved = false;

    // Plan may be an object with contacts/entries keyed by URL, or an array
    if (plan.contacts && plan.contacts[url]) {
      delete plan.contacts[url];
      planRemoved = true;
    }
    if (plan.plans && Array.isArray(plan.plans)) {
      const before = plan.plans.length;
      plan.plans = plan.plans.filter(p => p.url !== url && p.contactUrl !== url);
      if (plan.plans.length < before) planRemoved = true;
    }
    if (plan.entries && Array.isArray(plan.entries)) {
      const before = plan.entries.length;
      plan.entries = plan.entries.filter(e => e.url !== url && e.contactUrl !== url);
      if (plan.entries.length < before) planRemoved = true;
    }

    if (planRemoved) {
      safeWriteJson(planPath, plan);
      summary.push('Removed from outreach-plan.json');
    } else {
      summary.push('Not found in outreach-plan.json (no changes)');
    }
  } else {
    console.log('  outreach-plan.json not found, skipping');
  }

  // --- contacts.json ---
  const contactsPath = resolve(DATA_DIR, 'contacts.json');
  const contactsDb = safeReadJson(contactsPath);
  if (contactsDb) {
    if (contactsDb.contacts && contactsDb.contacts[url]) {
      delete contactsDb.contacts[url];
      contactsDb.meta = contactsDb.meta || {};
      contactsDb.meta.totalContacts = Object.keys(contactsDb.contacts).length;
      contactsDb.meta.lastUpdated = new Date().toISOString();
      safeWriteJson(contactsPath, contactsDb);
      summary.push('Removed from contacts.json');
    } else {
      summary.push('Not found in contacts.json (no changes)');
    }
  } else {
    console.log('  contacts.json not found, skipping');
  }

  // --- network.rvf (vector store) ---
  const rvfPath = resolve(DATA_DIR, 'network.rvf');
  const rvfExists = existsSync(rvfPath);

  // --- Print summary ---
  console.log(`\nGDPR Forget Complete for: ${url}`);
  for (const line of summary) {
    const marker = line.includes('no changes') ? '-' : 'v';
    console.log(`  ${marker} ${line}`);
  }
  if (rvfExists) {
    console.log("  ! Run 'node pipeline.mjs --rebuild' to regenerate vector store");
  }
  console.log(`\n  Elapsed: ${elapsed(startMs)}\n`);
}

/**
 * Auto-archive contacts in terminal states older than N days.
 */
async function autoArchive(days = 180) {
  const { DATA_DIR } = await import('./lib.mjs');
  const statePath = resolve(DATA_DIR, 'outreach-state.json');
  const startMs = Date.now();

  console.log(`\nAuto-Archive: terminal states older than ${days} days`);
  console.log('='.repeat(60));

  const state = safeReadJson(statePath);
  if (!state || !state.contacts) {
    console.log('  outreach-state.json not found or empty. Nothing to archive.');
    return;
  }

  const terminalStates = new Set(['closed_lost', 'declined']);
  const cutoff = Date.now() - (days * 24 * 60 * 60 * 1000);
  state.archived = state.archived || {};

  let archivedCount = 0;
  const breakdown = {};
  const toArchive = [];

  for (const [url, contact] of Object.entries(state.contacts)) {
    if (!terminalStates.has(contact.currentState)) continue;

    // Determine last transition date from history or fallback to createdAt
    let lastTransitionMs = 0;
    if (contact.history && contact.history.length > 0) {
      const lastEntry = contact.history[contact.history.length - 1];
      lastTransitionMs = new Date(lastEntry.date || lastEntry.timestamp || 0).getTime();
    }
    if (!lastTransitionMs && contact.createdAt) {
      lastTransitionMs = new Date(contact.createdAt).getTime();
    }

    if (lastTransitionMs && lastTransitionMs < cutoff) {
      toArchive.push({ url, contact });
    }
  }

  for (const { url, contact } of toArchive) {
    state.archived[url] = {
      state: contact.currentState,
      archivedDate: new Date().toISOString().slice(0, 10),
      reason: `auto-archive-${days}d`,
    };
    breakdown[contact.currentState] = (breakdown[contact.currentState] || 0) + 1;
    delete state.contacts[url];
    archivedCount++;
  }

  if (archivedCount > 0) {
    state.lastUpdated = new Date().toISOString();
    safeWriteJson(statePath, state);
    const parts = Object.entries(breakdown)
      .map(([s, n]) => `${s}: ${n}`)
      .join(', ');
    console.log(`  Auto-archived ${archivedCount} contacts (${parts})`);
  } else {
    console.log('  No contacts eligible for archiving.');
  }

  console.log(`  Elapsed: ${elapsed(startMs)}\n`);
}

/**
 * Record GDPR consent basis on a contact in graph.json.
 */
async function setConsent(rawUrl, basis) {
  const validBases = ['legitimate_interest', 'explicit_consent', 'contract'];
  if (!validBases.includes(basis)) {
    console.error(`Invalid consent basis: "${basis}"`);
    console.error(`  Valid values: ${validBases.join(', ')}`);
    process.exit(1);
  }

  const { DATA_DIR } = await import('./lib.mjs');
  const url = normalizeUrl(rawUrl);
  const graphPath = resolve(DATA_DIR, 'graph.json');
  const graph = safeReadJson(graphPath);

  if (!graph || !graph.contacts) {
    console.error('graph.json not found or has no contacts. Run pipeline first.');
    process.exit(1);
  }

  if (!graph.contacts[url]) {
    console.error(`Contact not found in graph: ${url}`);
    process.exit(1);
  }

  const today = new Date().toISOString().slice(0, 10);
  graph.contacts[url].gdpr = {
    consentBasis: basis,
    consentDate: today,
    lastProcessed: today,
  };

  safeWriteJson(graphPath, graph);
  console.log(`\nConsent recorded for: ${url}`);
  console.log(`  Basis: ${basis}`);
  console.log(`  Date:  ${today}\n`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const opts = parseCliArgs(process.argv);

  console.log('\n######################################################');
  console.log('  Network Intelligence Pipeline');
  console.log(`  Mode: ${opts.mode}`);
  if (opts.niche) console.log(`  Niche: ${opts.niche}`);
  console.log('######################################################');

  // Warn if ICP config is still the example template
  const { CONFIG_DIR: _cfgDir } = await import('./lib.mjs');
  const configPath = resolve(_cfgDir, 'icp-config.json');
  if (existsSync(configPath)) {
    try {
      const config = JSON.parse(readFileSync(configPath, 'utf-8'));
      if (config._example) {
        console.log('\n  WARNING: icp-config.json is still the example template.');
        console.log("  Run 'node pipeline.mjs --configure' to customize for your business.\n");
      }
    } catch { /* ignore parse errors here */ }
  }

  // --- GDPR modes (handled directly, no pipeline steps) ---
  if (opts.mode === 'forget') {
    if (!opts.forgetUrl) {
      console.error('Usage: node pipeline.mjs --forget <linkedin-url-or-slug>');
      process.exit(1);
    }
    await forgetContact(opts.forgetUrl);
    process.exit(0);
  }
  if (opts.mode === 'auto-archive') {
    await autoArchive();
    process.exit(0);
  }
  if (opts.mode === 'consent') {
    if (!opts.consentUrl || !opts.consentBasis) {
      console.error('Usage: node pipeline.mjs --consent <linkedin-url> --basis <legitimate_interest|explicit_consent|contract>');
      process.exit(1);
    }
    await setConsent(opts.consentUrl, opts.consentBasis);
    process.exit(0);
  }

  // Phase 2 placeholder
  if (opts.mode === 'visualize') {
    console.log('\n  Visualization is not yet implemented (Phase 2).');
    console.log('  Graph data can be found in data/graph.json.\n');
    process.exit(0);
  }

  const steps = buildSteps(opts);
  if (steps.length === 0) {
    console.log('\nNo steps to run. Use --full, --rebuild, or --rescore.');
    process.exit(1);
  }

  const pipelineStart = Date.now();
  const results = [];
  let graphOk = true;
  let scorerOk = true;
  let behavioralOk = true;
  let vectorizeOk = true;

  for (const { script, args } of steps) {
    // If graph-builder failed, skip scorer (it depends on graph.json)
    if (script === 'scorer.mjs' && !graphOk) {
      console.log(`\n  SKIP: ${script} (graph-builder failed)`);
      results.push({ script, ok: false, skipped: true });
      scorerOk = false;
      continue;
    }

    // If scorer failed, skip behavioral-scorer (it depends on scores)
    if (script === 'behavioral-scorer.mjs' && !scorerOk) {
      console.log(`\n  SKIP: ${script} (scorer failed)`);
      results.push({ script, ok: false, skipped: true });
      behavioralOk = false;
      continue;
    }

    // If behavioral-scorer failed, skip referral-scorer (it depends on behavioral scores)
    if (script === 'referral-scorer.mjs' && !behavioralOk) {
      console.log(`\n  SKIP: ${script} (behavioral-scorer failed)`);
      results.push({ script, ok: false, skipped: true });
      continue;
    }

    // If any scorer failed, skip vectorize (it depends on scored data)
    if (script === 'vectorize.mjs' && !scorerOk) {
      console.log(`\n  SKIP: ${script} (scorer failed)`);
      results.push({ script, ok: false, skipped: true });
      vectorizeOk = false;
      continue;
    }

    const timeout = script === 'vectorize.mjs' ? 300_000 : 120_000;
    const ok = run(script, args, timeout);
    results.push({ script, ok, skipped: false });

    if (script === 'graph-builder.mjs' && !ok) {
      graphOk = false;
    }
    if (script === 'scorer.mjs' && !ok) {
      scorerOk = false;
    }
    if (script === 'behavioral-scorer.mjs' && !ok) {
      behavioralOk = false;
    }
    if (script === 'vectorize.mjs' && !ok) {
      vectorizeOk = false;
      console.warn('  Vectorize failed -- continuing without vector store');
    }
  }

  // ---------------------------------------------------------------------------
  // Summary
  // ---------------------------------------------------------------------------
  console.log(`\n${'='.repeat(60)}`);
  console.log('  Pipeline Summary');
  console.log(`${'='.repeat(60)}`);

  for (const r of results) {
    const status = r.skipped ? 'SKIPPED' : r.ok ? 'OK' : 'FAILED';
    console.log(`  [${status.padEnd(7)}] ${r.script}`);
  }

  const failed = results.filter(r => !r.ok && !r.skipped).length;
  const skipped = results.filter(r => r.skipped).length;
  const passed = results.filter(r => r.ok).length;

  console.log(`\n  Total: ${results.length} steps | ${passed} passed | ${failed} failed | ${skipped} skipped`);
  console.log(`  Elapsed: ${elapsed(pipelineStart)}`);
  console.log('');

  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
