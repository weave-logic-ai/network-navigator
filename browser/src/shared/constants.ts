// Shared constants for the extension

import type { PageUrlPattern, ExtensionSettings } from '../types';

export const EXTENSION_VERSION = '0.1.0';

export const DEFAULT_APP_URL = 'http://localhost:3000';

export const PAGE_URL_PATTERNS: PageUrlPattern[] = [
  {
    pageType: 'PROFILE',
    pattern: /linkedin\.com\/in\/[^/]+\/?$/,
    description: 'Profile page',
  },
  {
    pageType: 'PROFILE_ACTIVITY',
    pattern: /linkedin\.com\/in\/[^/]+\/recent-activity/,
    description: 'Profile activity',
  },
  {
    pageType: 'SEARCH_PEOPLE',
    pattern: /linkedin\.com\/search\/results\/people/,
    description: 'People search',
  },
  {
    pageType: 'SEARCH_CONTENT',
    pattern: /linkedin\.com\/search\/results\/content/,
    description: 'Content search',
  },
  {
    pageType: 'FEED',
    pattern: /linkedin\.com\/feed\/?$/,
    description: 'Feed page',
  },
  {
    pageType: 'COMPANY',
    pattern: /linkedin\.com\/company\/[^/]+\/?$/,
    description: 'Company page',
  },
  {
    pageType: 'CONNECTIONS',
    pattern: /linkedin\.com\/mynetwork\/invite-connect\/connections/,
    description: 'Connections list',
  },
  {
    pageType: 'MESSAGES',
    pattern: /linkedin\.com\/messaging/,
    description: 'Messages',
  },
];

export const DEFAULT_SETTINGS: ExtensionSettings = {
  autoCaptureEnabled: false,
  capturePageTypes: ['PROFILE', 'SEARCH_PEOPLE', 'COMPANY'],
  dailyCaptureWarningThreshold: 100,
  overlayPosition: 'bottom-right',
  overlayEnabled: true,
  healthCheckIntervalMs: 30000,
  captureStabilityDelayMs: 2000,
  maxQueueSize: 50,
};

export const WS_RECONNECT_INITIAL_MS = 5000;
export const WS_RECONNECT_MAX_MS = 60000;
export const WS_RECONNECT_MULTIPLIER = 2;

export const HEALTH_CHECK_ALARM = 'health-check';
export const QUEUE_FLUSH_ALARM = 'queue-flush';

export const CAPTURE_MAX_HTML_BYTES = 10 * 1024 * 1024; // 10MB
