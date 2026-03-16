// In-memory rate limiter for extension API endpoints
// Uses a simple sliding window counter approach

interface RateLimitEntry {
  count: number;
  windowStart: number;
}

interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

// Rate limits per endpoint path prefix (requests per minute)
const RATE_LIMITS: Record<string, number> = {
  '/api/extension/capture': 60,
  '/api/extension/tasks': 30,
  '/api/extension/health': 10,
  '/api/extension/settings': 10,
  '/api/extension/contact': 30,
  '/api/extension/message-render': 20,
  '/api/extension/register': 5,
};

const DEFAULT_LIMIT = 30;
const WINDOW_MS = 60_000; // 1 minute

// Map of extensionId:endpoint -> rate limit entry
const rateLimitStore = new Map<string, RateLimitEntry>();

// Periodic cleanup of stale entries (every 5 minutes)
let cleanupTimer: ReturnType<typeof setInterval> | null = null;

function ensureCleanupTimer(): void {
  if (cleanupTimer) return;
  cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of rateLimitStore) {
      if (now - entry.windowStart > WINDOW_MS * 2) {
        rateLimitStore.delete(key);
      }
    }
  }, 300_000);
  // Allow the process to exit without waiting for this timer
  if (cleanupTimer && typeof cleanupTimer === 'object' && 'unref' in cleanupTimer) {
    cleanupTimer.unref();
  }
}

/**
 * Resolve the rate limit for a given endpoint path.
 * Matches on the longest prefix.
 */
function getLimit(endpoint: string): number {
  for (const [prefix, limit] of Object.entries(RATE_LIMITS)) {
    if (endpoint.startsWith(prefix)) {
      return limit;
    }
  }
  return DEFAULT_LIMIT;
}

/**
 * Check if a request is within rate limits.
 */
export function checkRateLimit(
  extensionId: string,
  endpoint: string
): RateLimitResult {
  ensureCleanupTimer();

  const limit = getLimit(endpoint);
  const key = `${extensionId}:${endpoint}`;
  const now = Date.now();

  const entry = rateLimitStore.get(key);

  if (!entry || now - entry.windowStart >= WINDOW_MS) {
    // New window
    rateLimitStore.set(key, { count: 1, windowStart: now });
    return { allowed: true, remaining: limit - 1, retryAfterSeconds: 0 };
  }

  if (entry.count >= limit) {
    const retryAfter = Math.ceil(
      (entry.windowStart + WINDOW_MS - now) / 1000
    );
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.max(1, retryAfter),
    };
  }

  entry.count += 1;
  return {
    allowed: true,
    remaining: limit - entry.count,
    retryAfterSeconds: 0,
  };
}

/**
 * Reset rate limits for a specific extension (used in tests).
 */
export function resetRateLimits(extensionId?: string): void {
  if (extensionId) {
    for (const key of rateLimitStore.keys()) {
      if (key.startsWith(`${extensionId}:`)) {
        rateLimitStore.delete(key);
      }
    }
  } else {
    rateLimitStore.clear();
  }
}
