import { query } from "@/lib/db/client";

export interface ContactMetrics {
  score: number | null;
  degree: number | null;
  reason?: string;
}

interface MetricRow {
  score: number | null;
  degree: string;
}

/** A self contact is usable only when the import left exactly one synthetic row. */
export async function loadSelfContactMetrics(): Promise<ContactMetrics> {
  const result = await query<{ id: string }>(
    `SELECT id FROM contacts
     WHERE linkedin_url LIKE 'self:%' AND is_archived = FALSE
     LIMIT 2`
  );
  if (result.rows.length !== 1) {
    return { score: null, degree: null, reason: "Self contact is not uniquely linked to this owner" };
  }
  return loadContactMetrics(result.rows[0].id);
}

export async function loadContactMetrics(contactId: string): Promise<ContactMetrics> {
  const result = await query<MetricRow>(
    `SELECT cs.composite_score AS score,
            (SELECT COUNT(DISTINCT CASE
               WHEN e.source_contact_id = c.id THEN e.target_contact_id
               ELSE e.source_contact_id END)::text
             FROM edges e
             WHERE e.target_contact_id IS NOT NULL
               AND e.edge_type NOT IN ('mutual-proximity', 'same-cluster')
               AND (e.source_contact_id = c.id OR e.target_contact_id = c.id)) AS degree
     FROM contacts c
     LEFT JOIN contact_scores cs ON cs.contact_id = c.id
     WHERE c.id = $1 AND c.is_archived = FALSE`,
    [contactId]
  );
  const row = result.rows[0];
  if (!row) return { score: null, degree: null, reason: "Contact data is unavailable" };
  return {
    score: row.score == null ? null : Number(row.score),
    degree: Number(row.degree),
  };
}

/** Percent change from self; zero has no meaningful relative denominator. */
export function relativeDelta(self: number | null, focused: number | null): number | null {
  if (self == null || focused == null || !Number.isFinite(self) || !Number.isFinite(focused) || self === 0) return null;
  return ((focused - self) / Math.abs(self)) * 100;
}

export function isSignificantDelta(delta: number | null): boolean {
  return delta !== null && Number.isFinite(delta) && Math.abs(delta) >= 20;
}
