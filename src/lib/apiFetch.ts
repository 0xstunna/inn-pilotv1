/**
 * Small fetch wrapper for InnPilot API endpoints.
 * Handles JSON bodies, error parsing and consistent error messages.
 */
export async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
    ...init,
  });
  return res;
}

/** POST JSON to an API endpoint and return the parsed body or throw. */
export async function apiPostJson(path: string, body: unknown): Promise<any> {
  const res = await apiFetch(path, { method: "POST", body: JSON.stringify(body) });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`API ${path} failed (${res.status}): ${text}`);
  }
  return res.json();
}

/** GET JSON from an API endpoint and return the parsed body or throw. */
export async function apiGetJson(path: string): Promise<any> {
  const res = await apiFetch(path);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`API ${path} failed (${res.status}): ${text}`);
  }
  return res.json();
}