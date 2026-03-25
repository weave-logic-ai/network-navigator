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

        // Phase 2: Niche member counts (single batch query)
        send({ phase: 'niche-counts', status: 'starting', detail: 'Updating niche member counts...' });

        const nicheCountResult = await query<{ id: string; member_count: string }>(
          `UPDATE niche_profiles np SET member_count = sub.cnt
           FROM (
             SELECT np2.id, COUNT(DISTINCT c.id)::text AS cnt
             FROM niche_profiles np2
             CROSS JOIN LATERAL unnest(np2.keywords) AS kw(word)
             JOIN contacts c ON c.is_archived = FALSE AND c.degree > 0
               AND (c.title ILIKE '%' || kw.word || '%'
                 OR c.headline ILIKE '%' || kw.word || '%'
                 OR c.current_company ILIKE '%' || kw.word || '%')
             WHERE np2.keywords IS NOT NULL AND array_length(np2.keywords, 1) > 0
             GROUP BY np2.id
           ) sub
           WHERE np.id = sub.id
           RETURNING np.id, np.member_count::text`
        );

        // Zero out niches with no matches
        await query(
          `UPDATE niche_profiles SET member_count = 0
           WHERE keywords IS NULL OR array_length(keywords, 1) IS NULL OR array_length(keywords, 1) = 0
              OR id NOT IN (SELECT id FROM niche_profiles WHERE member_count > 0)`
        );

        send({
          phase: 'niche-counts',
          status: 'complete',
          total: nicheCountResult.rowCount ?? 0,
        });

        // Phase 3: ICP fit scoring (batch per ICP using criteria roles/industries)
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

          // Use unnest-based matching instead of building dynamic ILIKE chains
          // Match: any role keyword in title AND any industry keyword in headline/company
          if (roles.length > 0 && industries.length > 0) {
            await query(
              `INSERT INTO contact_icp_fits (contact_id, icp_profile_id, fit_score, computed_at)
               SELECT c.id, $3::uuid, 0.5, NOW()
               FROM contacts c
               WHERE c.is_archived = FALSE AND c.degree > 0
                 AND EXISTS (SELECT 1 FROM unnest($1::text[]) r WHERE c.title ILIKE '%' || r || '%')
                 AND EXISTS (SELECT 1 FROM unnest($2::text[]) ind WHERE c.headline ILIKE '%' || ind || '%' OR c.current_company ILIKE '%' || ind || '%')
               ON CONFLICT (contact_id, icp_profile_id) DO UPDATE SET
                 fit_score = 0.5, computed_at = NOW()`,
              [roles, industries, icp.id]
            );
          } else if (roles.length > 0) {
            await query(
              `INSERT INTO contact_icp_fits (contact_id, icp_profile_id, fit_score, computed_at)
               SELECT c.id, $2::uuid, 0.5, NOW()
               FROM contacts c
               WHERE c.is_archived = FALSE AND c.degree > 0
                 AND EXISTS (SELECT 1 FROM unnest($1::text[]) r WHERE c.title ILIKE '%' || r || '%')
               ON CONFLICT (contact_id, icp_profile_id) DO UPDATE SET
                 fit_score = 0.5, computed_at = NOW()`,
              [roles, icp.id]
            );
          } else {
            await query(
              `INSERT INTO contact_icp_fits (contact_id, icp_profile_id, fit_score, computed_at)
               SELECT c.id, $2::uuid, 0.5, NOW()
               FROM contacts c
               WHERE c.is_archived = FALSE AND c.degree > 0
                 AND EXISTS (SELECT 1 FROM unnest($1::text[]) ind WHERE c.headline ILIKE '%' || ind || '%' OR c.current_company ILIKE '%' || ind || '%')
               ON CONFLICT (contact_id, icp_profile_id) DO UPDATE SET
                 fit_score = 0.5, computed_at = NOW()`,
              [industries, icp.id]
            );
          }

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
