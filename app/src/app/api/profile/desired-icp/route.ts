// GET /api/profile/desired-icp - fetch saved desired ICP config
// POST /api/profile/desired-icp - save desired ICP config

import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db/client";

interface DesiredIcpConfig {
  nicheId: string | null;
  icpId: string | null;
  offeringIds: string[];
  isDefault: boolean;
  savedAt: string;
}

// Ensure metadata column exists (idempotent)
async function ensureMetadataColumn(): Promise<void> {
  await query(
    `ALTER TABLE owner_profiles ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'`
  );
}

export async function GET() {
  try {
    await ensureMetadataColumn();

    const result = await query<{ metadata: Record<string, unknown> }>(
      `SELECT metadata FROM owner_profiles WHERE is_current = TRUE LIMIT 1`
    );

    if (result.rows.length === 0) {
      return NextResponse.json({ data: null });
    }

    const metadata = result.rows[0].metadata || {};
    const config = (metadata.desiredIcpConfig as DesiredIcpConfig) || null;

    return NextResponse.json({ data: config });
  } catch (error) {
    return NextResponse.json(
      {
        error: "Failed to fetch desired ICP config",
        details: error instanceof Error ? error.message : undefined,
      },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    await ensureMetadataColumn();

    const body = await request.json();
    const { nicheId, icpId, offeringIds, isDefault } = body as {
      nicheId?: string | null;
      icpId?: string | null;
      offeringIds?: string[];
      isDefault?: boolean;
    };

    const config: DesiredIcpConfig = {
      nicheId: nicheId ?? null,
      icpId: icpId ?? null,
      offeringIds: offeringIds ?? [],
      isDefault: isDefault ?? false,
      savedAt: new Date().toISOString(),
    };

    // Upsert into metadata JSONB on the current owner profile
    const result = await query(
      `UPDATE owner_profiles
       SET metadata = COALESCE(metadata, '{}')::jsonb || jsonb_build_object('desiredIcpConfig', $1::jsonb),
           updated_at = now()
       WHERE is_current = TRUE
       RETURNING id`,
      [JSON.stringify(config)]
    );

    if (result.rows.length === 0) {
      return NextResponse.json(
        { error: "No current owner profile found" },
        { status: 404 }
      );
    }

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
