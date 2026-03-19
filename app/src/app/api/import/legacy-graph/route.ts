// POST /api/import/legacy-graph
// Import data from the old .linkedin-prospector/data/graph.json into the v2 DB.
// Imports: contacts, companies, edges, clusters, cluster_memberships,
//          graph_metrics, content_profiles, behavioral_observations,
//          and pre-computed scores.

import { NextRequest, NextResponse } from 'next/server';
import { readFile, stat } from 'fs/promises';
import { resolve } from 'path';
import { getPool } from '@/lib/db/client';
import { triggerBatchAutoScore } from '@/lib/scoring/auto-score';
import type { PoolClient } from 'pg';

// Allowed paths
const ALLOWED_PREFIXES = ['/home/aepod/dev/ctox/', '/data/'];

function isPathAllowed(filePath: string): boolean {
  const resolved = resolve(filePath);
  if (filePath.includes('..')) return false;
  return ALLOWED_PREFIXES.some((prefix) => resolved.startsWith(prefix));
}

// ── Types for the legacy graph.json ─────────────────────────────────────────

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
  // Scoring
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
  // Activity
  activity?: {
    lastScanned?: string;
    posts?: Array<{ date?: string; text?: string; engagement?: number }>;
    engagementRate?: number;
    postFrequency?: string;
    topics?: string[];
  };
  accountPenetration?: Record<string, unknown>;
  icpCategories?: string[];
  // Deep scan
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

function parseName(raw: string): { firstName: string; lastName: string; fullName: string } {
  const fullName = raw.trim();
  const parts = fullName.split(/\s+/);
  return {
    firstName: parts[0] || '',
    lastName: parts.slice(1).join(' ') || '',
    fullName,
  };
}

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

async function importContacts(
  client: PoolClient,
  contacts: Record<string, LegacyContact>,
  companyMap: Map<string, string>
): Promise<{ urlToUuid: Map<string, string>; importedIds: string[] }> {
  const urlToUuid = new Map<string, string>();
  const importedIds: string[] = [];

  for (const [url, contact] of Object.entries(contacts)) {
    const displayName = contact.enrichedName || contact.name || '';
    const { firstName, lastName, fullName } = parseName(displayName);
    const companyUuid = contact.companyId ? companyMap.get(contact.companyId) : null;

    const result = await client.query(
      `INSERT INTO contacts (
        linkedin_url, first_name, last_name, full_name,
        headline, title, current_company, current_company_id,
        location, about, connections_count, degree,
        discovered_via, tags, is_archived
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
      ON CONFLICT (linkedin_url) DO UPDATE SET
        full_name = COALESCE(NULLIF(EXCLUDED.full_name,''), contacts.full_name),
        first_name = COALESCE(NULLIF(EXCLUDED.first_name,''), contacts.first_name),
        last_name = COALESCE(NULLIF(EXCLUDED.last_name,''), contacts.last_name),
        headline = COALESCE(NULLIF(EXCLUDED.headline,''), contacts.headline),
        title = COALESCE(NULLIF(EXCLUDED.title,''), contacts.title),
        current_company = COALESCE(NULLIF(EXCLUDED.current_company,''), contacts.current_company),
        current_company_id = COALESCE(EXCLUDED.current_company_id, contacts.current_company_id),
        location = COALESCE(NULLIF(EXCLUDED.location,''), contacts.location),
        about = COALESCE(NULLIF(EXCLUDED.about,''), contacts.about),
        connections_count = COALESCE(EXCLUDED.connections_count, contacts.connections_count),
        degree = EXCLUDED.degree,
        discovered_via = EXCLUDED.discovered_via,
        tags = EXCLUDED.tags
      RETURNING id`,
      [
        url,
        firstName,
        lastName,
        fullName,
        contact.headline || contact.currentRole || null,
        contact.title || contact.currentRole || null,
        contact.currentCompany || null,
        companyUuid || null,
        contact.enrichedLocation || contact.location || null,
        contact.about || null,
        contact.mutualConnections || null,
        contact.degree || 1,
        contact.discoveredVia || [],
        contact.tags || [],
        false,
      ]
    );

    const contactId = result.rows[0].id;
    urlToUuid.set(url, contactId);
    importedIds.push(contactId);
  }

  return { urlToUuid, importedIds };
}

async function importEdges(
  client: PoolClient,
  edges: LegacyEdge[],
  urlToUuid: Map<string, string>
): Promise<number> {
  let imported = 0;

  // Batch insert for performance
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

    // Add members
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

    // Update member count
    await client.query(
      `UPDATE clusters SET member_count = (
        SELECT COUNT(*) FROM cluster_memberships WHERE cluster_id = $1
       ) WHERE id = $1`,
      [clusterId]
    );
  }

  return memberships;
}

async function importScoresAndBehavioral(
  client: PoolClient,
  contacts: Record<string, LegacyContact>,
  urlToUuid: Map<string, string>
): Promise<{ scores: number; behavioral: number; graphMetrics: number }> {
  let scoreCount = 0;
  let behavioralCount = 0;
  let graphMetricsCount = 0;

  for (const [url, contact] of Object.entries(contacts)) {
    const contactId = urlToUuid.get(url);
    if (!contactId) continue;

    // Import pre-computed scores
    if (contact.scores && contact.scores.goldScore != null) {
      const s = contact.scores;
      await client.query(
        `INSERT INTO contact_scores (
          contact_id, composite_score, tier, persona, behavioral_persona,
          scoring_version, scored_at,
          referral_likelihood, referral_tier, referral_persona,
          behavioral_signals, referral_signals
        ) VALUES ($1,$2,$3,$4,$5,$6,NOW(),$7,$8,$9,$10,$11)
        ON CONFLICT (contact_id) DO UPDATE SET
          composite_score = EXCLUDED.composite_score,
          tier = EXCLUDED.tier,
          persona = EXCLUDED.persona,
          behavioral_persona = EXCLUDED.behavioral_persona,
          scoring_version = EXCLUDED.scoring_version,
          scored_at = NOW(),
          referral_likelihood = EXCLUDED.referral_likelihood,
          referral_tier = EXCLUDED.referral_tier,
          referral_persona = EXCLUDED.referral_persona,
          behavioral_signals = EXCLUDED.behavioral_signals,
          referral_signals = EXCLUDED.referral_signals
        RETURNING id`,
        [
          contactId,
          s.goldScore,
          s.tier || 'watch',
          contact.personaType || null,
          contact.behavioralPersona || null,
          0, // version 0 = legacy import
          contact.referralSignals
            ? (contact.referralSignals as Record<string, unknown>).referralLikelihood ?? null
            : null,
          contact.referralTier || null,
          contact.referralPersona || null,
          contact.behavioralSignals ? JSON.stringify(contact.behavioralSignals) : null,
          contact.referralSignals ? JSON.stringify(contact.referralSignals) : null,
        ]
      );

      const scoreRow = await client.query(
        `SELECT id FROM contact_scores WHERE contact_id = $1`,
        [contactId]
      );
      const scoreId = scoreRow.rows[0]?.id;

      // Insert dimension breakdown
      if (scoreId) {
        const dims = [
          { dim: 'icp_fit', val: s.icpFit },
          { dim: 'network_hub', val: s.networkHub },
          { dim: 'relationship_strength', val: s.relationshipStrength },
          { dim: 'signal_boost', val: s.signalBoost },
          { dim: 'skills_relevance', val: s.skillsRelevance },
          { dim: 'network_proximity', val: s.networkProximity },
        ];

        await client.query(
          `DELETE FROM score_dimensions WHERE contact_score_id = $1`,
          [scoreId]
        );

        for (const { dim, val } of dims) {
          if (val == null) continue;
          await client.query(
            `INSERT INTO score_dimensions (contact_score_id, dimension, raw_value, weighted_value, weight)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (contact_score_id, dimension) DO NOTHING`,
            [scoreId, dim, val, val * 0.15, 0.15] // approximate weights
          );
        }

        // Import referral dimensions if present
        if (contact.referralSignals) {
          const rs = contact.referralSignals as Record<string, unknown>;
          const refDims = [
            { comp: 'referralRole', val: rs.referralRole },
            { comp: 'clientOverlap', val: rs.clientOverlap },
            { comp: 'networkReach', val: rs.networkReach },
            { comp: 'amplificationPower', val: rs.amplificationPower },
            { comp: 'relationshipWarmth', val: rs.relationshipWarmth },
            { comp: 'buyerInversion', val: rs.buyerInversion },
          ];

          await client.query(
            `DELETE FROM referral_dimensions WHERE contact_score_id = $1`,
            [scoreId]
          );

          for (const { comp, val } of refDims) {
            if (val == null || typeof val !== 'number') continue;
            await client.query(
              `INSERT INTO referral_dimensions (contact_score_id, component, raw_value, weighted_value, weight)
               VALUES ($1, $2, $3, $4, $5)
               ON CONFLICT (contact_score_id, component) DO NOTHING`,
              [scoreId, comp, val, val * 0.167, 0.167]
            );
          }
        }
      }

      scoreCount++;
    }

    // Import content profiles from activity data
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

      // Import posts as behavioral observations
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

    // Import graph metrics (compute approximate values from edge/mutual data)
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

  return { scores: scoreCount, behavioral: behavioralCount, graphMetrics: graphMetricsCount };
}

// ── Route handler ───────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  let client: PoolClient | null = null;

  try {
    const body = await request.json();
    const {
      graphPath,
      rescore = false,
    } = body as {
      graphPath?: string;
      rescore?: boolean;
    };

    // Default path
    const filePath = graphPath || '.linkedin-prospector/data/graph.json';
    let resolvedPath = filePath;

    // Resolve relative paths
    if (!filePath.startsWith('/')) {
      resolvedPath = resolve('/home/aepod/dev/ctox', filePath);
    }

    if (!isPathAllowed(resolvedPath)) {
      return NextResponse.json(
        { error: 'Path not allowed', details: 'Must be under project root or /data/' },
        { status: 403 }
      );
    }

    // Verify file exists
    try {
      await stat(resolvedPath);
    } catch {
      return NextResponse.json(
        { error: 'File not found', details: resolvedPath },
        { status: 404 }
      );
    }

    // Read and parse graph.json
    const raw = await readFile(resolvedPath, 'utf-8');
    const graph: LegacyGraph = JSON.parse(raw);

    const contactCount = Object.keys(graph.contacts || {}).length;
    const companyCount = Object.keys(graph.companies || {}).length;
    const edgeCount = (graph.edges || []).length;
    const clusterCount = Object.keys(graph.clusters || {}).length;

    // Run import in a transaction
    const pool = getPool();
    client = await pool.connect();
    await client.query('BEGIN');

    // 1. Companies
    const companyMap = await importCompanies(client, graph.companies || {});

    // 2. Contacts
    const { urlToUuid, importedIds } = await importContacts(
      client,
      graph.contacts || {},
      companyMap
    );

    // 3. Edges (can be large — 156K)
    const edgesImported = await importEdges(client, graph.edges || [], urlToUuid);

    // 4. Clusters + memberships
    const membershipCount = await importClusters(client, graph.clusters || {}, urlToUuid);

    // 5. Scores, behavioral, graph metrics
    const sbg = await importScoresAndBehavioral(client, graph.contacts || {}, urlToUuid);

    await client.query('COMMIT');

    // 6. Optionally trigger rescore
    if (rescore && importedIds.length > 0) {
      triggerBatchAutoScore(importedIds);
    }

    return NextResponse.json({
      success: true,
      imported: {
        contacts: importedIds.length,
        companies: companyMap.size,
        edges: edgesImported,
        clusters: clusterCount,
        clusterMemberships: membershipCount,
        scores: sbg.scores,
        behavioral: sbg.behavioral,
        graphMetrics: sbg.graphMetrics,
      },
      source: {
        contacts: contactCount,
        companies: companyCount,
        edges: edgeCount,
        clusters: clusterCount,
      },
      rescoreTriggered: rescore,
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
