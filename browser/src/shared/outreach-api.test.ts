import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ExtensionAuthError, fetchOutreachTemplates, isFullExtensionToken, personalizeOutreachTemplate, registerFullExtensionToken,
} from './outreach-api.ts';

const token = `ext_${'A'.repeat(43)}`;
const appUrl = 'http://localhost:3750';
const id = '11111111-1111-4111-8111-111111111111';

test('popup and sidepanel use the same full-token request contract', () => {
  assert.equal(isFullExtensionToken(token), true);
  assert.equal(isFullExtensionToken('ext_AAAAAAAA'), false);
  for (const file of ['../popup/popup.ts', '../sidepanel/sidepanel.ts']) {
    const source = readFileSync(new URL(file, import.meta.url), 'utf8');
    assert.match(source, /fetchOutreachTemplates\(/);
    assert.match(source, /personalizeOutreachTemplate\(/);
  }
  const popup = readFileSync(new URL('../popup/popup.ts', import.meta.url), 'utf8');
  assert.match(popup, /isFullExtensionToken\(result\.extensionToken\)/);
  assert.match(popup, /registerFullExtensionToken\(appUrl, token\)/);
  assert.match(popup, /Saved token expired or was revoked/);
  assert.match(popup, /showPopupReauth\('Token expired or revoked/);
  const appClient = readFileSync(new URL('./app-client.ts', import.meta.url), 'utf8');
  assert.match(appClient, /if \(!isFullExtensionToken\(displayToken\)\)/);
  assert.match(appClient, /if \(!isFullExtensionToken\(token\)\)/);
});

test('registration rejects a display prefix and exchanges only the full token', async () => {
  const calls: Array<{ url: string; options?: RequestInit }> = [];
  const request = (async (url: string, options?: RequestInit) => {
    calls.push({ url, options });
    return Response.json({ extensionId: id, settings: { autoCaptureEnabled: false } });
  }) as typeof fetch;
  await assert.rejects(registerFullExtensionToken(appUrl, token.slice(0, 12), request), /Full extension token/);
  assert.equal(calls.length, 0);
  const registered = await registerFullExtensionToken(appUrl, token, request);
  assert.equal(registered.extensionId, id);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `${appUrl}/api/extension/register`);
  assert.deepEqual(JSON.parse(String(calls[0].options?.body)), { displayToken: token });
  assert.deepEqual(calls[0].options?.headers, { 'Content-Type': 'application/json' });
});

test('revoked or expired token responses surface a recoverable auth error', async () => {
  const unauthorized = (async () => new Response(null, { status: 401 })) as typeof fetch;
  await assert.rejects(registerFullExtensionToken(appUrl, token, unauthorized),
    (error: unknown) => error instanceof ExtensionAuthError && error.status === 401);
  await assert.rejects(fetchOutreachTemplates(appUrl, token, unauthorized),
    (error: unknown) => error instanceof ExtensionAuthError && error.status === 401);
  const html = readFileSync(new URL('../sidepanel/sidepanel.html', import.meta.url), 'utf8');
  assert.match(html, /id="sp-reauth-token" type="password"/);
  assert.match(html, /id="sp-reauth-submit"/);
});

test('template list maps the server response and sends the full token', async () => {
  const calls: Array<{ url: string; options?: RequestInit }> = [];
  const request = (async (url: string, options?: RequestInit) => {
    calls.push({ url, options });
    return Response.json({ data: [{
      id, name: 'Synthetic', category: 'custom', body_template: 'Hello {{first_name}}',
      merge_variables: ['first_name'],
    }] });
  }) as typeof fetch;
  const templates = await fetchOutreachTemplates(appUrl, token, request);
  assert.deepEqual(templates, [{
    id, name: 'Synthetic', category: 'custom', body: 'Hello {{first_name}}',
    variables: ['first_name'],
  }]);
  assert.equal(calls[0].url, `${appUrl}/api/outreach/templates`);
  assert.deepEqual(calls[0].options?.headers, { 'X-Extension-Token': token });
});

test('personalization sends a canonical profile URL directly to the guarded route', async () => {
  const calls: Array<{ url: string; options?: RequestInit }> = [];
  const request = (async (url: string, options?: RequestInit) => {
    calls.push({ url, options });
    return Response.json({ data: { personalizedContent: 'Hello, synthetic contact' } });
  }) as typeof fetch;
  const content = await personalizeOutreachTemplate(
    appUrl, token, id, 'https://www.linkedin.com/in/synthetic-contact/?trk=ignored', request
  );
  assert.equal(content, 'Hello, synthetic contact');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `${appUrl}/api/claude/personalize`);
  assert.deepEqual(calls[0].options?.headers, {
    'X-Extension-Token': token, 'Content-Type': 'application/json',
  });
  assert.deepEqual(JSON.parse(String(calls[0].options?.body)), {
    templateId: id, contactUrl: 'https://www.linkedin.com/in/synthetic-contact',
  });
});

test('prefix token and invalid profile cannot trigger personalization', async () => {
  let calls = 0;
  const request = (async () => {
    calls++;
    return Response.json({ error: 'Contact not found' }, { status: 404 });
  }) as typeof fetch;
  await assert.rejects(fetchOutreachTemplates(appUrl, 'ext_AAAAAAAA', request), /Full extension token/);
  await assert.rejects(personalizeOutreachTemplate(
    appUrl, 'ext_AAAAAAAA', id, 'https://www.linkedin.com/in/synthetic/', request
  ), /Full extension token/);
  assert.equal(calls, 0);
  await assert.rejects(personalizeOutreachTemplate(
    appUrl, token, id, 'https://www.linkedin.com/in/synthetic/other', request
  ), /LinkedIn contact profile/);
  assert.equal(calls, 0);
  await assert.rejects(personalizeOutreachTemplate(
    appUrl, token, id, 'https://www.linkedin.com/in/synthetic/', request
  ), /Could not personalize/);
  assert.equal(calls, 1);
});

test('fallback templates remain copy-only in both extension surfaces', () => {
  const popup = readFileSync(new URL('../popup/popup.ts', import.meta.url), 'utf8');
  const sidepanel = readFileSync(new URL('../sidepanel/sidepanel.ts', import.meta.url), 'utf8');
  assert.match(popup, /if \(!templatesFromServer\) return;/);
  assert.match(sidepanel, /if \(!spSelectedTemplate \|\| !spTemplatesFromServer\) return;/);
  assert.match(popup, /await loadTemplates\(\);/);
  assert.match(sidepanel, /if \(changes\.extensionToken \|\| changes\.appUrl\) \{[\s\S]*?void loadSidepanelTemplates\(\);/);
  assert.match(sidepanel, /spReauthSubmit\.addEventListener\('click'/);
});
