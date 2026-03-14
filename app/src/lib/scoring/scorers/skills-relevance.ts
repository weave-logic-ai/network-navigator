// Skills Relevance Scorer - evaluates alignment of skills with ICP requirements

import { ContactScoringData, DimensionScorer, IcpCriteria } from '../types';

export class SkillsRelevanceScorer implements DimensionScorer {
  readonly dimension = 'skills_relevance';

  score(contact: ContactScoringData, icpCriteria?: IcpCriteria): number {
    const skills = contact.skills || [];
    if (skills.length === 0) {
      // Extract pseudo-skills from headline/title
      const text = [contact.headline, contact.title].filter(Boolean).join(' ');
      if (!text) return 0;
      return this.scoreFromText(text, icpCriteria);
    }

    if (!icpCriteria?.signals || icpCriteria.signals.length === 0) {
      // No ICP to match against, give a base score for having skills
      return Math.min(skills.length / 10, 0.5);
    }

    const skillsLower = skills.map(s => s.toLowerCase());
    const targetLower = icpCriteria.signals.map(s => s.toLowerCase());

    let matches = 0;
    for (const target of targetLower) {
      if (skillsLower.some(s => s.includes(target) || target.includes(s))) {
        matches++;
      }
    }

    if (targetLower.length === 0) return 0;
    return matches / targetLower.length;
  }

  private scoreFromText(text: string, icpCriteria?: IcpCriteria): number {
    if (!icpCriteria?.signals || icpCriteria.signals.length === 0) return 0.2;

    const textLower = text.toLowerCase();
    let matches = 0;
    for (const signal of icpCriteria.signals) {
      if (textLower.includes(signal.toLowerCase())) {
        matches++;
      }
    }
    return matches / icpCriteria.signals.length;
  }
}
