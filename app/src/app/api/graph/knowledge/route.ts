import { NextRequest, NextResponse } from 'next/server';
import { buildKnowledgeGraph, getCachedSnapshot, saveSnapshot } from '@/lib/graph/knowledge-local';
import { requireLocalDashboardRequest } from '@/lib/auth/local-request-boundary';
import { query, transaction } from '@/lib/db/client';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function nicheExists(nicheId: string): Promise<boolean> {
  const result = await query('SELECT 1 FROM niche_profiles WHERE id = $1', [nicheId]);
  return result.rows.length > 0;
}

async function rebuildSnapshot(nicheId: string | null) {
  return transaction(async (client) => {
    // Erasure takes the same transaction lock before deleting the contact and
    // affected snapshots. Building and saving on this client prevents an
    // in-flight rebuild from republishing an erased contact after deletion.
    await client.query('SELECT pg_advisory_xact_lock(1733164046, 1)');
    const graph = await buildKnowledgeGraph(nicheId ?? undefined, client);
    await saveSnapshot(graph, nicheId, client);
    return graph;
  });
}

export async function GET(request: NextRequest) {
  const denied = await requireLocalDashboardRequest(request);
  if (denied) return denied;
  const nicheId = request.nextUrl.searchParams.get('nicheId');
  const refresh = request.nextUrl.searchParams.get('refresh');
  if (refresh !== null) {
    return NextResponse.json(
      { error: 'Manual refresh requires an authorized mutation request' },
      { status: 405, headers: { Allow: 'GET, POST' } }
    );
  }
  if (nicheId && !UUID.test(nicheId)) {
    return NextResponse.json({ error: 'Invalid nicheId' }, { status: 400 });
  }

  try {
    if (nicheId && !await nicheExists(nicheId)) {
      return NextResponse.json({ error: 'Niche not found' }, { status: 404 });
    }
    const cached = await getCachedSnapshot(nicheId);
    if (cached) return NextResponse.json({ data: cached, cached: true });

    const graph = await rebuildSnapshot(nicheId);
    return NextResponse.json({ data: graph, cached: false });
  } catch {
    return NextResponse.json({ error: 'Failed to load knowledge graph' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const denied = await requireLocalDashboardRequest(request, true);
  if (denied) return denied;
  const nicheId = request.nextUrl.searchParams.get('nicheId');
  if (nicheId && !UUID.test(nicheId)) {
    return NextResponse.json({ error: 'Invalid nicheId' }, { status: 400 });
  }

  try {
    if (nicheId && !await nicheExists(nicheId)) {
      return NextResponse.json({ error: 'Niche not found' }, { status: 404 });
    }
    const graph = await rebuildSnapshot(nicheId);
    return NextResponse.json({ data: graph, cached: false });
  } catch {
    return NextResponse.json({ error: 'Failed to refresh knowledge graph' }, { status: 500 });
  }
}
