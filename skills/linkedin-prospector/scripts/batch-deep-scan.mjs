/**
 * batch-deep-scan.mjs -- Sequentially deep-scan a prioritized list of contacts.
 *
 * Reads the scan list from graph.json scores, runs deep-scan.mjs on each one,
 * then rebuilds the graph, re-scores, and regenerates the report.
 *
 * Usage:
 *   node batch-deep-scan.mjs [--criteria <type>] [--min-score <n>] [--max-pages 3] [--max-results 50] [--delay 10]
 *
 * Options:
 *   --criteria <type>  Targeting criteria: gold (default), referral, hub, all
 *   --min-score <n>    Minimum score threshold for inclusion (0-1, default: 0)
 *   --max-pages <n>    Pages per scan (default: 3, conservative for rate limits)
 *   --max-results <n>  Max connections per scan (default: 50)
 *   --delay <s>        Seconds to wait between scans (default: 10)
 *   --dry-run          Show the scan list without executing
 *   --skip <n>         Skip first N contacts (resume after interruption)
 */
import { execFileSync } from 'child_process';
import { readFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { DATA_DIR } from './lib.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const GRAPH_PATH = resolve(DATA_DIR, 'graph.json');

// ---------------------------------------------------------------------------
// Parse args
// ---------------------------------------------------------------------------
function parseCliArgs(argv) {
  const opts = {
    criteria: 'gold',
    minScore: 0,
    maxPages: 3,
    maxResults: 50,
    delay: 10,
    dryRun: false,
    skip: 0,
  };
  for (let i = 2; i < argv.length; i++) {
    switch (argv[i]) {
      case '--criteria': opts.criteria = argv[++i] || 'gold'; break;
      case '--min-score': opts.minScore = parseFloat(argv[++i]) || 0; break;
      case '--max-pages': opts.maxPages = parseInt(argv[++i]) || 3; break;
      case '--max-results': opts.maxResults = parseInt(argv[++i]) || 50; break;
      case '--delay': opts.delay = parseInt(argv[++i]) || 10; break;
      case '--dry-run': opts.dryRun = true; break;
      case '--skip': opts.skip = parseInt(argv[++i]) || 0; break;
    }
  }
  return opts;
}

// ---------------------------------------------------------------------------
// Build prioritized scan list from graph.json
// ---------------------------------------------------------------------------
function buildScanList(criteria = 'gold', minScore = 0) {
  const graph = JSON.parse(readFileSync(GRAPH_PATH, 'utf-8'));
  const contacts = Object.entries(graph.contacts)
    .filter(([, c]) => c.scores)
    .map(([url, c]) => ({
      url,
      name: c.enrichedName || c.name,
      goldScore: c.scores.goldScore || 0,
      icpFit: c.scores.icpFit || 0,
      networkHub: c.scores.networkHub || 0,
      relStrength: c.scores.relationshipStrength || 0,
      behavioral: c.behavioralScore || 0,
      referralLikelihood: c.scores.referralLikelihood || 0,
      referralTier: c.referralTier || null,
      referralPersona: c.referralPersona || null,
      tier: c.scores.tier || 'watch',
      deepScanned: c.deepScanned || false,
    }));

  const seen = new Set();
  const list = [];
  function add(c, reason) {
    if (seen.has(c.url)) return;
    if (c.deepScanned) return; // already scanned
    seen.add(c.url);
    list.push({ url: c.url, name: c.name, reason });
  }

  if (criteria === 'gold' || criteria === 'all') {
    // All gold-tier contacts
    const gold = contacts.filter(c => c.tier === 'gold');
    gold.sort((a, b) => b.goldScore - a.goldScore).forEach(c => add(c, 'gold'));
  }

  if (criteria === 'referral' || criteria === 'all') {
    // Gold-referral tier contacts first
    const goldReferrals = contacts
      .filter(c => c.referralTier === 'gold-referral')
      .filter(c => c.referralLikelihood >= minScore)
      .sort((a, b) => b.referralLikelihood - a.referralLikelihood);
    goldReferrals.forEach(c => add(c, 'gold-referral'));

    // Warm introducers and white-label partners
    const warmIntros = contacts
      .filter(c => c.referralPersona === 'warm-introducer' || c.referralPersona === 'white-label-partner')
      .filter(c => c.referralLikelihood >= minScore)
      .sort((a, b) => b.referralLikelihood - a.referralLikelihood);
    warmIntros.forEach(c => add(c, `referral-${c.referralPersona}`));

    // Silver-referral tier
    const silverReferrals = contacts
      .filter(c => c.referralTier === 'silver-referral')
      .filter(c => c.referralLikelihood >= minScore)
      .sort((a, b) => b.referralLikelihood - a.referralLikelihood)
      .slice(0, 10);
    silverReferrals.forEach(c => add(c, 'silver-referral'));
  }

  if (criteria === 'hub' || criteria === 'all') {
    // Top network hubs
    const hubs = [...contacts]
      .filter(c => c.networkHub >= minScore)
      .sort((a, b) => b.networkHub - a.networkHub)
      .slice(0, 10);
    hubs.forEach(c => add(c, 'top-hub'));
  }

  if (criteria === 'all') {
    const nonGold = contacts.filter(c => c.tier !== 'gold');
    // Top 5 ICP
    [...nonGold].sort((a, b) => b.icpFit - a.icpFit).slice(0, 5).forEach(c => add(c, 'top-icp'));
    // Top 5 Behavioral
    [...nonGold].sort((a, b) => b.behavioral - a.behavioral).slice(0, 5).forEach(c => add(c, 'top-behavioral'));
    // Top 5 Relationship
    [...nonGold].sort((a, b) => b.relStrength - a.relStrength).slice(0, 5).forEach(c => add(c, 'top-relationship'));
  }

  // Legacy default: gold criteria without referral data falls back to original behavior
  if (criteria === 'gold') {
    const nonGold = contacts.filter(c => c.tier !== 'gold');
    [...nonGold].sort((a, b) => b.icpFit - a.icpFit).slice(0, 5).forEach(c => add(c, 'top-icp'));
    [...nonGold].sort((a, b) => b.networkHub - a.networkHub).slice(0, 5).forEach(c => add(c, 'top-hub'));
    [...nonGold].sort((a, b) => b.behavioral - a.behavioral).slice(0, 5).forEach(c => add(c, 'top-behavioral'));
    [...nonGold].sort((a, b) => b.relStrength - a.relStrength).slice(0, 5).forEach(c => add(c, 'top-relationship'));
  }

  return list;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function elapsed(startMs) {
  const s = ((Date.now() - startMs) / 1000).toFixed(1);
  return `${s}s`;
}

function sleep(seconds) {
  return new Promise(r => setTimeout(r, seconds * 1000));
}

function runScript(script, args = []) {
  const scriptPath = resolve(__dirname, script);
  try {
    const output = execFileSync('node', [scriptPath, ...args], {
      cwd: __dirname,
      encoding: 'utf-8',
      stdio: 'pipe',
      timeout: 180_000, // 3 min per scan
    });
    return { ok: true, output };
  } catch (err) {
    return { ok: false, output: err.stdout || '', error: err.message };
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const opts = parseCliArgs(process.argv);
  const scanList = buildScanList(opts.criteria, opts.minScore);

  console.log('\n######################################################');
  console.log('  Batch Deep Scan');
  console.log(`  Criteria: ${opts.criteria}${opts.minScore > 0 ? ` (min-score: ${opts.minScore})` : ''}`);
  console.log(`  Contacts to scan: ${scanList.length}`);
  console.log(`  Settings: max-pages=${opts.maxPages} max-results=${opts.maxResults} delay=${opts.delay}s`);
  if (opts.skip > 0) console.log(`  Skipping first ${opts.skip}`);
  console.log('######################################################\n');

  if (scanList.length === 0) {
    console.log('No contacts to scan (all already deep-scanned or no scored contacts).');
    return;
  }

  // Show the list
  scanList.forEach((c, i) => {
    const marker = i < opts.skip ? '  SKIP' : '';
    console.log(`  ${(i + 1).toString().padStart(2)}. [${c.reason.padEnd(16)}] ${c.name}${marker}`);
  });

  if (opts.dryRun) {
    console.log('\n  --dry-run: stopping here.');
    return;
  }

  // Execute scans sequentially
  const results = [];
  const startTime = Date.now();

  for (let i = opts.skip; i < scanList.length; i++) {
    const contact = scanList[i];
    console.log(`\n${'='.repeat(60)}`);
    console.log(`  [${i + 1}/${scanList.length}] Deep-scanning: ${contact.name}`);
    console.log(`  Reason: ${contact.reason}`);
    console.log(`  URL: ${contact.url}`);
    console.log(`${'='.repeat(60)}`);

    const scanStart = Date.now();
    const result = runScript('deep-scan.mjs', [
      '--url', contact.url,
      '--max-pages', String(opts.maxPages),
      '--max-results', String(opts.maxResults),
    ]);

    if (result.ok) {
      // Extract summary from output
      const lines = result.output.split('\n');
      const discoveredLine = lines.find(l => l.includes('Discovered:'));
      const newLine = lines.find(l => l.includes('New contacts:'));
      const bridgeLine = lines.find(l => l.includes('Bridge connections'));
      console.log(`  OK (${elapsed(scanStart)})`);
      if (discoveredLine) console.log(`  ${discoveredLine.trim()}`);
      if (newLine) console.log(`  ${newLine.trim()}`);
      if (bridgeLine) console.log(`  ${bridgeLine.trim()}`);
      results.push({ name: contact.name, ok: true });
    } else {
      console.log(`  FAILED (${elapsed(scanStart)}): ${result.error}`);
      if (result.output) {
        // Show last few lines of output for debugging
        const lines = result.output.trim().split('\n');
        lines.slice(-5).forEach(l => console.log(`    ${l}`));
      }
      results.push({ name: contact.name, ok: false, error: result.error });
    }

    // Delay between scans (except after last)
    if (i < scanList.length - 1) {
      console.log(`  Waiting ${opts.delay}s before next scan...`);
      await sleep(opts.delay);
    }
  }

  // ---------------------------------------------------------------------------
  // Post-scan: rebuild graph, score, generate report
  // ---------------------------------------------------------------------------
  const successCount = results.filter(r => r.ok).length;
  console.log(`\n${'='.repeat(60)}`);
  console.log(`  Scans complete: ${successCount}/${results.length} succeeded`);
  console.log(`${'='.repeat(60)}`);

  if (successCount > 0) {
    console.log('\n  Rebuilding graph and scores...');
    const rebuildStart = Date.now();

    const steps = [
      { script: 'graph-builder.mjs', args: [] },
      { script: 'scorer.mjs', args: [] },
      { script: 'behavioral-scorer.mjs', args: [] },
      { script: 'referral-scorer.mjs', args: [] },
      { script: 'report-generator.mjs', args: [] },
    ];

    for (const step of steps) {
      console.log(`\n  Running ${step.script}...`);
      const r = runScript(step.script, step.args);
      if (r.ok) {
        // Show last summary line
        const lines = r.output.trim().split('\n');
        const summary = lines.slice(-3).join('\n    ');
        console.log(`    ${summary}`);
      } else {
        console.log(`    FAILED: ${r.error}`);
      }
    }

    console.log(`\n  Rebuild complete in ${elapsed(rebuildStart)}`);
  }

  // ---------------------------------------------------------------------------
  // Final summary
  // ---------------------------------------------------------------------------
  console.log(`\n${'='.repeat(60)}`);
  console.log('  BATCH DEEP SCAN SUMMARY');
  console.log(`${'='.repeat(60)}`);
  for (const r of results) {
    console.log(`  [${r.ok ? 'OK  ' : 'FAIL'}] ${r.name}`);
  }
  console.log(`\n  Total: ${results.length} scans | ${successCount} succeeded | ${results.length - successCount} failed`);
  console.log(`  Total elapsed: ${elapsed(startTime)}`);
  console.log('');
}

main().catch(e => { console.error(e); process.exit(1); });
