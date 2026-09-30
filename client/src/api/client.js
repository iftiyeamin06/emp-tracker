// Tiny JSON fetch wrapper (fetch is already in the project — no axios).
export async function api(path, init) {
    const r = await fetch(path, {
        headers: { "Content-Type": "application/json" },
        ...init,
    });
    if (!r.ok)
        throw Object.assign(new Error(`api_${r.status}`), { status: r.status });
    return r.json();
}
export const get = (path) => api(path);
export const post = (path, body) => api(path, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) });
export const put = (path, body) => api(path, { method: "PUT", body: body === undefined ? undefined : JSON.stringify(body) });
export const patch = (path, body) => api(path, { method: "PATCH", body: body === undefined ? undefined : JSON.stringify(body) });
export const del = (path) => api(path, { method: "DELETE" });
