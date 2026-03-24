// Natural ICP Auto-detection
// Analyzes owner profile (60% weight) + network composition (40%) to generate
// an ICP that represents "who your network already looks like"

import { query } from "../db/client";

export interface NaturalICPResult {
  roles: string[];
  industries: string[];
  signals: string[];
  companySizeRanges: string[];
  profileSignals: {
    headlineKeywords: string[];
    skillSignals: string[];
    positionIndustries: string[];
  };
  networkSignals: {
    topRoles: Array<{ role: string; count: number }>;
    topIndustries: Array<{ industry: string; count: number }>;
  };
}

/**
 * Compute the Natural ICP from owner profile (60%) + network stats (40%).
 * Returns the criteria and stores as an icp_profiles row with source='natural'.
 */
export async function computeNaturalICP(): Promise<NaturalICPResult | null> {
  // 1. Find owner profile (degree=0)
  const ownerRes = await query<{
    id: string;
    full_name: string | null;
    headline: string | null;
    title: string | null;
    about: string | null;
    tags: string[] | null;
    current_company: string | null;
  }>(
    `SELECT id, full_name, headline, title, about, tags, current_company
     FROM contacts WHERE degree = 0 AND is_archived = FALSE LIMIT 1`
  );

  if (ownerRes.rows.length === 0) return null;
  const owner = ownerRes.rows[0];

  // --- OWNER PROFILE ANALYSIS (60% weight) ---

  // Extract keywords from headline
  const headlineKeywords = extractKeywords(owner.headline || "");

  // Extract keywords from about
  const aboutKeywords = extractKeywords(owner.about || "");

  // Skills from tags
  const skillSignals = owner.tags || [];

  // Industry signals from headline + about
  const profileText = [owner.headline, owner.about, owner.title]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  const positionIndustries = extractIndustries(profileText);

  // Target role signals (from "Helping X" patterns in headline)
  const targetRoles = extractTargetRoles(owner.headline || "");

  // --- NETWORK ANALYSIS (40% weight) ---

  // Top 10 title patterns by frequency
  const titleRes = await query<{ title_pattern: string; cnt: string }>(
    `SELECT
       CASE
         WHEN title ILIKE '%CEO%' OR title ILIKE '%founder%' THEN 'CEO/Founder'
         WHEN title ILIKE '%CTO%' OR title ILIKE '%chief tech%' THEN 'CTO/Tech Leader'
         WHEN title ILIKE '%VP%' OR title ILIKE '%vice president%' THEN 'VP'
         WHEN title ILIKE '%director%' THEN 'Director'
         WHEN title ILIKE '%manager%' OR title ILIKE '%head of%' THEN 'Manager/Head'
         WHEN title ILIKE '%engineer%' OR title ILIKE '%developer%' THEN 'Engineer'
         WHEN title ILIKE '%sales%' OR title ILIKE '%account exec%' THEN 'Sales'
         WHEN title ILIKE '%marketing%' OR title ILIKE '%growth%' THEN 'Marketing'
         WHEN title ILIKE '%product%' THEN 'Product'
         WHEN title ILIKE '%consult%' OR title ILIKE '%advisor%' THEN 'Consultant'
         ELSE 'Other'
       END AS title_pattern,
       COUNT(*)::text AS cnt
     FROM contacts
     WHERE degree > 0 AND is_archived = FALSE AND title IS NOT NULL
     GROUP BY title_pattern
     ORDER BY COUNT(*) DESC
     LIMIT 10`
  );
  const topRoles = titleRes.rows
    .filter((r) => r.title_pattern !== "Other")
    .map((r) => ({ role: r.title_pattern, count: parseInt(r.cnt, 10) }));

  // Top 5 industries from company data
  const industryRes = await query<{ industry: string; cnt: string }>(
    `SELECT co.industry, COUNT(*)::text AS cnt
     FROM contacts c
     JOIN companies co ON c.current_company_id = co.id
     WHERE c.degree > 0 AND c.is_archived = FALSE AND co.industry IS NOT NULL
     GROUP BY co.industry
     ORDER BY COUNT(*) DESC
     LIMIT 5`
  );
  const topIndustries = industryRes.rows.map((r) => ({
    industry: r.industry,
    count: parseInt(r.cnt, 10),
  }));

  // Most common company size range
  const sizeRes = await query<{ size_range: string; cnt: string }>(
    `SELECT co.size_range, COUNT(*)::text AS cnt
     FROM contacts c
     JOIN companies co ON c.current_company_id = co.id
     WHERE c.degree > 0 AND c.is_archived = FALSE AND co.size_range IS NOT NULL
     GROUP BY co.size_range
     ORDER BY COUNT(*) DESC
     LIMIT 3`
  );

  // --- WEIGHTED MERGE ---

  // Roles: profile-derived targets (60%) + network top roles (40%)
  const networkRoles = topRoles.map((r) => r.role);
  const roles = mergeWeighted(targetRoles, networkRoles, 0.6, 0.4);

  // Industries: profile signals (60%) + network distribution (40%)
  const networkIndustries = topIndustries.map((i) => i.industry);
  const industries = mergeWeighted(
    positionIndustries,
    networkIndustries,
    0.6,
    0.4
  );

  // Signals: owner skills + headline keywords (100% from profile)
  const signals = [
    ...new Set([...headlineKeywords, ...aboutKeywords, ...skillSignals]),
  ].slice(0, 20);

  // Company size ranges
  const companySizeRanges = sizeRes.rows.map((r) => r.size_range);

  const result: NaturalICPResult = {
    roles: roles.slice(0, 7),
    industries: industries.slice(0, 7),
    signals: signals.slice(0, 15),
    companySizeRanges,
    profileSignals: {
      headlineKeywords,
      skillSignals,
      positionIndustries,
    },
    networkSignals: {
      topRoles,
      topIndustries,
    },
  };

  // Store as icp_profiles with source='natural'
  await upsertNaturalICP(result);

  return result;
}

/**
 * Store or update the Natural ICP in the database
 */
async function upsertNaturalICP(icp: NaturalICPResult): Promise<void> {
  const criteria = {
    roles: icp.roles,
    industries: icp.industries,
    signals: icp.signals,
    companySizeRanges: icp.companySizeRanges,
  };

  // Check if natural ICP already exists
  const existing = await query<{ id: string }>(
    `SELECT id FROM icp_profiles WHERE name = 'Natural ICP (auto-detected)' LIMIT 1`
  );

  if (existing.rows.length > 0) {
    await query(
      `UPDATE icp_profiles
       SET criteria = $1, updated_at = NOW()
       WHERE id = $2`,
      [JSON.stringify(criteria), existing.rows[0].id]
    );
  } else {
    await query(
      `INSERT INTO icp_profiles (name, description, criteria, is_active)
       VALUES ($1, $2, $3, true)`,
      [
        "Natural ICP (auto-detected)",
        "Auto-generated from owner profile (60%) and network composition (40%)",
        JSON.stringify(criteria),
      ]
    );
  }
}

// --- Utility functions ---

function extractKeywords(text: string): string[] {
  if (!text) return [];

  const STOP_WORDS = new Set([
    "the", "a", "an", "and", "or", "but", "in", "on", "at", "to", "for",
    "of", "with", "by", "from", "as", "is", "was", "are", "were", "been",
    "be", "have", "has", "had", "do", "does", "did", "will", "would",
    "could", "should", "may", "might", "can", "this", "that", "these",
    "those", "i", "you", "he", "she", "it", "we", "they", "my", "your",
    "his", "her", "its", "our", "their", "who", "what", "which", "where",
    "when", "how", "not", "all", "each", "every", "both", "more", "most",
    "other", "some", "such", "no", "nor", "than", "too", "very", "just",
  ]);

  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w))
    .slice(0, 20);
}

function extractIndustries(text: string): string[] {
  const INDUSTRY_KEYWORDS = [
    "saas", "e-commerce", "ecommerce", "fintech", "healthcare", "healthtech",
    "edtech", "martech", "adtech", "proptech", "insurtech", "agtech",
    "biotech", "cleantech", "cybersecurity", "ai", "machine learning",
    "blockchain", "crypto", "web3", "defi", "cloud", "devops", "data",
    "analytics", "consulting", "manufacturing", "retail", "logistics",
    "media", "entertainment", "gaming", "automotive", "aerospace",
    "defense", "energy", "legal", "hr", "recruiting", "real estate",
  ];

  return INDUSTRY_KEYWORDS.filter((ind) => text.includes(ind));
}

function extractTargetRoles(headline: string): string[] {
  if (!headline) return [];

  // Look for "Helping X" patterns
  const helpingMatch = headline.match(/help(?:ing|s)?\s+(.+?)(?:\s+(?:to|with|by|through)\s|$)/i);
  if (helpingMatch) {
    return extractKeywords(helpingMatch[1]).slice(0, 5);
  }

  // Look for "for X" patterns
  const forMatch = headline.match(/\bfor\s+(.+?)(?:\s*[|,]|\s*$)/i);
  if (forMatch) {
    return extractKeywords(forMatch[1]).slice(0, 5);
  }

  return [];
}

function mergeWeighted(
  profileItems: string[],
  networkItems: string[],
  profileWeight: number,
  networkWeight: number
): string[] {
  const scores = new Map<string, number>();

  // Score profile items
  profileItems.forEach((item, idx) => {
    const normalizedScore = profileWeight * (1 - idx / (profileItems.length || 1));
    scores.set(
      item.toLowerCase(),
      (scores.get(item.toLowerCase()) || 0) + normalizedScore
    );
  });

  // Score network items
  networkItems.forEach((item, idx) => {
    const normalizedScore = networkWeight * (1 - idx / (networkItems.length || 1));
    scores.set(
      item.toLowerCase(),
      (scores.get(item.toLowerCase()) || 0) + normalizedScore
    );
  });

  return [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([item]) => item);
}
