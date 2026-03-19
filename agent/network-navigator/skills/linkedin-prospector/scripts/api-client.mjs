// NetworkNav v2 API Client
// All operations go through the app's REST API at localhost:3000

const BASE_URL = process.env.NETWORKNAV_URL || 'http://localhost:3000';

export async function api(path, options = {}) {
  const url = `${BASE_URL}${path}`;
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(`API ${res.status}: ${error.error || res.statusText}`);
  }
  return res.json();
}

export const get = (path) => api(path);
export const post = (path, body) => api(path, { method: 'POST', body });
export const put = (path, body) => api(path, { method: 'PUT', body });
export const del = (path) => api(path, { method: 'DELETE' });
