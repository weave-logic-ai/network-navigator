// Import legacy graph source data; its pre-computed scores are unverified.

import { NextRequest, NextResponse } from 'next/server';
import { readFile, stat } from 'fs/promises';
import { resolve } from 'path';
import { getPool } from '@/lib/db/client';
import { createLegacyImportScoreJob, drainPendingImportScoreJobs } from '@/lib/scoring/import-job';
import type { PoolClient } from 'pg';
import { importLegacyContacts } from '@/lib/import/legacy-contacts';

const ALLOWED_PREFIXES = ['/home/aepod/dev/ctox/', '/data/'];

function isPathAllowed(filePath: string): boolean {
  const resolved = resolve(filePath);
  if (filePath.includes('..')) return false;
  return ALLOWED_PREFIXES.some((prefix) => resolved.startsWith(prefix));
}

interface LegacyContact {
  profileUrl: string;
  name: string;
  enrichedName?: string;
  headline?: string;
  title?: string;
  currentCompany?: string;
  currentRole?: string;
  location?: string;
  enrichedLocation?: string;
  about?: string;
  degree: number;
  mutualConnections?: number;
  tags?: string[];
  searchTerms?: string[];
  source?: string;
  discoveredVia?: string[];
  enriched?: boolean;
  companyId?: string;
  cachedAt?: string;
  deepScanned?: boolean;
  deepScannedAt?: string;
  scores?: {
    icpFit?: number;
    networkHub?: number;
    relationshipStrength?: number;
    signalBoost?: number;
    skillsRelevance?: number | null;
    networkProximity?: number | null;
    goldScore?: number;
    tier?: string;
  };
  personaType?: string;
  behavioralScore?: number;
  behavioralPersona?: string;
  behavioralSignals?: Record<string, unknown>;
  referralTier?: string;
  referralPersona?: string;
  referralSignals?: Record<string, unknown>;
  activity?: {
    lastScanned?: string;
    posts?: Array<{ date?: string; text?: string; engagement?: number }>;
    engagementRate?: number;
    postFrequency?: string;
    topics?: string[];
  };
  accountPenetration?: Record<string, unknown>;
  icpCategories?: string[];
  deepScanResults?: number;
  currentInfo?: string;
  pastInfo?: string;
}

interface LegacyCompany {
  name: string;
  contacts: string[];
  penetrationScore?: number;
  seniorityLevels?: Record<string, number>;
  goldContacts?: number;
  silverContacts?: number;
  avgGoldScore?: number;
}

interface LegacyCluster {
  label: string;
  keywords?: string[];
  contacts: string[];
  hubContacts?: string[];
}

interface LegacyEdge {
  source: string;
  target: string;
  type: string;
  weight?: number;
}

interface LegacyGraph {
  contacts: Record<string, LegacyContact>;
  companies: Record<string, LegacyCompany>;
  clusters: Record<string, LegacyCluster>;
  edges: LegacyEdge[];
  meta?: Record<string, unknown>;
}

// ── Import logic ────────────────────────────────────────────────────────────

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

async function importCompanies(
  client: PoolClient,
  companies: Record<string, LegacyCompany>
): Promise<Map<string, string>> {
  const slugToUuid = new Map<string, string>();

  for (const [slug, company] of Object.entries(companies)) {
    const result = await client.query(
      `INSERT INTO companies (name, slug, industry)
       VALUES ($1, $2, $3)
       ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
       RETURNING id`,
      [company.name, slugify(slug) || slugify(company.name), null]
    );
    slugToUuid.set(slug, result.rows[0].id);
  }

  return slugToUuid;
}

async function importEdges(
  client: PoolClient,
  edges: LegacyEdge[],
  urlToUuid: Map<string, string>
): Promise<number> {
  let imported = 0;

  const BATCH_SIZE = 500;
  for (let i = 0; i < edges.length; i += BATCH_SIZE) {
    const batch = edges.slice(i, i + BATCH_SIZE);
    const values: string[] = [];
    const params: unknown[] = [];
    let paramIdx = 1;

    for (const edge of batch) {
      const sourceId = urlToUuid.get(edge.source);
      const targetId = urlToUuid.get(edge.target);
      if (!sourceId || !targetId) continue;

      values.push(`($${paramIdx},$${paramIdx + 1},$${paramIdx + 2},$${paramIdx + 3})`);
      params.push(sourceId, targetId, edge.type || 'mutual', edge.weight ?? 1.0);
      paramIdx += 4;
    }

    if (values.length > 0) {
      await client.query(
        `INSERT INTO edges (source_contact_id, target_contact_id, edge_type, weight)
         VALUES ${values.join(',')}
         ON CONFLICT DO NOTHING`,
        params
      );
      imported += values.length;
    }
  }

  return imported;
}

async function importClusters(
  client: PoolClient,
  clusters: Record<string, LegacyCluster>,
  urlToUuid: Map<string, string>
): Promise<number> {
  let memberships = 0;

  for (const [label, cluster] of Object.entries(clusters)) {
    const clusterResult = await client.query(
      `INSERT INTO clusters (label, description, algorithm, metadata)
       VALUES ($1, $2, 'legacy-import', $3)
       ON CONFLICT DO NOTHING
       RETURNING id`,
      [
        cluster.label || label,
        `Imported from legacy graph. Keywords: ${(cluster.keywords || []).join(', ')}`,
        JSON.stringify({
          keywords: cluster.keywords || [],
          hubContacts: (cluster.hubContacts || []).length,
        }),
      ]
    );

    if (clusterResult.rows.length === 0) continue;
    const clusterId = clusterResult.rows[0].id;

    for (const contactUrl of cluster.contacts || []) {
      const contactId = urlToUuid.get(contactUrl);
      if (!contactId) continue;

      await client.query(
        `INSERT INTO cluster_memberships (contact_id, cluster_id, membership_score)
         VALUES ($1, $2, $3)
         ON CONFLICT (contact_id, cluster_id) DO NOTHING`,
        [contactId, clusterId, cluster.hubContacts?.includes(contactUrl) ? 1.5 : 1.0]
      );
      memberships++;
    }

    await client.query(
      `UPDATE clusters SET member_count = (
        SELECT COUNT(*) FROM cluster_memberships WHERE cluster_id = $1
       ) WHERE id = $1`,
      [clusterId]
    );
  }

  return memberships;
}

async function importSignalsAndBehavioral(
  client: PoolClient,
  contacts: Record<string, LegacyContact>,
  urlToUuid: Map<string, string>
): Promise<{ legacyScoresIgnored: number; behavioral: number; graphMetrics: number }> {
  let legacyScoresIgnored = 0;
  let behavioralCount = 0;
  let graphMetricsCount = 0;

  for (const [url, contact] of Object.entries(contacts)) {
    const contactId = urlToUuid.get(url);
    if (!contactId) continue;

    // Legacy scores have no owner-basis provenance. Only the owner scoring
    // pipeline may write contact_scores and its dependent dimensions.
    if (contact.scores && contact.scores.goldScore != null) {
      legacyScoresIgnored++;
    }

    if (contact.activity) {
      const act = contact.activity;
      await client.query(
        `INSERT INTO content_profiles (contact_id, topics, posting_frequency, avg_engagement)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (contact_id) DO UPDATE SET
           topics = EXCLUDED.topics,
           posting_frequency = EXCLUDED.posting_frequency,
           avg_engagement = EXCLUDED.avg_engagement,
           last_analyzed_at = NOW()`,
        [
          contactId,
          act.topics || [],
          act.postFrequency || null,
          act.engagementRate || null,
        ]
      );

      if (act.posts && act.posts.length > 0) {
        for (const post of act.posts.slice(0, 20)) { // cap at 20 per contact
          await client.query(
            `INSERT INTO behavioral_observations (contact_id, observation_type, content, observed_at, source, metadata)
             VALUES ($1, 'post', $2, $3, 'legacy-import', $4)`,
            [
              contactId,
              post.text || '',
              post.date ? new Date(post.date) : new Date(),
              JSON.stringify({ engagement: post.engagement }),
            ]
          );
        }
        behavioralCount++;
      }
    }

    if (contact.mutualConnections || contact.scores?.networkHub) {
      await client.query(
        `INSERT INTO graph_metrics (contact_id, degree_centrality, pagerank, betweenness_centrality)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (contact_id) DO UPDATE SET
           degree_centrality = EXCLUDED.degree_centrality,
           pagerank = EXCLUDED.pagerank,
           betweenness_centrality = EXCLUDED.betweenness_centrality,
           computed_at = NOW()`,
        [
          contactId,
          contact.mutualConnections || 0,
          contact.scores?.networkHub ? contact.scores.networkHub * 0.01 : null,
          null, // Will be recomputed during rescore
        ]
      );
      graphMetricsCount++;
    }
  }

  return { legacyScoresIgnored, behavioral: behavioralCount, graphMetrics: graphMetricsCount };
}

export async function POST(request: NextRequest) {
  let client: PoolClient | null = null;

  try {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid import request JSON' }, { status: 400 });
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ error: 'Invalid import request' }, { status: 400 });
    }
    const {
      graphPath,
      rescore = false,
    } = body as {
      graphPath?: string;
      rescore?: boolean;
    };
    if ((graphPath !== undefined && (typeof graphPath !== 'string' || !graphPath.trim())) ||
        typeof rescore !== 'boolean') {
      return NextResponse.json({ error: 'Invalid import request' }, { status: 400 });
    }

    const filePath = graphPath || '.linkedin-prospector/data/graph.json';
    let resolvedPath = filePath;

    if (!filePath.startsWith('/')) {
      resolvedPath = resolve('/home/aepod/dev/ctox', filePath);
    }

    if (!isPathAllowed(resolvedPath)) {
      return NextResponse.json(
        { error: 'Path not allowed', details: 'Must be under project root or /data/' },
        { status: 403 }
      );
    }

    try {
      await stat(resolvedPath);
    } catch {
      return NextResponse.json(
        { error: 'File not found', details: resolvedPath },
        { status: 404 }
      );
    }

    const raw = await readFile(resolvedPath, 'utf-8');
    const graph: LegacyGraph = JSON.parse(raw);
    if (!graph || typeof graph !== 'object' || !graph.contacts ||
        typeof graph.contacts !== 'object' || Array.isArray(graph.contacts)) {
      return NextResponse.json({ error: 'Invalid legacy graph' }, { status: 400 });
    }

    const contactCount = Object.keys(graph.contacts || {}).length;
    const companyCount = Object.keys(graph.companies || {}).length;
    const edgeCount = (graph.edges || []).length;
    const clusterCount = Object.keys(graph.clusters || {}).length;

    const pool = getPool();
    client = await pool.connect();
    await client.query('BEGIN');

    // 1. Companies
    const companyMap = await importCompanies(client, graph.companies || {});

    // 2. Contacts
    const { urlToUuid, importedIds } = await importLegacyContacts(
      client,
      graph.contacts || {},
      companyMap
    );

    // 3. Edges (can be large — 156K)
    const edgesImported = await importEdges(client, graph.edges || [], urlToUuid);

    // 4. Clusters + memberships
    const membershipCount = await importClusters(client, graph.clusters || {}, urlToUuid);

    // 5. Source signals and graph metrics only; never persist legacy scores.
    const sbg = await importSignalsAndBehavioral(client, graph.contacts || {}, urlToUuid);

    const scoreJobId = rescore ? await createLegacyImportScoreJob(client, importedIds) : null;
    await client.query('COMMIT');
    if (scoreJobId) {
      void drainPendingImportScoreJobs(1, 25).catch(error => {
        console.error('[legacy-import] Score job will resume on recovery sweep', { scoreJobId, error });
      });
    }

    return NextResponse.json({
      success: true,
      imported: {
        contacts: importedIds.length,
        companies: companyMap.size,
        edges: edgesImported,
        clusters: clusterCount,
        clusterMemberships: membershipCount,
        scores: 0,
        legacyScoresIgnored: sbg.legacyScoresIgnored,
        behavioral: sbg.behavioral,
        graphMetrics: sbg.graphMetrics,
      },
      source: {
        contacts: contactCount,
        companies: companyCount,
        edges: edgeCount,
        clusters: clusterCount,
      },
      rescoreTriggered: scoreJobId !== null,
      rescoreJobId: scoreJobId,
    });
  } catch (error) {
    if (client) {
      await client.query('ROLLBACK').catch(() => {});
    }
    console.error('[legacy-import] Error:', error);
    return NextResponse.json(
      {
        error: 'Legacy import failed',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  } finally {
    if (client) {
      client.release();
    }
  }
}
