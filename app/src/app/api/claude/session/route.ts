import { NextRequest, NextResponse } from 'next/server';
import {
  createSession, getSession, resumeSession,
  pauseSession, completeSession
} from '@/lib/ecc/cognitive-tick/session-service';
import type { SessionIntent } from '@/lib/ecc/cognitive-tick/types';

const DEFAULT_TENANT_ID = 'default';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { sessionId, userId, intent, action } = body as {
      sessionId?: string;
      userId?: string;
      intent?: Record<string, unknown>;
      action?: 'resume' | 'pause' | 'complete';
    };

    // Resume/pause/complete existing session
    if (sessionId && action) {
      switch (action) {
        case 'resume': {
          const session = await resumeSession(sessionId);
          if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 });
          return NextResponse.json({ data: session });
        }
        case 'pause':
          await pauseSession(sessionId);
          return NextResponse.json({ data: { sessionId, status: 'paused' } });
        case 'complete':
          await completeSession(sessionId);
          return NextResponse.json({ data: { sessionId, status: 'completed' } });
      }
    }

    // Get existing session
    if (sessionId) {
      const session = await getSession(sessionId);
      if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 });
      return NextResponse.json({ data: session });
    }

    // Create new session
    if (!userId) {
      return NextResponse.json({ error: 'userId required for new session' }, { status: 400 });
    }

    const session = await createSession(
      DEFAULT_TENANT_ID,
      userId,
      (intent ?? { goal: 'general research' }) as unknown as SessionIntent
    );

    return NextResponse.json({ data: session }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to manage session', details: error instanceof Error ? error.message : undefined },
      { status: 500 }
    );
  }
}
