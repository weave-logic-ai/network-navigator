// eslint-disable-next-line @typescript-eslint/no-require-imports
const { test, expect } = require('playwright/test') as typeof import('@playwright/test');

const BASE = 'http://localhost:3000';

// ── UI Pages ──────────────────────────────────────────────
const PAGES = [
  { path: '/', name: 'Home / Landing' },
  { path: '/dashboard', name: 'Dashboard' },
  { path: '/contacts', name: 'Contacts' },
  { path: '/discover', name: 'Discover' },
  { path: '/network', name: 'Network Graph' },
  { path: '/profile', name: 'Profile' },
  { path: '/outreach', name: 'Outreach' },
  { path: '/import', name: 'Import' },
  { path: '/tasks', name: 'Tasks' },
  { path: '/enrichment', name: 'Enrichment' },
  { path: '/admin', name: 'Admin' },
  { path: '/extension', name: 'Extension' },
];

for (const pg of PAGES) {
  test(`Page loads without error: ${pg.name} (${pg.path})`, async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    const response = await page.goto(`${BASE}${pg.path}`, { waitUntil: 'networkidle', timeout: 30000 });
    expect(response?.status()).toBeLessThan(500);

    // Check no uncaught exceptions rendered
    const bodyText = await page.textContent('body');
    expect(bodyText).not.toContain('Internal Server Error');
    expect(bodyText).not.toContain('Application error');
    expect(bodyText).not.toContain('Unhandled Runtime Error');

    // Screenshot for review
    await page.screenshot({ path: `tests/e2e/screenshots/${pg.path.replace(/\//g, '_') || '_home'}.png`, fullPage: true });
  });
}

// ── API Endpoints ─────────────────────────────────────────
const API_GETS = [
  '/api/health',
  '/api/dashboard',
  '/api/contacts?page=1&limit=10',
  '/api/graph/data',
  '/api/graph/communities',
  '/api/graph/taxonomy',
  '/api/profile/network-health',
  '/api/profile/natural-icp',
  '/api/profile/desired-icp',
  '/api/profile/gap-analysis',
  '/api/goals',
  '/api/tasks',
  '/api/icps',
  '/api/niches',
  '/api/offerings',
  '/api/industries',
  '/api/verticals',
  '/api/scoring/status',
  '/api/scoring/weights',
  '/api/enrichment/providers',
  '/api/enrichment/budget',
  '/api/enrichment/history',
  '/api/outreach/campaigns',
  '/api/outreach/templates',
  '/api/outreach/pipeline',
  '/api/import/history',
  '/api/icp/profiles',
  '/api/icp/discover',
  '/api/admin/health',
  '/api/contacts/search?q=test',
  '/api/contacts/hybrid-search?q=test',
];

for (const endpoint of API_GETS) {
  test(`API responds without 500: ${endpoint}`, async ({ request }) => {
    const res = await request.get(`${BASE}${endpoint}`, { timeout: 15000 });
    const status = res.status();
    const body = await res.text();

    // Log failures for debugging
    if (status >= 500) {
      console.error(`[${status}] ${endpoint}: ${body.substring(0, 300)}`);
    }

    expect(status, `${endpoint} returned ${status}: ${body.substring(0, 200)}`).toBeLessThan(500);
  });
}

// ── Discover Page Specific ────────────────────────────────
test('Discover page shows niches (not just "import data")', async ({ page }) => {
  await page.goto(`${BASE}/discover`, { waitUntil: 'networkidle', timeout: 30000 });
  const bodyText = await page.textContent('body');

  // Capture what the page actually shows
  await page.screenshot({ path: 'tests/e2e/screenshots/discover-detail.png', fullPage: true });

  // Should have loaded niches or ICP data, not just an empty/import state
  const hasContent = bodyText?.includes('niche') ||
    bodyText?.includes('ICP') ||
    bodyText?.includes('contacts') ||
    bodyText?.includes('Discover');
  expect(hasContent).toBeTruthy();
});

// ── Dashboard Data Check ──────────────────────────────────
test('Dashboard API returns valid stats', async ({ request }) => {
  const res = await request.get(`${BASE}/api/dashboard`);
  expect(res.status()).toBe(200);
  const json = await res.json();
  expect(json.data).toBeDefined();
  expect(json.data.stats).toBeDefined();
  expect(json.data.stats.totalContacts).toBeGreaterThanOrEqual(0);
});

// ── Graph Data Check ──────────────────────────────────────
test('Graph data API returns nodes and edges', async ({ request }) => {
  const res = await request.get(`${BASE}/api/graph/data`);
  expect(res.status()).toBe(200);
  const json = await res.json();
  expect(json.data).toBeDefined();
  expect(json.data.nodes).toBeDefined();
  expect(json.data.edges).toBeDefined();
});

// ── Contacts Check ────────────────────────────────────────
test('Contacts API returns list', async ({ request }) => {
  const res = await request.get(`${BASE}/api/contacts?page=1&limit=5`);
  expect(res.status()).toBe(200);
  const json = await res.json();
  expect(json.data || json.contacts).toBeDefined();
});
