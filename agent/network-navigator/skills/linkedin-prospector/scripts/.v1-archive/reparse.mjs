/**
 * reparse.mjs -- Re-extract data from cached HTML pages using Playwright.
 *
 * Usage:
 *   node reparse.mjs --type profiles      Re-extract all cached profiles
 *   node reparse.mjs --type search        Re-extract all cached search pages
 *   node reparse.mjs --url <profile-url>  Re-extract one specific profile
 *   node reparse.mjs --all                Re-extract everything
 *   node reparse.mjs --stats              Show cache statistics
 */

import { chromium } from 'playwright';
import { loadIndex, getCachedHtml } from './cache.mjs';
import { load, save, merge } from './db.mjs';
import { parseArgs } from './lib.mjs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Extraction functions (same DOM queries as search.mjs / enrich.mjs)
// ---------------------------------------------------------------------------

async function extractSearchFromHtml(page, html) {
  await page.setContent(html, { waitUntil: 'domcontentloaded' });
  return page.evaluate(() => {
    const people = [];
    const profileLinks = document.querySelectorAll('a[href*="/in/"]');
    const seen = new Set();

    profileLinks.forEach(link => {
      const href = link.href.split('?')[0];
      if (seen.has(href)) return;
      seen.add(href);

      let container = link;
      for (let i = 0; i < 8; i++) {
        if (container.parentElement) container = container.parentElement;
      }

      const nameSpan = link.querySelector('span[aria-hidden="true"]');
      const name = nameSpan ? nameSpan.textContent.trim() :
                   link.textContent.replace(/\s+/g, ' ').trim().split('\u2022')[0].trim();

      if (!name || name.length < 2 || name === 'LinkedIn Member' || name.length > 80) return;

      const containerText = container.innerText || '';
      const lines = containerText.split('\n').map(l => l.trim()).filter(l => l.length > 0);
      let nameIdx = lines.findIndex(l => l.includes(name));
      if (nameIdx === -1) nameIdx = 0;

      let title = '';
      let location = '';
      for (let i = nameIdx + 1; i < Math.min(nameIdx + 6, lines.length); i++) {
        const line = lines[i];
        if (line.match(/^(• )?(1st|2nd|3rd)$/)) continue;
        if (line === 'Message' || line === 'Connect' || line === 'Follow') break;
        if (line.startsWith('Skills:')) break;
        if (line.includes('mutual connection')) break;
        if (line.includes('followers')) break;
        if (!title && !line.match(/^(1st|2nd|3rd)$/) && line !== name) {
          title = line;
        } else if (title && !location) {
          if (line.includes(',') || line.includes('Area') || line.includes('United States') ||
              line.includes('Canada') || line.match(/\b(Metro|Region|Greater)\b/)) {
            location = line; break;
          } else if (line.length < 60 && !line.includes('|') && !line.includes('@')) {
            location = line; break;
          }
        }
      }

      const mutualMatch = containerText.match(/(\d+)\s+other\s+mutual\s+connection/);
      people.push({ name, title: title.substring(0, 200), location, profileUrl: href, mutualConnections: mutualMatch ? parseInt(mutualMatch[1]) : 0 });
    });
    return people;
  });
}

async function extractProfileFromHtml(page, html) {
  await page.setContent(html, { waitUntil: 'domcontentloaded' });
  return page.evaluate(() => {
    const headlineEl = document.querySelector('.text-body-medium.break-words') ||
                       document.querySelector('[data-generated-suggestion-target]') ||
                       document.querySelector('h2');
    const locationEl = document.querySelector('.text-body-small.inline.t-black--light.break-words');
    const nameEl = document.querySelector('h1');
    const aboutSection = document.querySelector('#about')?.closest('section');
    const aboutText = aboutSection ? aboutSection.innerText.substring(0, 300) : '';

    const expSection = document.querySelector('#experience')?.closest('section');
    let currentRole = '', currentCompany = '';
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

    return {
      name: nameEl?.textContent?.trim() || '',
      headline: headlineEl?.textContent?.trim() || '',
      location: locationEl?.textContent?.trim() || '',
      currentRole, currentCompany,
      about: aboutText,
      connections: connectionsEl?.textContent?.trim() || '',
    };
  });
}

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------

function showStats() {
  const index = loadIndex();
  const entries = Object.values(index.entries);
  const byType = {};
  for (const e of entries) {
    byType[e.type] = (byType[e.type] || 0) + 1;
  }

  console.log('Cache Statistics');
  console.log(`  Total entries: ${entries.length}`);
  for (const [type, count] of Object.entries(byType)) {
    console.log(`  ${type}: ${count}`);
  }
  if (entries.length > 0) {
    const dates = entries.map(e => new Date(e.cachedAt)).sort((a, b) => a - b);
    console.log(`  Oldest: ${dates[0].toISOString()}`);
    console.log(`  Newest: ${dates[dates.length - 1].toISOString()}`);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv);

  if (args.stats) {
    showStats();
    return;
  }

  const index = loadIndex();
  const entries = Object.entries(index.entries);

  // Filter entries by type or url
  let targets;
  if (args.all) {
    targets = entries;
  } else if (args.url) {
    const key = `profile:${args.url.replace(/\/$/, '').split('?')[0]}`;
    targets = entries.filter(([k]) => k === key);
    if (targets.length === 0) {
      console.log(`No cache entry found for ${args.url}`);
      return;
    }
  } else if (args.type) {
    targets = entries.filter(([, e]) => e.type === args.type);
  } else {
    console.log('Usage: node reparse.mjs --type <profiles|search|connections> | --url <url> | --all | --stats');
    return;
  }

  if (targets.length === 0) {
    console.log('No matching cache entries found.');
    return;
  }

  console.log(`Re-parsing ${targets.length} cached page(s)...`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  const db = load();

  let parsed = 0, errors = 0;

  for (const [key, entry] of targets) {
    const html = getCachedHtml(key);
    if (!html) {
      console.log(`  [skip] ${key} — HTML file missing`);
      errors++;
      continue;
    }

    try {
      if (entry.type === 'search') {
        const people = await extractSearchFromHtml(page, html);
        const { added, updated } = merge(db, people, entry.searchTerm || '');
        console.log(`  [search] ${entry.file}: ${people.length} contacts (${added} new, ${updated} updated)`);
      } else if (entry.type === 'profile') {
        const data = await extractProfileFromHtml(page, html);
        const profileUrl = entry.url.replace(/\/$/, '').split('?')[0];
        const dbContact = db.contacts[profileUrl];
        if (dbContact && data.name) {
          if (data.name) dbContact.enrichedName = data.name;
          if (data.headline) dbContact.headline = data.headline;
          if (data.location) dbContact.enrichedLocation = data.location;
          if (data.currentRole) dbContact.currentRole = data.currentRole;
          if (data.currentCompany) dbContact.currentCompany = data.currentCompany;
          if (data.about) dbContact.about = data.about;
          if (data.connections) dbContact.connections = data.connections;
          dbContact.enriched = true;
          dbContact.enrichedAt = new Date().toISOString();
          console.log(`  [profile] ${data.name}: ${(data.headline || '').substring(0, 60)}`);
        } else {
          console.log(`  [profile] ${entry.url}: not in DB, skipping`);
        }
      } else if (entry.type === 'connections') {
        const people = await extractSearchFromHtml(page, html); // same DOM structure
        console.log(`  [connections] ${entry.file}: ${people.length} contacts`);
        // Store as discovered contacts
        for (const p of people) {
          const pKey = p.profileUrl.replace(/\/$/, '');
          if (!db.contacts[pKey]) {
            db.contacts[pKey] = {
              ...p, degree: 2, discoveredVia: [entry.targetUrl || ''],
              discoveredAt: new Date().toISOString(), searchTerms: [], source: `reparse:${entry.file}`, enriched: false,
            };
          }
        }
      }

      // Update extractedAt
      index.entries[key].extractedAt = new Date().toISOString();
      parsed++;
    } catch (err) {
      console.log(`  [error] ${key}: ${err.message}`);
      errors++;
    }
  }

  await browser.close();
  save(db);

  // Save updated index with extractedAt timestamps
  const { writeFileSync: wfs } = await import('fs');
  const { resolve: res } = await import('path');
  const { DATA_DIR: _dataDir } = await import('./lib.mjs');
  const CACHE_DIR = res(_dataDir, 'cache');
  wfs(res(CACHE_DIR, 'index.json'), JSON.stringify(index, null, 2));

  console.log(`\nReparse complete: ${parsed} parsed, ${errors} errors`);
  console.log(`DB contacts: ${Object.keys(db.contacts).length}`);
}

main().catch(e => { console.error(e); process.exit(1); });
