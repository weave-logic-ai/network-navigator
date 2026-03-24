// GET/POST /api/profile/desired-icp — Manage desired ICP configuration

import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db/client";

export async function GET() {
  try {
    const ownerRes = await query<{ metadata: Record<string, unknown> }>(
      `SELECT metadata FROM owner_profiles WHERE is_active = TRUE LIMIT 1`
    ).catch(() => ({ rows: [] }));

    const metadata = ownerRes.rows[0]?.metadata || {};
    const config = metadata.desiredIcpConfig || null;

    return NextResponse.json({ data: config });
  } catch (error) {
    return NextResponse.json(
      {
        error: "Failed to load desired ICP config",
        details: error instanceof Error ? error.message : undefined,
      },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { nicheId, icpId, offeringIds, isDefault } = body;

    if (!icpId) {
      return NextResponse.json(
        { error: "icpId is required" },
        { status: 400 }
      );
    }

    const config = {
      nicheId: nicheId || null,
      icpId,
      offeringIds: offeringIds || [],
      isDefault: isDefault ?? false,
      savedAt: new Date().toISOString(),
    };

    // Update owner profile metadata
    await query(
      `UPDATE owner_profiles
       SET metadata = metadata || $1
       WHERE is_active = TRUE`,
      [JSON.stringify({ desiredIcpConfig: config })]
    );

    return NextResponse.json({ data: config });
  } catch (error) {
    return NextResponse.json(
      {
        error: "Failed to save desired ICP config",
        details: error instanceof Error ? error.message : undefined,
      },
      { status: 500 }
    );
  }
}
