// ICP Fit Scorer - matches contacts against Ideal Customer Profile criteria

import { ContactScoringData, DimensionScorer, IcpCriteria } from '../types';

export const ROLE_GROUP_ALIASES: Record<string, string[]> = {
  'CEO/Founder': ['CEO', 'founder', 'chief executive officer'],
  'CTO/Tech Leader': ['CTO', 'chief technology officer', 'chief tech', 'tech leader'],
  VP: ['VP', 'vice president'],
  Director: ['director'],
  'Manager/Head': ['manager', 'head of'],
  Engineer: ['engineer', 'developer'],
  Sales: ['sales', 'account exec'],
  Marketing: ['marketing', 'growth'],
  Product: ['product'],
  Consultant: ['consultant', 'advisor'],
};

/** Match a whole role token or phrase, ignoring punctuation and case. */
function matchesPhrase(title: string | null | undefined, role: string): boolean {
  const words = (value: string) => value.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  const titleWords = words(title ?? '');
  const roleWords = words(role);
  if (roleWords.length === 0) return false;
  return titleWords.some((_, index) =>
    roleWords.every((word, offset) => titleWords[index + offset] === word)
  );
}

export function matchesRole(title: string | null | undefined, role: string): boolean {
  const aliases = ROLE_GROUP_ALIASES[role] ??
    (role.toLowerCase() === 'cto' ? ['CTO', 'chief technology officer'] : undefined);
  return aliases
    ? aliases.some(alias => matchesPhrase(title, alias))
    : matchesPhrase(title, role);
}

export class IcpFitScorer implements DimensionScorer {
  readonly dimension = 'icp_fit';

  score(contact: ContactScoringData, icpCriteria?: IcpCriteria): number {
    if (!icpCriteria) return 0;

    let totalChecks = 0;
    let matchedChecks = 0;

    // Role match
    if (icpCriteria.roles && icpCriteria.roles.length > 0) {
      totalChecks++;
      const title = contact.title || contact.headline;
      if (icpCriteria.roles.some(r => matchesRole(title, r))) {
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
