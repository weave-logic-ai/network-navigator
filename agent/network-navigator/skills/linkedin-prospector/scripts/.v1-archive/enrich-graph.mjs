/**
 * enrich-graph.mjs -- Enrich contacts directly in graph.json
 *
 * For 2nd/3rd-degree contacts that exist in graph.json but not contacts.json.
 * Visits each profile page and extracts headline, about, role, company, location.
 *
 * Usage:
 *   node enrich-graph.mjs --url-file enrich-top50-d2.json    Enrich from URL list
 *   node enrich-graph.mjs --top-d2 50                        Auto-pick top N 2nd-degree
 *   node enrich-graph.mjs --unenriched --max 50              Any unenriched contacts
 *   node enrich-graph.mjs --delay 5                          Custom delay (seconds)
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { launchBrowser, parseArgs, DATA_DIR } from './lib.mjs';
import { saveProfilePage } from './cache.mjs';
import { checkBudget, consumeBudget } from './rate-budget.mjs';

const GRAPH_PATH = resolve(DATA_DIR, 'graph.json');

async function extractProfileData(page) {
  return page.evaluate(() => {
    const nameEl = document.querySelector('h1');
    const headlineEl = document.querySelector('.text-body-medium.break-words') ||
                       document.querySelector('[data-generated-suggestion-target]') ||
                       document.querySelector('h2');
    const locationEl = document.querySelector('.text-body-small.inline.t-black--light.break-words');

    const aboutSection = document.querySelector('#about')?.closest('section');
    const aboutText = aboutSection ? aboutSection.innerText.substring(0, 500) : '';

    const expSection = document.querySelector('#experience')?.closest('section');
    let currentRole = '';
    let currentCompany = '';
    if (expSection) {
      const firstExp = expSection.querySelector('li');
      if (firstExp) {
        const spans = firstExp.querySelectorAll('span[aria-hidden="true"]');
        if (spans.length >= 1) currentRole = spans[0]?.textContent?.trim() || '';
        if (spans.length >= 2) currentCompany = spans[1]?.textContent?.trim() || '';
      }
    }

    const connectionsEl = [...document.querySelectorAll('span')].find(el =>
      el.textContent.includes('connections') || el.textContent.includes('followers')
    );

    // Skills
    const skillSection = document.querySelector('#skills')?.closest('section');
    const skills = [];
    if (skillSection) {
      skillSection.querySelectorAll('span[aria-hidden="true"]').forEach(s => {
        const t = s.textContent.trim();
        if (t.length > 1 && t.length < 60) skills.push(t);
      });
    }

    return {
      name: nameEl?.textContent?.trim() || '',
      headline: headlineEl?.textContent?.trim() || '',
      location: locationEl?.textContent?.trim() || '',
      currentRole,
      currentCompany,
      about: aboutText,
      connections: connectionsEl?.textContent?.trim() || '',
      skills: [...new Set(skills)].slice(0, 15),
    };
  });
}

async function main() {
  const args = parseArgs(process.argv);
  const delayBase = parseFloat(args.delay || '3') * 1000;

  if (!existsSync(GRAPH_PATH)) {
    console.error('graph.json not found. Run graph-builder first.');
    process.exit(1);
  }

  const graph = JSON.parse(readFileSync(GRAPH_PATH, 'utf-8'));
  let urls = [];

  // Determine which contacts to enrich
  if (args['url-file']) {
    const filePath = resolve(DATA_DIR, args['url-file']);
    urls = JSON.parse(readFileSync(filePath, 'utf-8'));
    console.log(`Loading ${urls.length} URLs from ${args['url-file']}`);
  } else if (args['top-d2']) {
    const n = parseInt(args['top-d2'], 10) || 50;
    urls = Object.entries(graph.contacts)
      .filter(([, c]) => c.degree === 2 && !c.headline && !c.about)
      .sort((a, b) => (b[1].scores?.goldScore || 0) - (a[1].scores?.goldScore || 0))
      .slice(0, n)
      .map(([url]) => url);
    console.log(`Auto-selected top ${urls.length} unenriched 2nd-degree contacts`);
  } else if (args.unenriched) {
    const max = parseInt(args.max || '50', 10);
    urls = Object.entries(graph.contacts)
      .filter(([, c]) => !c.headline && !c.about)
      .sort((a, b) => (b[1].scores?.goldScore || 0) - (a[1].scores?.goldScore || 0))
      .slice(0, max)
      .map(([url]) => url);
    console.log(`Found ${urls.length} unenriched contacts`);
  } else {
    console.log('Usage: node enrich-graph.mjs --url-file <file> | --top-d2 <N> | --unenriched --max <N>');
    process.exit(0);
  }

  // Filter to only contacts that exist in graph and aren't already enriched
  urls = urls.filter(url => {
    const c = graph.contacts[url];
    if (!c) return false;
    if (c.headline && c.about) return false; // already enriched
    return true;
  });

  if (urls.length === 0) {
    console.log('All selected contacts are already enriched.');
    return;
  }

  console.log(`\nEnriching ${urls.length} contacts in graph.json...`);
  console.log(`Delay: ${delayBase / 1000}s base + 0-2s random\n`);

  const { context, page } = await launchBrowser();
  let enriched = 0;
  let errors = 0;

  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    const c = graph.contacts[url];
    const displayName = c.enrichedName || c.name || 'Unknown';

    // Rate budget check before profile visit
    const budget = checkBudget('profile_visits');
    if (!budget.allowed) {
      console.log(`  Rate limit reached: ${budget.used}/${budget.limit} profile visits today. Enriched ${enriched}/${urls.length} planned.`);
      break;
    }

    console.log(`  [${i + 1}/${urls.length}] ${displayName}`);
    console.log(`    URL: ${url}`);

    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
      await page.waitForTimeout(2500);
      await saveProfilePage(page, url);
      consumeBudget('profile_visits');

      const data = await extractProfileData(page);

      // Write back to graph contact
      if (data.name) c.enrichedName = data.name;
      if (data.headline) c.headline = data.headline;
      if (data.location) c.enrichedLocation = data.location;
      if (data.currentRole) c.currentRole = data.currentRole;
      if (data.currentCompany) c.currentCompany = data.currentCompany;
      if (data.about) c.about = data.about;
      if (data.connections) c.connectionCount = data.connections;
      if (data.skills && data.skills.length > 0) c.skills = data.skills;
      c.enrichedAt = new Date().toISOString();

      enriched++;
      const headline = (data.headline || 'no headline').substring(0, 80);
      const role = data.currentRole ? ` | ${data.currentRole}` : '';
      console.log(`    -> ${headline}${role}`);
    } catch (err) {
      errors++;
      console.log(`    -> ERROR: ${err.message}`);
    }

    // Save checkpoint every 10
    if ((i + 1) % 10 === 0) {
      writeFileSync(GRAPH_PATH, JSON.stringify(graph, null, 2));
      console.log(`  [checkpoint] Saved after ${enriched} enriched`);
    }

    // Rate limit
    const delay = delayBase + Math.random() * 2000;
    await page.waitForTimeout(delay);
  }

  await context.close();

  // Final save
  graph.meta.lastEnriched = new Date().toISOString();
  writeFileSync(GRAPH_PATH, JSON.stringify(graph, null, 2));

  console.log(`\n${'='.repeat(60)}`);
  console.log(`Graph enrichment complete:`);
  console.log(`  Enriched: ${enriched}`);
  console.log(`  Errors: ${errors}`);
  console.log(`  Total graph contacts: ${Object.keys(graph.contacts).length}`);
  console.log(`${'='.repeat(60)}`);
}

main().catch(e => { console.error(e); process.exit(1); });
