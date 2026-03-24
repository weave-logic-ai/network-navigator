// Scoring engine DB queries

import { query, transaction } from '../client';
import {
  WeightProfile,
  ContactScoringData,
  CompositeScore,
  IcpProfile,
  IcpCriteria,
  ScoringRunStatus,
} from '../../scoring/types';

// Weight profiles

export async function getDefaultWeightProfile(): Promise<WeightProfile | null> {
  const result = await query<{
    id: string; name: string; description: string | null;
    weights: Record<string, number>; is_default: boolean;
    created_at: Date; updated_at: Date;
  }>(
    'SELECT * FROM scoring_weight_profiles WHERE is_default = TRUE LIMIT 1'
  );
  return result.rows[0] ? mapWeightProfile(result.rows[0]) : null;
}

export async function getWeightProfileByName(name: string): Promise<WeightProfile | null> {
  const result = await query<{
    id: string; name: string; description: string | null;
    weights: Record<string, number>; is_default: boolean;
    created_at: Date; updated_at: Date;
  }>(
    'SELECT * FROM scoring_weight_profiles WHERE name = $1 LIMIT 1',
    [name]
  );
  return result.rows[0] ? mapWeightProfile(result.rows[0]) : null;
}

export async function listWeightProfiles(): Promise<WeightProfile[]> {
  const result = await query<{
    id: string; name: string; description: string | null;
    weights: Record<string, number>; is_default: boolean;
    created_at: Date; updated_at: Date;
  }>('SELECT * FROM scoring_weight_profiles ORDER BY is_default DESC, name');
  return result.rows.map(mapWeightProfile);
}

export async function upsertWeightProfile(
  name: string,
  weights: Record<string, number>,
  description?: string,
  isDefault?: boolean
): Promise<WeightProfile> {
  const result = await query<{
    id: string; name: string; description: string | null;
    weights: Record<string, number>; is_default: boolean;
    created_at: Date; updated_at: Date;
  }>(
    `INSERT INTO scoring_weight_profiles (name, weights, description, is_default)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (name) DO UPDATE SET weights = $2, description = COALESCE($3, scoring_weight_profiles.description), is_default = COALESCE($4, scoring_weight_profiles.is_default)
     RETURNING *`,
    [name, JSON.stringify(weights), description ?? null, isDefault ?? false]
  );
  return mapWeightProfile(result.rows[0]);
}

// Contact scoring data (aggregated view for scoring)

export async function getContactScoringData(contactId: string): Promise<ContactScoringData | null> {
  const result = await query<{
    id: string; degree: number; title: string | null; headline: string | null;
    about: string | null; current_company: string | null;
    connections_count: number | null; tags: string[]; location: string | null;
    company_industry: string | null; company_size_range: string | null;
    mutual_count: string; edge_count: string;
    pagerank: number | null; betweenness_centrality: number | null;
    degree_centrality: number | null;
    observation_count: string; content_topics: string[] | null;
    posting_frequency: string | null; avg_engagement: number | null;
    connected_at: string | null;  // approximated from created_at
    connection_count_raw: string | null;  // same as connections_count
    discovered_via: string[] | null;
    cluster_ids: string[] | null;
  }>(
    `SELECT
      c.id, c.degree, c.title, c.headline, c.about,
      c.current_company, c.connections_count, c.tags, c.location,
      co.industry AS company_industry, co.size_range AS company_size_range,
      COALESCE((SELECT COUNT(*) FROM edges e WHERE e.source_contact_id = c.id AND e.target_contact_id IS NOT NULL AND e.edge_type = 'mutual'), 0)::text AS mutual_count,
      COALESCE((SELECT COUNT(*) FROM edges e WHERE e.source_contact_id = c.id OR e.target_contact_id = c.id), 0)::text AS edge_count,
      gm.pagerank, gm.betweenness_centrality, gm.degree_centrality,
      COALESCE((SELECT COUNT(*) FROM behavioral_observations bo WHERE bo.contact_id = c.id), 0)::text AS observation_count,
      cp.topics AS content_topics,
      cp.posting_frequency, cp.avg_engagement,
      c.created_at::text AS connected_at,
      c.connections_count::text AS connection_count_raw,
      COALESCE(
        (SELECT array_agg(DISTINCT e2.source_contact_id::text)
         FROM edges e2 WHERE e2.target_contact_id = c.id AND e2.edge_type = 'discovered_via'),
        ARRAY[]::text[]
      ) AS discovered_via,
      COALESCE(
        (SELECT array_agg(DISTINCT cm.cluster_id::text)
         FROM cluster_memberships cm WHERE cm.contact_id = c.id),
        ARRAY[]::text[]
      ) AS cluster_ids
    FROM contacts c
    LEFT JOIN companies co ON c.current_company_id = co.id
    LEFT JOIN graph_metrics gm ON gm.contact_id = c.id
    LEFT JOIN content_profiles cp ON cp.contact_id = c.id
    WHERE c.id = $1 AND c.is_archived = FALSE`,
    [contactId]
  );

  if (result.rows.length === 0) return null;

  const row = result.rows[0];
  return {
    id: row.id,
    degree: row.degree,
    title: row.title,
    headline: row.headline,
    about: row.about,
    currentCompany: row.current_company,
    connectionsCount: row.connections_count,
    tags: row.tags || [],
    location: row.location,
    companyIndustry: row.company_industry,
    companySizeRange: row.company_size_range,
    mutualConnectionCount: parseInt(row.mutual_count, 10),
    edgeCount: parseInt(row.edge_count, 10),
    skills: row.tags || [], // tags as proxy for skills
    pagerank: row.pagerank,
    betweenness: row.betweenness_centrality,
    degreeCentrality: row.degree_centrality,
    observationCount: parseInt(row.observation_count, 10),
    contentTopics: row.content_topics || [],
    postingFrequency: row.posting_frequency,
    avgEngagement: row.avg_engagement,
    connectedAt: row.connected_at,
    connectionCountRaw: row.connection_count_raw,
    discoveredVia: row.discovered_via || [],
    clusterIds: row.cluster_ids || [],
  };
}

export async function getAllContactIds(): Promise<string[]> {
  const result = await query<{ id: string }>(
    'SELECT id FROM contacts WHERE is_archived = FALSE ORDER BY created_at'
  );
  return result.rows.map(r => r.id);
}

// Scoring baselines (percentiles for normalization)

export async function getScoringBaselines(): Promise<{
  p90Mutuals: number;
  p90Edges: number;
  totalClusters: number;
}> {
  const result = await query<{
    p90_mutuals: string;
    p90_edges: string;
    total_clusters: string;
  }>(`
    WITH mutual_counts AS (
      SELECT source_contact_id, COUNT(*)::int AS cnt
      FROM edges WHERE edge_type = 'mutual' AND target_contact_id IS NOT NULL
      GROUP BY source_contact_id
    ),
    edge_counts AS (
      SELECT contact_id, COUNT(*)::int AS cnt
      FROM (
        SELECT source_contact_id AS contact_id FROM edges
        UNION ALL
        SELECT target_contact_id AS contact_id FROM edges WHERE target_contact_id IS NOT NULL
      ) sub
      GROUP BY contact_id
    )
    SELECT
      COALESCE((SELECT PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY cnt) FROM mutual_counts), 20)::text AS p90_mutuals,
      COALESCE((SELECT PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY cnt) FROM edge_counts), 10)::text AS p90_edges,
      COALESCE((SELECT COUNT(DISTINCT id) FROM clusters), 5)::text AS total_clusters
  `);

  const row = result.rows[0];
  return {
    p90Mutuals: Math.max(parseFloat(row?.p90_mutuals || '20'), 1),
    p90Edges: Math.max(parseFloat(row?.p90_edges || '10'), 1),
    totalClusters: Math.max(parseInt(row?.total_clusters || '5', 10), 1),
  };
}

// Score storage

export async function upsertContactScore(
  contactId: string,
  score: CompositeScore
): Promise<void> {
  await transaction(async (client) => {
    // Upsert contact_scores (including referral fields)
    const scoreResult = await client.query(
      `INSERT INTO contact_scores (
        contact_id, composite_score, tier, persona, behavioral_persona,
        scoring_version, scored_at,
        referral_likelihood, referral_tier, referral_persona,
        behavioral_signals, referral_signals
      )
      VALUES ($1, $2, $3, $4, $5, $6, NOW(), $7, $8, $9, $10, $11)
      ON CONFLICT (contact_id) DO UPDATE SET
        composite_score = $2, tier = $3, persona = $4, behavioral_persona = $5,
        scoring_version = $6, scored_at = NOW(),
        referral_likelihood = $7, referral_tier = $8, referral_persona = $9,
        behavioral_signals = $10, referral_signals = $11
      RETURNING id`,
      [
        contactId, score.compositeScore, score.tier, score.persona, score.behavioralPersona,
        score.scoringVersion,
        score.referralLikelihood, score.referralTier, score.referralPersona,
        score.behavioralSignals ? JSON.stringify(score.behavioralSignals) : null,
        score.referralSignals ? JSON.stringify(score.referralSignals) : null,
      ]
    );

    const scoreId = scoreResult.rows[0].id;

    // Delete old dimensions and insert new ones
    await client.query('DELETE FROM score_dimensions WHERE contact_score_id = $1', [scoreId]);

    for (const dim of score.dimensions) {
      await client.query(
        `INSERT INTO score_dimensions (contact_score_id, dimension, raw_value, weighted_value, weight, metadata)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [scoreId, dim.dimension, dim.rawValue, dim.weightedValue, dim.weight, JSON.stringify(dim.metadata || {})]
      );
    }

    // Store referral dimensions if present
    if (score.referralDimensions && score.referralDimensions.length > 0) {
      await client.query('DELETE FROM referral_dimensions WHERE contact_score_id = $1', [scoreId]);
      for (const rd of score.referralDimensions) {
        await client.query(
          `INSERT INTO referral_dimensions (contact_score_id, component, raw_value, weighted_value, weight, metadata)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [scoreId, rd.component, rd.rawValue, rd.weightedValue, rd.weight, JSON.stringify(rd.metadata || {})]
        );
      }
    }
  });
}

export async function getContactScoreBreakdown(contactId: string): Promise<{
  compositeScore: number;
  tier: string;
  persona: string | null;
  behavioralPersona: string | null;
  scoredAt: string | null;
  dimensions: Array<{ dimension: string; rawValue: number; weightedValue: number; weight: number }>;
  referralLikelihood: number | null;
  referralTier: string | null;
  referralPersona: string | null;
  referralDimensions: Array<{ component: string; rawValue: number; weightedValue: number; weight: number }>;
  behavioralSignals: Record<string, unknown> | null;
  referralSignals: Record<string, unknown> | null;
} | null> {
  const scoreResult = await query<{
    id: string; composite_score: number; tier: string;
    persona: string | null; behavioral_persona: string | null; scored_at: Date | null;
    referral_likelihood: number | null; referral_tier: string | null;
    referral_persona: string | null;
    behavioral_signals: Record<string, unknown> | null;
    referral_signals: Record<string, unknown> | null;
  }>(
    `SELECT id, composite_score, tier, persona, behavioral_persona, scored_at,
            referral_likelihood, referral_tier, referral_persona,
            behavioral_signals, referral_signals
     FROM contact_scores WHERE contact_id = $1`,
    [contactId]
  );

  if (scoreResult.rows.length === 0) return null;

  const score = scoreResult.rows[0];

  const dimResult = await query<{
    dimension: string; raw_value: number; weighted_value: number; weight: number;
  }>(
    'SELECT dimension, raw_value, weighted_value, weight FROM score_dimensions WHERE contact_score_id = $1 ORDER BY weighted_value DESC',
    [score.id]
  );

  const referralDimResult = await query<{
    component: string; raw_value: number; weighted_value: number; weight: number;
  }>(
    'SELECT component, raw_value, weighted_value, weight FROM referral_dimensions WHERE contact_score_id = $1 ORDER BY weighted_value DESC',
    [score.id]
  );

  return {
    compositeScore: score.composite_score,
    tier: score.tier,
    persona: score.persona,
    behavioralPersona: score.behavioral_persona,
    scoredAt: score.scored_at?.toISOString() ?? null,
    dimensions: dimResult.rows.map(d => ({
      dimension: d.dimension,
      rawValue: d.raw_value,
      weightedValue: d.weighted_value,
      weight: d.weight,
    })),
    referralLikelihood: score.referral_likelihood,
    referralTier: score.referral_tier,
    referralPersona: score.referral_persona,
    referralDimensions: referralDimResult.rows.map(d => ({
      component: d.component,
      rawValue: d.raw_value,
      weightedValue: d.weighted_value,
      weight: d.weight,
    })),
    behavioralSignals: score.behavioral_signals,
    referralSignals: score.referral_signals,
  };
}

// ICP profiles

export async function getActiveIcpProfiles(): Promise<IcpProfile[]> {
  const result = await query<{
    id: string; name: string; description: string | null;
    is_active: boolean; criteria: IcpCriteria;
    weight_overrides: Record<string, number>;
    created_at: Date; updated_at: Date;
  }>(
    'SELECT * FROM icp_profiles WHERE is_active = TRUE ORDER BY name'
  );
  return result.rows.map(mapIcpProfile);
}

export async function listIcpProfiles(): Promise<IcpProfile[]> {
  const result = await query<{
    id: string; name: string; description: string | null;
    is_active: boolean; criteria: IcpCriteria;
    weight_overrides: Record<string, number>;
    created_at: Date; updated_at: Date;
  }>(
    'SELECT * FROM icp_profiles ORDER BY name'
  );
  return result.rows.map(mapIcpProfile);
}

export async function createIcpProfile(data: {
  name: string;
  description?: string;
  criteria: IcpCriteria;
  weightOverrides?: Record<string, number>;
  nicheId?: string;
}): Promise<IcpProfile> {
  const result = await query<{
    id: string; name: string; description: string | null;
    is_active: boolean; criteria: IcpCriteria;
    weight_overrides: Record<string, number>;
    created_at: Date; updated_at: Date;
  }>(
    `INSERT INTO icp_profiles (name, description, criteria, weight_overrides, niche_id)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [data.name, data.description ?? null, JSON.stringify(data.criteria), JSON.stringify(data.weightOverrides || {}), data.nicheId ?? null]
  );
  return mapIcpProfile(result.rows[0]);
}

export async function upsertContactIcpFit(
  contactId: string,
  icpProfileId: string,
  fitScore: number,
  breakdown: Record<string, unknown>
): Promise<void> {
  await query(
    `INSERT INTO contact_icp_fits (contact_id, icp_profile_id, fit_score, fit_breakdown, computed_at)
     VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT (contact_id, icp_profile_id) DO UPDATE SET
       fit_score = $3, fit_breakdown = $4, computed_at = NOW()`,
    [contactId, icpProfileId, fitScore, JSON.stringify(breakdown)]
  );
}

// Tier distribution query for dashboard

export async function getTierDistribution(): Promise<Array<{ tier: string; count: number }>> {
  const result = await query<{ tier: string; count: string }>(
    `SELECT COALESCE(tier, 'unscored') AS tier, COUNT(*)::text AS count
     FROM contact_scores
     GROUP BY tier
     ORDER BY CASE tier
       WHEN 'gold' THEN 1 WHEN 'silver' THEN 2
       WHEN 'bronze' THEN 3 WHEN 'watch' THEN 4 ELSE 5
     END`
  );
  return result.rows.map(r => ({ tier: r.tier, count: parseInt(r.count, 10) }));
}

// Scoring runs (for tracking rescore-all operations)

export async function createScoringRun(
  runType: 'single' | 'batch' | 'rescore-all',
  totalContacts: number
): Promise<string> {
  const result = await query<{ id: string }>(
    `INSERT INTO scoring_runs (run_type, status, total_contacts, started_at)
     VALUES ($1, 'running', $2, NOW()) RETURNING id`,
    [runType, totalContacts]
  );
  return result.rows[0].id;
}

export async function updateScoringRun(
  runId: string,
  updates: { scoredContacts?: number; failedContacts?: number; status?: string; errorMessage?: string }
): Promise<void> {
  const sets: string[] = [];
  const params: unknown[] = [runId];
  let idx = 2;

  if (updates.scoredContacts !== undefined) {
    sets.push(`scored_contacts = $${idx++}`);
    params.push(updates.scoredContacts);
  }
  if (updates.failedContacts !== undefined) {
    sets.push(`failed_contacts = $${idx++}`);
    params.push(updates.failedContacts);
  }
  if (updates.status !== undefined) {
    sets.push(`status = $${idx++}`);
    params.push(updates.status);
    if (updates.status === 'completed' || updates.status === 'failed') {
      sets.push('completed_at = NOW()');
    }
  }
  if (updates.errorMessage !== undefined) {
    sets.push(`error_message = $${idx++}`);
    params.push(updates.errorMessage);
  }

  if (sets.length > 0) {
    await query(`UPDATE scoring_runs SET ${sets.join(', ')} WHERE id = $1`, params);
  }
}

export async function getScoringRunStatus(runId: string): Promise<ScoringRunStatus | null> {
  const result = await query<{
    id: string; run_type: string; status: string;
    total_contacts: number; scored_contacts: number; failed_contacts: number;
    started_at: Date; completed_at: Date | null; error_message: string | null;
  }>(
    'SELECT * FROM scoring_runs WHERE id = $1',
    [runId]
  );
  if (result.rows.length === 0) return null;
  const r = result.rows[0];
  return {
    id: r.id,
    runType: r.run_type as ScoringRunStatus['runType'],
    status: r.status as ScoringRunStatus['status'],
    totalContacts: r.total_contacts,
    scoredContacts: r.scored_contacts,
    failedContacts: r.failed_contacts,
    startedAt: r.started_at.toISOString(),
    completedAt: r.completed_at?.toISOString() ?? null,
    errorMessage: r.error_message,
  };
}

export async function getLatestScoringRun(): Promise<ScoringRunStatus | null> {
  const result = await query<{
    id: string; run_type: string; status: string;
    total_contacts: number; scored_contacts: number; failed_contacts: number;
    started_at: Date; completed_at: Date | null; error_message: string | null;
  }>(
    'SELECT * FROM scoring_runs ORDER BY started_at DESC LIMIT 1'
  );
  if (result.rows.length === 0) return null;
  const r = result.rows[0];
  return {
    id: r.id,
    runType: r.run_type as ScoringRunStatus['runType'],
    status: r.status as ScoringRunStatus['status'],
    totalContacts: r.total_contacts,
    scoredContacts: r.scored_contacts,
    failedContacts: r.failed_contacts,
    startedAt: r.started_at.toISOString(),
    completedAt: r.completed_at?.toISOString() ?? null,
    errorMessage: r.error_message,
  };
}

// Helpers

function mapWeightProfile(row: {
  id: string; name: string; description: string | null;
  weights: Record<string, number>; is_default: boolean;
  created_at: Date; updated_at: Date;
}): WeightProfile {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    weights: row.weights,
    isDefault: row.is_default,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function mapIcpProfile(row: {
  id: string; name: string; description: string | null;
  is_active: boolean; criteria: IcpCriteria;
  weight_overrides: Record<string, number>;
  created_at: Date; updated_at: Date;
}): IcpProfile {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    isActive: row.is_active,
    criteria: row.criteria,
    weightOverrides: row.weight_overrides,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}
