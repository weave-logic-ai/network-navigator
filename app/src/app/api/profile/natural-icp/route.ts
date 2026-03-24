// GET /api/profile/natural-icp — Compute and return Natural ICP

import { NextResponse } from "next/server";
import { computeNaturalICP } from "@/lib/scoring/natural-icp";

export async function GET() {
  try {
    const result = await computeNaturalICP();

    if (!result) {
      return NextResponse.json(
        { error: "No owner profile found. Import your LinkedIn data first." },
        { status: 404 }
      );
    }

    return NextResponse.json({ data: result });
  } catch (error) {
    return NextResponse.json(
      {
        error: "Failed to compute Natural ICP",
        details: error instanceof Error ? error.message : undefined,
      },
      { status: 500 }
    );
  }
}
