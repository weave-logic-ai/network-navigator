/** Relationship types published into the contact graph and used by path fallback. */
export const PUBLISHED_GRAPH_EDGE_TYPES = [
  "CONNECTED_TO",
  "MESSAGED",
  "same-company",
  "INVITED_BY",
  "ENDORSED",
  "RECOMMENDED",
] as const;
