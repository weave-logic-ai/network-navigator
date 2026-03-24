// ICP Fit Scorer - matches contacts against Ideal Customer Profile criteria

import { ContactScoringData, DimensionScorer, IcpCriteria } from '../types';

export class IcpFitScorer implements DimensionScorer {
  readonly dimension = 'icp_fit';

  score(contact: ContactScoringData, icpCriteria?: IcpCriteria): number {
    if (!icpCriteria) return 0;

    let totalChecks = 0;
    let matchedChecks = 0;

    // Role match
    if (icpCriteria.roles && icpCriteria.roles.length > 0) {
      totalChecks++;
      const titleLower = (contact.title || contact.headline || '').toLowerCase();
      if (icpCriteria.roles.some(r => titleLower.includes(r.toLowerCase()))) {
        matchedChecks++;
      }
    }

    // Industry match
    if (icpCriteria.industries && icpCriteria.industries.length > 0) {
      totalChecks++;
      const industry = (contact.companyIndustry || '').toLowerCase();
      if (icpCriteria.industries.some(i => industry.includes(i.toLowerCase()))) {
        matchedChecks++;
      }
    }

    // Signal keywords match
    if (icpCriteria.signals && icpCriteria.signals.length > 0) {
      totalChecks++;
      const text = [contact.headline, contact.about, ...(contact.tags || [])].join(' ').toLowerCase();
      const matchCount = icpCriteria.signals.filter(s => text.includes(s.toLowerCase())).length;
      if (matchCount > 0) {
        matchedChecks += matchCount / icpCriteria.signals.length;
      }
    }

    // Company size match
    if (icpCriteria.companySizeRanges && icpCriteria.companySizeRanges.length > 0) {
      totalChecks++;
      if (contact.companySizeRange && icpCriteria.companySizeRanges.includes(contact.companySizeRange)) {
        matchedChecks++;
      }
    }

    // Location match
    if (icpCriteria.locations && icpCriteria.locations.length > 0) {
      totalChecks++;
      const location = (contact.location || '').toLowerCase();
      if (icpCriteria.locations.some(l => location.includes(l.toLowerCase()))) {
        matchedChecks++;
      }
    }

    // Niche keywords match (bonus signals from parent niche)
    if (icpCriteria.nicheKeywords && icpCriteria.nicheKeywords.length > 0) {
      totalChecks++;
      const text = [contact.headline, contact.about, ...(contact.tags || [])].join(' ').toLowerCase();
      const matchCount = icpCriteria.nicheKeywords.filter(k => text.includes(k.toLowerCase())).length;
      if (matchCount > 0) {
        matchedChecks += matchCount / icpCriteria.nicheKeywords.length;
      }
    }

    // Min connections
    if (icpCriteria.minConnections && icpCriteria.minConnections > 0) {
      totalChecks++;
      if (contact.connectionsCount && contact.connectionsCount >= icpCriteria.minConnections) {
        matchedChecks++;
      }
    }

    if (totalChecks === 0) return 0;
    return matchedChecks / totalChecks;
  }
}
