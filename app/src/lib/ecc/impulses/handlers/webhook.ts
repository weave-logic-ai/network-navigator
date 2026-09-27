// Handler: webhook
//
// Contract (matches other impulse handlers — parallel contract tests in
// tests/ecc/impulses/dispatcher.test.ts depend on this shape):
//   executeWebhook(impulse: Impulse, config: Record<string, unknown>)
//     => Promise<Record<string, unknown>>
//
// Behavior:
//   Delivers the impulse envelope once per call to an external HTTP endpoint
//   configured on the `impulse_handlers` row (config JSONB). Non-2xx responses,
//   network errors, and timeouts return `{ dispatched: false, ... }`; the
//   dispatcher records a failed ack and the scoring recovery worker retries
//   committed scoring impulses with the same idempotency key. Delivery is
//   at-least-once: a process can send successfully and crash before writing
//   the success ack, so a receiver must enforce this key to avoid duplicate
//   external effects. The sender cannot promise exactly-once delivery.
//
// Config shape (from impulse_handlers.config):
//   - target_url: string   (REQUIRED) — destination URL (http/https only)
//   - method:     string   (optional, default 'POST') — HTTP method
//   - headers:    object   (optional) — additional request headers
//   - secret:     string   (optional) — if present, body is HMAC-SHA256 signed
//                                        and attached as X-NetworkNav-Signature
//   - timeout_ms: number   (optional, default 4500, hard-capped <5000 to stay
//                           under the dispatcher's 5s ceiling)
//
// Envelope sent (JSON body):
//   {
//     impulseId:         string,
//     impulseType:       ImpulseType,
//     sourceEntityType:  string,
//     sourceEntityId:    string,
//     payload:           Record<string, unknown>,
//     emittedAt:         string (ISO timestamp)
//   }
//
// Signing:
//   HMAC-SHA256 over the *exact* JSON body bytes, hex-encoded, prefixed with
//   'sha256='. Uses Node's built-in `crypto` — no external dependencies.

import { createHmac } from 'crypto';
import type { Impulse } from '../../types';

/**
 * Hard ceiling for the per-handler timeout. The dispatcher enforces a 5s
 * timeout on the handler call via Promise.race; we stay strictly below that
 * so our AbortController fires first and we can return a structured result
 * instead of being killed by the dispatcher's blunter timeout.
 */
const DISPATCHER_TIMEOUT_CEILING_MS = 5000;
const DEFAULT_TIMEOUT_MS = 4500;
const MIN_TIMEOUT_MS = 100;

type WebhookConfig = {
  targetUrl: string;
  method: string;
  headers: Record<string, string>;
  secret: string | null;
  timeoutMs: number;
};

export async function executeWebhook(
  impulse: Impulse,
  config: Record<string, unknown>,
  deliveryKey: string = impulse.id
): Promise<Record<string, unknown>> {
  let parsed: WebhookConfig;
  try {
    parsed = parseConfig(config);
  } catch (err) {
    return {
      dispatched: false,
      reason: err instanceof Error ? err.message : 'invalid_config',
    };
  }

  const envelope = {
    impulseId: impulse.id,
    impulseType: impulse.impulseType,
    sourceEntityType: impulse.sourceEntityType,
    sourceEntityId: impulse.sourceEntityId,
    payload: impulse.payload,
    emittedAt: impulse.createdAt,
  };
  const body = JSON.stringify(envelope);

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...parsed.headers,
    'Idempotency-Key': deliveryKey,
  };
  if (parsed.secret) {
    const sig = createHmac('sha256', parsed.secret).update(body).digest('hex');
    headers['X-NetworkNav-Signature'] = `sha256=${sig}`;
  }

  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), parsed.timeoutMs);
  const start = Date.now();

  try {
    const response = await fetch(parsed.targetUrl, {
      method: parsed.method,
      headers,
      body,
      signal: controller.signal,
    });
    const durationMs = Date.now() - start;

    if (response.status >= 200 && response.status < 300) {
      return {
        dispatched: true,
        status: response.status,
        durationMs,
      };
    }

    return {
      dispatched: false,
      status: response.status,
      durationMs,
      reason: `http_${response.status}`,
    };
  } catch (err) {
    const durationMs = Date.now() - start;
    const reason = classifyError(err, controller.signal.aborted);
    return {
      dispatched: false,
      durationMs,
      reason,
    };
  } finally {
    clearTimeout(timeoutHandle);
  }
}

function parseConfig(config: Record<string, unknown>): WebhookConfig {
  const targetUrl = config.target_url;
  if (typeof targetUrl !== 'string' || targetUrl.length === 0) {
    throw new Error('missing_target_url');
  }
  // Reject non-http(s) schemes so we never shell out to file:// or similar.
  if (!/^https?:\/\//i.test(targetUrl)) {
    throw new Error('invalid_target_url');
  }

  const method =
    typeof config.method === 'string' && config.method.length > 0
      ? config.method.toUpperCase()
      : 'POST';

  const headers: Record<string, string> = {};
  if (config.headers && typeof config.headers === 'object' && !Array.isArray(config.headers)) {
    for (const [k, v] of Object.entries(config.headers as Record<string, unknown>)) {
      if (typeof v === 'string') headers[k] = v;
    }
  }

  const secret = typeof config.secret === 'string' && config.secret.length > 0 ? config.secret : null;

  let timeoutMs = DEFAULT_TIMEOUT_MS;
  if (typeof config.timeout_ms === 'number' && Number.isFinite(config.timeout_ms)) {
    timeoutMs = Math.floor(config.timeout_ms);
  }
  // Clamp to [MIN_TIMEOUT_MS, DISPATCHER_TIMEOUT_CEILING_MS - 100]. We
  // deliberately stay under the dispatcher's 5s ceiling so our AbortController
  // fires first and returns a clean { reason: 'timeout' } ack.
  const maxAllowed = DISPATCHER_TIMEOUT_CEILING_MS - 100;
  if (timeoutMs > maxAllowed) timeoutMs = maxAllowed;
  if (timeoutMs < MIN_TIMEOUT_MS) timeoutMs = MIN_TIMEOUT_MS;

  return { targetUrl, method, headers, secret, timeoutMs };
}

function classifyError(err: unknown, aborted: boolean): string {
  if (aborted) return 'timeout';
  if (err instanceof Error) {
    // Node's fetch wraps low-level failures in TypeError with a `cause` that
    // carries the DNS / connection error. We surface a coarse 'network' label
    // plus the underlying message for debuggability.
    const name = err.name ?? '';
    if (name === 'AbortError') return 'timeout';
    if (name === 'TypeError') return `network: ${err.message}`;
    return err.message || 'unknown';
  }
  return 'unknown';
}
