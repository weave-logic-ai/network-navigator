// GET /api/admin/export - CSV export of contacts with scores

import { NextResponse } from 'next/server';
import { query } from '@/lib/db/client';

interface ExportRow {
  full_name: string | null;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  title: string | null;
  current_company: string | null;
  location: string | null;
  linkedin_url: string;
  composite_score: number | null;
  tier: string | null;
  persona: string | null;
  tags: string[];
}

export async function GET() {
  try {
    const result = await query<ExportRow>(
      `SELECT
        c.full_name, c.first_name, c.last_name,
        c.email, c.phone, c.title, c.current_company,
        c.location, c.linkedin_url,
        cs.composite_score, cs.tier, cs.persona,
        c.tags
      FROM contacts c
      LEFT JOIN contact_scores cs ON cs.contact_id = c.id
      WHERE c.is_archived = FALSE AND c.degree > 0
      ORDER BY cs.composite_score DESC NULLS LAST, c.full_name`
    );

    const columns = [
      'full_name', 'first_name', 'last_name', 'email', 'phone',
      'title', 'current_company', 'location', 'linkedin_url',
      'composite_score', 'tier', 'persona', 'tags',
    ];

    // Build CSV
    const header = columns.join(',');
    const rows = result.rows.map(row => {
      return columns.map(col => {
        const key = col as keyof ExportRow;
        const value = row[key];
        if (value === null || value === undefined) return '';
        if (Array.isArray(value)) return escapeCsvField(value.join('; '));
        return escapeCsvField(String(value));
      }).join(',');
    });

    const csv = [header, ...rows].join('\n');

    return new NextResponse(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="contacts-export-${new Date().toISOString().split('T')[0]}.csv"`,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: 'Export failed', details: error instanceof Error ? error.message : undefined },
      { status: 500 }
    );
  }
}

function escapeCsvField(value: string): string {
  // If the field contains commas, quotes, or newlines, wrap in quotes and escape inner quotes
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}
