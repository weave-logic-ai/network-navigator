#!/usr/bin/env node
// NetworkNav v2 — Analysis tool
// Usage:
//   node analyze.mjs --mode summary
//   node analyze.mjs --mode hubs --top 10
//   node analyze.mjs --mode prospects --top 10
//   node analyze.mjs --mode referrals --top 10
//   node analyze.mjs --mode clusters
//   node analyze.mjs --mode search --query "text"
//   node analyze.mjs --mode recommend
//   node analyze.mjs --mode company --name "Acme"

import { get } from './api-client.mjs';

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

// ── Formatting ───────────────────────────────────────────────────────────────

function table(rows, headers) {
  if (!rows.length) {
    console.log('  (no results)');
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

function printSection(title) {
  console.log(`\n=== ${title} ===\n`);
}

function contactRow(c) {
  return [
    c.name || c.fullName || `${c.firstName || ''} ${c.lastName || ''}`.trim(),
    c.company || c.currentCompany || '-',
    c.title || c.headline || '-',
    c.compositeScore?.toFixed(2) ?? c.score?.toFixed(2) ?? '-',
    c.tier || '-',
  ];
}

const CONTACT_HEADERS = ['Name', 'Company', 'Title', 'Score', 'Tier'];

// ── Modes ────────────────────────────────────────────────────────────────────

async function summary() {
  printSection('Network Summary');
  const data = await get('/api/dashboard');
  for (const [key, val] of Object.entries(data)) {
    if (typeof val === 'object' && val !== null) {
      console.log(`  ${key}:`);
      for (const [k2, v2] of Object.entries(val)) {
        console.log(`    ${k2.padEnd(20)} ${v2}`);
      }
    } else {
      console.log(`  ${key.padEnd(22)} ${val}`);
    }
  }
}

async function hubs(top) {
  printSection(`Top ${top} Network Hubs`);
  const data = await get('/api/graph/data');
  const nodes = Array.isArray(data) ? data : data?.nodes ?? [];
  const sorted = nodes
    .filter((n) => n.score !== undefined || n.compositeScore !== undefined)
    .sort((a, b) => (b.score ?? b.compositeScore ?? 0) - (a.score ?? a.compositeScore ?? 0))
    .slice(0, top);
  table(
    sorted.map((n) => [
      n.name || n.label || n.id,
      n.company || '-',
      n.score?.toFixed(2) ?? n.compositeScore?.toFixed(2) ?? '-',
      n.connections ?? n.degree ?? '-',
    ]),
    ['Name', 'Company', 'Score', 'Connections']
  );
}

async function prospects(top) {
  printSection(`Top ${top} Prospects`);
  const data = await get(`/api/contacts?sort=compositeScore&order=desc&limit=${top}`);
  const contacts = Array.isArray(data) ? data : data?.data ?? [];
  table(contacts.map(contactRow), CONTACT_HEADERS);
}

async function referrals(top) {
  printSection(`Top ${top} Referral Candidates`);
  // Try referral-specific endpoint first, fall back to general contacts sorted by referral score
  let contacts;
  try {
    const data = await get(`/api/contacts?sort=referralLikelihood&order=desc&limit=${top}`);
    contacts = Array.isArray(data) ? data : data?.data ?? [];
  } catch {
    const data = await get(`/api/contacts?sort=compositeScore&order=desc&limit=100`);
    const all = Array.isArray(data) ? data : data?.data ?? [];
    contacts = all
      .filter((c) => c.referralLikelihood || c.referralScore)
      .sort((a, b) => (b.referralLikelihood ?? b.referralScore ?? 0) - (a.referralLikelihood ?? a.referralScore ?? 0))
      .slice(0, top);
  }
  table(
    contacts.map((c) => [
      ...contactRow(c).slice(0, 3),
      c.referralLikelihood?.toFixed(2) ?? c.referralScore?.toFixed(2) ?? '-',
      c.referralPersona || c.persona || '-',
    ]),
    ['Name', 'Company', 'Title', 'Referral Score', 'Persona']
  );
}

async function clusters() {
  printSection('Network Clusters');
  const data = await get('/api/graph/communities');
  const communities = Array.isArray(data) ? data : data?.communities ?? data?.data ?? [];
  if (!communities.length) {
    console.log('  No community data available. Run --compute-graph via pipeline.mjs first.');
    return;
  }
  communities.forEach((cluster, i) => {
    const name = cluster.name || cluster.label || `Cluster ${i + 1}`;
    const members = cluster.members || cluster.nodes || [];
    console.log(`  ${name} (${members.length} members)`);
    members.slice(0, 5).forEach((m) => {
      const label = typeof m === 'string' ? m : m.name || m.label || m.id;
      console.log(`    - ${label}`);
    });
    if (members.length > 5) console.log(`    ... and ${members.length - 5} more`);
    console.log('');
  });
}

async function search(query) {
  printSection(`Search: "${query}"`);
  const data = await get(`/api/contacts/hybrid-search?q=${encodeURIComponent(query)}`);
  const contacts = Array.isArray(data) ? data : data?.data ?? [];
  table(contacts.slice(0, 20).map(contactRow), CONTACT_HEADERS);
}

async function recommend() {
  printSection('Recommended Next Actions');
  const data = await get('/api/actions/next');
  const actions = Array.isArray(data) ? data : data?.actions ?? data?.data ?? [];
  if (!actions.length) {
    console.log('  No recommendations available.');
    return;
  }
  actions.forEach((a, i) => {
    console.log(`  ${i + 1}. ${a.action || a.type || a.description || JSON.stringify(a)}`);
    if (a.contact) console.log(`     Contact: ${a.contact.name || a.contact}`);
    if (a.reason) console.log(`     Reason:  ${a.reason}`);
    console.log('');
  });
}

async function company(name) {
  printSection(`Company: "${name}"`);
  const data = await get(`/api/contacts?company=${encodeURIComponent(name)}`);
  const contacts = Array.isArray(data) ? data : data?.data ?? [];
  table(contacts.map(contactRow), CONTACT_HEADERS);
  console.log(`\n  ${contacts.length} contact(s) found at "${name}".`);
}

// ── Main ─────────────────────────────────────────────────────────────────────

const flags = parseArgs(process.argv);
const mode = flags.mode;
const top = parseInt(flags.top, 10) || 10;

switch (mode) {
  case 'summary':
    await summary();
    break;
  case 'hubs':
    await hubs(top);
    break;
  case 'prospects':
    await prospects(top);
    break;
  case 'referrals':
    await referrals(top);
    break;
  case 'clusters':
    await clusters();
    break;
  case 'search':
    if (!flags.query) {
      console.error('Error: --query is required for search mode.');
      process.exit(1);
    }
    await search(flags.query);
    break;
  case 'recommend':
    await recommend();
    break;
  case 'company':
    if (!flags.name) {
      console.error('Error: --name is required for company mode.');
      process.exit(1);
    }
    await company(flags.name);
    break;
  default:
    console.log(`
NetworkNav v2 — Network Analysis

Usage:
  node analyze.mjs --mode summary                      Dashboard overview
  node analyze.mjs --mode hubs --top 10                Top network hubs by graph score
  node analyze.mjs --mode prospects --top 10           Top prospects by composite score
  node analyze.mjs --mode referrals --top 10           Top referral candidates
  node analyze.mjs --mode clusters                     Network community clusters
  node analyze.mjs --mode search --query "AI startup"  Hybrid search across contacts
  node analyze.mjs --mode recommend                    Recommended next actions
  node analyze.mjs --mode company --name "Acme"        Contacts at a company
`);
    break;
}
