// GET /api/profile/gap-analysis - compare natural vs desired ICP and produce gaps + suggestions

import { NextResponse } from "next/server";
import { query } from "@/lib/db/client";

interface Suggestion {
  type:
    | "profile_update"
    | "content"
    | "network_growth"
    | "skill_add"
    | "engagement";
  title: string;
  description: string;
  impact: "high" | "medium" | "low";
  effort: "quick" | "moderate" | "significant";
  taskTemplate: {
    title: string;
    description: string;
    taskType: string;
    url?: string;
  };
}

interface GapAnalysis {
  alignmentScore: number;
  gaps: {
    missingIndustries: string[];
    missingRoles: string[];
    missingSignals: string[];
    missingNicheKeywords: string[];
    companySizeMismatch: boolean;
  };
  strengths: {
    sharedIndustries: string[];
    sharedRoles: string[];
    sharedSignals: string[];
    nicheContactCount: number;
  };
  suggestions: Suggestion[];
}

function intersect(a: string[], b: string[]): string[] {
  const setB = new Set(b.map((s) => s.toLowerCase()));
  return a.filter((s) => setB.has(s.toLowerCase()));
}

function difference(a: string[], b: string[]): string[] {
  const setB = new Set(b.map((s) => s.toLowerCase()));
  return a.filter((s) => !setB.has(s.toLowerCase()));
}

export async function GET() {
  try {
    // Fetch natural ICP data from profile
    const profileResult = await query<{
      headline: string | null;
      summary: string | null;
      industry: string | null;
      skills: string[];
    }>(
      `SELECT headline, summary, industry, skills
       FROM owner_profiles WHERE is_current = TRUE LIMIT 1`
    );

    if (profileResult.rows.length === 0) {
      return NextResponse.json({ data: null });
    }

    const profile = profileResult.rows[0];

    // Fetch desired ICP config
    await query(
      `ALTER TABLE owner_profiles ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'`
    );

    const metaResult = await query<{ metadata: Record<string, unknown> }>(
      `SELECT metadata FROM owner_profiles WHERE is_current = TRUE LIMIT 1`
    );

    const metadata = metaResult.rows[0]?.metadata || {};
    const desiredConfig = metadata.desiredIcpConfig as {
      nicheId: string | null;
      icpId: string | null;
      offeringIds: string[];
    } | null;

    if (!desiredConfig || (!desiredConfig.nicheId && !desiredConfig.icpId)) {
      return NextResponse.json({
        data: {
          alignmentScore: 0,
          gaps: {
            missingIndustries: [],
            missingRoles: [],
            missingSignals: [],
            missingNicheKeywords: [],
            companySizeMismatch: false,
          },
          strengths: {
            sharedIndustries: [],
            sharedRoles: [],
            sharedSignals: [],
            nicheContactCount: 0,
          },
          suggestions: [],
        } as GapAnalysis,
      });
    }

    // Fetch desired niche details
    let nicheKeywords: string[] = [];
    let nicheName = "";
    if (desiredConfig.nicheId) {
      const nicheResult = await query<{
        name: string;
        keywords: string[];
      }>(`SELECT name, keywords FROM niche_profiles WHERE id = $1`, [
        desiredConfig.nicheId,
      ]);
      if (nicheResult.rows.length > 0) {
        nicheKeywords = nicheResult.rows[0].keywords || [];
        nicheName = nicheResult.rows[0].name;
      }
    }

    // Fetch desired ICP criteria
    let icpCriteria: Record<string, unknown> = {};
    let icpName = "";
    if (desiredConfig.icpId) {
      const icpResult = await query<{
        name: string;
        criteria: Record<string, unknown>;
      }>(`SELECT name, criteria FROM icp_profiles WHERE id = $1`, [
        desiredConfig.icpId,
      ]);
      if (icpResult.rows.length > 0) {
        icpCriteria = icpResult.rows[0].criteria || {};
        icpName = icpResult.rows[0].name;
      }
    }

    // Extract desired roles and industries from ICP criteria
    const desiredRoles = (icpCriteria.roles as string[]) || [];
    const desiredIndustries = (icpCriteria.industries as string[]) || [];
    const desiredSignals = (icpCriteria.signals as string[]) || [];

    // Current profile signals
    const profileSkills = (profile.skills || []).map((s) => s.toLowerCase());
    const headlineWords = (profile.headline || "")
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 2);
    const summaryWords = (profile.summary || "")
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 2);
    const currentSignals = [
      ...profileSkills,
      ...headlineWords,
      ...summaryWords,
    ];
    const currentIndustries = profile.industry ? [profile.industry] : [];

    // Compute gaps
    const missingIndustries = difference(desiredIndustries, currentIndustries);
    const missingSignals = difference(desiredSignals, currentSignals);
    const missingNicheKeywords = difference(nicheKeywords, currentSignals);
    const missingRoles = desiredRoles; // No direct role extraction from profile

    // Compute strengths
    const sharedIndustries = intersect(desiredIndustries, currentIndustries);
    const sharedSignals = intersect(desiredSignals, currentSignals);

    // Count contacts in desired niche
    let nicheContactCount = 0;
    if (desiredConfig.nicheId) {
      const countResult = await query<{ count: number }>(
        `SELECT COUNT(DISTINCT cif.contact_id)::int AS count
         FROM contact_icp_fits cif
         JOIN icp_profiles ip ON ip.id = cif.icp_profile_id
         WHERE ip.niche_id = $1`,
        [desiredConfig.nicheId]
      );
      nicheContactCount = countResult.rows[0]?.count ?? 0;
    }

    // Compute alignment score (0-100)
    const totalDesired =
      desiredIndustries.length +
      desiredSignals.length +
      nicheKeywords.length +
      desiredRoles.length;
    const totalMatched =
      sharedIndustries.length +
      sharedSignals.length +
      intersect(nicheKeywords, currentSignals).length;

    const alignmentScore =
      totalDesired > 0 ? Math.round((totalMatched / totalDesired) * 100) : 0;

    // Generate suggestions
    const suggestions: Suggestion[] = [];

    // Profile update suggestions for missing niche keywords in headline
    for (const keyword of missingNicheKeywords.slice(0, 2)) {
      const headlineHas = headlineWords.includes(keyword.toLowerCase());
      if (!headlineHas) {
        suggestions.push({
          type: "profile_update",
          title: `Add "${keyword}" to your headline`,
          description: `Your headline doesn't mention "${keyword}". ${nicheName ? nicheName + " contacts" : "Your desired ICP"} search for this keyword.`,
          impact: "high",
          effort: "quick",
          taskTemplate: {
            title: `Update LinkedIn headline to include "${keyword}"`,
            description: `Add "${keyword}" to your LinkedIn headline to signal expertise in ${nicheName || "your target niche"}.`,
            taskType: "profile_update",
            url: "https://www.linkedin.com/in/me/",
          },
        });
      }
    }

    // Skill addition suggestions
    for (const signal of missingSignals.slice(0, 2)) {
      if (!profileSkills.includes(signal.toLowerCase())) {
        suggestions.push({
          type: "skill_add",
          title: `Add "${signal}" to your Skills section`,
          description: `Your skills don't include "${signal}". This is a key signal for ${icpName || "your desired ICP"}.`,
          impact: "medium",
          effort: "quick",
          taskTemplate: {
            title: `Add "${signal}" to LinkedIn skills`,
            description: `Add "${signal}" to your Skills section to signal expertise to ${icpName || "your target ICP"}.`,
            taskType: "profile_update",
            url: "https://www.linkedin.com/in/me/",
          },
        });
      }
    }

    // Content suggestions based on niche keywords not in profile
    if (missingNicheKeywords.length > 2) {
      const topics = missingNicheKeywords.slice(0, 3).join(", ");
      suggestions.push({
        type: "content",
        title: `Post about ${nicheName || "your target niche"} topics`,
        description: `Your profile doesn't reference ${topics}. Creating content about these topics will attract ${nicheName || "your desired"} audience.`,
        impact: "medium",
        effort: "moderate",
        taskTemplate: {
          title: `Write a post about ${missingNicheKeywords[0] || "your target niche"}`,
          description: `Create content covering: ${topics}. This builds visibility with ${nicheName || "your target niche"} audience.`,
          taskType: "content_creation",
        },
      });
    }

    // Network growth suggestion
    if (nicheContactCount < 25 && nicheName) {
      suggestions.push({
        type: "network_growth",
        title: `Connect with more ${nicheName} contacts`,
        description: `You only have ${nicheContactCount} contacts in ${nicheName} (target: 25+). Growing this segment strengthens your positioning.`,
        impact: nicheContactCount < 10 ? "high" : "medium",
        effort: "significant",
        taskTemplate: {
          title: `Find and connect with ${nicheName} professionals`,
          description: `Search LinkedIn for ${nicheName} professionals. Target: reach 25+ contacts in this niche.`,
          taskType: "network_growth",
          url: `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(nicheName)}`,
        },
      });
    }

    // Engagement suggestion
    if (nicheName && missingNicheKeywords.length > 0) {
      suggestions.push({
        type: "engagement",
        title: `Engage with ${nicheName} content this week`,
        description: `Comment on 3-5 posts from ${nicheName} thought leaders. This increases visibility within the niche.`,
        impact: "low",
        effort: "moderate",
        taskTemplate: {
          title: `Engage with ${nicheName} content`,
          description: `Find and comment thoughtfully on 3-5 posts from ${nicheName} professionals this week.`,
          taskType: "engagement",
          url: `https://www.linkedin.com/search/results/content/?keywords=${encodeURIComponent(nicheName)}`,
        },
      });
    }

    // Sort suggestions: high impact first, then by effort (quick first)
    const impactOrder = { high: 0, medium: 1, low: 2 };
    const effortOrder = { quick: 0, moderate: 1, significant: 2 };
    suggestions.sort((a, b) => {
      const impactDiff = impactOrder[a.impact] - impactOrder[b.impact];
      if (impactDiff !== 0) return impactDiff;
      return effortOrder[a.effort] - effortOrder[b.effort];
    });

    const gapAnalysis: GapAnalysis = {
      alignmentScore,
      gaps: {
        missingIndustries,
        missingRoles,
        missingSignals,
        missingNicheKeywords,
        companySizeMismatch: false,
      },
      strengths: {
        sharedIndustries,
        sharedRoles: [],
        sharedSignals,
        nicheContactCount,
      },
      suggestions,
    };

    return NextResponse.json({ data: gapAnalysis });
  } catch (error) {
    return NextResponse.json(
      {
        error: "Failed to compute gap analysis",
        details: error instanceof Error ? error.message : undefined,
      },
      { status: 500 }
    );
  }
}
