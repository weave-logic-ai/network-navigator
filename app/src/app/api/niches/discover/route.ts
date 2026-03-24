// GET /api/niches/discover - Discover niches from contact network data
// Analyzes contact titles, headlines, and companies to suggest niche segments

import { NextResponse } from 'next/server';
import { query } from '@/lib/db/client';

interface DiscoveredNiche {
  suggestedName: string;
  description: string;
  industry: string;
  contactCount: number;
  keywords: string[];
  sampleContacts: Array<{ id: string; name: string; title: string | null }>;
  confidence: number;
  alreadyExists: boolean;
}

export async function GET() {
  try {
    // Cluster contacts by title keywords and company patterns
    // This finds groups of contacts that share similar professional domains
    const clusterResult = await query<{
      cluster_label: string;
      contact_count: string;
      sample_ids: string[];
      sample_names: string[];
      sample_titles: string[];
      common_words: string[];
    }>(`
      WITH title_segments AS (
        SELECT
          c.id,
          COALESCE(c.full_name, c.first_name || ' ' || c.last_name, 'Unknown') AS name,
          c.title,
          c.headline,
          c.current_company,
          -- Classify by dominant title domain
          CASE
            WHEN c.title ILIKE '%healthcare%' OR c.title ILIKE '%medical%' OR c.title ILIKE '%health%' OR c.title ILIKE '%pharma%' THEN 'Healthcare'
            WHEN c.title ILIKE '%fintech%' OR c.title ILIKE '%financial%' OR c.title ILIKE '%banking%' OR c.title ILIKE '%insurance%' THEN 'Finance'
            WHEN c.title ILIKE '%real estate%' OR c.title ILIKE '%property%' OR c.title ILIKE '%construction%' THEN 'Real Estate'
            WHEN c.title ILIKE '%education%' OR c.title ILIKE '%learning%' OR c.title ILIKE '%training%' OR c.title ILIKE '%university%' THEN 'Education'
            WHEN c.title ILIKE '%marketing%' OR c.title ILIKE '%growth%' OR c.title ILIKE '%brand%' OR c.title ILIKE '%content%' THEN 'Marketing & Growth'
            WHEN c.title ILIKE '%sales%' OR c.title ILIKE '%account%' OR c.title ILIKE '%business develop%' OR c.title ILIKE '%revenue%' THEN 'Sales & Revenue'
            WHEN c.title ILIKE '%engineer%' OR c.title ILIKE '%developer%' OR c.title ILIKE '%architect%' OR c.title ILIKE '%devops%' THEN 'Engineering'
            WHEN c.title ILIKE '%product%' OR c.title ILIKE '%UX%' OR c.title ILIKE '%design%' THEN 'Product & Design'
            WHEN c.title ILIKE '%data%' OR c.title ILIKE '%analytics%' OR c.title ILIKE '%AI%' OR c.title ILIKE '%machine learning%' THEN 'Data & AI'
            WHEN c.title ILIKE '%consult%' OR c.title ILIKE '%advisory%' OR c.title ILIKE '%strateg%' THEN 'Consulting & Strategy'
            WHEN c.title ILIKE '%recruit%' OR c.title ILIKE '%talent%' OR c.title ILIKE '%HR%' OR c.title ILIKE '%people%' THEN 'HR & Talent'
            WHEN c.title ILIKE '%operations%' OR c.title ILIKE '%supply chain%' OR c.title ILIKE '%logistics%' THEN 'Operations & Logistics'
            WHEN c.title ILIKE '%legal%' OR c.title ILIKE '%compliance%' OR c.title ILIKE '%attorney%' THEN 'Legal & Compliance'
            WHEN c.title ILIKE '%CEO%' OR c.title ILIKE '%founder%' OR c.title ILIKE '%owner%' OR c.title ILIKE '%president%' THEN 'Founders & Executives'
            WHEN c.title ILIKE '%CTO%' OR c.title ILIKE '%VP Eng%' OR c.title ILIKE '%head of eng%' THEN 'Tech Leadership'
            WHEN c.title ILIKE '%media%' OR c.title ILIKE '%creative%' OR c.title ILIKE '%entertainment%' THEN 'Media & Creative'
            WHEN c.title ILIKE '%nonprofit%' OR c.title ILIKE '%NGO%' OR c.title ILIKE '%social impact%' THEN 'Nonprofit'
            WHEN c.title ILIKE '%manufacturing%' OR c.title ILIKE '%industrial%' THEN 'Manufacturing'
            WHEN c.title ILIKE '%e-commerce%' OR c.title ILIKE '%ecommerce%' OR c.title ILIKE '%retail%' OR c.title ILIKE '%Shopify%' THEN 'E-Commerce & Retail'
            WHEN c.title ILIKE '%SaaS%' OR c.title ILIKE '%software%' OR c.title ILIKE '%platform%' THEN 'SaaS & Software'
            ELSE NULL
          END AS cluster_label
        FROM contacts c
        WHERE c.is_archived = FALSE AND c.degree > 0 AND c.title IS NOT NULL AND c.title != ''
      ),
      clusters AS (
        SELECT
          cluster_label,
          count(*) AS contact_count,
          array_agg(id ORDER BY random()) AS all_ids,
          array_agg(name ORDER BY random()) AS all_names,
          array_agg(title ORDER BY random()) AS all_titles
        FROM title_segments
        WHERE cluster_label IS NOT NULL
        GROUP BY cluster_label
        HAVING count(*) >= 3
      ),
      -- Extract most FREQUENT meaningful words from titles in each cluster
      word_freq AS (
        SELECT
          ts.cluster_label,
          word,
          count(*) AS freq
        FROM title_segments ts,
             regexp_split_to_table(lower(ts.title), '[^a-z]+') AS word
        WHERE ts.cluster_label IS NOT NULL
          AND length(word) > 3
          AND word NOT IN ('the','and','for','with','from','that','this','have','been','will','your','more','about','into','just','also','than','senior','lead','manager','director','vice','head','chief','officer','president','global','group','team','work','level','based','world','year','years','company','help','business','services')
        GROUP BY ts.cluster_label, word
        HAVING count(*) >= 3
      ),
      cluster_words AS (
        SELECT
          cluster_label,
          array_agg(word ORDER BY freq DESC) AS common_words
        FROM (
          SELECT cluster_label, word, freq,
                 ROW_NUMBER() OVER (PARTITION BY cluster_label ORDER BY freq DESC) AS rn
          FROM word_freq
        ) ranked
        WHERE rn <= 10
        GROUP BY cluster_label
      )
      SELECT
        c.cluster_label,
        c.contact_count::text,
        c.all_ids[1:5] AS sample_ids,
        c.all_names[1:5] AS sample_names,
        c.all_titles[1:5] AS sample_titles,
        COALESCE(cw.common_words[1:10], ARRAY[]::text[]) AS common_words
      FROM clusters c
      LEFT JOIN cluster_words cw ON cw.cluster_label = c.cluster_label
      ORDER BY c.contact_count DESC
      LIMIT 25
    `);

    // Mark clusters that already exist as niches
    const existingNiches = await query<{ name: string }>(
      'SELECT LOWER(name) AS name FROM niche_profiles'
    );
    const existingNames = new Set(existingNiches.rows.map(r => r.name));

    const discoveries: DiscoveredNiche[] = clusterResult.rows.map((row) => {
      const alreadyExists = existingNames.has(row.cluster_label.toLowerCase());
        const contactCount = parseInt(row.contact_count, 10);
        const confidence = Math.min(contactCount / 50, 1.0);

        const sampleContacts = (row.sample_ids ?? []).map((id: string, i: number) => ({
          id,
          name: row.sample_names?.[i] ?? 'Unknown',
          title: row.sample_titles?.[i] ?? null,
        }));

        return {
          suggestedName: `${row.cluster_label}`,
          description: alreadyExists
            ? `Already tracked — ${contactCount} contacts`
            : `${contactCount} contacts in your network with ${row.cluster_label.toLowerCase()} roles`,
          industry: row.cluster_label,
          contactCount,
          keywords: row.common_words ?? [],
          sampleContacts,
          confidence,
          alreadyExists,
        };
      });

    return NextResponse.json({
      data: {
        discoveries,
        totalDiscovered: discoveries.length,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to discover niches', details: error instanceof Error ? error.message : undefined },
      { status: 500 }
    );
  }
}
