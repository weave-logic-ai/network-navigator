/**
 * batch-deep-scan.mjs -- Sequentially deep-scan a prioritized list of contacts
 * using a SINGLE shared browser window (no open/close per scan).
 *
 * Reads the scan list from graph.json scores, runs scanContact() on each one
 * in the same browser context, then rebuilds the graph, re-scores, and
 * regenerates the report.
 *
 * Usage:
 *   node batch-deep-scan.mjs [options]
 *
 * Options:
 *   --criteria <type>  Targeting criteria: gold (default), referral, hub, all, all-ranked
 *   --min-score <n>    Minimum score threshold for inclusion (0-1, default: 0)
 *   --max-pages <n>    Pages per scan (default: 20)
 *   --max-results <n>  Max connections per scan (default: 1000)
 *   --delay <s>        Seconds to wait between scans (default: 15)
 *   --dry-run          Show the scan list without executing
 *   --skip <n>         Skip first N contacts (resume after interruption)
 *   --include-1st      Include 1st-degree connections (default: exclude, 2nd-degree only)
 */
import { execFileSync } from 'child_process';
import { readFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { DATA_DIR } from './lib.mjs';
import { launchBrowser } from './lib.mjs';
import { scanContact } from './deep-scan.mjs';
import { checkBudget, consumeBudget } from './rate-budget.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const GRAPH_PATH = resolve(DATA_DIR, 'graph.json');

// ---------------------------------------------------------------------------
// Parse args
// ---------------------------------------------------------------------------
function parseCliArgs(argv) {
  const opts = {
    criteria: 'gold',
    minScore: 0,
    maxPages: 20,
    maxResults: 1000,
    delay: 15,
    dryRun: false,
    skip: 0,
    exclude1st: true,
  };
  for (let i = 2; i < argv.length; i++) {
    switch (argv[i]) {
      case '--criteria': opts.criteria = argv[++i] || 'gold'; break;
      case '--min-score': opts.minScore = parseFloat(argv[++i]) || 0; break;
      case '--max-pages': opts.maxPages = parseInt(argv[++i]) || 20; break;
      case '--max-results': opts.maxResults = parseInt(argv[++i]) || 1000; break;
      case '--delay': opts.delay = parseInt(argv[++i]) || 15; break;
      case '--dry-run': opts.dryRun = true; break;
      case '--skip': opts.skip = parseInt(argv[++i]) || 0; break;
      case '--include-1st': opts.exclude1st = false; break;
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
    const gold = contacts.filter(c => c.tier === 'gold');
    gold.sort((a, b) => b.goldScore - a.goldScore).forEach(c => add(c, 'gold'));
  }

  if (criteria === 'referral' || criteria === 'all') {
    const goldReferrals = contacts
      .filter(c => c.referralTier === 'gold-referral')
      .filter(c => c.referralLikelihood >= minScore)
      .sort((a, b) => b.referralLikelihood - a.referralLikelihood);
    goldReferrals.forEach(c => add(c, 'gold-referral'));

    const warmIntros = contacts
      .filter(c => c.referralPersona === 'warm-introducer' || c.referralPersona === 'white-label-partner')
      .filter(c => c.referralLikelihood >= minScore)
      .sort((a, b) => b.referralLikelihood - a.referralLikelihood);
    warmIntros.forEach(c => add(c, `referral-${c.referralPersona}`));

    const silverReferrals = contacts
      .filter(c => c.referralTier === 'silver-referral')
      .filter(c => c.referralLikelihood >= minScore)
      .sort((a, b) => b.referralLikelihood - a.referralLikelihood)
      .slice(0, 10);
    silverReferrals.forEach(c => add(c, 'silver-referral'));
  }

  if (criteria === 'hub' || criteria === 'all') {
    const hubs = [...contacts]
      .filter(c => c.networkHub >= minScore)
      .sort((a, b) => b.networkHub - a.networkHub)
      .slice(0, 10);
    hubs.forEach(c => add(c, 'top-hub'));
  }

  if (criteria === 'all') {
    const nonGold = contacts.filter(c => c.tier !== 'gold');
    [...nonGold].sort((a, b) => b.icpFit - a.icpFit).slice(0, 5).forEach(c => add(c, 'top-icp'));
    [...nonGold].sort((a, b) => b.behavioral - a.behavioral).slice(0, 5).forEach(c => add(c, 'top-behavioral'));
    [...nonGold].sort((a, b) => b.relStrength - a.relStrength).slice(0, 5).forEach(c => add(c, 'top-relationship'));
  }

  if (criteria === 'gold') {
    const nonGold = contacts.filter(c => c.tier !== 'gold');
    [...nonGold].sort((a, b) => b.icpFit - a.icpFit).slice(0, 5).forEach(c => add(c, 'top-icp'));
    [...nonGold].sort((a, b) => b.networkHub - a.networkHub).slice(0, 5).forEach(c => add(c, 'top-hub'));
    [...nonGold].sort((a, b) => b.behavioral - a.behavioral).slice(0, 5).forEach(c => add(c, 'top-behavioral'));
    [...nonGold].sort((a, b) => b.relStrength - a.relStrength).slice(0, 5).forEach(c => add(c, 'top-relationship'));
  }

  // All contacts ranked by gold score (for full 2nd-degree network expansion)
  if (criteria === 'all-ranked') {
    const allRanked = [...contacts].sort((a, b) => b.goldScore - a.goldScore);
    allRanked.forEach(c => {
      const tierLabel = c.tier === 'gold' ? 'gold' : c.tier === 'silver' ? 'silver' : c.tier === 'bronze' ? 'bronze' : 'watch';
      add(c, tierLabel);
    });
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
      timeout: 600_000, // 10 min per rebuild step
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
  console.log('  Batch Deep Scan (Shared Browser)');
  console.log(`  Criteria: ${opts.criteria}${opts.minScore > 0 ? ` (min-score: ${opts.minScore})` : ''}`);
  console.log(`  Contacts to scan: ${scanList.length}`);
  console.log(`  Settings: max-pages=${opts.maxPages} max-results=${opts.maxResults} delay=${opts.delay}s`);
  console.log(`  Exclude 1st-degree: ${opts.exclude1st}`);
  if (opts.skip > 0) console.log(`  Skipping first ${opts.skip}`);
  console.log('######################################################\n');

  if (scanList.length === 0) {
    console.log('No contacts to scan (all already deep-scanned or no scored contacts).');
    return;
  }

  // Show the list
  scanList.forEach((c, i) => {
    const marker = i < opts.skip ? '  SKIP' : '';
    console.log(`  ${(i + 1).toString().padStart(4)}. [${c.reason.padEnd(16)}] ${c.name}${marker}`);
  });

  if (opts.dryRun) {
    console.log('\n  --dry-run: stopping here.');
    return;
  }

  // Launch browser ONCE for the entire batch
  console.log('\nLaunching shared browser...');
  const { context, page } = await launchBrowser();

  const results = [];
  const startTime = Date.now();
  let consecutiveErrors = 0;

  try {
    for (let i = opts.skip; i < scanList.length; i++) {
      // Rate budget check before each batch item
      const budget = checkBudget('profile_visits');
      if (!budget.allowed) {
        console.log(`\n  Rate limit reached: ${budget.used}/${budget.limit} profile visits today.`);
        console.log(`  Completed ${results.filter(r => r.ok).length} scans. Resume later with --skip ${i}`);
        break;
      }

      const contact = scanList[i];
      console.log(`\n${'='.repeat(60)}`);
      console.log(`  [${i + 1}/${scanList.length}] Deep-scanning: ${contact.name}`);
      console.log(`  Reason: ${contact.reason}`);
      console.log(`  URL: ${contact.url}`);
      console.log(`${'='.repeat(60)}`);

      const scanStart = Date.now();

      try {
        const result = await scanContact(contact.url, {
          maxPages: opts.maxPages,
          maxResults: opts.maxResults,
          depth: 2,
          exclude1st: opts.exclude1st,
          page, // reuse the shared browser page
        });

        if (result.ok) {
          console.log(`  OK (${elapsed(scanStart)}) — Discovered: ${result.discovered}, New: ${result.added}, Bridges: ${result.bridges}`);
          results.push({ name: contact.name, ok: true, ...result });
          consecutiveErrors = 0;
        } else {
          console.log(`  FAILED (${elapsed(scanStart)}): ${result.error}`);
          results.push({ name: contact.name, ok: false, error: result.error });
          consecutiveErrors++;
        }
      } catch (err) {
        console.log(`  ERROR (${elapsed(scanStart)}): ${err.message}`);
        results.push({ name: contact.name, ok: false, error: err.message });
        consecutiveErrors++;
      }

      // Safety: stop if too many consecutive errors (session probably died)
      if (consecutiveErrors >= 5) {
        console.log('\n  5 consecutive errors — stopping. Resume with --skip ' + (i + 1));
        break;
      }

      // Delay between scans (except after last)
      if (i < scanList.length - 1) {
        console.log(`  Waiting ${opts.delay}s...`);
        await sleep(opts.delay);
      }
    }
  } finally {
    // Close the shared browser
    console.log('\nClosing browser...');
    await context.close();
  }

  // ---------------------------------------------------------------------------
  // Post-scan: rebuild graph, score, generate report
  // ---------------------------------------------------------------------------
  const successCount = results.filter(r => r.ok).length;
  const totalDiscovered = results.filter(r => r.ok).reduce((sum, r) => sum + (r.discovered || 0), 0);
  const totalNew = results.filter(r => r.ok).reduce((sum, r) => sum + (r.added || 0), 0);

  console.log(`\n${'='.repeat(60)}`);
  console.log(`  Scans complete: ${successCount}/${results.length} succeeded`);
  console.log(`  Total discovered: ${totalDiscovered} connections`);
  console.log(`  Total new 2nd-degree contacts: ${totalNew}`);
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
    const detail = r.ok ? `discovered=${r.discovered} new=${r.added} bridges=${r.bridges}` : `ERROR: ${r.error}`;
    console.log(`  [${r.ok ? 'OK  ' : 'FAIL'}] ${r.name.padEnd(35)} ${detail}`);
  }
  console.log(`\n  Total: ${results.length} scans | ${successCount} succeeded | ${results.length - successCount} failed`);
  console.log(`  Total discovered: ${totalDiscovered} | New 2nd-degree: ${totalNew}`);
  console.log(`  Total elapsed: ${elapsed(startTime)}`);
  console.log('');
}

main().catch(e => { console.error(e); process.exit(1); });
