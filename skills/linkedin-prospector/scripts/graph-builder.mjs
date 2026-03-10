import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { DATA_DIR } from './lib.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONTACTS_PATH = resolve(DATA_DIR, 'contacts.json');
const GRAPH_PATH = resolve(DATA_DIR, 'graph.json');

// ---- Cluster keyword definitions ----
const CLUSTER_KEYWORDS = {
  dtc:            ['dtc', 'direct to consumer', 'd2c'],
  ecommerce:      ['ecommerce', 'e-commerce', 'digital commerce', 'online retail', 'commerce'],
  saas:           ['saas', 'software as a service', 'platform'],
  'adobe-commerce': ['adobe commerce', 'magento'],
  shopify:        ['shopify'],
  agency:         ['agency', 'studio', 'consultancy'],
  php:            ['php', 'zend', 'laravel', 'symfony', 'laminas'],
  retail:         ['retail', 'omnichannel'],
  consulting:     ['consultant', 'consulting', 'advisor', 'advisory'],
  technology:     ['technology', 'tech', 'engineering', 'developer', 'software'],
};

// Clusters considered "adjacent" for mutual-proximity edges
const ADJACENT_CLUSTERS = {
  dtc:              ['ecommerce', 'shopify', 'retail'],
  ecommerce:        ['dtc', 'shopify', 'retail', 'adobe-commerce', 'saas'],
  saas:             ['technology', 'ecommerce'],
  'adobe-commerce': ['ecommerce', 'php', 'technology'],
  shopify:          ['ecommerce', 'dtc', 'agency'],
  agency:           ['consulting', 'shopify', 'ecommerce'],
  php:              ['technology', 'adobe-commerce'],
  retail:           ['ecommerce', 'dtc'],
  consulting:       ['agency', 'technology', 'saas'],
  technology:       ['saas', 'php', 'adobe-commerce'],
};

const COMPANY_SUFFIX_RE = /\s*[·\-|]\s*(Full-time|Part-time|Freelance|Contract|Internship|Self-employed|Seasonal|Apprenticeship)$/i;

// ---- Helpers ----

function verbose(...args) {
  if (process.argv.includes('--verbose')) console.log('[graph]', ...args);
}

/**
 * Normalize a company name into a stable key.
 * "Shiseido · Freelance" -> key: "shiseido", display: "Shiseido"
 */
function normalizeCompany(raw) {
  if (!raw || !raw.trim()) return null;
  const cleaned = raw.replace(COMPANY_SUFFIX_RE, '').trim();
  if (!cleaned) return null;
  return {
    key: cleaned.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
    displayName: cleaned,
  };
}

/**
 * Build a searchable text blob from a contact for cluster matching.
 */
function contactText(c) {
  return [
    c.headline || '',
    c.title || '',
    c.about || '',
    c.currentRole || '',
    ...(c.searchTerms || []),
  ].join(' ').toLowerCase();
}

/**
 * Determine which clusters a contact belongs to.
 */
function detectClusters(c) {
  const text = contactText(c);
  const matched = [];
  for (const [clusterId, keywords] of Object.entries(CLUSTER_KEYWORDS)) {
    if (keywords.some(kw => text.includes(kw))) {
      matched.push(clusterId);
    }
  }
  return matched;
}

/**
 * Compute the Nth percentile value from a sorted (ascending) array of numbers.
 */
function percentile(sortedArr, pct) {
  if (sortedArr.length === 0) return 0;
  const idx = Math.ceil((pct / 100) * sortedArr.length) - 1;
  return sortedArr[Math.max(0, idx)];
}

// ---- Main build ----

function build() {
  if (!existsSync(CONTACTS_PATH)) {
    console.error(`contacts.json not found at ${CONTACTS_PATH}`);
    process.exit(1);
  }

  verbose('Reading contacts.json...');
  const db = JSON.parse(readFileSync(CONTACTS_PATH, 'utf-8'));
  const rawContacts = db.contacts || {};
  const urls = Object.keys(rawContacts);

  if (urls.length === 0) {
    console.error('No contacts found in database.');
    process.exit(1);
  }

  verbose(`Loaded ${urls.length} contacts`);

  // --- Step 1: Normalize companies and annotate contacts ---
  const companies = {};       // { companyKey: { name, contacts: [urls] } }
  const contacts = {};        // copy with added companyId
  const contactClusters = {}; // { url: [clusterIds] }

  for (const url of urls) {
    const c = { ...rawContacts[url] };
    const norm = normalizeCompany(c.currentCompany);
    c.companyId = norm ? norm.key : null;
    // Default degree: 1 for original contacts, preserve if already set by deep-scan
    if (!c.degree) c.degree = 1;
    contacts[url] = c;

    if (norm) {
      if (!companies[norm.key]) {
        companies[norm.key] = { name: norm.displayName, contacts: [] };
      }
      companies[norm.key].contacts.push(url);
      // Prefer longer display name (more descriptive)
      if (norm.displayName.length > companies[norm.key].name.length) {
        companies[norm.key].name = norm.displayName;
      }
    }
  }

  verbose(`Found ${Object.keys(companies).length} unique companies`);

  // --- Step 2: Detect clusters ---
  const clusters = {};
  for (const clusterId of Object.keys(CLUSTER_KEYWORDS)) {
    clusters[clusterId] = {
      label: clusterId,
      keywords: CLUSTER_KEYWORDS[clusterId],
      contacts: [],
      hubContacts: [],
    };
  }

  for (const url of urls) {
    const matched = detectClusters(contacts[url]);
    contactClusters[url] = matched;
    for (const cId of matched) {
      clusters[cId].contacts.push(url);
    }
  }

  verbose('Clusters:', Object.entries(clusters)
    .filter(([, cl]) => cl.contacts.length > 0)
    .map(([id, cl]) => `${id}(${cl.contacts.length})`).join(', '));

  // --- Step 3: Build edges ---
  const edges = [];
  const edgeSet = new Set(); // dedup: "type|source|target"

  function addEdge(source, target, type, weight) {
    const key = source < target
      ? `${type}|${source}|${target}`
      : `${type}|${target}|${source}`;
    if (edgeSet.has(key)) return;
    edgeSet.add(key);
    edges.push({ source, target, type, weight });
  }

  // 3a. same-company edges
  let sameCompanyCount = 0;
  for (const comp of Object.values(companies)) {
    const memberUrls = comp.contacts;
    for (let i = 0; i < memberUrls.length; i++) {
      for (let j = i + 1; j < memberUrls.length; j++) {
        addEdge(memberUrls[i], memberUrls[j], 'same-company', 0.8);
        sameCompanyCount++;
      }
    }
  }
  verbose(`same-company edges: ${sameCompanyCount}`);

  // 3b. same-cluster edges (top 20% by mutuals within each cluster)
  // Only contacts with mutualConnections > 0 are candidates; percentile
  // is computed over that non-zero subset to avoid threshold collapse.
  let sameClusterCount = 0;
  for (const [clusterId, cluster] of Object.entries(clusters)) {
    const members = cluster.contacts;
    if (members.length < 2) continue;

    const withMutuals = members.filter(
      url => (contacts[url].mutualConnections || 0) > 0
    );
    if (withMutuals.length < 2) continue;

    const mutuals = withMutuals
      .map(url => contacts[url].mutualConnections)
      .sort((a, b) => a - b);
    const threshold = Math.max(1, percentile(mutuals, 80));

    const hubUrls = withMutuals.filter(
      url => contacts[url].mutualConnections >= threshold
    );

    // Connect hubs to each other within this cluster
    for (let i = 0; i < hubUrls.length; i++) {
      for (let j = i + 1; j < hubUrls.length; j++) {
        addEdge(hubUrls[i], hubUrls[j], 'same-cluster', 0.3);
        sameClusterCount++;
      }
    }
  }
  verbose(`same-cluster edges: ${sameClusterCount}`);

  // 3c. mutual-proximity edges (top 25% by mutuals, same/adjacent clusters)
  // Only contacts with mutualConnections > 0 are considered; percentile
  // is computed over the non-zero subset.
  let mutualProxCount = 0;
  const urlsWithMutuals = urls.filter(
    url => (contacts[url].mutualConnections || 0) > 0
  );
  const allMutuals = urlsWithMutuals
    .map(url => contacts[url].mutualConnections)
    .sort((a, b) => a - b);
  const mutualThreshold = Math.max(1, percentile(allMutuals, 75));

  const highMutualUrls = urlsWithMutuals.filter(
    url => contacts[url].mutualConnections >= mutualThreshold
  );

  for (let i = 0; i < highMutualUrls.length; i++) {
    const urlA = highMutualUrls[i];
    const clustersA = contactClusters[urlA];
    for (let j = i + 1; j < highMutualUrls.length; j++) {
      const urlB = highMutualUrls[j];
      const clustersB = contactClusters[urlB];

      // Check if contacts share a cluster or are in adjacent clusters
      let connected = false;
      for (const cA of clustersA) {
        if (connected) break;
        if (clustersB.includes(cA)) {
          connected = true;
          break;
        }
        const adj = ADJACENT_CLUSTERS[cA] || [];
        for (const cB of clustersB) {
          if (adj.includes(cB)) {
            connected = true;
            break;
          }
        }
      }

      if (connected) {
        addEdge(urlA, urlB, 'mutual-proximity', 0.5);
        mutualProxCount++;
      }
    }
  }
  verbose(`mutual-proximity edges: ${mutualProxCount}`);

  // 3d. discovered-connection edges (from deep-scan discoveredVia data)
  // These are real connections: person A was found in person B's connection list
  let discoveredConnCount = 0;
  let sharedConnCount = 0;
  for (const url of urls) {
    const c = contacts[url];
    if (!c.discoveredVia || c.discoveredVia.length === 0) continue;

    // Create edges from each discoverer to this contact
    for (const via of c.discoveredVia) {
      if (contacts[via]) {
        addEdge(via, url, 'discovered-connection', 0.9);
        discoveredConnCount++;
      }
    }

    // If discovered via multiple 1st-degree contacts, those contacts share
    // a real hidden connection — create shared-connection edges between them
    if (c.discoveredVia.length >= 2) {
      const vias = c.discoveredVia.filter(v => contacts[v]);
      for (let i = 0; i < vias.length; i++) {
        for (let j = i + 1; j < vias.length; j++) {
          addEdge(vias[i], vias[j], 'shared-connection', 0.7);
          sharedConnCount++;
        }
      }
    }
  }
  verbose(`discovered-connection edges: ${discoveredConnCount}`);
  verbose(`shared-connection edges: ${sharedConnCount}`);

  // --- Step 4: Assemble and write graph.json ---
  const graph = {
    contacts,
    companies,
    clusters,
    edges,
    meta: {
      totalContacts: urls.length,
      lastBuilt: new Date().toISOString(),
      version: 1,
    },
  };

  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(GRAPH_PATH, JSON.stringify(graph, null, 2));

  // --- Summary ---
  const edgeCounts = edges.reduce((m, e) => { m[e.type] = (m[e.type] || 0) + 1; return m; }, {});
  const activeClusters = Object.keys(clusters).filter(k => clusters[k].contacts.length > 0).length;
  const degreeCounts = urls.reduce((m, u) => {
    const d = contacts[u].degree || 1;
    m[d] = (m[d] || 0) + 1;
    return m;
  }, {});
  const deepScanned = urls.filter(u => contacts[u].deepScanned).length;

  console.log('Graph built successfully.');
  console.log(`  Contacts:  ${urls.length}`);
  for (const [d, count] of Object.entries(degreeCounts).sort((a, b) => a[0] - b[0])) {
    console.log(`    degree-${d}:${' '.repeat(14 - d.length)}${count}`);
  }
  if (deepScanned > 0) console.log(`    deep-scanned:       ${deepScanned}`);
  console.log(`  Companies: ${Object.keys(companies).length}`);
  console.log(`  Clusters:  ${activeClusters} active`);
  console.log(`  Edges:     ${edges.length} total`);
  for (const [type, count] of Object.entries(edgeCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${type.padEnd(22)} ${count}`);
  }
  console.log(`  Output:    ${GRAPH_PATH}`);
}

build();
