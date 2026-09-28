import { renderToStaticMarkup } from '../../app/node_modules/react-dom/server';
import { getPool, shutdown } from '@/lib/db/client';
import SnippetsPage from '@/app/(app)/snippets/page';
import { RESEARCH_FLAGS } from '@/lib/config/research-flags';

const run = process.env.CAS_TEST_DATABASE_URL ? describe : describe.skip;
const pool = getPool();
const tenant = '50000000-0000-4000-8000-000000000001';
const currentOwner = '50000000-0000-4000-8000-000000000002';
const foreignOwner = '50000000-0000-4000-8000-000000000003';
const ownSelf = '50000000-0000-4000-8000-000000000004';
const foreignSelf = '50000000-0000-4000-8000-000000000005';
const ownTargetNode = '50000000-0000-4000-8000-000000000006';
const foreignTargetNode = '50000000-0000-4000-8000-000000000007';
const ownSnippetNode = '50000000-0000-4000-8000-000000000008';
const foreignSnippetNode = '50000000-0000-4000-8000-000000000009';

run('snippets page owner scope against disposable Postgres', () => {
  const originalFlag = RESEARCH_FLAGS.snippets;

  beforeAll(async () => {
    if (new URL(process.env.DATABASE_URL ?? '').pathname !== '/cas_test') {
      throw new Error('Snippets page test requires the dedicated cas_test database');
    }
    RESEARCH_FLAGS.snippets = true;
    await pool.query(`DROP TABLE IF EXISTS causal_edges, causal_nodes,
      research_target_state, research_targets, owner_profiles, tenants CASCADE`);
    await pool.query(`
      CREATE TABLE tenants (id uuid PRIMARY KEY, slug text NOT NULL);
      CREATE TABLE owner_profiles (id uuid PRIMARY KEY, is_current boolean NOT NULL,
        first_name text, last_name text);
      CREATE TABLE research_targets (id uuid PRIMARY KEY, tenant_id uuid NOT NULL,
        kind text NOT NULL, owner_id uuid, contact_id uuid, company_id uuid,
        label text NOT NULL, pinned boolean DEFAULT false,
        created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(),
        last_used_at timestamptz DEFAULT now());
      CREATE TABLE research_target_state (tenant_id uuid NOT NULL, user_id uuid NOT NULL,
        primary_target_id uuid, secondary_target_id uuid, last_used_lens_id uuid,
        history jsonb NOT NULL DEFAULT '[]', revision bigint NOT NULL DEFAULT 0,
        updated_at timestamptz DEFAULT now(), PRIMARY KEY (tenant_id, user_id));
      CREATE TABLE causal_nodes (id uuid PRIMARY KEY, tenant_id uuid NOT NULL,
        entity_type text NOT NULL, entity_id uuid NOT NULL, operation text,
        inputs jsonb DEFAULT '{}', output jsonb DEFAULT '{}',
        created_at timestamptz DEFAULT now());
      CREATE TABLE causal_edges (source_node_id uuid NOT NULL,
        target_node_id uuid NOT NULL, relation text NOT NULL);
    `);
    await pool.query(`INSERT INTO tenants VALUES ($1, 'default')`, [tenant]);
    await pool.query(`INSERT INTO owner_profiles VALUES
      ($1, true, 'Current', 'Owner'), ($2, false, 'Foreign', 'Owner')`,
      [currentOwner, foreignOwner]);
    // The foreign rows go in first so the old tenant-only LIMIT 1 and first-self
    // fallback would select the wrong owner even without the corrupt pointer.
    await pool.query(`INSERT INTO research_targets
      (id, tenant_id, kind, owner_id, label) VALUES
      ($1, $3, 'self', $4, 'Foreign private target'),
      ($2, $3, 'self', $5, 'Current owner target')`,
      [foreignSelf, ownSelf, tenant, foreignOwner, currentOwner]);
    await pool.query(`INSERT INTO research_target_state
      (tenant_id, user_id, primary_target_id, secondary_target_id, revision) VALUES
      ($1, $2, $3, NULL, 0), ($1, $4, $3, $3, 4)`,
      [tenant, foreignOwner, foreignSelf, currentOwner]);
    await pool.query(`INSERT INTO causal_nodes
      (id, tenant_id, entity_type, entity_id, operation, inputs, output) VALUES
      ($1, $5, 'target', $6, NULL, '{}', '{}'),
      ($2, $5, 'target', $7, NULL, '{}', '{}'),
      ($3, $5, 'snippet', $8, 'captured', '{"sourceUrl":"https://example.com/own"}',
       '{"content":{"kind":"text","text":"current-owner-only-evidence"}}'),
      ($4, $5, 'snippet', $9, 'captured', '{"sourceUrl":"https://example.com/foreign"}',
       '{"content":{"kind":"text","text":"foreign-owner-only-evidence"}}')`,
      [ownTargetNode, foreignTargetNode, ownSnippetNode, foreignSnippetNode,
        tenant, ownSelf, foreignSelf,
        '50000000-0000-4000-8000-000000000010',
        '50000000-0000-4000-8000-000000000011']);
    await pool.query(`INSERT INTO causal_edges VALUES
      ($1, $3, 'evidence_for'), ($2, $4, 'evidence_for')`,
      [ownSnippetNode, foreignSnippetNode, ownTargetNode, foreignTargetNode]);
  });

  afterAll(async () => {
    RESEARCH_FLAGS.snippets = originalFlag;
    await pool.query(`DROP TABLE IF EXISTS causal_edges, causal_nodes,
      research_target_state, research_targets, owner_profiles, tenants CASCADE`);
    await shutdown();
  });

  it('renders only the current owner target and its snippet after repairing a foreign pointer', async () => {
    const html = renderToStaticMarkup(await SnippetsPage({ searchParams: Promise.resolve({}) }));
    expect(html).toContain('Current owner target');
    expect(html).toContain('current-owner-only-evidence');
    expect(html).not.toContain('Foreign private target');
    expect(html).not.toContain('foreign-owner-only-evidence');
    const state = await pool.query(`SELECT primary_target_id, secondary_target_id,
      last_used_lens_id, revision FROM research_target_state
      WHERE tenant_id = $1 AND user_id = $2`, [tenant, currentOwner]);
    expect(state.rows[0]).toMatchObject({ primary_target_id: ownSelf,
      secondary_target_id: null, last_used_lens_id: null, revision: '5' });
  });

  it('follows the current owner and renders no tenant fallback without one', async () => {
    await pool.query(`UPDATE owner_profiles SET is_current = (id = $1)`, [foreignOwner]);
    const foreignHtml = renderToStaticMarkup(await SnippetsPage({ searchParams: Promise.resolve({}) }));
    expect(foreignHtml).toContain('Foreign private target');
    expect(foreignHtml).toContain('foreign-owner-only-evidence');
    expect(foreignHtml).not.toContain('current-owner-only-evidence');

    await pool.query(`UPDATE owner_profiles SET is_current = false`);
    const emptyHtml = renderToStaticMarkup(await SnippetsPage({ searchParams: Promise.resolve({}) }));
    expect(emptyHtml).toContain('No active research target yet');
    expect(emptyHtml).not.toContain('Foreign private target');
    expect(emptyHtml).not.toContain('foreign-owner-only-evidence');
  });
});
