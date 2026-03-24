// ICP/Niche discovery - cluster contacts by attributes and propose ICP profiles

import * as graphQueries from '../db/queries/graph';
import { IcpDiscoveryResult } from './types';

/**
 * Discover potential ICP profiles by clustering contacts by their attributes.
 */
export async function discoverIcps(
  minClusterSize: number = 3
): Promise<IcpDiscoveryResult[]> {
  const clusters = await graphQueries.getContactAttributeClusters();
  const results: IcpDiscoveryResult[] = [];

  for (const cluster of clusters) {
    if (cluster.contact_count < minClusterSize) continue;

    const titlePatterns: string[] = [];
    if (cluster.title_pattern && cluster.title_pattern !== 'Other') {
      titlePatterns.push(cluster.title_pattern);
    }

    const industries: string[] = [];
    if (cluster.industry) {
      industries.push(cluster.industry);
    }

    const companySizes: string[] = [];
    if (cluster.company_size) {
      companySizes.push(cluster.company_size);
    }

    const locations: string[] = [];
    if (cluster.location) {
      locations.push(cluster.location);
    }

    // Skip clusters with no distinguishing characteristics
    if (titlePatterns.length === 0 && industries.length === 0) continue;

    const parts = [
      titlePatterns.length > 0 ? titlePatterns[0] : null,
      industries.length > 0 ? `in ${industries[0]}` : null,
      companySizes.length > 0 ? `(${companySizes[0]})` : null,
    ].filter(Boolean);

    const suggestedName = parts.join(' ');
    const description = `${cluster.contact_count} contacts matching: ${parts.join(', ')}`;

    // Confidence based on cluster size and specificity
    const specificity = [titlePatterns, industries, companySizes, locations]
      .filter(a => a.length > 0).length;
    const confidence = Math.min(
      (cluster.contact_count / 10) * (specificity / 4),
      1.0
    );

    results.push({
      suggestedName,
      description,
      criteria: {
        titlePatterns,
        industries,
        companySizes,
        locations,
      },
      contactCount: cluster.contact_count,
      sampleContactIds: cluster.sample_ids.slice(0, 5),
      confidence,
    });
  }

  // Sort by confidence descending
  results.sort((a, b) => b.confidence - a.confidence);

  return results;
}

