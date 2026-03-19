import { NextResponse } from "next/server";
import { query } from "@/lib/db/client";

export async function GET() {
  try {
    // Ensure table exists
    await query(`
      CREATE TABLE IF NOT EXISTS rvf_comparisons (
        id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
        winner_id UUID REFERENCES contacts(id),
        loser_id UUID REFERENCES contacts(id),
        is_equal BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // Get a random pair of scored contacts
    const pairResult = await query<{
      id: string;
      full_name: string | null;
      headline: string | null;
      current_company: string | null;
      composite_score: number | null;
      tier: string | null;
      persona: string | null;
    }>(`
      SELECT c.id, c.full_name, c.headline, c.current_company,
             cs.composite_score, cs.tier, cs.persona
      FROM contacts c
      JOIN contact_scores cs ON cs.contact_id = c.id
      WHERE c.is_archived = FALSE
      ORDER BY RANDOM()
      LIMIT 2
    `);

    const countResult = await query<{ cnt: string }>(`
      SELECT COUNT(*) as cnt FROM rvf_comparisons
    `);

    const contactCountResult = await query<{ cnt: string }>(`
      SELECT COUNT(*) as cnt
      FROM contacts c
      JOIN contact_scores cs ON cs.contact_id = c.id
      WHERE c.is_archived = FALSE
    `);

    const totalComparisons = parseInt(countResult.rows[0]?.cnt ?? "0", 10);
    const totalContacts = parseInt(contactCountResult.rows[0]?.cnt ?? "0", 10);

    return NextResponse.json({
      pair: pairResult.rows.length >= 2 ? pairResult.rows : null,
      totalComparisons,
      totalContacts,
    });
  } catch (error) {
    console.error("RVF GET error:", error);
    return NextResponse.json(
      { error: "Failed to fetch RVF pair" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { winnerId, loserId, isEqual } = body as {
      winnerId: string;
      loserId: string;
      isEqual: boolean;
    };

    if (!winnerId || !loserId) {
      return NextResponse.json(
        { error: "winnerId and loserId are required" },
        { status: 400 }
      );
    }

    // Ensure table exists
    await query(`
      CREATE TABLE IF NOT EXISTS rvf_comparisons (
        id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
        winner_id UUID REFERENCES contacts(id),
        loser_id UUID REFERENCES contacts(id),
        is_equal BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    await query(
      `INSERT INTO rvf_comparisons (winner_id, loser_id, is_equal) VALUES ($1, $2, $3)`,
      [winnerId, loserId, isEqual ?? false]
    );

    const countResult = await query<{ cnt: string }>(`
      SELECT COUNT(*) as cnt FROM rvf_comparisons
    `);

    const totalComparisons = parseInt(countResult.rows[0]?.cnt ?? "0", 10);

    return NextResponse.json({
      success: true,
      totalComparisons,
    });
  } catch (error) {
    console.error("RVF POST error:", error);
    return NextResponse.json(
      { error: "Failed to record comparison" },
      { status: 500 }
    );
  }
}
