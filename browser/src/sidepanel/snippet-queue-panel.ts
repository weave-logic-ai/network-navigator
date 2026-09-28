import { SNIPPET_QUEUE_MAX, type QueuedSnippet } from '../shared/snippet-queue.ts';

type QueueAction = 'RETRY_SNIPPET' | 'DISCARD_SNIPPET';

interface QueuePanelElements {
  section: HTMLElement;
  depth: HTMLElement;
  list: HTMLElement;
  error: HTMLElement;
  readRetry: HTMLButtonElement;
}

interface QueuePanelDependencies {
  document: Document;
  readQueue: () => Promise<QueuedSnippet[]>;
  change: (action: QueueAction, id: string) => Promise<void>;
  restore: (body: unknown, destination?: QueuedSnippet['destination']) => void;
}

function bodyOf(item: QueuedSnippet): Record<string, unknown> {
  return item.body && typeof item.body === 'object' ? item.body as Record<string, unknown> : {};
}

function safeKind(body: Record<string, unknown>): string {
  return body.kind === 'text' || body.kind === 'image' || body.kind === 'link' ? body.kind : 'snippet';
}

function safeSource(body: Record<string, unknown>): string {
  const raw = body.kind === 'link' ? body.href : body.sourceUrl;
  if (typeof raw !== 'string' || raw.length > 8192 || !/^https?:\/\//i.test(raw)) return 'source unavailable';
  try {
    const url = new URL(raw);
    // Path, query, fragment and credentials can contain personal data or tokens.
    return `${url.origin}/…`;
  } catch {
    return 'source unavailable';
  }
}

function safeTarget(body: Record<string, unknown>): string {
  const kind = body.targetKind === 'contact' || body.targetKind === 'company' ? body.targetKind : 'target';
  const id = body.targetId;
  const ref = typeof id === 'string' && /^[0-9a-f]{8}-[0-9a-f-]{20,}$/i.test(id)
    ? id.slice(0, 8)
    : typeof id === 'string' && /^\d{1,12}$/.test(id) ? id : 'unknown';
  return `${kind} ${ref}`;
}

function safeSavedAt(value: string): string {
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toLocaleString() : 'unknown time';
}

function safeErrorDetail(value?: string): string {
  if (value === 'Tenant verification required') return 'verify with original token before sending';
  if (value?.startsWith('App changed')) return 'app changed; return to original app';
  if (value?.startsWith('Token changed')) return 'token changed; retry with current token only for the same app';
  if (value?.startsWith('Destination unknown')) return 'original app unknown; check prior save before restoring';
  const code = /^HTTP ([1-5]\d\d)\b/.exec(value ?? '');
  return code ? `HTTP ${code[1]}` : value ? 'connection error' : '';
}

function safeItemRef(id: string): string {
  return /^[0-9a-f]{8}/i.test(id) ? id.slice(0, 8) : 'unknown';
}

export function createSnippetQueuePanel(elements: QueuePanelElements, deps: QueuePanelDependencies): {
  refresh: () => Promise<void>;
  showError: (error: Error) => void;
  showEnqueueFailure: (error: Error) => void;
  enqueueSucceeded: () => void;
} {
  let revision = 0;
  let actionError = '';
  let enqueueErrorKind: 'full' | 'other' | null = null;
  let readError = '';

  function renderError(): void {
    const messages = [actionError, readError].filter(Boolean);
    elements.error.textContent = messages.join(' ');
    elements.error.style.display = messages.length ? '' : 'none';
  }

  function showError(error: Error): void {
    enqueueErrorKind = null;
    actionError = /Tenant changed|Original tenant is unknown/i.test(error.message)
      ? 'Current token cannot safely replay this snippet. Return to the original token, or check the original app before restoring or discarding.'
      : /Cannot verify snippet tenant|Invalid snippet tenant identity/i.test(error.message)
      ? 'Tenant verification failed. Reconnect to the original app and retry with the original token.'
      : /App URL changed/i.test(error.message)
      ? 'Return to the original app URL before retrying this snippet.'
      : /queue is full/i.test(error.message)
      ? 'Local snippet queue is full. Retry or discard an item before saving.'
      : /quota/i.test(error.message)
      ? 'Local storage is full. Discard an item or free browser storage, then retry.'
      : 'Local snippet action failed. Retry; the stored item remains available.';
    elements.section.style.display = '';
    renderError();
  }

  function showEnqueueFailure(error: Error): void {
    enqueueErrorKind = /queue is full/i.test(error.message) ? 'full' : 'other';
    actionError = enqueueErrorKind === 'full'
      ? 'Snippet was not queued: local queue is full. Draft remains in the editor. Retry saving when space is available.'
      : 'Snippet was not queued: local storage or worker failed. Draft remains in the editor. Retry saving.';
    elements.section.style.display = '';
    renderError();
  }

  function enqueueSucceeded(): void {
    enqueueErrorKind = null;
    actionError = '';
    renderError();
  }

  async function refresh(): Promise<void> {
    const current = ++revision;
    try {
      const queue = await deps.readQueue();
      if (current !== revision) return;
      readError = '';
      if (enqueueErrorKind === 'full' && queue.length < SNIPPET_QUEUE_MAX) {
        enqueueSucceeded();
      }
      elements.readRetry.style.display = 'none';
      elements.list.replaceChildren();
      for (const item of queue) {
        const body = bodyOf(item);
        const kind = safeKind(body);
        const ref = safeItemRef(item.id);
        const row = deps.document.createElement('div');
        row.className = 'snippet-queue-row';
        const label = deps.document.createElement('span');
        const state = item.state === 'pending_verification' ? 'Needs tenant verification'
          : item.state === 'failed' || item.retryCount >= 5 ? 'Failed' : 'Queued';
        const detail = item.lastError?.startsWith('Token changed') && !item.destination?.tenantId
          ? 'token changed; original token required' : safeErrorDetail(item.lastError);
        label.textContent = `${kind} • ${safeSource(body)} • Target: ${safeTarget(body)} • Saved ${safeSavedAt(item.createdAt)} • ${state}${detail ? ` (${detail})` : ''} • Ref ${ref}`;
        row.append(label);

        for (const action of ['RETRY_SNIPPET', 'DISCARD_SNIPPET'] as const) {
          const button = deps.document.createElement('button');
          button.type = 'button';
          button.textContent = action === 'RETRY_SNIPPET' && item.state === 'pending_verification'
            ? 'Verify tenant and retry'
            : action === 'RETRY_SNIPPET' && item.lastError?.startsWith('Token changed')
            ? item.destination?.tenantId ? 'Verify tenant and retry' : 'Retry with original token'
            : action === 'RETRY_SNIPPET' ? 'Retry' : 'Discard';
          if (action === 'RETRY_SNIPPET' && (!item.destination || item.lastError?.startsWith('App changed'))) {
            button.disabled = true;
          }
          button.setAttribute('aria-label', `${button.textContent} ${kind} snippet ${ref}`);
          button.addEventListener('click', () => {
            button.disabled = true;
            void deps.change(action, item.id).then(() => {
              actionError = '';
              renderError();
              return refresh();
            }).catch((error: Error) => {
              button.disabled = false;
              showError(error);
            });
          });
          row.append(button);
        }

        if (state === 'Failed' || item.state === 'pending_verification') {
          const restore = deps.document.createElement('button');
          restore.type = 'button';
          restore.textContent = 'Restore draft';
          restore.setAttribute('aria-label', `Restore ${kind} snippet ${ref}`);
          restore.addEventListener('click', () => {
            try { deps.restore(item.body, item.destination); } catch (error) { showError(error as Error); }
          });
          row.append(restore);
        }
        elements.list.append(row);
      }
      const failed = queue.filter((item) => item.state === 'failed' || item.retryCount >= 5).length;
      const pending = queue.filter((item) => item.state === 'pending_verification').length;
      elements.depth.textContent = pending ? `${queue.length} local (${pending} need verification)`
        : failed ? `${queue.length} local (${failed} failed)` : `${queue.length} queued`;
      elements.section.style.display = queue.length || actionError ? '' : 'none';
      renderError();
    } catch {
      if (current !== revision) return;
      readError = 'Could not read local snippets. Retry reading the queue.';
      elements.section.style.display = '';
      elements.depth.textContent = 'Queue unavailable';
      elements.readRetry.style.display = '';
      renderError();
    }
  }

  elements.readRetry.addEventListener('click', () => { void refresh(); });
  return { refresh, showError, showEnqueueFailure, enqueueSucceeded };
}

/** The editor may reset only after the worker confirms durable local enqueue. */
export async function queueSnippetAndReset(
  enqueue: () => Promise<void>,
  refresh: () => Promise<void>,
  reset: () => void
): Promise<void> {
  await enqueue();
  await refresh();
  reset();
}
