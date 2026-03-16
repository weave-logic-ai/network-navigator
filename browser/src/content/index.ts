// LinkedIn Network Intelligence - Content Script (Page Capturer + Overlay)
// Captures LinkedIn page HTML and sends to service worker

import type {
  LinkedInPageType,
  CapturePayload,
  ExtensionMessage,
} from '../types';
import { PAGE_URL_PATTERNS, EXTENSION_VERSION } from '../shared/constants';
import { logger } from '../utils/logger';

// ============================================================
// Page Type Detection
// ============================================================

function detectPageType(url: string): LinkedInPageType {
  for (const { pageType, pattern } of PAGE_URL_PATTERNS) {
    if (pattern.test(url)) return pageType;
  }
  return 'OTHER';
}

// ============================================================
// Scroll Depth Tracking
// ============================================================

let maxScrollDepth = 0;

function trackScrollDepth(): void {
  const scrollTop = window.scrollY || document.documentElement.scrollTop;
  const viewportHeight = window.innerHeight;
  const documentHeight = document.documentElement.scrollHeight;
  if (documentHeight > 0) {
    const currentDepth = (scrollTop + viewportHeight) / documentHeight;
    maxScrollDepth = Math.max(maxScrollDepth, Math.min(currentDepth, 1.0));
  }
}

window.addEventListener('scroll', trackScrollDepth, { passive: true });

// ============================================================
// DOM Stability Detection
// ============================================================

function waitForDomStability(stabilityDelayMs: number = 2000): Promise<void> {
  return new Promise((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout>;
    const timeout = setTimeout(() => {
      observer.disconnect();
      reject(new Error('DOM stability timeout after 30s'));
    }, 30000);

    const observer = new MutationObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        observer.disconnect();
        clearTimeout(timeout);
        resolve();
      }, stabilityDelayMs);
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: false,
      characterData: false,
    });

    // Start initial timer in case DOM is already stable
    timer = setTimeout(() => {
      observer.disconnect();
      clearTimeout(timeout);
      resolve();
    }, stabilityDelayMs);
  });
}

// ============================================================
// Scroll-to-Bottom (triggers lazy loading)
// ============================================================

async function scrollToBottomAndBack(): Promise<void> {
  const originalScroll = window.scrollY;
  const docHeight = document.documentElement.scrollHeight;
  const viewportHeight = window.innerHeight;
  const steps = Math.ceil(docHeight / viewportHeight);

  // Scroll down in viewport-sized increments to trigger lazy loading
  for (let i = 1; i <= steps; i++) {
    window.scrollTo({ top: i * viewportHeight, behavior: 'instant' });
    // Small delay to let content load
    await new Promise((r) => setTimeout(r, 150));
  }

  // Wait at the bottom for content to finish loading
  await new Promise((r) => setTimeout(r, 1000));

  // Scroll back to original position
  window.scrollTo({ top: originalScroll, behavior: 'instant' });

  // Update max scroll depth
  trackScrollDepth();
}

// ============================================================
// Page Capture
// ============================================================

function captureFullPage(): string {
  // Hide overlay element temporarily so it doesn't get captured
  const overlay = document.getElementById('lni-overlay');
  if (overlay) overlay.style.display = 'none';

  const html = document.documentElement.outerHTML;

  // Restore overlay
  if (overlay) overlay.style.display = '';

  return html;
}

function buildCapturePayload(
  triggerMode: 'manual' | 'auto',
  sessionId: string
): CapturePayload {
  return {
    captureId: crypto.randomUUID(),
    url: window.location.href,
    pageType: detectPageType(window.location.href),
    html: captureFullPage(),
    scrollDepth: maxScrollDepth,
    viewportHeight: window.innerHeight,
    documentHeight: document.documentElement.scrollHeight,
    capturedAt: new Date().toISOString(),
    extensionVersion: EXTENSION_VERSION,
    sessionId,
    triggerMode,
  };
}

// ============================================================
// Overlay UI
// ============================================================

function createOverlay(): HTMLDivElement {
  const existing = document.getElementById('lni-overlay');
  if (existing) return existing as HTMLDivElement;

  const overlay = document.createElement('div');
  overlay.id = 'lni-overlay';
  overlay.innerHTML = `
    <div style="
      position: fixed;
      bottom: 16px;
      right: 16px;
      z-index: 2147483647;
      background: #1a1a2e;
      color: #eee;
      border-radius: 8px;
      padding: 8px 12px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 12px;
      box-shadow: 0 2px 12px rgba(0,0,0,0.3);
      display: flex;
      align-items: center;
      gap: 8px;
      cursor: pointer;
      transition: opacity 0.2s;
    " id="lni-overlay-inner">
      <span id="lni-status-dot" style="
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: #666;
        display: inline-block;
      "></span>
      <span id="lni-overlay-text">LNI</span>
      <button id="lni-capture-btn" style="
        background: #0066cc;
        color: white;
        border: none;
        border-radius: 4px;
        padding: 4px 8px;
        font-size: 11px;
        cursor: pointer;
      ">Capture</button>
    </div>
  `;

  document.body.appendChild(overlay);

  // Capture button handler
  const captureBtn = document.getElementById('lni-capture-btn');
  if (captureBtn) {
    captureBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      chrome.runtime.sendMessage({
        type: 'CAPTURE_REQUEST',
      } satisfies ExtensionMessage);
      updateOverlayStatus('capturing');
    });
  }

  // Click overlay to open side panel
  const inner = document.getElementById('lni-overlay-inner');
  if (inner) {
    inner.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).id !== 'lni-capture-btn') {
        chrome.runtime.sendMessage({
          type: 'OPEN_SIDE_PANEL',
        } satisfies ExtensionMessage);
      }
    });
  }

  return overlay;
}

function updateOverlayStatus(
  status: 'connected' | 'disconnected' | 'capturing' | 'captured' | 'error'
): void {
  const dot = document.getElementById('lni-status-dot');
  const text = document.getElementById('lni-overlay-text');
  if (!dot || !text) return;

  const colors: Record<string, string> = {
    connected: '#28a745',
    disconnected: '#666',
    capturing: '#ffc107',
    captured: '#28a745',
    error: '#dc3545',
  };

  const labels: Record<string, string> = {
    connected: 'LNI',
    disconnected: 'LNI (offline)',
    capturing: 'Capturing...',
    captured: 'Captured!',
    error: 'LNI (error)',
  };

  dot.style.background = colors[status] ?? '#666';
  text.textContent = labels[status] ?? 'LNI';

  if (status === 'captured') {
    setTimeout(() => updateOverlayStatus('connected'), 2000);
  }
}

// ============================================================
// Message Handler
// ============================================================

chrome.runtime.onMessage.addListener(
  (message: ExtensionMessage, _sender, sendResponse) => {
    if (message.type === 'CAPTURE_REQUEST') {
      updateOverlayStatus('capturing');

      // Scroll to bottom to trigger lazy loading, then capture
      scrollToBottomAndBack()
        .then(() => waitForDomStability(1000))
        .then(() => {
          const payload = buildCapturePayload('manual', '');
          sendResponse({ type: 'CAPTURE_RESULT', payload });
          updateOverlayStatus('captured');
        })
        .catch(() => {
          // Capture anyway even if scroll/stability fails
          const payload = buildCapturePayload('manual', '');
          sendResponse({ type: 'CAPTURE_RESULT', payload });
          updateOverlayStatus('captured');
        });
      return true; // async response
    }

    if (message.type === 'GET_STATUS') {
      sendResponse({
        type: 'PAGE_INFO',
        payload: {
          url: window.location.href,
          pageType: detectPageType(window.location.href),
          scrollDepth: maxScrollDepth,
          documentHeight: document.documentElement.scrollHeight,
        },
      });
      return true;
    }

    if (message.type === 'CONNECTION_STATUS') {
      const status = (message.payload as { state?: string })?.state ?? 'disconnected';
      updateOverlayStatus(status as 'connected' | 'disconnected' | 'error');
      return false;
    }

    return false;
  }
);

// ============================================================
// SPA Navigation Detection
// ============================================================

let lastUrl = window.location.href;

const navigationObserver = new MutationObserver(() => {
  const currentUrl = window.location.href;
  if (currentUrl !== lastUrl) {
    lastUrl = currentUrl;
    maxScrollDepth = 0; // Reset scroll tracking
    const pageType = detectPageType(currentUrl);
    logger.info(`Navigation detected: ${pageType} - ${currentUrl}`);

    // Notify service worker of navigation
    chrome.runtime.sendMessage({
      type: 'PAGE_INFO',
      payload: {
        url: currentUrl,
        pageType,
      },
    } satisfies ExtensionMessage);
  }
});

navigationObserver.observe(document.body, {
  childList: true,
  subtree: true,
});

// ============================================================
// Initialize
// ============================================================

const pageType = detectPageType(window.location.href);
logger.info(`Content script loaded: ${pageType} - ${window.location.href}`);

// Only create overlay on LinkedIn pages
if (window.location.hostname.includes('linkedin.com')) {
  createOverlay();
  trackScrollDepth();
}
