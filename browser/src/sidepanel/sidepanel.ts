// LinkedIn Network Intelligence - Side Panel UI
// Full goal/task display, current page info, activity stats

import type {
  ExtensionMessage,
  ExtensionTask,
  Goal,
  OutreachTemplate,
  SnippetSelectionResponse,
  SnippetImageFromUrlResponse,
} from '../types';
import { logger } from '../utils/logger';
import { getDailyCaptureCount, getCaptureLimit } from '../utils/storage';
import {
  detectAndScrubPii,
  summarizePiiDetection,
} from '../shared/pii-scrubber';
import {
  enqueueSnippet,
  getSnippetQueueDepth,
  SNIPPET_QUEUE_KEY,
} from '../shared/snippet-queue';
import { addApprovedOrigins, revokeOrigin } from '../shared/approved-origins';
import { getSnipModeActive, setSnipModeActive } from '../shared/snip-mode';

// ============================================================
// DOM References
// ============================================================

const connectionStatus = document.getElementById('sp-connection-status')!;
const pageTypeBadge = document.getElementById('sp-page-type')!;
const scrollDepthEl = document.getElementById('sp-scroll-depth')!;
const captureBtn = document.getElementById('sp-capture-btn')!;
const goalsList = document.getElementById('sp-goals-list')!;
const captureCount = document.getElementById('sp-capture-count')!;
const queueDepthEl = document.getElementById('sp-queue-depth')!;

// Target Panel DOM (Task #10)
const targetLockSource = document.getElementById('sp-target-lock-source')!;
const targetPanel = document.getElementById('sp-target-panel')!;
const targetKind = document.getElementById('sp-target-kind')!;
const targetName = document.getElementById('sp-target-name')!;
const targetHeadline = document.getElementById('sp-target-headline')!;
const targetMeta = document.getElementById('sp-target-meta')!;
const targetReason = document.getElementById('sp-target-reason')!;
const targetEmpty = document.getElementById('sp-target-empty')!;
const targetClearBtn = document.getElementById('sp-target-clear')!;

// Template DOM References (Phase 5)
const templatesList = document.getElementById('sp-templates-list')!;
const templatePreviewPanel = document.getElementById('sp-template-preview-panel')!;
const previewTemplateName = document.getElementById('sp-preview-template-name')!;
const closePreviewBtn = document.getElementById('sp-close-preview-btn')!;
const templateFullPreview = document.getElementById('sp-template-full-preview')!;
const spCopyTemplateBtn = document.getElementById('sp-copy-template-btn')!;
const spPersonalizeBtn = document.getElementById('sp-personalize-btn')!;
const spPersonalizeContactName = document.getElementById('sp-personalize-contact-name')!;
const spTemplateStatus = document.getElementById('sp-template-status')!;

// ============================================================
// Status Update
// ============================================================

function updateConnectionStatus(state: string): void {
  connectionStatus.className = `status-indicator ${state}`;
  connectionStatus.textContent =
    state === 'connected'
      ? 'Connected'
      : state === 'connecting'
        ? 'Connecting...'
        : state === 'error'
          ? 'Error'
          : 'Disconnected';
}

async function updateStatus(): Promise<void> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(
      { type: 'GET_STATUS' } satisfies ExtensionMessage,
      (response) => {
        if (response?.data) {
          updateConnectionStatus(response.data.connectionState ?? 'disconnected');
          captureCount.textContent = String(response.data.dailyCaptureCount ?? 0);
          queueDepthEl.textContent = String(response.data.queueDepth ?? 0);
        }
        resolve();
      }
    );
  });
}

async function updatePageInfo(): Promise<void> {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tabs[0]?.id) {
    try {
      chrome.tabs.sendMessage(
        tabs[0].id,
        { type: 'GET_STATUS' } satisfies ExtensionMessage,
        (response) => {
          void chrome.runtime.lastError;
          if (response?.payload) {
            const info = response.payload as {
              pageType?: string;
              scrollDepth?: number;
              url?: string;
            };
            pageTypeBadge.textContent = info.pageType ?? '--';
            scrollDepthEl.textContent = `${Math.round((info.scrollDepth ?? 0) * 100)}%`;
            (captureBtn as HTMLButtonElement).disabled = info.pageType === 'OTHER' || !info.pageType;
          } else {
            pageTypeBadge.textContent = '--';
            (captureBtn as HTMLButtonElement).disabled = true;
          }
        }
      );
    } catch {
      pageTypeBadge.textContent = '--';
      (captureBtn as HTMLButtonElement).disabled = true;
    }
  }
}

// ============================================================
// Goals and Tasks Rendering
// ============================================================

function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function renderGoals(goals: Goal[]): void {
  if (goals.length === 0) {
    goalsList.innerHTML = '<p class="placeholder-text">No active goals</p>';
    return;
  }

  goalsList.innerHTML = goals
    .map(
      (goal) => `
    <div class="goal-card">
      <div class="goal-title">${escapeHtml(goal.title)}</div>
      <div class="goal-progress">
        <div class="progress-bar">
          <div class="progress-fill" style="width: ${goal.progress * 100}%"></div>
        </div>
        <span class="progress-text">${goal.completedTasks}/${goal.totalTasks}</span>
      </div>
      <ul class="goal-tasks">
        ${goal.tasks
          .slice(0, 10)
          .map(
            (task) => `
          <li class="task-item" data-task-id="${task.id}">
            <span class="task-check ${task.status === 'completed' ? 'completed' : ''}"
                  data-task-id="${task.id}"></span>
            <span class="task-priority ${task.priority}"></span>
            <span class="task-title ${task.status === 'completed' ? 'completed' : ''} ${task.targetUrl ? 'task-navigable' : ''}"
                  ${task.targetUrl ? `data-url="${escapeHtml(task.targetUrl)}"` : ''}>${escapeHtml(task.title)}</span>
          </li>
        `
          )
          .join('')}
      </ul>
    </div>
  `
    )
    .join('');

  // Attach click handlers for task completion
  goalsList.querySelectorAll('.task-check').forEach((el) => {
    el.addEventListener('click', async () => {
      const taskId = (el as HTMLElement).dataset.taskId;
      if (!taskId) return;
      const isCompleted = el.classList.contains('completed');
      const newStatus = isCompleted ? 'pending' : 'completed';

      // Optimistic update
      el.classList.toggle('completed');
      const titleEl = el.parentElement?.querySelector('.task-title');
      if (titleEl) titleEl.classList.toggle('completed');

      // Send to service worker (which will call API)
      chrome.runtime.sendMessage({
        type: 'TASKS_UPDATE' as ExtensionMessage['type'],
        payload: { taskId, status: newStatus },
      });
    });
  });

  // Attach click-to-navigate handlers on task titles
  goalsList.querySelectorAll('.task-navigable').forEach((el) => {
    el.addEventListener('click', async (e) => {
      e.stopPropagation();
      const url = (el as HTMLElement).dataset.url;
      if (!url) return;

      // Side panel shares the window with the active tab -- navigate it directly
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      const activeTab = tabs[0];
      if (activeTab?.id) {
        chrome.tabs.update(activeTab.id, { url });
      }
    });
  });
}

// ============================================================
// Templates (Phase 5)
// ============================================================

let spLoadedTemplates: OutreachTemplate[] = [];
let spSelectedTemplate: OutreachTemplate | null = null;
let spCurrentContactName: string = 'contact';
let spCurrentContactUrl: string = '';

const SP_DEFAULT_TEMPLATES: OutreachTemplate[] = [
  {
    id: 'initial_outreach',
    name: 'Initial Outreach',
    category: 'initial_outreach',
    body: 'Hi {{first_name}},\n\nI came across your profile and was impressed by your work in {{industry}}. I would love to connect and learn more about what you are working on.\n\nBest regards',
    variables: ['first_name', 'industry'],
  },
  {
    id: 'follow_up',
    name: 'Follow-up',
    category: 'follow_up',
    body: 'Hi {{first_name}},\n\nI wanted to follow up on my previous message. I think there could be great synergy between our work in {{industry}}. Would you be open to a brief conversation?\n\nBest regards',
    variables: ['first_name', 'industry'],
  },
  {
    id: 'meeting_request',
    name: 'Meeting Request',
    category: 'meeting_request',
    body: 'Hi {{first_name}},\n\nI have been following your work at {{company}} and would love to schedule a brief call to discuss potential collaboration. Would you have 15 minutes this week?\n\nLooking forward to hearing from you.',
    variables: ['first_name', 'company'],
  },
];

function highlightVariables(body: string): string {
  return escapeHtml(body).replace(
    /\{\{(\w+)\}\}/g,
    '<span class="template-variable">{{$1}}</span>'
  );
}

function formatCategoryLabel(category: string): string {
  return category.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

async function loadSidepanelTemplates(): Promise<void> {
  try {
    const appUrl = await new Promise<string>((resolve) => {
      chrome.storage.local.get('appUrl', (result) => {
        resolve((result.appUrl as string) || 'http://localhost:3750');
      });
    });

    const response = await fetch(`${appUrl}/api/outreach/templates`, {
      headers: { 'Content-Type': 'application/json' },
    });

    if (response.ok) {
      const data = await response.json();
      if (data.templates && data.templates.length > 0) {
        spLoadedTemplates = data.templates;
        renderTemplateCards();
        return;
      }
    }
  } catch {
    // API unavailable, use defaults
  }

  spLoadedTemplates = SP_DEFAULT_TEMPLATES;
  renderTemplateCards();
}

function renderTemplateCards(): void {
  if (spLoadedTemplates.length === 0) {
    templatesList.innerHTML = '<p class="placeholder-text">No templates available</p>';
    return;
  }

  templatesList.innerHTML = spLoadedTemplates
    .map(
      (tpl) => `
    <div class="template-card" data-template-id="${escapeHtml(tpl.id)}">
      <div class="template-card-header">
        <span class="template-card-name">${escapeHtml(tpl.name)}</span>
        <span class="template-card-category">${formatCategoryLabel(tpl.category)}</span>
      </div>
      <div class="template-card-snippet">${escapeHtml(tpl.body.substring(0, 80))}${tpl.body.length > 80 ? '...' : ''}</div>
      <div class="template-card-actions">
        <button class="template-card-btn template-copy-btn" data-template-id="${escapeHtml(tpl.id)}">Copy</button>
        <button class="template-card-btn template-view-btn" data-template-id="${escapeHtml(tpl.id)}">Preview</button>
      </div>
    </div>
  `
    )
    .join('');

  // Attach copy handlers
  templatesList.querySelectorAll('.template-copy-btn').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const tplId = (btn as HTMLElement).dataset.templateId;
      const tpl = spLoadedTemplates.find((t) => t.id === tplId);
      if (!tpl) return;
      try {
        await navigator.clipboard.writeText(tpl.body);
        (btn as HTMLElement).textContent = 'Copied!';
        (btn as HTMLElement).classList.add('copied');
        setTimeout(() => {
          (btn as HTMLElement).textContent = 'Copy';
          (btn as HTMLElement).classList.remove('copied');
        }, 1500);
      } catch {
        // Clipboard write failed
      }
    });
  });

  // Attach preview/view handlers
  templatesList.querySelectorAll('.template-view-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const tplId = (btn as HTMLElement).dataset.templateId;
      if (tplId) openTemplatePreview(tplId);
    });
  });

  // Attach card click handler (also opens preview)
  templatesList.querySelectorAll('.template-card').forEach((card) => {
    card.addEventListener('click', () => {
      const tplId = (card as HTMLElement).dataset.templateId;
      if (tplId) openTemplatePreview(tplId);
    });
  });
}

function openTemplatePreview(templateId: string): void {
  const tpl = spLoadedTemplates.find((t) => t.id === templateId);
  if (!tpl) return;

  spSelectedTemplate = tpl;

  // Highlight active card
  templatesList.querySelectorAll('.template-card').forEach((card) => {
    card.classList.toggle('active', (card as HTMLElement).dataset.templateId === templateId);
  });

  previewTemplateName.textContent = tpl.name;
  templateFullPreview.innerHTML = highlightVariables(tpl.body);
  spPersonalizeContactName.textContent = spCurrentContactName;
  templatePreviewPanel.style.display = 'block';
}

function showSpTemplateStatus(message: string, type: 'success' | 'error' | 'info'): void {
  spTemplateStatus.textContent = message;
  spTemplateStatus.className = `template-status ${type}`;
  spTemplateStatus.style.display = 'block';
  setTimeout(() => { spTemplateStatus.style.display = 'none'; }, 3000);
}

closePreviewBtn.addEventListener('click', () => {
  templatePreviewPanel.style.display = 'none';
  spSelectedTemplate = null;
  templatesList.querySelectorAll('.template-card').forEach((card) => {
    card.classList.remove('active');
  });
});

spCopyTemplateBtn.addEventListener('click', async () => {
  if (!spSelectedTemplate) return;
  try {
    await navigator.clipboard.writeText(spSelectedTemplate.body);
    spCopyTemplateBtn.textContent = 'Copied!';
    setTimeout(() => { spCopyTemplateBtn.textContent = 'Copy'; }, 1500);
  } catch {
    showSpTemplateStatus('Failed to copy to clipboard', 'error');
  }
});

spPersonalizeBtn.addEventListener('click', async () => {
  if (!spSelectedTemplate) return;

  spPersonalizeBtn.setAttribute('disabled', 'true');
  spPersonalizeBtn.textContent = 'Personalizing...';

  try {
    const appUrl = await new Promise<string>((resolve) => {
      chrome.storage.local.get('appUrl', (result) => {
        resolve((result.appUrl as string) || 'http://localhost:3750');
      });
    });

    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const contactUrl = tabs[0]?.url || spCurrentContactUrl;

    const response = await fetch(`${appUrl}/api/claude/personalize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ templateId: spSelectedTemplate.id, contactUrl }),
    });

    if (!response.ok) throw new Error('Personalization failed');

    const data = await response.json();
    templateFullPreview.innerHTML = escapeHtml(data.personalizedText);
    showSpTemplateStatus('Template personalized', 'success');
  } catch {
    showSpTemplateStatus('Could not personalize. Check app connection.', 'error');
  } finally {
    spPersonalizeBtn.removeAttribute('disabled');
    spPersonalizeBtn.innerHTML = `Personalize for <span id="sp-personalize-contact-name">${escapeHtml(spCurrentContactName)}</span>`;
  }
});

// Update contact name when page info is available
async function updateContactContext(): Promise<void> {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tabs[0]?.url) return;

  const url = tabs[0].url;
  spCurrentContactUrl = url;

  // Extract name from LinkedIn URL slug
  const profileMatch = url.match(/linkedin\.com\/in\/([^/?]+)/);
  if (profileMatch) {
    const slug = profileMatch[1];
    const name = slug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
    spCurrentContactName = name;
    const nameEl = document.getElementById('sp-personalize-contact-name');
    if (nameEl) nameEl.textContent = name;
  }
}

// ============================================================
// Target Panel (Task #10)
// ============================================================

type LockSource = 'none' | 'page' | 'task' | 'pinned';

interface ContactTarget {
  kind: 'person';
  id: string;
  name: string;
  headline: string;
  tier: string;
  goldScore: number;
  tasksPending: number;
  lastCapturedAt: string | null;
  lastEnrichedAt: string | null;
  url: string;
}

interface CompanyTarget {
  kind: 'company';
  id: string;
  name: string;
  headline: string; // industry + sizeRange + headquarters, formatted
  contactCount: number;
  tasksPending: number;
  lastCapturedAt: string | null;
  url: string;
}

type Target = ContactTarget | CompanyTarget;

interface LockedTarget {
  target: Target;
  source: Exclude<LockSource, 'none'>;
  reason?: string;
}

// Cache of the currently rendered target to avoid redundant fetches
let lastRenderedLock: string = '';

async function getAppUrlBase(): Promise<string> {
  return new Promise((resolve) => {
    chrome.storage.local.get('appUrl', (result) => {
      resolve((result.appUrl as string) || 'http://localhost:3750');
    });
  });
}

async function fetchWithAuth(path: string): Promise<Response | null> {
  try {
    const appUrl = await getAppUrlBase();
    const { extensionToken } = await new Promise<{ extensionToken?: string }>((r) =>
      chrome.storage.local.get('extensionToken', (v) => r(v)),
    );
    const res = await fetch(`${appUrl}${path}`, {
      headers: extensionToken
        ? { Authorization: `Bearer ${extensionToken}` }
        : {},
    });
    return res;
  } catch {
    return null;
  }
}

async function lookupContact(url: string): Promise<ContactTarget | null> {
  const stripped = url.replace(/^https?:\/\//, '');
  const res = await fetchWithAuth(`/api/extension/contact/${stripped}`);
  if (!res || !res.ok) return null;
  const json = await res.json();
  if (!json.found || !json.contact) return null;
  return {
    kind: 'person',
    id: json.contact.id,
    name: json.contact.name,
    headline: json.contact.headline ?? '',
    tier: json.contact.tier ?? 'unscored',
    goldScore: json.contact.goldScore ?? 0,
    tasksPending: json.contact.tasksPending ?? 0,
    lastCapturedAt: json.contact.lastCapturedAt ?? null,
    lastEnrichedAt: json.contact.lastEnrichedAt ?? null,
    url,
  };
}

async function lookupCompany(url: string): Promise<CompanyTarget | null> {
  const stripped = url.replace(/^https?:\/\//, '');
  const res = await fetchWithAuth(`/api/extension/company/${stripped}`);
  if (!res || !res.ok) return null;
  const json = await res.json();
  if (!json.found || !json.company) return null;
  const c = json.company;
  const headlineParts = [c.industry, c.sizeRange, c.headquarters].filter(Boolean);
  return {
    kind: 'company',
    id: c.id,
    name: c.name,
    headline: headlineParts.join(' · '),
    contactCount: c.contactCount ?? 0,
    tasksPending: c.tasksPending ?? 0,
    lastCapturedAt: c.lastCapturedAt ?? null,
    url,
  };
}

async function resolveCurrentTargetFromTasks(
  currentUrl: string,
): Promise<LockedTarget | null> {
  const tasks = await new Promise<ExtensionTask[]>((r) =>
    chrome.storage.local.get('pendingTasks', (v) =>
      r((v.pendingTasks as ExtensionTask[]) || []),
    ),
  );
  // Prefer an in_progress task whose targetUrl matches the current URL and has a contactId
  const normalized = currentUrl.replace(/\?.*$/, '').replace(/\/$/, '');
  const matched = tasks.find((t) => {
    if (!t.contactId || t.status === 'completed') return false;
    if (!t.targetUrl) return false;
    const tu = t.targetUrl.replace(/\?.*$/, '').replace(/\/$/, '');
    return tu === normalized || normalized.startsWith(tu);
  });
  if (!matched || !matched.targetUrl) return null;
  const contact = await lookupContact(matched.targetUrl);
  if (!contact) return null;
  return {
    target: contact,
    source: 'task',
    reason: `Locked from task: ${matched.title}`,
  };
}

function formatRelativeTime(iso: string | null): string {
  if (!iso) return 'never';
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diffMs = now - then;
  if (diffMs < 0) return 'future';
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

function renderTarget(lock: LockedTarget | null): void {
  if (!lock) {
    targetPanel.style.display = 'none';
    targetEmpty.style.display = '';
    targetLockSource.setAttribute('data-source', 'none');
    targetLockSource.textContent = 'No target';
    return;
  }

  targetPanel.style.display = '';
  targetEmpty.style.display = 'none';
  targetLockSource.setAttribute('data-source', lock.source);
  targetLockSource.textContent =
    lock.source === 'page'
      ? 'Page lock'
      : lock.source === 'task'
        ? 'Task lock'
        : lock.source === 'pinned'
          ? 'Pinned'
          : 'No target';

  const t = lock.target;
  targetKind.textContent = t.kind;
  targetKind.setAttribute('data-kind', t.kind);
  targetName.textContent = t.name;
  targetHeadline.textContent = t.headline;

  // Meta grid
  const rows: Array<[string, string, string?]> = [];
  if (t.kind === 'person') {
    rows.push(['Tier', t.tier.toUpperCase(), `tier-${t.tier}`]);
    rows.push(['Score', t.goldScore ? t.goldScore.toFixed(1) : '—']);
    rows.push(['Pending tasks', String(t.tasksPending)]);
    rows.push(['Last captured', formatRelativeTime(t.lastCapturedAt)]);
  } else {
    rows.push(['Contacts here', String(t.contactCount)]);
    rows.push(['Pending tasks', String(t.tasksPending)]);
    rows.push(['Last captured', formatRelativeTime(t.lastCapturedAt)]);
  }
  targetMeta.innerHTML = rows
    .map(
      ([label, value, cls]) => `
        <div class="meta-row">
          <span class="meta-label">${label}</span>
          <span class="meta-value${cls ? ' ' + cls : ''}">${escapeHtml(value)}</span>
        </div>`,
    )
    .join('');

  if (lock.reason) {
    targetReason.textContent = lock.reason;
    targetReason.style.display = '';
  } else {
    targetReason.style.display = 'none';
  }

  // Show clear button only when lock is task (user can "break" the task lock
  // by navigating to a different page — page-locks auto-clear on nav).
  targetClearBtn.style.display = lock.source === 'task' ? '' : 'none';
}

let taskLockCleared = false;

async function updateTargetPanel(): Promise<void> {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = tabs[0];
  if (!tab?.url) {
    renderTarget(null);
    return;
  }

  const url = tab.url;
  const pageType = detectPageTypeFromUrl(url);

  let lock: LockedTarget | null = null;

  // 1. Task-lock takes priority unless user cleared it for this URL
  if (!taskLockCleared) {
    lock = await resolveCurrentTargetFromTasks(url);
  }

  // 2. Page auto-lock on PROFILE / COMPANY when no task-lock
  if (!lock) {
    if (pageType === 'PROFILE') {
      const contact = await lookupContact(url);
      if (contact) lock = { target: contact, source: 'page' };
    } else if (pageType === 'COMPANY') {
      const company = await lookupCompany(url);
      if (company) lock = { target: company, source: 'page' };
    }
  }

  const cacheKey = lock
    ? `${lock.source}:${lock.target.kind}:${lock.target.id}`
    : 'none';
  if (cacheKey === lastRenderedLock) return;
  lastRenderedLock = cacheKey;

  renderTarget(lock);

  // Feed downstream template personalization
  if (lock && lock.target.kind === 'person') {
    spCurrentContactName = lock.target.name;
    spCurrentContactUrl = lock.target.url;
    const nameEl = document.getElementById('sp-personalize-contact-name');
    if (nameEl) nameEl.textContent = lock.target.name;
  }

  // Feed the visibility panels with the currently-locked target.
  visibilityCurrentTarget = lock
    ? {
        kind: lock.target.kind === 'person' ? 'contact' : 'company',
        id: lock.target.id,
      }
    : null;
  void refreshCaptureDiffPanel();
}

function detectPageTypeFromUrl(url: string): string {
  if (/linkedin\.com\/in\/[^/?]+/.test(url)) return 'PROFILE';
  if (/linkedin\.com\/company\/[^/?]+/.test(url)) return 'COMPANY';
  if (/linkedin\.com\/search\/results\/people/.test(url)) return 'SEARCH_PEOPLE';
  if (/linkedin\.com\/search\/results\/content/.test(url)) return 'SEARCH_CONTENT';
  if (/linkedin\.com\/mynetwork/.test(url)) return 'CONNECTIONS';
  if (/linkedin\.com\/messaging/.test(url)) return 'MESSAGES';
  if (/linkedin\.com\/feed/.test(url)) return 'FEED';
  return 'OTHER';
}

targetClearBtn.addEventListener('click', () => {
  taskLockCleared = true;
  lastRenderedLock = '';
  void updateTargetPanel();
});

// Reset task-lock clear when the tab URL changes (new page, fresh decision)
chrome.tabs.onActivated.addListener(() => {
  taskLockCleared = false;
  lastRenderedLock = '';
});
chrome.tabs.onUpdated.addListener((_id, info) => {
  if (info.status === 'complete' || info.url) {
    taskLockCleared = false;
    lastRenderedLock = '';
  }
});

// ============================================================
// Capture Button
// ============================================================

captureBtn.addEventListener('click', () => {
  captureBtn.setAttribute('disabled', 'true');
  captureBtn.textContent = 'Capturing...';

  chrome.runtime.sendMessage(
    { type: 'CAPTURE_REQUEST' } satisfies ExtensionMessage,
    (_response) => {
      captureBtn.textContent = 'Captured!';
      setTimeout(() => {
        captureBtn.removeAttribute('disabled');
        captureBtn.textContent = 'Capture This Page';
        updateStatus();
      }, 1500);
    }
  );
});

// ============================================================
// Storage Change Listener
// ============================================================

chrome.storage.onChanged.addListener((changes) => {
  if (changes.connectionState) {
    updateConnectionStatus(changes.connectionState.newValue);
  }
  // WS-3 Phase 6 §7 — approvedOrigins is rewritten by the service worker on
  // chrome.permissions.onRemoved / onAdded (and by this panel's own
  // grant/revoke handlers). Re-render the grant CTA and the revoke list
  // (ADR-028 clause 6) so the UI reflects the new state without a reload —
  // including a revoke made through chrome://extensions instead of here.
  if (changes.approvedOrigins) {
    void updateAddHostButton();
    void renderApprovedOrigins();
  }
  if (changes.pendingTasks) {
    // Re-resolve target lock when the task list changes — a new task may now match the current URL
    lastRenderedLock = '';
    void updateTargetPanel();
    const tasks = (changes.pendingTasks.newValue || []) as ExtensionTask[];
    // Group tasks into goals
    const goalsMap = new Map<string, Goal>();
    for (const task of tasks) {
      const goalId = task.goalId || 'ungrouped';
      if (!goalsMap.has(goalId)) {
        goalsMap.set(goalId, {
          id: goalId,
          title: task.goalTitle || 'Tasks',
          progress: 0,
          totalTasks: 0,
          completedTasks: 0,
          tasks: [],
        });
      }
      const goal = goalsMap.get(goalId)!;
      goal.tasks.push(task);
      goal.totalTasks++;
      if (task.status === 'completed') goal.completedTasks++;
    }
    for (const goal of goalsMap.values()) {
      goal.progress =
        goal.totalTasks > 0 ? goal.completedTasks / goal.totalTasks : 0;
    }
    renderGoals(Array.from(goalsMap.values()));
  }
  if (changes.dailyCaptureCount) {
    captureCount.textContent = String(changes.dailyCaptureCount.newValue ?? 0);
  }
});

// ============================================================
// Tab Change Listener
// ============================================================

chrome.tabs.onActivated.addListener(async () => {
  await updatePageInfo();
  await updateTargetPanel();
});

chrome.tabs.onUpdated.addListener(async (_tabId, changeInfo) => {
  if (changeInfo.status === 'complete') {
    await updatePageInfo();
    await updateTargetPanel();
  }
});

// ============================================================
// Initialize
// ============================================================

async function init(): Promise<void> {
  await updateStatus();
  await updatePageInfo();
  // ADR-028 clauses 4 & 6 — restore this session's snip-mode toggle state
  // and render the current approved-origins/revoke list.
  await loadSnipModeState();
  await renderApprovedOrigins();

  // Load tasks from storage
  chrome.storage.local.get('pendingTasks', (result) => {
    const tasks = (result.pendingTasks || []) as ExtensionTask[];
    const goalsMap = new Map<string, Goal>();
    for (const task of tasks) {
      const goalId = task.goalId || 'ungrouped';
      if (!goalsMap.has(goalId)) {
        goalsMap.set(goalId, {
          id: goalId,
          title: task.goalTitle || 'Tasks',
          progress: 0,
          totalTasks: 0,
          completedTasks: 0,
          tasks: [],
        });
      }
      const goal = goalsMap.get(goalId)!;
      goal.tasks.push(task);
      goal.totalTasks++;
      if (task.status === 'completed') goal.completedTasks++;
    }
    for (const goal of goalsMap.values()) {
      goal.progress =
        goal.totalTasks > 0 ? goal.completedTasks / goal.totalTasks : 0;
    }
    renderGoals(Array.from(goalsMap.values()));
  });

  // Load templates (Phase 5)
  await loadSidepanelTemplates();
  await updateContactContext();
  await updateTargetPanel();

  // Check capture rate (Phase 6)
  const dailyCount = await getDailyCaptureCount();
  const limit = await getCaptureLimit();
  if (dailyCount >= limit) {
    (captureBtn as HTMLButtonElement).disabled = true;
    captureBtn.textContent = `Limit reached (${limit})`;
  } else if (dailyCount >= limit * 0.8) {
    captureBtn.textContent = `Capture (${Math.max(0, limit - dailyCount)} left)`;
  }

  // Refresh periodically
  setInterval(async () => {
    await updateStatus();
    await updatePageInfo();
    await updateContactContext();
    await updateTargetPanel();
  }, 15000);
}

init().catch((err) =>
  logger.error('Side panel init failed:', (err as Error).message)
);

// ============================================================
// Snippet Widget (Phase 1 Track C — WS-3)
// ============================================================
//
// Thin widget living inside the side panel. User selects text on the page,
// clicks "Capture selection", the widget expands a card with tag chips +
// a free-text note + a mentions row. Save posts to /api/extension/snippet.
// Per ADR-028 the content script only runs on origins the user has granted,
// so the "Capture" action first asks the content script for the current
// selection via chrome.tabs.sendMessage. If no content script responds (not
// injected / not granted), we surface the Add-host button.

interface SidebarTagRow {
  slug: string;
  label: string;
  parentSlug: string | null;
  isSeeded: boolean;
}

interface SidebarSnippetTextPayload {
  kind: 'text';
  selection: SnippetSelectionResponse;
  selectedTags: Set<string>;
  selectedMentions: Set<string>;
  mentionCandidates: string[];
  note: string;
}

interface SidebarSnippetLinkPayload {
  kind: 'link';
  href: string;
  linkText: string | null;
  sourceUrl: string;
  pageTitle: string;
  pageType: string | null;
  selectedTags: Set<string>;
  note: string;
}

interface SidebarSnippetImagePayload {
  kind: 'image';
  /** base64-encoded bytes (no `data:` prefix). */
  imageBytes: string;
  mimeType: string;
  width: number | null;
  height: number | null;
  approximateBytes: number;
  sourceUrl: string;
  pageUrl: string;
  pageTitle: string;
  pageType: string | null;
  selectedTags: Set<string>;
  note: string;
}

type SidebarSnippetPayload =
  | SidebarSnippetTextPayload
  | SidebarSnippetImagePayload
  | SidebarSnippetLinkPayload;

const snippetSection = document.getElementById('sp-snippet-section');
const snippetStatus = document.getElementById('sp-snippet-status');
const snippetCaptureBtn = document.getElementById('sp-snippet-capture-btn');
const snippetCard = document.getElementById('sp-snippet-card');
const snippetPreview = document.getElementById('sp-snippet-preview');
const snippetTagsContainer = document.getElementById('sp-snippet-tags');
const snippetMentionsContainer = document.getElementById('sp-snippet-mentions');
const snippetMentionsField = document.getElementById('sp-snippet-mentions-field');
const snippetNoteEl = document.getElementById('sp-snippet-note') as HTMLTextAreaElement | null;
const snippetSaveBtn = document.getElementById('sp-snippet-save-btn');
const snippetCancelBtn = document.getElementById('sp-snippet-cancel-btn');
const snippetErrorEl = document.getElementById('sp-snippet-error');
const addHostBtn = document.getElementById('sp-add-host-btn');
// ADR-028 clause 4 — Snip mode opt-in toggle + the widget body it gates
const snipModeToggleBtn = document.getElementById('sp-snip-mode-toggle');
const snipModeHint = document.getElementById('sp-snip-mode-hint');
const snippetWidgetBody = document.getElementById('sp-snippet-widget-body');
// ADR-028 clause 6 — approved-origins revoke UI
const approvedOriginsList = document.getElementById('sp-approved-origins-list');
const approvedOriginsEmpty = document.getElementById('sp-approved-origins-empty');
// Phase 1.5 — image tab DOM
const snippetTabText = document.getElementById('sp-snippet-tab-text');
const snippetTabImage = document.getElementById('sp-snippet-tab-image');
const snippetTextPane = document.getElementById('sp-snippet-text-pane');
const snippetImagePane = document.getElementById('sp-snippet-image-pane');
const snippetImageStatus = document.getElementById('sp-snippet-image-status');
const snippetDropzone = document.getElementById('sp-snippet-image-dropzone');
const snippetImageUrlInput = document.getElementById(
  'sp-snippet-image-url-input'
) as HTMLInputElement | null;
const snippetImageFetchBtn = document.getElementById('sp-snippet-image-fetch-btn');
const snippetImagePreviewWrap = document.getElementById('sp-snippet-image-preview-wrap');
const snippetImagePreview = document.getElementById(
  'sp-snippet-image-preview'
) as HTMLImageElement | null;
const snippetImageMeta = document.getElementById('sp-snippet-image-meta');
// Phase 1.5 — link tab DOM (WS-3 closure)
const snippetTabLink = document.getElementById('sp-snippet-tab-link');
const snippetLinkPane = document.getElementById('sp-snippet-link-pane');
const snippetLinkStatus = document.getElementById('sp-snippet-link-status');
const snippetLinkHrefInput = document.getElementById(
  'sp-snippet-link-href-input'
) as HTMLInputElement | null;
const snippetLinkTextInput = document.getElementById(
  'sp-snippet-link-text-input'
) as HTMLInputElement | null;
const snippetLinkPrepBtn = document.getElementById('sp-snippet-link-prep-btn');
// WS-3 Phase 6 §9/§10 additions
const snippetPiiBanner = document.getElementById('sp-snippet-pii-banner');
const snippetQueueDepthEl = document.getElementById('sp-snippet-queue-depth');

let availableTags: SidebarTagRow[] = [];
let currentSnippet: SidebarSnippetPayload | null = null;
let snippetEnabled = false;
// ADR-028 clause 4 — Snip mode is off by default every session; capturing is
// a deliberate act, not an ambient one. Backed by chrome.storage.session so
// it survives a side-panel close/reopen within the browser session but is
// gone on browser restart (matching the ADR's "opt-in per session" wording).
let snipModeActive = false;

function extractPersonBigrams(text: string): string[] {
  if (!text) return [];
  const re = /\b([A-Z][a-z]+)\s+([A-Z][a-z]+)\b/g;
  const seen = new Set<string>();
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const cand = `${m[1]} ${m[2]}`;
    if (cand.length < 5) continue;
    if (seen.has(cand)) continue;
    seen.add(cand);
    out.push(cand);
  }
  return out;
}

async function loadSnippetTags(): Promise<void> {
  try {
    const appUrl = await getAppUrlBase();
    const { extensionToken } = await new Promise<{ extensionToken?: string }>((r) =>
      chrome.storage.local.get('extensionToken', (v) => r(v)),
    );
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (extensionToken) headers['X-Extension-Token'] = extensionToken;
    const res = await fetch(`${appUrl}/api/extension/tags`, { headers });
    if (!res.ok) {
      snippetEnabled = false;
      if (snippetSection) snippetSection.style.display = 'none';
      return;
    }
    const json = (await res.json()) as { tags: SidebarTagRow[] };
    availableTags = json.tags ?? [];
    snippetEnabled = true;
    if (snippetSection) snippetSection.style.display = '';
  } catch {
    snippetEnabled = false;
    if (snippetSection) snippetSection.style.display = 'none';
  }
}

/**
 * Phase 1.5 — when the source URL matches a well-known provenance pattern,
 * default to a matching tag in the taxonomy. Purely client-side (per the
 * scope note in `03-snippet-editor.md` §16): the tag taxonomy already ships
 * `provenance/wayback` + `filing/sec-*` slugs so we just need to pre-flag
 * whichever applies.
 *
 * Rules (non-overlapping, first match wins on the filing side):
 *   - `web.archive.org`           → `provenance/wayback`
 *   - `/sec.gov/.../10-K` URL     → `filing/sec-10k`
 *   - `/sec.gov/.../10-Q`         → `filing/sec-10q`
 *   - `/sec.gov/.../8-K`          → `filing/sec-8k`
 *   - `/sec.gov/.../13F`          → `filing/sec-13f`
 *   - `/sec.gov/.../DEF 14A`      → `filing/sec-proxy`
 *   - Any other `sec.gov` URL     → generic fallback (no filing-specific slug)
 *
 * Returns the set of slugs that should be pre-selected. Only slugs that exist
 * in the tenant's taxonomy (live `availableTags`) are returned — this avoids
 * adding a chip the user can't see.
 */
export function suggestTagSlugsForUrl(
  url: string,
  known: Iterable<string>
): string[] {
  const hits = new Set<string>();
  const has = new Set<string>(known);
  if (!url) return [];
  let host = '';
  let path = '';
  try {
    const u = new URL(url);
    host = u.hostname.toLowerCase();
    path = u.pathname + u.search;
  } catch {
    return [];
  }
  if (/(^|\.)web\.archive\.org$/.test(host) && has.has('provenance/wayback')) {
    hits.add('provenance/wayback');
  }
  if (/(^|\.)sec\.gov$/.test(host)) {
    // EDGAR filing-type heuristics. The accession-number pattern doesn't
    // carry the form type, but the `type=` query or a substring like `10-K`
    // in the path is stable for most /cgi-bin/browse-edgar and /Archives/
    // links.
    const upper = `${path} ${url}`.toUpperCase();
    if (/\b10-K\b/.test(upper) && has.has('filing/sec-10k')) {
      hits.add('filing/sec-10k');
    } else if (/\b10-Q\b/.test(upper) && has.has('filing/sec-10q')) {
      hits.add('filing/sec-10q');
    } else if (/\b8-K\b/.test(upper) && has.has('filing/sec-8k')) {
      hits.add('filing/sec-8k');
    } else if (/\b13F\b/.test(upper) && has.has('filing/sec-13f')) {
      hits.add('filing/sec-13f');
    } else if (/DEF\s*14A/.test(upper) && has.has('filing/sec-proxy')) {
      hits.add('filing/sec-proxy');
    }
    // Always add the generic `public-record` style fallback if the taxonomy
    // carries it. (Current seed doesn't, so this is a forward-compat guard.)
    if (has.has('filing/court')) {
      // Court filings aren't usually on sec.gov — keep this only if the URL
      // *also* matches a court path. Guard against false positives.
      if (/court|case|docket/i.test(path)) hits.add('filing/court');
    }
  }
  return Array.from(hits);
}

function renderTagChips(container: HTMLElement, selected: Set<string>): void {
  container.innerHTML = '';
  for (const tag of availableTags) {
    const chip = document.createElement('span');
    chip.className = 'snippet-tag-chip';
    chip.textContent = tag.label;
    chip.dataset.slug = tag.slug;
    if (selected.has(tag.slug)) chip.classList.add('selected');
    chip.addEventListener('click', () => {
      if (selected.has(tag.slug)) {
        selected.delete(tag.slug);
        chip.classList.remove('selected');
      } else {
        selected.add(tag.slug);
        chip.classList.add('selected');
      }
    });
    container.appendChild(chip);
  }
}

function renderMentionChips(container: HTMLElement, candidates: string[], selected: Set<string>): void {
  container.innerHTML = '';
  if (candidates.length === 0) {
    container.textContent = 'No proper nouns detected.';
    return;
  }
  for (const cand of candidates) {
    const chip = document.createElement('span');
    chip.className = 'snippet-mention-chip';
    chip.textContent = cand;
    chip.dataset.mention = cand;
    if (selected.has(cand)) chip.classList.add('selected');

    // State machine: idle → "searching…" → (matched | unmatched). When
    // unmatched a second click on the same chip fires "Create new contact"
    // through the Q9 endpoint. Shift-click always creates a new contact
    // regardless of whether an existing one matched, for the case where the
    // user knows the mention is a different person than the dedup hit.
    chip.title = 'Click to link to an existing contact; shift-click to create new.';
    let attempted = false;
    chip.addEventListener('click', async (ev) => {
      const shift = (ev as MouseEvent).shiftKey === true;
      if (shift || attempted) {
        // Create-new path (Q9 A+C).
        const excerpt =
          currentSnippet && currentSnippet.kind === 'text'
            ? currentSnippet.selection.text
            : '';
        const sourceUrl =
          currentSnippet && currentSnippet.kind === 'text'
            ? currentSnippet.selection.sourceUrl
            : '';
        const created = await createContactFromMention(cand, sourceUrl, excerpt);
        if (!created?.contactId) {
          chip.title = 'Create-new failed; check the app logs.';
          chip.style.opacity = '0.5';
          return;
        }
        chip.title = `Created contact ${created.fullName}${created.reused ? ' (existing)' : ''}`;
        selected.add(created.contactId);
        chip.classList.add('selected');
        chip.style.opacity = '1';
        return;
      }
      attempted = true;
      const match = await searchContactByName(cand);
      if (!match) {
        chip.title = 'No existing contact matches. Click again to create, or shift-click to force-create.';
        chip.style.opacity = '0.5';
        return;
      }
      chip.title = `Linked to ${match.name}`;
      if (selected.has(match.id)) {
        selected.delete(match.id);
        chip.classList.remove('selected');
      } else {
        selected.add(match.id);
        chip.classList.add('selected');
      }
    });
    container.appendChild(chip);
  }
}

async function searchContactByName(
  name: string
): Promise<{ id: string; name: string } | null> {
  // Phase 1.5 closure — hits /api/extension/contact/search and returns the
  // top-confidence match (or null if nothing clears the threshold). When the
  // user wants to create a brand-new contact instead they use
  // `createContactFromMention` below. Separating the two keeps the existing
  // chip's "one click = link" interaction working.
  try {
    const appUrl = await getAppUrlBase();
    const { extensionToken } = await new Promise<{ extensionToken?: string }>((r) =>
      chrome.storage.local.get('extensionToken', (v) => r(v)),
    );
    const res = await fetch(
      `${appUrl}/api/extension/contact/search?q=${encodeURIComponent(name)}&limit=3`,
      {
        headers: extensionToken
          ? { 'X-Extension-Token': extensionToken }
          : undefined,
      }
    );
    if (!res.ok) return null;
    const json = (await res.json()) as {
      matches?: Array<{ id: string; fullName: string; confidence: number }>;
    };
    const top = json.matches?.[0];
    if (!top) return null;
    // Only auto-link on >=0.85 confidence. Weaker hits fall back to the
    // "Create new" flow so we don't silently misattribute.
    if (top.confidence < 0.85) return null;
    return { id: top.id, name: top.fullName };
  } catch {
    return null;
  }
}

interface CreateFromMentionResponse {
  success: boolean;
  contactId: string;
  fullName: string;
  reused: boolean;
  enrichment?: { invoked: boolean; skipReason?: string };
}

/**
 * POST /api/extension/contact/create-from-mention. Posts the name + a 200-char
 * context excerpt so downstream reviewers can see why the contact exists. The
 * caller passes the snippet's source URL + the full selection text so the
 * server can derive the excerpt without re-computing the mention offset.
 */
async function createContactFromMention(
  name: string,
  snippetSourceUrl: string,
  excerpt: string,
  linkedinUrl?: string
): Promise<CreateFromMentionResponse | null> {
  try {
    const appUrl = await getAppUrlBase();
    const { extensionToken } = await new Promise<{ extensionToken?: string }>((r) =>
      chrome.storage.local.get('extensionToken', (v) => r(v)),
    );
    const res = await fetch(`${appUrl}/api/extension/contact/create-from-mention`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(extensionToken ? { 'X-Extension-Token': extensionToken } : {}),
      },
      body: JSON.stringify({
        name,
        linkedinUrl,
        snippetSourceUrl,
        context: excerpt.slice(0, 200),
      }),
    });
    if (!res.ok) return null;
    return (await res.json()) as CreateFromMentionResponse;
  } catch {
    return null;
  }
}

async function requestCurrentSelection(): Promise<SnippetSelectionResponse | null> {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tabId = tabs[0]?.id;
  if (!tabId) return null;
  return new Promise((resolve) => {
    try {
      chrome.tabs.sendMessage(
        tabId,
        { type: 'GET_SNIPPET_SELECTION' } satisfies ExtensionMessage,
        (response: SnippetSelectionResponse | undefined) => {
          void chrome.runtime.lastError; // swallow "no receiving end" errors
          resolve(response ?? null);
        }
      );
    } catch {
      resolve(null);
    }
  });
}

async function ensureOriginPermission(url: string): Promise<boolean> {
  try {
    const origin = new URL(url).origin + '/*';
    const has = await chrome.permissions.contains({ origins: [origin] });
    return has;
  } catch {
    return false;
  }
}

async function updateAddHostButton(): Promise<void> {
  if (!addHostBtn) return;
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const url = tabs[0]?.url;
  if (!url || !/^https?:/.test(url)) {
    addHostBtn.style.display = 'none';
    return;
  }
  const granted = await ensureOriginPermission(url);
  addHostBtn.style.display = granted ? 'none' : '';
}

async function injectSnippetContentScript(tabId: number): Promise<void> {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['dist/content-snippet.js'],
    });
  } catch (err) {
    logger.warn('Snippet content-script inject failed:', (err as Error).message);
  }
}

if (addHostBtn) {
  addHostBtn.addEventListener('click', async () => {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const tab = tabs[0];
    if (!tab?.url || !tab.id) return;
    try {
      const origin = new URL(tab.url).origin + '/*';
      const granted = await chrome.permissions.request({ origins: [origin] });
      if (granted) {
        // Mirror the grant in local storage for UI state (source of truth
        // remains chrome.permissions per ADR-028). Route through
        // approved-origins.ts rather than writing the storage key directly
        // so canonicalization/dedup stays single-sourced with the revoke
        // path and the service worker's onAdded/onRemoved listeners.
        await addApprovedOrigins([origin]);
        // Re-inject so snipping works immediately without a reload.
        await injectSnippetContentScript(tab.id);
        await updateAddHostButton();
        await renderApprovedOrigins();
      }
    } catch (err) {
      logger.warn('Add-host request failed:', (err as Error).message);
    }
  });
}

// ============================================================
// Approved-origins revoke UI (ADR-028 clause 6)
// ============================================================
//
// Lists every origin in the `approvedOrigins` mirror with a "Revoke" button.
// The actual revoke — chrome.permissions.remove followed by the mirror
// update — lives in shared/approved-origins.ts's `revokeOrigin` so it's
// covered by that module's fake-chrome test suite and stays single-sourced
// with the grant path and the service worker's onAdded/onRemoved listeners.

async function getApprovedOriginsForDisplay(): Promise<string[]> {
  const stored = await new Promise<{ approvedOrigins?: string[] }>((r) =>
    chrome.storage.local.get('approvedOrigins', (v) => r(v)),
  );
  return [...(stored.approvedOrigins ?? [])].sort();
}

async function handleRevokeClick(origin: string): Promise<void> {
  await revokeOrigin(origin);
  await renderApprovedOrigins();
  await updateAddHostButton();
}

async function renderApprovedOrigins(): Promise<void> {
  if (!approvedOriginsList || !approvedOriginsEmpty) return;
  const origins = await getApprovedOriginsForDisplay();
  if (origins.length === 0) {
    approvedOriginsList.style.display = 'none';
    approvedOriginsList.innerHTML = '';
    approvedOriginsEmpty.style.display = '';
    return;
  }
  approvedOriginsEmpty.style.display = 'none';
  approvedOriginsList.style.display = '';
  approvedOriginsList.innerHTML = '';
  for (const origin of origins) {
    const li = document.createElement('li');
    li.className = 'approved-origin-row';
    const label = document.createElement('span');
    label.className = 'approved-origin-label';
    label.textContent = origin.replace(/\/\*$/, '');
    const revokeBtn = document.createElement('button');
    revokeBtn.className = 'btn-icon';
    revokeBtn.title = `Revoke access to ${origin}`;
    revokeBtn.setAttribute('aria-label', `Revoke access to ${origin}`);
    revokeBtn.textContent = 'Revoke';
    revokeBtn.addEventListener('click', () => {
      void handleRevokeClick(origin);
    });
    li.appendChild(label);
    li.appendChild(revokeBtn);
    approvedOriginsList.appendChild(li);
  }
}

// ============================================================
// Snip mode opt-in (ADR-028 clause 4)
// ============================================================
//
// The permission grant (Add-host / optional_host_permissions) only controls
// *where* the content script is allowed to run. Snip mode is a separate,
// session-scoped decision about *whether the capture widget is active right
// now* — granting an origin must not, by itself, turn on capture. This
// mirrors the popup-toggle-or-hotkey shape the ADR specifies in §7.3.

function renderSnipModeToggle(): void {
  if (snipModeToggleBtn) {
    snipModeToggleBtn.textContent = snipModeActive ? 'Snip mode: On' : 'Snip mode: Off';
    snipModeToggleBtn.setAttribute('aria-pressed', String(snipModeActive));
    snipModeToggleBtn.classList.toggle('active', snipModeActive);
  }
  if (snipModeHint) snipModeHint.style.display = snipModeActive ? 'none' : '';
  if (snippetWidgetBody) snippetWidgetBody.style.display = snipModeActive ? '' : 'none';
}

async function setSnipMode(active: boolean): Promise<void> {
  snipModeActive = active;
  try {
    await setSnipModeActive(active);
  } catch (err) {
    // storage.session should always be available given the "storage"
    // permission, but don't let a failure here block the UI toggle.
    logger.warn('Failed to persist snip-mode state:', (err as Error).message);
  }
  if (!active) resetSnippetCard();
  renderSnipModeToggle();
}

async function loadSnipModeState(): Promise<void> {
  snipModeActive = await getSnipModeActive();
  renderSnipModeToggle();
}

if (snipModeToggleBtn) {
  snipModeToggleBtn.addEventListener('click', () => {
    void setSnipMode(!snipModeActive);
  });
}

// Ctrl+Shift+S / Cmd+Shift+S — registered as a chrome.commands entry in
// manifest.json and relayed here by the service worker, since commands only
// fire in the background context.
chrome.runtime.onMessage.addListener((message: ExtensionMessage) => {
  if (message.type === 'TOGGLE_SNIP_MODE') {
    void setSnipMode(!snipModeActive);
  }
});

function resetSnippetCard(): void {
  currentSnippet = null;
  if (snippetCard) snippetCard.style.display = 'none';
  if (snippetErrorEl) snippetErrorEl.style.display = 'none';
  if (snippetStatus) snippetStatus.textContent = 'Select text on the page, then click capture.';
  if (snippetImageStatus) {
    snippetImageStatus.textContent =
      'Drop an image here, paste one, or right-click an image on the page and choose "Copy image address" then paste the URL below.';
  }
  if (snippetImagePreviewWrap) snippetImagePreviewWrap.style.display = 'none';
  if (snippetImagePreview) snippetImagePreview.removeAttribute('src');
  if (snippetPreview) snippetPreview.style.display = '';
  if (snippetImageUrlInput) snippetImageUrlInput.value = '';
  if (snippetLinkStatus) {
    snippetLinkStatus.textContent =
      'Paste a URL and (optionally) the link text. We\'ll fetch it through the shared source-records pipeline.';
  }
  if (snippetLinkHrefInput) snippetLinkHrefInput.value = '';
  if (snippetLinkTextInput) snippetLinkTextInput.value = '';
  if (snippetPiiBanner) {
    snippetPiiBanner.style.display = 'none';
    snippetPiiBanner.textContent = '';
  }
}

/**
 * WS-3 Phase 6 §9 — show an advisory banner when the currently-selected text
 * contains PII. The banner lets the user cancel before save; the save handler
 * is what actually scrubs, so the banner is purely informational.
 */
function showPiiBannerForText(text: string): void {
  if (!snippetPiiBanner) return;
  const result = detectAndScrubPii(text ?? '');
  if (!result.hit) {
    snippetPiiBanner.style.display = 'none';
    snippetPiiBanner.textContent = '';
    return;
  }
  const summary = summarizePiiDetection(result) ?? '';
  snippetPiiBanner.innerHTML = '';
  const strong = document.createElement('strong');
  strong.textContent = 'PII detected';
  snippetPiiBanner.appendChild(strong);
  snippetPiiBanner.appendChild(
    document.createTextNode(
      ` — will be scrubbed on save (${summary}). Cancel if that's not what you want.`
    )
  );
  snippetPiiBanner.style.display = '';
}

/**
 * WS-3 Phase 6 §10 — render the offline-snippet-queue badge. Shown only when
 * there's at least one queued item; clicking does nothing (replay is driven
 * by the service worker).
 */
async function refreshSnippetQueueDepth(): Promise<void> {
  if (!snippetQueueDepthEl) return;
  try {
    const depth = await getSnippetQueueDepth();
    if (depth <= 0) {
      snippetQueueDepthEl.style.display = 'none';
      snippetQueueDepthEl.textContent = '';
      return;
    }
    snippetQueueDepthEl.style.display = '';
    snippetQueueDepthEl.textContent = `${depth} queued`;
    snippetQueueDepthEl.title = `${depth} snippet${depth === 1 ? '' : 's'} waiting for the server to come back.`;
  } catch {
    snippetQueueDepthEl.style.display = 'none';
  }
}

// Re-render queue depth whenever the queue key changes (the service worker
// rewrites it on replay / flush).
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes[SNIPPET_QUEUE_KEY]) void refreshSnippetQueueDepth();
});
// Seed the badge on sidebar mount.
void refreshSnippetQueueDepth();

// ----- Tab switching -----
function activateSnippetTab(kind: 'text' | 'image' | 'link'): void {
  if (snippetTabText) {
    snippetTabText.classList.toggle('active', kind === 'text');
    snippetTabText.setAttribute('aria-selected', kind === 'text' ? 'true' : 'false');
  }
  if (snippetTabImage) {
    snippetTabImage.classList.toggle('active', kind === 'image');
    snippetTabImage.setAttribute('aria-selected', kind === 'image' ? 'true' : 'false');
  }
  if (snippetTabLink) {
    snippetTabLink.classList.toggle('active', kind === 'link');
    snippetTabLink.setAttribute('aria-selected', kind === 'link' ? 'true' : 'false');
  }
  if (snippetTextPane) snippetTextPane.style.display = kind === 'text' ? '' : 'none';
  if (snippetImagePane) snippetImagePane.style.display = kind === 'image' ? '' : 'none';
  if (snippetLinkPane) snippetLinkPane.style.display = kind === 'link' ? '' : 'none';
  // Always hide any in-flight card when user flips tabs — avoids saving a
  // text payload while showing the image UI or vice versa.
  resetSnippetCard();
}

if (snippetTabText) snippetTabText.addEventListener('click', () => activateSnippetTab('text'));
if (snippetTabImage) snippetTabImage.addEventListener('click', () => activateSnippetTab('image'));
if (snippetTabLink) snippetTabLink.addEventListener('click', () => activateSnippetTab('link'));

if (snippetCaptureBtn) {
  snippetCaptureBtn.addEventListener('click', async () => {
    if (!snippetEnabled) return;
    // ADR-028 clause 4 — belt-and-braces guard alongside the hidden widget
    // body; a stale DOM reference shouldn't be able to fire a capture.
    if (!snipModeActive) return;
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const tab = tabs[0];
    if (!tab?.url || !tab.id) return;
    const granted = await ensureOriginPermission(tab.url);
    if (!granted) {
      if (snippetStatus) snippetStatus.textContent = 'Grant this site first, then try again.';
      await updateAddHostButton();
      return;
    }
    // Try to inject if not already present — chrome is idempotent for repeat
    // executeScript calls on the same frame.
    await injectSnippetContentScript(tab.id);
    const selection = await requestCurrentSelection();
    if (!selection || !selection.text) {
      if (snippetStatus) snippetStatus.textContent = 'No text selected on the page.';
      return;
    }
    const candidates = extractPersonBigrams(selection.text);
    const suggestedTags = suggestTagSlugsForUrl(
      selection.sourceUrl,
      availableTags.map((t) => t.slug)
    );
    currentSnippet = {
      kind: 'text',
      selection,
      selectedTags: new Set<string>(suggestedTags),
      selectedMentions: new Set<string>(),
      mentionCandidates: candidates,
      note: '',
    };
    if (snippetPreview) {
      snippetPreview.style.display = '';
      snippetPreview.textContent = selection.text.slice(0, 400);
    }
    // WS-3 Phase 6 §9 — surface PII advisory before the user clicks Save.
    showPiiBannerForText(selection.text);
    if (snippetImagePreviewWrap) snippetImagePreviewWrap.style.display = 'none';
    if (snippetMentionsField) snippetMentionsField.style.display = '';
    if (snippetTagsContainer) renderTagChips(snippetTagsContainer, currentSnippet.selectedTags);
    if (snippetMentionsContainer)
      renderMentionChips(snippetMentionsContainer, candidates, currentSnippet.selectedMentions);
    if (snippetNoteEl) snippetNoteEl.value = '';
    if (snippetCard) snippetCard.style.display = '';
    if (snippetStatus) snippetStatus.textContent = `Selected from ${selection.pageTitle || 'page'}`;
  });
}

if (snippetCancelBtn) {
  snippetCancelBtn.addEventListener('click', () => resetSnippetCard());
}

// ============================================================
// Phase 1.5 — image snippet capture (drag/drop, paste, right-click via URL)
// ============================================================

const ALLOWED_IMAGE_MIMES = new Set<string>([
  'image/png',
  'image/jpeg',
  'image/webp',
]);
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

function detectSnippetPageType(url: string): string | null {
  try {
    const host = new URL(url).hostname;
    if (/web\.archive\.org/.test(host)) return 'WAYBACK';
    if (/sec\.gov/.test(host)) return 'EDGAR';
    if (/linkedin\.com/.test(host)) return 'LINKEDIN';
  } catch {
    // ignore
  }
  return null;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const CHUNK = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    const slice = bytes.subarray(i, i + CHUNK);
    binary += String.fromCharCode.apply(null, Array.from(slice) as number[]);
  }
  return btoa(binary);
}

async function loadImageDimensions(
  dataUrl: string
): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => resolve(null);
    img.src = dataUrl;
  });
}

async function presentImagePayload(payload: {
  imageBytes: string;
  mimeType: string;
  width: number | null;
  height: number | null;
  approximateBytes: number;
  sourceUrl: string;
  pageUrl: string;
  pageTitle: string;
}): Promise<void> {
  const imageSuggested = suggestTagSlugsForUrl(
    payload.pageUrl || payload.sourceUrl,
    availableTags.map((t) => t.slug)
  );
  currentSnippet = {
    kind: 'image',
    imageBytes: payload.imageBytes,
    mimeType: payload.mimeType,
    width: payload.width,
    height: payload.height,
    approximateBytes: payload.approximateBytes,
    sourceUrl: payload.sourceUrl,
    pageUrl: payload.pageUrl,
    pageTitle: payload.pageTitle,
    pageType: detectSnippetPageType(payload.pageUrl || payload.sourceUrl),
    selectedTags: new Set<string>(imageSuggested),
    note: '',
  };

  if (snippetPreview) snippetPreview.style.display = 'none';
  if (snippetImagePreviewWrap) snippetImagePreviewWrap.style.display = '';
  if (snippetImagePreview) {
    snippetImagePreview.src = `data:${payload.mimeType};base64,${payload.imageBytes}`;
  }
  const kb = Math.round(payload.approximateBytes / 1024);
  const dim = payload.width && payload.height ? `${payload.width}×${payload.height} · ` : '';
  if (snippetImageMeta) {
    snippetImageMeta.textContent = `${dim}${kb} KB · ${payload.mimeType}${payload.sourceUrl ? ` · ${payload.sourceUrl}` : ''}`;
  }
  if (snippetMentionsField) snippetMentionsField.style.display = 'none';
  if (snippetTagsContainer && currentSnippet.kind === 'image') {
    renderTagChips(snippetTagsContainer, currentSnippet.selectedTags);
  }
  if (snippetNoteEl) snippetNoteEl.value = '';
  if (snippetCard) snippetCard.style.display = '';
  if (snippetImageStatus) snippetImageStatus.textContent = 'Image ready. Add tags and save.';
}

async function ingestImageFile(file: File): Promise<void> {
  // ADR-028 clause 4 — the widget body is hidden while snip mode is off, but
  // paste/drop are global listeners that don't check inline child styles, so
  // guard explicitly here rather than relying on visibility alone.
  if (!snipModeActive) return;
  if (!ALLOWED_IMAGE_MIMES.has(file.type)) {
    if (snippetImageStatus)
      snippetImageStatus.textContent = `Unsupported type "${file.type || 'unknown'}". Use PNG, JPEG, or WebP.`;
    return;
  }
  if (file.size > MAX_IMAGE_BYTES) {
    if (snippetImageStatus)
      snippetImageStatus.textContent = `Image exceeds 5 MB (got ${Math.round(file.size / 1024)} KB).`;
    return;
  }
  const buffer = await file.arrayBuffer();
  const base64 = arrayBufferToBase64(buffer);
  const dataUrl = `data:${file.type};base64,${base64}`;
  const dims = await loadImageDimensions(dataUrl);
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const pageUrl = tabs[0]?.url ?? '';
  const pageTitle = tabs[0]?.title ?? '';
  await presentImagePayload({
    imageBytes: base64,
    mimeType: file.type,
    width: dims?.width ?? null,
    height: dims?.height ?? null,
    approximateBytes: buffer.byteLength,
    sourceUrl: pageUrl,
    pageUrl,
    pageTitle,
  });
}

async function ingestImageFromUrl(imageUrl: string): Promise<void> {
  // ADR-028 clause 4 — see ingestImageFile.
  if (!snipModeActive) return;
  if (!/^https?:\/\//.test(imageUrl)) {
    if (snippetImageStatus)
      snippetImageStatus.textContent = 'URL must start with http:// or https://';
    return;
  }
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = tabs[0];
  if (!tab?.id || !tab.url) {
    if (snippetImageStatus) snippetImageStatus.textContent = 'No active tab.';
    return;
  }
  const granted = await ensureOriginPermission(tab.url);
  if (!granted) {
    if (snippetImageStatus)
      snippetImageStatus.textContent = 'Grant this site first, then try again.';
    await updateAddHostButton();
    return;
  }
  await injectSnippetContentScript(tab.id);
  if (snippetImageStatus) snippetImageStatus.textContent = 'Fetching image…';
  const response = await new Promise<SnippetImageFromUrlResponse | null>((resolve) => {
    try {
      chrome.tabs.sendMessage(
        tab.id!,
        {
          type: 'GET_SNIPPET_IMAGE_FROM_URL',
          payload: { imageUrl },
        } satisfies ExtensionMessage,
        (r: SnippetImageFromUrlResponse | undefined) => {
          void chrome.runtime.lastError;
          resolve(r ?? null);
        }
      );
    } catch {
      resolve(null);
    }
  });
  if (!response || !response.ok || !response.imageBytes || !response.mimeType) {
    if (snippetImageStatus)
      snippetImageStatus.textContent = `Fetch failed: ${response?.error ?? 'no response'}`;
    return;
  }
  const approximate = Math.floor((response.imageBytes.length * 3) / 4);
  await presentImagePayload({
    imageBytes: response.imageBytes,
    mimeType: response.mimeType,
    width: response.width ?? null,
    height: response.height ?? null,
    approximateBytes: approximate,
    sourceUrl: response.sourceUrl ?? imageUrl,
    pageUrl: response.pageUrl ?? tab.url ?? '',
    pageTitle: response.pageTitle ?? tab.title ?? '',
  });
}

// Drag-and-drop binding
if (snippetDropzone) {
  const dz = snippetDropzone;
  dz.addEventListener('dragover', (e) => {
    e.preventDefault();
    dz.classList.add('dragover');
  });
  dz.addEventListener('dragleave', () => dz.classList.remove('dragover'));
  dz.addEventListener('drop', async (e) => {
    e.preventDefault();
    dz.classList.remove('dragover');
    const dt = (e as DragEvent).dataTransfer;
    const file = dt?.files?.[0];
    if (file) {
      await ingestImageFile(file);
      return;
    }
    // Fall back to URL drop
    const url = dt?.getData('text/uri-list') || dt?.getData('text/plain');
    if (url) await ingestImageFromUrl(url.trim());
  });
}

// Clipboard paste binding — listen anywhere in the sidepanel when image
// tab is active; the paste handler filters to the image pane.
document.addEventListener('paste', async (e) => {
  // ADR-028 clause 4 — this is a document-wide listener, not gated by the
  // widget body's visibility check below (which only inspects the tab
  // pane's own inline style, not its hidden ancestor).
  if (!snipModeActive) return;
  if (!snippetImagePane || snippetImagePane.style.display === 'none') return;
  const items = e.clipboardData?.items;
  if (!items) return;
  for (const item of Array.from(items)) {
    if (item.kind === 'file' && ALLOWED_IMAGE_MIMES.has(item.type)) {
      const file = item.getAsFile();
      if (file) {
        e.preventDefault();
        await ingestImageFile(file);
        return;
      }
    }
  }
});

// URL-fetch button
if (snippetImageFetchBtn && snippetImageUrlInput) {
  snippetImageFetchBtn.addEventListener('click', async () => {
    const url = snippetImageUrlInput.value.trim();
    if (!url) return;
    await ingestImageFromUrl(url);
  });
}

// ============================================================
// Phase 1.5 — link snippet capture (WS-3 closure)
// ============================================================

if (snippetLinkPrepBtn) {
  snippetLinkPrepBtn.addEventListener('click', async () => {
    if (!snippetEnabled) return;
    // ADR-028 clause 4 — see the capture-selection handler above.
    if (!snipModeActive) return;
    const href = snippetLinkHrefInput?.value.trim() ?? '';
    if (!/^https?:\/\//i.test(href)) {
      if (snippetLinkStatus)
        snippetLinkStatus.textContent = 'URL must start with http:// or https://';
      return;
    }
    const linkText = snippetLinkTextInput?.value.trim() ?? '';
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const sourceUrl = tabs[0]?.url ?? 'about:blank';
    const pageTitle = tabs[0]?.title ?? '';
    const suggested = suggestTagSlugsForUrl(href, availableTags.map((t) => t.slug));
    currentSnippet = {
      kind: 'link',
      href,
      linkText: linkText.length > 0 ? linkText : null,
      sourceUrl,
      pageTitle,
      pageType: detectSnippetPageType(href),
      selectedTags: new Set<string>(suggested),
      note: '',
    };
    if (snippetPreview) {
      snippetPreview.style.display = '';
      snippetPreview.textContent = linkText ? `${linkText} — ${href}` : href;
    }
    if (snippetImagePreviewWrap) snippetImagePreviewWrap.style.display = 'none';
    if (snippetMentionsField) snippetMentionsField.style.display = 'none';
    if (snippetTagsContainer) renderTagChips(snippetTagsContainer, currentSnippet.selectedTags);
    if (snippetNoteEl) snippetNoteEl.value = '';
    if (snippetCard) snippetCard.style.display = '';
    if (snippetLinkStatus) snippetLinkStatus.textContent = 'Link ready. Add tags and save.';
  });
}

if (snippetSaveBtn) {
  snippetSaveBtn.addEventListener('click', async () => {
    if (!currentSnippet) return;
    if (!snippetEnabled) return;
    (snippetSaveBtn as HTMLButtonElement).setAttribute('disabled', 'true');
    (snippetSaveBtn as HTMLElement).textContent = 'Saving…';
    try {
      // Determine the currently-locked target from the Target Panel.
      if (!lastRenderedLock || lastRenderedLock === 'none') {
        throw new Error('No active research target. Open a profile or task first.');
      }
      const [source, kind, id] = lastRenderedLock.split(':');
      void source;
      const targetKind = kind === 'person' ? 'contact' : kind;

      // WS-3 Phase 6 §9 — PII scrub for text snippets. The banner shown in
      // `detectPiiAndShowBanner` was advisory; now we actually redact. Image
      // snippets don't have scannable text so we skip.
      let scrubbedText: string | null = null;
      if (currentSnippet.kind === 'text') {
        const pass = detectAndScrubPii(currentSnippet.selection.text);
        if (pass.hit) scrubbedText = pass.scrubbedText;
      }

      // Build the body based on the active payload kind.
      let body: Record<string, unknown>;
      if (currentSnippet.kind === 'image') {
        body = {
          kind: 'image' as const,
          targetKind,
          targetId: id,
          imageBytes: currentSnippet.imageBytes,
          mimeType: currentSnippet.mimeType,
          width: currentSnippet.width ?? undefined,
          height: currentSnippet.height ?? undefined,
          sourceUrl:
            currentSnippet.sourceUrl || currentSnippet.pageUrl || 'about:blank',
          pageType: currentSnippet.pageType ?? undefined,
          tagSlugs: Array.from(currentSnippet.selectedTags),
          note: snippetNoteEl?.value ?? '',
        };
      } else if (currentSnippet.kind === 'link') {
        body = {
          kind: 'link' as const,
          targetKind,
          targetId: id,
          href: currentSnippet.href,
          linkText: currentSnippet.linkText ?? undefined,
          sourceUrl: currentSnippet.sourceUrl || 'about:blank',
          pageType: currentSnippet.pageType ?? undefined,
          tagSlugs: Array.from(currentSnippet.selectedTags),
          note: snippetNoteEl?.value ?? '',
        };
      } else {
        body = {
          kind: 'text' as const,
          targetKind,
          targetId: id,
          text: scrubbedText ?? currentSnippet.selection.text,
          sourceUrl: currentSnippet.selection.sourceUrl,
          pageType: currentSnippet.selection.pageType,
          tagSlugs: Array.from(currentSnippet.selectedTags),
          note: snippetNoteEl?.value ?? '',
          mentionContactIds: Array.from(currentSnippet.selectedMentions),
        };
      }

      const appUrl = await getAppUrlBase();
      const { extensionToken } = await new Promise<{ extensionToken?: string }>((r) =>
        chrome.storage.local.get('extensionToken', (v) => r(v)),
      );
      let res: Response;
      try {
        res = await fetch(`${appUrl}/api/extension/snippet`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(extensionToken ? { 'X-Extension-Token': extensionToken } : {}),
          },
          body: JSON.stringify(body),
        });
      } catch (networkErr) {
        // WS-3 Phase 6 §10 — server unreachable → queue for later replay.
        await enqueueSnippet(body, (networkErr as Error).message ?? 'network');
        await refreshSnippetQueueDepth();
        if (snippetStatus)
          snippetStatus.textContent = 'Offline — saved locally. Will retry.';
        if (snippetImageStatus)
          snippetImageStatus.textContent = 'Offline — saved locally. Will retry.';
        resetSnippetCard();
        return;
      }
      if (!res.ok) {
        // 5xx → queue for retry (server failure). 4xx → surface validation.
        if (res.status >= 500 && res.status < 600) {
          await enqueueSnippet(body, `HTTP ${res.status}`);
          await refreshSnippetQueueDepth();
          if (snippetStatus)
            snippetStatus.textContent = `Server unavailable (HTTP ${res.status}) — saved locally.`;
          if (snippetImageStatus)
            snippetImageStatus.textContent = `Server unavailable (HTTP ${res.status}) — saved locally.`;
          resetSnippetCard();
          return;
        }
        const err = await res.json().catch(() => ({ message: `HTTP ${res.status}` }));
        throw new Error((err as { message?: string }).message ?? `HTTP ${res.status}`);
      }
      const okMsg =
        currentSnippet.kind === 'image'
          ? 'Image snippet saved.'
          : currentSnippet.kind === 'link'
          ? 'Link snippet saved.'
          : 'Snippet saved.';
      if (snippetStatus) snippetStatus.textContent = okMsg;
      if (snippetImageStatus) snippetImageStatus.textContent = okMsg;
      if (snippetLinkStatus) snippetLinkStatus.textContent = okMsg;
      resetSnippetCard();
    } catch (err) {
      if (snippetErrorEl) {
        snippetErrorEl.style.display = '';
        snippetErrorEl.textContent = (err as Error).message;
      }
    } finally {
      (snippetSaveBtn as HTMLButtonElement).removeAttribute('disabled');
      (snippetSaveBtn as HTMLElement).textContent = 'Save snippet';
    }
  });
}

// Surface-level reactivity: refresh Add-host button when tab changes; reload
// tags lazily after init finishes so we do not block the critical-path render.
chrome.tabs.onActivated.addListener(() => {
  void updateAddHostButton();
});
chrome.tabs.onUpdated.addListener((_id, info) => {
  if (info.status === 'complete' || info.url) {
    void updateAddHostButton();
  }
});

void loadSnippetTags().then(() => updateAddHostButton());

// ============================================================
// WS-2 Phase 2 Track D: visibility panels
// ============================================================
//
// Three collapsible panels under the target panel:
//   - Parse Result: latest parse_complete for the locked target.
//   - Capture Diff: server-computed projection diff vs the prior capture.
//   - Unmatched DOM: regions the parser couldn't claim, with a flag button.
//
// Per Q6 in `10-decisions.md`: always-on, collapsible, state persisted in
// chrome.storage.local. Feature-gated at runtime on
// RESEARCH_FLAGS.parserTelemetry (queried from the app via
// /api/extension/analytics — a 404 signals the flag is off and we keep the
// section hidden).

type VisibilityTargetKind = 'contact' | 'company';

let visibilityCurrentTarget: { kind: VisibilityTargetKind; id: string } | null =
  null;
let visibilityFlagEnabled = false;
let visibilityLastCaptureId: string | null = null;
let visibilityLastPageType: string | null = null;

const VIS_STORAGE_KEY = 'visibilityPanelState';

async function loadVisibilityState(): Promise<{
  parseResultCollapsed: boolean;
  captureDiffCollapsed: boolean;
  unmatchedCollapsed: boolean;
}> {
  return new Promise((resolve) => {
    chrome.storage.local.get(VIS_STORAGE_KEY, (v) => {
      const s = (v[VIS_STORAGE_KEY] as {
        parseResultCollapsed?: boolean;
        captureDiffCollapsed?: boolean;
        unmatchedCollapsed?: boolean;
      }) ?? {};
      resolve({
        parseResultCollapsed: s.parseResultCollapsed ?? false,
        captureDiffCollapsed: s.captureDiffCollapsed ?? true,
        unmatchedCollapsed: s.unmatchedCollapsed ?? true,
      });
    });
  });
}

async function saveVisibilityState(patch: Record<string, boolean>): Promise<void> {
  const current = await loadVisibilityState();
  await chrome.storage.local.set({
    [VIS_STORAGE_KEY]: { ...current, ...patch },
  });
}

function emitAnalytics(event: string, properties: Record<string, unknown> = {}): void {
  void (async () => {
    try {
      const appUrl = await getAppUrlBase();
      const { extensionToken } = await new Promise<{ extensionToken?: string }>(
        (r) => chrome.storage.local.get('extensionToken', (v) => r(v)),
      );
      await fetch(`${appUrl}/api/extension/analytics`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(extensionToken ? { Authorization: `Bearer ${extensionToken}` } : {}),
        },
        body: JSON.stringify({ event, properties }),
      });
    } catch {
      // Analytics are fire-and-forget.
    }
  })();
}

async function probeVisibilityFlag(): Promise<boolean> {
  try {
    const appUrl = await getAppUrlBase();
    const res = await fetch(`${appUrl}/api/extension/analytics`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event: 'parse_panel_viewed' }),
    });
    // 404 means the flag is off. 200 / 400 / 401 all mean the endpoint is
    // live so the flag is on (auth / validation live downstream).
    return res.status !== 404;
  } catch {
    return false;
  }
}

function formatConfidence(c: number | null | undefined): string {
  if (c === null || c === undefined || Number.isNaN(c)) return '—';
  return c.toFixed(2);
}

function renderParseResultPanel(payload: {
  captureId: string;
  pageType: string;
  fields: Array<{ field: string; confidence: number }>;
  receivedAt: string;
}): void {
  const empty = document.getElementById('sp-parse-result-empty');
  const metaEl = document.getElementById('sp-parse-result-meta');
  const fieldsEl = document.getElementById('sp-parse-result-fields');
  const regBtn = document.getElementById('sp-regression-run-btn') as
    | HTMLButtonElement
    | null;
  if (!empty || !metaEl || !fieldsEl) return;

  empty.style.display = 'none';
  metaEl.style.display = '';
  fieldsEl.style.display = '';

  const present = payload.fields.filter((f) => f.confidence > 0).length;
  metaEl.textContent = `Capture ${payload.captureId.slice(0, 8)} · ${payload.pageType} · ${present}/${payload.fields.length} fields`;

  fieldsEl.innerHTML = '';
  const sorted = [...payload.fields].sort((a, b) =>
    a.field.localeCompare(b.field),
  );
  for (const f of sorted) {
    const li = document.createElement('li');
    li.className = f.confidence > 0 ? 'present' : 'missing';
    const name = document.createElement('span');
    name.textContent = f.field;
    const badge = document.createElement('span');
    badge.className = 'confidence-badge';
    badge.textContent = formatConfidence(f.confidence);
    li.appendChild(name);
    li.appendChild(badge);
    fieldsEl.appendChild(li);
  }

  if (regBtn) regBtn.disabled = false;
  emitAnalytics('parse_panel_viewed', {
    captureId: payload.captureId,
    pageType: payload.pageType,
    fields: payload.fields.length,
  });
}

async function refreshCaptureDiffPanel(): Promise<void> {
  const empty = document.getElementById('sp-capture-diff-empty');
  const changesEl = document.getElementById('sp-capture-diff-changes');
  const unchangedEl = document.getElementById('sp-capture-diff-unchanged');
  if (!empty || !changesEl || !unchangedEl) return;

  if (!visibilityFlagEnabled || !visibilityCurrentTarget) {
    empty.style.display = '';
    changesEl.style.display = 'none';
    unchangedEl.style.display = 'none';
    return;
  }

  try {
    const appUrl = await getAppUrlBase();
    const { extensionToken } = await new Promise<{ extensionToken?: string }>(
      (r) => chrome.storage.local.get('extensionToken', (v) => r(v)),
    );
    const params = new URLSearchParams({
      kind: visibilityCurrentTarget.kind,
      id: visibilityCurrentTarget.id,
    });
    const res = await fetch(
      `${appUrl}/api/extension/entity-diff?${params.toString()}`,
      {
        headers: extensionToken ? { Authorization: `Bearer ${extensionToken}` } : {},
      },
    );
    if (!res.ok) {
      empty.textContent =
        res.status === 404 ? 'Entity not found.' : 'Diff unavailable.';
      empty.style.display = '';
      changesEl.style.display = 'none';
      unchangedEl.style.display = 'none';
      return;
    }
    const diff = (await res.json()) as {
      changes: Array<{
        field: string;
        kind: 'added' | 'removed' | 'changed';
        before: unknown;
        after: unknown;
      }>;
      unchangedFieldCount: number;
      fromCaptureId: string | null;
    };

    if (diff.changes.length === 0) {
      empty.textContent =
        diff.fromCaptureId === null
          ? 'First capture — nothing to diff against.'
          : 'No changes since the prior capture.';
      empty.style.display = '';
      changesEl.style.display = 'none';
    } else {
      empty.style.display = 'none';
      changesEl.style.display = '';
      changesEl.innerHTML = '';
      for (const c of diff.changes) {
        const li = document.createElement('li');
        li.className = c.kind;
        const display =
          c.kind === 'added'
            ? `+ ${c.field}: ${String(c.after)}`
            : c.kind === 'removed'
              ? `- ${c.field}: ${String(c.before)}`
              : `± ${c.field}: ${String(c.before)} → ${String(c.after)}`;
        li.textContent = display;
        changesEl.appendChild(li);
      }
    }
    unchangedEl.textContent = `${diff.unchangedFieldCount} unchanged field(s).`;
    unchangedEl.style.display = '';
    emitAnalytics('capture_diff_opened', {
      kind: visibilityCurrentTarget.kind,
      changes: diff.changes.length,
    });
  } catch {
    empty.textContent = 'Diff unavailable.';
    empty.style.display = '';
    changesEl.style.display = 'none';
    unchangedEl.style.display = 'none';
  }
}

async function flagUnmatchedRegion(region: {
  domPath: string;
  textPreview: string;
  htmlExcerpt?: string;
}): Promise<void> {
  if (!visibilityLastCaptureId || !visibilityLastPageType) return;
  try {
    const appUrl = await getAppUrlBase();
    const { extensionToken } = await new Promise<{ extensionToken?: string }>(
      (r) => chrome.storage.local.get('extensionToken', (v) => r(v)),
    );
    const res = await fetch(`${appUrl}/api/parser/flag-unmatched`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(extensionToken ? { Authorization: `Bearer ${extensionToken}` } : {}),
      },
      body: JSON.stringify({
        captureId: visibilityLastCaptureId,
        pageType: visibilityLastPageType,
        domPath: region.domPath,
        // Without a client-side HTML excerpt we fall back to the text preview.
        // The server caps at 4KB.
        domHtmlExcerpt: region.htmlExcerpt ?? region.textPreview,
        textPreview: region.textPreview,
      }),
    });
    const statusEl = document.getElementById('sp-regression-status');
    if (statusEl) {
      statusEl.style.display = '';
      statusEl.textContent = res.ok
        ? 'Flagged. Thanks.'
        : `Flag failed (${res.status}).`;
    }
  } catch {
    // Silent failure — the sidebar remains usable.
  }
}

function renderUnmatchedPanel(
  regions: Array<{ domPath: string; textPreview: string; byteLength?: number }>,
): void {
  const empty = document.getElementById('sp-unmatched-empty');
  const listEl = document.getElementById('sp-unmatched-regions');
  if (!empty || !listEl) return;

  if (regions.length === 0) {
    empty.style.display = '';
    listEl.style.display = 'none';
    return;
  }

  empty.style.display = 'none';
  listEl.style.display = '';
  listEl.innerHTML = '';
  for (const region of regions) {
    const li = document.createElement('li');
    const path = document.createElement('div');
    path.className = 'unmatched-dom-path';
    path.textContent = region.domPath;
    const text = document.createElement('div');
    text.className = 'unmatched-text-preview';
    text.textContent = region.textPreview;
    const btn = document.createElement('button');
    btn.className = 'btn btn-secondary unmatched-flag-btn';
    btn.textContent = 'Flag for selector miss';
    btn.addEventListener('click', () => {
      btn.disabled = true;
      btn.textContent = 'Flagging…';
      void flagUnmatchedRegion(region).then(() => {
        btn.textContent = 'Flagged';
      });
    });
    li.appendChild(path);
    li.appendChild(text);
    li.appendChild(btn);
    listEl.appendChild(li);
  }
}

async function runRegressionReport(): Promise<void> {
  const statusEl = document.getElementById('sp-regression-status');
  const btn = document.getElementById('sp-regression-run-btn') as
    | HTMLButtonElement
    | null;
  if (!visibilityLastCaptureId || !visibilityLastPageType || !btn) return;
  btn.disabled = true;
  if (statusEl) {
    statusEl.style.display = '';
    statusEl.textContent = 'Running regression report…';
  }
  try {
    const appUrl = await getAppUrlBase();
    const { extensionToken } = await new Promise<{ extensionToken?: string }>(
      (r) => chrome.storage.local.get('extensionToken', (v) => r(v)),
    );
    const res = await fetch(`${appUrl}/api/parser/regression-report`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(extensionToken ? { Authorization: `Bearer ${extensionToken}` } : {}),
      },
      body: JSON.stringify({
        pageType: visibilityLastPageType,
        rawHtml: '<html></html>',
        captureId: visibilityLastCaptureId,
      }),
    });
    if (!res.ok) {
      if (statusEl) statusEl.textContent = `Failed (${res.status}).`;
      return;
    }
    const json = (await res.json()) as {
      extracted?: { fieldsExtracted?: number; fieldsAttempted?: number };
    };
    if (statusEl) {
      const ex = json.extracted?.fieldsExtracted ?? 0;
      const att = json.extracted?.fieldsAttempted ?? 0;
      statusEl.textContent = `Yield: ${ex}/${att} fields extracted.`;
    }
  } catch {
    if (statusEl) statusEl.textContent = 'Regression report failed.';
  } finally {
    btn.disabled = false;
  }
}

function wireVisibilityDetails(): void {
  const parseEl = document.getElementById(
    'sp-parse-result-details',
  ) as HTMLDetailsElement | null;
  const diffEl = document.getElementById(
    'sp-capture-diff-details',
  ) as HTMLDetailsElement | null;
  const unmEl = document.getElementById(
    'sp-unmatched-details',
  ) as HTMLDetailsElement | null;

  parseEl?.addEventListener('toggle', () => {
    void saveVisibilityState({
      parseResultCollapsed: !parseEl.open,
    });
  });
  diffEl?.addEventListener('toggle', () => {
    void saveVisibilityState({
      captureDiffCollapsed: !diffEl.open,
    });
    if (diffEl.open) void refreshCaptureDiffPanel();
  });
  unmEl?.addEventListener('toggle', () => {
    void saveVisibilityState({
      unmatchedCollapsed: !unmEl.open,
    });
  });

  document
    .getElementById('sp-regression-run-btn')
    ?.addEventListener('click', () => {
      void runRegressionReport();
    });
}

async function initVisibilityPanels(): Promise<void> {
  visibilityFlagEnabled = await probeVisibilityFlag();
  const section = document.getElementById('sp-visibility-section');
  if (!section) return;
  if (!visibilityFlagEnabled) {
    section.style.display = 'none';
    return;
  }
  section.style.display = '';

  const state = await loadVisibilityState();
  const parseEl = document.getElementById(
    'sp-parse-result-details',
  ) as HTMLDetailsElement | null;
  const diffEl = document.getElementById(
    'sp-capture-diff-details',
  ) as HTMLDetailsElement | null;
  const unmEl = document.getElementById(
    'sp-unmatched-details',
  ) as HTMLDetailsElement | null;
  if (parseEl) parseEl.open = !state.parseResultCollapsed;
  if (diffEl) diffEl.open = !state.captureDiffCollapsed;
  if (unmEl) unmEl.open = !state.unmatchedCollapsed;

  wireVisibilityDetails();

  // Seed with any existing parse result already in storage.
  chrome.storage.local.get('lastParseResult', (v) => {
    const p = v.lastParseResult as
      | {
          captureId: string;
          pageType: string;
          fields: Array<{ field: string; confidence: number }>;
          receivedAt: string;
        }
      | undefined;
    if (p) {
      visibilityLastCaptureId = p.captureId;
      visibilityLastPageType = p.pageType;
      renderParseResultPanel(p);
    }
  });

  void refreshCaptureDiffPanel();
}

// Listen for parse-complete updates pushed by the service worker.
chrome.storage.onChanged.addListener((changes) => {
  if (!visibilityFlagEnabled) return;
  if (changes.lastParseResult) {
    const p = changes.lastParseResult.newValue as
      | {
          captureId: string;
          pageType: string;
          fields: Array<{ field: string; confidence: number }>;
          receivedAt: string;
        }
      | undefined;
    if (p) {
      visibilityLastCaptureId = p.captureId;
      visibilityLastPageType = p.pageType;
      renderParseResultPanel(p);
      // Clear any stale unmatched view; the current capture's unmatched
      // list is not part of the WS payload — fetch it lazily via the
      // capture summary if/when the server exposes one.
      renderUnmatchedPanel([]);
      void refreshCaptureDiffPanel();
    }
  }
});

void initVisibilityPanels();
