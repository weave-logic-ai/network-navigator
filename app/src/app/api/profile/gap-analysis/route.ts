// GET /api/profile/gap-analysis - compare natural vs desired ICP and produce gaps + suggestions

import { NextResponse } from "next/server";
import { runGapAnalysis } from "@/lib/scoring/icp-gap-analysis";

export async function GET() {
  try {
    const result = await runGapAnalysis();

    // No owner profile imported yet — nothing to compare against. Preserve
    // the prior "no data" response instead of showing a 0% alignment score
    // with a "set a desired ICP" suggestion.
    if (!result.naturalIcp) {
      return NextResponse.json({ data: null });
    }

    return NextResponse.json({ data: result });
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
