import { expect, test } from '@playwright/test';
import { createScenarioFixture, type ScenarioFixture } from './helpers';

test.describe('Graph group renderer and member recovery', () => {
  test.skip(!process.env.E2E_GRAPH_GROUPS || !process.env.E2E_DATABASE_URL || !process.env.E2E_OPERATOR_SECRET, 'Requires the disposable graph scenario database and operator secret');
  let fixture: ScenarioFixture;

  test.beforeAll(async () => { fixture = await createScenarioFixture(); });
  test.afterAll(async () => { await fixture?.close(); });

  async function unlockNetwork(page: import('@playwright/test').Page) {
    await page.goto('/operator/unlock');
    await page.getByLabel('Operator secret').fill(process.env.E2E_OPERATOR_SECRET!);
    await page.getByRole('button', { name: 'Unlock' }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
    await page.goto('/network');
  }

  test('keeps Sigma attached through filter failure and retry, and lists zero-loaded members', async ({ page }) => {
    let failNextGraph = false;
    let removeSelectedGroup = false;
    let initialGraph: {
      data: {
        nodes: Array<{ attributes: { groupIds: string[] } }>;
        edges: unknown[];
        groups: Array<{ id: string; loadedCount: number; visibleCount: number }>;
      };
    } | null = null;
    await page.route('**/api/graph/sigma-data?**', async (route) => {
      const url = new URL(route.request().url());
      if (url.searchParams.has('memberGroupId') || url.searchParams.has('catalogCursor')) return route.continue();
      if (failNextGraph && !url.searchParams.get('edgeTypes')?.split(',').includes('CONNECTED_TO')) {
        failNextGraph = false;
        return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Injected graph failure' }) });
      }
      if (!initialGraph) initialGraph = await (await route.fetch()).json();
      const body = structuredClone(initialGraph!);
      // Simulate a capped view whose only rendered node is outside the company group.
      body.data.nodes = body.data.nodes.slice(0, 1).map((node: { attributes: { groupIds: string[] } }) =>
        ({ ...node, attributes: { ...node.attributes, groupIds: [] } }));
      body.data.edges = [];
      body.data.groups = body.data.groups.map((group: { id: string; loadedCount: number; visibleCount: number }) =>
        group.id === `company:${fixture.companyId}` ? { ...group, loadedCount: 0, visibleCount: 0 } : group);
      if (removeSelectedGroup) body.data.groups = body.data.groups.filter((group: { id: string }) => group.id !== `company:${fixture.companyId}`);
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    });

    await unlockNetwork(page);
    const canvas = page.locator('[data-graph-revision] canvas').first();
    await expect(canvas).toBeAttached();
    await canvas.evaluate((element) => element.setAttribute('data-renderer-proof', 'original'));

    await page.getByRole('button', { name: 'Communities' }).click();
    await page.getByRole('button', { name: /Scenario Acme.*0 loaded/ }).click();
    await expect(page.getByRole('region', { name: 'Scenario Acme members' }).getByRole('link', { name: 'Scenario Alice' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Scenario Acme members' }).getByRole('link', { name: 'Scenario Bob' })).toBeVisible();
    await page.getByRole('button', { name: 'Load more groups' }).click();
    await expect(page.getByRole('button', { name: 'Load more groups' })).toBeVisible();
    await page.getByRole('button', { name: 'Load more groups' }).click();
    await expect(page.getByRole('button', { name: 'Load more groups' })).toBeVisible();
    await page.getByRole('button', { name: 'Load more groups' }).click();
    await expect(page.getByRole('button', { name: 'Load more groups' })).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Graph groups' })).toHaveCount(0);

    failNextGraph = true;
    await page.getByRole('button', { name: 'Connected', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Retry graph load' })).toBeVisible();
    await expect(page.locator('[data-renderer-proof="original"]')).toBeAttached();
    await page.getByRole('button', { name: 'Retry graph load' }).click();
    await expect(page.getByRole('button', { name: 'Retry graph load' })).toHaveCount(0);
    await expect(page.locator('[data-renderer-proof="original"]')).toBeAttached();
    await page.getByRole('button', { name: 'Communities' }).click();
    await expect(page.getByRole('button', { name: 'Clear highlight' })).toBeVisible();
    await page.keyboard.press('Escape');
    removeSelectedGroup = true;
    await page.getByRole('button', { name: 'Messaged', exact: true }).click();
    await expect(page.getByText('The selected group was removed; its highlight was cleared.')).toBeVisible();
    await expect(page.locator('[data-renderer-proof="original"]')).toBeAttached();
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  });

  test('keeps a newly selected zero-loaded group across an older delayed response', async ({ page }) => {
    let delayNext = false;
    let requestStarted!: () => void;
    let releaseRequest!: () => void;
    const started = new Promise<void>((resolve) => { requestStarted = resolve; });
    const held = new Promise<void>((resolve) => { releaseRequest = resolve; });
    await page.route('**/api/graph/sigma-data?**', async (route) => {
      const url = new URL(route.request().url());
      if (url.searchParams.has('memberGroupId') || url.searchParams.has('catalogCursor')) return route.continue();
      const body = await (await route.fetch()).json();
      body.data.nodes = body.data.nodes.slice(0, 1).map((node: { attributes: { groupIds: string[] } }) =>
        ({ ...node, attributes: { ...node.attributes, groupIds: [] } }));
      body.data.edges = [];
      body.data.groups = body.data.groups.map((group: { id: string; loadedCount: number; visibleCount: number }) =>
        group.id === `company:${fixture.companyId}` ? { ...group, loadedCount: 0, visibleCount: 0 } : group);
      if (delayNext && !url.searchParams.has('selectedGroupId')) {
        delayNext = false;
        requestStarted();
        await held;
        body.data.groups = body.data.groups.filter((group: { id: string }) => group.id !== `company:${fixture.companyId}`);
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    });
    await unlockNetwork(page);
    await page.getByRole('button', { name: 'Communities' }).click();
    await expect(page.getByRole('button', { name: /Scenario Acme.*0 loaded/ })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Graph groups' })).toHaveCount(0);
    delayNext = true;
    await page.getByRole('button', { name: 'Connected', exact: true }).click();
    await started;
    await page.getByRole('button', { name: 'Communities' }).click();
    await page.getByRole('button', { name: /Scenario Acme.*0 loaded/ }).click();
    await expect(page.getByRole('button', { name: 'Clear highlight' })).toBeVisible();
    releaseRequest();
    await expect(page.getByRole('region', { name: 'Scenario Acme members' }).getByRole('link', { name: 'Scenario Alice' })).toBeVisible();
    await expect(page.getByText('The selected group was removed; its highlight was cleared.')).toHaveCount(0);
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  });

  test('recomputes search dimming after a renderer-preserving graph refetch', async ({ page }) => {
    let changed = false;
    await page.route('**/api/graph/sigma-data?**', async (route) => {
      const url = new URL(route.request().url());
      if (url.searchParams.has('memberGroupId') || url.searchParams.has('catalogCursor')) return route.continue();
      const body = await (await route.fetch()).json();
      body.data.nodes = body.data.nodes.slice(0, 1).map((node: { attributes: { label: string; color: string; size: number } }) => ({
        ...node, attributes: { ...node.attributes, label: changed ? 'Other Person' : 'Search Match', color: '#ff0000', size: 30 },
      }));
      body.data.edges = [];
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    });
    await unlockNetwork(page);
    const canvas = page.locator('canvas.sigma-nodes');
    await expect(canvas).toBeVisible();
    await page.getByPlaceholder('Search contacts...').fill('Search Match');
    async function redPixels() {
      const png = (await canvas.screenshot()).toString('base64');
      return page.evaluate(async (base64) => {
        const image = new Image();
        image.src = `data:image/png;base64,${base64}`;
        await image.decode();
        const sample = document.createElement('canvas');
        sample.width = image.width;
        sample.height = image.height;
        const context = sample.getContext('2d')!;
        context.drawImage(image, 0, 0);
        const pixels = context.getImageData(0, 0, sample.width, sample.height).data;
        let count = 0;
        for (let offset = 0; offset < pixels.length; offset += 4) {
          if (pixels[offset] > 180 && pixels[offset + 1] < 100 && pixels[offset + 2] < 100) count++;
        }
        return count;
      }, png);
    }
    await expect.poll(redPixels).toBeGreaterThan(0);
    const graph = page.locator('[data-graph-revision]');
    const before = Number(await graph.getAttribute('data-graph-revision'));
    changed = true;
    await page.getByRole('button', { name: 'Connected', exact: true }).click();
    await expect.poll(async () => Number(await graph.getAttribute('data-graph-revision'))).toBeGreaterThan(before);
    await expect.poll(redPixels).toBe(0);
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  });

});
