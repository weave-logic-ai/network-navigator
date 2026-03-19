/**
 * deep-scan.mjs -- Scan a single contact's LinkedIn connections to discover
 * 2nd/3rd degree contacts. Stores them as leaf nodes with degree metadata.
 *
 * Usage:
 *   node deep-scan.mjs --url <linkedin-profile-url> [options]
 *
 * Options:
 *   --url <url>          Required. The 1st-degree contact to scan.
 *   --max-pages 20       Pages of connections to scrape (default: 20)
 *   --max-results 1000   Max connections to discover (default: 1000)
 *   --depth 2            Store as degree-2 (default) or 3
 *   --mutual-only        Only capture mutual connections (shared with you)
 *   --exclude-1st        Filter out 1st-degree connections (show only 2nd+)
 *
 * What it does:
 *   1. Navigates to the contact's profile page
 *   2. Clicks their connections count to view their connection list
 *   3. Filters to 2nd-degree only (--exclude-1st, default in batch mode)
 *   4. Scrolls and extracts visible connections (name, title, URL, mutuals)
 *   5. Stores discovered contacts in contacts.json with degree/discoveredVia
 *   6. Marks the scanned contact as deep-scanned
 *
 * Run graph-builder.mjs afterward to create discovered-connection edges.
 */

import { fileURLToPath } from 'url';
import { launchBrowser, parseArgs } from './lib.mjs';
import { load, save } from './db.mjs';
import { saveConnectionsPage } from './cache.mjs';
import { checkBudget, consumeBudget } from './rate-budget.mjs';

// ---------------------------------------------------------------------------
// Extract connections from a search results page
// ---------------------------------------------------------------------------

export async function extractConnections(page) {
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

      // Check degree indicator
      const degreeMatch = containerText.match(/\b(1st|2nd|3rd)\b/);
      const degree = degreeMatch ? degreeMatch[1] : null;

      // Mutual connections count
      const mutualMatch = containerText.match(/(\d+)\s+(?:other\s+)?mutual\s+connection/);
      const mutualCount = mutualMatch ? parseInt(mutualMatch[1]) : 0;

      // Current/past info
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
        linkedinDegree: degree,
      });
    });

    return people;
  });
}

export async function scrollPage(page) {
  // Scroll down slowly to trigger lazy loading
  for (let s = 0; s < 12; s++) {
    await page.evaluate(() => window.scrollBy(0, 500));
    await page.waitForTimeout(600);
  }
  // Scroll back to top and do a second pass
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(800);
  for (let s = 0; s < 15; s++) {
    await page.evaluate(() => window.scrollBy(0, 400));
    await page.waitForTimeout(500);
  }
}

// ---------------------------------------------------------------------------
// Extract member URN from a profile page for constructing connections URL
// ---------------------------------------------------------------------------

async function extractMemberUrn(page) {
  return page.evaluate(() => {
    const html = document.documentElement.innerHTML;
    // Pattern: "entityUrn":"urn:li:fsd_profile:ACoAA..."
    const urnMatch = html.match(/"entityUrn":"(urn:li:(?:fsd_profile|member):([A-Za-z0-9_-]+))"/);
    if (urnMatch) return urnMatch[2]; // just the ID part

    // Pattern: /voyager/api/identity/profiles/ACoAA...
    const voyagerMatch = html.match(/\/identity\/profiles\/(ACoAA[A-Za-z0-9_-]+)/);
    if (voyagerMatch) return voyagerMatch[1];

    return null;
  });
}

// ---------------------------------------------------------------------------
// Navigate to a contact's connections page, filtering for 2nd-degree only
// ---------------------------------------------------------------------------

async function navigateToConnections(page, cleanUrl, exclude1st) {
  // Step 1: Navigate to the target's profile
  console.log('  Navigating to profile...');
  await page.goto(cleanUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4000);

  // Step 2: Find connections link and extract member URN
  let memberUrn = null;

  const connectionsLink = await page.$('a[href*="/search/results/people"]');
  if (connectionsLink) {
    const linkText = await connectionsLink.textContent();
    console.log(`  Found connections link: "${linkText.trim()}"`);

    // Extract member URN from the link href or page
    const linkHref = await connectionsLink.getAttribute('href');
    const urnFromLink = linkHref?.match(/connectionOf=%5B%22([A-Za-z0-9_-]+)%22%5D/);
    if (urnFromLink) {
      memberUrn = urnFromLink[1];
    }
  }

  if (!memberUrn) {
    memberUrn = await extractMemberUrn(page);
  }

  if (!memberUrn) {
    // Last resort: try clicking the link directly
    if (connectionsLink) {
      await connectionsLink.click();
      await page.waitForTimeout(4000);
      // Modify URL in-place to remove 1st-degree filter
      if (exclude1st) {
        const currentUrl = page.url();
        const modified = currentUrl
          .replace(/network=%5B%22F%22%2C%22S%22%5D/, 'network=%5B%22S%22%5D')
          .replace(/network=%5B%22F%22%5D/, 'network=%5B%22S%22%5D');
        if (modified !== currentUrl) {
          await page.goto(modified, { waitUntil: 'domcontentloaded' });
          await page.waitForTimeout(4000);
        }
      }
      return true;
    }
    console.log('  Could not find connections link or member URN.');
    return false;
  }

  // Build search URL directly — filter for 2nd degree only if exclude1st
  const networkFilter = exclude1st
    ? '%5B%22S%22%5D'          // ["S"] = 2nd degree only
    : '%5B%22F%22%2C%22S%22%5D'; // ["F","S"] = 1st and 2nd

  const searchUrl = `https://www.linkedin.com/search/results/people/?connectionOf=%5B%22${encodeURIComponent(memberUrn)}%22%5D&network=${networkFilter}&origin=MEMBER_PROFILE_CANNED_SEARCH`;
  console.log(`  Navigating to ${exclude1st ? '2nd-degree only' : 'all'} connections...`);
  await page.goto(searchUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4000);
  return true;
}

// ---------------------------------------------------------------------------
// Core scan function — can accept an existing page (for browser reuse)
// ---------------------------------------------------------------------------

export async function scanContact(targetUrl, opts = {}) {
  const maxPages = opts.maxPages || 20;
  const maxResults = opts.maxResults || 1000;
  const storeDepth = opts.depth || 2;
  const mutualOnly = opts.mutualOnly || false;
  const exclude1st = opts.exclude1st !== false; // default true
  const existingPage = opts.page || null;

  // Normalize URL
  const cleanUrl = targetUrl.replace(/\/$/, '').split('?')[0];

  const db = load();

  // Verify the target exists in our DB
  const targetContact = db.contacts[cleanUrl] || db.contacts[cleanUrl + '/'];
  const targetKey = targetContact ? (db.contacts[cleanUrl] ? cleanUrl : cleanUrl + '/') : null;
  if (targetContact) {
    console.log(`  Target: ${targetContact.enrichedName || targetContact.name} (${targetContact.scores?.tier || 'unscored'})`);
  }

  let context = null;
  let page = existingPage;

  if (!page) {
    const browser = await launchBrowser();
    context = browser.context;
    page = browser.page;
  }

  const allResults = [];

  try {
    // Rate budget check before profile visit
    const budget = checkBudget('profile_visits');
    if (!budget.allowed) {
      console.log(`  Rate limit reached: ${budget.used}/${budget.limit} profile visits today. Stopping.`);
      if (!existingPage && context) await context.close();
      return { ok: false, error: 'Rate budget exceeded for profile_visits', discovered: 0, added: 0, updated: 0, bridges: 0 };
    }

    // Navigate to connections page
    const navOk = await navigateToConnections(page, cleanUrl, exclude1st);
    if (!navOk) {
      return { ok: false, error: 'Could not navigate to connections', discovered: 0, added: 0, updated: 0, bridges: 0 };
    }
    consumeBudget('profile_visits');

    // Paginate and extract
    let pageNum = 1;
    let hasMore = true;
    let emptyPages = 0;

    while (hasMore && pageNum <= maxPages && allResults.length < maxResults) {
      console.log(`    Page ${pageNum}...`);
      await scrollPage(page);
      await saveConnectionsPage(page, cleanUrl, pageNum);

      const people = await extractConnections(page);
      console.log(`      Found ${people.length} connections on page ${pageNum}`);

      if (people.length === 0) {
        emptyPages++;
        if (emptyPages >= 2) hasMore = false;
      } else {
        emptyPages = 0;

        // Filter: skip the target itself
        const filtered = people.filter(p => {
          const pUrl = p.profileUrl.replace(/\/$/, '');
          if (pUrl === cleanUrl || pUrl === cleanUrl + '/') return false;
          if (mutualOnly && p.mutualConnections === 0 && p.linkedinDegree !== '1st') return false;
          return true;
        });

        allResults.push(...filtered);
        console.log(`      Kept ${filtered.length} after filtering (total: ${allResults.length})`);
      }

      // Next page
      if (allResults.length >= maxResults) break;
      try {
        // Try multiple selectors for the Next button (LinkedIn changes DOM frequently)
        let nextButton = await page.$('button[data-testid="pagination-controls-next-button-visible"]');
        if (!nextButton) nextButton = await page.$('button[aria-label="Next"]');
        if (!nextButton) nextButton = await page.$('button.artdeco-pagination__button--next');

        if (nextButton && await nextButton.isEnabled()) {
          await nextButton.scrollIntoViewIfNeeded();
          await page.waitForTimeout(500);
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
  } catch (err) {
    // On error, don't close shared browser — just report
    if (!existingPage && context) await context.close();
    return { ok: false, error: err.message, discovered: 0, added: 0, updated: 0, bridges: 0 };
  }

  // Close browser only if we opened it ourselves
  if (!existingPage && context) await context.close();

  // Deduplicate
  const byUrl = new Map();
  for (const p of allResults) {
    const key = p.profileUrl.replace(/\/$/, '');
    if (!byUrl.has(key) || (p.title?.length || 0) > (byUrl.get(key).title?.length || 0)) {
      byUrl.set(key, p);
    }
  }
  const unique = [...byUrl.values()].slice(0, maxResults);

  // Store in contacts.json with degree metadata
  let added = 0, updated = 0, bridgesFound = 0;

  for (const p of unique) {
    const key = p.profileUrl.replace(/\/$/, '');
    const existing = db.contacts[key] || db.contacts[key + '/'];

    if (existing) {
      // Contact already known — update discoveredVia
      if (!existing.discoveredVia) existing.discoveredVia = [];
      if (!existing.discoveredVia.includes(cleanUrl)) {
        existing.discoveredVia.push(cleanUrl);
        bridgesFound++;
      }
      // Only set degree on contacts that were previously discovered by deep-scan.
      const isDeepScanOrigin = existing.source && existing.source.startsWith('deep-scan:');
      if (isDeepScanOrigin && existing.degree > storeDepth) {
        existing.degree = storeDepth;
      }
      // Update sparse fields
      if (p.title && (!existing.title || p.title.length > existing.title.length)) {
        existing.title = p.title;
      }
      if (p.location && !existing.location) existing.location = p.location;
      updated++;
    } else {
      // New contact — store as discovered degree-N
      db.contacts[key] = {
        name: p.name,
        title: p.title,
        location: p.location,
        profileUrl: key,
        mutualConnections: p.mutualConnections || 0,
        currentInfo: p.currentInfo || '',
        pastInfo: p.pastInfo || '',
        linkedinDegree: p.linkedinDegree,
        degree: storeDepth,
        discoveredVia: [cleanUrl],
        discoveredAt: new Date().toISOString(),
        searchTerms: [],
        source: `deep-scan:${cleanUrl}`,
        enriched: false,
      };
      added++;
    }
  }

  // Mark the scanned contact as deep-scanned
  if (targetKey && db.contacts[targetKey]) {
    db.contacts[targetKey].deepScanned = true;
    db.contacts[targetKey].deepScannedAt = new Date().toISOString();
    db.contacts[targetKey].deepScanResults = unique.length;
    if (!db.contacts[targetKey].degree) db.contacts[targetKey].degree = 1;
  }

  save(db);

  return { ok: true, discovered: unique.length, added, updated, bridges: bridgesFound };
}

// ---------------------------------------------------------------------------
// CLI mode (only when run directly, not when imported)
// ---------------------------------------------------------------------------

const isMain = process.argv[1] && fileURLToPath(import.meta.url).endsWith(process.argv[1].replace(/.*\//, ''));

async function main() {
  const args = parseArgs(process.argv);
  const targetUrl = args.url;
  const maxPages = parseInt(args['max-pages'] || '20');
  const maxResults = parseInt(args['max-results'] || '1000');
  const storeDepth = parseInt(args.depth || '2');
  const mutualOnly = !!args['mutual-only'];
  const exclude1st = args['exclude-1st'] !== undefined ? true : false;

  if (!targetUrl) {
    console.error('Usage: node deep-scan.mjs --url <linkedin-profile-url> [--max-pages 20] [--max-results 1000] [--depth 2] [--exclude-1st]');
    process.exit(1);
  }

  const cleanUrl = targetUrl.replace(/\/$/, '').split('?')[0];
  console.log(`Deep-scanning: ${cleanUrl}`);
  console.log(`  Max pages: ${maxPages}, Max results: ${maxResults}, Store as degree: ${storeDepth}, Exclude 1st: ${exclude1st}`);

  const result = await scanContact(targetUrl, {
    maxPages,
    maxResults,
    depth: storeDepth,
    mutualOnly,
    exclude1st,
  });

  console.log(`\n${'='.repeat(60)}`);
  if (result.ok) {
    console.log(`DEEP SCAN COMPLETE`);
    console.log(`${'='.repeat(60)}`);
    console.log(`  Discovered: ${result.discovered} connections`);
    console.log(`  New contacts: ${result.added}`);
    console.log(`  Updated (already known): ${result.updated}`);
    console.log(`  Bridge connections found: ${result.bridges} (appear in multiple scans)`);
    console.log(`  Stored as: degree-${storeDepth}`);
  } else {
    console.log(`DEEP SCAN FAILED: ${result.error}`);
    console.log(`${'='.repeat(60)}`);
  }
}

if (isMain) {
  main().catch(e => { console.error(e); process.exit(1); });
}
