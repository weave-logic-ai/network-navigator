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

/**
 * Run gap analysis between Natural ICP and Desired ICP.
 * Desired ICP is loaded from owner_profiles.metadata.desiredIcpConfig.
 */
export async function runGapAnalysis(): Promise<GapAnalysisResult> {
  // Compute/refresh Natural ICP
  const naturalIcp = await computeNaturalICP();

  // Load desired ICP config from owner profile
  const ownerRes = await query<{ metadata: Record<string, unknown> }>(
    `SELECT metadata FROM owner_profiles WHERE is_active = TRUE LIMIT 1`
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
      suggestions: [
        {
          type: "profile_update",
          title: "Set a Desired ICP",
          description:
            "Go to your Profile page and select a target niche/ICP to enable gap analysis.",
          impact: "high",
          effort: "quick",
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

  // Load niche contact count
  let nicheContactCount = 0;
  if (desiredConfig.nicheId) {
    const countRes = await query<{ cnt: string }>(
      `SELECT COUNT(*)::text as cnt FROM niche_memberships WHERE niche_id = $1`,
      [desiredConfig.nicheId]
    );
    nicheContactCount = parseInt(countRes.rows[0]?.cnt || "0", 10);
  }

  // Compare arrays
  const naturalRolesLower = naturalIcp.roles.map((r) => r.toLowerCase());
  const naturalIndustriesLower = naturalIcp.industries.map((i) =>
    i.toLowerCase()
  );
  const naturalSignalsLower = naturalIcp.signals.map((s) => s.toLowerCase());

  const missingIndustries = desiredIndustries.filter(
    (i) => !naturalIndustriesLower.includes(i.toLowerCase())
  );
  const missingRoles = desiredRoles.filter(
    (r) => !naturalRolesLower.includes(r.toLowerCase())
  );
  const missingSignals = desiredSignals.filter(
    (s) => !naturalSignalsLower.includes(s.toLowerCase())
  );
  const missingNicheKeywords = desiredKeywords.filter(
    (k) => !naturalSignalsLower.includes(k.toLowerCase())
  );

  const sharedIndustries = desiredIndustries.filter((i) =>
    naturalIndustriesLower.includes(i.toLowerCase())
  );
  const sharedRoles = desiredRoles.filter((r) =>
    naturalRolesLower.includes(r.toLowerCase())
  );
  const sharedSignals = desiredSignals.filter((s) =>
    naturalSignalsLower.includes(s.toLowerCase())
  );

  // Alignment score: weighted combination
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

  const alignmentScore = totalDesired > 0 ? totalMatched / totalDesired : 0;

  // Generate suggestions
  const suggestions: Suggestion[] = [];

  if (missingIndustries.length > 0) {
    suggestions.push({
      type: "profile_update",
      title: `Add "${missingIndustries[0]}" to your headline`,
      description: `Your profile doesn't signal ${missingIndustries[0]} expertise. Add it to attract contacts in this industry.`,
      impact: "high",
      effort: "quick",
    });
  }

  if (missingSignals.length > 0) {
    suggestions.push({
      type: "content",
      title: `Post about ${missingSignals[0]}`,
      description: `Your desired ICP values "${missingSignals[0]}" but your profile doesn't mention it. Create content to signal expertise.`,
      impact: "medium",
      effort: "moderate",
    });
  }

  if (nicheContactCount < 10 && desiredConfig.nicheId) {
    suggestions.push({
      type: "network_growth",
      title: `Connect with more ${nicheName} contacts`,
      description: `Only ${nicheContactCount} contacts in your target niche. Aim for 25+.`,
      impact: "medium",
      effort: "significant",
    });
  }

  if (missingRoles.length > 0) {
    suggestions.push({
      type: "engagement",
      title: `Engage with ${missingRoles[0]} professionals`,
      description: `Your network lacks ${missingRoles[0]} contacts that match your desired ICP.`,
      impact: "low",
      effort: "moderate",
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
