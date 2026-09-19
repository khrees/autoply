/**
 * Manages the API Base URL for the Autoply extension.
 * Persists the URL to chrome.storage.local.
 */

const STORAGE_KEY = 'autoply_api_base_url';
const TOKEN_STORAGE_KEY = 'autoply_api_token';
const DEFAULT_API_BASE = 'http://localhost:8088';

export async function getApiBaseUrl(): Promise<string> {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  return (result[STORAGE_KEY] as string) || DEFAULT_API_BASE;
}

export async function setApiBaseUrl(url: string): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY]: url });
}

export async function getApiUrl(path: string): Promise<string> {
  const base = await getApiBaseUrl();
  return `${base}${path}`;
}

export async function getApiToken(): Promise<string | null> {
  try {
    const result = await chrome.storage.local.get(TOKEN_STORAGE_KEY);
    const token = result[TOKEN_STORAGE_KEY] as string | undefined;
    return token || null;
  } catch {
    return null;
  }
}

export async function setApiToken(token: string): Promise<void> {
  await chrome.storage.local.set({ [TOKEN_STORAGE_KEY]: token });
}

/**
 * Builds auth headers for API requests. The API server requires
 * `Authorization: Bearer <token>` (see ~/.autoply/api-token or AUTOPLY_API_TOKEN).
 */
export async function getAuthHeaders(extra?: HeadersInit): Promise<Record<string, string>> {
  const token = await getApiToken();
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...((extra as Record<string, string>) || {}),
  };
}

/**
 * Builds an authenticated URL for iframe/embed previews and plain
 * `<a download>` links that cannot set Authorization headers.
 * Prefers the Bearer header for fetch(); use this only where headers
 * are impossible.
 */
export async function getAuthedUrl(path: string): Promise<string> {
  const base = await getApiBaseUrl();
  const token = await getApiToken();
  const url = `${base}${path}`;
  if (!token) return url;
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}token=${encodeURIComponent(token)}`;
}

/**
 * Shared JSON fetch with auth. Replaces the duplicated fetchJson
 * helpers previously in hooks/queries.ts and hooks/mutations.ts.
 */
export async function apiFetchJson<T>(path: string, options?: RequestInit): Promise<T> {
  const url = await getApiUrl(path);
  const authHeaders = await getAuthHeaders(options?.headers);
  const res = await fetch(url, { ...options, headers: authHeaders });
  const data = await res.json();
  if (!res.ok) {
    const message =
      (data as { error?: string })?.error || `Request to ${url} failed (${res.status})`;
    throw new Error(message);
  }
  return data as T;
}
