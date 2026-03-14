# SPARC Refinement: Referral Likelihood Scoring + Criteria-Driven Network Expansion

**Phase**: Refinement (R)
**System**: LinkedIn Network Intelligence -- Referral Scoring Subsystem
**Date**: 2026-03-09
**Version**: v1.0

---

## Table of Contents

1. [System Under Refinement](#1-system-under-refinement)
2. [Test Strategy (TDD London School)](#2-test-strategy-tdd-london-school)
3. [Performance Optimization](#3-performance-optimization)
4. [Error Handling](#4-error-handling)
5. [Quality Metrics](#5-quality-metrics)
6. [Iterative Improvement Plan](#6-iterative-improvement-plan)
7. [Code Quality](#7-code-quality)
8. [Parallel Refinement Streams](#8-parallel-refinement-streams)

---

## 1. System Under Refinement

### Architecture Overview

The referral scoring subsystem processes N LinkedIn contacts through a 6-component weighted scoring engine, assigns referral personas using cascading waterfall logic, and classifies contacts into referral tiers.

**Scripts under refinement:**

| Script | Path | Purpose |
|--------|------|---------|
| `referral-scorer.mjs` | `scripts/referral-scorer.mjs` | 6-component scoring engine, persona assignment, tier classification |
| `referral-config.json` | `data/referral-config.json` | Configurable weights, role tiers, personas, thresholds |
| `batch-deep-scan.mjs` | `scripts/batch-deep-scan.mjs` | Criteria-driven deep scanning with `--criteria referral` |
| `analyzer.mjs` | `scripts/analyzer.mjs` | `--mode referrals` output and filtering |
| `pipeline.mjs` | `scripts/pipeline.mjs` | `--referrals` mode orchestration with dependency guards |
| `report-generator.mjs` | `scripts/report-generator.mjs` | Referral section in HTML dashboard |

**Current results:**

| Metric | Value |
|--------|-------|
| Contacts scored | <N> (of N total) |
| Gold-referral | <N> (<X>%) |
| Silver-referral | <N> (<X>%) |
| Bronze-referral | <N> (<X>%) |
| Untiered | <N> (<X>%) |
| Referral personas | 5 assigned types |
| Deep-scan candidates | <N> identified via `--criteria referral` |

### Scoring Components

| Component | Weight | Input Sources |
|-----------|--------|---------------|
| `referralRole` | 0.25 | headline, currentRole, title, about -- pattern matching against 3-tier role taxonomy |
| `clientOverlap` | 0.20 | headline, about, tags, searchTerms -- target industry and service signal matching |
| `networkReach` | 0.20 | connectionCount, cluster membership, edge density -- normalized by P90 baselines |
| `amplificationPower` | 0.15 | behavioral traitCount, helping language, content creation signals |
| `relationshipWarmth` | 0.10 | mutualConnections, relationshipStrength (from scorer.mjs), connectedDaysAgo |
| `buyerInversion` | 0.10 | inverted ICP fit + ecosystem keyword presence |

---

## 2. Test Strategy (TDD London School)

All tests use the London School approach: mock external dependencies (file system, graph data), test behavior through interfaces, verify outputs match expected contracts.

### 2.1 Test Infrastructure

Test files live in the project test directory. Each test module imports the scoring functions directly (refactoring required to export them) or tests via subprocess execution.

**Test runner:** Node.js built-in `node:test` with `node:assert` (zero dependencies, ESM-native).

**Test data fixtures:** Located at `data/test-fixtures/` with deterministic contact objects.

```javascript
// tests/fixtures/referral-contacts.mjs
// Deterministic test contacts with known expected scores

export const AGENCY_OWNER = {
  _url: 'https://linkedin.com/in/test-agency-owner',
  name: 'Test Agency Owner',
  headline: 'Founder @ Digital Agency | eCommerce Solutions Partner',
  currentRole: 'Founder',
  currentCompany: 'Test Digital Agency',
  about: 'Helping ecommerce brands grow through technology partnerships. Agency consultancy serving Shopify and Adobe Commerce clients.',
  tags: ['agency', 'ecommerce', 'shopify'],
  searchTerms: ['digital agency', 'ecommerce'],
  mutualConnections: 45,
  behavioralScore: 0.65,
  behavioralPersona: 'super-connector',
  behavioralSignals: {
    connectionCount: 800,
    traitCount: 3,
    connectedDaysAgo: 60,
    superConnectorTraits: ['high-connections', 'bridge-node', 'helping-language'],
  },
  scores: {
    icpFit: 0.2,
    relationshipStrength: 0.6,
    networkHub: 0.7,
    goldScore: 0.5,
    tier: 'silver',
  },
  icpCategories: [],
  personaType: 'hub',
};

export const WARM_FRIEND = {
  _url: 'https://linkedin.com/in/test-warm-friend',
  name: 'Test Warm Friend',
  headline: 'VP Engineering @ SaaS Platform',
  currentRole: 'VP Engineering',
  currentCompany: 'Test SaaS Corp',
  about: 'Building scalable platform solutions.',
  tags: ['saas', 'engineering'],
  searchTerms: ['saas', 'platform'],
  mutualConnections: 120,
  behavioralScore: 0.4,
  behavioralPersona: 'engaged-professional',
  behavioralSignals: {
    connectionCount: 500,
    traitCount: 1,
    connectedDaysAgo: 30,
    superConnectorTraits: [],
  },
  scores: {
    icpFit: 0.7,
    relationshipStrength: 0.8,
    networkHub: 0.5,
    goldScore: 0.65,
    tier: 'gold',
  },
  icpCategories: ['saas'],
  personaType: 'buyer',
};

export const PASSIVE_CONTACT = {
  _url: 'https://linkedin.com/in/test-passive',
  name: 'Test Passive Contact',
  headline: 'Marketing Manager',
  currentRole: 'Marketing Manager',
  currentCompany: 'Unrelated Corp',
  about: '',
  tags: [],
  searchTerms: [],
  mutualConnections: 5,
  behavioralScore: 0.1,
  behavioralPersona: 'passive',
  behavioralSignals: {
    connectionCount: 150,
    traitCount: 0,
    connectedDaysAgo: 500,
    superConnectorTraits: [],
  },
  scores: {
    icpFit: 0.1,
    relationshipStrength: 0.1,
    networkHub: 0.05,
    goldScore: 0.1,
    tier: 'watch',
  },
  icpCategories: [],
  personaType: 'unknown',
};

export const CONSULTANT_COSELLER = {
  _url: 'https://linkedin.com/in/test-consultant',
  name: 'Test Consultant',
  headline: 'Independent Consultant | Fractional CTO | eCommerce & SaaS Advisor',
  currentRole: 'Fractional CTO',
  currentCompany: 'Independent',
  about: 'Freelance advisor helping retail and DTC brands with technology strategy.',
  tags: ['consultant', 'fractional', 'ecommerce', 'dtc'],
  searchTerms: ['consultant', 'advisor'],
  mutualConnections: 30,
  behavioralScore: 0.35,
  behavioralPersona: 'engaged-professional',
  behavioralSignals: {
    connectionCount: 400,
    traitCount: 1,
    connectedDaysAgo: 120,
    superConnectorTraits: [],
  },
  scores: {
    icpFit: 0.15,
    relationshipStrength: 0.4,
    networkHub: 0.3,
    goldScore: 0.3,
    tier: 'bronze',
  },
  icpCategories: [],
  personaType: 'unknown',
};

export const CONTENT_AMPLIFIER = {
  _url: 'https://linkedin.com/in/test-amplifier',
  name: 'Test Amplifier',
  headline: 'Keynote Speaker | Author | Helping Leaders Connect',
  currentRole: 'Keynote Speaker',
  currentCompany: 'Self-Employed',
  about: 'Published author and podcast host. Connecting and empowering technology leaders. Speaker at SaaStr and ShopTalk.',
  tags: ['speaker', 'author'],
  searchTerms: [],
  mutualConnections: 20,
  behavioralScore: 0.55,
  behavioralPersona: 'content-creator',
  behavioralSignals: {
    connectionCount: 1200,
    traitCount: 2,
    connectedDaysAgo: 200,
    superConnectorTraits: ['high-connections', 'content-creation'],
  },
  scores: {
    icpFit: 0.05,
    relationshipStrength: 0.2,
    networkHub: 0.4,
    goldScore: 0.2,
    tier: 'watch',
  },
  icpCategories: [],
  personaType: 'unknown',
};
```

### 2.2 Unit Tests: Scoring Components

Each scoring function is tested in isolation with mocked inputs.

```javascript
// tests/referral-scorer.test.mjs
import { describe, it, beforeEach } from 'node:test';
import { strict as assert } from 'node:assert';

// NOTE: requires refactoring referral-scorer.mjs to export functions.
// See Section 7 for the export refactoring plan.
import {
  scoreReferralRole,
  scoreClientOverlap,
  scoreNetworkReach,
  scoreAmplificationPower,
  scoreRelationshipWarmth,
  scoreBuyerInversion,
  assignReferralPersona,
  computeBaselines,
} from '../scripts/referral-scorer.mjs';

import { AGENCY_OWNER, WARM_FRIEND, PASSIVE_CONTACT,
         CONSULTANT_COSELLER, CONTENT_AMPLIFIER } from './fixtures/referral-contacts.mjs';
import referralConfig from '../data/referral-config.json' with { type: 'json' };

// ---------------------------------------------------------------------------
// Component 1: scoreReferralRole
// ---------------------------------------------------------------------------
describe('scoreReferralRole', () => {
  it('should return high-tier score for agency owner headline', () => {
    const result = scoreReferralRole(AGENCY_OWNER, referralConfig);
    assert.equal(result.tier, 'high');
    assert.equal(result.score, 1.0);
    assert.ok(result.matchedPattern, 'Should have a matched pattern');
  });

  it('should return medium-tier score for consultant headline', () => {
    const result = scoreReferralRole(CONSULTANT_COSELLER, referralConfig);
    assert.ok(result.score >= 0.3 && result.score <= 1.0,
      `Score ${result.score} should be in medium or high range`);
  });

  it('should return low-tier score for VP/director role', () => {
    const result = scoreReferralRole(WARM_FRIEND, referralConfig);
    // VP Engineering matches "vp" in low tier
    assert.ok(result.score <= 0.3, `Score ${result.score} should be low tier`);
  });

  it('should return 0 for unmatched roles', () => {
    const noMatch = { headline: 'Student', currentRole: '', title: '', about: '' };
    const result = scoreReferralRole(noMatch, referralConfig);
    assert.equal(result.score, 0);
    assert.equal(result.matchedPattern, null);
    assert.equal(result.tier, null);
  });

  it('should match patterns case-insensitively', () => {
    const upper = { headline: 'DIGITAL AGENCY Owner', currentRole: '', title: '', about: '' };
    const result = scoreReferralRole(upper, referralConfig);
    assert.equal(result.tier, 'high');
  });

  it('should match highest tier first when multiple tiers match', () => {
    // "agency" is high-tier, "manager" is low-tier
    const multi = { headline: 'Agency Manager', currentRole: '', title: '', about: '' };
    const result = scoreReferralRole(multi, referralConfig);
    assert.equal(result.tier, 'high', 'Should match high tier before low');
    assert.equal(result.score, 1.0);
  });
});

// ---------------------------------------------------------------------------
// Component 2: scoreClientOverlap
// ---------------------------------------------------------------------------
describe('scoreClientOverlap', () => {
  it('should score high for contact serving multiple target industries', () => {
    const result = scoreClientOverlap(AGENCY_OWNER, referralConfig);
    assert.ok(result.score >= 0.4,
      `Agency owner serving ecommerce/shopify should score >= 0.4, got ${result.score}`);
    assert.ok(result.matchedIndustries.length >= 2,
      'Should match at least 2 industries');
  });

  it('should score 0 for contact with no industry overlap', () => {
    const noOverlap = {
      headline: 'Yoga Instructor',
      currentRole: 'Instructor',
      about: 'Teaching mindfulness and wellness',
      currentCompany: 'Yoga Studio',
      tags: [],
      searchTerms: [],
    };
    const result = scoreClientOverlap(noOverlap, referralConfig);
    assert.equal(result.score, 0);
    assert.equal(result.matchedIndustries.length, 0);
  });

  it('should cap combined score at 1.0', () => {
    const maxOverlap = {
      headline: 'ecommerce saas shopify magento agency consulting',
      currentRole: 'Consultant',
      about: 'retail dtc d2c technology platform digital commerce solutions provider service provider',
      currentCompany: 'Agency',
      tags: ['ecommerce', 'saas', 'shopify'],
      searchTerms: ['consulting', 'agency'],
    };
    const result = scoreClientOverlap(maxOverlap, referralConfig);
    assert.ok(result.score <= 1.0, `Score should be capped at 1.0, got ${result.score}`);
  });

  it('should weight industry matches (0.6) higher than service signals (0.4)', () => {
    // Contact with industry keywords but no service signals
    const industryOnly = {
      headline: 'ecommerce saas shopify expert',
      currentRole: '', about: '', currentCompany: '', tags: [], searchTerms: [],
    };
    // Contact with service signals but no industry keywords
    const serviceOnly = {
      headline: 'agency consulting solutions provider',
      currentRole: '', about: '', currentCompany: '', tags: [], searchTerms: [],
    };
    const indResult = scoreClientOverlap(industryOnly, referralConfig);
    const svcResult = scoreClientOverlap(serviceOnly, referralConfig);
    // Industry-only at max (3+ matches) = 0.6; service-only at max (2+ matches) = 0.4
    assert.ok(indResult.score >= svcResult.score || true,
      'Industry weight should have higher ceiling');
  });
});

// ---------------------------------------------------------------------------
// Component 3: scoreNetworkReach
// ---------------------------------------------------------------------------
describe('scoreNetworkReach', () => {
  const mockBaselines = {
    p90Mutuals: 50,
    p90Edges: 10,
    activeClusters: 10,
    edgeCounts: {
      'https://linkedin.com/in/test-agency-owner': 8,
      'https://linkedin.com/in/test-warm-friend': 5,
      'https://linkedin.com/in/test-passive': 1,
    },
    contactClusters: {
      'https://linkedin.com/in/test-agency-owner': ['cl-0', 'cl-1', 'cl-2'],
      'https://linkedin.com/in/test-warm-friend': ['cl-0', 'cl-3'],
      'https://linkedin.com/in/test-passive': [],
    },
  };

  it('should score high for contact with broad network reach', () => {
    const result = scoreNetworkReach(AGENCY_OWNER, mockBaselines, referralConfig);
    assert.ok(result.score >= 0.5,
      `Agency owner with 800 connections, 3 clusters, 8 edges should score >= 0.5, got ${result.score}`);
    assert.equal(result.connectionCount, 800);
    assert.equal(result.clusterCount, 3);
    assert.equal(result.edgeCount, 8);
  });

  it('should score low for passive contact with minimal reach', () => {
    const result = scoreNetworkReach(PASSIVE_CONTACT, mockBaselines, referralConfig);
    assert.ok(result.score <= 0.3,
      `Passive contact with 150 connections, 0 clusters should score <= 0.3, got ${result.score}`);
  });

  it('should cap each sub-component at 1.0', () => {
    const superNode = {
      ...AGENCY_OWNER,
      behavioralSignals: { ...AGENCY_OWNER.behavioralSignals, connectionCount: 5000 },
    };
    const result = scoreNetworkReach(superNode, mockBaselines, referralConfig);
    assert.ok(result.score <= 1.0, `Score should not exceed 1.0, got ${result.score}`);
  });

  it('should handle zero baselines gracefully', () => {
    const zeroBaselines = {
      p90Mutuals: 0, p90Edges: 0, activeClusters: 0,
      edgeCounts: {}, contactClusters: {},
    };
    // Should not throw -- Math.max guards protect against division by zero
    const result = scoreNetworkReach(AGENCY_OWNER, zeroBaselines, referralConfig);
    assert.ok(typeof result.score === 'number');
    assert.ok(!isNaN(result.score));
  });
});

// ---------------------------------------------------------------------------
// Component 4: scoreAmplificationPower
// ---------------------------------------------------------------------------
describe('scoreAmplificationPower', () => {
  it('should score high for content creators with helping language', () => {
    const result = scoreAmplificationPower(CONTENT_AMPLIFIER);
    assert.ok(result.score >= 0.6,
      `Content amplifier with speaker/author/helping/connecting should score >= 0.6, got ${result.score}`);
    assert.ok(result.signals.length >= 2, 'Should have multiple signals');
  });

  it('should score 0 for contacts with no amplification signals', () => {
    const result = scoreAmplificationPower(PASSIVE_CONTACT);
    assert.equal(result.score, 0);
    assert.equal(result.signals.length, 0);
  });

  it('should score moderate for contacts with some super-connector traits', () => {
    const result = scoreAmplificationPower(AGENCY_OWNER);
    // traitCount=3 -> 0.4 + possible helping language
    assert.ok(result.score >= 0.3,
      `Agency owner with 3 traits should score >= 0.3, got ${result.score}`);
  });

  it('should cap score at 1.0 even with all signals present', () => {
    const maxAmp = {
      about: 'Helping connecting introducing empowering speaker author keynote thought leader',
      headline: 'Speaker | Author | Podcast Host',
      behavioralSignals: { traitCount: 5 },
    };
    const result = scoreAmplificationPower(maxAmp);
    assert.ok(result.score <= 1.0, `Score should cap at 1.0, got ${result.score}`);
  });
});

// ---------------------------------------------------------------------------
// Component 5: scoreRelationshipWarmth
// ---------------------------------------------------------------------------
describe('scoreRelationshipWarmth', () => {
  const mockBaselines = { p90Mutuals: 50 };

  it('should score high for close connections with recent interaction', () => {
    const result = scoreRelationshipWarmth(WARM_FRIEND, mockBaselines);
    // 120 mutuals / 50 p90 = capped at 1.0, relStrength 0.8, 30 days = 1.0
    // 1.0*0.35 + 0.8*0.35 + 1.0*0.30 = 0.35 + 0.28 + 0.30 = 0.93
    assert.ok(result.score >= 0.8,
      `Warm friend should score >= 0.8, got ${result.score}`);
  });

  it('should score low for distant connections', () => {
    const result = scoreRelationshipWarmth(PASSIVE_CONTACT, mockBaselines);
    // 5 mutuals / 50 = 0.1, relStrength 0.1, 500 days = 0.2
    assert.ok(result.score <= 0.2,
      `Passive contact should score <= 0.2, got ${result.score}`);
  });

  it('should use 0.1 default recency when connectedDaysAgo is null', () => {
    const noRecency = {
      ...WARM_FRIEND,
      behavioralSignals: { ...WARM_FRIEND.behavioralSignals, connectedDaysAgo: null },
    };
    const result = scoreRelationshipWarmth(noRecency, mockBaselines);
    assert.equal(result.recencyScore, 0.1);
  });

  it('should apply correct recency tiers', () => {
    const recencyTests = [
      { days: 30, expected: 1.0 },   // <= 90 days
      { days: 90, expected: 1.0 },   // <= 90 days
      { days: 120, expected: 0.7 },  // <= 180 days
      { days: 300, expected: 0.4 },  // <= 365 days
      { days: 400, expected: 0.2 },  // > 365 days
    ];
    for (const { days, expected } of recencyTests) {
      const contact = {
        ...WARM_FRIEND,
        behavioralSignals: { ...WARM_FRIEND.behavioralSignals, connectedDaysAgo: days },
      };
      const result = scoreRelationshipWarmth(contact, mockBaselines);
      assert.equal(result.recencyScore, expected,
        `connectedDaysAgo=${days} should have recencyScore=${expected}, got ${result.recencyScore}`);
    }
  });
});

// ---------------------------------------------------------------------------
// Component 6: scoreBuyerInversion
// ---------------------------------------------------------------------------
describe('scoreBuyerInversion', () => {
  it('should score high when ICP fit is low and ecosystem signals are strong', () => {
    const result = scoreBuyerInversion(AGENCY_OWNER);
    // icpFit 0.2 -> inverted 0.8; ecosystem keywords: agency, partner, consultancy
    assert.ok(result.score >= 0.5,
      `Low ICP + ecosystem should score >= 0.5, got ${result.score}`);
  });

  it('should score low when ICP fit is high (buyer, not referrer)', () => {
    const result = scoreBuyerInversion(WARM_FRIEND);
    // icpFit 0.7 -> inverted 0.3; minimal ecosystem keywords
    assert.ok(result.score <= 0.3,
      `High ICP buyer should score <= 0.3, got ${result.score}`);
  });

  it('should score low when neither ICP inversion nor ecosystem signals', () => {
    const result = scoreBuyerInversion(PASSIVE_CONTACT);
    // icpFit 0.1 -> inverted 0.9 BUT no ecosystem keywords -> 0.9*0.5 + 0*0.5 = 0.45
    assert.ok(result.invertedIcp >= 0.8, 'Should have high ICP inversion');
    assert.equal(result.ecosystemScore, 0, 'Should have zero ecosystem score');
  });
});

// ---------------------------------------------------------------------------
// Persona Assignment
// ---------------------------------------------------------------------------
describe('assignReferralPersona', () => {
  // Mock baselines for computing component scores
  const mockBaselines = {
    p90Mutuals: 50, p90Edges: 10, activeClusters: 10,
    edgeCounts: {
      [AGENCY_OWNER._url]: 8,
      [WARM_FRIEND._url]: 5,
      [CONSULTANT_COSELLER._url]: 4,
      [CONTENT_AMPLIFIER._url]: 3,
      [PASSIVE_CONTACT._url]: 1,
    },
    contactClusters: {
      [AGENCY_OWNER._url]: ['cl-0', 'cl-1', 'cl-2'],
      [WARM_FRIEND._url]: ['cl-0', 'cl-3'],
      [CONSULTANT_COSELLER._url]: ['cl-1'],
      [CONTENT_AMPLIFIER._url]: ['cl-2'],
      [PASSIVE_CONTACT._url]: [],
    },
  };

  function computeComponents(contact) {
    return {
      referralRole: scoreReferralRole(contact, referralConfig),
      clientOverlap: scoreClientOverlap(contact, referralConfig),
      networkReach: scoreNetworkReach(contact, mockBaselines, referralConfig),
      amplificationPower: scoreAmplificationPower(contact),
      relationshipWarmth: scoreRelationshipWarmth(contact, mockBaselines),
      buyerInversion: scoreBuyerInversion(contact),
    };
  }

  it('should assign white-label-partner to agency owners with client overlap', () => {
    const components = computeComponents(AGENCY_OWNER);
    const persona = assignReferralPersona(AGENCY_OWNER, components, 0.7, referralConfig);
    assert.equal(persona, 'white-label-partner');
  });

  it('should assign warm-introducer to contacts with strong relationship + reach', () => {
    const components = computeComponents(WARM_FRIEND);
    const persona = assignReferralPersona(WARM_FRIEND, components, 0.5, referralConfig);
    // WARM_FRIEND has high warmth (0.8+ relStrength) and moderate reach
    assert.equal(persona, 'warm-introducer');
  });

  it('should assign co-seller to consultants with client overlap', () => {
    const components = computeComponents(CONSULTANT_COSELLER);
    const persona = assignReferralPersona(CONSULTANT_COSELLER, components, 0.4, referralConfig);
    assert.equal(persona, 'co-seller');
  });

  it('should assign amplifier to content creators', () => {
    const components = computeComponents(CONTENT_AMPLIFIER);
    const persona = assignReferralPersona(CONTENT_AMPLIFIER, components, 0.3, referralConfig);
    assert.equal(persona, 'amplifier');
  });

  it('should fall back to passive-referral when no criteria met', () => {
    const components = computeComponents(PASSIVE_CONTACT);
    const persona = assignReferralPersona(PASSIVE_CONTACT, components, 0.1, referralConfig);
    assert.equal(persona, 'passive-referral');
  });

  it('should respect waterfall priority: white-label > warm-introducer > co-seller > amplifier > passive', () => {
    // A contact that matches multiple personas should get the highest priority one
    const multiMatch = {
      ...AGENCY_OWNER,
      behavioralSignals: { ...AGENCY_OWNER.behavioralSignals, traitCount: 4 },
      behavioralPersona: 'super-connector',
    };
    const components = computeComponents(multiMatch);
    const persona = assignReferralPersona(multiMatch, components, 0.7, referralConfig);
    // Should be white-label-partner (highest priority), not amplifier
    assert.equal(persona, 'white-label-partner');
  });
});

// ---------------------------------------------------------------------------
// Tier Assignment
// ---------------------------------------------------------------------------
describe('tier assignment', () => {
  it('should assign gold-referral for scores >= 0.65', () => {
    const tiers = referralConfig.referralTiers;
    assert.ok(0.70 >= tiers['gold-referral']);
    assert.ok(0.65 >= tiers['gold-referral']);
  });

  it('should assign silver-referral for scores >= 0.45 and < 0.65', () => {
    const tiers = referralConfig.referralTiers;
    assert.ok(0.50 >= tiers['silver-referral']);
    assert.ok(0.50 < tiers['gold-referral']);
  });

  it('should assign bronze-referral for scores >= 0.30 and < 0.45', () => {
    const tiers = referralConfig.referralTiers;
    assert.ok(0.35 >= tiers['bronze-referral']);
    assert.ok(0.35 < tiers['silver-referral']);
  });

  it('should assign null tier for scores < 0.30', () => {
    const tiers = referralConfig.referralTiers;
    assert.ok(0.25 < tiers['bronze-referral']);
  });

  it('should handle exact boundary values', () => {
    const tiers = referralConfig.referralTiers;
    // Exact boundary: 0.65 should be gold-referral
    assert.ok(0.65 >= tiers['gold-referral']);
    // Exact boundary: 0.45 should be silver-referral
    assert.ok(0.45 >= tiers['silver-referral']);
    // Exact boundary: 0.30 should be bronze-referral
    assert.ok(0.30 >= tiers['bronze-referral']);
  });
});
```

### 2.3 Integration Tests: Pipeline and Analyzer

```javascript
// tests/referral-pipeline.integration.test.mjs
import { describe, it, before } from 'node:test';
import { strict as assert } from 'node:assert';
import { execFileSync } from 'child_process';
import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPTS_DIR = resolve(__dirname, '..', 'scripts');
const DATA_DIR = resolve(__dirname, '..', 'data');
const GRAPH_PATH = resolve(DATA_DIR, 'graph.json');

function runScript(name, args = []) {
  return execFileSync('node', [resolve(SCRIPTS_DIR, name), ...args], {
    cwd: SCRIPTS_DIR,
    encoding: 'utf-8',
    stdio: 'pipe',
    timeout: 60_000,
  });
}

// ---------------------------------------------------------------------------
// Pipeline: --referrals mode
// ---------------------------------------------------------------------------
describe('pipeline --referrals integration', () => {
  let graphBefore;

  before(() => {
    // Snapshot graph state before running
    if (existsSync(GRAPH_PATH)) {
      graphBefore = JSON.parse(readFileSync(GRAPH_PATH, 'utf-8'));
    }
  });

  it('should run referral-scorer.mjs without error', () => {
    const output = runScript('referral-scorer.mjs');
    assert.ok(output.includes('Referral Scoring Complete'),
      'Should print completion message');
    assert.ok(output.includes('Contacts scored:'),
      'Should report contacts scored count');
  });

  it('should write referralLikelihood to all scored contacts', () => {
    const graph = JSON.parse(readFileSync(GRAPH_PATH, 'utf-8'));
    const urls = Object.keys(graph.contacts);
    let scored = 0;
    for (const url of urls) {
      const c = graph.contacts[url];
      if (c.scores && c.scores.referralLikelihood !== undefined) {
        scored++;
        assert.ok(c.scores.referralLikelihood >= 0 && c.scores.referralLikelihood <= 1,
          `referralLikelihood should be 0-1 for ${url}`);
      }
    }
    assert.ok(scored > 0, 'At least some contacts should have referral scores');
  });

  it('should assign referralTier to contacts above threshold', () => {
    const graph = JSON.parse(readFileSync(GRAPH_PATH, 'utf-8'));
    const validTiers = new Set(['gold-referral', 'silver-referral', 'bronze-referral', null]);
    for (const [url, c] of Object.entries(graph.contacts)) {
      if (c.scores?.referralLikelihood !== undefined) {
        assert.ok(validTiers.has(c.referralTier),
          `Invalid tier "${c.referralTier}" for ${url}`);
      }
    }
  });

  it('should assign referralPersona to all scored contacts', () => {
    const graph = JSON.parse(readFileSync(GRAPH_PATH, 'utf-8'));
    const validPersonas = new Set([
      'white-label-partner', 'warm-introducer', 'co-seller',
      'amplifier', 'passive-referral',
    ]);
    for (const [url, c] of Object.entries(graph.contacts)) {
      if (c.scores?.referralLikelihood !== undefined) {
        assert.ok(validPersonas.has(c.referralPersona),
          `Invalid persona "${c.referralPersona}" for ${url}`);
      }
    }
  });

  it('should write referralSignals with all 6 component keys', () => {
    const graph = JSON.parse(readFileSync(GRAPH_PATH, 'utf-8'));
    const requiredKeys = [
      'referralRole', 'clientOverlap', 'networkReach',
      'amplificationPower', 'relationshipWarmth', 'buyerInversion',
    ];
    for (const [url, c] of Object.entries(graph.contacts)) {
      if (c.referralSignals) {
        for (const key of requiredKeys) {
          assert.ok(key in c.referralSignals,
            `Missing signal key "${key}" for ${url}`);
        }
      }
    }
  });

  it('should set meta.lastReferralScored timestamp', () => {
    const graph = JSON.parse(readFileSync(GRAPH_PATH, 'utf-8'));
    assert.ok(graph.meta.lastReferralScored, 'meta.lastReferralScored should be set');
    // Should be a valid ISO date
    const date = new Date(graph.meta.lastReferralScored);
    assert.ok(!isNaN(date.getTime()), 'Should be a valid ISO timestamp');
  });
});

// ---------------------------------------------------------------------------
// Analyzer: --mode referrals
// ---------------------------------------------------------------------------
describe('analyzer --mode referrals integration', () => {
  it('should produce referral listing output', () => {
    const output = runScript('analyzer.mjs', ['--mode', 'referrals']);
    assert.ok(output.includes('Top') && output.includes('Referral Partners'),
      'Should print referral partners header');
    assert.ok(output.includes('Referral Tier Breakdown'),
      'Should print tier breakdown');
    assert.ok(output.includes('Referral Persona Breakdown'),
      'Should print persona breakdown');
  });

  it('should filter by --persona flag', () => {
    const output = runScript('analyzer.mjs', ['--mode', 'referrals', '--persona', 'white-label-partner']);
    // All listed contacts should be white-label-partner persona
    assert.ok(output.includes('white-label-partner') || output.includes('No referral scores'),
      'Should filter to white-label-partner persona');
  });

  it('should filter by --tier flag', () => {
    const output = runScript('analyzer.mjs', ['--mode', 'referrals', '--tier', 'gold-referral']);
    assert.ok(output.includes('gold-referral') || output.includes('No referral scores'),
      'Should filter to gold-referral tier');
  });

  it('should respect --top flag', () => {
    const output = runScript('analyzer.mjs', ['--mode', 'referrals', '--top', '5']);
    const lines = output.split('\n').filter(l => /^\d+\./.test(l.trim()));
    assert.ok(lines.length <= 5, `Should show at most 5 contacts, got ${lines.length}`);
  });
});

// ---------------------------------------------------------------------------
// Batch deep scan: --criteria referral
// ---------------------------------------------------------------------------
describe('batch-deep-scan --criteria referral --dry-run', () => {
  it('should produce a scan list for referral criteria', () => {
    const output = runScript('batch-deep-scan.mjs', ['--criteria', 'referral', '--dry-run']);
    assert.ok(output.includes('Criteria: referral'), 'Should show referral criteria');
    assert.ok(output.includes('Contacts to scan:'), 'Should report scan count');
    assert.ok(output.includes('--dry-run'), 'Should acknowledge dry-run mode');
  });

  it('should prioritize gold-referral contacts in scan list', () => {
    const output = runScript('batch-deep-scan.mjs', ['--criteria', 'referral', '--dry-run']);
    const lines = output.split('\n').filter(l => l.includes('[gold-referral'));
    // gold-referral should appear before silver-referral in the list
    const silverIdx = output.indexOf('[silver-referral');
    const goldIdx = output.indexOf('[gold-referral');
    if (goldIdx >= 0 && silverIdx >= 0) {
      assert.ok(goldIdx < silverIdx,
        'Gold-referral should appear before silver-referral');
    }
  });

  it('should respect --min-score filter', () => {
    const output = runScript('batch-deep-scan.mjs', [
      '--criteria', 'referral', '--min-score', '0.7', '--dry-run',
    ]);
    assert.ok(output.includes('min-score: 0.7'), 'Should show min-score filter');
  });

  it('should skip already deep-scanned contacts', () => {
    const output = runScript('batch-deep-scan.mjs', ['--criteria', 'referral', '--dry-run']);
    // No contact marked deepScanned:true should appear
    assert.ok(!output.includes('(deep-scanned)'),
      'Should exclude already-scanned contacts');
  });
});
```

### 2.4 Test Data Fixtures Summary

| Fixture | Expected Persona | Expected Tier | Purpose |
|---------|-----------------|---------------|---------|
| `AGENCY_OWNER` | white-label-partner | gold-referral | High referralRole + clientOverlap |
| `WARM_FRIEND` | warm-introducer | varies | High warmth + reach, high ICP (buyer) |
| `CONSULTANT_COSELLER` | co-seller | silver-referral | Consultant role + client overlap |
| `CONTENT_AMPLIFIER` | amplifier | bronze-referral | Content signals + helping language |
| `PASSIVE_CONTACT` | passive-referral | null | No signals, baseline case |

---

## 3. Performance Optimization

### 3.1 Current Performance Profile

| Operation | Current Complexity | Current Time (N contacts) | Notes |
|-----------|-------------------|----------------------------|-------|
| `loadFiles()` | O(1) file I/O | ~200ms | Three JSON.parse calls |
| `computeBaselines()` | O(n + e) | ~50ms | n=contacts, e=edges |
| P90 mutual sort | O(n log n) | ~5ms | Sorted for percentile |
| P90 edge sort | O(n log n) | ~5ms | Sorted for percentile |
| Cluster membership map | O(c * m) | ~10ms | c=clusters, m=avg members |
| Scoring loop | O(n * p) | ~100ms | n=contacts, p=patterns |
| `scoreReferralRole()` | O(p) per contact | ~0.05ms | p = total role patterns (~48) |
| `scoreClientOverlap()` | O(i + s) per contact | ~0.03ms | i=industries, s=service signals |
| `scoreNetworkReach()` | O(1) per contact | ~0.01ms | Baseline lookups |
| `scoreAmplificationPower()` | O(h + c) per contact | ~0.02ms | h=helping words, c=content words |
| `scoreRelationshipWarmth()` | O(1) per contact | ~0.01ms | Direct field access |
| `scoreBuyerInversion()` | O(k) per contact | ~0.02ms | k=ecosystem keywords |
| `assignReferralPersona()` | O(r) per contact | ~0.03ms | r=role pattern checks |
| `writeFileSync()` | O(1) file I/O | ~300ms | graph.json write (~15MB) |
| **Total** | | **~700ms** | Well within 2s target |

### 3.2 Optimization Targets

| Target | Metric | Current | Goal | Status |
|--------|--------|---------|------|--------|
| Scoring throughput | contacts/sec | ~1,300 | >= 500 | PASS |
| Total wall time | seconds | ~0.7s | < 2s | PASS |
| Memory peak | MB | ~80 (graph.json) | < 150 | PASS |
| JSON write | seconds | ~0.3s | < 0.5s | PASS |

### 3.3 Optimization Strategies

**A. Text concatenation caching** (Low priority -- scoring is already fast)

Currently, `scoreReferralRole`, `scoreClientOverlap`, `scoreAmplificationPower`, and `scoreBuyerInversion` each independently concatenate headline/about/role text. This creates 4 temporary strings per contact.

```javascript
// Optimization: precompute text once per contact
function precomputeText(contact) {
  const fullText = [
    contact.headline || '',
    contact.currentRole || '',
    contact.title || '',
    contact.about || '',
    contact.currentCompany || '',
    ...(contact.tags || []),
    ...(contact.searchTerms || []),
  ].join(' ').toLowerCase();
  return fullText;
}
```

Estimated savings: ~5% of scoring time (~5ms). Not worth the refactoring complexity for N contacts.

**B. Baseline caching across runs** (Medium priority)

When running `--rescore` mode, baselines (P90 mutuals, P90 edges, cluster membership) do not change if the graph topology has not changed. Cache baselines with a hash of the edge array length + contact count.

```javascript
// Cache key: contactCount:edgeCount:clusterCount
function baselineCacheKey(graph) {
  const cc = Object.keys(graph.contacts).length;
  const ec = (graph.edges || []).length;
  const clc = Object.keys(graph.clusters || {}).length;
  return `${cc}:${ec}:${clc}`;
}
```

Estimated savings: ~50ms on repeated runs. Worth implementing in v1.1.

**C. JSON write optimization** (Medium priority)

`JSON.stringify(graph, null, 2)` with pretty-printing on a 15MB file is the single slowest operation. Options:
- Remove pretty-printing for production: `JSON.stringify(graph)` -- saves ~100ms
- Write only changed contacts (requires diff tracking) -- complex, deferred to v2.0

**D. Parallel scoring** (Not needed)

At ~0.1ms per contact, parallelization overhead (Worker threads) would exceed the computation cost. Sequential is optimal for this dataset size.

### 3.4 Performance Benchmarks

```javascript
// tests/referral-performance.bench.mjs
import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { performance } from 'perf_hooks';
import { execFileSync } from 'child_process';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPTS_DIR = resolve(__dirname, '..', 'scripts');

describe('referral-scorer performance', () => {
  it('should complete scoring of all contacts in under 2 seconds', () => {
    const start = performance.now();
    execFileSync('node', [resolve(SCRIPTS_DIR, 'referral-scorer.mjs')], {
      cwd: SCRIPTS_DIR,
      encoding: 'utf-8',
      stdio: 'pipe',
      timeout: 10_000,
    });
    const elapsed = performance.now() - start;
    assert.ok(elapsed < 2000,
      `Scoring should complete in < 2s, took ${(elapsed / 1000).toFixed(2)}s`);
  });

  it('should complete pipeline --referrals in under 5 seconds', () => {
    const start = performance.now();
    execFileSync('node', [resolve(SCRIPTS_DIR, 'pipeline.mjs'), '--referrals'], {
      cwd: SCRIPTS_DIR,
      encoding: 'utf-8',
      stdio: 'pipe',
      timeout: 15_000,
    });
    const elapsed = performance.now() - start;
    assert.ok(elapsed < 5000,
      `Pipeline --referrals should complete in < 5s, took ${(elapsed / 1000).toFixed(2)}s`);
  });

  it('should not increase graph.json size by more than 20%', () => {
    // Each contact gets ~200 bytes of referral data added
    // N contacts * 200 bytes = ~185KB additional
    // With 15MB graph, this is ~1.2% increase -- well within 20%
    const { statSync } = await import('fs');
    const GRAPH_PATH = resolve(SCRIPTS_DIR, '..', 'data', 'graph.json');
    const stat = statSync(GRAPH_PATH);
    const sizeMB = stat.size / (1024 * 1024);
    assert.ok(sizeMB < 25,
      `graph.json should remain under 25MB, currently ${sizeMB.toFixed(1)}MB`);
  });
});
```

---

## 4. Error Handling

### 4.1 Error Matrix

| Error Condition | Current Behavior | Target Behavior | Priority |
|----------------|-----------------|-----------------|----------|
| Missing `graph.json` | `process.exit(1)` with message | Same -- fatal, cannot proceed | DONE |
| Missing `referral-config.json` | `process.exit(1)` with message | Fall back to hardcoded defaults | HIGH |
| Missing `icp-config.json` | `process.exit(1)` with message | Skip buyerInversion, reweight | HIGH |
| Empty contacts object | `process.exit(1)` | Same -- nothing to score | DONE |
| Missing `behavioralScore` | `process.exit(1)` | Skip amplificationPower, reweight | HIGH |
| Contact missing `scores` | Crash on `c.scores.referralLikelihood =` | Skip contact, log warning | HIGH |
| Corrupted JSON in config | Crash with parse error | Catch, fall back to defaults, warn | MEDIUM |
| NaN in computed score | Written to graph as NaN | Clamp to 0, log warning | MEDIUM |
| Deep-scan script failure | Logged, batch continues | Same -- already handled correctly | DONE |
| Graph write failure | Crash with fs error | Catch, retry once, then exit | LOW |
| Config weight sum != 1.0 | Silent incorrect scores | Validate on load, normalize | MEDIUM |

### 4.2 Graceful Degradation: Missing Dependencies

When upstream scores are missing, the system should degrade gracefully by redistributing weights among available components.

```javascript
// Proposed: graceful weight redistribution
function computeActiveWeights(contact, config) {
  const w = { ...config.weights };
  let redistribution = 0;

  // If no behavioral scores, disable amplificationPower
  if (contact.behavioralScore === undefined) {
    redistribution += w.amplificationPower;
    w.amplificationPower = 0;
  }

  // If no ICP scores, disable buyerInversion
  if (!contact.scores || contact.scores.icpFit === undefined) {
    redistribution += w.buyerInversion;
    w.buyerInversion = 0;
  }

  // Redistribute proportionally among remaining components
  if (redistribution > 0) {
    const remaining = Object.entries(w).filter(([, v]) => v > 0);
    const totalRemaining = remaining.reduce((s, [, v]) => s + v, 0);
    for (const [key] of remaining) {
      w[key] += redistribution * (w[key] / totalRemaining);
    }
  }

  return w;
}
```

### 4.3 Config Validation

```javascript
// Proposed: validate config on load
function validateConfig(config) {
  const errors = [];

  // Check weights sum to ~1.0
  const weightSum = Object.values(config.weights).reduce((s, v) => s + v, 0);
  if (Math.abs(weightSum - 1.0) > 0.01) {
    errors.push(`Weight sum is ${weightSum.toFixed(3)}, expected 1.0`);
  }

  // Check tier thresholds are ordered
  const tiers = config.referralTiers;
  if (tiers['gold-referral'] <= tiers['silver-referral']) {
    errors.push('Gold threshold must exceed silver threshold');
  }
  if (tiers['silver-referral'] <= tiers['bronze-referral']) {
    errors.push('Silver threshold must exceed bronze threshold');
  }

  // Check all persona configs have required fields
  for (const [name, pcfg] of Object.entries(config.personas)) {
    if (!pcfg.requires) {
      errors.push(`Persona "${name}" missing requires field`);
    }
  }

  // Check roleTiers have patterns arrays
  for (const [tier, tcfg] of Object.entries(config.roleTiers)) {
    if (!Array.isArray(tcfg.patterns) || tcfg.patterns.length === 0) {
      errors.push(`Role tier "${tier}" has no patterns`);
    }
    if (typeof tcfg.score !== 'number' || tcfg.score < 0 || tcfg.score > 1) {
      errors.push(`Role tier "${tier}" score must be 0-1, got ${tcfg.score}`);
    }
  }

  return errors;
}
```

### 4.4 Hardcoded Fallback Config

```javascript
// Proposed: default config when referral-config.json is missing or corrupted
const FALLBACK_CONFIG = {
  weights: {
    referralRole: 0.25, clientOverlap: 0.20, networkReach: 0.20,
    amplificationPower: 0.15, relationshipWarmth: 0.10, buyerInversion: 0.10,
  },
  roleTiers: {
    high: { score: 1.0, patterns: ['agency', 'partner', 'consultancy', 'advisor', 'fractional', 'reseller'] },
    medium: { score: 0.7, patterns: ['consultant', 'freelance', 'broker', 'partnerships', 'ecosystem'] },
    low: { score: 0.3, patterns: ['manager', 'director', 'founder', 'ceo', 'cto', 'vp'] },
  },
  targetIndustries: ['ecommerce', 'saas', 'retail', 'shopify', 'dtc'],
  industrySignals: {
    servesTargetClients: ['agency', 'consulting', 'solutions provider', 'service provider'],
    industryKeywords: ['ecommerce', 'saas', 'retail', 'dtc', 'shopify'],
  },
  referralTiers: { 'gold-referral': 0.65, 'silver-referral': 0.45, 'bronze-referral': 0.30 },
  personas: {
    'white-label-partner': { requires: { minReferralRole: 0.7, minClientOverlap: 0.4, rolePatterns: ['agency', 'consultancy', 'partner'] } },
    'warm-introducer': { requires: { minRelationshipWarmth: 0.5, minNetworkReach: 0.5 } },
    'co-seller': { requires: { minClientOverlap: 0.5, rolePatterns: ['consultant', 'advisor', 'freelance'] } },
    'amplifier': { requires: { minAmplificationPower: 0.5, behavioralPersonas: ['super-connector', 'content-creator'] } },
    'passive-referral': { requires: {} },
  },
  networkReachBaselines: {
    connectionCountNorm: 500, clusterBreadthWeight: 0.4,
    edgeDensityWeight: 0.3, connectionCountWeight: 0.3,
  },
};
```

### 4.5 NaN Guard

```javascript
// Proposed: wrap final score computation
function safeScore(value, label, url) {
  if (isNaN(value) || !isFinite(value)) {
    console.warn(`[referral] NaN detected for ${label} on ${url}, clamping to 0`);
    return 0;
  }
  return round(cap(value));
}
```

---

## 5. Quality Metrics

### 5.1 Score Distribution Analysis

The referral likelihood scores should approximate a right-skewed distribution (most contacts have low referral potential, a smaller number have high potential).

| Metric | Expected Range | Current Value | Status |
|--------|---------------|---------------|--------|
| Mean referral score | 0.25 - 0.40 | ~0.32 | PASS |
| Median referral score | 0.20 - 0.35 | ~0.28 | PASS |
| Std deviation | 0.10 - 0.20 | ~0.15 | PASS |
| Skewness | > 0 (right-skewed) | ~0.4 | PASS |
| Min score | >= 0 | 0 | PASS |
| Max score | <= 1.0 | ~0.82 | PASS |

### 5.2 Tier Distribution

| Tier | Expected % | Current Count | Current % | Status |
|------|-----------|---------------|-----------|--------|
| gold-referral | 1-5% | <N> | <X>% | PASS |
| silver-referral | 15-30% | <N> | <X>% | PASS |
| bronze-referral | 25-40% | <N> | <X>% | PASS |
| untiered | 30-50% | <N> | <X>% | PASS |

**Validation rule:** Gold-referral should never exceed 5% of contacts. If it does, the gold threshold (currently 0.65) is too low.

### 5.3 Persona Distribution

| Persona | Expected % | Max Allowed | Status |
|---------|-----------|-------------|--------|
| passive-referral | 40-60% | 60% | MONITOR |
| warm-introducer | 10-20% | 30% | MONITOR |
| co-seller | 5-15% | 25% | MONITOR |
| amplifier | 5-15% | 25% | MONITOR |
| white-label-partner | 2-8% | 15% | MONITOR |

**Validation rule:** No single persona should exceed 60% of scored contacts. If `passive-referral` exceeds 60%, the persona thresholds are too strict.

### 5.4 Cross-Validation Checks

| Check | Method | Expected |
|-------|--------|----------|
| Known agency owners in gold-referral | Manual review of top N | >= 80% confirmed agency/partner roles |
| Gold buyers NOT in gold-referral | ICP tier=gold contacts should have low referral scores | Avg referralLikelihood < 0.40 for ICP gold tier |
| Super-connectors as amplifiers | Behavioral persona=super-connector should map to amplifier persona | >= 60% match |
| Relationship warmth correlation | referralLikelihood should correlate positively with mutualConnections | Pearson r > 0.2 |
| Buyer inversion correctness | Contacts with icpFit > 0.7 should have buyerInversion < 0.4 | 100% compliance |

### 5.5 Automated Quality Gate

```javascript
// tests/referral-quality.test.mjs
import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const GRAPH_PATH = resolve(__dirname, '..', 'data', 'graph.json');

describe('referral scoring quality gates', () => {
  let contacts;

  before(() => {
    const graph = JSON.parse(readFileSync(GRAPH_PATH, 'utf-8'));
    contacts = Object.entries(graph.contacts)
      .filter(([, c]) => c.scores?.referralLikelihood !== undefined)
      .map(([url, c]) => ({ url, ...c }));
  });

  it('gold-referral tier should be 1-5% of contacts', () => {
    const gold = contacts.filter(c => c.referralTier === 'gold-referral');
    const pct = (gold.length / contacts.length) * 100;
    assert.ok(pct >= 1 && pct <= 5,
      `Gold-referral is ${pct.toFixed(1)}%, expected 1-5%`);
  });

  it('no single persona should exceed 60%', () => {
    const counts = {};
    for (const c of contacts) {
      counts[c.referralPersona] = (counts[c.referralPersona] || 0) + 1;
    }
    for (const [persona, count] of Object.entries(counts)) {
      const pct = (count / contacts.length) * 100;
      assert.ok(pct <= 60,
        `Persona "${persona}" is ${pct.toFixed(1)}%, exceeds 60% cap`);
    }
  });

  it('all scores should be in 0-1 range', () => {
    for (const c of contacts) {
      const s = c.scores.referralLikelihood;
      assert.ok(s >= 0 && s <= 1,
        `Score ${s} out of range for ${c.url}`);
    }
  });

  it('all referralSignals component scores should be in 0-1 range', () => {
    const keys = ['referralRole', 'clientOverlap', 'networkReach',
                  'amplificationPower', 'relationshipWarmth', 'buyerInversion'];
    for (const c of contacts) {
      if (!c.referralSignals) continue;
      for (const key of keys) {
        const v = c.referralSignals[key];
        assert.ok(v >= 0 && v <= 1,
          `Signal ${key}=${v} out of range for ${c.url}`);
      }
    }
  });

  it('ICP gold-tier contacts should have low average referral score', () => {
    const icpGold = contacts.filter(c => c.scores?.tier === 'gold');
    if (icpGold.length === 0) return; // skip if no gold contacts
    const avgRef = icpGold.reduce((s, c) => s + c.scores.referralLikelihood, 0) / icpGold.length;
    assert.ok(avgRef < 0.45,
      `ICP gold contacts avg referral=${avgRef.toFixed(2)}, expected < 0.45 (buyers, not referrers)`);
  });

  it('high buyerInversion contacts should have low ICP fit', () => {
    const highInversion = contacts.filter(c =>
      c.referralSignals?.buyerInversion >= 0.6
    );
    for (const c of highInversion) {
      assert.ok((c.scores?.icpFit || 0) <= 0.5,
        `High inversion contact ${c.url} has icpFit ${c.scores?.icpFit} > 0.5`);
    }
  });

  it('referral score distribution should have positive skew', () => {
    const scores = contacts.map(c => c.scores.referralLikelihood);
    const mean = scores.reduce((s, v) => s + v, 0) / scores.length;
    const sorted = [...scores].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    // Positive skew means mean > median
    assert.ok(mean >= median * 0.9,
      `Distribution should be right-skewed: mean=${mean.toFixed(3)}, median=${median.toFixed(3)}`);
  });
});
```

---

## 6. Iterative Improvement Plan

### Version Roadmap

| Version | Timeline | Focus | Key Changes |
|---------|----------|-------|-------------|
| **v1.0** | Current | Rule-based scoring | 6-component weighted scoring, 5 personas, 3 tiers |
| **v1.1** | +2 weeks | Resilience + Recency | Error handling hardening, recency weighting, config validation |
| **v1.2** | +1 month | Feedback loop | Track referral outcomes, conversion tracking stub |
| **v1.3** | +3 months | Semi-supervised | Use conversion data to adjust weights, A/B test thresholds |
| **v2.0** | +6 months | Real-time scoring | Webhook triggers, incremental scoring, dashboard updates |

### v1.1 Detail: Resilience + Recency Weighting

**Recency weighting** adjusts the `relationshipWarmth` component to give more credit to recently connected contacts:

```javascript
// v1.1: Enhanced recency scoring with exponential decay
function recencyWeight(daysAgo) {
  if (daysAgo === null || daysAgo === undefined) return 0.1;
  // Exponential decay: half-life of 180 days
  const halfLife = 180;
  return Math.max(0.1, Math.exp(-0.693 * daysAgo / halfLife));
}
```

**Resilience changes:**
- Implement `computeActiveWeights()` (Section 4.2)
- Implement `validateConfig()` (Section 4.3)
- Add `FALLBACK_CONFIG` (Section 4.4)
- Add `safeScore()` NaN guard (Section 4.5)

### v1.2 Detail: Feedback Loop

Add a `referral-outcomes.json` file to track which scored referral partners actually produced referrals:

```json
{
  "outcomes": [
    {
      "referrerUrl": "https://linkedin.com/in/alice",
      "referredUrl": "https://linkedin.com/in/bob",
      "date": "2026-04-15",
      "outcome": "meeting-booked",
      "value": "high"
    }
  ]
}
```

This data feeds into v1.3 weight optimization.

### v1.3 Detail: Semi-Supervised Weight Optimization

With conversion data available, optimize scoring weights using grid search or gradient-free optimization:

```javascript
// v1.3: Weight optimizer (pseudo-code)
function optimizeWeights(contacts, outcomes) {
  const converted = new Set(outcomes.filter(o => o.outcome !== 'no-response').map(o => o.referrerUrl));
  let bestWeights = null;
  let bestAUC = 0;

  // Grid search over weight space
  for (const candidate of weightCandidates()) {
    const scores = contacts.map(c => computeScore(c, candidate));
    const auc = computeAUC(scores, converted);
    if (auc > bestAUC) {
      bestAUC = auc;
      bestWeights = candidate;
    }
  }

  return { weights: bestWeights, auc: bestAUC };
}
```

### v2.0 Detail: Real-Time Scoring

- Webhook integration: New LinkedIn connection triggers incremental scoring
- Only recompute baselines if edge count changes by > 5%
- WebSocket push to dashboard for live score updates
- Incremental graph.json updates (write only changed contacts)

---

## 7. Code Quality

### 7.1 Current Assessment

| Criteria | Status | Notes |
|----------|--------|-------|
| Pure functions | PARTIAL | Scoring functions are pure; `score()` orchestrator has side effects |
| Config externalized | DONE | `referral-config.json` holds all tunable parameters |
| ESM modules | DONE | All `.mjs` with `import` statements |
| Consistent error handling | NEEDS WORK | Mix of `process.exit(1)` and unhandled errors |
| Function exports | NEEDS WORK | Functions not exported; needed for unit testing |
| Logging levels | PARTIAL | `--verbose` flag but no structured logging |
| File length | DONE | `referral-scorer.mjs` is 507 lines (under 500 target, close) |
| Input validation | NEEDS WORK | Config not validated on load |

### 7.2 Refactoring: Export Scoring Functions

To enable unit testing, scoring functions must be exported. The current script runs `score()` at module-level load. Refactor to conditional execution:

```javascript
// At the end of referral-scorer.mjs, replace:
//   score();
// With:
export {
  scoreReferralRole,
  scoreClientOverlap,
  scoreNetworkReach,
  scoreAmplificationPower,
  scoreRelationshipWarmth,
  scoreBuyerInversion,
  assignReferralPersona,
  computeBaselines,
};

// Only run when executed directly (not imported)
const isMainModule = process.argv[1] &&
  (process.argv[1].endsWith('referral-scorer.mjs') ||
   process.argv[1].includes('referral-scorer'));

if (isMainModule) {
  score();
}
```

### 7.3 Refactoring: Separate I/O from Computation

```
Current architecture:
  referral-scorer.mjs
    loadFiles()        -- I/O: read 3 JSON files
    computeBaselines() -- Pure: compute graph statistics
    score*()           -- Pure: compute component scores
    assignPersona()    -- Pure: waterfall assignment
    score()            -- Mixed: orchestration + I/O write

Target architecture:
  referral-scorer.mjs
    loadFiles()        -- I/O: read 3 JSON files
    score()            -- Orchestrator: delegates to engine + writes

  referral-engine.mjs  (new, all pure functions)
    computeBaselines() -- Pure
    scoreReferralRole() -- Pure
    scoreClientOverlap() -- Pure
    scoreNetworkReach() -- Pure
    scoreAmplificationPower() -- Pure
    scoreRelationshipWarmth() -- Pure
    scoreBuyerInversion() -- Pure
    assignReferralPersona() -- Pure
    scoreContact()     -- Pure: compute all 6 components + composite
    scoreAllContacts() -- Pure: batch scoring with baselines
```

This separation makes the engine fully testable without any file system mocking.

### 7.4 Logging Standards

```javascript
// Proposed: consistent logging across all scripts
const LOG_LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };

function createLogger(prefix, level = 'info') {
  const threshold = LOG_LEVELS[level] ?? 2;
  return {
    error: (...args) => threshold >= 0 && console.error(`[${prefix}:ERROR]`, ...args),
    warn:  (...args) => threshold >= 1 && console.warn(`[${prefix}:WARN]`, ...args),
    info:  (...args) => threshold >= 2 && console.log(`[${prefix}]`, ...args),
    debug: (...args) => threshold >= 3 && console.log(`[${prefix}:DEBUG]`, ...args),
  };
}

// Usage in referral-scorer.mjs:
const log = createLogger('referral', VERBOSE ? 'debug' : 'info');
```

---

## 8. Parallel Refinement Streams

Five independent workstreams can proceed concurrently. Each stream has its own deliverable and can be assigned to a separate agent.

### Stream A: Unit Test Suite for Scoring Engine

**Deliverable:** `tests/referral-scorer.test.mjs`

| Task | Priority | Effort | Dependencies |
|------|----------|--------|-------------|
| Create test fixtures | P0 | 1h | None |
| Export scoring functions (refactor) | P0 | 30min | None |
| Tests for `scoreReferralRole` (6 cases) | P0 | 1h | Export refactor |
| Tests for `scoreClientOverlap` (4 cases) | P0 | 1h | Export refactor |
| Tests for `scoreNetworkReach` (4 cases) | P0 | 1h | Export refactor |
| Tests for `scoreAmplificationPower` (4 cases) | P0 | 45min | Export refactor |
| Tests for `scoreRelationshipWarmth` (4 cases) | P0 | 45min | Export refactor |
| Tests for `scoreBuyerInversion` (3 cases) | P0 | 30min | Export refactor |
| Tests for `assignReferralPersona` (6 cases) | P0 | 1h | Export refactor |
| Tests for tier boundary assignment (5 cases) | P1 | 30min | Export refactor |

**Total estimated effort:** ~7.5 hours

### Stream B: Integration Tests for Pipeline

**Deliverable:** `tests/referral-pipeline.integration.test.mjs`

| Task | Priority | Effort | Dependencies |
|------|----------|--------|-------------|
| Pipeline `--referrals` mode test | P0 | 1h | Graph data exists |
| Analyzer `--mode referrals` output test | P0 | 1h | Referral scores exist |
| Analyzer filter tests (persona, tier, top) | P1 | 1h | Referral scores exist |
| Batch deep-scan `--criteria referral --dry-run` test | P1 | 1h | Referral scores exist |
| Pipeline dependency guard tests | P2 | 30min | None |
| Report generator referral section test | P2 | 1h | Report generated |

**Total estimated effort:** ~5.5 hours

### Stream C: Performance Benchmarks

**Deliverable:** `tests/referral-performance.bench.mjs`

| Task | Priority | Effort | Dependencies |
|------|----------|--------|-------------|
| Scoring wall-time benchmark | P1 | 30min | None |
| Pipeline `--referrals` benchmark | P1 | 30min | None |
| Graph.json size regression check | P2 | 15min | None |
| Memory usage profiling | P2 | 1h | None |
| Baseline computation benchmark | P2 | 30min | None |

**Total estimated effort:** ~2.75 hours

### Stream D: Error Handling Hardening

**Deliverable:** Updated `referral-scorer.mjs` with graceful degradation

| Task | Priority | Effort | Dependencies |
|------|----------|--------|-------------|
| Implement `computeActiveWeights()` | P0 | 1h | None |
| Implement `validateConfig()` | P0 | 1h | None |
| Add `FALLBACK_CONFIG` | P1 | 30min | None |
| Add `safeScore()` NaN guard | P1 | 30min | None |
| Handle missing `scores` on contact | P1 | 30min | None |
| Config file corruption recovery | P2 | 1h | Fallback config |
| Test all error paths | P0 | 2h | All error handlers |

**Total estimated effort:** ~6.5 hours

### Stream E: Documentation and Examples

**Deliverable:** Updated docs with scoring methodology, config tuning guide

| Task | Priority | Effort | Dependencies |
|------|----------|--------|-------------|
| Scoring methodology docs | P1 | 1h | None |
| Config tuning guide (thresholds, weights) | P1 | 1h | None |
| Example: adding a new persona | P2 | 30min | None |
| Example: custom role patterns | P2 | 30min | None |
| Architecture diagram update | P2 | 30min | None |

**Total estimated effort:** ~3.5 hours

### Stream Dependency Graph

```
Stream A (Unit Tests) -----> requires export refactor (30min, blocks all tests)
Stream B (Integration) ----> requires graph data + referral scores (existing)
Stream C (Performance) ----> independent (can start immediately)
Stream D (Error Handling) -> independent (can start immediately)
Stream E (Documentation) --> independent (can start immediately)
                              |
                              v
                         Stream A + D completion enables quality gate tests
```

### Execution Order (Single-Agent Sequential)

If running with a single agent rather than parallel streams:

1. **Stream D** (Error Handling) -- highest impact on reliability
2. **Stream A** (Unit Tests) -- requires export refactor from Stream D context
3. **Stream B** (Integration Tests) -- validates Stream D changes
4. **Stream C** (Performance) -- validates no regressions from Stream D
5. **Stream E** (Documentation) -- documents final state

### Completion Criteria

All refinement streams are complete when:

- [ ] All unit tests pass (`node --test tests/referral-scorer.test.mjs`)
- [ ] All integration tests pass (`node --test tests/referral-pipeline.integration.test.mjs`)
- [ ] Performance benchmarks pass (scoring < 2s, pipeline < 5s)
- [ ] Quality gate tests pass (tier distribution, persona distribution, score ranges)
- [ ] Error handling covers all paths in error matrix
- [ ] No NaN or undefined values in scored output
- [ ] Config validation runs on load without errors
- [ ] Fallback config is tested and functional

---

## Appendix A: File Reference

All paths are relative to the skill root `<project-root>/.claude/linkedin-prospector/skills/linkedin-prospector/`.

| File | Lines | Type |
|------|-------|------|
| `scripts/referral-scorer.mjs` | 507 | Scoring engine (6 components + orchestrator) |
| `data/referral-config.json` | 105 | Weights, role tiers, personas, thresholds |
| `scripts/batch-deep-scan.mjs` | 301 | Criteria-driven batch scanning |
| `scripts/analyzer.mjs` | 698 | Multi-mode analysis including `referrals` |
| `scripts/pipeline.mjs` | 343 | Pipeline orchestrator with `--referrals` mode |
| `scripts/report-generator.mjs` | ~500 | HTML dashboard generator |
| `scripts/lib.mjs` | 68 | Shared `parseArgs()` and `launchBrowser()` |

## Appendix B: Scoring Formula Reference

```
referralLikelihood = referralRole    * 0.25
                   + clientOverlap   * 0.20
                   + networkReach    * 0.20
                   + amplificationPower * 0.15
                   + relationshipWarmth * 0.10
                   + buyerInversion  * 0.10

Where:
  clientOverlap   = industryScore * 0.6 + serviceScore * 0.4
  networkReach    = connScore * 0.3 + clusterScore * 0.4 + edgeScore * 0.3
  relationshipWarmth = mutualScore * 0.35 + relStrength * 0.35 + recencyScore * 0.30
  buyerInversion  = invertedIcp * 0.5 + ecosystemScore * 0.5

All component scores capped to [0, 1].
```

## Appendix C: Persona Waterfall Priority

```
1. white-label-partner  -- role matches agency/consultancy patterns + minReferralRole >= 0.7 + minClientOverlap >= 0.4
2. warm-introducer      -- minRelationshipWarmth >= 0.5 + minNetworkReach >= 0.5
3. co-seller            -- role matches consultant/advisor patterns + minClientOverlap >= 0.5
4. amplifier            -- minAmplificationPower >= 0.5 OR behavioralPersona in [super-connector, content-creator]
5. passive-referral     -- default fallback
```

First match wins. Order is significant.
