#!/usr/bin/env node
// NetworkNav v2 — Pipeline orchestrator
// Usage:
//   node pipeline.mjs --status
//   node pipeline.mjs --score [contactId]
//   node pipeline.mjs --rescore-all
//   node pipeline.mjs --enrich [contactId]
//   node pipeline.mjs --compute-graph
//   node pipeline.mjs --export
//   node pipeline.mjs --health

import { get, post } from './api-client.mjs';

// ── Arg parsing ──────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = argv.slice(2);
  const flags = {};
  for (let i = 0; i < args.length; i++) {
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
  return flags;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function printSection(title) {
  console.log(`\n=== ${title} ===\n`);
}

// ── Commands ─────────────────────────────────────────────────────────────────

async function status() {
  printSection('Dashboard Status');
  const data = await get('/api/dashboard');
  if (data.totalContacts !== undefined) console.log(`  Total contacts:  ${data.totalContacts}`);
  if (data.scoredContacts !== undefined) console.log(`  Scored:          ${data.scoredContacts}`);
  if (data.enrichedContacts !== undefined) console.log(`  Enriched:        ${data.enrichedContacts}`);
  if (data.tiers) {
    console.log('  Tiers:');
    for (const [tier, count] of Object.entries(data.tiers)) {
      console.log(`    ${tier.padEnd(10)} ${count}`);
    }
  }
  // Print any other top-level keys
  for (const [key, val] of Object.entries(data)) {
    if (!['totalContacts', 'scoredContacts', 'enrichedContacts', 'tiers'].includes(key)) {
      console.log(`  ${key}: ${typeof val === 'object' ? JSON.stringify(val) : val}`);
    }
  }
}

async function score(contactId) {
  printSection('Score Contact');
  const body = contactId ? { contactId } : {};
  const result = await post('/api/scoring/run', body);
  console.log(`  Result: ${JSON.stringify(result, null, 2)}`);
}

async function rescoreAll() {
  printSection('Rescore All Contacts');
  const kick = await post('/api/scoring/rescore-all', {});
  console.log(`  Initiated: ${kick.message || kick.status || 'OK'}`);

  // Poll until complete
  const maxAttempts = 60;
  for (let i = 0; i < maxAttempts; i++) {
    await sleep(2000);
    const s = await get('/api/scoring/status');
    const pct = s.progress ?? s.percent ?? '?';
    const state = s.status ?? s.state ?? 'unknown';
    process.stdout.write(`\r  Status: ${state}  Progress: ${pct}%   `);
    if (state === 'complete' || state === 'idle' || state === 'done') {
      console.log('\n  Rescore complete.');
      return;
    }
    if (state === 'error' || state === 'failed') {
      console.log(`\n  Rescore failed: ${s.error || 'unknown error'}`);
      process.exit(1);
    }
  }
  console.log('\n  Timed out waiting for rescore to finish.');
  process.exit(1);
}

async function enrich(contactId) {
  printSection('Enrich Contact');
  const body = contactId ? { contactId } : {};
  const result = await post('/api/enrichment/enrich', body);
  console.log(`  Result: ${JSON.stringify(result, null, 2)}`);
}

async function computeGraph() {
  printSection('Compute Network Graph');
  const result = await post('/api/graph/compute', {});
  console.log(`  Result: ${JSON.stringify(result, null, 2)}`);
}

async function exportData() {
  const data = await get('/api/admin/export');
  // Write raw JSON to stdout for piping
  process.stdout.write(JSON.stringify(data, null, 2));
}

async function health() {
  printSection('Health Check');
  const checks = [
    { name: 'App', path: '/api/health' },
    { name: 'Extension', path: '/api/extension/health-internal' },
  ];
  for (const check of checks) {
    try {
      const result = await get(check.path);
      console.log(`  ${check.name.padEnd(12)} OK  ${result.status || JSON.stringify(result)}`);
    } catch (e) {
      console.log(`  ${check.name.padEnd(12)} FAIL  ${e.message}`);
    }
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

const flags = parseArgs(process.argv);

if (flags.status) {
  await status();
} else if ('score' in flags) {
  await score(typeof flags.score === 'string' ? flags.score : undefined);
} else if (flags['rescore-all']) {
  await rescoreAll();
} else if ('enrich' in flags) {
  await enrich(typeof flags.enrich === 'string' ? flags.enrich : undefined);
} else if (flags['compute-graph']) {
  await computeGraph();
} else if (flags.export) {
  await exportData();
} else if (flags.health) {
  await health();
} else {
  console.log(`
NetworkNav v2 — Pipeline Orchestrator

Usage:
  node pipeline.mjs --status                  Show dashboard stats
  node pipeline.mjs --score [contactId]       Score a contact (or trigger scoring)
  node pipeline.mjs --rescore-all             Rescore all contacts (polls until done)
  node pipeline.mjs --enrich [contactId]      Enrich a contact
  node pipeline.mjs --compute-graph           Recompute network graph
  node pipeline.mjs --export                  Export all data as JSON to stdout
  node pipeline.mjs --health                  Check API and extension health
`);
}
