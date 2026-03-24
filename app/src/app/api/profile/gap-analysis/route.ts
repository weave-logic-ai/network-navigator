// GET /api/profile/gap-analysis — Run gap analysis between Natural and Desired ICP

import { NextResponse } from "next/server";
import { runGapAnalysis } from "@/lib/scoring/icp-gap-analysis";

export async function GET() {
  try {
    const result = await runGapAnalysis();
    return NextResponse.json({ data: result });
  } catch (error) {
    return NextResponse.json(
      {
        error: "Failed to run gap analysis",
        details: error instanceof Error ? error.message : undefined,
      },
      { status: 500 }
    );
  }
}
