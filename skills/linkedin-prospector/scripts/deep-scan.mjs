/**
 * deep-scan.mjs -- Scan a single contact's LinkedIn connections to discover
 * 2nd/3rd degree contacts. Stores them as leaf nodes with degree metadata.
 *
 * Usage:
 *   node deep-scan.mjs --url <linkedin-profile-url> [options]
 *
 * Options:
 *   --url <url>          Required. The 1st-degree contact to scan.
 *   --max-pages 5        Pages of connections to scrape (default: 5)
 *   --max-results 100    Max connections to discover (default: 100)
 *   --depth 2            Store as degree-2 (default) or 3
 *   --mutual-only        Only capture mutual connections (shared with you)
 *
 * What it does:
 *   1. Navigates to the contact's profile page
 *   2. Clicks their connections count to view their connection list
 *   3. Scrolls and extracts visible connections (name, title, URL, mutuals)
 *   4. Stores discovered contacts in contacts.json with degree/discoveredVia
 *   5. Marks the scanned contact as deep-scanned
 *
 * Run graph-builder.mjs afterward to create discovered-connection edges.
 */

import { launchBrowser, parseArgs } from './lib.mjs';
import { load, save } from './db.mjs';
import { saveConnectionsPage } from './cache.mjs';

// ---------------------------------------------------------------------------
// Extract connections from a search results page (reuses search.mjs pattern)
// ---------------------------------------------------------------------------

async function extractConnections(page) {
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

// ---------------------------------------------------------------------------
// Extract member URN from a profile page for constructing connections URL
// ---------------------------------------------------------------------------

async function extractMemberUrn(page) {
  return page.evaluate(() => {
    // Method 1: Look for it in page data
    const scripts = document.querySelectorAll('script[type="application/ld+json"]');
    for (const s of scripts) {
      try {
        const data = JSON.parse(s.textContent);
        if (data['@type'] === 'Person' && data.url) return null; // no URN here
      } catch {}
    }

    // Method 2: Look in page source for entity URN patterns
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
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv);
  const targetUrl = args.url;
  const maxPages = parseInt(args['max-pages'] || '5');
  const maxResults = parseInt(args['max-results'] || '100');
  const storeDepth = parseInt(args.depth || '2');
  const mutualOnly = !!args['mutual-only'];

  if (!targetUrl) {
    console.error('Usage: node deep-scan.mjs --url <linkedin-profile-url> [--max-pages 5] [--max-results 100] [--depth 2]');
    process.exit(1);
  }

  // Normalize URL
  const cleanUrl = targetUrl.replace(/\/$/, '').split('?')[0];
  console.log(`Deep-scanning: ${cleanUrl}`);
  console.log(`  Max pages: ${maxPages}, Max results: ${maxResults}, Store as degree: ${storeDepth}`);

  const db = load();

  // Verify the target exists in our DB
  const targetContact = db.contacts[cleanUrl] || db.contacts[cleanUrl + '/'];
  const targetKey = targetContact ? (db.contacts[cleanUrl] ? cleanUrl : cleanUrl + '/') : null;
  if (!targetContact) {
    console.warn(`Warning: ${cleanUrl} not found in contacts.json — scanning anyway.`);
  } else {
    console.log(`  Target: ${targetContact.enrichedName || targetContact.name} (${targetContact.scores?.tier || 'unscored'})`);
  }

  const { context, page } = await launchBrowser();
  const allResults = [];

  try {
    // Step 1: Navigate to the target's profile
    console.log('\nNavigating to profile...');
    await page.goto(cleanUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(4000);

    // Step 2: Find the connections link and click it
    console.log('Looking for connections link...');

    // Try multiple selectors for the connections link
    let connectionsClicked = false;

    // Try: "XXX connections" link text
    const connectionsLink = await page.$('a[href*="/search/results/people"]');
    if (connectionsLink) {
      const linkText = await connectionsLink.textContent();
      console.log(`  Found connections link: "${linkText.trim()}"`);
      await connectionsLink.click();
      await page.waitForTimeout(4000);
      connectionsClicked = true;
    }

    if (!connectionsClicked) {
      // Try: click the connections count section
      const connSection = await page.$('li.text-body-small a[href*="connection"]');
      if (connSection) {
        await connSection.click();
        await page.waitForTimeout(4000);
        connectionsClicked = true;
      }
    }

    if (!connectionsClicked) {
      // Fallback: extract member URN and construct search URL
      console.log('  No clickable link found. Extracting member URN...');
      const memberUrn = await extractMemberUrn(page);
      if (memberUrn) {
        const searchUrl = `https://www.linkedin.com/search/results/people/?connectionOf=%5B%22${encodeURIComponent(memberUrn)}%22%5D&origin=MEMBER_PROFILE_CANNED_SEARCH&sid=deepscan`;
        console.log(`  Navigating via member URN: ${memberUrn}`);
        await page.goto(searchUrl, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(4000);
        connectionsClicked = true;
      }
    }

    if (!connectionsClicked) {
      // Last fallback: try the profile connections overlay
      const slug = cleanUrl.split('/in/')[1]?.replace(/\/$/, '');
      if (slug) {
        const fallbackUrl = `https://www.linkedin.com/search/results/people/?connectionOf=%5B%22${slug}%22%5D&network=%5B%22F%22%2C%22S%22%5D&origin=MEMBER_PROFILE_CANNED_SEARCH`;
        console.log('  Trying fallback search URL...');
        await page.goto(fallbackUrl, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(4000);
        connectionsClicked = true;
      }
    }

    if (!connectionsClicked) {
      console.error('Could not navigate to connections page. Aborting.');
      await context.close();
      process.exit(1);
    }

    // Step 3: Paginate and extract
    let pageNum = 1;
    let hasMore = true;
    let emptyPages = 0;

    while (hasMore && pageNum <= maxPages && allResults.length < maxResults) {
      console.log(`\n  Page ${pageNum}...`);
      await scrollPage(page);
      await saveConnectionsPage(page, cleanUrl, pageNum);

      const people = await extractConnections(page);
      console.log(`    Found ${people.length} connections on page ${pageNum}`);

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
        console.log(`    Kept ${filtered.length} after filtering (total: ${allResults.length})`);
      }

      // Next page
      if (allResults.length >= maxResults) break;
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
  } finally {
    await context.close();
  }

  // Step 4: Deduplicate
  const byUrl = new Map();
  for (const p of allResults) {
    const key = p.profileUrl.replace(/\/$/, '');
    if (!byUrl.has(key) || (p.title?.length || 0) > (byUrl.get(key).title?.length || 0)) {
      byUrl.set(key, p);
    }
  }
  const unique = [...byUrl.values()].slice(0, maxResults);

  // Step 5: Store in contacts.json with degree metadata
  let added = 0, updated = 0, bridgesFound = 0;

  for (const p of unique) {
    const key = p.profileUrl.replace(/\/$/, '');
    const existing = db.contacts[key] || db.contacts[key + '/'];
    const existingKey = existing ? (db.contacts[key] ? key : key + '/') : null;

    if (existing) {
      // Contact already known — update discoveredVia
      if (!existing.discoveredVia) existing.discoveredVia = [];
      if (!existing.discoveredVia.includes(cleanUrl)) {
        existing.discoveredVia.push(cleanUrl);
        bridgesFound++;
      }
      // Only set degree on contacts that were previously discovered by deep-scan.
      // Original contacts (from search/enrich) are always degree-1 — never overwrite.
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

  // Step 6: Mark the scanned contact as deep-scanned
  if (targetKey && db.contacts[targetKey]) {
    db.contacts[targetKey].deepScanned = true;
    db.contacts[targetKey].deepScannedAt = new Date().toISOString();
    db.contacts[targetKey].deepScanResults = unique.length;
    if (!db.contacts[targetKey].degree) db.contacts[targetKey].degree = 1;
  }

  save(db);

  // Summary
  console.log(`\n${'='.repeat(60)}`);
  console.log(`DEEP SCAN COMPLETE: ${targetContact?.enrichedName || targetContact?.name || cleanUrl}`);
  console.log(`${'='.repeat(60)}`);
  console.log(`  Discovered: ${unique.length} connections`);
  console.log(`  New contacts: ${added}`);
  console.log(`  Updated (already known): ${updated}`);
  console.log(`  Bridge connections found: ${bridgesFound} (appear in multiple scans)`);
  console.log(`  Stored as: degree-${storeDepth}`);
  console.log(`\nNext steps:`);
  console.log(`  1. Run graph-builder to create edges: node graph-builder.mjs`);
  console.log(`  2. Score new contacts: node scorer.mjs && node behavioral-scorer.mjs`);
  console.log(`  3. Regenerate report: node report-generator.mjs`);
  console.log(`  4. Scan more contacts: node deep-scan.mjs --url <another-url>`);

  if (bridgesFound > 0) {
    console.log(`\nBridge contacts (known from multiple 1st-degree connections):`);
    const bridges = unique.filter(p => {
      const key = p.profileUrl.replace(/\/$/, '');
      const c = db.contacts[key] || db.contacts[key + '/'];
      return c?.discoveredVia?.length > 1;
    });
    bridges.slice(0, 10).forEach((p, i) => {
      const key = p.profileUrl.replace(/\/$/, '');
      const c = db.contacts[key] || db.contacts[key + '/'];
      console.log(`  ${i + 1}. ${p.name} — discovered via ${c.discoveredVia.length} contacts`);
    });
  }
}

main().catch(e => { console.error(e); process.exit(1); });
