// LinkedIn Network Intelligence - Service Worker
// Phase 1: Scaffold only. Full implementation in Phase 4.

console.log('[LNI] Service worker loaded');

// Placeholder: Message routing will be implemented in Phase 4
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  console.log('[LNI] Message received:', message.type);
  sendResponse({ status: 'ok' });
  return true; // Keep message channel open for async response
});

// Placeholder: Extension install handler
chrome.runtime.onInstalled.addListener((details) => {
  console.log('[LNI] Extension installed:', details.reason);
  if (details.reason === 'install') {
    // Phase 4: Open registration page or setup wizard
  }
});
