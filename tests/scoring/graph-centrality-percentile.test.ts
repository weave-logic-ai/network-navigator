import { GraphCentralityScorer, graphCentralityPercentile, rawGraphCentrality } from '@/lib/scoring/scorers/graph-centrality';
import type { ContactScoringData } from '@/lib/scoring/types';

const metrics = (degreeCentrality: number, betweenness = 0.001, pagerank = 0.0011) =>
  ({ pagerank, betweenness, degreeCentrality });

test('raw centrality is near-flat on a star network, which is why it is ranked', () => {
  // Uniform PageRank (1/918) and tiny betweenness: 1 vs 5 graph connections
  // differ by only ~0.05 in absolute terms.
  expect(rawGraphCentrality(metrics(5)) - rawGraphCentrality(metrics(1))).toBeLessThan(0.06);
});

test('percentile is the share of contacts strictly below, spanning 0..1', () => {
  const distribution = [0.01, 0.02, 0.02, 0.03, 0.05];
  expect(graphCentralityPercentile(0.01, distribution)).toBe(0);
  expect(graphCentralityPercentile(0.02, distribution)).toBe(0.25);
  expect(graphCentralityPercentile(0.03, distribution)).toBe(0.75);
  expect(graphCentralityPercentile(0.05, distribution)).toBe(1);
  expect(graphCentralityPercentile(0.5, distribution)).toBe(1);
  expect(graphCentralityPercentile(0, distribution)).toBe(0);
});

test('ties share a rank and tiny networks cannot be ranked', () => {
  expect(graphCentralityPercentile(0.02, [0.02, 0.02, 0.02])).toBe(0);
  expect(graphCentralityPercentile(0.02, [0.02])).toBeNull();
  expect(graphCentralityPercentile(0.02, [])).toBeNull();
});

test('scorer uses the owner percentile when present and raw metrics otherwise', () => {
  const scorer = new GraphCentralityScorer();
  const contact = { ...metrics(5) } as unknown as ContactScoringData;
  expect(scorer.score(contact)).toBeCloseTo(rawGraphCentrality(metrics(5)));
  expect(scorer.score({ ...contact, graphCentralityPercentile: 0.8 })).toBe(0.8);
  expect(scorer.score({ ...contact, graphCentralityPercentile: 0 })).toBe(0);
});
