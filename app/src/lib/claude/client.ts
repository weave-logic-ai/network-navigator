// Claude API client wrapper — singleton pattern

import Anthropic from '@anthropic-ai/sdk';

let client: Anthropic | null = null;

export function getClaudeClient(): Anthropic {
  if (!client) {
    client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return client;
}

export async function claudeChat(
  systemPrompt: string,
  userMessage: string,
  options?: { model?: string; maxTokens?: number }
): Promise<string> {
  const claude = getClaudeClient();
  const response = await claude.messages.create({
    model: options?.model || 'claude-sonnet-4-20250514',
    max_tokens: options?.maxTokens || 1024,
    system: systemPrompt,
    messages: [{ role: 'user', content: userMessage }],
  });
  const block = response.content[0];
  return block.type === 'text' ? block.text : '';
}
