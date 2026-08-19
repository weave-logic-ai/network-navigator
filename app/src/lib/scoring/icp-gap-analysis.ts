// ICP Gap Analysis — Compare Natural ICP vs Desired ICP
// Produces alignment score and actionable suggestions

import { query } from "../db/client";
import { NaturalICPResult, computeNaturalICP } from "./natural-icp";

export interface Suggestion {
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

export interface GapAnalysisResult {
  alignmentScore: number;
  naturalIcp: NaturalICPResult | null;
  desiredIcp: {
    nicheId: string;
    nicheName: string;
    icpId: string;
    icpName: string;
    roles: string[];
    industries: string[];
    signals: string[];
  } | null;
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

const EMPTY_GAPS = {
  missingIndustries: [] as string[],
  missingRoles: [] as string[],
  missingSignals: [] as string[],
  missingNicheKeywords: [] as string[],
  companySizeMismatch: false,
};

const EMPTY_STRENGTHS = {
  sharedIndustries: [] as string[],
  sharedRoles: [] as string[],
  sharedSignals: [] as string[],
  nicheContactCount: 0,
};

// Normalize for fuzzy matching: strip hyphens/&, collapse whitespace.
const normalize = (s: string) =>
  s.toLowerCase().replace(/[-&]/g, " ").replace(/\s+/g, " ").trim();

// Common aliasing (e-commerce/ecommerce, "&" -> "and") so desired-ICP
// criteria authored with different spelling than the Natural ICP's
// computed lists still match.
const aliases = (kw: string): string[] => {
  const base = [kw];
  if (/e.?comm?erce/i.test(kw) || /e.?com\b/i.test(kw)) {
    base.push("ecommerce", "e-commerce", "e-com", "ecom");
  }
  if (kw.includes("&")) base.push(kw.replace(/&/g, "and"));
  return base;
};

/**
 * Does `desired` fuzzily match anything in `naturalList`? Used to diff a
 * desired-ICP criterion against the Natural ICP's computed (and truncated)
 * roles/industries/signals lists — exact-only matching would miss common
 * spelling variants (e-commerce vs ecommerce) that both legitimately
 * describe the same thing.
 */
function fuzzyIncludes(desired: string, naturalList: string[]): boolean {
  const desiredVariants = aliases(desired).map(normalize);
  const desiredWords = normalize(desired)
    .split(" ")
    .filter((w) => w.length >= 4);

  for (const natural of naturalList) {
    const naturalNorm = normalize(natural);
    if (desiredVariants.includes(naturalNorm)) return true;
    if (desiredVariants.some((v) => naturalNorm.includes(v) || v.includes(naturalNorm))) {
      return true;
    }
    const naturalWords = naturalNorm.split(" ").filter((w) => w.length >= 4);
    if (desiredWords.some((w) => naturalWords.includes(w))) return true;
  }
  return false;
}

/**
 * Run gap analysis between Natural ICP and Desired ICP.
 * Desired ICP is loaded from owner_profiles.metadata.desiredIcpConfig.
 */
export async function runGapAnalysis(): Promise<GapAnalysisResult> {
  // Compute/refresh Natural ICP
  const naturalIcp = await computeNaturalICP();

  // Load desired ICP config from owner profile
  const ownerRes = await query<{ metadata: Record<string, unknown> }>(
    `SELECT metadata FROM owner_profiles WHERE is_current = TRUE LIMIT 1`
  ).catch(() => ({ rows: [] }));

  const metadata = ownerRes.rows[0]?.metadata || {};
  const desiredConfig = metadata.desiredIcpConfig as {
    nicheId?: string;
    icpId?: string;
  } | undefined;

  if (!desiredConfig?.icpId || !naturalIcp) {
    return {
      alignmentScore: 0,
      naturalIcp,
      desiredIcp: null,
      gaps: EMPTY_GAPS,
      strengths: EMPTY_STRENGTHS,
      suggestions: [
        {
          type: "profile_update",
          title: "Set a Desired ICP",
          description:
            "Go to your Profile page and select a target niche/ICP to enable gap analysis.",
          impact: "high",
          effort: "quick",
          taskTemplate: {
            title: "Select a target niche/ICP",
            description:
              "Go to your Profile page and select a target niche/ICP to enable gap analysis.",
            taskType: "profile_update",
          },
        },
      ],
    };
  }

  // Load desired ICP criteria
  const icpRes = await query<{
    id: string;
    name: string;
    niche_id: string | null;
    criteria: Record<string, unknown>;
  }>(
    `SELECT id, name, niche_id, criteria FROM icp_profiles WHERE id = $1`,
    [desiredConfig.icpId]
  );

  if (icpRes.rows.length === 0) {
    return {
      alignmentScore: 0,
      naturalIcp,
      desiredIcp: null,
      gaps: EMPTY_GAPS,
      strengths: EMPTY_STRENGTHS,
      suggestions: [],
    };
  }

  const icp = icpRes.rows[0];
  const criteria = icp.criteria;
  const desiredRoles = (criteria.roles as string[]) || [];
  const desiredIndustries = (criteria.industries as string[]) || [];
  const desiredSignals = (criteria.signals as string[]) || [];
  const desiredKeywords = (criteria.nicheKeywords as string[]) || [];

  // Load niche name
  let nicheName = "";
  if (icp.niche_id) {
    const nicheRes = await query<{ name: string }>(
      `SELECT name FROM niche_profiles WHERE id = $1`,
      [icp.niche_id]
    );
    nicheName = nicheRes.rows[0]?.name || "";
  }

  // Load niche contact count — niche_profiles.member_count is the real,
  // maintained counter (see app/src/lib/taxonomy/service.ts and
  // app/src/lib/goals/checks/icp-checks.ts). There is no `niche_memberships`
  // table in this schema.
  let nicheContactCount = 0;
  if (desiredConfig.nicheId) {
    const countRes = await query<{ count: number }>(
      `SELECT COALESCE(member_count, 0)::int AS count
       FROM niche_profiles WHERE id = $1`,
      [desiredConfig.nicheId]
    );
    nicheContactCount = countRes.rows[0]?.count ?? 0;
  }

  // Compare desired criteria against the Natural ICP's computed lists
  const missingIndustries = desiredIndustries.filter(
    (i) => !fuzzyIncludes(i, naturalIcp.industries)
  );
  const missingRoles = desiredRoles.filter(
    (r) => !fuzzyIncludes(r, naturalIcp.roles)
  );
  const missingSignals = desiredSignals.filter(
    (s) => !fuzzyIncludes(s, naturalIcp.signals)
  );
  const missingNicheKeywords = desiredKeywords.filter(
    (k) => !fuzzyIncludes(k, naturalIcp.signals)
  );

  const sharedIndustries = desiredIndustries.filter((i) =>
    fuzzyIncludes(i, naturalIcp.industries)
  );
  const sharedRoles = desiredRoles.filter((r) =>
    fuzzyIncludes(r, naturalIcp.roles)
  );
  const sharedSignals = desiredSignals.filter((s) =>
    fuzzyIncludes(s, naturalIcp.signals)
  );

  // Alignment score: 0-100, matching the UI's "{score}%" display and the
  // shadcn <Progress> component's [0, 100] value range.
  const totalDesired =
    desiredRoles.length +
    desiredIndustries.length +
    desiredSignals.length +
    desiredKeywords.length;
  const totalMatched =
    sharedRoles.length +
    sharedIndustries.length +
    sharedSignals.length +
    (desiredKeywords.length - missingNicheKeywords.length);

  const alignmentScore =
    totalDesired > 0 ? Math.round((totalMatched / totalDesired) * 100) : 0;

  // Generate suggestions
  const suggestions: Suggestion[] = [];

  if (missingIndustries.length > 0) {
    const industry = missingIndustries[0];
    suggestions.push({
      type: "profile_update",
      title: `Add "${industry}" to your headline`,
      description: `Your profile doesn't signal ${industry} expertise. Add it to attract contacts in this industry.`,
      impact: "high",
      effort: "quick",
      taskTemplate: {
        title: `Update LinkedIn headline to include "${industry}"`,
        description: `Add "${industry}" to your LinkedIn headline to signal expertise in this industry.`,
        taskType: "profile_update",
        url: "https://www.linkedin.com/in/me/",
      },
    });
  }

  if (missingSignals.length > 0) {
    const signal = missingSignals[0];
    suggestions.push({
      type: "content",
      title: `Post about ${signal}`,
      description: `Your desired ICP values "${signal}" but your profile doesn't mention it. Create content to signal expertise.`,
      impact: "medium",
      effort: "moderate",
      taskTemplate: {
        title: `Write a post about ${signal}`,
        description: `Create content covering "${signal}" to build visibility with your desired ICP.`,
        taskType: "content_creation",
      },
    });
  }

  if (nicheContactCount < 10 && desiredConfig.nicheId) {
    suggestions.push({
      type: "network_growth",
      title: `Connect with more ${nicheName} contacts`,
      description: `Only ${nicheContactCount} contacts in your target niche. Aim for 25+.`,
      impact: "medium",
      effort: "significant",
      taskTemplate: {
        title: `Find and connect with ${nicheName} professionals`,
        description: `Search LinkedIn for ${nicheName} professionals. Target: reach 25+ contacts in this niche.`,
        taskType: "network_growth",
        url: `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(nicheName)}`,
      },
    });
  }

  if (missingRoles.length > 0) {
    const role = missingRoles[0];
    suggestions.push({
      type: "engagement",
      title: `Engage with ${role} professionals`,
      description: `Your network lacks ${role} contacts that match your desired ICP.`,
      impact: "low",
      effort: "moderate",
      taskTemplate: {
        title: `Engage with ${role} professionals`,
        description: `Find and comment thoughtfully on posts from ${role} professionals this week.`,
        taskType: "engagement",
        url: `https://www.linkedin.com/search/results/content/?keywords=${encodeURIComponent(role)}`,
      },
    });
  }

  return {
    alignmentScore,
    naturalIcp,
    desiredIcp: {
      nicheId: desiredConfig.nicheId || "",
      nicheName,
      icpId: icp.id,
      icpName: icp.name,
      roles: desiredRoles,
      industries: desiredIndustries,
      signals: desiredSignals,
    },
    gaps: {
      missingIndustries,
      missingRoles,
      missingSignals,
      missingNicheKeywords,
      companySizeMismatch: false,
    },
    strengths: {
      sharedIndustries,
      sharedRoles,
      sharedSignals,
      nicheContactCount,
    },
    suggestions,
  };
}
