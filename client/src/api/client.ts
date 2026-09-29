// Tiny JSON fetch wrapper (fetch is already in the project — no axios).
export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!r.ok) throw Object.assign(new Error(`api_${r.status}`), { status: r.status });
  return r.json() as Promise<T>;
}

export const get = <T>(path: string): Promise<T> => api<T>(path);
export const post = <T>(path: string, body?: unknown): Promise<T> =>
  api<T>(path, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) });
export const put = <T>(path: string, body?: unknown): Promise<T> =>
  api<T>(path, { method: "PUT", body: body === undefined ? undefined : JSON.stringify(body) });
export const del = <T>(path: string): Promise<T> => api<T>(path, { method: "DELETE" });
