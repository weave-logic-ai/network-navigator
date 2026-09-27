import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import zlib from 'node:zlib';
import { checkHostSafe, type PrivateIpReason } from './private-ip';

type DnsLookup = (host: string) => Promise<Array<{ address: string; family: number }>>;

export class SafeHttpError extends Error {
  constructor(
    message: string,
    public readonly code: 'INVALID_URL' | 'BLOCKED_IP' | 'TOO_LARGE' | 'TIMEOUT' | 'HTTP_ERROR',
    public readonly reason?: PrivateIpReason
  ) {
    super(message);
    this.name = 'SafeHttpError';
  }
}

export interface SafeHttpOptions {
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  maxBytes: number;
  timeoutMs: number;
  maxRedirects?: number;
  dnsLookup?: DnsLookup;
  /** Called for every hop, after its address is checked but before opening a socket. */
  beforeRequest?: (url: string) => Promise<void>;
}

export interface SafeHttpResponse {
  bytes: Buffer;
  status: number;
  contentType: string;
  finalUrl: string;
}

/** Resolve once per hop, pin that approved address for the socket, and bound
 * both redirects and streamed response bytes. No automatic redirect or DNS
 * resolution is delegated to the HTTP client. */
export async function safeHttpGet(url: string, opts: SafeHttpOptions): Promise<SafeHttpResponse> {
  if (!Number.isSafeInteger(opts.maxBytes) || opts.maxBytes < 1 ||
      !Number.isSafeInteger(opts.timeoutMs) || opts.timeoutMs < 1) {
    throw new SafeHttpError('Invalid fetch limits', 'INVALID_URL');
  }
  const deadline = Date.now() + opts.timeoutMs;
  let current = url;
  let method = opts.method ?? 'GET';
  let headers = opts.headers;
  for (let hop = 0; hop <= (opts.maxRedirects ?? 5); hop++) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new SafeHttpError(`Timeout fetching ${url}`, 'TIMEOUT');
    let parsed: URL;
    try {
      parsed = new URL(current);
    } catch {
      throw new SafeHttpError(`Invalid URL: ${current}`, 'INVALID_URL');
    }
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
      throw new SafeHttpError(`Unsupported URL: ${current}`, 'INVALID_URL');
    }
    const checked = await withDeadline(checkHostSafe(parsed.hostname, opts.dnsLookup), deadline, url);
    if (checked.blocked || !checked.resolvedIp) {
      throw new SafeHttpError(`Blocked fetch to ${parsed.hostname}: ${checked.reason}`, 'BLOCKED_IP', checked.reason);
    }
    if (opts.beforeRequest) await withDeadline(opts.beforeRequest(current), deadline, url);
    const response = await requestOnce(parsed, checked.resolvedIp, method, headers, opts, deadline);
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.location;
      if (!location) throw new SafeHttpError(`Redirect without Location: ${current}`, 'HTTP_ERROR');
      if (hop === (opts.maxRedirects ?? 5)) {
        throw new SafeHttpError(`Too many redirects: ${url}`, 'HTTP_ERROR');
      }
      const next = new URL(location, parsed);
      // A connector may carry API credentials. Never forward any caller
      // header to another origin (including an HTTPS-to-HTTP downgrade).
      if (next.origin !== parsed.origin) headers = undefined;
      current = next.toString();
      if (response.status === 303 || ((response.status === 301 || response.status === 302) && method === 'POST')) {
        method = 'GET';
      }
      continue;
    }
    return {
      bytes: decodeBody(response.bytes, response.contentEncoding, opts.maxBytes),
      status: response.status,
      contentType: response.contentType,
      finalUrl: current,
    };
  }
  throw new SafeHttpError(`Too many redirects: ${url}`, 'HTTP_ERROR');
}

function decodeBody(bytes: Buffer, encoding: string | undefined, maxBytes: number): Buffer {
  const normalized = encoding?.trim().toLowerCase();
  if (!normalized || normalized === 'identity') return bytes;
  try {
    let decoded: Buffer;
    if (normalized === 'gzip') decoded = zlib.gunzipSync(bytes, { maxOutputLength: maxBytes });
    else if (normalized === 'deflate') decoded = zlib.inflateSync(bytes, { maxOutputLength: maxBytes });
    else if (normalized === 'br') decoded = zlib.brotliDecompressSync(bytes, { maxOutputLength: maxBytes });
    else throw new SafeHttpError(`Unsupported content encoding: ${encoding}`, 'HTTP_ERROR');
    if (decoded.byteLength > maxBytes) throw new SafeHttpError(`Response exceeds max ${maxBytes} bytes`, 'TOO_LARGE');
    return decoded;
  } catch (error) {
    if (error instanceof SafeHttpError) throw error;
    if ((error as NodeJS.ErrnoException).code === 'ERR_BUFFER_TOO_LARGE') {
      throw new SafeHttpError(`Response exceeds max ${maxBytes} bytes`, 'TOO_LARGE');
    }
    throw new SafeHttpError(`Could not decode ${encoding} response`, 'HTTP_ERROR');
  }
}

async function withDeadline<T>(promise: Promise<T>, deadline: number, url: string): Promise<T> {
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw new SafeHttpError(`Timeout fetching ${url}`, 'TIMEOUT');
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => reject(new SafeHttpError(`Timeout fetching ${url}`, 'TIMEOUT')), remaining);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function requestOnce(
  url: URL,
  approvedIp: string,
  method: 'GET' | 'POST',
  headers: Record<string, string> | undefined,
  opts: SafeHttpOptions,
  deadline: number
): Promise<{ bytes: Buffer; status: number; location: string | undefined; contentType: string; contentEncoding: string | undefined }> {
  return new Promise((resolve, reject) => {
    const transport = url.protocol === 'https:' ? https : http;
    const request = transport.request(url, {
      method,
      headers,
      agent: false,
      lookup: (_host, _options, callback) => {
        const family = net.isIP(approvedIp);
        if (_options.all) callback(null, [{ address: approvedIp, family }]);
        else callback(null, approvedIp, family);
      },
    }, (response) => {
      const status = response.statusCode ?? 0;
      const location = response.headers.location;
      const contentType = response.headers['content-type'] ?? 'application/octet-stream';
      const contentEncoding = response.headers['content-encoding'];
      if ([301, 302, 303, 307, 308].includes(status)) {
        // Do not download an unbounded redirect body before inspecting the next URL.
        response.destroy();
        resolve({ bytes: Buffer.alloc(0), status, location, contentType, contentEncoding });
        return;
      }
      const chunks: Buffer[] = [];
      let size = 0;
      response.on('data', (chunk: Buffer) => {
        size += chunk.byteLength;
        if (size > opts.maxBytes) {
          response.destroy(new SafeHttpError(`Response exceeds max ${opts.maxBytes} bytes`, 'TOO_LARGE'));
          return;
        }
        chunks.push(chunk);
      });
      response.on('end', () => resolve({ bytes: Buffer.concat(chunks, size), status, location, contentType, contentEncoding }));
      response.on('error', reject);
    });
    const timer = setTimeout(() => {
      request.destroy(new SafeHttpError(`Timeout fetching ${url}`, 'TIMEOUT'));
    }, Math.max(1, deadline - Date.now()));
    request.once('close', () => clearTimeout(timer));
    request.on('error', reject);
    request.end();
  });
}
