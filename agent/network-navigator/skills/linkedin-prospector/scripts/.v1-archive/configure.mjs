/**
 * configure.mjs -- ICP config validation, template generator, and interactive wizard.
 *
 * Usage:
 *   node configure.mjs validate                          Check icp-config.json validity
 *   node configure.mjs init                              Generate config (interactive readline)
 *   node configure.mjs wizard                            Full interactive multi-profile setup (readline)
 *   node configure.mjs generate --json '<config>'        Write config from JSON string (non-interactive, for agents)
 *   node configure.mjs generate --profiles '<json>' \    Build config from structured args (non-interactive)
 *     --niches '<json>' [--scoring '<json>'] [--tiers '<json>']
 */

import { readFileSync, writeFileSync, existsSync, copyFileSync } from 'fs';
import { createInterface } from 'readline';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { CONFIG_DIR } from './lib.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = resolve(CONFIG_DIR, 'icp-config.json');

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function loadConfig() {
  if (!existsSync(CONFIG_PATH)) return null;
  return JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));
}

function saveConfig(config) {
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

function backupConfig() {
  if (existsSync(CONFIG_PATH)) {
    const backup = CONFIG_PATH.replace('.json', '.backup.json');
    copyFileSync(CONFIG_PATH, backup);
    console.log(`  Backed up existing config to ${backup}`);
  }
}

function ask(rl, question) {
  return new Promise(resolve => rl.question(question, resolve));
}

function splitInput(input) {
  return input.split(',').map(s => s.trim()).filter(Boolean);
}

// ---------------------------------------------------------------------------
// VALIDATE
// ---------------------------------------------------------------------------

function validate() {
  console.log('Validating icp-config.json...\n');
  const errors = [];
  const warnings = [];

  if (!existsSync(CONFIG_PATH)) {
    errors.push('icp-config.json not found. Run "node configure.mjs init" to create one.');
    report(errors, warnings);
    return;
  }

  let config;
  try {
    config = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));
  } catch (e) {
    errors.push(`Invalid JSON: ${e.message}`);
    report(errors, warnings);
    return;
  }

  if (config._example) {
    warnings.push('Config still has _example marker — this is the uncustomized template.');
  }

  // Profiles
  if (!config.profiles || typeof config.profiles !== 'object') {
    errors.push('Missing "profiles" object.');
  } else {
    const profileNames = Object.keys(config.profiles);
    if (profileNames.length === 0) errors.push('No profiles defined.');
    console.log(`  Profiles: ${profileNames.length} (${profileNames.join(', ')})`);
    for (const [name, p] of Object.entries(config.profiles)) {
      if (!p.rolePatterns) errors.push(`Profile "${name}": missing rolePatterns.`);
      if (!p.industries || p.industries.length === 0) warnings.push(`Profile "${name}": no industries defined.`);
      if (!p.signals || p.signals.length === 0) warnings.push(`Profile "${name}": no signals defined.`);
    }
  }

  // Scoring weights
  if (config.scoring) {
    const sum = Object.values(config.scoring).reduce((a, b) => a + b, 0);
    console.log(`  Scoring weights sum: ${sum.toFixed(2)}`);
    if (Math.abs(sum - 1.0) > 0.01) warnings.push(`Scoring weights sum to ${sum.toFixed(2)}, expected 1.0.`);
  } else {
    errors.push('Missing "scoring" object.');
  }

  // Tiers
  if (config.tiers) {
    const { gold, silver, bronze } = config.tiers;
    console.log(`  Tiers: gold=${gold}, silver=${silver}, bronze=${bronze}`);
    if (gold <= silver || silver <= bronze) errors.push('Tier thresholds must be gold > silver > bronze.');
  } else {
    errors.push('Missing "tiers" object.');
  }

  // Niches
  if (config.niches) {
    console.log(`  Niches: ${Object.keys(config.niches).length} (${Object.keys(config.niches).join(', ')})`);
  } else {
    warnings.push('No "niches" defined — search will require explicit keywords.');
  }

  report(errors, warnings);
}

function report(errors, warnings) {
  console.log('');
  if (warnings.length) {
    for (const w of warnings) console.log(`  WARNING: ${w}`);
  }
  if (errors.length) {
    for (const e of errors) console.log(`  ERROR: ${e}`);
    console.log(`\nValidation FAILED (${errors.length} error(s))`);
    process.exit(1);
  } else {
    console.log('Validation PASSED');
  }
}

// ---------------------------------------------------------------------------
// INIT — quick template from a few inputs
// ---------------------------------------------------------------------------

async function init() {
  const rl = createInterface({ input: process.stdin, output: process.stdout });

  console.log('Quick config generator\n');

  const vertical = await ask(rl, 'Business vertical (e.g., "AI consulting"): ');
  const rolesRaw = await ask(rl, 'Target buyer roles (comma-separated, e.g., "CEO, CTO, VP Eng"): ');
  const industriesRaw = await ask(rl, 'Target industries (comma-separated, e.g., "ecommerce, saas"): ');
  const sizeMin = await ask(rl, 'Min company size (default: 10): ');
  const sizeMax = await ask(rl, 'Max company size (default: 500): ');

  rl.close();

  const roles = splitInput(rolesRaw);
  const industries = splitInput(industriesRaw);
  const slug = vertical.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 30);

  const config = {
    profiles: {
      [slug]: {
        label: vertical,
        description: `Ideal customers for ${vertical}`,
        rolePatterns: {
          high: roles.slice(0, 4),
          medium: roles.slice(4, 8),
          low: roles.slice(8),
        },
        industries,
        signals: [],
        companySizeSweet: { min: parseInt(sizeMin) || 10, max: parseInt(sizeMax) || 500 },
        weight: 1.0,
      },
    },
    scoring: { roleWeight: 0.35, industryWeight: 0.25, signalWeight: 0.25, companySizeWeight: 0.15 },
    goldScore: { icpWeight: 0.35, networkHubWeight: 0.30, relationshipWeight: 0.25, signalBoostWeight: 0.10 },
    tiers: { gold: 0.55, silver: 0.40, bronze: 0.28 },
    niches: { [slug]: industries.slice(0, 5) },
  };

  backupConfig();
  saveConfig(config);
  console.log(`\nConfig written to icp-config.json with profile "${slug}".`);
  console.log('Edit the file to add signals, tune weights, or add more profiles.');
}

// ---------------------------------------------------------------------------
// WIZARD — full interactive multi-profile setup
// ---------------------------------------------------------------------------

async function wizard() {
  const rl = createInterface({ input: process.stdin, output: process.stdout });

  console.log('Interactive ICP Configuration Wizard\n');
  console.log('This will walk you through setting up your ideal customer profiles.\n');

  const profiles = {};
  const niches = {};

  // Step 1: Services
  const servicesRaw = await ask(rl, 'What services do you offer? (comma-separated)\n  e.g., "AI consulting, fractional CTO, custom development"\n> ');
  const services = splitInput(servicesRaw);

  if (services.length === 0) {
    console.log('No services provided. Exiting.');
    rl.close();
    return;
  }

  for (const service of services) {
    const slug = service.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 30);
    console.log(`\n--- Profile: ${service} ---`);

    // Step 2: Roles
    const rolesRaw = await ask(rl, `  Target buyer roles for "${service}"? (comma-separated)\n  > `);
    const roles = splitInput(rolesRaw);

    // Step 3: Industries
    const industriesRaw = await ask(rl, `  Target industries? (comma-separated)\n  > `);
    const industries = splitInput(industriesRaw);

    // Step 4: Signals
    const signalsRaw = await ask(rl, `  Buying signals / intent keywords? (comma-separated)\n  > `);
    const signals = splitInput(signalsRaw);

    profiles[slug] = {
      label: service,
      description: `Ideal customers for ${service}`,
      rolePatterns: {
        high: roles.slice(0, 4),
        medium: roles.slice(4, 8),
        low: roles.slice(8),
      },
      industries,
      signals,
      companySizeSweet: { min: 10, max: 500 },
      weight: 1.0,
    };
  }

  // Step 5: Niches for LinkedIn search
  console.log('\n--- Niche Keywords ---');
  const nicheCountRaw = await ask(rl, 'How many search niches? (default: 1): ');
  const nicheCount = parseInt(nicheCountRaw) || 1;

  for (let i = 0; i < nicheCount; i++) {
    const nicheName = await ask(rl, `  Niche ${i + 1} name (e.g., "ecommerce"): `);
    const nicheKwRaw = await ask(rl, `  Keywords for "${nicheName}" (comma-separated): `);
    if (nicheName) niches[nicheName.toLowerCase().replace(/[^a-z0-9]+/g, '-')] = splitInput(nicheKwRaw);
  }

  rl.close();

  // Build config
  const config = {
    profiles,
    scoring: { roleWeight: 0.35, industryWeight: 0.25, signalWeight: 0.25, companySizeWeight: 0.15 },
    goldScore: { icpWeight: 0.35, networkHubWeight: 0.30, relationshipWeight: 0.25, signalBoostWeight: 0.10 },
    tiers: { gold: 0.55, silver: 0.40, bronze: 0.28 },
    niches,
  };

  // Preview
  console.log('\n--- Preview ---');
  console.log(JSON.stringify(config, null, 2));

  backupConfig();
  saveConfig(config);
  console.log('\nConfig written to icp-config.json.');
  console.log(`  ${Object.keys(profiles).length} profile(s), ${Object.keys(niches).length} niche(s)`);
  console.log('Run "node configure.mjs validate" to verify.');
}

// ---------------------------------------------------------------------------
// GENERATE — non-interactive config creation from CLI args (for agents)
// ---------------------------------------------------------------------------

function generate() {
  const args = {};
  for (let i = 3; i < process.argv.length; i++) {
    if (process.argv[i].startsWith('--')) {
      const key = process.argv[i].slice(2);
      const next = process.argv[i + 1];
      if (!next || next.startsWith('--')) {
        args[key] = true;
      } else {
        args[key] = next;
        i++;
      }
    }
  }

  // Mode 1: full JSON blob passed directly
  if (args.json) {
    let config;
    try {
      config = JSON.parse(args.json);
    } catch (e) {
      console.error(`Invalid JSON: ${e.message}`);
      process.exit(1);
    }
    backupConfig();
    saveConfig(config);
    console.log('Config written from --json input.');
    console.log(`  Profiles: ${Object.keys(config.profiles || {}).join(', ') || 'none'}`);
    console.log(`  Niches: ${Object.keys(config.niches || {}).join(', ') || 'none'}`);
    return;
  }

  // Mode 2: structured args — --profiles and --niches as JSON strings
  if (!args.profiles) {
    console.error('Usage: node configure.mjs generate --json \'<full-config>\'\n       node configure.mjs generate --profiles \'<json>\' --niches \'<json>\'');
    process.exit(1);
  }

  let profiles, niches;
  try { profiles = JSON.parse(args.profiles); } catch (e) {
    console.error(`Invalid --profiles JSON: ${e.message}`);
    process.exit(1);
  }
  try { niches = args.niches ? JSON.parse(args.niches) : {}; } catch (e) {
    console.error(`Invalid --niches JSON: ${e.message}`);
    process.exit(1);
  }

  const scoring = args.scoring ? JSON.parse(args.scoring) :
    { roleWeight: 0.35, industryWeight: 0.25, signalWeight: 0.25, companySizeWeight: 0.15 };
  const goldScore = { icpWeight: 0.35, networkHubWeight: 0.30, relationshipWeight: 0.25, signalBoostWeight: 0.10 };
  const tiers = args.tiers ? JSON.parse(args.tiers) : { gold: 0.55, silver: 0.40, bronze: 0.28 };

  const config = { profiles, scoring, goldScore, tiers, niches };

  backupConfig();
  saveConfig(config);
  console.log('Config generated from CLI args.');
  console.log(`  Profiles: ${Object.keys(profiles).join(', ')}`);
  console.log(`  Niches: ${Object.keys(niches).join(', ')}`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const command = process.argv[2];

switch (command) {
  case 'validate':
    validate();
    break;
  case 'init':
    init().catch(e => { console.error(e); process.exit(1); });
    break;
  case 'wizard':
    wizard().catch(e => { console.error(e); process.exit(1); });
    break;
  case 'generate':
    generate();
    break;
  default:
    console.log('Usage: node configure.mjs <validate|init|wizard|generate>');
    console.log('  validate   — Check icp-config.json validity');
    console.log('  init       — Quick config from a few prompts (interactive)');
    console.log('  wizard     — Full interactive multi-profile setup (interactive)');
    console.log('  generate   — Non-interactive config from CLI args (for agents)');
    console.log('    --json \'{"profiles":...}\'              Full config as JSON');
    console.log('    --profiles \'...\' --niches \'...\'        Structured parts as JSON');
    process.exit(command ? 1 : 0);
}
