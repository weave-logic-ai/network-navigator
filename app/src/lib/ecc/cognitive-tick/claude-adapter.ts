import { claudeChat } from '../../claude/client';
import { ECC_FLAGS } from '../types';
import {
  createSession, getSession, addSessionMessage,
  getSessionMessages, updateSessionContext
} from './session-service';
import type { SessionIntent, IntentShift } from './types';

const DEFAULT_TENANT_ID = 'default';

/**
 * Analyze a contact with session context.
 * When ECC_COGNITIVE_TICK is disabled, performs a stateless analysis.
 */
export async function analyzeWithSession(
  tenantId: string = DEFAULT_TENANT_ID,
  userId: string,
  contactId: string,
  prompt: string,
  contactSummary: string,
  sessionId?: string
): Promise<{ response: string; sessionId: string | null }> {
  if (!ECC_FLAGS.cognitiveTick) {
    // Stateless fallback
    const systemPrompt = `You are a professional networking analyst. Analyze the given contact and provide concise, actionable insights. Keep your response under 300 words.`;
    const response = await claudeChat(systemPrompt, `${contactSummary}\n\nUser request: ${prompt}`, { maxTokens: 512 });
    return { response, sessionId: null };
  }

  // Get or create session
  let session;
  if (sessionId) {
    session = await getSession(sessionId);
    if (!session || session.status !== 'active') {
      // Create new session if provided one is invalid
      session = await createSession(tenantId, userId, {
        goal: 'analyze',
        contactIds: [contactId],
      });
    }
  } else {
    session = await createSession(tenantId, userId, {
      goal: 'analyze',
      contactIds: [contactId],
    });
  }

  // Load recent messages for context
  const recentMessages = await getSessionMessages(session.id, 10);

  // Build system prompt with session context
  const intent = session.intent as unknown as SessionIntent;
  const systemPrompt = buildSessionSystemPrompt(intent, session.context);

  // Build conversation history for Claude
  const conversationContext = recentMessages
    .map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
    .join('\n\n');

  const fullPrompt = conversationContext
    ? `Previous conversation:\n${conversationContext}\n\nCurrent contact:\n${contactSummary}\n\nNew request: ${prompt}`
    : `Contact:\n${contactSummary}\n\nRequest: ${prompt}`;

  // Record user message
  await addSessionMessage(session.id, 'user', prompt, { contactId, intent: session.intent });

  // Call Claude with full context
  const response = await claudeChat(systemPrompt, fullPrompt, { maxTokens: 512 });

  // Record assistant response
  await addSessionMessage(session.id, 'assistant', response, {});

  // Update session context
  const intentShift = detectIntentShift(intent, prompt);
  const contextUpdates: Record<string, unknown> = {
    lastContactAnalyzed: contactId,
    lastAnalyzedAt: new Date().toISOString(),
    messageCount: (recentMessages.length + 2), // +2 for this exchange
  };

  if (intentShift) {
    contextUpdates.lastIntentShift = intentShift;
  }

  await updateSessionContext(session.id, contextUpdates);

  return { response, sessionId: session.id };
}

function buildSessionSystemPrompt(
  intent: SessionIntent,
  context: Record<string, unknown>
): string {
  const parts = [
    'You are a professional networking analyst with context from an ongoing research session.',
    '',
    `Research goal: ${intent.goal || 'general analysis'}`,
  ];

  if (intent.icpFocus && intent.icpFocus.length > 0) {
    parts.push(`ICP focus: ${intent.icpFocus.join(', ')}`);
  }
  if (intent.verticals && intent.verticals.length > 0) {
    parts.push(`Verticals: ${intent.verticals.join(', ')}`);
  }

  const lastAnalyzed = context.lastContactAnalyzed;
  if (lastAnalyzed) {
    parts.push(`\nPrevious contact analyzed: ${lastAnalyzed}`);
  }

  parts.push('\nProvide concise, actionable insights. Keep your response under 300 words.');
  parts.push('If you notice patterns across analyzed contacts in this session, mention them.');

  return parts.join('\n');
}

/**
 * Detect if the user's new prompt indicates an intent shift.
 * Simple keyword-based detection for v1.
 */
export function detectIntentShift(
  currentIntent: SessionIntent,
  newPrompt: string
): IntentShift | null {
  const lower = newPrompt.toLowerCase();

  // Detect vertical shift keywords
  const verticalKeywords = ['focus on', 'switch to', 'now look at', 'pivot to'];
  const verticalMatch = verticalKeywords.find(kw => lower.includes(kw));
  if (verticalMatch) {
    const afterKeyword = lower.split(verticalMatch)[1]?.trim();
    if (afterKeyword && afterKeyword.length > 2) {
      const newVertical = afterKeyword.split(/[.,!?\s]/)[0];
      return {
        type: 'vertical_shift',
        from: currentIntent.verticals ?? [],
        to: [newVertical],
      };
    }
  }

  // Detect ICP focus shift
  const icpKeywords = ['ctos', 'cfos', 'ceos', 'developers', 'engineers', 'managers', 'directors', 'vps'];
  const matchedIcp = icpKeywords.find(kw => lower.includes(kw));
  if (matchedIcp && !currentIntent.icpFocus?.some(f => f.toLowerCase() === matchedIcp)) {
    return {
      type: 'icp_shift',
      from: currentIntent.icpFocus ?? [],
      to: [matchedIcp],
    };
  }

  return null;
}
