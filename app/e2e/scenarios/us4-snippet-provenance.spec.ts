import { createHash, randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { Pool } from 'pg';
import { createScenarioFixture, type ScenarioFixture } from './helpers';

test.describe.serial('US-4 image evidence provenance', () => {
  test.skip(!process.env.E2E_DATABASE_URL, 'Requires a dedicated E2E_DATABASE_URL');

  let fixture: ScenarioFixture;
  let pool: Pool;
  let token: string;
  let extensionId: string;
  let snippetNodeId: string | undefined;
  let targetId: string | undefined;
  let blobId: string | undefined;

  test.beforeAll(async () => {
    fixture = await createScenarioFixture();
    pool = new Pool({ connectionString: process.env.E2E_DATABASE_URL });
    extensionId = randomUUID();
    token = `ext_${randomUUID()}`;
    await pool.query(
      `INSERT INTO extension_tokens (token_hash, extension_id, display_prefix)
       VALUES ($1, $2, $3)`,
      [createHash('sha256').update(token).digest('hex'), extensionId, token.slice(0, 12)]
    );
  });

  test.afterAll(async () => {
    try {
      if (snippetNodeId) await pool.query('DELETE FROM causal_nodes WHERE id = $1', [snippetNodeId]);
      if (targetId) await pool.query(
        `DELETE FROM causal_nodes WHERE entity_type = 'target' AND entity_id = $1`, [targetId]
      );
      if (blobId) await pool.query('DELETE FROM snippet_blobs WHERE id = $1', [blobId]);
      if (extensionId) await pool.query('DELETE FROM extension_tokens WHERE extension_id = $1', [extensionId]);
    } finally {
      await pool?.end();
      await fixture?.close();
    }
  });

  test('an image over 1 MB saves, renders, and links to its target', async ({ request, page }) => {
    const targetResponse = await request.post('/api/targets', {
      data: { kind: 'contact', id: fixture.firstContactId },
    });
    expect(targetResponse.status(), await targetResponse.text()).toBe(200);
    targetId = (await targetResponse.json()).data.id as string;

    const selected = await request.put('/api/targets/state', {
      data: { secondaryTargetId: targetId },
    });
    expect(selected.ok()).toBe(true);

    // A valid tiny PNG plus trailing bytes exercises the database's 5 MB
    // constraint without relying on a remote image or fixture download.
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=',
      'base64'
    );
    const image = Buffer.concat([png, Buffer.alloc(1_100_000 - png.length)]);
    const saved = await request.post('/api/extension/snippet', {
      headers: { 'x-extension-token': token },
      data: {
        kind: 'image', targetKind: 'contact', targetId,
        imageBytes: image.toString('base64'), mimeType: 'image/png',
        sourceUrl: 'https://www.sec.gov/Archives/fixture-10k',
        pageType: 'DOCUMENT', tagSlugs: [], note: 'Scenario evidence',
      },
    });
    expect(saved.status(), await saved.text()).toBe(200);
    const result = await saved.json() as { causalNodeId: string; blobId: string; success: boolean };
    expect(result.success).toBe(true);
    snippetNodeId = result.causalNodeId;
    blobId = result.blobId;

    const evidence = await pool.query<{ relation: string; target_entity_id: string }>(
      `SELECT ce.relation, target.entity_id AS target_entity_id
       FROM causal_edges ce
       JOIN causal_nodes target ON target.id = ce.target_node_id
       WHERE ce.source_node_id = $1`, [snippetNodeId]
    );
    expect(evidence.rows).toEqual(expect.arrayContaining([
      { relation: 'evidence_for', target_entity_id: targetId },
    ]));
    const stored = await pool.query<{ byte_length: number }>(
      'SELECT byte_length FROM snippet_blobs WHERE id = $1', [blobId]
    );
    expect(stored.rows[0].byte_length).toBe(image.length);

    const served = await request.get(`/api/snippets/blob/${blobId}`);
    expect(served.status()).toBe(200);
    expect((await served.body()).length).toBe(image.length);
    await page.goto('/snippets');
    await expect(page.getByTestId('snippet-image-link')).toBeVisible();
  });
});
