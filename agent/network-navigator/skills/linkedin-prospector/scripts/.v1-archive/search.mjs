import { launchBrowser, NICHE_KEYWORDS, parseArgs } from './lib.mjs';
import { load, save, merge } from './db.mjs';
import { saveSearchPage } from './cache.mjs';
import { checkBudget, consumeBudget } from './rate-budget.mjs';

/**
 * Extract profile data from a LinkedIn search results page via DOM walking.
 */
async function extractSearchResults(page) {
  return page.evaluate(() => {
    const people = [];
    const profileLinks = document.querySelectorAll('a[href*="/in/"]');
    const seen = new Set();

    profileLinks.forEach(link => {
      const href = link.href.split('?')[0];
      if (seen.has(href)) return;
      seen.add(href);

      // Walk up to find the containing card element
      let container = link;
      for (let i = 0; i < 8; i++) {
        if (container.parentElement) container = container.parentElement;
      }

      // Extract name
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
        } else if (title && !location && (
          line.includes(',') ||
          line.includes('Area') ||
          line.includes('United States') ||
          line.includes('Canada') ||
          line.match(/\b(Metro|Region|Greater)\b/)
        )) {
          location = line;
          break;
        } else if (title && !location) {
          if (line.length < 60 && !line.includes('|') && !line.includes('@')) {
            location = line;
            break;
          }
        }
      }

      const mutualMatch = containerText.match(/(\d+)\s+other\s+mutual\s+connection/);
      const mutualCount = mutualMatch ? parseInt(mutualMatch[1]) : 0;
      const currentMatch = containerText.match(/Current:\s*(.+?)(?:\n|$)/);
      const pastMatch = containerText.match(/Past:\s*(.+?)(?:\n|$)/);

      people.push({
        name,
        title: title.substring(0, 200),
        location,
        profileUrl: href,
        mutualConnections: mutualCount,
        currentInfo: currentMatch ? currentMatch[1].trim().substring(0, 200) : '',
        pastInfo: pastMatch ? pastMatch[1].trim().substring(0, 200) : '',
      });
    });

    return people;
  });
}

/**
 * Scroll through a search results page to load all results.
 */
async function scrollPage(page) {
  for (let s = 0; s < 6; s++) {
    await page.evaluate(() => window.scrollBy(0, 600));
    await page.waitForTimeout(700);
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(500);
  for (let s = 0; s < 8; s++) {
    await page.evaluate(() => window.scrollBy(0, 400));
    await page.waitForTimeout(500);
  }
}

async function main() {
  const args = parseArgs(process.argv);
  const maxPages = parseInt(args['max-pages'] || '3');
  const maxResults = parseInt(args['max-results'] || '50');

  // Resolve keywords from niche or direct input
  let searchTerms = [];
  if (args.niche) {
    const niches = args.niche.split(',').map(s => s.trim().toLowerCase());
    for (const n of niches) {
      if (NICHE_KEYWORDS[n]) {
        searchTerms.push(...NICHE_KEYWORDS[n]);
      } else {
        searchTerms.push(n);
      }
    }
  } else if (args.keywords) {
    searchTerms = args.keywords.split(',').map(s => s.trim());
  } else {
    console.error('Usage: node search.mjs --niche <niche> | --keywords "k1,k2" [--max-pages 3] [--max-results 50]');
    process.exit(1);
  }

  console.log(`Searching for: ${searchTerms.join(', ')}`);
  console.log(`Max pages per term: ${maxPages}, Max total results: ${maxResults}`);

  const { context, page } = await launchBrowser();
  const allResults = [];

  for (const term of searchTerms) {
    if (allResults.length >= maxResults) break;

    console.log(`\n=== Searching: "${term}" ===`);
    const searchUrl = `https://www.linkedin.com/search/results/people/?network=%5B%22F%22%5D&keywords=${encodeURIComponent(term)}&origin=FACETED_SEARCH`;
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(4000);

    let pageNum = 1;
    let hasMore = true;
    let emptyPages = 0;

    while (hasMore && pageNum <= maxPages && allResults.length < maxResults) {
      // Rate budget check before loading search page
      const budget = checkBudget('search_pages');
      if (!budget.allowed) {
        console.log(`  Rate limit reached: ${budget.used}/${budget.limit} search pages today. Stopping.`);
        hasMore = false;
        break;
      }

      console.log(`  Page ${pageNum}...`);
      await scrollPage(page);
      await saveSearchPage(page, term, pageNum);
      consumeBudget('search_pages');

      const people = await extractSearchResults(page);
      console.log(`  Found ${people.length} people on page ${pageNum}`);

      if (people.length === 0) {
        emptyPages++;
        if (emptyPages >= 2) hasMore = false;
      } else {
        emptyPages = 0;
        allResults.push(...people.map(p => ({ ...p, searchTerm: term })));
      }

      // Next page
      try {
        const nextButton = await page.$('button[aria-label="Next"]');
        if (nextButton && await nextButton.isEnabled()) {
          await nextButton.click();
          await page.waitForTimeout(4000);
          pageNum++;
        } else {
          hasMore = false;
        }
      } catch {
        hasMore = false;
      }
    }

    // Rate limit between terms
    await page.waitForTimeout(2000);
  }

  await context.close();

  // Deduplicate by profileUrl, keep richest data
  const byUrl = new Map();
  for (const p of allResults) {
    const key = p.profileUrl || p.name;
    const existing = byUrl.get(key);
    if (!existing || (p.title.length > (existing.title || '').length)) {
      const terms = existing
        ? [...new Set([...(existing.searchTerms || [existing.searchTerm]), p.searchTerm])]
        : [p.searchTerm];
      byUrl.set(key, { ...p, searchTerms: terms });
    } else if (existing) {
      existing.searchTerms = [...new Set([...(existing.searchTerms || [existing.searchTerm]), p.searchTerm])];
    }
  }

  const unique = [...byUrl.values()].slice(0, maxResults);
  unique.sort((a, b) => (b.mutualConnections || 0) - (a.mutualConnections || 0));

  // Merge into local DB
  const db = load();
  const { added, updated } = merge(db, unique, searchTerms.join(', '));
  save(db);

  console.log(`\n${'='.repeat(60)}`);
  console.log(`RESULTS: ${unique.length} unique profiles`);
  console.log(`DB: ${added} added, ${updated} updated (total: ${Object.keys(db.contacts).length})`);
  console.log(`${'='.repeat(60)}`);

  // Print table
  unique.forEach((p, i) => {
    console.log(`${String(i + 1).padStart(3)}. ${p.name}`);
    console.log(`     ${p.title}`);
    console.log(`     ${p.location} | Mutual: ${p.mutualConnections || '?'} | Terms: ${(p.searchTerms || []).join(', ')}`);
    console.log(`     ${p.profileUrl}`);
  });

  // Output JSON to stdout for piping
  if (args.json) {
    console.log('\n---JSON---');
    console.log(JSON.stringify(unique, null, 2));
  }
}

main().catch(e => { console.error(e); process.exit(1); });
