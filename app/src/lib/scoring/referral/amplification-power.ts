// Amplification Power Score - measures ability to spread messages and make introductions
// Weight: 0.15

import { ContactScoringData } from '../types';
import { ReferralComponent, ReferralContext, REFERRAL_WEIGHTS } from './types';

const HELPING_KEYWORDS = [
  'helping',
  'connecting',
  'introductions',
  'empower',
  'enable',
  'bridge',
];

const CONTENT_CREATION_SIGNALS = [
  'speaker',
  'author',
  'writer',
  'podcast',
  'blogger',
  'keynote',
  'thought leader',
  'published',
];

// Super-connector traits come from the behavioral scorer's existing signals.
// These are traits like high connection count, frequent introductions, broad network.
const SUPER_CONNECTOR_TRAITS = [
  'high-connection-count',
  'frequent-introductions',
  'broad-network',
  'cross-industry',
  'community-leader',
  'event-host',
  'group-admin',
  'mentor',
];

export interface AmplificationDetail {
  superConnectorBoost: number;
  helpingBoost: number;
  contentCreationBoost: number;
  matchedSignals: string[];
}

export class AmplificationPowerScorer implements ReferralComponent {
  readonly name = 'amplificationPower';
  readonly weight = REFERRAL_WEIGHTS.amplificationPower;

  score(contact: ContactScoringData, _context: ReferralContext): number {
    const { detail } = this.scoreWithDetail(contact);
    const total = detail.superConnectorBoost + detail.helpingBoost + detail.contentCreationBoost;
    return Math.min(total, 1.0);
  }

  scoreWithDetail(contact: ContactScoringData): { value: number; detail: AmplificationDetail } {
    const matchedSignals: string[] = [];

    // Super-connector traits
    const traitCount = this.countSuperConnectorTraits(contact);
    let superConnectorBoost = 0;
    if (traitCount >= 3) {
      superConnectorBoost = 0.4;
      matchedSignals.push(`super-connector-traits:${traitCount}`);
    } else if (traitCount > 0) {
      superConnectorBoost = traitCount * 0.12;
      matchedSignals.push(`connector-traits:${traitCount}`);
    }

    // Helping/connecting language in about + headline
    const textFields = [contact.about, contact.headline]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();

    let helpingMatches = 0;
    for (const keyword of HELPING_KEYWORDS) {
      if (textFields.includes(keyword)) {
        helpingMatches++;
        matchedSignals.push(`helping:${keyword}`);
      }
    }
    let helpingBoost = 0;
    if (helpingMatches >= 2) {
      helpingBoost = 0.30;
    } else if (helpingMatches === 1) {
      helpingBoost = 0.15;
    }

    // Content creation signals
    const allText = [contact.title, contact.headline, contact.about]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();

    let contentMatches = 0;
    for (const signal of CONTENT_CREATION_SIGNALS) {
      if (allText.includes(signal)) {
        contentMatches++;
        matchedSignals.push(`content:${signal}`);
      }
    }
    const contentCreationBoost = contentMatches >= 1 ? 0.30 : 0;

    const detail: AmplificationDetail = {
      superConnectorBoost,
      helpingBoost,
      contentCreationBoost,
      matchedSignals,
    };

    const total = Math.min(
      superConnectorBoost + helpingBoost + contentCreationBoost,
      1.0
    );

    return { value: total, detail };
  }

  private countSuperConnectorTraits(contact: ContactScoringData): number {
    // Use tags + discoveredVia as trait indicators, plus text-based detection
    const allText = [contact.title, contact.headline, contact.about]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();

    const allTags = [
      ...contact.tags,
      ...contact.discoveredVia,
    ].map(t => t.toLowerCase());

    let count = 0;
    for (const trait of SUPER_CONNECTOR_TRAITS) {
      if (allTags.includes(trait) || allText.includes(trait.replace(/-/g, ' '))) {
        count++;
      }
    }

    // High connection count is a super-connector trait
    if ((contact.connectionsCount || 0) >= 500) {
      count++;
    }

    return count;
  }
}
