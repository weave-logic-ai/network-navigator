// GET /api/scoring/preview - Preview impact of weight changes

import { NextRequest, NextResponse } from 'next/server';
import { WeightManager } from '@/lib/scoring/weight-manager';
import { computeCompositeScore } from '@/lib/scoring/composite';
import * as scoringQueries from '@/lib/db/queries/scoring';
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
  try {
    const { searchParams } = new URL(request.url);
    const weightsParam = searchParams.get('weights');
    const limitParam = searchParams.get('limit');
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

    const icpProfiles = await scoringQueries.getActiveIcpProfiles();
    const icpCriteria = icpProfiles[0]?.criteria;

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
