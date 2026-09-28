// PUT /api/enrichment/providers/[id] - Update provider config

import { NextRequest, NextResponse } from 'next/server';
import * as enrichmentQueries from '@/lib/db/queries/enrichment';
import { providerReadiness, publicProvider } from '@/lib/enrichment/providers';
import { requireLocalDashboardRequest } from '@/lib/auth/local-request-boundary';

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await requireLocalDashboardRequest(request, true);
  if (denied) return denied;
  try {
    const { id } = await params;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
      return NextResponse.json({ error: 'Invalid provider ID' }, { status: 400 });
    }
    let body: unknown;
    try { body = await request.json(); } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ error: 'Expected a provider update object' }, { status: 400 });
    }
    const input = body as Record<string, unknown>;
    if (Object.keys(input).length === 0 || Object.keys(input).some(key => !['isActive', 'apiKey'].includes(key))
      || (input.isActive !== undefined && typeof input.isActive !== 'boolean')
      || (input.apiKey !== undefined && (typeof input.apiKey !== 'string'
        || input.apiKey.trim().length < 8 || input.apiKey.length > 4096))) {
      return NextResponse.json({ error: 'Provide isActive (boolean) and/or an API key of 8–4096 characters' }, { status: 400 });
    }
    const existing = await enrichmentQueries.getProviderById(id);
    if (!existing) {
      return NextResponse.json({ error: 'Provider not found' }, { status: 404 });
    }
    if (input.apiKey !== undefined && !['pdl', 'lusha', 'theirstack', 'apollo'].includes(existing.name)) {
      return NextResponse.json({ error: 'This provider does not accept an API key here' }, { status: 400 });
    }
    const updatedConfig = input.apiKey === undefined ? existing.config : {
      ...existing.config, apiKey: (input.apiKey as string).trim(),
    };
    const proposed = { ...existing, config: updatedConfig };
    if (input.isActive === true && !providerReadiness(proposed).canActivate) {
      return NextResponse.json({ error: providerReadiness(proposed).setupMessage }, { status: 400 });
    }
    const provider = await enrichmentQueries.updateProvider(id, {
      ...(input.isActive !== undefined ? { isActive: input.isActive as boolean } : {}),
      ...(input.apiKey !== undefined ? { config: updatedConfig } : {}),
    });
    return NextResponse.json({ data: publicProvider(provider!) });
  } catch {
    return NextResponse.json(
      { error: 'Failed to update provider' },
      { status: 500 }
    );
  }
}
