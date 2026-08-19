// NetworkNav v2 API Client
// All operations go through the app's REST API at localhost:3750

const BASE_URL = process.env.NETWORKNAV_URL || 'http://localhost:3750';

export async function api(path, options = {}) {
  const url = `${BASE_URL}${path}`;
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  if (!res.ok) {
    // Error bodies are always JSON, regardless of what the success path
    // returns for this endpoint.
    const error = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(`API ${res.status}: ${error.error || res.statusText}`);
  }
  // Some endpoints (e.g. /api/admin/export) return text/csv rather than
  // JSON. Pass { raw: true } to read the body as text instead of parsing
  // it as JSON.
  if (options.raw) {
    return res.text();
  }
  return res.json();
}

export const get = (path, options = {}) => api(path, options);
export const post = (path, body) => api(path, { method: 'POST', body });
export const put = (path, body) => api(path, { method: 'PUT', body });
export const del = (path) => api(path, { method: 'DELETE' });
export const getRaw = (path) => api(path, { raw: true });
