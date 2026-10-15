// Thin fetch wrapper for the Node API (same origin; session cookies are httpOnly).
// Error messages from the server are translated into the active UI language.
import { getActiveT } from '../i18n/index.jsx';
import { translateFields, translateMessage } from '../i18n/errors.js';
export class ApiError extends Error {
  constructor(status, message, fields) {
    super(message);
    this.status = status;
    this.fields = fields || {};
  }
}

export async function api(path, { method = 'GET', body, headers = {}, raw = false } = {}) {
  let res;
  try {
    res = await fetch(`/api${path}`, {
      method,
      credentials: 'same-origin',
      headers: body !== undefined && !(body instanceof FormData) ? { 'Content-Type': 'application/json', ...headers } : headers,
      body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, translateMessage(getActiveT(), "You're offline or the server is unreachable."));
  }
  if (raw) return res;
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) {
    const t = getActiveT();
    throw new ApiError(res.status, translateMessage(t, data?.error || `Request failed (${res.status})`), translateFields(t, data?.fields));
  }
  return data;
}

export const get = (path) => api(path);
export const post = (path, body) => api(path, { method: 'POST', body: body ?? {} });
export const put = (path, body) => api(path, { method: 'PUT', body });
export const patch = (path, body) => api(path, { method: 'PATCH', body });
export const del = (path) => api(path, { method: 'DELETE' });
