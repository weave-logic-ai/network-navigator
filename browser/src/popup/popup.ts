// LinkedIn Network Intelligence - Popup UI
// Quick status, capture, and task management

import type { ExtensionMessage, ExtensionTask, OutreachTemplate } from '../types';
import { logger } from '../utils/logger';
import { getDailyCaptureCount, getCaptureLimit } from '../utils/storage';
import { ExtensionAuthError, fetchOutreachTemplates, isFullExtensionToken, personalizeOutreachTemplate, registerFullExtensionToken } from '../shared/outreach-api';

// ============================================================
// DOM References
// ============================================================

const connectionStatus = document.getElementById('connection-status')!;
const registerSection = document.getElementById('register-section')!;
const mainSection = document.getElementById('main-section')!;
const tokenInput = document.getElementById('token-input') as HTMLInputElement;
const registerBtn = document.getElementById('register-btn')!;
const registerError = document.getElementById('register-error')!;
const captureCount = document.getElementById('capture-count')!;
const queueDepth = document.getElementById('queue-depth')!;
const taskCount = document.getElementById('task-count')!;
const pageType = document.getElementById('page-type')!;
const captureBtn = document.getElementById('capture-btn')!;
const taskList = document.getElementById('task-list')!;
const openSidepanelBtn = document.getElementById('open-sidepanel-btn')!;

// Template DOM References (Phase 5)
const templateSelector = document.getElementById('template-selector') as HTMLSelectElement;
const templatePreview = document.getElementById('template-preview')!;
const templatePreviewText = document.getElementById('template-preview-text')!;
const templateActions = document.getElementById('template-actions')!;
const copyTemplateBtn = document.getElementById('copy-template-btn')!;
const personalizeBtn = document.getElementById('personalize-btn')!;
const templateStatus = document.getElementById('template-status')!;

// Settings DOM References (Phase 6)
const settingsToggle = document.getElementById('settings-toggle')!;
const settingsContent = document.getElementById('settings-content')!;
const settingsChevron = document.getElementById('settings-chevron')!;
const settingAppUrl = document.getElementById('setting-app-url') as HTMLInputElement;
const saveAppUrlBtn = document.getElementById('save-app-url-btn')!;
const settingAutoCapture = document.getElementById('setting-auto-capture') as HTMLInputElement;
const settingAutoPaginate = document.getElementById('setting-auto-paginate') as HTMLInputElement;
const settingCaptureLimit = document.getElementById('setting-capture-limit') as HTMLInputElement;
const settingOverlayPosition = document.getElementById('setting-overlay-position') as HTMLSelectElement;

// ============================================================
// Status Update
// ============================================================

async function updateStatus(): Promise<void> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(
      { type: 'GET_STATUS' } satisfies ExtensionMessage,
      (response) => {
        if (response?.data) {
          const data = response.data;
          connectionStatus.className = `status-indicator ${data.connectionState}`;
          connectionStatus.textContent =
            data.connectionState === 'connected'
              ? 'Connected'
              : data.connectionState === 'connecting'
                ? 'Connecting...'
                : data.connectionState === 'error'
                  ? 'Error'
                  : 'Disconnected';
          captureCount.textContent = String(data.dailyCaptureCount ?? 0);
          queueDepth.textContent = String(data.queueDepth ?? 0);
          taskCount.textContent = String(data.taskCount ?? 0);
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
            const info = response.payload as { pageType?: string; url?: string };
            pageType.textContent = info.pageType ?? '--';
            (captureBtn as HTMLButtonElement).disabled = info.pageType === 'OTHER' || !info.pageType;
          } else {
            pageType.textContent = 'Not a LinkedIn page';
            (captureBtn as HTMLButtonElement).disabled = true;
          }
        }
      );
    } catch {
      pageType.textContent = 'Not a LinkedIn page';
      (captureBtn as HTMLButtonElement).disabled = true;
    }
  }
}

// ============================================================
// Task Rendering
// ============================================================

function renderTasks(tasks: ExtensionTask[]): void {
  if (tasks.length === 0) {
    taskList.innerHTML = '<p class="placeholder-text">No pending tasks</p>';
    return;
  }

  taskList.innerHTML = tasks
    .slice(0, 10)
    .map(
      (task) => `
    <div class="task-item" data-task-id="${task.id}">
      <span class="task-priority ${task.priority}"></span>
      <span class="task-title ${task.targetUrl ? 'task-clickable' : ''}" ${task.targetUrl ? `data-url="${escapeHtml(task.targetUrl)}"` : ''}>${escapeHtml(task.title)}</span>
      <div class="task-actions">
        ${task.targetUrl ? `<button class="task-action-btn task-go" data-url="${escapeHtml(task.targetUrl)}" title="Go to page">Go</button>` : ''}
        ${task.targetUrl ? `<button class="task-action-btn task-copy" data-url="${escapeHtml(task.targetUrl)}" title="Copy URL">Copy</button>` : ''}
      </div>
    </div>
  `
    )
    .join('');

  async function navigateToUrl(url: string): Promise<void> {
    if (url.includes('linkedin.com')) {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      const activeTab = tabs[0];
      if (activeTab?.id && activeTab.url?.includes('linkedin.com')) {
        chrome.tabs.update(activeTab.id, { url });
        window.close();
        return;
      }
      const linkedinTabs = await chrome.tabs.query({ url: ['https://www.linkedin.com/*', 'https://linkedin.com/*'] });
      if (linkedinTabs.length > 0 && linkedinTabs[0].id) {
        chrome.tabs.update(linkedinTabs[0].id, { url, active: true });
        chrome.windows.update(linkedinTabs[0].windowId!, { focused: true });
        window.close();
        return;
      }
    }
    chrome.tabs.create({ url });
    window.close();
  }

  taskList.querySelectorAll('.task-go').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const url = (btn as HTMLElement).dataset.url;
      if (url) navigateToUrl(url);
    });
  });

  taskList.querySelectorAll('.task-clickable').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const url = (el as HTMLElement).dataset.url;
      if (url) navigateToUrl(url);
    });
  });

  taskList.querySelectorAll('.task-copy').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const url = (btn as HTMLElement).dataset.url;
      if (url) {
        await navigator.clipboard.writeText(url);
        (btn as HTMLElement).textContent = 'Copied!';
        setTimeout(() => { (btn as HTMLElement).textContent = 'Copy'; }, 1500);
      }
    });
  });
}

function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ============================================================
// Registration
// ============================================================

async function checkRegistration(): Promise<boolean> {
  const result = await chrome.storage.local.get(['extensionToken', 'extensionId', 'appUrl']);
  let hasToken = isFullExtensionToken(result.extensionToken);
  let error = result.extensionToken && !hasToken
    ? 'Saved display prefix cannot authenticate. Enter the full extension token to reconnect.'
    : '';
  if (hasToken) {
    try {
      await registerFullExtensionToken(
        (result.appUrl as string) || 'http://localhost:3750', result.extensionToken as string
      );
    } catch (failure) {
      if (failure instanceof ExtensionAuthError && failure.status === 401) {
        hasToken = false;
        error = 'Saved token expired or was revoked. Enter a new full token to reconnect.';
        await chrome.storage.local.remove(['extensionToken', 'extensionId']);
      }
      // An offline app does not erase a stored credential.
    }
  }
  registerSection.style.display = hasToken ? 'none' : 'block';
  mainSection.style.display = hasToken ? 'block' : 'none';
  registerError.textContent = error;
  registerError.style.display = error ? 'block' : 'none';
  return hasToken;
}

async function showPopupReauth(message: string): Promise<void> {
  await chrome.storage.local.remove(['extensionToken', 'extensionId']);
  registerSection.style.display = 'block';
  mainSection.style.display = 'none';
  registerError.textContent = message;
  registerError.style.display = 'block';
}

registerBtn.addEventListener('click', async () => {
  const token = tokenInput.value.trim();
  if (!isFullExtensionToken(token)) {
    registerError.textContent = 'Enter the full extension token (ext_ followed by 43 characters).';
    registerError.style.display = 'block';
    return;
  }

  registerBtn.setAttribute('disabled', 'true');
  registerError.style.display = 'none';

  try {
    const appUrl = await new Promise<string>((resolve) => {
      chrome.storage.local.get('appUrl', (result) => {
        resolve((result.appUrl as string) || 'http://localhost:3750');
      });
    });

    const data = await registerFullExtensionToken(appUrl, token);
    await chrome.storage.local.set({
      extensionToken: token,
      extensionId: data.extensionId,
      settings: data.settings,
    });
    tokenInput.value = '';

    registerSection.style.display = 'none';
    mainSection.style.display = 'block';
    await updateStatus();
    await loadTemplates();
  } catch (err) {
    registerError.textContent = 'Registration failed. Check your token and try again.';
    registerError.style.display = 'block';
    logger.error('Registration failed:', (err as Error).message);
  } finally {
    registerBtn.removeAttribute('disabled');
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
    (response: { status?: string; message?: string } | undefined) => {
      const status = response?.status;
      captureBtn.textContent = status === 'submitted' ? 'Submitted' : status === 'queued' ? 'Queued locally' : status === 'limit' ? 'Limit reached' : 'Capture failed';
      captureBtn.setAttribute('title', response?.message || chrome.runtime.lastError?.message || '');
      setTimeout(() => {
        if (status !== 'limit') captureBtn.removeAttribute('disabled');
        if (status === 'submitted' || status === 'queued') captureBtn.textContent = 'Capture This Page';
        updateStatus();
      }, 1500);
    }
  );
});

// ============================================================
// Templates (Phase 5)
// ============================================================

let loadedTemplates: OutreachTemplate[] = [];
let templatesFromServer = false;

const DEFAULT_TEMPLATES: OutreachTemplate[] = [
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

async function loadTemplates(): Promise<void> {
  templatesFromServer = false;
  try {
    const appUrl = await new Promise<string>((resolve) => {
      chrome.storage.local.get('appUrl', (result) => {
        resolve((result.appUrl as string) || 'http://localhost:3750');
      });
    });

    const { extensionToken } = await chrome.storage.local.get('extensionToken');
    const templates = await fetchOutreachTemplates(appUrl, extensionToken);
    if (templates.length > 0) {
      loadedTemplates = templates;
      templatesFromServer = true;
      updateTemplateSelectorOptions();
      return;
    }
  } catch (error) {
    if (error instanceof ExtensionAuthError && error.status === 401) {
      await showPopupReauth('Token expired or revoked. Enter a new full token to reconnect.');
    }
  }

  loadedTemplates = DEFAULT_TEMPLATES;
  updateTemplateSelectorOptions();
}

function updateTemplateSelectorOptions(): void {
  templateSelector.innerHTML = '<option value="">Select a template...</option>';
  templatePreview.style.display = 'none';
  templateActions.style.display = 'none';
  personalizeBtn.setAttribute('disabled', 'true');
  for (const tpl of loadedTemplates) {
    const opt = document.createElement('option');
    opt.value = tpl.id;
    opt.textContent = tpl.name;
    templateSelector.appendChild(opt);
  }
}

function showTemplateStatus(message: string, type: 'success' | 'error' | 'info'): void {
  templateStatus.textContent = message;
  templateStatus.className = `template-status ${type}`;
  templateStatus.style.display = 'block';
  setTimeout(() => { templateStatus.style.display = 'none'; }, 3000);
}

templateSelector.addEventListener('change', () => {
  const selectedId = templateSelector.value;
  if (!selectedId) {
    templatePreview.style.display = 'none';
    templateActions.style.display = 'none';
    personalizeBtn.setAttribute('disabled', 'true');
    return;
  }
  const template = loadedTemplates.find((t) => t.id === selectedId);
  if (template) {
    templatePreviewText.textContent = template.body;
    templatePreview.style.display = 'block';
    templateActions.style.display = 'flex';
    personalizeBtn.toggleAttribute('disabled', !templatesFromServer);
    personalizeBtn.title = templatesFromServer ? '' : 'Personalization requires a saved template';
  }
});

copyTemplateBtn.addEventListener('click', async () => {
  const selectedId = templateSelector.value;
  const template = loadedTemplates.find((t) => t.id === selectedId);
  if (!template) return;
  try {
    await navigator.clipboard.writeText(template.body);
    const originalText = copyTemplateBtn.textContent;
    copyTemplateBtn.textContent = 'Copied!';
    setTimeout(() => { copyTemplateBtn.textContent = originalText; }, 1500);
  } catch {
    showTemplateStatus('Failed to copy to clipboard', 'error');
  }
});

personalizeBtn.addEventListener('click', async () => {
  if (!templatesFromServer) return;
  const selectedId = templateSelector.value;
  if (!selectedId) return;

  personalizeBtn.setAttribute('disabled', 'true');
  personalizeBtn.textContent = 'Personalizing...';

  try {
    const appUrl = await new Promise<string>((resolve) => {
      chrome.storage.local.get('appUrl', (result) => {
        resolve((result.appUrl as string) || 'http://localhost:3750');
      });
    });

    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const contactUrl = tabs[0]?.url || '';

    const { extensionToken } = await chrome.storage.local.get('extensionToken');
    const content = await personalizeOutreachTemplate(appUrl, extensionToken, selectedId, contactUrl);
    templatePreviewText.textContent = content;
    showTemplateStatus('Template personalized', 'success');
  } catch (error) {
    if (error instanceof ExtensionAuthError && error.status === 401) {
      await showPopupReauth('Token expired or revoked. Enter a new full token to reconnect.');
    }
    showTemplateStatus('Could not personalize. Check app connection.', 'error');
  } finally {
    personalizeBtn.toggleAttribute('disabled', !templatesFromServer);
    personalizeBtn.textContent = 'Personalize';
  }
});

// ============================================================
// Settings (Phase 6)
// ============================================================

settingsToggle.addEventListener('click', () => {
  const isVisible = settingsContent.style.display !== 'none';
  settingsContent.style.display = isVisible ? 'none' : 'block';
  settingsChevron.classList.toggle('open', !isVisible);
});

async function loadSettings(): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.get(
      ['appUrl', 'autoCapture', 'autoPaginate', 'captureLimit', 'overlayPosition'],
      (result) => {
        settingAppUrl.value = (result.appUrl as string) || 'http://localhost:3750';
        settingAutoCapture.checked = !!result.autoCapture;
        settingAutoPaginate.checked = !!result.autoPaginate;
        settingCaptureLimit.value = String(result.captureLimit ?? 50);
        settingOverlayPosition.value = (result.overlayPosition as string) || 'bottom-right';
        resolve();
      }
    );
  });
}

saveAppUrlBtn.addEventListener('click', async () => {
  const url = settingAppUrl.value.trim();
  if (!url) return;
  await chrome.storage.local.set({ appUrl: url });
  saveAppUrlBtn.textContent = 'Saved!';
  setTimeout(() => { saveAppUrlBtn.textContent = 'Save'; }, 1500);
});

settingAutoCapture.addEventListener('change', async () => {
  await chrome.storage.local.set({ autoCapture: settingAutoCapture.checked });
});

settingAutoPaginate.addEventListener('change', async () => {
  await chrome.storage.local.set({ autoPaginate: settingAutoPaginate.checked });
});

settingCaptureLimit.addEventListener('change', async () => {
  const limit = parseInt(settingCaptureLimit.value, 10);
  if (!isNaN(limit) && limit > 0) {
    await chrome.storage.local.set({ captureLimit: limit });
  }
});

settingOverlayPosition.addEventListener('change', async () => {
  await chrome.storage.local.set({ overlayPosition: settingOverlayPosition.value });
});

// ============================================================
// Side Panel
// ============================================================

openSidepanelBtn.addEventListener('click', async () => {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tabs[0]?.id) {
    await chrome.sidePanel.open({ tabId: tabs[0].id });
    window.close();
  }
});

// ============================================================
// Initialize
// ============================================================

async function init(): Promise<void> {
  const isRegistered = await checkRegistration();

  // Always load settings regardless of registration state
  await loadSettings();

  if (isRegistered) {
    await updateStatus();
    await updatePageInfo();

    // Load tasks from storage
    chrome.storage.local.get('pendingTasks', (result) => {
      const tasks = (result.pendingTasks || []) as ExtensionTask[];
      renderTasks(tasks.filter((t) => t.status === 'pending'));
    });

    // Load templates (Phase 5)
    await loadTemplates();

    // Check capture rate (Phase 6)
    const dailyCount = await getDailyCaptureCount();
    const limit = await getCaptureLimit();
    const remaining = Math.max(0, limit - dailyCount);
    captureCount.textContent = String(dailyCount);

    if (dailyCount >= limit) {
      (captureBtn as HTMLButtonElement).disabled = true;
      captureBtn.textContent = `Limit reached (${limit})`;
    } else if (dailyCount >= limit * 0.8) {
      captureBtn.textContent = `Capture (${remaining} left)`;
    }
  }
}

init().catch((err) => logger.error('Popup init failed:', (err as Error).message));
