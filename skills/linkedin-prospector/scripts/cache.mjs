/**
 * cache.mjs -- HTML cache utility for LinkedIn pages.
 *
 * Receives live Playwright `page` objects from callers (search, enrich,
 * deep-scan) and persists the fully-rendered DOM as raw HTML files.
 * Does NOT launch its own browser — the caller's authenticated session
 * is used transparently.
 *
 * Directory layout:
 *   data/cache/
 *     index.json
 *     search/<slug>-p<N>.html
 *     profiles/<profile-slug>.html
 *     connections/<profile-slug>-p<N>.html
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { DATA_DIR } from './lib.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = resolve(DATA_DIR, 'cache');
const INDEX_PATH = resolve(CACHE_DIR, 'index.json');

const SUBDIRS = ['search', 'profiles', 'connections'];

function ensureDirs() {
  for (const sub of SUBDIRS) {
    const dir = resolve(CACHE_DIR, sub);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }
}

export function loadIndex() {
  if (!existsSync(INDEX_PATH)) return { version: 1, entries: {} };
  return JSON.parse(readFileSync(INDEX_PATH, 'utf-8'));
}

function saveIndex(index) {
  ensureDirs();
  writeFileSync(INDEX_PATH, JSON.stringify(index, null, 2));
}

/** Extract a URL-safe slug from a LinkedIn profile URL. */
export function slugFromUrl(url) {
  const match = url.match(/\/in\/([^/?#]+)/);
  return match ? match[1].replace(/\/$/, '') : url.replace(/[^a-zA-Z0-9-]/g, '_').slice(-60);
}

/** Save a search results page to the cache. */
export async function saveSearchPage(page, searchTerm, pageNum) {
  ensureDirs();
  const slug = searchTerm.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40);
  const file = `search/${slug}-p${pageNum}.html`;
  const html = await page.content();
  writeFileSync(resolve(CACHE_DIR, file), html);

  const index = loadIndex();
  const key = `search:${slug}:${pageNum}`;
  index.entries[key] = {
    url: page.url(),
    type: 'search',
    file,
    cachedAt: new Date().toISOString(),
    searchTerm,
    page: pageNum,
  };
  saveIndex(index);
}

/** Save a profile page to the cache. */
export async function saveProfilePage(page, profileUrl) {
  ensureDirs();
  const slug = slugFromUrl(profileUrl);
  const file = `profiles/${slug}.html`;
  const html = await page.content();
  writeFileSync(resolve(CACHE_DIR, file), html);

  const index = loadIndex();
  const key = `profile:${profileUrl.replace(/\/$/, '').split('?')[0]}`;
  index.entries[key] = {
    url: profileUrl,
    type: 'profile',
    file,
    cachedAt: new Date().toISOString(),
  };
  saveIndex(index);
}

/** Save a connections list page to the cache. */
export async function saveConnectionsPage(page, targetUrl, pageNum) {
  ensureDirs();
  const slug = slugFromUrl(targetUrl);
  const file = `connections/${slug}-p${pageNum}.html`;
  const html = await page.content();
  writeFileSync(resolve(CACHE_DIR, file), html);

  const index = loadIndex();
  const key = `connections:${slug}:${pageNum}`;
  index.entries[key] = {
    url: page.url(),
    type: 'connections',
    file,
    cachedAt: new Date().toISOString(),
    targetUrl,
    page: pageNum,
  };
  saveIndex(index);
}

/** Check whether a profile URL is already cached. */
export function isProfileCached(profileUrl) {
  const index = loadIndex();
  const key = `profile:${profileUrl.replace(/\/$/, '').split('?')[0]}`;
  return !!index.entries[key];
}

/** Read cached HTML by cache key. Returns null if missing. */
export function getCachedHtml(cacheKey) {
  const index = loadIndex();
  const entry = index.entries[cacheKey];
  if (!entry) return null;
  const filePath = resolve(CACHE_DIR, entry.file);
  if (!existsSync(filePath)) return null;
  return readFileSync(filePath, 'utf-8');
}
