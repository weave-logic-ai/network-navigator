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
 * Options:
 *   --niche <name>   filter niche for search step (full mode only)
 *   --verbose        pass-through to sub-scripts
 */

import { execFileSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
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

    default:
      return [];
  }
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
