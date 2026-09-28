import { expect } from '@playwright/test';
import { authenticatedScenarioRequest, createScenarioFixture, focusScenarioTarget,
  scenarioTest as test, type ScenarioFixture } from './helpers';

test.describe.serial('Research target focus (US-1, US-2, US-5)', () => {
  test.skip(!process.env.E2E_DATABASE_URL || !process.env.E2E_OPERATOR_SECRET,
    'Requires a dedicated E2E_DATABASE_URL and E2E_OPERATOR_SECRET');
  let fixture: ScenarioFixture;

  test.beforeAll(async () => {
    fixture = await createScenarioFixture();
    // A passing scenario must exercise the same dedicated DB the app uses.
    const request = await authenticatedScenarioRequest();
    try {
      const byName = await request.get('/api/contacts?search=Scenario%20Alice');
      const body = await byName.json();
      if (!byName.ok() || !body.data?.some((row: { id: string }) => row.id === fixture.firstContactId)) {
        throw new Error('App is not connected to E2E_DATABASE_URL');
      }
    } finally {
      await request.dispose();
    }
  });

  test.afterAll(async () => {
    await fixture?.close();
  });

  test('US-1: company secondary keeps self as immutable primary', async ({ scenarioRequest: request }) => {
    const before = await request.get('/api/targets/state');
    expect(before.ok()).toBeTruthy();
    const primary = (await before.json()).data.primaryTargetId as string;
    expect(primary).toBeTruthy();

    const created = await request.post('/api/targets', {
      data: { kind: 'company', id: fixture.companyId },
    });
    expect(created.status()).toBe(200);
    const companyTargetId = (await created.json()).data.id as string;
    const selected = await focusScenarioTarget(request, companyTargetId);
    expect(selected.ok()).toBeTruthy();
    expect((await selected.json()).data).toMatchObject({
      primaryTargetId: primary,
      secondaryTargetId: companyTargetId,
    });
  });

  // US-1's dated three-source timeline and US-2's comparison remain in the sprint backlog.

  test('US-5: contact secondary re-roots the live graph and can clear', async ({ scenarioRequest: request, page }) => {
    const browserErrors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') browserErrors.push(message.text());
    });
    const created = await request.post('/api/targets', {
      data: { kind: 'contact', id: fixture.firstContactId },
    });
    expect(created.status()).toBe(200);
    const targetId = (await created.json()).data.id as string;
    const selected = await focusScenarioTarget(request, targetId);
    expect(selected.ok()).toBeTruthy();

    const graph = await request.get(`/api/graph/sigma-data?limit=10&primaryTargetId=${targetId}`);
    expect(graph.status()).toBe(200);
    const nodes = (await graph.json()).data.nodes as Array<{
      key: string;
      attributes: { tier: string };
    }>;
    expect(nodes.map((node) => node.key)).toEqual(
      expect.arrayContaining([fixture.firstContactId, fixture.secondContactId])
    );
    expect(nodes.find((node) => node.key === fixture.firstContactId)?.attributes.tier).toBe('gold');

    await page.goto('/network');
    await expect(page.getByText('2/2 nodes, 1/1 edges')).toBeVisible().catch(() => {
      throw new Error(`Graph did not render: ${browserErrors.join('\n')}`);
    });
    expect(browserErrors.filter((message) => message.includes('[sigma-graph]'))).toEqual([]);

    const cleared = await focusScenarioTarget(request, null);
    expect(cleared.ok()).toBeTruthy();
    expect((await cleared.json()).data.secondaryTargetId).toBeNull();
  });

  test('A → B → Clear → Back remains reachable at Self', async ({ scenarioRequest: request, page }) => {
    const makeTarget = async (id: string) => {
      const response = await request.post('/api/targets', { data: { kind: 'contact', id } });
      expect(response.status()).toBe(200);
      return (await response.json()).data.id as string;
    };
    const a = await makeTarget(fixture.firstContactId);
    const b = await makeTarget(fixture.secondContactId);
    expect((await focusScenarioTarget(request, null)).ok()).toBe(true);
    await page.goto('/network');

    for (const [name, targetId] of [['Scenario Alice', a], ['Scenario Bob', b]] as const) {
      await page.keyboard.press('t');
      const picker = page.getByRole('dialog', { name: 'Target picker' });
      await picker.getByPlaceholder('Search contacts and companies...').fill(name);
      await picker.getByRole('button').filter({ hasText: name }).click();
      await expect.poll(async () => (await (await request.get('/api/targets/state')).json()).data.secondaryTargetId)
        .toBe(targetId);
    }

    const breadcrumbs = page.getByRole('navigation', { name: 'Research target breadcrumbs' });
    await breadcrumbs.getByRole('button', { name: 'Clear secondary target Scenario Bob' }).click();
    await expect.poll(async () => (await (await request.get('/api/targets/state')).json()).data.secondaryTargetId)
      .toBeNull();
    await expect(breadcrumbs.getByRole('button', { name: /Clear secondary target/ })).toHaveCount(0);
    const back = breadcrumbs.getByRole('button', { name: 'Back to prior target' });
    await expect(back).toBeVisible();
    await back.click();
    await expect.poll(async () => (await (await request.get('/api/targets/state')).json()).data.secondaryTargetId)
      .toBe(b);
    await expect(breadcrumbs.getByRole('button', { name: 'Clear secondary target Scenario Bob' })).toBeVisible();
  });

  test('mobile Knowledge tab remains usable with the shared target context', async ({ page, scenarioRequest: request }) => {
    expect((await request.get('/api/targets/state')).ok()).toBe(true);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/network');
    const tab = page.getByRole('tab', { name: 'Knowledge' });
    await tab.scrollIntoViewIfNeeded();
    await tab.click();
    const panel = page.getByRole('tabpanel', { name: 'Knowledge' });
    await expect(panel).toBeVisible();
    expect(await panel.evaluate(element => getComputedStyle(element).overflowY)).toBe('auto');
  });

  // US-5's one-click and 200 ms performance criteria need a representative graph fixture.
});
