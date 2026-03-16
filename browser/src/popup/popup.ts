// LinkedIn Network Intelligence - Popup UI
// Quick status, capture, and task management

import type { ExtensionMessage, ExtensionTask } from '../types';
import { logger } from '../utils/logger';

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

          // Update connection status
          connectionStatus.className = `status-indicator ${data.connectionState}`;
          connectionStatus.textContent =
            data.connectionState === 'connected'
              ? 'Connected'
              : data.connectionState === 'connecting'
                ? 'Connecting...'
                : data.connectionState === 'error'
                  ? 'Error'
                  : 'Disconnected';

          // Update stats
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
          // Clear lastError to suppress "Receiving end does not exist" on non-LinkedIn tabs
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
      // Tab doesn't have content script
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
        ${
          task.targetUrl
            ? `<button class="task-action-btn task-go" data-url="${escapeHtml(task.targetUrl)}" title="Go to page">Go</button>`
            : ''
        }
        ${
          task.targetUrl
            ? `<button class="task-action-btn task-copy" data-url="${escapeHtml(task.targetUrl)}" title="Copy URL">Copy</button>`
            : ''
        }
      </div>
    </div>
  `
    )
    .join('');

  // Navigate to URL — use current LinkedIn tab if possible
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

  // Attach go button handlers
  taskList.querySelectorAll('.task-go').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const url = (btn as HTMLElement).dataset.url;
      if (url) navigateToUrl(url);
    });
  });

  // Attach clickable title handlers
  taskList.querySelectorAll('.task-clickable').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const url = (el as HTMLElement).dataset.url;
      if (url) navigateToUrl(url);
    });
  });

  // Attach copy-to-clipboard handlers
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
  return new Promise((resolve) => {
    chrome.storage.local.get(['extensionToken', 'extensionId'], (result) => {
      const hasToken = !!result.extensionToken;
      registerSection.style.display = hasToken ? 'none' : 'block';
      mainSection.style.display = hasToken ? 'block' : 'none';
      resolve(hasToken);
    });
  });
}

registerBtn.addEventListener('click', async () => {
  const token = tokenInput.value.trim();
  if (!token) {
    registerError.textContent = 'Please enter a display token';
    registerError.style.display = 'block';
    return;
  }

  registerBtn.setAttribute('disabled', 'true');
  registerError.style.display = 'none';

  try {
    const appUrl =
      (await new Promise<string>((resolve) => {
        chrome.storage.local.get('appUrl', (result) => {
          resolve((result.appUrl as string) || 'http://localhost:3000');
        });
      }));

    const response = await fetch(`${appUrl}/api/extension/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ displayToken: token }),
    });

    if (!response.ok) {
      throw new Error('Invalid token');
    }

    const data = await response.json();
    await chrome.storage.local.set({
      extensionToken: token,
      extensionId: data.extensionId,
      settings: data.settings,
    });

    registerSection.style.display = 'none';
    mainSection.style.display = 'block';
    await updateStatus();
  } catch (err) {
    registerError.textContent =
      'Registration failed. Check your token and try again.';
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
  if (isRegistered) {
    await updateStatus();
    await updatePageInfo();

    // Load tasks from storage
    chrome.storage.local.get('pendingTasks', (result) => {
      const tasks = (result.pendingTasks || []) as ExtensionTask[];
      renderTasks(tasks.filter((t) => t.status === 'pending'));
    });
  }
}

init().catch((err) => logger.error('Popup init failed:', (err as Error).message));
