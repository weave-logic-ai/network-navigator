// ICP Fit engine checks — coverage gaps, zero matches, concentration

import { query } from '../../db/client';
import { contextHash } from '../engine';
import type { TickContext, GoalCandidate, GoalCheck } from '../types';

const CHECK_NICHE_COVERAGE = 'niche-coverage-gap';
const CHECK_ICP_ZERO = 'icp-zero-matches';
const CHECK_UNADDRESSED = 'unaddressed-network';

async function nicheCoverageGap(ctx: TickContext): Promise<GoalCandidate[]> {
  if (!ctx.selectedNicheId) return [];

  const result = await query<{ name: string; member_count: string; keywords: string[] }>(
    'SELECT name, member_count::text, keywords FROM niche_profiles WHERE id = $1',
    [ctx.selectedNicheId]
  );
  if (result.rows.length === 0) return [];

  const niche = result.rows[0];
  const count = parseInt(niche.member_count, 10);

  if (count >= 15) return []; // Already well-covered

  const hash = contextHash(CHECK_NICHE_COVERAGE, { nicheId: ctx.selectedNicheId });

  return [{
    title: `Grow "${niche.name}" — only ${count} contacts`,
    description: `Your "${niche.name}" niche has ${count} matching contacts. Target 15+ for meaningful coverage. Use LinkedIn search with niche keywords to find more.`,
    goalType: CHECK_NICHE_COVERAGE,
    priority: count < 5 ? 2 : 4,
    targetMetric: 'niche_member_count',
    targetValue: 15,
    currentValue: count,
    metadata: {
      engine: 'icp_fit',
      checkType: CHECK_NICHE_COVERAGE,
      contextHash: hash,
      suggestedTasks: [
        {
          title: `Search LinkedIn for "${niche.name}" contacts`,
          description: `Search LinkedIn People for contacts matching: ${(niche.keywords ?? []).join(', ')}`,
          taskType: 'expand_network',
          priority: 2,
          url: `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent((niche.keywords ?? []).slice(0, 3).join(' '))}`,
        },
        {
          title: `Review "${niche.name}" niche keywords`,
          description: `Check if the keywords [${(niche.keywords ?? []).join(', ')}] are specific enough. Adjust to improve matching.`,
          taskType: 'manual',
          priority: 3,
        },
      ],
    },
  }];
}

async function icpZeroMatches(ctx: TickContext): Promise<GoalCandidate[]> {
  if (!ctx.selectedIcpId) return [];

  const result = await query<{ name: string; criteria: Record<string, unknown> }>(
    'SELECT name, criteria FROM icp_profiles WHERE id = $1 AND is_active = TRUE',
    [ctx.selectedIcpId]
  );
  if (result.rows.length === 0) return [];

  const icp = result.rows[0];
  const roles = Array.isArray(icp.criteria?.roles) ? icp.criteria.roles as string[] : [];
  const industries = Array.isArray(icp.criteria?.industries) ? icp.criteria.industries as string[] : [];

  if (roles.length === 0 && industries.length === 0) return [];

  // Quick count check
  const conditions: string[] = [];
  const params: unknown[] = [];
  let idx = 1;

  if (roles.length > 0) {
    conditions.push(`(${roles.map(r => { params.push(r); return `c.title ILIKE '%' || $${idx++} || '%'`; }).join(' OR ')})`);
  }
  if (industries.length > 0) {
    conditions.push(`(${industries.map(ind => { params.push(ind); const p = idx++; return `c.headline ILIKE '%' || $${p} || '%'`; }).join(' OR ')})`);
  }

  const where = conditions.join(' AND ');
  const countResult = await query<{ c: string }>(
    `SELECT count(*)::text AS c FROM contacts c WHERE c.is_archived = FALSE AND c.degree > 0 AND (${where})`,
    params
  );
  const matchCount = parseInt(countResult.rows[0].c, 10);

  if (matchCount > 0) return [];

  const hash = contextHash(CHECK_ICP_ZERO, { icpId: ctx.selectedIcpId });
  const searchTerms = [...roles.slice(0, 2), ...industries.slice(0, 2)].join(' ');

  return [{
    title: `No contacts match "${icp.name}" ICP`,
    description: `Your "${icp.name}" ICP has zero matching contacts. Search LinkedIn for people matching: ${roles.join(', ')} in ${industries.join(', ')}.`,
    goalType: CHECK_ICP_ZERO,
    priority: 2,
    targetMetric: 'icp_match_count',
    targetValue: 10,
    currentValue: 0,
    metadata: {
      engine: 'icp_fit',
      checkType: CHECK_ICP_ZERO,
      contextHash: hash,
      suggestedTasks: [{
        title: `Search LinkedIn for "${icp.name}" matches`,
        description: `Search LinkedIn People for: ${searchTerms}`,
        taskType: 'expand_network',
        priority: 1,
        url: `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(searchTerms)}`,
      }],
    },
  }];
}

async function unaddressedNetwork(ctx: TickContext): Promise<GoalCandidate[]> {
  if (ctx.page !== 'discover' && ctx.page !== 'dashboard') return [];

  const totalResult = await query<{ c: string }>(
    'SELECT count(*)::text AS c FROM contacts WHERE is_archived = FALSE AND degree > 0'
  );
  const total = parseInt(totalResult.rows[0].c, 10);
  if (total < 50) return [];

  const nicheResult = await query<{ c: string }>(
    `SELECT count(DISTINCT np.id)::text AS c FROM niche_profiles np WHERE np.keywords IS NOT NULL AND array_length(np.keywords, 1) > 0`
  );
  const nicheCount = parseInt(nicheResult.rows[0].c, 10);
  if (nicheCount === 0) return [];

  // Quick addressed estimate — count contacts matching any niche with >=1 keyword hit
  const addressedResult = await query<{ c: string }>(
    `SELECT count(DISTINCT c.id)::text AS c
     FROM contacts c, niche_profiles np
     WHERE c.is_archived = FALSE AND c.degree > 0
       AND np.keywords IS NOT NULL AND array_length(np.keywords, 1) > 0
       AND EXISTS (SELECT 1 FROM unnest(np.keywords) kw WHERE c.title ILIKE '%' || kw || '%' OR c.headline ILIKE '%' || kw || '%')
     LIMIT 1`
  );
  const addressed = parseInt(addressedResult.rows[0].c, 10);
  const pct = addressed / total;

  if (pct > 0.1) return []; // More than 10% addressed is OK for now

  const hash = contextHash(CHECK_UNADDRESSED, {});

  return [{
    title: `${Math.round(pct * 100)}% of your network is addressed`,
    description: `Only ${addressed} of ${total} contacts match a niche. Review your niche keywords or discover new niches from your network.`,
    goalType: CHECK_UNADDRESSED,
    priority: 3,
    metadata: {
      engine: 'icp_fit',
      checkType: CHECK_UNADDRESSED,
      contextHash: hash,
      suggestedTasks: [{
        title: 'Discover niches from your network',
        description: 'Go to Discover > Niches tab > click "Discover from Network" to find segments in your contacts.',
        taskType: 'manual',
        priority: 2,
      }],
    },
  }];
}

export const icpChecks: GoalCheck[] = [nicheCoverageGap, icpZeroMatches, unaddressedNetwork];
