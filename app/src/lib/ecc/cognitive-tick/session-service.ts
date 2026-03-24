import { query } from '../../db/client';
import type { ResearchSession, SessionMessage } from '../types';
import type { SessionIntent } from './types';

export async function createSession(
  tenantId: string,
  userId: string,
  intent: SessionIntent
): Promise<ResearchSession> {
  const result = await query<Record<string, unknown>>(
    `INSERT INTO research_sessions (tenant_id, user_id, intent, context, status)
     VALUES ($1, $2, $3, '{}', 'active')
     RETURNING *`,
    [tenantId, userId, JSON.stringify(intent)]
  );
  return mapSession(result.rows[0]);
}

export async function getSession(sessionId: string): Promise<ResearchSession | null> {
  const result = await query<Record<string, unknown>>(
    `SELECT * FROM research_sessions WHERE id = $1`,
    [sessionId]
  );
  return result.rows[0] ? mapSession(result.rows[0]) : null;
}

export async function getActiveSessionForUser(
  tenantId: string,
  userId: string
): Promise<ResearchSession | null> {
  const result = await query<Record<string, unknown>>(
    `SELECT * FROM research_sessions
     WHERE tenant_id = $1 AND user_id = $2 AND status = 'active'
     ORDER BY updated_at DESC LIMIT 1`,
    [tenantId, userId]
  );
  return result.rows[0] ? mapSession(result.rows[0]) : null;
}

export async function updateSessionContext(
  sessionId: string,
  updates: Record<string, unknown>
): Promise<void> {
  await query(
    `UPDATE research_sessions
     SET context = context || $1::jsonb, updated_at = NOW()
     WHERE id = $2`,
    [JSON.stringify(updates), sessionId]
  );
}

export async function updateSessionIntent(
  sessionId: string,
  intent: Partial<SessionIntent>
): Promise<void> {
  await query(
    `UPDATE research_sessions
     SET intent = intent || $1::jsonb, updated_at = NOW()
     WHERE id = $2`,
    [JSON.stringify(intent), sessionId]
  );
}

export async function pauseSession(sessionId: string): Promise<void> {
  await query(
    `UPDATE research_sessions SET status = 'paused', updated_at = NOW() WHERE id = $1`,
    [sessionId]
  );
}

export async function resumeSession(sessionId: string): Promise<ResearchSession | null> {
  const result = await query<Record<string, unknown>>(
    `UPDATE research_sessions SET status = 'active', updated_at = NOW()
     WHERE id = $1 RETURNING *`,
    [sessionId]
  );
  return result.rows[0] ? mapSession(result.rows[0]) : null;
}

export async function completeSession(sessionId: string): Promise<void> {
  await query(
    `UPDATE research_sessions SET status = 'completed', updated_at = NOW() WHERE id = $1`,
    [sessionId]
  );
}

// --- Session Messages ---

export async function addSessionMessage(
  sessionId: string,
  role: 'user' | 'assistant' | 'system',
  content: string,
  contextSnapshot: Record<string, unknown> = {},
  tokensUsed: number = 0
): Promise<SessionMessage> {
  const result = await query<Record<string, unknown>>(
    `INSERT INTO session_messages (session_id, role, content, context_snapshot, tokens_used)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [sessionId, role, content, JSON.stringify(contextSnapshot), tokensUsed]
  );
  return mapMessage(result.rows[0]);
}

export async function getSessionMessages(
  sessionId: string,
  limit: number = 10
): Promise<SessionMessage[]> {
  const result = await query<Record<string, unknown>>(
    `SELECT * FROM session_messages
     WHERE session_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [sessionId, limit]
  );
  // Reverse to get chronological order
  return result.rows.reverse().map(mapMessage);
}

// --- Auto-Pause Inactive Sessions ---

export async function pauseInactiveSessions(
  inactiveMinutes: number = 30
): Promise<number> {
  const result = await query(
    `UPDATE research_sessions
     SET status = 'paused', updated_at = NOW()
     WHERE status = 'active' AND updated_at < NOW() - INTERVAL '1 minute' * $1
     RETURNING id`,
    [inactiveMinutes]
  );
  return result.rows.length;
}

// --- Mappers ---

function mapSession(row: Record<string, unknown>): ResearchSession {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    userId: String(row.user_id),
    intent: (row.intent ?? {}) as Record<string, unknown>,
    context: (row.context ?? {}) as Record<string, unknown>,
    status: String(row.status) as ResearchSession['status'],
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function mapMessage(row: Record<string, unknown>): SessionMessage {
  return {
    id: String(row.id),
    sessionId: String(row.session_id),
    role: String(row.role) as SessionMessage['role'],
    content: String(row.content),
    contextSnapshot: (row.context_snapshot ?? {}) as Record<string, unknown>,
    tokensUsed: Number(row.tokens_used ?? 0),
    createdAt: String(row.created_at),
  };
}
