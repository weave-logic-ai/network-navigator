import type { OutreachTemplate } from '../types';

export function isFullExtensionToken(value: unknown): value is string {
  return typeof value === 'string' && /^ext_[A-Za-z0-9_-]{43}$/.test(value);
}

export class ExtensionAuthError extends Error {
  readonly status: number;
  constructor(status: number) {
    super('Extension token rejected');
    this.status = status;
  }
}

export async function registerFullExtensionToken(
  appUrl: string, token: string, request: typeof fetch = fetch
): Promise<{ extensionId: string; settings: unknown }> {
  if (!isFullExtensionToken(token)) throw new Error('Full extension token required');
  const response = await request(`${appUrl}/api/extension/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ displayToken: token }),
  });
  if (response.status === 401 || response.status === 403) throw new ExtensionAuthError(response.status);
  if (!response.ok) throw new Error('Registration failed');
  const payload = await response.json() as { extensionId?: unknown; settings?: unknown };
  if (typeof payload.extensionId !== 'string') throw new Error('Invalid registration response');
  return { extensionId: payload.extensionId, settings: payload.settings };
}

function tokenHeaders(token: string): Record<string, string> {
  if (!isFullExtensionToken(token)) throw new Error('Full extension token required');
  return { 'X-Extension-Token': token };
}

export async function fetchOutreachTemplates(
  appUrl: string, token: string, request: typeof fetch = fetch
): Promise<OutreachTemplate[]> {
  const response = await request(`${appUrl}/api/outreach/templates`, {
    headers: tokenHeaders(token),
  });
  if (response.status === 401 || response.status === 403) throw new ExtensionAuthError(response.status);
  if (!response.ok) throw new Error('Could not load templates');
  const payload = await response.json() as { data?: unknown };
  if (!Array.isArray(payload.data)) throw new Error('Invalid template response');
  return payload.data.map((row: Record<string, unknown>) => {
    if (typeof row.id !== 'string' || typeof row.name !== 'string'
      || typeof row.category !== 'string' || typeof row.body_template !== 'string') {
      throw new Error('Invalid template response');
    }
    return {
      id: row.id,
      name: row.name,
      category: row.category,
      body: row.body_template,
      variables: Array.isArray(row.merge_variables)
        ? row.merge_variables.filter((value): value is string => typeof value === 'string')
        : [],
    };
  });
}

export async function personalizeOutreachTemplate(
  appUrl: string, token: string, templateId: string, contactUrl: string,
  request: typeof fetch = fetch
): Promise<string> {
  const headers = tokenHeaders(token);
  const profile = new URL(contactUrl);
  if (profile.protocol !== 'https:' || profile.username || profile.password || profile.port
    || !['linkedin.com', 'www.linkedin.com'].includes(profile.hostname)
    || !/^\/in\/[A-Za-z0-9_-]+\/?$/.test(profile.pathname)) {
    throw new Error('A LinkedIn contact profile is required');
  }
  const response = await request(`${appUrl}/api/claude/personalize`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ templateId, contactUrl: `https://${profile.hostname}${profile.pathname.replace(/\/$/, '')}` }),
  });
  if (response.status === 401 || response.status === 403) throw new ExtensionAuthError(response.status);
  if (!response.ok) throw new Error('Could not personalize template');
  const payload = await response.json() as { data?: { personalizedContent?: unknown } };
  if (typeof payload.data?.personalizedContent !== 'string') {
    throw new Error('Invalid personalization response');
  }
  return payload.data.personalizedContent;
}
