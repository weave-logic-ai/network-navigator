// GET /api/profile/natural-icp - compute and return natural ICP from owner profile + network

import { NextResponse } from "next/server";
import { computeNaturalICP } from "@/lib/scoring/natural-icp";

interface NaturalIcpResponse {
  roles: string[];
  industries: string[];
  signals: string[];
  companySizeRanges: string[];
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

export async function GET() {
  try {
    const icp = await computeNaturalICP();

    if (!icp) {
      return NextResponse.json({ data: null });
    }

    const naturalIcp: NaturalIcpResponse = {
      roles: icp.roles,
      industries: icp.industries,
      signals: icp.signals,
      companySizeRanges: icp.companySizeRanges,
      profileSignals: {
        headlineKeywords: icp.profileSignals.headlineKeywords,
        skillSignals: icp.profileSignals.skillSignals,
        positionIndustries: icp.profileSignals.positionIndustries,
        aboutThemes: icp.profileSignals.aboutKeywords,
      },
      networkSignals: {
        topRoles: icp.networkSignals.topRoles,
        topIndustries: icp.networkSignals.topIndustries,
        topNiches: icp.networkSignals.topNiches,
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
