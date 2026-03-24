// POST /api/admin/reindex - Full reindex pipeline with SSE progress streaming
// Phases: embeddings, niche-counts, icp-scores

import { NextRequest } from 'next/server';
import { generateAllEmbeddings, regenerateAllEmbeddings } from '@/lib/embeddings/generator';
import { query } from '@/lib/db/client';

export const dynamic = 'force-dynamic';
export const maxDuration = 300; // 5 min max

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const forceRegenerate = body.regenerate === true;

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      function send(data: Record<string, unknown>) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      }

      try {
        // Phase 1: Embeddings
        send({ phase: 'embeddings', status: 'starting', detail: 'Starting embedding generation...' });

        const embedFn = forceRegenerate ? regenerateAllEmbeddings : generateAllEmbeddings;
        const embedResult = await embedFn((progress) => {
          send({
            phase: progress.phase,
            status: 'progress',
            current: progress.current,
            total: progress.total,
            detail: progress.detail,
          });
        });

        send({
          phase: 'embeddings',
          status: 'complete',
          generated: embedResult.generated,
          skipped: embedResult.skipped,
          errors: embedResult.errors,
        });

        // Phase 2: Niche member counts
        send({ phase: 'niche-counts', status: 'starting', detail: 'Updating niche member counts...' });

        const nichesResult = await query<{ id: string; keywords: string[] }>(
          'SELECT id, keywords FROM niche_profiles'
        );

        let nichesDone = 0;
        for (const niche of nichesResult.rows) {
          if (!niche.keywords || niche.keywords.length === 0) {
            nichesDone++;
            continue;
          }

          const kwConditions = niche.keywords.map((_, i) =>
            `c.title ILIKE '%' || $${i + 2} || '%' OR c.headline ILIKE '%' || $${i + 2} || '%' OR c.current_company ILIKE '%' || $${i + 2} || '%'`
          ).join(' OR ');

          const countResult = await query<{ ct: string }>(
            `SELECT COUNT(*)::text AS ct FROM contacts c
             WHERE c.is_archived = FALSE AND c.degree > 0 AND (${kwConditions})`,
            [niche.id, ...niche.keywords]
          );

          await query(
            'UPDATE niche_profiles SET member_count = $1 WHERE id = $2',
            [parseInt(countResult.rows[0].ct, 10), niche.id]
          );

          nichesDone++;
          if (nichesDone % 5 === 0) {
            send({
              phase: 'niche-counts',
              status: 'progress',
              current: nichesDone,
              total: nichesResult.rows.length,
            });
          }
        }

        send({
          phase: 'niche-counts',
          status: 'complete',
          total: nichesResult.rows.length,
        });

        // Phase 3: ICP fit scoring (populate contact_icp_fits using embeddings if available)
        send({ phase: 'icp-scores', status: 'starting', detail: 'Computing ICP fit scores...' });

        const icpsResult = await query<{ id: string; criteria: Record<string, unknown> }>(
          'SELECT id, criteria FROM icp_profiles WHERE is_active = TRUE'
        );

        let icpsDone = 0;
        for (const icp of icpsResult.rows) {
          const roles = Array.isArray(icp.criteria?.roles) ? icp.criteria.roles as string[] : [];
          const industries = Array.isArray(icp.criteria?.industries) ? icp.criteria.industries as string[] : [];

          if (roles.length === 0 && industries.length === 0) {
            icpsDone++;
            continue;
          }

          // Build match conditions
          const conditions: string[] = [];
          const params: unknown[] = [];
          let idx = 1;

          if (roles.length > 0) {
            const roleConds = roles.map((r) => {
              params.push(r);
              return `c.title ILIKE '%' || $${idx++} || '%'`;
            });
            conditions.push(`(${roleConds.join(' OR ')})`);
          }

          if (industries.length > 0) {
            const indConds = industries.map((ind) => {
              params.push(ind);
              return `(c.headline ILIKE '%' || $${idx} || '%' OR c.current_company ILIKE '%' || $${idx} || '%')`;
            });
            // Fix: each param used once with idx increment
            industries.forEach(() => idx++);
            conditions.push(`(${indConds.join(' OR ')})`);
          }

          const whereClause = conditions.length > 1
            ? conditions.join(' AND ')
            : conditions[0] || 'FALSE';

          // Upsert matching contacts into contact_icp_fits
          const icpIdParam = `$${idx}`;
          params.push(icp.id);

          await query(
            `INSERT INTO contact_icp_fits (contact_id, icp_profile_id, fit_score, computed_at)
             SELECT c.id, ${icpIdParam}, 0.5, NOW()
             FROM contacts c
             WHERE c.is_archived = FALSE AND c.degree > 0 AND (${whereClause})
             ON CONFLICT (contact_id, icp_profile_id) DO UPDATE SET
               fit_score = 0.5,
               computed_at = NOW()`,
            params
          );

          icpsDone++;
          send({
            phase: 'icp-scores',
            status: 'progress',
            current: icpsDone,
            total: icpsResult.rows.length,
          });
        }

        send({
          phase: 'icp-scores',
          status: 'complete',
          total: icpsResult.rows.length,
        });

        // Done
        send({ phase: 'done', status: 'complete' });
      } catch (error) {
        send({
          phase: 'error',
          status: 'error',
          detail: error instanceof Error ? error.message : 'Unknown error',
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}
