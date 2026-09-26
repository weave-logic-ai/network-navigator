import { expect, test } from '@playwright/test';
import { createScenarioFixture, type ScenarioFixture } from './helpers';

test.describe.serial('Research target focus (US-1, US-2, US-5)', () => {
  test.skip(!process.env.E2E_DATABASE_URL, 'Requires a dedicated E2E_DATABASE_URL');
  let fixture: ScenarioFixture;

  test.beforeAll(async ({ request }) => {
    fixture = await createScenarioFixture();
    // A passing scenario must exercise the same dedicated DB the app uses.
    const byName = await request.get('/api/contacts?search=Scenario%20Alice');
    const body = await byName.json();
    if (!byName.ok() || !body.data?.some((row: { id: string }) => row.id === fixture.firstContactId)) {
      throw new Error('App is not connected to E2E_DATABASE_URL');
    }
  });

  test.afterAll(async () => {
    await fixture?.close();
  });

  test('US-1: company secondary keeps self as immutable primary', async ({ request }) => {
    const before = await request.get('/api/targets/state');
    expect(before.ok()).toBeTruthy();
    const primary = (await before.json()).data.primaryTargetId as string;
    expect(primary).toBeTruthy();

    const created = await request.post('/api/targets', {
      data: { kind: 'company', id: fixture.companyId },
    });
    expect(created.status()).toBe(200);
    const companyTargetId = (await created.json()).data.id as string;
    const selected = await request.put('/api/targets/state', {
      data: { secondaryTargetId: companyTargetId },
    });
    expect(selected.ok()).toBeTruthy();
    expect((await selected.json()).data).toMatchObject({
      primaryTargetId: primary,
      secondaryTargetId: companyTargetId,
    });
  });

  // US-1's dated three-source timeline and US-2's comparison remain in the sprint backlog.

  test('US-5: contact secondary re-roots the live graph and can clear', async ({ request, page }) => {
    const browserErrors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') browserErrors.push(message.text());
    });
    const created = await request.post('/api/targets', {
      data: { kind: 'contact', id: fixture.firstContactId },
    });
    expect(created.status()).toBe(200);
    const targetId = (await created.json()).data.id as string;
    const selected = await request.put('/api/targets/state', {
      data: { secondaryTargetId: targetId },
    });
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
    await expect(page.getByText('2/2 nodes, 1 edges')).toBeVisible().catch(() => {
      throw new Error(`Graph did not render: ${browserErrors.join('\n')}`);
    });
    expect(browserErrors.filter((message) => message.includes('[sigma-graph]'))).toEqual([]);

    const cleared = await request.put('/api/targets/state', {
      data: { secondaryTargetId: null },
    });
    expect(cleared.ok()).toBeTruthy();
    expect((await cleared.json()).data.secondaryTargetId).toBeNull();
  });

  // US-5's one-click and 200 ms performance criteria need a representative graph fixture.
});
