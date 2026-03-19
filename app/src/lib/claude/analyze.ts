// Network analysis functions powered by Claude

import { claudeChat } from './client';

interface ContactData {
  id: string;
  full_name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  headline?: string | null;
  title?: string | null;
  current_company?: string | null;
  location?: string | null;
  about?: string | null;
  tags?: string[];
  connections_count?: number | null;
}

interface ScoreData {
  compositeScore?: number;
  tier?: string;
  persona?: string | null;
  behavioralPersona?: string | null;
  dimensions?: Array<{
    dimension: string;
    rawValue: number;
    weightedValue: number;
  }>;
}

interface GraphMetricsData {
  pagerank?: number | null;
  betweennessCentrality?: number | null;
  degreeCentrality?: number | null;
}

interface GoalSuggestion {
  title: string;
  description: string;
  tasks: string[];
}

/**
 * Analyze a single contact and return insights as a string.
 */
export async function analyzeContact(
  contact: ContactData,
  scores?: ScoreData | null,
  graphMetrics?: GraphMetricsData | null
): Promise<string> {
  const systemPrompt = `You are a professional networking analyst. Analyze the given contact and provide concise, actionable insights about their potential value as a professional connection. Focus on:
1. Key strengths and areas of influence
2. Potential collaboration opportunities
3. Suggested engagement approach
Keep your response under 300 words.`;

  const contactSummary = buildContactSummary(contact, scores, graphMetrics);

  return claudeChat(systemPrompt, contactSummary, { maxTokens: 512 });
}

/**
 * Generate goal suggestions for a set of contacts/network.
 */
export async function generateGoalsForNetwork(
  contacts: ContactData[],
  scores?: Map<string, ScoreData>
): Promise<GoalSuggestion[]> {
  const systemPrompt = `You are a professional networking strategist. Based on the network data provided, suggest 3-5 actionable goals with specific tasks. Return your response as a JSON array with this structure:
[{ "title": "Goal title", "description": "Why this goal matters", "tasks": ["Task 1", "Task 2"] }]
Return ONLY the JSON array, no other text.`;

  const summaries = contacts.slice(0, 20).map((c) => {
    const score = scores?.get(c.id);
    return buildContactSummary(c, score);
  });

  const userMessage = `Network overview (${contacts.length} contacts, showing top ${summaries.length}):\n\n${summaries.join('\n---\n')}`;

  const response = await claudeChat(systemPrompt, userMessage, {
    maxTokens: 1024,
  });

  try {
    const parsed = JSON.parse(extractJson(response));
    if (Array.isArray(parsed)) {
      return parsed.map((item: Record<string, unknown>) => ({
        title: String(item.title || ''),
        description: String(item.description || ''),
        tasks: Array.isArray(item.tasks)
          ? item.tasks.map((t: unknown) => String(t))
          : [],
      }));
    }
    return [];
  } catch {
    return [];
  }
}

/**
 * Personalize a template by filling merge variables using Claude.
 */
export async function personalizeTemplate(
  template: string,
  contact: ContactData,
  context?: { subject?: string; tone?: string }
): Promise<{ personalizedContent: string; mergeFields: Record<string, string> }> {
  const systemPrompt = `You are an expert at personalizing outreach messages. Given a template with merge variables (wrapped in {{double braces}}) and contact information, fill in the variables naturally. Return a JSON object with two fields:
- "personalizedContent": the fully personalized message
- "mergeFields": an object mapping each merge variable name to the value you used
Return ONLY the JSON object, no other text.`;

  const userMessage = `Template:\n${template}\n\nContact:\n${buildContactSummary(contact)}\n${context?.tone ? `\nTone: ${context.tone}` : ''}`;

  const response = await claudeChat(systemPrompt, userMessage, {
    maxTokens: 1024,
  });

  try {
    const parsed = JSON.parse(extractJson(response));
    return {
      personalizedContent: String(parsed.personalizedContent || template),
      mergeFields:
        typeof parsed.mergeFields === 'object' && parsed.mergeFields !== null
          ? (parsed.mergeFields as Record<string, string>)
          : {},
    };
  } catch {
    return { personalizedContent: template, mergeFields: {} };
  }
}

// -- helpers --

function buildContactSummary(
  contact: ContactData,
  scores?: ScoreData | null,
  graphMetrics?: GraphMetricsData | null
): string {
  const name = contact.full_name || [contact.first_name, contact.last_name].filter(Boolean).join(' ') || 'Unknown';
  const parts: string[] = [`Name: ${name}`];

  if (contact.headline) parts.push(`Headline: ${contact.headline}`);
  if (contact.title) parts.push(`Title: ${contact.title}`);
  if (contact.current_company) parts.push(`Company: ${contact.current_company}`);
  if (contact.location) parts.push(`Location: ${contact.location}`);
  if (contact.about) parts.push(`About: ${contact.about.slice(0, 300)}`);
  if (contact.tags && contact.tags.length > 0) parts.push(`Tags: ${contact.tags.join(', ')}`);
  if (contact.connections_count) parts.push(`Connections: ${contact.connections_count}`);

  if (scores) {
    parts.push(`Score: ${scores.compositeScore ?? 'N/A'}, Tier: ${scores.tier ?? 'N/A'}`);
    if (scores.persona) parts.push(`Persona: ${scores.persona}`);
  }

  if (graphMetrics) {
    const gm: string[] = [];
    if (graphMetrics.pagerank != null) gm.push(`PageRank: ${graphMetrics.pagerank.toFixed(4)}`);
    if (graphMetrics.betweennessCentrality != null) gm.push(`Betweenness: ${graphMetrics.betweennessCentrality.toFixed(4)}`);
    if (graphMetrics.degreeCentrality != null) gm.push(`Degree: ${graphMetrics.degreeCentrality.toFixed(4)}`);
    if (gm.length > 0) parts.push(`Graph metrics: ${gm.join(', ')}`);
  }

  return parts.join('\n');
}

/**
 * Extract JSON from a response that might contain markdown fences or preamble text.
 */
function extractJson(text: string): string {
  // Try to find JSON in markdown code fences
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) return fenceMatch[1].trim();

  // Try to find array or object pattern
  const jsonMatch = text.match(/(\[[\s\S]*\]|\{[\s\S]*\})/);
  if (jsonMatch) return jsonMatch[1].trim();

  return text.trim();
}
