// LinkedIn Network Intelligence - Side Panel UI
// Full goal/task display, current page info, activity stats

import type { ExtensionMessage, ExtensionTask, Goal } from '../types';
import { logger } from '../utils/logger';

// ============================================================
// DOM References
// ============================================================

const connectionStatus = document.getElementById('sp-connection-status')!;
const pageTypeBadge = document.getElementById('sp-page-type')!;
const scrollDepthEl = document.getElementById('sp-scroll-depth')!;
// Contact info elements (used when viewing profile pages)
// const contactInfo = document.getElementById('sp-contact-info')!;
// const contactName = document.getElementById('sp-contact-name')!;
// const contactDetails = document.getElementById('sp-contact-details')!;
const captureBtn = document.getElementById('sp-capture-btn')!;
const goalsList = document.getElementById('sp-goals-list')!;
const captureCount = document.getElementById('sp-capture-count')!;
const queueDepthEl = document.getElementById('sp-queue-depth')!;

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

      // Side panel shares the window with the active tab — navigate it directly
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      const activeTab = tabs[0];
      if (activeTab?.id) {
        chrome.tabs.update(activeTab.id, { url });
      }
    });
  });
}

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
  if (changes.pendingTasks) {
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
});

chrome.tabs.onUpdated.addListener(async (_tabId, changeInfo) => {
  if (changeInfo.status === 'complete') {
    await updatePageInfo();
  }
});

// ============================================================
// Initialize
// ============================================================

async function init(): Promise<void> {
  await updateStatus();
  await updatePageInfo();

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

  // Refresh periodically
  setInterval(async () => {
    await updateStatus();
    await updatePageInfo();
  }, 15000);
}

init().catch((err) =>
  logger.error('Side panel init failed:', (err as Error).message)
);
