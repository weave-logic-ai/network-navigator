import { expect, type Page, type Response } from '@playwright/test';
import { focusScenarioTarget, scenarioTest as test } from './helpers';

// Opt-in against a real, seeded app. Run from app/ with:
// NETWORK_PERF_RUN=1 NETWORK_PERF_CONTACT_A='Unique Contact A' \
// NETWORK_PERF_CONTACT_B='Unique Contact B' \
// npx playwright test e2e/scenarios/network-performance.spec.ts --workers=1
// Set NETWORK_PERF_BASE_URL if the app is not at localhost:3000. The fixture
// must contain at least NETWORK_PERF_MIN_NODES (default 1000) visible nodes.
const enabled = process.env.NETWORK_PERF_RUN === '1';
const baseURL = process.env.NETWORK_PERF_BASE_URL ?? 'http://localhost:3000';
const contactA = process.env.NETWORK_PERF_CONTACT_A;
const contactB = process.env.NETWORK_PERF_CONTACT_B;
const iterations = Number(process.env.NETWORK_PERF_ITERATIONS ?? 20);
const minNodes = Number(process.env.NETWORK_PERF_MIN_NODES ?? 1000);
test.use({ baseURL });
test.skip(!enabled || !contactA || !contactB || !process.env.E2E_OPERATOR_SECRET,
  'Set NETWORK_PERF_RUN=1, E2E_OPERATOR_SECRET, and two fixture contact names.');

type Sample = { focusMs: number; apiMs: number; renderMs: number; nodes: number; rootId: string };
type GraphStats = { loadedNodes: number; totalNodes: number; totalEdges: number };

function p95(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.ceil(sorted.length * 0.95) - 1];
}

function graphResponse(response: Response): boolean {
  return response.ok() && new URL(response.url()).pathname === '/api/graph/sigma-data';
}

async function paintedGraph(page: Page, stats?: GraphStats, priorRevision?: number): Promise<number> {
  await expect(page.getByText('Loading graph data...')).toBeHidden();
  if (stats) {
    await expect(page.getByText(
      `${stats.loadedNodes}/${stats.totalNodes} nodes, ${stats.totalEdges} edges`,
      { exact: true },
    )).toBeVisible();
  }
  await expect(page.locator('canvas').first()).toBeVisible();
  if (priorRevision !== undefined) {
    await expect.poll(async () => Number(await page.locator('[data-graph-revision]').getAttribute('data-graph-revision')))
      .toBeGreaterThan(priorRevision);
  }
  return page.evaluate(() => new Promise<number>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve(Date.now())));
  }));
}

async function focusWithPicker(page: Page, name: string): Promise<Sample> {
  await page.keyboard.press('t');
  const dialog = page.getByRole('dialog', { name: 'Target picker' });
  await dialog.getByPlaceholder('Search contacts and companies...').fill(name);
  const result = dialog.getByRole('button').filter({ hasText: name });
  await expect(result).toHaveCount(1);

  const graphRequest = page.waitForResponse((response) =>
    graphResponse(response) && Boolean(new URL(response.url()).searchParams.get('primaryTargetId')),
  );
  const priorRevision = Number(await page.locator('[data-graph-revision]').getAttribute('data-graph-revision'));
  // Include the picker write and the graph refresh in the same browser clock.
  await page.evaluate(() => sessionStorage.setItem('networkPerfStart', String(Date.now())));
  await result.click();
  const response = await graphRequest;
  await response.finished();
  const apiEnd = Date.now();
  const body = await response.json() as { data?: { stats?: GraphStats } };
  expect(body.data?.stats).toBeDefined();
  const paintEnd = await paintedGraph(page, body.data!.stats!, priorRevision);
  const start = await page.evaluate(() => Number(sessionStorage.getItem('networkPerfStart')));
  return {
    focusMs: paintEnd - start,
    apiMs: apiEnd - start,
    renderMs: paintEnd - apiEnd,
    nodes: body.data?.stats?.loadedNodes ?? 0,
    rootId: new URL(response.url()).searchParams.get('primaryTargetId') ?? '',
  };
}

test('real graph focus, paint and breadcrumb back p95', async ({ page, scenarioRequest: request }) => {
  test.setTimeout(300_000);
  expect(contactA).not.toBe(contactB);
  expect(Number.isInteger(iterations) && iterations >= 3).toBe(true);
  expect(Number.isFinite(minNodes) && minNodes >= 1000).toBe(true);

  const initial = await request.get(`${baseURL}/api/graph/sigma-data?limit=6000`);
  expect(initial.ok(), 'Fixture graph API must be healthy').toBe(true);
  const initialBody = await initial.json() as { data?: { stats?: { loadedNodes?: number; totalEdges?: number } } };
  expect(initialBody.data?.stats?.loadedNodes ?? 0, 'Fixture must have a realistic visible graph')
    .toBeGreaterThanOrEqual(minNodes);
  expect(initialBody.data?.stats?.totalEdges ?? 0, 'Fixture must have real visible edges')
    .toBeGreaterThan(0);

  const clearState = await focusScenarioTarget(request, null, baseURL);
  expect(clearState.ok(), 'Fixture must allow resetting the secondary target').toBe(true);

  await page.goto(`${baseURL}/network`);
  await paintedGraph(page);
  await expect(page.getByRole('navigation', { name: 'Research target breadcrumbs' })).toBeVisible();

  const focus: Sample[] = [];
  const backMs: number[] = [];
  let backWithoutGraphRefresh = 0;
  const a = await focusWithPicker(page, contactA!);
  for (let i = 0; i < iterations; i++) {
    const b = await focusWithPicker(page, contactB!);
    expect(a.rootId).not.toBe(b.rootId);
    focus.push(b);

    const crumb = page.getByRole('navigation', { name: 'Research target breadcrumbs' });
    await crumb.getByText(contactB!, { exact: true }).first().hover();
    const back = crumb.getByRole('button', { name: 'Back to prior target' });
    await expect(back).toBeVisible();
    const graphRequest = page.waitForResponse((response) =>
      graphResponse(response) && new URL(response.url()).searchParams.get('primaryTargetId') === a.rootId,
    { timeout: 3000 })
      .catch(() => null);
    const priorRevision = Number(await page.locator('[data-graph-revision]').getAttribute('data-graph-revision'));
    const start = Date.now();
    await back.click();
    const response = await graphRequest;
    if (!response) {
      backWithoutGraphRefresh++;
      continue;
    }
    await response.finished();
    const body = await response.json() as { data?: { stats?: GraphStats } };
    expect(body.data?.stats).toBeDefined();
    const paintEnd = await paintedGraph(page, body.data!.stats!, priorRevision);
    backMs.push(paintEnd - start);
  }

  const focusP95 = p95(focus.map((sample) => sample.focusMs));
  const renderP95 = p95(focus.map((sample) => sample.renderMs));
  const apiP95 = p95(focus.map((sample) => sample.apiMs));
  console.log(JSON.stringify({
    fixture: { minNodes, observedNodes: focus.map((sample) => sample.nodes) },
    samples: iterations,
    focusToPaintP95Ms: focusP95,
    clickToApiEndP95Ms: apiP95,
    apiEndToPaintP95Ms: renderP95,
    backToPaintP95Ms: backMs.length === iterations ? p95(backMs) : null,
    backWithoutGraphRefresh,
    note: 'Real API and Sigma canvas; includes picker write and Playwright dispatch. No mock/cache-only budget claim.',
  }));

  expect(Math.min(...focus.map((sample) => sample.nodes))).toBeGreaterThan(0);
  expect(backWithoutGraphRefresh, 'Back must trigger a graph refresh before its p95 is meaningful').toBe(0);
  expect(focusP95, '§8 client-observed re-center budget').toBeLessThanOrEqual(200);
  expect(p95(backMs), '§8 client-observed re-center budget').toBeLessThanOrEqual(200);
});
