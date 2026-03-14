// Graph analytics type definitions

export interface GraphMetrics {
  contactId: string;
  pagerank: number | null;
  betweennessCentrality: number | null;
  closenessCentrality: number | null;
  degreeCentrality: number | null;
  eigenvectorCentrality: number | null;
  clusteringCoefficient: number | null;
  computedAt: string;
}

export interface Cluster {
  id: string;
  label: string;
  description: string | null;
  algorithm: string;
  memberCount: number;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface ClusterMembership {
  contactId: string;
  clusterId: string;
  membershipScore: number;
}

export interface GraphEdge {
  id: string;
  sourceContactId: string;
  targetContactId: string | null;
  targetCompanyId: string | null;
  edgeType: string;
  weight: number;
  properties: Record<string, unknown>;
}

export interface PathResult {
  path: string[];
  length: number;
  edges: Array<{
    from: string;
    to: string;
    edgeType: string;
    weight: number;
  }>;
}

export interface CommunityResult {
  clusterId: string;
  label: string;
  members: string[];
  memberCount: number;
  cohesion: number;
}

export interface IcpDiscoveryResult {
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
