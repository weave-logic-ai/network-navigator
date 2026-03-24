// Taxonomy hierarchy types: Industry → Niche → ICP → Offering

export interface Industry {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface IndustryWithNiches extends Industry {
  niches: NicheProfile[];
  nicheCount: number;
}

export interface NicheProfile {
  id: string;
  industryId: string | null;
  name: string;
  description: string | null;
  keywords: string[];
  companySizeRange: string | null;
  geoFocus: string[];
  memberCount: number;
  affordability: number | null;
  fitability: number | null;
  buildability: number | null;
  nicheScore: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface NicheWithIcps extends NicheProfile {
  icps: IcpProfileWithNiche[];
  icpCount: number;
  industry?: Industry;
}

export interface IcpProfileWithNiche {
  id: string;
  nicheId: string | null;
  name: string;
  description: string | null;
  isActive: boolean;
  criteria: Record<string, unknown>;
  weightOverrides: Record<string, number>;
  createdAt: string;
  updatedAt: string;
}

export interface TaxonomyChain {
  industry: Industry | null;
  niche: NicheProfile | null;
  icp: IcpProfileWithNiche | null;
}

export interface DiscoveredIcp {
  suggestedName: string;
  description: string;
  criteria: {
    titlePatterns: string[];
    industries: string[];
    companySizes: string[];
    locations: string[];
  };
  contactCount: number;
  sampleContactIds: string[];
  confidence: number;
}

export interface SaveDiscoveryResult {
  action: 'created' | 'skipped';
  id?: string;
  existingId?: string;
  reason?: 'duplicate_name' | 'criteria_overlap';
  overlap?: number;
}
