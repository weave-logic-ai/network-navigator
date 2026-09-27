// GET /api/scoring/preview - Preview impact of weight changes
//
// Phase 1.5 — WS-4 per-target ICP plumbing: accepts an optional `targetId`
// query param. When set (and the targets flag is on), preview scores are
// computed against the ICP attached to the target's active lens; otherwise
// the first active owner-default ICP is used (today's behavior).

import { NextRequest, NextResponse } from 'next/server';
import { WeightManager } from '@/lib/scoring/weight-manager';
import { computeCompositeScore } from '@/lib/scoring/composite';
import * as scoringQueries from '@/lib/db/queries/scoring';
import { getActiveLensIcps } from '@/lib/targets/lens-service';
import { RESEARCH_FLAGS } from '@/lib/config/research-flags';
import { getCurrentOwnerProfileId, getResearchTargetState, getTargetById } from '@/lib/targets/service';
import { requireLocalDashboardRequest } from '@/lib/auth/local-request-boundary';
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
} from '@/lib/scoring/scorers';

export async function GET(request: NextRequest) {
  const denied = await requireLocalDashboardRequest(request);
  if (denied) return denied;
  try {
    const { searchParams } = new URL(request.url);
    const weightsParam = searchParams.get('weights');
    const limitParam = searchParams.get('limit');
    const targetId = searchParams.get('targetId') ?? undefined;
    let lensScope: { tenantId: string; ownerId: string } | undefined;
    if (targetId && RESEARCH_FLAGS.targets) {
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(targetId)) {
        return NextResponse.json({ error: 'Invalid targetId' }, { status: 400 });
      }
      const ownerId = await getCurrentOwnerProfileId();
      if (!ownerId) return NextResponse.json({ error: 'Target not found' }, { status: 404 });
      const [state, target] = await Promise.all([
        getResearchTargetState(ownerId), getTargetById(targetId),
      ]);
      if (!state || !target || state.tenantId !== target.tenantId ||
          (target.kind === 'self' && target.ownerId !== ownerId)) {
        return NextResponse.json({ error: 'Target not found' }, { status: 404 });
      }
      lensScope = { tenantId: state.tenantId, ownerId };
    }
    const limit = Math.min(20, Math.max(1, parseInt(limitParam || '10', 10)));

    if (!weightsParam) {
      return NextResponse.json(
        { error: 'weights query parameter required (JSON-encoded)' },
        { status: 400 }
      );
    }

    let newWeights: Record<string, number>;
    try {
      newWeights = JSON.parse(weightsParam);
    } catch {
      return NextResponse.json(
        { error: 'Invalid weights JSON' },
        { status: 400 }
      );
    }

    // Get sample contacts
    const contactIds = await scoringQueries.getAllContactIds();
    const sampleIds = contactIds.slice(0, limit);

    const scorers = [
      new IcpFitScorer(), new NetworkHubScorer(), new RelationshipStrengthScorer(),
      new SignalBoostScorer(), new SkillsRelevanceScorer(), new NetworkProximityScorer(),
      new BehavioralScorer(), new ContentRelevanceScorer(), new GraphCentralityScorer(),
    ];

    // Load current weights for comparison
    const weightManager = new WeightManager();
    await weightManager.loadProfile();
    const currentWeights = weightManager.getWeights();

    // Resolve ICP criteria: lens-scoped first when flag + targetId are set,
    // fall back to the first active owner-default ICP for today's behavior.
    let icpCriteria: Parameters<typeof computeCompositeScore>[3];
    if (RESEARCH_FLAGS.targets && targetId && lensScope) {
      const lensIcps = await getActiveLensIcps(targetId, lensScope);
      if (lensIcps.length > 0) icpCriteria = lensIcps[0].criteria;
    }
    if (!icpCriteria) {
      const icpProfiles = await scoringQueries.getActiveIcpProfiles();
      icpCriteria = icpProfiles[0]?.criteria;
    }

    const previews = [];
    for (const contactId of sampleIds) {
      const contact = await scoringQueries.getContactScoringData(contactId);
      if (!contact) continue;

      const currentScore = computeCompositeScore(contact, scorers, currentWeights, icpCriteria);
      const newScore = computeCompositeScore(contact, scorers, newWeights, icpCriteria);

      previews.push({
        contactId,
        current: { score: currentScore.compositeScore, tier: currentScore.tier },
        preview: { score: newScore.compositeScore, tier: newScore.tier },
        change: newScore.compositeScore - currentScore.compositeScore,
      });
    }

    return NextResponse.json({ data: previews });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to preview weights', details: error instanceof Error ? error.message : undefined },
      { status: 500 }
    );
  }
}
