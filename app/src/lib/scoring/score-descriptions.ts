// Score math tooltip descriptions for every dimension and referral component.
// Used by UI components to render hover tooltips explaining each score's formula.

export const DIMENSION_LABELS: Record<string, string> = {
  icp_fit: 'ICP Fit',
  network_hub: 'Network Hub',
  relationship_strength: 'Relationship',
  signal_boost: 'Signal Boost',
  skills_relevance: 'Skills',
  network_proximity: 'Proximity',
  behavioral: 'Behavioral',
  content_relevance: 'Content',
  graph_centrality: 'Centrality',
};

/** Short math descriptions for each scoring dimension, shown as tooltips */
export const DIMENSION_DESCRIPTIONS: Record<string, string> = {
  icp_fit:
    'Matches role, industry, signal keywords, company size, location, and connections against your ICP criteria. Score = matched_criteria / total_criteria.',
  network_hub:
    'Evaluates connection power: avg(mutuals/50, edges/20, connections/500, degreeCentrality/30). Higher = more connected.',
  relationship_strength:
    'Degree base (1st=1.0, 2nd=0.5) + mutuals/30 + profile completeness (tags, about, location). Averaged across factors.',
  signal_boost:
    'Counts AI/tech/business keyword matches in headline, title, about, and tags. Score = matches/5 (capped at 1.0).',
  skills_relevance:
    'Matches skills against ICP signal keywords. Score = matched_skills / total_icp_signals. Falls back to headline text.',
  network_proximity:
    'Degree closeness (1st=1.0, 2nd=0.5) + mutuals/20 + edges/15. Averaged across available factors.',
  behavioral:
    'Weighted: connectionPower(0.20) + recency(0.15) + aboutSignals(0.25) + headlineSignals(0.15) + superConnector(0.15) + amplifier(0.10). Null components redistributed.',
  content_relevance:
    'Matches content topics against ICP signals. Score = matched_topics / total_signals. Falls back to about/headline at 50% weight.',
  graph_centrality:
    'avg(PageRank, betweenness, degreeCentrality/25). Measures structural importance in the contact graph.',
};

/** Labels for referral scoring components */
export const REFERRAL_LABELS: Record<string, string> = {
  referralRole: 'Referral Role',
  clientOverlap: 'Client Overlap',
  networkReach: 'Network Reach',
  amplificationPower: 'Amplification',
  relationshipWarmth: 'Warmth',
  buyerInversion: 'Buyer Inversion',
};

/** Math descriptions for referral scoring components */
export const REFERRAL_DESCRIPTIONS: Record<string, string> = {
  referralRole:
    'Role pattern matching: agency/partner/advisor=1.0, consultant/freelance=0.7, director/founder=0.3. Null if no match.',
  clientOverlap:
    'industryMatch/3 \u00d7 0.6 + serviceSignals/2 \u00d7 0.4. Measures industry alignment and service provider signals.',
  networkReach:
    'connections/500 \u00d7 0.30 + clusters/totalClusters \u00d7 0.40 + edges/p90Edges \u00d7 0.30. Network breadth score.',
  amplificationPower:
    'Traits(3+=0.4) + helpingLanguage(2+=0.3) + contentCreator(0.3). Capped at 1.0. Measures broadcast ability.',
  relationshipWarmth:
    'mutuals/p90 \u00d7 0.35 + relationshipStrength \u00d7 0.35 + recency \u00d7 0.30. Strength of existing relationship.',
  buyerInversion:
    '(1 \u2212 goldScore) \u00d7 0.5 + ecosystemKeywords/3 \u00d7 0.5. High when contact is a connector, not a buyer.',
};

/** Composite score description */
export const COMPOSITE_DESCRIPTION =
  'Weighted sum of all dimension scores. Weights redistributed proportionally when dimensions lack data. Tier assigned by degree-specific thresholds.';

/** Referral likelihood description */
export const REFERRAL_LIKELIHOOD_DESCRIPTION =
  'Weighted sum of 6 referral components. Gold \u2265 65%, Silver \u2265 45%, Bronze \u2265 30%. Null components weight-redistributed.';

/** Tier descriptions */
export const TIER_DESCRIPTIONS: Record<string, string> = {
  gold: '1st-degree: \u2265 55% composite. Top-tier prospect with strong ICP fit and network position.',
  silver: '1st-degree: 40\u201354%. Good prospect with moderate signals across multiple dimensions.',
  bronze: '1st-degree: 28\u201339%. Some potential signals detected. May improve with enrichment.',
  watch: '1st-degree: < 28%. Limited signals. Monitor for future activity or enrichment data.',
  unscored: 'Not yet scored. Trigger scoring via enrichment or manual rescore.',
  'gold-referral': '\u2265 65% referral likelihood. Strong referral partner with high network reach.',
  'silver-referral': '45\u201364% referral likelihood. Moderate referral potential.',
  'bronze-referral': '30\u201344% referral likelihood. Some referral signals detected.',
  'watch-referral': '< 30% referral likelihood. Low referral potential.',
};

/** Persona descriptions */
export const PERSONA_DESCRIPTIONS: Record<string, string> = {
  buyer: 'High ICP fit (\u2265 60%) + relationship strength (\u2265 40%). Most likely to convert.',
  'warm-lead': 'Moderate ICP fit (\u2265 40%) + some relationship (\u2265 30%). Warm prospect.',
  advisor: 'Strong relationship (\u2265 60%) + some ICP fit. Potential advisor or champion.',
  hub: 'High network hub score (\u2265 60%). Well-connected but not a direct buyer.',
  'active-influencer': 'High behavioral (\u2265 60%) + content relevance (\u2265 40%). Creates and shares content.',
  'passive-contact': '1st or 2nd degree connection with limited scoring signals.',
  unknown: 'Insufficient data to classify persona.',
};

/** Behavioral persona descriptions */
export const BEHAVIORAL_PERSONA_DESCRIPTIONS: Record<string, string> = {
  'super-connector': '3+ connector traits AND 500+ connections. Bridges multiple networks.',
  'content-creator': 'Speaker/author keywords detected. Actively creates and shares content.',
  'silent-influencer': '500+ connections but few behavioral signals. Influential but quiet.',
  'rising-connector': '< 500 connections, connected recently (\u2264 180 days). Growing network.',
  'engaged-professional': 'Moderate behavioral signals. Actively engaged professionally.',
  'passive-observer': 'Few behavioral signals detected. Primarily observes.',
  'data-insufficient': 'Fewer than 2 behavioral components available for scoring.',
  unknown: 'Insufficient data to classify behavioral persona.',
};

/** Referral persona descriptions */
export const REFERRAL_PERSONA_DESCRIPTIONS: Record<string, string> = {
  'white-label-partner': 'Agency/consultancy role + high referral role (\u2265 70%) + client overlap (\u2265 40%).',
  'warm-introducer': 'Relationship warmth \u2265 50% + network reach \u2265 50%. Can make warm intros.',
  'co-seller': 'Consultant/advisor/freelance role + client overlap \u2265 50%. Potential co-selling partner.',
  amplifier: 'Amplification power \u2265 50% or super-connector/content-creator persona. Broadcasts to network.',
  'passive-referral': 'Default. Limited referral signals but may refer organically.',
};
