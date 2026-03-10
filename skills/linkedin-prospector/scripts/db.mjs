import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { DATA_DIR } from './lib.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_DB_PATH = resolve(DATA_DIR, 'contacts.json');

function emptyDb() {
  return {
    contacts: {},
    searches: {},
    meta: { totalContacts: 0, lastUpdated: new Date().toISOString() },
  };
}

/**
 * Load the contacts DB from disk. Creates empty DB if missing.
 */
export function load(dbPath = DEFAULT_DB_PATH) {
  if (!existsSync(dbPath)) {
    const dir = dirname(dbPath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const db = emptyDb();
    writeFileSync(dbPath, JSON.stringify(db, null, 2));
    return db;
  }
  return JSON.parse(readFileSync(dbPath, 'utf-8'));
}

/**
 * Save the DB to disk, updating meta.
 */
export function save(db, dbPath = DEFAULT_DB_PATH) {
  db.meta.totalContacts = Object.keys(db.contacts).length;
  db.meta.lastUpdated = new Date().toISOString();
  const dir = dirname(dbPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(dbPath, JSON.stringify(db, null, 2));
}

/**
 * Find contacts matching filters.
 * @param {object} db
 * @param {object} filters - { niche, enriched, minMutual, keywords }
 */
export function find(db, filters = {}) {
  let results = Object.values(db.contacts);

  if (filters.enriched !== undefined) {
    results = results.filter(c => c.enriched === filters.enriched);
  }

  if (filters.minMutual) {
    const min = parseInt(filters.minMutual);
    results = results.filter(c => (c.mutualConnections || 0) >= min);
  }

  if (filters.niche) {
    const nicheTerms = filters.niche.toLowerCase().split(',').map(s => s.trim());
    results = results.filter(c => {
      const text = `${c.headline || ''} ${c.title || ''} ${c.about || ''} ${(c.searchTerms || []).join(' ')}`.toLowerCase();
      return nicheTerms.some(t => text.includes(t));
    });
  }

  if (filters.keywords) {
    const kws = filters.keywords.toLowerCase().split(',').map(s => s.trim());
    results = results.filter(c => {
      const text = `${c.name || ''} ${c.headline || ''} ${c.title || ''} ${c.about || ''} ${(c.searchTerms || []).join(' ')}`.toLowerCase();
      return kws.some(k => text.includes(k));
    });
  }

  return results.sort((a, b) => (b.mutualConnections || 0) - (a.mutualConnections || 0));
}

/**
 * Merge new profiles into the DB, deduplicating by profileUrl.
 * Keeps the richest data for each profile.
 */
export function merge(db, newProfiles, searchTerm) {
  let added = 0;
  let updated = 0;

  for (const p of newProfiles) {
    const key = p.profileUrl;
    if (!key) continue;

    const existing = db.contacts[key];
    if (!existing) {
      db.contacts[key] = {
        ...p,
        searchTerms: p.searchTerms || (p.searchTerm ? [p.searchTerm] : []),
        cachedAt: new Date().toISOString(),
        enriched: p.enriched || false,
      };
      delete db.contacts[key].searchTerm;
      added++;
    } else {
      // Merge search terms
      const allTerms = [...new Set([
        ...(existing.searchTerms || []),
        ...(p.searchTerms || []),
        ...(p.searchTerm ? [p.searchTerm] : []),
      ])];
      existing.searchTerms = allTerms;

      // Update with richer data (prefer longer/non-empty values)
      if (p.headline && (!existing.headline || p.headline.length > existing.headline.length)) {
        existing.headline = p.headline;
      }
      if (p.enrichedName && !existing.enrichedName) existing.enrichedName = p.enrichedName;
      if (p.enrichedLocation && !existing.enrichedLocation) existing.enrichedLocation = p.enrichedLocation;
      if (p.currentRole && !existing.currentRole) existing.currentRole = p.currentRole;
      if (p.currentCompany && !existing.currentCompany) existing.currentCompany = p.currentCompany;
      if (p.about && (!existing.about || p.about.length > existing.about.length)) existing.about = p.about;
      if (p.title && (!existing.title || p.title.length > existing.title.length)) existing.title = p.title;
      if (p.location && !existing.location) existing.location = p.location;
      if ((p.mutualConnections || 0) > (existing.mutualConnections || 0)) {
        existing.mutualConnections = p.mutualConnections;
      }
      if (p.enriched && !existing.enriched) existing.enriched = true;
      existing.cachedAt = new Date().toISOString();
      updated++;
    }
  }

  // Record the search
  if (searchTerm) {
    db.searches[searchTerm] = {
      lastRun: new Date().toISOString(),
      resultCount: newProfiles.length,
    };
  }

  return { added, updated };
}

/**
 * Get searches older than maxAgeDays.
 */
export function getStaleSearches(db, maxAgeDays = 7) {
  const cutoff = Date.now() - maxAgeDays * 86400000;
  return Object.entries(db.searches)
    .filter(([, s]) => new Date(s.lastRun).getTime() < cutoff)
    .map(([term, s]) => ({ term, ...s }));
}

/**
 * Attempt semantic vector search. Returns results array or null (fall through to substring).
 */
async function findSemantic(searchTerm, limit) {
  try {
    const { isRvfAvailable, queryStore } = await import('./rvf-store.mjs');
    if (!isRvfAvailable()) return null;

    const ruvector = await import('ruvector');
    const mod = ruvector.default || ruvector;
    const embedder = new mod.OnnxEmbedder({ enableParallel: false });
    await embedder.init();
    const queryVector = await embedder.embed(searchTerm);

    const results = await queryStore(queryVector, limit);
    await mod.shutdown();
    return results;
  } catch {
    return null;  // fall through to substring search
  }
}

// ---- CLI mode ----
const isMain = process.argv[1] && fileURLToPath(import.meta.url).endsWith(process.argv[1].replace(/.*\//, ''));

if (isMain) {
  (async () => {
    const command = process.argv[2];
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

    const dbPath = args['db-path'] || DEFAULT_DB_PATH;
    const db = load(dbPath);

    switch (command) {
      case 'stats': {
        const contacts = Object.values(db.contacts);
        const enriched = contacts.filter(c => c.enriched).length;
        const unenriched = contacts.length - enriched;

        // Count by niche
        const niches = {};
        for (const c of contacts) {
          const text = `${c.headline || ''} ${c.title || ''} ${(c.searchTerms || []).join(' ')}`.toLowerCase();
          let niche = 'other';
          if (text.includes('dtc') || text.includes('direct to consumer')) niche = 'dtc';
          else if (text.includes('php') || text.includes('zend') || text.includes('laravel')) niche = 'php';
          else if (text.includes('shopify')) niche = 'shopify';
          else if (text.includes('magento') || text.includes('adobe commerce')) niche = 'adobe-commerce';
          else if (text.includes('saas') || text.includes('platform')) niche = 'saas';
          else if (text.includes('agency') || text.includes('studio')) niche = 'agency';
          else if (text.includes('retail') || text.includes('omnichannel')) niche = 'retail';
          else if (text.includes('ecommerce') || text.includes('e-commerce') || text.includes('commerce')) niche = 'ecommerce';
          niches[niche] = (niches[niche] || 0) + 1;
        }

        console.log(`Total contacts: ${contacts.length}`);
        console.log(`  Enriched: ${enriched}`);
        console.log(`  Unenriched: ${unenriched}`);
        console.log(`\nBy niche:`);
        for (const [niche, count] of Object.entries(niches).sort((a, b) => b[1] - a[1])) {
          console.log(`  ${niche.padEnd(20)} ${count}`);
        }
        console.log(`\nSearches recorded: ${Object.keys(db.searches).length}`);
        console.log(`Last updated: ${db.meta.lastUpdated}`);
        break;
      }

      case 'search': {
        // Try semantic vector search first when keywords are provided
        const searchTerm = args.keywords || args.niche;
        if (searchTerm) {
          const semanticResults = await findSemantic(searchTerm, 20);
          if (semanticResults && semanticResults.length > 0) {
            console.log(`Found ${semanticResults.length} contacts (semantic search):`);
            semanticResults.forEach((result, i) => {
              const c = result.metadata || {};
              const name = c.name || result.id;
              const headline = (c.headline || c.title || '').substring(0, 60);
              const score = result.score?.toFixed(3) || '?';
              const tier = c.tier || '?';
              console.log(`  ${String(i + 1).padStart(3)}. [${tier}] ${name.padEnd(30)} | ${headline.padEnd(60)} | sim=${score}`);
            });
            break;
          }
        }

        // Fallback: existing substring search
        const results = find(db, {
          niche: args.niche,
          keywords: args.keywords,
          enriched: args.enriched === 'true' ? true : args.enriched === 'false' ? false : undefined,
          minMutual: args['min-mutual'],
        });
        console.log(`Found ${results.length} contacts:`);
        results.forEach((c, i) => {
          const name = c.enrichedName || c.name;
          const headline = (c.headline || c.title || '').substring(0, 60);
          const mutual = c.mutualConnections || 0;
          const enrichedFlag = c.enriched ? 'E' : ' ';
          console.log(`  ${String(i + 1).padStart(3)}. [${enrichedFlag}] ${name.padEnd(30)} | ${headline.padEnd(60)} | ${mutual} mutual`);
        });
        break;
      }

      case 'export': {
        const format = args.format || 'csv';
        const results = find(db, {
          niche: args.niche,
          keywords: args.keywords,
          enriched: args.enriched === 'true' ? true : undefined,
        });

        if (format === 'csv') {
          const headers = ['Name', 'Headline', 'Location', 'Profile URL', 'Mutual Connections', 'Current Role', 'Current Company', 'Enriched', 'Search Terms'];
          const rows = results.map(c => [
            c.enrichedName || c.name,
            (c.headline || c.title || '').replace(/"/g, '""'),
            (c.enrichedLocation || c.location || '').replace(/"/g, '""'),
            c.profileUrl,
            c.mutualConnections || 0,
            (c.currentRole || '').replace(/"/g, '""'),
            (c.currentCompany || '').replace(/"/g, '""'),
            c.enriched ? 'Yes' : 'No',
            (c.searchTerms || []).join('; '),
          ]);
          const csv = [headers, ...rows].map(r => r.map(cell => `"${cell}"`).join(',')).join('\n');
          console.log(csv);
        } else {
          console.log(JSON.stringify(results, null, 2));
        }
        break;
      }

      case 'prune': {
        const olderThan = args['older-than'] || '90d';
        const days = parseInt(olderThan);
        const cutoff = Date.now() - days * 86400000;
        let pruned = 0;

        for (const [url, c] of Object.entries(db.contacts)) {
          if (new Date(c.cachedAt).getTime() < cutoff) {
            delete db.contacts[url];
            pruned++;
          }
        }

        save(db, dbPath);
        console.log(`Pruned ${pruned} contacts older than ${days} days`);
        break;
      }

      case 'seed': {
        const file = args.file;
        if (!file) {
          console.error('Usage: node db.mjs seed --file <path-to-enriched.json>');
          process.exit(1);
        }
        if (!existsSync(file)) {
          console.error(`File not found: ${file}`);
          process.exit(1);
        }
        let raw = JSON.parse(readFileSync(file, 'utf-8'));
        // Support both array format and { contacts: { url: profile } } format
        const profiles = Array.isArray(raw) ? raw :
          (raw.contacts && typeof raw.contacts === 'object') ? Object.values(raw.contacts) : [raw];
        const result = merge(db, profiles);
        save(db, dbPath);
        console.log(`Seeded DB: ${result.added} added, ${result.updated} updated`);
        console.log(`Total contacts: ${Object.keys(db.contacts).length}`);
        break;
      }

      default:
        console.log('Usage: node db.mjs <command> [options]');
        console.log('Commands:');
        console.log('  stats                           Show contact counts by niche');
        console.log('  search --niche <n> [--min-mutual N] [--keywords "k1,k2"]');
        console.log('  export --format csv|json [--niche <n>]');
        console.log('  prune --older-than 90d          Remove stale entries');
        console.log('  seed --file <path>              Import from enriched JSON');
    }
  })().catch(e => { console.error(e); process.exit(1); });
}
