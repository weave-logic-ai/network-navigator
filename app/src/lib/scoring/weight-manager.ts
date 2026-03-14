// Weight manager - loads profiles from DB, handles null-safe redistribution

import { WeightProfile } from './types';
import * as scoringQueries from '../db/queries/scoring';

const DEFAULT_WEIGHTS: Record<string, number> = {
  icp_fit: 0.20,
  network_hub: 0.10,
  relationship_strength: 0.15,
  signal_boost: 0.10,
  skills_relevance: 0.10,
  network_proximity: 0.05,
  behavioral: 0.10,
  content_relevance: 0.10,
  graph_centrality: 0.10,
};

export class WeightManager {
  private profile: WeightProfile | null = null;

  async loadProfile(profileName?: string): Promise<WeightProfile> {
    if (profileName) {
      this.profile = await scoringQueries.getWeightProfileByName(profileName);
    } else {
      this.profile = await scoringQueries.getDefaultWeightProfile();
    }

    if (!this.profile) {
      // Fallback to hardcoded defaults
      this.profile = {
        id: 'default',
        name: 'default',
        description: 'Hardcoded fallback profile',
        weights: DEFAULT_WEIGHTS,
        isDefault: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    }

    return this.profile;
  }

  getWeights(): Record<string, number> {
    return this.profile?.weights ?? DEFAULT_WEIGHTS;
  }

  /**
   * Redistribute weights when some dimensions have no data.
   * Dimensions with null data get weight=0 and their weight
   * is proportionally redistributed to dimensions with data.
   */
  redistributeWeights(availableDimensions: string[]): Record<string, number> {
    const baseWeights = this.getWeights();
    const allDimensions = Object.keys(baseWeights);

    // Find which dimensions have data
    const activeDimensions = allDimensions.filter(d => availableDimensions.includes(d));
    const inactiveDimensions = allDimensions.filter(d => !availableDimensions.includes(d));

    if (inactiveDimensions.length === 0) {
      return { ...baseWeights };
    }

    // Sum up weights that need redistribution
    const redistributeTotal = inactiveDimensions.reduce((sum, d) => sum + (baseWeights[d] || 0), 0);
    const activeTotal = activeDimensions.reduce((sum, d) => sum + (baseWeights[d] || 0), 0);

    if (activeTotal === 0) {
      // No active dimensions at all, equal weight
      const equalWeight = 1.0 / (activeDimensions.length || 1);
      const result: Record<string, number> = {};
      for (const d of allDimensions) {
        result[d] = activeDimensions.includes(d) ? equalWeight : 0;
      }
      return result;
    }

    // Proportionally redistribute
    const result: Record<string, number> = {};
    for (const d of allDimensions) {
      if (activeDimensions.includes(d)) {
        const baseFraction = (baseWeights[d] || 0) / activeTotal;
        result[d] = (baseWeights[d] || 0) + redistributeTotal * baseFraction;
      } else {
        result[d] = 0;
      }
    }

    return result;
  }

  getProfileId(): string {
    return this.profile?.id ?? 'default';
  }
}
