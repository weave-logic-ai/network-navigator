// GET /api/contacts/[id]/icp-breakdown — ICP fit transparency
// Returns which ICP was used, per-criterion match/mismatch, and raw values.

import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db/client";
import { IcpCriteria } from "@/lib/scoring/types";

interface CriterionResult {
  criterion: string;
  label: string;
  matched: boolean;
  matchDetail: string | null;
  rawValue: string | null;
  score: number;
}

interface IcpBreakdownResponse {
  icpId: string | null;
  icpName: string;
  nicheId: string | null;
  nicheName: string | null;
  overallFit: number;
  criteria: CriterionResult[];
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: contactId } = await params;
    const { searchParams } = new URL(request.url);
    const icpIdParam = searchParams.get("icpId");

    if (!contactId) {
      return NextResponse.json(
        { error: "Contact ID required" },
        { status: 400 }
      );
    }

    // Load contact data
    const contactRes = await query<{
      id: string;
      title: string | null;
      headline: string | null;
      about: string | null;
      current_company: string | null;
      connections_count: number | null;
      tags: string[] | null;
      location: string | null;
    }>(
      `SELECT c.id, c.title, c.headline, c.about, c.current_company,
              c.connections_count, c.tags, c.location
       FROM contacts c WHERE c.id = $1`,
      [contactId]
    );

    if (contactRes.rows.length === 0) {
      return NextResponse.json(
        { error: "Contact not found" },
        { status: 404 }
      );
    }
    const contact = contactRes.rows[0];

    // Load company data
    const companyRes = await query<{
      industry: string | null;
      size_range: string | null;
    }>(
      `SELECT co.industry, co.size_range
       FROM contacts c
       JOIN companies co ON c.current_company_id = co.id
       WHERE c.id = $1`,
      [contactId]
    );
    const company = companyRes.rows[0] ?? {
      industry: null,
      size_range: null,
    };

    // Find ICP to score against
    let icpQuery: string;
    let icpParams: unknown[];

    if (icpIdParam) {
      icpQuery = `SELECT id, name, niche_id, criteria FROM icp_profiles WHERE id = $1`;
      icpParams = [icpIdParam];
    } else {
      // Use the first active ICP (matching existing scoring behavior)
      icpQuery = `SELECT id, name, niche_id, criteria FROM icp_profiles WHERE is_active = true ORDER BY created_at LIMIT 1`;
      icpParams = [];
    }

    const icpRes = await query<{
      id: string;
      name: string;
      niche_id: string | null;
      criteria: Record<string, unknown>;
    }>(icpQuery, icpParams);

    if (icpRes.rows.length === 0) {
      return NextResponse.json({
        data: {
          icpId: null,
          icpName: "No active ICP",
          nicheId: null,
          nicheName: null,
          overallFit: 0,
          criteria: [],
        } satisfies IcpBreakdownResponse,
      });
    }

    const icp = icpRes.rows[0];
    const criteria = icp.criteria as IcpCriteria;

    // Optionally load niche name
    let nicheName: string | null = null;
    if (icp.niche_id) {
      const nicheRes = await query<{ name: string }>(
        `SELECT name FROM niche_profiles WHERE id = $1`,
        [icp.niche_id]
      );
      nicheName = nicheRes.rows[0]?.name ?? null;
    }

    // Evaluate each criterion
    const results: CriterionResult[] = [];
    let totalChecks = 0;
    let matchedChecks = 0;

    // 1. Role match
    if (criteria.roles && criteria.roles.length > 0) {
      totalChecks++;
      const titleLower = (contact.title || contact.headline || "").toLowerCase();
      const matchedRole = criteria.roles.find((r) =>
        titleLower.includes(r.toLowerCase())
      );
      const matched = !!matchedRole;
      if (matched) matchedChecks++;
      results.push({
        criterion: "roles",
        label: "Role Match",
        matched,
        matchDetail: matched
          ? `Matched "${matchedRole}" in title/headline`
          : null,
        rawValue: contact.title || contact.headline || "(empty)",
        score: matched ? 1.0 : 0.0,
      });
    }

    // 2. Industry match
    if (criteria.industries && criteria.industries.length > 0) {
      totalChecks++;
      const industry = (company.industry || "").toLowerCase();
      const matchedIndustry = criteria.industries.find((i) =>
        industry.includes(i.toLowerCase())
      );
      const matched = !!matchedIndustry;
      if (matched) matchedChecks++;
      results.push({
        criterion: "industries",
        label: "Industry Match",
        matched,
        matchDetail: matched ? `Matched "${matchedIndustry}"` : null,
        rawValue: company.industry || "(unknown)",
        score: matched ? 1.0 : 0.0,
      });
    }

    // 3. Signal keywords
    if (criteria.signals && criteria.signals.length > 0) {
      totalChecks++;
      const text = [
        contact.headline,
        contact.about,
        ...(contact.tags || []),
      ]
        .join(" ")
        .toLowerCase();
      const matchedSignals = criteria.signals.filter((s) =>
        text.includes(s.toLowerCase())
      );
      const score =
        matchedSignals.length > 0
          ? matchedSignals.length / criteria.signals.length
          : 0;
      if (matchedSignals.length > 0) matchedChecks += score;
      results.push({
        criterion: "signals",
        label: "Signal Keywords",
        matched: matchedSignals.length > 0,
        matchDetail:
          matchedSignals.length > 0
            ? `Found: ${matchedSignals.map((s) => `"${s}"`).join(", ")}`
            : null,
        rawValue: `${matchedSignals.length}/${criteria.signals.length} signals matched`,
        score,
      });
    }

    // 4. Company size
    if (criteria.companySizeRanges && criteria.companySizeRanges.length > 0) {
      totalChecks++;
      const matched =
        !!company.size_range &&
        criteria.companySizeRanges.includes(company.size_range);
      if (matched) matchedChecks++;
      results.push({
        criterion: "companySizeRanges",
        label: "Company Size",
        matched,
        matchDetail: matched ? `Matched "${company.size_range}"` : null,
        rawValue: company.size_range || "(unknown)",
        score: matched ? 1.0 : 0.0,
      });
    }

    // 5. Location
    if (criteria.locations && criteria.locations.length > 0) {
      totalChecks++;
      const location = (contact.location || "").toLowerCase();
      const matchedLocation = criteria.locations.find((l) =>
        location.includes(l.toLowerCase())
      );
      const matched = !!matchedLocation;
      if (matched) matchedChecks++;
      results.push({
        criterion: "locations",
        label: "Location",
        matched,
        matchDetail: matched ? `Matched "${matchedLocation}"` : null,
        rawValue: contact.location || "(unknown)",
        score: matched ? 1.0 : 0.0,
      });
    }

    // 6. Niche keywords
    if (criteria.nicheKeywords && criteria.nicheKeywords.length > 0) {
      totalChecks++;
      const text = [
        contact.headline,
        contact.about,
        ...(contact.tags || []),
      ]
        .join(" ")
        .toLowerCase();
      const matchedKw = criteria.nicheKeywords.filter((k) =>
        text.includes(k.toLowerCase())
      );
      const score =
        matchedKw.length > 0
          ? matchedKw.length / criteria.nicheKeywords.length
          : 0;
      if (matchedKw.length > 0) matchedChecks += score;
      results.push({
        criterion: "nicheKeywords",
        label: "Niche Keywords",
        matched: matchedKw.length > 0,
        matchDetail:
          matchedKw.length > 0
            ? `Found: ${matchedKw.map((k) => `"${k}"`).join(", ")}`
            : null,
        rawValue: `${matchedKw.length}/${criteria.nicheKeywords.length} keywords matched`,
        score,
      });
    }

    // 7. Min connections
    if (criteria.minConnections && criteria.minConnections > 0) {
      totalChecks++;
      const matched =
        !!contact.connections_count &&
        contact.connections_count >= criteria.minConnections;
      if (matched) matchedChecks++;
      results.push({
        criterion: "minConnections",
        label: "Min Connections",
        matched,
        matchDetail: matched
          ? `${contact.connections_count} >= ${criteria.minConnections}`
          : null,
        rawValue: contact.connections_count
          ? `${contact.connections_count}`
          : "(unknown)",
        score: matched ? 1.0 : 0.0,
      });
    }

    const overallFit = totalChecks > 0 ? matchedChecks / totalChecks : 0;

    const data: IcpBreakdownResponse = {
      icpId: icp.id,
      icpName: icp.name,
      nicheId: icp.niche_id,
      nicheName,
      overallFit,
      criteria: results,
    };

    return NextResponse.json({ data });
  } catch (error) {
    return NextResponse.json(
      {
        error: "Failed to compute ICP breakdown",
        details: error instanceof Error ? error.message : undefined,
      },
      { status: 500 }
    );
  }
}
