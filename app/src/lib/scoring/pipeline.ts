// Scoring pipeline for persisted owner baselines and read-only lens previews.

import { WeightManager } from './weight-manager';
import { computeCompositeScore } from './composite';
import {
  IcpFitScorer,
  NetworkHubScorer,
  RelationshipStrengthScorer,
  SignalBoostScorer,
  SkillsRelevanceScorer,
  NetworkProximityScorer,
  BehavioralScorer,
  ContentRelevanceScorer,
  GraphCentralityScorer,
} from './scorers';
import { DimensionScorer, ScoringRunResult, IcpCriteria, ContactScoringData, IcpProfile, WeightProfile, CompositeScore } from './types';
import * as scoringQueries from '../db/queries/scoring';
import { checkAndGenerateTasks } from './task-triggers';
import { resolveTaxonomyChain } from '../taxonomy/service';
import { RESEARCH_FLAGS } from '../config/research-flags';
import { getActiveLensForTarget } from '../targets/lens-service';
import { ECC_FLAGS } from '../ecc/types';
import { transaction } from '../db/client';
import { createHash } from 'node:crypto';
import { drainScoringImpulses, recordScoringImpulses } from './transition-writer';

export class TargetScopedScoreError extends Error {
  constructor() {
    super('targetId is only supported by the read-only scoring context preview');
    this.name = 'TargetScopedScoreError';
  }
}

export function assertOwnerBaseline(targetId?: string): void {
  if (targetId !== undefined) throw new TargetScopedScoreError();
}

export class LensPreviewError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = 'LensPreviewError';
  }
}

const behavioralScorer = new BehavioralScorer();
// Bump whenever composite/referral scoring semantics change.
const OWNER_ALGORITHM_VERSION = 1;

const ALL_SCORERS: DimensionScorer[] = [
  new IcpFitScorer(),
  new NetworkHubScorer(),
  new RelationshipStrengthScorer(),
  new SignalBoostScorer(),
  new SkillsRelevanceScorer(),
  new NetworkProximityScorer(),
  behavioralScorer,
  new ContentRelevanceScorer(),
  new GraphCentralityScorer(),
];

export interface OwnerScoringBasis {
  readonly ownerId: string;
  readonly tenantId: string;
  readonly weightProfile: WeightProfile;
  readonly icpProfiles: readonly IcpProfile[];
  readonly criteriaByIcpId: Readonly<Record<string, IcpCriteria>>;
  readonly referralBaselines: Awaited<ReturnType<typeof scoringQueries.getScoringBaselines>>;
  readonly snapshotId: string;
  readonly basisHash: string;
}

function stableJson(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return item;
    return Object.fromEntries(Object.entries(item).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));
  });
}

// PostgreSQL stores score numbers as real. Compare the value a retry would
// persist, including dimensions and signals, rather than unrounded JS math.
function samePersistedScore(previous: CompositeScore, score: CompositeScore): boolean {
  const persisted = (value: CompositeScore) => ({
    composite: Math.fround(value.compositeScore),
    tier: value.tier,
    persona: value.persona,
    behavioralPersona: value.behavioralPersona,
    scoringVersion: value.scoringVersion,
    referralLikelihood: value.referralLikelihood == null ? null : Math.fround(value.referralLikelihood),
    referralTier: value.referralTier,
    referralPersona: value.referralPersona,
    behavioralSignals: value.behavioralSignals,
    referralSignals: value.referralSignals,
    dimensions: value.dimensions.map(dim => ({
      dimension: dim.dimension,
      rawValue: Math.fround(dim.rawValue),
      weightedValue: Math.fround(dim.weightedValue),
      weight: Math.fround(dim.weight),
      metadata: dim.metadata ?? {},
    })).sort((a, b) => a.dimension.localeCompare(b.dimension)),
    referralDimensions: (value.referralDimensions ?? []).map(dim => ({
      component: dim.component,
      rawValue: Math.fround(dim.rawValue),
      weightedValue: Math.fround(dim.weightedValue),
      weight: Math.fround(dim.weight),
      metadata: dim.metadata ?? {},
    })).sort((a, b) => a.component.localeCompare(b.component)),
  });
  return stableJson(persisted(previous)) === stableJson(persisted(score));
}

function ownerBasisHash(
  ownerId: string,
  tenantId: string,
  profile: WeightProfile,
  icps: readonly IcpProfile[],
  criteriaByIcpId: Readonly<Record<string, IcpCriteria>>,
  referralBaselines: OwnerScoringBasis['referralBaselines']
): string {
  const relevant = {
    algorithmVersion: OWNER_ALGORITHM_VERSION,
    ownerId,
    tenantId,
    weights: profile.weights,
    icps: icps.map(icp => ({ id: icp.id, criteria: icp.criteria, effectiveCriteria: criteriaByIcpId[icp.id] })),
    referralBaselines,
  };
  return createHash('sha256').update(stableJson(relevant)).digest('hex');
}

async function readSoleLocalOwner(client: Parameters<Parameters<typeof transaction>[0]>[0], lock: boolean = false) {
  const result = await client.query<{ owner_id: string; tenant_id: string }>(
    `SELECT owner.id AS owner_id, tenant.id AS tenant_id
     FROM tenants tenant
     JOIN owner_profiles owner ON owner.is_current = TRUE
     JOIN research_targets self_target
       ON self_target.tenant_id = tenant.id AND self_target.kind = 'self'
      AND self_target.owner_id = owner.id
     WHERE tenant.slug = 'default'
       AND (SELECT COUNT(*) FROM tenants) = 1
       AND (SELECT COUNT(*) FROM owner_profiles WHERE is_current = TRUE) = 1
     LIMIT 1${lock ? ' FOR SHARE OF owner' : ''}`
  );
  if (!result.rows[0]) throw new Error('Owner scoring requires one default tenant and current owner');
  return result.rows[0];
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

/** Freeze the owner scoring settings before a long-running rescore starts. */
export async function captureOwnerScoringBasis(profileName?: string): Promise<OwnerScoringBasis> {
  return transaction(async client => {
    await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const snapshot = await client.query<{ snapshot_id: string }>(
      'SELECT txid_current_snapshot()::text AS snapshot_id'
    );
    const scope = await readSoleLocalOwner(client);
    const weights = new WeightManager();
    const weightProfile = await weights.loadProfile(profileName, client);
    const icpProfiles = await scoringQueries.getActiveIcpProfiles(client);
    const referralBaselines = await scoringQueries.getScoringBaselines(client);
    const criteriaByIcpId: Record<string, IcpCriteria> = {};
    for (const icp of icpProfiles) {
      const chain = await resolveTaxonomyChain(icp.id, client);
      criteriaByIcpId[icp.id] = {
        ...icp.criteria,
        ...(chain.industry ? { industries: [chain.industry.name] } : {}),
        ...(chain.niche?.keywords?.length ? { nicheKeywords: chain.niche.keywords } : {}),
      };
    }
    const captured = {
      ownerId: scope.owner_id,
      tenantId: scope.tenant_id,
      weightProfile: { ...weightProfile, weights: structuredClone(weightProfile.weights) },
      icpProfiles: icpProfiles.map(icp => ({
        ...icp,
        criteria: structuredClone(icp.criteria),
        weightOverrides: structuredClone(icp.weightOverrides),
      })),
      criteriaByIcpId: structuredClone(criteriaByIcpId),
      referralBaselines: { ...referralBaselines },
      snapshotId: snapshot.rows[0].snapshot_id,
    };
    return deepFreeze({
      ...captured,
      basisHash: ownerBasisHash(captured.ownerId, captured.tenantId,
        captured.weightProfile, captured.icpProfiles,
        captured.criteriaByIcpId, captured.referralBaselines),
    });
  });
}

/** Validate a persisted import-job basis before replaying it after restart. */
export function restoreOwnerScoringBasis(raw: unknown): OwnerScoringBasis {
  if (!raw || typeof raw !== 'object') throw new Error('Missing persisted owner basis');
  const basis = raw as OwnerScoringBasis;
  if (typeof basis.ownerId !== 'string' || typeof basis.tenantId !== 'string' ||
      !basis.weightProfile || !Array.isArray(basis.icpProfiles) ||
      !basis.criteriaByIcpId || !basis.referralBaselines ||
      typeof basis.basisHash !== 'string') {
    throw new Error('Invalid persisted owner basis');
  }
  const expected = ownerBasisHash(basis.ownerId, basis.tenantId,
    basis.weightProfile, basis.icpProfiles,
    basis.criteriaByIcpId, basis.referralBaselines);
  if (expected !== basis.basisHash) throw new Error('Persisted owner basis hash mismatch');
  return deepFreeze(basis);
}

/** Score all contextual inputs from one read-only repeatable-read snapshot. */
export async function previewContactForTarget(
  contactId: string,
  targetId: string,
  profileName?: string
) {
  if (!RESEARCH_FLAGS.targets) throw new LensPreviewError('Research targets are disabled', 422);
  return transaction(async client => {
    await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const snapshot = await client.query<{ captured_at: Date; snapshot_id: string }>(
      'SELECT transaction_timestamp() AS captured_at, txid_current_snapshot()::text AS snapshot_id'
    );
    // Contacts have no tenant column. Their contact target is the tenant
    // association; the owner's self target binds the operator to that tenant.
    const boundary = await client.query<{ owner_id: string; tenant_id: string }>(
      `SELECT owner.id AS owner_id, tenant.id AS tenant_id
       FROM tenants tenant
       JOIN owner_profiles owner ON owner.is_current = TRUE
       JOIN research_targets self_target
         ON self_target.tenant_id = tenant.id
        AND self_target.kind = 'self' AND self_target.owner_id = owner.id
       JOIN research_targets target
         ON target.id = $1 AND target.tenant_id = tenant.id
        AND (target.kind <> 'self' OR target.owner_id = owner.id)
       JOIN research_targets contact_target
         ON contact_target.tenant_id = tenant.id
        AND contact_target.kind = 'contact' AND contact_target.contact_id = $2
       JOIN contacts contact ON contact.id = contact_target.contact_id
       WHERE tenant.slug = 'default'
         AND (SELECT COUNT(*) FROM owner_profiles WHERE is_current = TRUE) = 1
       LIMIT 1`,
      [targetId, contactId]
    );
    const scope = boundary.rows[0];
    if (!scope) throw new LensPreviewError('Scoring context not found', 404);
    const lens = await getActiveLensForTarget(targetId, {
      tenantId: scope.tenant_id, ownerId: scope.owner_id,
    }, client);
    if (!lens || lens.tenantId !== scope.tenant_id ||
        lens.userId !== scope.owner_id || lens.primaryTargetId !== targetId) {
      throw new LensPreviewError('Scoring context not found', 404);
    }

    const icpRows = await client.query<{
      id: string; name: string; description: string | null; is_active: boolean;
      criteria: IcpCriteria; weight_overrides: Record<string, number>;
      created_at: Date; updated_at: Date;
    }>(
      `SELECT ip.id, ip.name, ip.description, ip.is_active, ip.criteria,
              ip.weight_overrides, ip.created_at, ip.updated_at
       FROM research_target_icps rti
       JOIN icp_profiles ip ON ip.id = rti.icp_profile_id
       WHERE rti.target_id = $1 AND rti.lens_id = $2 AND ip.is_active = TRUE
       ORDER BY ip.name`,
      [targetId, lens.id]
    );
    const icps: IcpProfile[] = icpRows.rows.map(row => ({
      id: row.id,
      name: row.name,
      description: row.description,
      isActive: row.is_active,
      criteria: row.criteria,
      weightOverrides: row.weight_overrides,
      createdAt: new Date(row.created_at).toISOString(),
      updatedAt: new Date(row.updated_at).toISOString(),
    }));
    if (icps.length === 0) throw new LensPreviewError('Active lens has no active ICPs', 422);

    const weightManager = new WeightManager();
    const weightProfile = await weightManager.loadProfile(profileName, client);
    const capturedAt = snapshot.rows[0].captured_at.toISOString();
    const contact = await scoringQueries.getContactScoringData(contactId, client);
    if (!contact) throw new LensPreviewError('Contact not found', 404);

    const fitScorer = new IcpFitScorer();
    let best = icps[0];
    let bestFit = -1;
    const icpFits = icps.map(icp => {
      const fitScore = fitScorer.score(contact, icp.criteria);
      if (fitScore > bestFit) { bestFit = fitScore; best = icp; }
      return { icpProfileId: icp.id, fitScore };
    });
    let criteria = best.criteria;
    const chain = await resolveTaxonomyChain(best.id, client);
    if (chain.industry || chain.niche) {
      criteria = {
        ...criteria,
        ...(chain.industry ? { industries: [chain.industry.name] } : {}),
        ...(chain.niche?.keywords?.length ? { nicheKeywords: chain.niche.keywords } : {}),
      };
    }
    const weights = weightManager.redistributeWeights(getAvailableDimensions(contact));
    const score = computeCompositeScore(contact, ALL_SCORERS, weights, criteria, OWNER_ALGORITHM_VERSION);
    const referralBaselines = await scoringQueries.getScoringBaselines(client);
    const { computeReferralScore } = await import('./referral/referral-pipeline');
    contact.existingGoldScore = score.compositeScore;
    contact.existingRelationshipStrength =
      score.dimensions.find(d => d.dimension === 'relationship_strength')?.rawValue ?? 0;
    contact.existingBehavioralPersona = score.behavioralPersona;
    const referral = computeReferralScore(contact, {
      ...referralBaselines,
      existingGoldScore: score.compositeScore,
      existingRelationshipStrength: contact.existingRelationshipStrength,
    });
    score.referralLikelihood = referral.likelihood;
    score.referralTier = referral.tier;
    score.referralPersona = referral.persona;
    score.referralDimensions = referral.dimensions;
    score.referralSignals = referral.signals;
    return {
      contactId,
      score,
      icpFits,
      basis: {
        kind: 'lens-preview' as const,
        scope: 'composite-and-referral' as const,
        targetId,
        lensId: lens.id,
        lensUpdatedAt: new Date(lens.updatedAt).toISOString(),
        icps: icps.map(icp => ({ id: icp.id, updatedAt: icp.updatedAt })),
        selectedIcpId: best.id,
        weightProfileId: weightProfile.id,
        weightProfileUpdatedAt: weightProfile.updatedAt,
        weights,
        referralBaselines,
        capturedAt,
        snapshotId: snapshot.rows[0].snapshot_id,
        snapshotIsolation: 'repeatable-read' as const,
        scoringVersion: score.scoringVersion,
      },
    };
  });
}

export async function scoreContact(
  contactId: string,
  profileName?: string,
  targetId?: string,
  basis?: OwnerScoringBasis,
  emitTransitions: boolean = true,
  importJobId?: string
): Promise<ScoringRunResult> {
  assertOwnerBaseline(targetId);
  if (basis && profileName && profileName !== basis.weightProfile.name) {
    throw new Error('Scoring profile does not match captured owner basis');
  }
  const ownerBasis = basis ?? await captureOwnerScoringBasis(profileName);
  const result = await transaction(async client => {
    const scope = await readSoleLocalOwner(client, true);
    if (scope.owner_id !== ownerBasis.ownerId || scope.tenant_id !== ownerBasis.tenantId) {
      throw new Error('Current owner changed since scoring basis capture');
    }
    // The input read must follow the same per-contact lock as the replacement.
    // A competing scorer cannot compute from an earlier contact state and then
    // replace a newer score after waiting for the write lock.
    const locked = await client.query('SELECT id FROM contacts WHERE id = $1 FOR UPDATE', [contactId]);
    if (locked.rows.length === 0) throw new Error(`Contact not found: ${contactId}`);
    if (!await scoringQueries.isOwnerScorableContact(contactId, client)) {
      throw new Error(`Contact not found: ${contactId}`);
    }
    const contact = await scoringQueries.getContactScoringData(contactId, client);
    if (!contact) throw new Error(`Contact not found: ${contactId}`);
    const weightManager = new WeightManager(ownerBasis.weightProfile);

    const availableDimensions = getAvailableDimensions(contact);
    const weights = weightManager.redistributeWeights(availableDimensions);

    const icpProfiles = ownerBasis.icpProfiles;

    let bestIcpCriteria: IcpCriteria | undefined;
    let bestIcp: IcpProfile | undefined;
    let bestIcpFit = -1;
    const icpFitScorer = new IcpFitScorer();
    for (const icp of icpProfiles) {
      const fit = icpFitScorer.score(contact, icp.criteria);
      if (fit > bestIcpFit) {
        bestIcpFit = fit;
        bestIcpCriteria = icp.criteria;
        bestIcp = icp;
      }
    }

    if (bestIcp?.id) {
      bestIcpCriteria = ownerBasis.criteriaByIcpId[bestIcp.id];
      if (!bestIcpCriteria) throw new Error(`Captured owner basis is missing ICP ${bestIcp.id}`);
    }

    const score = computeCompositeScore(contact, ALL_SCORERS, weights, bestIcpCriteria, OWNER_ALGORITHM_VERSION);

    try {
      const { computeReferralScore } = await import('./referral/referral-pipeline');
      const baselines = ownerBasis.referralBaselines;
      const referralContext = {
        p90Mutuals: baselines.p90Mutuals,
        p90Edges: baselines.p90Edges,
        totalClusters: baselines.totalClusters,
        existingGoldScore: score.compositeScore,
        existingRelationshipStrength:
          score.dimensions.find(d => d.dimension === 'relationship_strength')?.rawValue ?? 0,
      };

      // Attach existing behavioral persona for referral persona classification
      contact.existingGoldScore = score.compositeScore;
      contact.existingRelationshipStrength = referralContext.existingRelationshipStrength;
      contact.existingBehavioralPersona = score.behavioralPersona;

      const referral = computeReferralScore(contact, referralContext);
      score.referralLikelihood = referral.likelihood;
      score.referralTier = referral.tier;
      score.referralPersona = referral.persona;
      score.referralDimensions = referral.dimensions;
      score.referralSignals = referral.signals;
    } catch (err) {
      // Referral scoring is non-blocking — log and continue
      console.error(`[scoring] Referral scoring failed for ${contactId}:`, err);
    }

    const behavioralDim = score.dimensions.find(d => d.dimension === 'behavioral');
    if (behavioralDim?.metadata?.behavioralSignals) {
      score.behavioralSignals = behavioralDim.metadata.behavioralSignals as typeof score.behavioralSignals;
    }

    const replaced = await scoringQueries.upsertContactScore(contactId, score, ownerBasis.basisHash, client);

    const icpFits: ScoringRunResult['icpFits'] = [];
    for (const icp of icpProfiles) {
      const icpScore = computeCompositeScore(
        contact,
        [new IcpFitScorer()],
        { icp_fit: 1.0 },
        icp.criteria
      );
      const fitScore = icpScore.compositeScore;
      const breakdown = { dimensions: icpScore.dimensions };
      await scoringQueries.upsertContactIcpFit(contactId, icp.id, fitScore, breakdown, client);
      icpFits.push({ icpProfileId: icp.id, fitScore, breakdown });
    }

    // Legacy or unlike-basis predecessors cannot produce meaningful deltas.
    // Identity repair is independent of score comparability and commits with the score.
    if (emitTransitions) {
      await checkAndGenerateTasks(contactId, replaced.previous, score, true, {
        client, forceInline: true, source: ECC_FLAGS.impulses ? 'impulse' : 'auto-score',
        identityOnly: !replaced.comparable,
      });
      if (replaced.comparable && (!replaced.previous || !samePersistedScore(replaced.previous, score))) {
        await recordScoringImpulses(client, contactId, replaced.previous, score, replaced.revision);
      }
    }
    if (importJobId) {
      const completed = await client.query(
        `UPDATE score_import_job_contacts
         SET scored_at = NOW(), attempts = attempts + 1, last_error = NULL
         WHERE job_id = $1 AND contact_id = $2 AND scored_at IS NULL AND skipped_at IS NULL
         RETURNING contact_id`, [importJobId, contactId]
      );
      if (!completed.rows[0]) throw new Error('Import job contact was already completed or removed');
    }
    return { contactId, score, icpFits };
  });
  if (emitTransitions) {
    await drainScoringImpulses(contactId).catch(error => {
      // The committed impulse remains pending and will be retried by the next
      // scorer or an operator invoking the drainer.
      console.error('[scoring] Scoring impulse dispatch deferred', { contactId, error });
    });
  }
  return result;
}

export async function scoreBatch(
  contactIds?: string[],
  profileName?: string,
  targetId?: string
): Promise<ScoringRunResult[]> {
  return (await scoreBatchDetailed(contactIds, profileName, targetId)).results;
}

export interface BatchScoreFailure {
  contactId: string;
  error: string;
}

export async function scoreBatchDetailed(
  contactIds?: string[],
  profileName?: string,
  targetId?: string
): Promise<{ results: ScoringRunResult[]; failures: BatchScoreFailure[]; total: number }> {
  assertOwnerBaseline(targetId);
  // If no IDs provided, score all non-archived contacts
  const ids = contactIds ?? await scoringQueries.getAllContactIds();
  const basis = await captureOwnerScoringBasis(profileName);
  const results: ScoringRunResult[] = [];
  const failures: BatchScoreFailure[] = [];

  for (const contactId of ids) {
    try {
      results.push(await scoreContact(contactId, profileName, undefined, basis));
    } catch (err) {
      failures.push({ contactId, error: err instanceof Error ? err.message : String(err) });
      console.error(`[scoring] Failed to score contact ${contactId}:`, err);
    }
  }

  return { results, failures, total: ids.length };
}

function getAvailableDimensions(contact: ContactScoringData): string[] {
  const available: string[] = [];

  available.push('icp_fit');

  if (contact.mutualConnectionCount > 0 || contact.edgeCount > 0 || (contact.connectionsCount || 0) > 0) {
    available.push('network_hub');
  }

  available.push('relationship_strength');

  // Signal boost: need text data
  if (contact.headline || contact.about || contact.tags.length > 0) {
    available.push('signal_boost');
  }

  // Skills relevance: need skills or headline
  if (contact.skills.length > 0 || contact.headline || contact.title) {
    available.push('skills_relevance');
  }

  // Network proximity: always available (uses degree)
  available.push('network_proximity');

  // Behavioral: always include (enhanced scorer handles nulls internally)
  available.push('behavioral');

  // Content relevance: need content topics or about text
  if (contact.contentTopics.length > 0 || contact.about) {
    available.push('content_relevance');
  }

  // Graph centrality: need graph metrics
  if (contact.pagerank != null || contact.betweenness != null || contact.degreeCentrality != null) {
    available.push('graph_centrality');
  }

  return available;
}
