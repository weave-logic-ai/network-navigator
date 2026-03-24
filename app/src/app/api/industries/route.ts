// GET  /api/industries - List all industries
// POST /api/industries - Create a new industry

import { NextRequest, NextResponse } from 'next/server';
import { listIndustries, createIndustry } from '@/lib/taxonomy/service';

export async function GET() {
  try {
    const industries = await listIndustries();
    return NextResponse.json({ data: industries });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to list industries', details: error instanceof Error ? error.message : undefined },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    if (!body.name || typeof body.name !== 'string') {
      return NextResponse.json({ error: 'name is required' }, { status: 400 });
    }
    const industry = await createIndustry({
      name: body.name,
      description: body.description,
      metadata: body.metadata,
    });
    return NextResponse.json({ data: industry }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to create industry', details: error instanceof Error ? error.message : undefined },
      { status: 500 }
    );
  }
}
