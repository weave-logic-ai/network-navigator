// GET /api/profile/natural-icp - compute and return natural ICP from owner profile + network

import { NextResponse } from "next/server";
import { query } from "@/lib/db/client";

interface NaturalIcpResponse {
  roles: string[];
  industries: string[];
  signals: string[];
  profileSignals: {
    headlineKeywords: string[];
    skillSignals: string[];
    positionIndustries: string[];
    aboutThemes: string[];
  };
  networkSignals: {
    topRoles: Array<{ role: string; count: number }>;
    topIndustries: Array<{ industry: string; count: number }>;
    topNiches: Array<{ niche: string; count: number }>;
  };
  computedAt: string;
}

function extractKeywords(text: string | null): string[] {
  if (!text) return [];
  // Remove common stop words, extract meaningful keywords
  const stopWords = new Set([
    "the", "a", "an", "and", "or", "but", "in", "on", "at", "to", "for",
    "of", "with", "by", "is", "are", "was", "were", "be", "been", "being",
    "have", "has", "had", "do", "does", "did", "will", "would", "could",
    "should", "may", "might", "can", "i", "you", "he", "she", "it", "we",
    "they", "me", "him", "her", "us", "them", "my", "your", "his", "its",
    "our", "their", "this", "that", "these", "those", "who", "what", "which",
    "when", "where", "how", "not", "no", "nor", "as", "if", "then", "than",
    "too", "very", "just", "about", "above", "after", "again", "all", "am",
    "any", "because", "before", "below", "between", "both", "during", "each",
    "few", "from", "further", "here", "into", "more", "most", "other", "out",
    "over", "own", "same", "so", "some", "such", "through", "under", "until",
    "up", "while",
  ]);

  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !stopWords.has(w))
    .slice(0, 20);
}

function extractHelpingTargets(headline: string | null): string[] {
  if (!headline) return [];
  // Match patterns like "Helping [X]", "for [X]", "serving [X]"
  const patterns = [
    /helping\s+(.+?)(?:\s+(?:to|with|by|through)|[.|,]|$)/gi,
    /(?:for|serving)\s+(.+?)(?:\s+(?:to|with|by|through)|[.|,]|$)/gi,
  ];
  const targets: string[] = [];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(headline)) !== null) {
      targets.push(match[1].trim());
    }
  }
  return targets;
}

export async function GET() {
  try {
    // Fetch owner profile
    const profileResult = await query<{
      headline: string | null;
      summary: string | null;
      industry: string | null;
      skills: string[];
      positions: Array<Record<string, string>>;
    }>(
      `SELECT headline, summary, industry, skills, positions
       FROM owner_profiles WHERE is_current = TRUE LIMIT 1`
    );

    if (profileResult.rows.length === 0) {
      return NextResponse.json({ data: null });
    }

    const profile = profileResult.rows[0];

    // Extract profile signals (60% weight)
    const headlineKeywords = extractKeywords(profile.headline);
    const aboutThemes = extractKeywords(profile.summary);
    const skillSignals = (profile.skills || []).slice(0, 20);
    const helpingTargets = extractHelpingTargets(profile.headline);

    // Extract industries from positions
    const positions = (profile.positions || []) as Array<Record<string, string>>;
    const positionIndustries: string[] = [];
    for (const pos of positions) {
      if (pos.company_name) positionIndustries.push(pos.company_name);
    }

    // Network analysis (40% weight) - top roles from connections
    const topRolesResult = await query<{ role: string; count: number }>(
      `SELECT
         COALESCE(TRIM(SPLIT_PART(title, ' at ', 1)), title) AS role,
         COUNT(*)::int AS count
       FROM contacts
       WHERE title IS NOT NULL AND title != ''
       GROUP BY role
       ORDER BY count DESC
       LIMIT 10`
    );

    // Top niches from contact memberships
    const topNichesResult = await query<{ niche: string; count: number }>(
      `SELECT np.name AS niche, COUNT(*)::int AS count
       FROM contact_icp_fits cif
       JOIN icp_profiles ip ON ip.id = cif.icp_profile_id
       JOIN niche_profiles np ON np.id = ip.niche_id
       WHERE ip.niche_id IS NOT NULL
       GROUP BY np.name
       ORDER BY count DESC
       LIMIT 10`
    );

    // Derive combined signals
    const profileIndustries = profile.industry ? [profile.industry] : [];
    const networkRoles = topRolesResult.rows.map((r) => r.role);
    const networkNiches = topNichesResult.rows.map((r) => r.niche);

    // Combine: profile signals weighted 60%, network 40%
    const allRoles = [
      ...helpingTargets,
      ...networkRoles.slice(0, 5),
    ];
    const allIndustries = [
      ...profileIndustries,
      ...networkNiches.slice(0, 3),
    ];
    const allSignals = [
      ...headlineKeywords.slice(0, 10),
      ...skillSignals.slice(0, 10),
    ];

    // Deduplicate
    const roles = [...new Set(allRoles)].slice(0, 10);
    const industries = [...new Set(allIndustries)].slice(0, 10);
    const signals = [...new Set(allSignals)].slice(0, 20);

    const naturalIcp: NaturalIcpResponse = {
      roles,
      industries,
      signals,
      profileSignals: {
        headlineKeywords,
        skillSignals,
        positionIndustries: [...new Set(positionIndustries)].slice(0, 10),
        aboutThemes,
      },
      networkSignals: {
        topRoles: topRolesResult.rows,
        topIndustries: topNichesResult.rows.map((r) => ({
          industry: r.niche,
          count: r.count,
        })),
        topNiches: topNichesResult.rows,
      },
      computedAt: new Date().toISOString(),
    };

    return NextResponse.json({ data: naturalIcp });
  } catch (error) {
    return NextResponse.json(
      {
        error: "Failed to compute natural ICP",
        details: error instanceof Error ? error.message : undefined,
      },
      { status: 500 }
    );
  }
}
