import { launchBrowser, parseArgs } from './lib.mjs';
import { load, save } from './db.mjs';
import { saveProfilePage } from './cache.mjs';
import { checkBudget, consumeBudget } from './rate-budget.mjs';

/**
 * Extract detailed profile data from a LinkedIn profile page.
 */
async function extractProfileData(page) {
  return page.evaluate(() => {
    const headlineEl = document.querySelector('.text-body-medium.break-words') ||
                       document.querySelector('[data-generated-suggestion-target]') ||
                       document.querySelector('h2');

    const locationEl = document.querySelector('.text-body-small.inline.t-black--light.break-words');
    const nameEl = document.querySelector('h1');

    const aboutSection = document.querySelector('#about')?.closest('section');
    const aboutText = aboutSection ? aboutSection.innerText.substring(0, 300) : '';

    // Experience section
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

    return {
      name: nameEl?.textContent?.trim() || '',
      headline: headlineEl?.textContent?.trim() || '',
      location: locationEl?.textContent?.trim() || '',
      currentRole,
      currentCompany,
      about: aboutText,
      connections: connectionsEl?.textContent?.trim() || '',
    };
  });
}

async function main() {
  const args = parseArgs(process.argv);

  // Single URL mode
  if (args.url) {
    const db = load(args['db-path']);
    const profileUrl = args.url.startsWith('http') ? args.url : `https://www.linkedin.com/in/${args.url}`;

    console.log(`Single-contact enrichment: ${profileUrl}`);

    const { context, page } = await launchBrowser();

    try {
      const budget = checkBudget('profile_visits');
      if (!budget.allowed) {
        console.log(`Rate limit reached: ${budget.used}/${budget.limit} profile visits today.`);
        await context.close();
        return;
      }

      await page.goto(profileUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
      await page.waitForTimeout(2500);
      await saveProfilePage(page, profileUrl);
      consumeBudget('profile_visits');

      const data = await extractProfileData(page);

      const dbContact = db.contacts[profileUrl];
      if (dbContact) {
        if (data.name) dbContact.enrichedName = data.name;
        if (data.headline) dbContact.headline = data.headline;
        if (data.location) dbContact.enrichedLocation = data.location;
        if (data.currentRole) dbContact.currentRole = data.currentRole;
        if (data.currentCompany) dbContact.currentCompany = data.currentCompany;
        if (data.about) dbContact.about = data.about;
        if (data.connections) dbContact.connections = data.connections;
        dbContact.enriched = true;
        dbContact.enrichedAt = new Date().toISOString();
        console.log(`Enriched: ${data.headline || 'no headline'}`);
      } else {
        console.log(`Contact not found in DB for ${profileUrl}. Creating entry.`);
        db.contacts[profileUrl] = {
          profileUrl,
          name: data.name,
          enrichedName: data.name,
          headline: data.headline,
          enrichedLocation: data.location,
          currentRole: data.currentRole,
          currentCompany: data.currentCompany,
          about: data.about,
          connections: data.connections,
          enriched: true,
          enrichedAt: new Date().toISOString(),
        };
      }

      save(db, args['db-path']);
      console.log('Enrichment complete.');
    } catch (err) {
      console.log(`ERROR: ${err.message}`);
    }

    await context.close();
    return;
  }

  const maxProfiles = parseInt(args.max || '100');
  const unenrichedOnly = args['unenriched-only'] !== undefined ? true : !args.all;

  const db = load(args['db-path']);
  let contacts = Object.values(db.contacts);

  if (unenrichedOnly) {
    contacts = contacts.filter(c => !c.enriched);
  }

  if (args.niche) {
    const nicheTerms = args.niche.toLowerCase().split(',');
    contacts = contacts.filter(c => {
      const text = `${c.headline || ''} ${c.title || ''} ${(c.searchTerms || []).join(' ')}`.toLowerCase();
      return nicheTerms.some(t => text.includes(t));
    });
  }

  contacts = contacts.slice(0, maxProfiles);

  if (contacts.length === 0) {
    console.log('No profiles to enrich.');
    return;
  }

  console.log(`Enriching ${contacts.length} profiles (unenriched-only: ${unenrichedOnly})...`);

  const { context, page } = await launchBrowser();

  let enriched = 0;
  let errors = 0;

  for (let i = 0; i < contacts.length; i++) {
    const c = contacts[i];
    if (!c.profileUrl) continue;

    // Rate budget check before profile visit
    const budget = checkBudget('profile_visits');
    if (!budget.allowed) {
      console.log(`  Rate limit reached: ${budget.used}/${budget.limit} profile visits today. Enriched ${enriched}/${contacts.length} planned.`);
      break;
    }

    console.log(`  [${i + 1}/${contacts.length}] ${c.name}...`);

    try {
      await page.goto(c.profileUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
      await page.waitForTimeout(2500);
      await saveProfilePage(page, c.profileUrl);
      consumeBudget('profile_visits');

      const data = await extractProfileData(page);

      // Update the contact in the DB
      const dbContact = db.contacts[c.profileUrl];
      if (dbContact) {
        if (data.name) dbContact.enrichedName = data.name;
        if (data.headline) dbContact.headline = data.headline;
        if (data.location) dbContact.enrichedLocation = data.location;
        if (data.currentRole) dbContact.currentRole = data.currentRole;
        if (data.currentCompany) dbContact.currentCompany = data.currentCompany;
        if (data.about) dbContact.about = data.about;
        if (data.connections) dbContact.connections = data.connections;
        dbContact.enriched = true;
        dbContact.enrichedAt = new Date().toISOString();
      }

      enriched++;
      console.log(`     -> ${(data.headline || 'no headline').substring(0, 80)}`);
    } catch (err) {
      errors++;
      console.log(`     -> ERROR: ${err.message}`);
    }

    // Save progress every 10 profiles
    if ((i + 1) % 10 === 0) {
      save(db, args['db-path']);
      console.log(`  [checkpoint] Saved ${enriched} enriched so far`);
    }

    // Rate limit: 2-5s random delay
    const delay = 2000 + Math.random() * 3000;
    await page.waitForTimeout(delay);
  }

  await context.close();
  save(db, args['db-path']);

  console.log(`\n${'='.repeat(60)}`);
  console.log(`Enrichment complete: ${enriched} enriched, ${errors} errors`);
  console.log(`Total DB contacts: ${Object.keys(db.contacts).length}`);
  console.log(`${'='.repeat(60)}`);
}

main().catch(e => { console.error(e); process.exit(1); });
