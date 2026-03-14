# Panel 3: Chrome Extension Architecture & Integration

## Version 2 Symposium -- LinkedIn Network Intelligence Tool

---

## 1. Panel Introduction

This panel convenes six domain experts to design the Chrome extension that replaces V1's Playwright-based scraping pipeline with a user-driven, ToS-compliant browser extension. The extension acts as a bridge between LinkedIn's rendered DOM and the local Next.js application, enabling enrichment, task management, and message templating -- all initiated by the user, never by automation.

### Panel Members

| # | Expert | Role | Domain |
|---|--------|------|--------|
| 1 | **Dr. Anika Johansson** | Chrome Extension Architecture Lead | Manifest V3, service workers, content scripts, message passing |
| 2 | **Ben Torres** | DOM Parsing & Content Script Specialist | LinkedIn DOM structure, MutationObserver, data extraction from rendered pages |
| 3 | **Dr. Lisa Wang** | Extension-to-App Communication Expert | Native messaging, WebSocket, localhost API, clipboard bridge |
| 4 | **Omar Khalil** | LinkedIn ToS Compliance Analyst | Automation detection, rate limiting, ToS boundaries, extension store policies |
| 5 | **Sophie Dubois** | Extension UX/Popup Design Expert | Popup UI, sidebar panels, floating overlays, badge notifications |
| 6 | **Dr. Kevin Park** | Security & Privacy in Browser Extensions | CSP, permissions model, data isolation, XSS prevention |

---

## 2. Current State Analysis: What V1 Does with Playwright

### 2.1 V1 Architecture Overview

The V1 system uses Playwright with a persistent Chromium context (`chromium.launchPersistentContext`) to automate LinkedIn page visits. The browser data directory (`.browser-data`) retains session cookies so LinkedIn remains logged in across runs. All scripts import a shared `lib.mjs` that provides `launchBrowser()`, `parseArgs()`, and niche keyword mappings.

Key architectural characteristics:
- **Server-side automation**: Scripts run as Node.js processes on the user's machine, driving a headless-capable browser.
- **Rate budget system**: A `rate-budget.mjs` module enforces daily limits per action type (`profile_visits`, `search_pages`, `activity_feeds`).
- **Local JSON database**: `db.mjs` provides `load()`/`save()` for a `contacts.json` flat-file store keyed by profile URL.
- **HTML caching**: `cache.mjs` saves raw page snapshots (`saveProfilePage`, `saveSearchPage`, `saveConnectionsPage`) for offline re-parsing.

### 2.2 Data Captured per Script

#### `enrich.mjs` -- Profile Enrichment
Navigates directly to a LinkedIn profile URL and extracts via `page.evaluate()`:

| Field | CSS Selector / Strategy |
|-------|------------------------|
| Name | `h1` element |
| Headline | `.text-body-medium.break-words` or `[data-generated-suggestion-target]` or `h2` |
| Location | `.text-body-small.inline.t-black--light.break-words` |
| About | `#about` closest `section`, truncated to 300 chars |
| Current Role | First `li` in `#experience` section, first `span[aria-hidden="true"]` |
| Current Company | Second `span[aria-hidden="true"]` in same experience `li` |
| Connections/Followers | Any `span` containing "connections" or "followers" |

Supports single-URL mode and batch mode (filters by unenriched contacts, niche terms). Saves progress every 10 profiles. Uses 2-5 second random delays between visits.

#### `search.mjs` -- LinkedIn People Search
Constructs search URLs like `linkedin.com/search/results/people/?network=[F]&keywords=...` and paginates:

| Field | Extraction Strategy |
|-------|---------------------|
| Name | `span[aria-hidden="true"]` inside profile link, or link text |
| Title | First non-degree, non-action line after name in container text |
| Location | Line containing commas, "Area", country names, or metro keywords |
| Profile URL | `a[href*="/in/"]`, cleaned of query params |
| Mutual Connections | Regex: `(\d+)\s+other\s+mutual\s+connection` |
| Current/Past Info | Regex: `Current:\s*(.+)` and `Past:\s*(.+)` |

Uses parent-walking (8 levels up) from profile links to find containing card elements. Deduplicates by URL, merges search terms, sorts by mutual connections.

#### `deep-scan.mjs` -- Connection Network Discovery
Scans a contact's connections list to discover 2nd/3rd degree contacts:

| Field | Extraction Strategy |
|-------|---------------------|
| All fields from search.mjs | Same `extractConnections()` function |
| LinkedIn Degree | Regex: `\b(1st\|2nd\|3rd)\b` in container text |
| Member URN | Regex from page HTML: `entityUrn` or Voyager API path |

Navigates to profile, extracts member URN, constructs connections search URL with degree filters. Paginates with scroll-load cycles (12+15 scroll iterations per page). Stores `degree`, `discoveredVia`, and `source` metadata on each discovered contact.

#### `activity-scanner.mjs` -- Activity & Engagement Intelligence
Navigates to `{profileUrl}/recent-activity/all/` and extracts:

| Field | Extraction Strategy |
|-------|---------------------|
| Post Text | `.feed-shared-text, .update-components-text` |
| Date | `time[datetime]` attribute |
| Likes | `.social-details-social-counts__reactions-count` |
| Comments | `.social-details-social-counts__comments` |
| Post Type | Presence of `.article-title` (article) or `.update-components-reshare` (repost) |

Computes composite activity score: `topicRelevance * 0.35 + recencyScore * 0.25 + engagementScore * 0.20 + frequencyScore * 0.20`. Uses tiered keyword matching (core AI terms score 1.0, applied terms 0.7, ecosystem terms 0.4). Currently disabled for live scraping; mock data generation available for testing.

### 2.3 What Needs to Be Replicated in the Extension

The extension must capture all the same data fields, but through fundamentally different mechanics:

| V1 Mechanism | V2 Replacement |
|-------------|----------------|
| `page.goto(url)` | User manually navigates; extension detects page type |
| `page.evaluate(() => ...)` | Content script reads DOM of the page user is already viewing |
| `page.waitForTimeout(delay)` | Not needed; user controls pacing |
| `scrollPage()` with programmatic scrolling | User scrolls naturally; content script captures visible content |
| `launchBrowser()` with persistent context | Extension runs in user's existing Chrome session |
| `rate-budget.mjs` daily limits | Extension tracks capture counts; app provides guidance |
| `cache.mjs` page snapshots | Extension sends structured data to app; optional DOM snapshot |

**Critical gap**: V1's scroll-based lazy-loading in search/connections pages triggers content that may not appear if the user does not scroll far enough. The extension must handle this gracefully -- capturing what is visible, informing the user if more content is available below the fold, and merging partial captures across multiple visits.

---

## 3. Expert Presentations

### 3.1 Dr. Anika Johansson -- Manifest V3 Architecture

#### 3.1.1 Why Manifest V3

Chrome has deprecated Manifest V2 for new extensions and is phasing out support. Manifest V3 is mandatory for Chrome Web Store publishing and provides:
- Service workers instead of persistent background pages (memory efficiency)
- `declarativeNetRequest` instead of `webRequest.onBeforeRequest` (privacy)
- Stricter CSP (security)
- Promise-based APIs throughout

#### 3.1.2 Proposed Extension Architecture

```
linkedin-prospector-extension/
  manifest.json              # Manifest V3 configuration
  service-worker.js          # Background service worker
  content-scripts/
    linkedin-detector.js     # Page type detection + DOM observer
    profile-extractor.js     # Profile page data extraction
    search-extractor.js      # Search results extraction
    feed-extractor.js        # Feed/activity extraction
    connections-extractor.js # Connections list extraction
    messages-extractor.js    # Messages page extraction
    company-extractor.js     # Company page extraction
  popup/
    popup.html               # Main popup UI
    popup.js                 # Popup logic
    popup.css                # Popup styles
  sidepanel/
    sidepanel.html           # Side panel UI (Chrome 114+)
    sidepanel.js             # Side panel logic
    sidepanel.css            # Side panel styles
  shared/
    constants.js             # Page type enums, selectors, config
    message-types.js         # Message protocol definitions
    storage-manager.js       # chrome.storage wrapper
    app-client.js            # Communication with local app
  icons/
    icon-16.png
    icon-48.png
    icon-128.png
```

#### 3.1.3 Manifest Configuration

```json
{
  "manifest_version": 3,
  "name": "LinkedIn Network Intelligence",
  "version": "1.0.0",
  "description": "Capture LinkedIn page data for local network analysis",
  "permissions": [
    "activeTab",
    "storage",
    "clipboardWrite",
    "sidePanel"
  ],
  "host_permissions": [
    "https://www.linkedin.com/*",
    "http://localhost:3000/*"
  ],
  "background": {
    "service_worker": "service-worker.js",
    "type": "module"
  },
  "content_scripts": [
    {
      "matches": ["https://www.linkedin.com/*"],
      "js": [
        "shared/constants.js",
        "content-scripts/linkedin-detector.js"
      ],
      "run_at": "document_idle"
    }
  ],
  "action": {
    "default_popup": "popup/popup.html",
    "default_icon": {
      "16": "icons/icon-16.png",
      "48": "icons/icon-48.png",
      "128": "icons/icon-128.png"
    }
  },
  "side_panel": {
    "default_path": "sidepanel/sidepanel.html"
  },
  "content_security_policy": {
    "extension_pages": "script-src 'self'; object-src 'self'"
  }
}
```

#### 3.1.4 Service Worker Lifecycle

The background service worker in MV3 is event-driven and can be terminated after 30 seconds of inactivity (5 minutes for long-running tasks). Design implications:

1. **No persistent state in memory**: All state must live in `chrome.storage.local` or `chrome.storage.session`.
2. **Event-driven activation**: Register listeners at the top level of the service worker (not inside async callbacks).
3. **Alarms for periodic work**: Use `chrome.alarms` for any scheduled operations (e.g., syncing pending captures to the app).
4. **Message-based coordination**: Content scripts communicate with the service worker via `chrome.runtime.sendMessage()` and `chrome.runtime.onMessage`.

```javascript
// service-worker.js (top-level registration)
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'PAGE_DATA_CAPTURED') {
    handlePageCapture(message.data, sender.tab).then(sendResponse);
    return true; // Keep channel open for async response
  }
  if (message.type === 'GET_TASK_LIST') {
    fetchTaskList().then(sendResponse);
    return true;
  }
  if (message.type === 'COPY_TO_CLIPBOARD') {
    handleClipboardCopy(message.text).then(sendResponse);
    return true;
  }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url?.includes('linkedin.com')) {
    updateBadgeForTab(tabId, tab.url);
  }
});
```

#### 3.1.5 Content Script Injection Strategy

Rather than injecting all extractors on every LinkedIn page, use the detector pattern:

1. `linkedin-detector.js` runs on all `linkedin.com/*` pages.
2. It determines the page type (profile, search, feed, messages, company, connections).
3. It sends a `PAGE_TYPE_DETECTED` message to the service worker.
4. The service worker programmatically injects the appropriate extractor via `chrome.scripting.executeScript()`.

This approach:
- Minimizes content script payload on pages where extraction is not needed
- Allows extractor scripts to be updated independently
- Provides a clean separation of concerns

```javascript
// linkedin-detector.js
function detectPageType() {
  const url = window.location.href;
  const path = window.location.pathname;

  if (path.match(/^\/in\/[^/]+\/?$/)) return 'PROFILE';
  if (path.match(/^\/in\/[^/]+\/recent-activity/)) return 'ACTIVITY';
  if (path.includes('/search/results/people')) return 'SEARCH_PEOPLE';
  if (path.includes('/search/results/content')) return 'SEARCH_CONTENT';
  if (path.includes('/messaging')) return 'MESSAGES';
  if (path.match(/^\/company\/[^/]+\/?$/)) return 'COMPANY';
  if (path.includes('/mynetwork')) return 'NETWORK';
  if (path === '/feed/' || path === '/feed') return 'FEED';
  return 'OTHER';
}

const pageType = detectPageType();
chrome.runtime.sendMessage({
  type: 'PAGE_TYPE_DETECTED',
  pageType,
  url: window.location.href,
  timestamp: Date.now()
});
```

---

### 3.2 Ben Torres -- DOM Parsing & Content Script Specialist

#### 3.2.1 LinkedIn DOM Landscape

LinkedIn's front-end is a React-based single-page application (SPA) with several characteristics that affect DOM parsing:

1. **Obfuscated class names**: LinkedIn uses CSS module hashing (`artdeco-*`, `scaffold-*`, `pv-*`). Some classes are stable (e.g., `artdeco-card`), others change between deployments.
2. **Lazy loading**: Content below the fold loads only when scrolled into view. Search results, connections, and feed posts all use intersection observers.
3. **Client-side routing**: Navigation between pages does not trigger full page reloads. URL changes happen via `history.pushState()`.
4. **Shadow DOM**: LinkedIn does not heavily use Shadow DOM, but some components use it for encapsulation.
5. **Accessibility attributes**: LinkedIn generally follows ARIA patterns. `aria-hidden="true"` spans contain display text (the visible duplicate of screen-reader text). `section` elements often have `id` attributes (`#about`, `#experience`, `#education`, `#skills`).

#### 3.2.2 Page Type Extractors

##### Profile Page Extractor

Replicates V1's `extractProfileData()` but runs as a content script in the user's own browsing context:

```javascript
// profile-extractor.js
function extractProfileData() {
  // === Name ===
  const nameEl = document.querySelector('h1.text-heading-xlarge')
    || document.querySelector('h1');
  const name = nameEl?.textContent?.trim() || '';

  // === Headline ===
  const headlineEl = document.querySelector('.text-body-medium.break-words')
    || document.querySelector('[data-generated-suggestion-target]');
  const headline = headlineEl?.textContent?.trim() || '';

  // === Location ===
  const locationEl = document.querySelector(
    '.text-body-small.inline.t-black--light.break-words'
  );
  const location = locationEl?.textContent?.trim() || '';

  // === About Section ===
  const aboutSection = document.querySelector('#about')?.closest('section');
  const aboutText = aboutSection
    ? aboutSection.querySelector('.inline-show-more-text')?.textContent?.trim()
      || aboutSection.innerText.substring(0, 500)
    : '';

  // === Experience ===
  const experiences = [];
  const expSection = document.querySelector('#experience')?.closest('section');
  if (expSection) {
    const expItems = expSection.querySelectorAll(':scope > div > ul > li');
    expItems.forEach(item => {
      const spans = item.querySelectorAll('span[aria-hidden="true"]');
      const role = spans[0]?.textContent?.trim() || '';
      const company = spans[1]?.textContent?.trim() || '';
      const duration = spans[2]?.textContent?.trim() || '';
      if (role) experiences.push({ role, company, duration });
    });
  }

  // === Education ===
  const education = [];
  const eduSection = document.querySelector('#education')?.closest('section');
  if (eduSection) {
    const eduItems = eduSection.querySelectorAll(':scope > div > ul > li');
    eduItems.forEach(item => {
      const spans = item.querySelectorAll('span[aria-hidden="true"]');
      const school = spans[0]?.textContent?.trim() || '';
      const degree = spans[1]?.textContent?.trim() || '';
      if (school) education.push({ school, degree });
    });
  }

  // === Skills ===
  const skills = [];
  const skillsSection = document.querySelector('#skills')?.closest('section');
  if (skillsSection) {
    skillsSection.querySelectorAll('span[aria-hidden="true"]').forEach(span => {
      const text = span.textContent?.trim();
      if (text && text.length < 60 && !text.includes('\n')) {
        skills.push(text);
      }
    });
  }

  // === Connections / Followers ===
  const connectionsEl = [...document.querySelectorAll('span')].find(el =>
    el.textContent.includes('connections') || el.textContent.includes('followers')
  );
  const connections = connectionsEl?.textContent?.trim() || '';

  // === Mutual Connections ===
  const mutualEl = document.querySelector('[class*="mutual-connections"]')
    || [...document.querySelectorAll('span')].find(el =>
      el.textContent.includes('mutual connection')
    );
  const mutualConnections = mutualEl?.textContent?.trim() || '';

  // === Profile URL (canonical) ===
  const canonicalLink = document.querySelector('link[rel="canonical"]');
  const profileUrl = canonicalLink?.href
    || window.location.href.split('?')[0];

  return {
    pageType: 'PROFILE',
    name,
    headline,
    location,
    about: aboutText,
    experiences,
    education,
    skills,
    connections,
    mutualConnections,
    profileUrl,
    capturedAt: new Date().toISOString(),
    capturedFields: Object.entries({
      name, headline, location, about: aboutText,
      experiences: experiences.length, education: education.length,
      skills: skills.length, connections
    }).filter(([, v]) => v && (typeof v === 'string' ? v.length > 0 : v > 0))
      .map(([k]) => k)
  };
}
```

**Improvement over V1**: The extension captures full experience history, education, and skills -- V1's `enrich.mjs` only captured the first experience entry (current role/company). The extension also captures the canonical profile URL from the `<link>` tag, which is more reliable than URL parsing.

##### Search Results Extractor

Replicates V1's `extractSearchResults()` logic but with improvements:

```javascript
// search-extractor.js
function extractSearchResults() {
  const results = [];
  const cards = document.querySelectorAll('.reusable-search__result-container');

  cards.forEach(card => {
    const link = card.querySelector('a[href*="/in/"]');
    if (!link) return;

    const profileUrl = link.href.split('?')[0];
    const nameSpan = link.querySelector('span[aria-hidden="true"]');
    const name = nameSpan?.textContent?.trim() || '';
    if (!name || name === 'LinkedIn Member') return;

    // Title is typically in a secondary text element
    const titleEl = card.querySelector('.entity-result__primary-subtitle');
    const title = titleEl?.textContent?.trim() || '';

    // Location in tertiary
    const locationEl = card.querySelector('.entity-result__secondary-subtitle');
    const location = locationEl?.textContent?.trim() || '';

    // Connection degree badge
    const degreeEl = card.querySelector('.entity-result__badge-text span[aria-hidden="true"]');
    const degree = degreeEl?.textContent?.trim() || '';

    // Mutual connections
    const mutualEl = card.querySelector('.entity-result__simple-insight');
    const mutualText = mutualEl?.textContent?.trim() || '';
    const mutualMatch = mutualText.match(/(\d+)\s+(?:other\s+)?mutual\s+connection/);
    const mutualCount = mutualMatch ? parseInt(mutualMatch[1]) : 0;

    // Current/Past snippets
    const summaryEl = card.querySelector('.entity-result__summary');
    const summaryText = summaryEl?.textContent?.trim() || '';
    const currentMatch = summaryText.match(/Current:\s*(.+?)(?:\n|Past:|$)/);
    const pastMatch = summaryText.match(/Past:\s*(.+?)(?:\n|$)/);

    results.push({
      name,
      title,
      location,
      profileUrl,
      degree,
      mutualConnections: mutualCount,
      currentInfo: currentMatch ? currentMatch[1].trim() : '',
      pastInfo: pastMatch ? pastMatch[1].trim() : '',
    });
  });

  // Capture search metadata
  const resultsCountEl = document.querySelector('.search-results-container h2');
  const totalResults = resultsCountEl?.textContent?.trim() || '';

  // Capture current page number
  const activePageEl = document.querySelector(
    '.artdeco-pagination__indicator--number.active'
  );
  const currentPage = activePageEl?.textContent?.trim() || '1';

  // Check if more pages exist
  const nextButton = document.querySelector('button[aria-label="Next"]');
  const hasNextPage = nextButton && !nextButton.disabled;

  return {
    pageType: 'SEARCH_RESULTS',
    results,
    totalResults,
    currentPage: parseInt(currentPage),
    hasNextPage,
    searchUrl: window.location.href,
    capturedAt: new Date().toISOString()
  };
}
```

##### Feed/Activity Extractor

Captures posts visible in the user's feed or on a profile's activity page:

```javascript
// feed-extractor.js
function extractFeedPosts() {
  const posts = [];
  const feedItems = document.querySelectorAll(
    '.feed-shared-update-v2, .profile-creator-shared-feed-update__container'
  );

  feedItems.forEach(item => {
    // Author info
    const authorLink = item.querySelector('a[href*="/in/"]');
    const authorUrl = authorLink?.href?.split('?')[0] || '';
    const authorName = authorLink?.querySelector('span[aria-hidden="true"]')
      ?.textContent?.trim() || '';

    // Post text
    const textEl = item.querySelector(
      '.feed-shared-text, .update-components-text'
    );
    const text = textEl?.textContent?.trim() || '';

    // Timestamp
    const timeEl = item.querySelector('time');
    const date = timeEl?.getAttribute('datetime') || '';
    const relativeTime = timeEl?.textContent?.trim() || '';

    // Engagement metrics
    const likesEl = item.querySelector(
      '.social-details-social-counts__reactions-count'
    );
    const likes = parseInt(
      likesEl?.textContent?.replace(/[^\d]/g, '') || '0', 10
    );

    const commentsEl = item.querySelector(
      '[data-test-social-action="comments"],' +
      '.social-details-social-counts__comments'
    );
    const commentsText = commentsEl?.textContent || '';
    const comments = parseInt(commentsText.match(/\d+/)?.[0] || '0', 10);

    const sharesEl = item.querySelector(
      '.social-details-social-counts__shares'
    );
    const shares = parseInt(
      sharesEl?.textContent?.match(/\d+/)?.[0] || '0', 10
    );

    // Post type detection
    let postType = 'post';
    if (item.querySelector('.feed-shared-article')) postType = 'article';
    else if (item.querySelector('.update-components-reshare')) {
      postType = item.querySelector('.feed-shared-text')
        ? 'repost-commentary' : 'repost';
    }
    else if (item.querySelector('.feed-shared-poll')) postType = 'poll';

    // Hashtags
    const hashtags = [...item.querySelectorAll('a[href*="/feed/hashtag/"]')]
      .map(a => a.textContent?.trim())
      .filter(Boolean);

    if (text || authorName) {
      posts.push({
        authorName,
        authorUrl,
        text: text.substring(0, 1000),
        date,
        relativeTime,
        postType,
        engagement: { likes, comments, shares },
        hashtags,
      });
    }
  });

  return {
    pageType: 'FEED',
    posts,
    isActivityPage: window.location.pathname.includes('/recent-activity'),
    profileUrl: window.location.pathname.includes('/recent-activity')
      ? window.location.pathname.replace(/\/recent-activity.*/, '')
      : null,
    capturedAt: new Date().toISOString()
  };
}
```

##### Connections List Extractor

Mirrors V1's `deep-scan.mjs` `extractConnections()` but without automated scrolling/pagination:

```javascript
// connections-extractor.js
function extractConnectionsList() {
  // Reuse the search results extraction logic, as LinkedIn renders
  // connections in the same search results format
  const results = [];
  const profileLinks = document.querySelectorAll('a[href*="/in/"]');
  const seen = new Set();

  profileLinks.forEach(link => {
    const href = link.href.split('?')[0];
    if (seen.has(href)) return;
    seen.add(href);

    let container = link;
    for (let i = 0; i < 8; i++) {
      if (container.parentElement) container = container.parentElement;
    }

    const nameSpan = link.querySelector('span[aria-hidden="true"]');
    const name = nameSpan?.textContent?.trim() || '';
    if (!name || name.length < 2 || name === 'LinkedIn Member') return;

    const containerText = container.innerText || '';

    const degreeMatch = containerText.match(/\b(1st|2nd|3rd)\b/);
    const degree = degreeMatch ? degreeMatch[1] : null;

    const mutualMatch = containerText.match(
      /(\d+)\s+(?:other\s+)?mutual\s+connection/
    );
    const mutualCount = mutualMatch ? parseInt(mutualMatch[1]) : 0;

    // Extract title and location using line parsing (same as V1)
    const lines = containerText.split('\n')
      .map(l => l.trim()).filter(l => l.length > 0);
    let nameIdx = lines.findIndex(l => l.includes(name));
    if (nameIdx === -1) nameIdx = 0;

    let title = '';
    let location = '';

    for (let i = nameIdx + 1; i < Math.min(nameIdx + 6, lines.length); i++) {
      const line = lines[i];
      if (line.match(/^(1st|2nd|3rd)$/)) continue;
      if (['Message', 'Connect', 'Follow'].includes(line)) break;
      if (line.startsWith('Skills:')) break;
      if (line.includes('mutual connection') || line.includes('followers')) break;

      if (!title && line !== name) {
        title = line;
      } else if (title && !location) {
        if (line.includes(',') || line.match(/\b(Area|Metro|Region|Greater)\b/)) {
          location = line;
          break;
        }
      }
    }

    results.push({
      name,
      title: title.substring(0, 200),
      location,
      profileUrl: href,
      linkedinDegree: degree,
      mutualConnections: mutualCount,
    });
  });

  // Determine whose connections these are from the URL
  const urlParams = new URLSearchParams(window.location.search);
  const connectionOfParam = urlParams.get('connectionOf');

  return {
    pageType: 'CONNECTIONS_LIST',
    connections: results,
    connectionOf: connectionOfParam || null,
    searchUrl: window.location.href,
    hasNextPage: !!document.querySelector(
      'button[aria-label="Next"]:not([disabled])'
    ),
    capturedAt: new Date().toISOString()
  };
}
```

#### 3.2.3 Handling LinkedIn's SPA Routing

LinkedIn uses client-side routing, so the traditional `content_scripts` `matches` pattern fires only on full page loads. To detect in-app navigation:

```javascript
// linkedin-detector.js (addition)
let lastUrl = window.location.href;

// Detect SPA navigation via URL changes
const urlObserver = new MutationObserver(() => {
  const currentUrl = window.location.href;
  if (currentUrl !== lastUrl) {
    lastUrl = currentUrl;
    // Wait for DOM to settle after SPA navigation
    setTimeout(() => {
      const pageType = detectPageType();
      chrome.runtime.sendMessage({
        type: 'PAGE_TYPE_DETECTED',
        pageType,
        url: currentUrl,
        timestamp: Date.now(),
        navigationType: 'SPA'
      });
    }, 1500);
  }
});

urlObserver.observe(document.body, {
  childList: true,
  subtree: true
});

// Also listen for popstate (back/forward navigation)
window.addEventListener('popstate', () => {
  setTimeout(() => {
    const pageType = detectPageType();
    chrome.runtime.sendMessage({
      type: 'PAGE_TYPE_DETECTED',
      pageType,
      url: window.location.href,
      timestamp: Date.now(),
      navigationType: 'POPSTATE'
    });
  }, 1500);
});
```

#### 3.2.4 Dealing with Lazy-Loaded Content

Unlike V1, the extension cannot programmatically scroll. Strategies:

1. **Capture what is visible**: Extract all currently rendered DOM elements. Include a `scrollPosition` and `viewportCoverage` field so the app knows how much of the page was captured.

2. **Incremental capture**: If the user scrolls and triggers new content, the content script can detect new nodes via MutationObserver and send incremental updates:

```javascript
const feedObserver = new MutationObserver((mutations) => {
  for (const mutation of mutations) {
    for (const node of mutation.addedNodes) {
      if (node.nodeType === Node.ELEMENT_NODE &&
          node.matches?.('.feed-shared-update-v2, .reusable-search__result-container')) {
        // New content appeared -- queue incremental capture
        debouncedIncrementalCapture();
      }
    }
  }
});

feedObserver.observe(document.querySelector('main') || document.body, {
  childList: true,
  subtree: true
});
```

3. **Scroll depth indicator**: The popup/sidepanel shows the user how much of the page has been captured and suggests scrolling further if more results are expected.

#### 3.2.5 Selector Resilience Strategy

LinkedIn changes DOM structure periodically. To handle this:

1. **Multi-selector fallback chains**: Each field has 3-5 selector alternatives, tried in order (already demonstrated in the extractors above).
2. **Semantic selectors first**: Prefer ARIA attributes (`aria-label`, `role`), `data-*` attributes, and HTML5 semantic elements over class names.
3. **Heuristic text parsing**: Fall back to text-content-based extraction when CSS selectors fail (the V1 line-parsing approach).
4. **Remote selector updates**: The app can push updated selector configurations to the extension via `chrome.storage.sync` or the localhost API, without requiring an extension update.
5. **Extraction confidence scores**: Each extracted field reports a confidence level (high = semantic selector matched, medium = fallback selector, low = heuristic parsing). The app can flag low-confidence data for user review.

---

### 3.3 Dr. Lisa Wang -- Extension-to-App Communication

#### 3.3.1 Communication Architecture Options

Three viable patterns for extension-to-local-app communication:

| Method | Latency | Reliability | Bidirectional | Complexity |
|--------|---------|-------------|---------------|------------|
| **Localhost HTTP** | ~5ms | High | Request/Response | Low |
| **WebSocket** | ~1ms | High | Full duplex | Medium |
| **Native Messaging** | ~10ms | High | Message-based | High |
| **Clipboard Bridge** | N/A | User-dependent | One-way | Very Low |

#### 3.3.2 Recommended: Hybrid Localhost HTTP + WebSocket

**Primary channel: Localhost HTTP (`http://localhost:3000/api/extension/*`)**

Used for:
- Sending captured page data to the app
- Fetching task lists
- Fetching message templates
- Configuration sync

```javascript
// shared/app-client.js
class AppClient {
  constructor(baseUrl = 'http://localhost:3000') {
    this.baseUrl = baseUrl;
    this.apiBase = `${baseUrl}/api/extension`;
  }

  async sendCapture(data) {
    const response = await fetch(`${this.apiBase}/capture`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Extension-Token': await this.getToken()
      },
      body: JSON.stringify(data)
    });
    if (!response.ok) throw new Error(`App returned ${response.status}`);
    return response.json();
  }

  async getTaskList() {
    const response = await fetch(`${this.apiBase}/tasks`, {
      headers: { 'X-Extension-Token': await this.getToken() }
    });
    return response.json();
  }

  async getMessageTemplate(contactId, templateType) {
    const response = await fetch(
      `${this.apiBase}/templates/${templateType}?contact=${contactId}`,
      { headers: { 'X-Extension-Token': await this.getToken() } }
    );
    return response.json();
  }

  async getToken() {
    const { extensionToken } = await chrome.storage.local.get('extensionToken');
    return extensionToken || '';
  }

  async checkConnection() {
    try {
      const response = await fetch(`${this.apiBase}/health`, {
        signal: AbortSignal.timeout(3000)
      });
      return response.ok;
    } catch {
      return false;
    }
  }
}
```

**Secondary channel: WebSocket (for real-time push from app to extension)**

Used for:
- Task list updates pushed from the app
- Claude agent suggestions arriving asynchronously
- Real-time notifications (e.g., "enrichment complete for contact X")
- Goal progress updates

```javascript
// shared/app-client.js (WebSocket addition)
class AppWebSocket {
  constructor(url = 'ws://localhost:3000/ws/extension') {
    this.url = url;
    this.ws = null;
    this.reconnectInterval = 5000;
    this.handlers = new Map();
  }

  connect() {
    this.ws = new WebSocket(this.url);

    this.ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      const handler = this.handlers.get(message.type);
      if (handler) handler(message.data);
    };

    this.ws.onclose = () => {
      setTimeout(() => this.connect(), this.reconnectInterval);
    };

    this.ws.onerror = () => {
      this.ws.close();
    };
  }

  on(type, handler) {
    this.handlers.set(type, handler);
  }
}
```

#### 3.3.3 Clipboard Bridge

For message templates, the clipboard is the primary delivery mechanism (per V2 requirements):

```javascript
// Content script or popup context
async function copyTemplateToClipboard(templateText) {
  try {
    await navigator.clipboard.writeText(templateText);
    return { success: true };
  } catch (err) {
    // Fallback for content script context where clipboard API may not work
    const textarea = document.createElement('textarea');
    textarea.value = templateText;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
    return { success: true, fallback: true };
  }
}
```

The extension popup or sidepanel shows message templates for the current contact. User clicks "Copy" and pastes into LinkedIn's message compose box manually.

#### 3.3.4 API Endpoint Design (Next.js App Side)

The local Next.js app exposes these endpoints for the extension:

```
POST   /api/extension/capture          # Receive captured page data
GET    /api/extension/tasks            # Get current task list
PATCH  /api/extension/tasks/:id        # Mark task complete/skipped
GET    /api/extension/templates/:type  # Get message template for contact
GET    /api/extension/health           # Connection health check
POST   /api/extension/register         # Initial extension registration
GET    /api/extension/goals            # Get current exploration goals
GET    /api/extension/guidance/:url    # Get guidance for specific profile/page
WS     /ws/extension                   # WebSocket for real-time push
```

#### 3.3.5 Data Flow: Capture to Storage

```
User visits LinkedIn profile
         |
         v
Content Script (linkedin-detector.js) detects page type = PROFILE
         |
         v
Service Worker injects profile-extractor.js
         |
         v
profile-extractor.js reads DOM, produces structured data
         |
         v
Content Script sends data to Service Worker via chrome.runtime.sendMessage
         |
         v
Service Worker:
  1. Saves to chrome.storage.local (offline buffer)
  2. Sends to localhost:3000/api/extension/capture via HTTP POST
  3. Receives response with:
     - Enrichment status for this contact
     - Next suggested action
     - Updated badge count
         |
         v
Service Worker updates badge/popup state
         |
         v
App processes data:
  1. Stores in database
  2. Triggers Claude agent analysis
  3. Updates task list
  4. Pushes updates via WebSocket
```

#### 3.3.6 Offline / App-Down Handling

When the local app is not running:

1. **Buffer in chrome.storage.local**: Queue captured data with timestamps. Maximum 5MB limit for `chrome.storage.local` -- enough for hundreds of captures.
2. **Visual indicator**: Badge turns grey, popup shows "App offline -- data queued".
3. **Auto-sync on reconnect**: Service worker periodically checks health endpoint. When app comes online, flushes the buffer.
4. **Export fallback**: User can export buffered data as JSON from the popup.

---

### 3.4 Omar Khalil -- LinkedIn ToS Compliance Analysis

#### 3.4.1 LinkedIn Terms of Service: Key Provisions

LinkedIn's User Agreement (Section 8 "DOs and DON'Ts") and Professional Community Policies establish clear boundaries:

**Explicitly Prohibited:**
- Scraping, crawling, or using bots to access LinkedIn
- Automated access to LinkedIn services
- Using scripts to send messages or connection requests
- Creating or operating a third-party application that accesses LinkedIn data without authorization
- Circumventing rate limits or access controls

**What the V2 Extension Does NOT Do (Compliant Design):**
- Does NOT automatically navigate to pages
- Does NOT programmatically scroll
- Does NOT click buttons, send messages, or make connection requests
- Does NOT run in the background when the user is not on LinkedIn
- Does NOT intercept or modify LinkedIn's API calls
- Does NOT access LinkedIn's internal APIs
- Does NOT store LinkedIn data on any external server

#### 3.4.2 Compliance Analysis of Each Function

| Function | Action | Compliant? | Rationale |
|----------|--------|------------|-----------|
| **Page detection** | Reads URL of page user is viewing | Yes | No different from a password manager or accessibility tool reading the URL |
| **DOM reading** | Reads visible DOM of current page | Cautious Yes | Reads only what the user can see; equivalent to "view source" |
| **Data extraction** | Structures visible data into JSON | Cautious Yes | Organizing visible information the user chose to view |
| **Send to local app** | HTTP POST to localhost | Yes | Data stays on user's machine; no external server |
| **Clipboard copy** | Copies message template text | Yes | User manually pastes; no automated messaging |
| **Task list display** | Shows to-do items in extension UI | Yes | UI only; no LinkedIn interaction |
| **MutationObserver** | Detects new DOM nodes | Cautious Yes | Passive observation of content the user scrolls into view |

#### 3.4.3 Risk Zones and Mitigations

**Risk 1: Volume-based detection**
- LinkedIn monitors for unusual patterns in profile viewing behavior.
- **Mitigation**: The extension tracks capture counts per session and per day. After a configurable threshold (e.g., 30 profiles/day), it shows a warning: "You have viewed many profiles today. Consider pausing to avoid LinkedIn flagging your account."
- The app's task list is designed to spread exploration over multiple sessions.

**Risk 2: Chrome Web Store policy on LinkedIn extensions**
- Google has removed LinkedIn scraping extensions from the Chrome Web Store.
- **Mitigation**: Position as a "personal productivity tool" that helps users organize information from pages they manually visit. No automated access. No data exfiltration to external servers.
- If Chrome Web Store listing is rejected, sideloading via developer mode is viable for a small user base.

**Risk 3: Data storage and GDPR**
- Storing other people's LinkedIn profile data locally has GDPR implications if the user is in the EU.
- **Mitigation**: All data stays local. The app should include a data retention policy, purge functionality, and never transmit personal data to external services without explicit consent.

**Risk 4: LinkedIn API Terms vs. DOM reading**
- LinkedIn's API terms forbid unauthorized API access, but DOM reading of rendered pages is a grey area.
- **Mitigation**: The extension reads only what LinkedIn has already rendered for the user. It does not intercept XHR/fetch calls, does not access Voyager API endpoints, and does not modify LinkedIn's behavior.

#### 3.4.4 Recommended Compliance Safeguards

1. **No background automation**: Content scripts only activate when the user is on a LinkedIn tab and the extension popup/sidepanel is open or the user clicks "Capture."
2. **User-initiated capture**: Require an explicit user action (click a button) before extracting data. Do not auto-capture on every page visit.
3. **Rate awareness**: Track profiles viewed per day, show warnings at thresholds.
4. **No message sending**: Never interact with LinkedIn's message compose, connection request, or any action buttons.
5. **Transparency**: Show the user exactly what data was captured and where it was sent (localhost only).
6. **Data minimization**: Capture only the fields needed for the graph. Do not save full page HTML unless the user explicitly opts in.
7. **Opt-in enrichment**: When the user views a profile, the extension shows a "Capture this profile" button. It does not silently record every page visit.

#### 3.4.5 Chrome Web Store Guidelines

If publishing to the Chrome Web Store:

- Must have a privacy policy URL
- Must justify `host_permissions` for `linkedin.com` and `localhost`
- Must not use `<all_urls>` or broad host permissions
- Must explain data collection in the listing description
- Cannot claim affiliation with LinkedIn
- Must comply with Google's "limited use" policy for user data

---

### 3.5 Sophie Dubois -- Extension UX / Popup Design

#### 3.5.1 UX Design Principles

1. **User is always in control**: Every data capture requires explicit action.
2. **Minimal interruption**: Do not overlay LinkedIn's UI or interfere with normal browsing.
3. **Context-aware**: Show relevant information based on the page type the user is viewing.
4. **Task-driven**: Guide the user through their exploration tasks without being prescriptive.
5. **Status transparency**: Always show connection status to the local app, capture queue, and session stats.

#### 3.5.2 Extension UI Components

##### Popup (Click on Extension Icon)

The popup serves as a quick-access dashboard. It opens when the user clicks the extension icon in the toolbar.

```
+-----------------------------------------------+
|  LinkedIn Network Intelligence          [gear] |
+-----------------------------------------------+
|  Status: Connected to App              [green] |
|  Session: 12 profiles captured today           |
+-----------------------------------------------+
|                                                 |
|  CURRENT PAGE: Profile                          |
|  John Smith - VP Engineering at Acme Corp       |
|  [  Capture This Profile  ]                     |
|  [  View in App  ]                              |
|                                                 |
+-----------------------------------------------+
|                                                 |
|  TASKS (3 remaining)                            |
|  [ ] Visit Sarah Chen's profile                 |
|  [ ] Review "AI automation" search results      |
|  [ ] Check mutual connections with Tom Lee       |
|                                                 |
+-----------------------------------------------+
|                                                 |
|  MESSAGES                                       |
|  Template ready for John Smith                  |
|  [  Copy to Clipboard  ]                        |
|                                                 |
+-----------------------------------------------+
|                                                 |
|  [Open Side Panel]  [View in App]               |
+-----------------------------------------------+
```

##### Side Panel (Chrome 114+ feature)

The side panel provides a persistent workspace alongside LinkedIn. It offers more detail than the popup without obscuring LinkedIn content.

```
+--------------------------------------------------+
|  NETWORK INTELLIGENCE                     [close] |
+--------------------------------------------------+
|  GOALS                                            |
|  1. Map AI decision-makers at target companies    |
|     Progress: 12/30 profiles captured             |
|     [=======>                        ] 40%        |
|                                                   |
|  2. Identify warm intro paths to 5 VPs            |
|     Progress: 2/5 paths found                     |
|     [===>                            ] 40%        |
+--------------------------------------------------+
|  TODAY'S TASKS                              [all] |
|                                                   |
|  Priority: High                                   |
|  [x] Capture Jane Doe's profile (VP Eng, Acme)   |
|  [ ] Review Jane's recent posts for AI mentions   |
|  [ ] Check connections shared with Jane           |
|                                                   |
|  Priority: Medium                                 |
|  [ ] Search "machine learning engineer" in Bay    |
|  [ ] Visit CompanyX company page                  |
|  [ ] Review saved search results (15 uncaptured)  |
|                                                   |
+--------------------------------------------------+
|  CURRENT PAGE CONTEXT                             |
|                                                   |
|  Page: Profile - John Smith                       |
|  Status: Already captured (2 days ago)            |
|  ICP Match: 78% (Gold tier candidate)             |
|  Missing: Activity data, Skills                   |
|                                                   |
|  [  Re-capture  ]  [  View in App  ]              |
|                                                   |
|  Suggested Actions:                               |
|  > Visit activity page to capture recent posts    |
|  > Check connections (12 mutual found)            |
|                                                   |
+--------------------------------------------------+
|  MESSAGE TEMPLATES                                |
|                                                   |
|  For: John Smith                                  |
|  Type: Initial Outreach                           |
|  +----------------------------------------------+|
|  | Hi John, I noticed your work on AI            ||
|  | automation at Acme Corp. I'm exploring...     ||
|  +----------------------------------------------+|
|  [  Copy to Clipboard  ]  [  Next Template  ]    |
|                                                   |
+--------------------------------------------------+
|  QUICK STATS                                      |
|  Profiles: 142  |  Captured today: 8             |
|  Tasks done: 5   |  Queue: 3 pending              |
+--------------------------------------------------+
```

#### 3.5.3 Badge Notifications

The extension icon badge communicates state at a glance:

| Badge | Meaning |
|-------|---------|
| Green dot (no number) | App connected, on a LinkedIn page, ready to capture |
| Blue number (e.g., "3") | Number of remaining tasks for the current LinkedIn session |
| Orange "!" | App is offline; captures are being queued locally |
| Grey dot | Not on a LinkedIn page; extension idle |
| Red number | Queued captures waiting to sync (app was offline) |

#### 3.5.4 Capture Workflow UX

**Automatic page detection + manual capture trigger:**

1. User navigates to a LinkedIn profile.
2. Extension detects page type (content script runs automatically).
3. Badge updates to green with a subtle animation.
4. Popup shows "Capture This Profile" button with a preview of what will be captured.
5. User clicks "Capture This Profile."
6. Extension extracts data, sends to app.
7. Badge briefly shows a checkmark animation.
8. Popup updates: "Captured! John Smith added to your network graph."
9. If tasks were associated with this profile, they are marked complete.

**Alternative: Auto-capture mode (opt-in)**

For power users who want to capture every profile they visit:
- Toggle in settings: "Auto-capture profiles I visit"
- When enabled, the content script sends data automatically on page load
- Badge shows running count
- Still requires the user to manually navigate (no automation)

#### 3.5.5 Clipboard Workflow for Messages

1. User is on a LinkedIn profile or in messaging.
2. User opens the side panel or popup.
3. Extension shows personalized message template (fetched from app, populated by Claude agent).
4. User clicks "Copy to Clipboard."
5. Green confirmation toast: "Message copied! Paste it in the compose box."
6. User manually pastes into LinkedIn's message composer.
7. User manually clicks Send in LinkedIn.

The extension never interacts with LinkedIn's message composer DOM.

#### 3.5.6 Task List Interaction

Tasks are created by the app (driven by Claude agent analysis) and displayed in the extension:

- Tasks are grouped by priority (High / Medium / Low).
- Each task is a plain-language instruction: "Visit Sarah Chen's profile" or "Search for 'AI platform engineer' in San Francisco."
- Clicking a task does NOT auto-navigate. Instead, it copies the URL or search query to the clipboard, or shows the URL for the user to click.
- Completing a task (checkbox) sends a PATCH to the app.
- Tasks can include context: "Sarah is a 2nd-degree connection. She posted about AI agents last week."

---

### 3.6 Dr. Kevin Park -- Security & Privacy in Browser Extensions

#### 3.6.1 Threat Model

| Threat | Vector | Impact | Mitigation |
|--------|--------|--------|------------|
| **XSS in content scripts** | Injecting user-controlled data into extension UI | Data exfiltration, credential theft | Sanitize all DOM-extracted text; never use `innerHTML` with extracted data |
| **Extension token theft** | Malicious page reading chrome.storage | Unauthorized app access | Use `chrome.storage.session` for tokens; regenerate on each session |
| **Man-in-the-middle on localhost** | Network sniffing on loopback | Data interception | Use HTTPS for localhost with self-signed cert, or validate origin headers |
| **Malicious extension update** | Compromised extension package | Full LinkedIn data access | Pin dependency versions; use CSP; code review all updates |
| **LinkedIn DOM injection** | LinkedIn page contains malicious content in user posts | Content script XSS | Treat all DOM content as untrusted; sanitize before processing |
| **Cross-extension attack** | Other installed extensions reading our data | Data leakage | Minimize stored data; encrypt sensitive fields |

#### 3.6.2 Content Security Policy

The manifest's CSP prevents inline scripts and remote code loading:

```json
{
  "content_security_policy": {
    "extension_pages": "script-src 'self'; object-src 'self'; connect-src 'self' http://localhost:3000 ws://localhost:3000"
  }
}
```

Content scripts inherit the host page's CSP but run in an isolated world. They can access the DOM but not the page's JavaScript variables (and vice versa).

#### 3.6.3 Permissions Model: Principle of Least Privilege

```json
{
  "permissions": [
    "activeTab",       // Only access the active tab when user interacts
    "storage",         // For local data buffering
    "clipboardWrite",  // For message template copying
    "sidePanel"        // For the side panel UI
  ],
  "host_permissions": [
    "https://www.linkedin.com/*",  // Content scripts on LinkedIn
    "http://localhost:3000/*"       // Communication with local app
  ]
}
```

Permissions NOT requested (and why):
- `tabs`: Not needed; `activeTab` is sufficient for the current tab.
- `webRequest` / `declarativeNetRequest`: We do not modify or intercept network requests.
- `cookies`: We do not read or modify cookies.
- `history`: We do not access browsing history.
- `<all_urls>`: We only need LinkedIn and localhost.
- `clipboardRead`: We only write to clipboard, never read.
- `nativeMessaging`: Not used in the recommended architecture.

#### 3.6.4 Data Sanitization

All data extracted from the DOM must be sanitized before:
1. Displaying in extension UI (popup, sidepanel)
2. Sending to the local app
3. Storing in `chrome.storage`

```javascript
// shared/sanitize.js
function sanitizeText(text) {
  if (typeof text !== 'string') return '';
  return text
    .replace(/[<>]/g, '')          // Strip HTML angle brackets
    .replace(/javascript:/gi, '')  // Remove javascript: URIs
    .replace(/on\w+\s*=/gi, '')    // Remove event handlers
    .trim()
    .substring(0, 2000);           // Length limit
}

function sanitizeUrl(url) {
  if (typeof url !== 'string') return '';
  try {
    const parsed = new URL(url);
    if (!['https:', 'http:'].includes(parsed.protocol)) return '';
    if (!parsed.hostname.endsWith('linkedin.com')) return '';
    return parsed.href;
  } catch {
    return '';
  }
}

function sanitizeExtractedData(data) {
  const clean = {};
  for (const [key, value] of Object.entries(data)) {
    if (typeof value === 'string') {
      clean[key] = key.toLowerCase().includes('url')
        ? sanitizeUrl(value)
        : sanitizeText(value);
    } else if (Array.isArray(value)) {
      clean[key] = value.map(item =>
        typeof item === 'string' ? sanitizeText(item) :
        typeof item === 'object' ? sanitizeExtractedData(item) : item
      );
    } else if (typeof value === 'object' && value !== null) {
      clean[key] = sanitizeExtractedData(value);
    } else {
      clean[key] = value;
    }
  }
  return clean;
}
```

#### 3.6.5 Extension-to-App Authentication

The extension and local app need mutual authentication to prevent:
- Random localhost requests from other applications reading/writing data
- A malicious page making requests to the app on behalf of the extension

Recommended approach:

1. **Initial registration**: When the extension is first installed, it opens `localhost:3000/extension/register`. The app generates a random token and stores it. The extension stores the token in `chrome.storage.local`.
2. **Request authentication**: Every HTTP request from the extension includes `X-Extension-Token: <token>`.
3. **Token rotation**: Token is regenerated periodically (e.g., weekly) or on demand from the app's settings.
4. **Origin validation**: The app's API routes check `Origin` header to verify requests come from the extension.

```javascript
// Next.js middleware for extension API routes
export function middleware(request) {
  if (request.nextUrl.pathname.startsWith('/api/extension/')) {
    const token = request.headers.get('X-Extension-Token');
    const origin = request.headers.get('Origin');

    // Allow extension origin (chrome-extension://<id>)
    if (!origin?.startsWith('chrome-extension://')) {
      return new Response('Forbidden', { status: 403 });
    }

    // Validate token
    if (!token || token !== process.env.EXTENSION_TOKEN) {
      return new Response('Unauthorized', { status: 401 });
    }
  }
}
```

#### 3.6.6 Data at Rest

- **chrome.storage.local**: Used for buffering captures when the app is offline. Data is encrypted at rest by Chrome (OS-level encryption on supported platforms). The extension should purge buffer after successful sync.
- **No sensitive data in storage**: Never store LinkedIn session cookies, passwords, or API keys in extension storage.
- **Retention policy**: Buffered captures older than 7 days should be auto-purged if they failed to sync.

---

## 4. Panel Consensus: Agreed-Upon Extension Architecture

After deliberation, the panel reaches consensus on the following architecture:

### 4.1 Architecture Summary

```
                    +-----------------------------------+
                    |         User's Chrome Browser      |
                    |                                    |
                    |  +-------------------------------+ |
                    |  |    LinkedIn Tab (linkedin.com) | |
                    |  |                                | |
                    |  |  [Content Script]              | |
                    |  |  - linkedin-detector.js        | |
                    |  |  - {page}-extractor.js         | |
                    |  |    (injected on demand)        | |
                    |  +-----------|-------------------+ |
                    |              | chrome.runtime      |
                    |              | .sendMessage()      |
                    |  +-----------|-------------------+ |
                    |  |  Service Worker               | |
                    |  |  - Message router             | |
                    |  |  - Storage manager            | |
                    |  |  - App client (HTTP + WS)     | |
                    |  |  - Badge/state manager        | |
                    |  +-----------|-------------------+ |
                    |              |                      |
                    |  +-----------|---------+           |
                    |  | Popup / Side Panel  |           |
                    |  | - Task list         |           |
                    |  | - Capture controls  |           |
                    |  | - Message templates |           |
                    |  | - Goals & progress  |           |
                    |  | - Session stats     |           |
                    |  +---------------------+           |
                    +-------------|---------------------+
                                  |
                    HTTP POST / WebSocket to localhost:3000
                                  |
                    +-------------|---------------------+
                    |      Next.js App (Local)           |
                    |                                    |
                    |  /api/extension/capture             |
                    |  /api/extension/tasks               |
                    |  /api/extension/templates           |
                    |  /api/extension/goals               |
                    |  /ws/extension (WebSocket)          |
                    |                                    |
                    |  Claude Agent (LLM analysis)       |
                    |  Graph Database                    |
                    |  Enrichment APIs (PDL, Apollo...)  |
                    +-----------------------------------+
```

### 4.2 Core Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| **Manifest version** | V3 | Required for Chrome Web Store; modern architecture |
| **Communication** | HTTP + WebSocket hybrid | HTTP for request/response; WS for real-time push |
| **Capture trigger** | User-initiated (with opt-in auto mode) | ToS compliance; user stays in control |
| **Content script injection** | On-demand via detector pattern | Minimal footprint; only load what is needed |
| **Data buffering** | chrome.storage.local | Handles app-offline scenarios; limited but sufficient |
| **Clipboard integration** | navigator.clipboard API with execCommand fallback | Message templates via clipboard per V2 spec |
| **UI paradigm** | Side panel (primary) + popup (quick access) | Side panel persists alongside LinkedIn; popup for quick actions |
| **Selector strategy** | Multi-selector chains with heuristic fallbacks | Resilient to LinkedIn DOM changes |
| **Authentication** | Token-based with origin validation | Simple, effective for local-only communication |
| **SPA navigation detection** | MutationObserver + popstate listener | Handles LinkedIn's client-side routing |

### 4.3 Data Model: Extension Capture Payload

Every capture sent to the app follows this schema:

```typescript
interface ExtensionCapture {
  // Metadata
  captureId: string;           // UUID generated by extension
  captureType: PageType;       // 'PROFILE' | 'SEARCH_RESULTS' | 'FEED' | 'CONNECTIONS_LIST' | 'COMPANY' | 'MESSAGES'
  capturedAt: string;          // ISO 8601 timestamp
  capturedUrl: string;         // The LinkedIn URL the user was viewing
  scrollDepth: number;         // 0-1 indicating how far the user scrolled
  extractionConfidence: number; // 0-1 overall extraction confidence

  // Page-type-specific payload (one of these will be populated)
  profile?: ProfileCapture;
  searchResults?: SearchResultsCapture;
  feed?: FeedCapture;
  connectionsList?: ConnectionsListCapture;
  company?: CompanyCapture;

  // Extension metadata
  extensionVersion: string;
  sessionId: string;           // Links captures from the same browsing session
}

interface ProfileCapture {
  name: string;
  headline: string;
  location: string;
  about: string;
  experiences: Array<{ role: string; company: string; duration: string }>;
  education: Array<{ school: string; degree: string }>;
  skills: string[];
  connections: string;
  mutualConnections: string;
  profileUrl: string;
}

interface SearchResultsCapture {
  results: Array<{
    name: string;
    title: string;
    location: string;
    profileUrl: string;
    degree: string;
    mutualConnections: number;
    currentInfo: string;
    pastInfo: string;
  }>;
  totalResults: string;
  currentPage: number;
  hasNextPage: boolean;
  searchUrl: string;
}

interface FeedCapture {
  posts: Array<{
    authorName: string;
    authorUrl: string;
    text: string;
    date: string;
    postType: string;
    engagement: { likes: number; comments: number; shares: number };
    hashtags: string[];
  }>;
  isActivityPage: boolean;
  profileUrl: string | null;
}

interface ConnectionsListCapture {
  connections: Array<{
    name: string;
    title: string;
    location: string;
    profileUrl: string;
    linkedinDegree: string;
    mutualConnections: number;
  }>;
  connectionOf: string | null;
  hasNextPage: boolean;
}
```

### 4.4 Implementation Phases

**Phase 1 -- Foundation (Weeks 1-3)**
- Manifest V3 project setup and build toolchain
- Page type detector content script
- Profile page extractor (replicates V1 enrich.mjs)
- Basic popup UI with "Capture" button
- Localhost HTTP communication with Next.js app
- Extension registration and token-based auth

**Phase 2 -- Full Extraction (Weeks 4-6)**
- Search results extractor
- Connections list extractor
- Feed/activity extractor
- Company page extractor
- MutationObserver for incremental captures
- SPA navigation detection

**Phase 3 -- Task & Template Integration (Weeks 7-9)**
- Side panel UI with task list
- Task completion workflow
- Message template display and clipboard copy
- Goal progress tracking
- WebSocket integration for real-time updates

**Phase 4 -- Polish & Compliance (Weeks 10-12)**
- Auto-capture opt-in mode
- Offline buffering and sync
- Rate awareness warnings
- Privacy policy and Chrome Web Store listing preparation
- Selector resilience testing and fallback chains
- Security audit

---

## 5. Questions for the Product Owner

The panel has identified the following questions that require product-level decisions:

### Q1: Communication Protocol Priority
**Should the extension communicate via WebSocket, localhost HTTP, or both?**
The panel recommends a hybrid (HTTP for request/response, WebSocket for push), but a simpler HTTP-only approach would reduce complexity. WebSocket is needed only if the app needs to push real-time updates to the extension (task changes, Claude agent suggestions). If polling every 30 seconds is acceptable, HTTP alone suffices.

### Q2: Data Storage Location
**Should the extension store any data locally (chrome.storage) or always push to the app immediately?**
Local storage is needed for offline buffering, but should the extension maintain its own cache of captured profiles? This helps show "already captured" badges, but duplicates data. The panel recommends minimal local storage (capture queue + session state only) with the app as the source of truth.

### Q3: Supported LinkedIn Page Types
**Which LinkedIn page types need to be supported at launch?**
The panel has designed extractors for: Profile, Search Results, Feed/Activity, Connections List, Company Page, and Messages. Should all be in Phase 1, or should we prioritize? The panel recommends Profile + Search Results for Phase 1, with others following in Phase 2.

### Q4: Claude Agent Location
**Should the extension have its own Claude agent instance, or relay all LLM interaction through the local app?**
Running Claude in the extension is not feasible (API keys would be exposed, and service workers have compute limits). The panel recommends all Claude interaction goes through the Next.js app, with results pushed to the extension. The extension is a data capture + display layer only.

### Q5: Distribution Method
**Will this be published to the Chrome Web Store or distributed as a sideloaded extension?**
Chrome Web Store provides auto-updates and credibility, but LinkedIn-related extensions face higher scrutiny and potential rejection. Sideloading requires developer mode and manual updates but avoids store policies. The panel recommends starting with sideloading for the initial user base, with Chrome Web Store as a future goal once compliance posture is proven.

### Q6: Capture Trigger Model
**Should capture be entirely manual (user clicks "Capture") or offer an opt-in auto-capture mode?**
The panel recommends manual capture as the default for ToS compliance, with an opt-in auto-capture toggle for power users who understand the implications. Auto-capture would still only fire on pages the user manually navigates to -- never automated navigation.

### Q7: Task Navigation Behavior
**When the user clicks a task in the extension, should it navigate them to the LinkedIn URL, copy the URL to clipboard, or just highlight the task?**
Auto-navigating could be seen as automated behavior. The panel recommends: (a) for profile tasks, show a clickable link the user can choose to open; (b) for search tasks, copy the search query to clipboard with instructions to paste into LinkedIn search.

### Q8: Message Template Personalization Source
**Should message templates be personalized by the Claude agent in the app, or should the extension do string interpolation from a template?**
The panel recommends Claude-powered personalization in the app. The extension fetches the fully rendered message from the app's API. This keeps the Claude API key in the app, enables richer personalization (using graph context), and keeps the extension thin.

### Q9: Offline Data Export Format
**When the app is offline and captures are queued, should the user be able to export them as JSON, CSV, or both?**
This affects the popup UI design. The panel recommends JSON (matches the app's internal format) with an optional CSV export for profiles.

### Q10: Multi-Profile Household / Account Support
**Should the extension support multiple LinkedIn accounts or multiple app instances?**
Some users may manage more than one LinkedIn presence (personal + company page admin). The panel needs to know if the extension should support switching between app contexts or if one extension instance maps to one app instance.

### Q11: Extension Settings Scope
**Where should extension settings live -- in the extension (chrome.storage.sync) or in the app?**
`chrome.storage.sync` persists across the user's Chrome installations. App-managed settings are centralized but require the app to be running. The panel recommends app-managed settings with a minimal local fallback (app URL, token).

### Q12: Selector Update Mechanism
**When LinkedIn changes their DOM structure, how quickly must selector updates be deployed?**
Options: (a) Extension update via Chrome Web Store (slow, 1-3 day review), (b) Sideloaded update (fast, manual), (c) Remote selector config fetched from the app on startup (fastest, no extension update needed). The panel recommends option (c) -- a selector configuration file served by the app and cached in the extension, allowing immediate updates without redeploying the extension.

---

*Panel 3 presentation complete. This document provides the architectural foundation for the Chrome extension stream of the V2 LinkedIn Network Intelligence tool.*
