// GET /api/contacts/[id]/gauges — All 5 ECC gauge scores for a contact

import { NextRequest, NextResponse } from "next/server";
import { computeAllGauges } from "@/lib/ecc/gauges";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: contactId } = await params;

    if (!contactId) {
      return NextResponse.json(
        { error: "Contact ID required" },
        { status: 400 }
      );
    }

    const gauges = await computeAllGauges(contactId);
    return NextResponse.json(gauges, { status: gauges.errors.length === 5 ? 503 : 200 });
  } catch (error) {
    return NextResponse.json(
      {
        error: "Failed to compute gauges",
        details: error instanceof Error ? error.message : undefined,
      },
      { status: 500 }
    );
  }
}
