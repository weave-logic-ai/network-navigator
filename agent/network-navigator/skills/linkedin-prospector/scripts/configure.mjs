#!/usr/bin/env node
// NetworkNav v2 — ICP / Niche / Offering configuration wizard
// Usage:
//   node configure.mjs validate
//   node configure.mjs list
//   node configure.mjs generate --json '{ ... }'

import { get, post } from './api-client.mjs';

// ── Arg parsing ──────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = argv.slice(2);
  const cmd = args[0];
  const flags = {};
  for (let i = 1; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      const key = args[i].slice(2);
      const next = args[i + 1];
      if (next && !next.startsWith('--')) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    }
  }
  return { cmd, flags };
}

// ── Formatting helpers ───────────────────────────────────────────────────────

function table(rows, headers) {
  if (!rows.length) {
    console.log('  (none)');
    return;
  }
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => String(r[i] ?? '').length))
  );
  const sep = widths.map((w) => '-'.repeat(w)).join(' | ');
  const fmt = (row) => row.map((c, i) => String(c ?? '').padEnd(widths[i])).join(' | ');
  console.log(`  ${fmt(headers)}`);
  console.log(`  ${sep}`);
  rows.forEach((r) => console.log(`  ${fmt(r)}`));
}

// ── Commands ─────────────────────────────────────────────────────────────────

async function validate() {
  console.log('\n=== Configuration Validation ===\n');

  const [icps, niches, offerings] = await Promise.all([
    get('/api/icps').catch(() => []),
    get('/api/niches').catch(() => []),
    get('/api/offerings').catch(() => []),
  ]);

  const icpList = Array.isArray(icps) ? icps : icps?.data ?? [];
  const nicheList = Array.isArray(niches) ? niches : niches?.data ?? [];
  const offeringList = Array.isArray(offerings) ? offerings : offerings?.data ?? [];

  console.log(`ICPs:       ${icpList.length}`);
  console.log(`Niches:     ${nicheList.length}`);
  console.log(`Offerings:  ${offeringList.length}`);

  if (!icpList.length) console.log('\n  WARNING: No ICP profiles configured. Run "configure.mjs generate" first.');
  if (!nicheList.length) console.log('  WARNING: No niches configured.');
  if (!offeringList.length) console.log('  WARNING: No offerings configured.');

  if (icpList.length) {
    console.log('\nICP Profiles:');
    table(
      icpList.map((p) => [p.slug || p.id, p.name, (p.criteria?.roles || []).join(', ')]),
      ['Slug', 'Name', 'Roles']
    );
  }

  if (nicheList.length) {
    console.log('\nNiches:');
    table(
      nicheList.map((n) => [n.slug || n.id, n.name, (n.keywords || []).slice(0, 4).join(', ')]),
      ['Slug', 'Name', 'Keywords']
    );
  }

  if (offeringList.length) {
    console.log('\nOfferings:');
    table(
      offeringList.map((o) => [o.id || '-', o.name, (o.description || '').slice(0, 50)]),
      ['ID', 'Name', 'Description']
    );
  }

  console.log('\nValidation complete.\n');
}

async function list() {
  console.log('\n=== Full Configuration Listing ===\n');

  const [icps, niches, offerings] = await Promise.all([
    get('/api/icps').catch(() => []),
    get('/api/niches').catch(() => []),
    get('/api/offerings').catch(() => []),
  ]);

  const icpList = Array.isArray(icps) ? icps : icps?.data ?? [];
  const nicheList = Array.isArray(niches) ? niches : niches?.data ?? [];
  const offeringList = Array.isArray(offerings) ? offerings : offerings?.data ?? [];

  console.log('--- ICPs ---');
  if (icpList.length) {
    icpList.forEach((p) => {
      console.log(`\n  [${p.slug || p.id}] ${p.name}`);
      if (p.description) console.log(`    ${p.description}`);
      if (p.criteria) {
        const c = p.criteria;
        if (c.roles?.length) console.log(`    Roles:      ${c.roles.join(', ')}`);
        if (c.industries?.length) console.log(`    Industries: ${c.industries.join(', ')}`);
        if (c.signals?.length) console.log(`    Signals:    ${c.signals.join(', ')}`);
        if (c.companySizeRanges?.length) console.log(`    Sizes:      ${c.companySizeRanges.join(', ')}`);
      }
    });
  } else {
    console.log('  (none)');
  }

  console.log('\n--- Niches ---');
  if (nicheList.length) {
    nicheList.forEach((n) => {
      console.log(`\n  [${n.slug || n.id}] ${n.name}`);
      if (n.keywords?.length) console.log(`    Keywords: ${n.keywords.join(', ')}`);
    });
  } else {
    console.log('  (none)');
  }

  console.log('\n--- Offerings ---');
  if (offeringList.length) {
    offeringList.forEach((o) => {
      console.log(`\n  [${o.id || '-'}] ${o.name}`);
      if (o.description) console.log(`    ${o.description}`);
    });
  } else {
    console.log('  (none)');
  }

  console.log('');
}

async function generate(jsonStr) {
  if (!jsonStr) {
    console.error('Error: --json argument is required.\nUsage: configure.mjs generate --json \'{"profiles":{...},"niches":{...},"offerings":[...]}\'');
    process.exit(1);
  }

  let config;
  try {
    config = JSON.parse(jsonStr);
  } catch (e) {
    console.error(`Error: Invalid JSON — ${e.message}`);
    process.exit(1);
  }

  console.log('\n=== Generating Configuration ===\n');

  const results = { icps: [], niches: [], offerings: [] };

  // Create ICP profiles
  if (config.profiles) {
    for (const [slug, profile] of Object.entries(config.profiles)) {
      try {
        const created = await post('/api/icps', { slug, ...profile });
        results.icps.push({ slug, status: 'created', id: created.id });
        console.log(`  ICP created: ${slug} — ${profile.name}`);
      } catch (e) {
        results.icps.push({ slug, status: 'error', error: e.message });
        console.error(`  ICP failed:  ${slug} — ${e.message}`);
      }
    }
  }

  // Create niches
  if (config.niches) {
    for (const [slug, niche] of Object.entries(config.niches)) {
      try {
        const created = await post('/api/niches', { slug, ...niche });
        results.niches.push({ slug, status: 'created', id: created.id });
        console.log(`  Niche created: ${slug} — ${niche.name}`);
      } catch (e) {
        results.niches.push({ slug, status: 'error', error: e.message });
        console.error(`  Niche failed:  ${slug} — ${e.message}`);
      }
    }
  }

  // Create offerings
  if (config.offerings && Array.isArray(config.offerings)) {
    for (const offering of config.offerings) {
      try {
        const created = await post('/api/offerings', offering);
        results.offerings.push({ name: offering.name, status: 'created', id: created.id });
        console.log(`  Offering created: ${offering.name}`);
      } catch (e) {
        results.offerings.push({ name: offering.name, status: 'error', error: e.message });
        console.error(`  Offering failed:  ${offering.name} — ${e.message}`);
      }
    }
  }

  const total = results.icps.length + results.niches.length + results.offerings.length;
  const errors = [...results.icps, ...results.niches, ...results.offerings].filter(
    (r) => r.status === 'error'
  ).length;
  console.log(`\nDone. ${total} items processed, ${errors} errors.\n`);
}

// ── Main ─────────────────────────────────────────────────────────────────────

const { cmd, flags } = parseArgs(process.argv);

switch (cmd) {
  case 'validate':
    await validate();
    break;
  case 'list':
    await list();
    break;
  case 'generate':
    await generate(flags.json);
    break;
  default:
    console.log(`
NetworkNav v2 — Configuration Manager

Usage:
  node configure.mjs validate              Validate current ICP/niche/offering config
  node configure.mjs list                  List all configured profiles
  node configure.mjs generate --json '{}'  Create profiles from JSON

JSON format for generate:
  {
    "profiles": { "slug": { "name": "...", "description": "...", "criteria": { ... } } },
    "niches":   { "slug": { "name": "...", "keywords": ["..."] } },
    "offerings": [ { "name": "...", "description": "..." } ]
  }
`);
    break;
}
