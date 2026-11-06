/**
 * The only place the browser talks to the server. Every request carries the session cookie and, for
 * writes, the CSRF token. Failures become ApiError with a code and a message fit to show to a person.
 */
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

let csrfToken = "";
export const setCsrfToken = (token: string) => { csrfToken = token; };
/** For uploads that bypass `request` (audio): the same CSRF header. */
export const csrfHeaders = (): Record<string, string> => (csrfToken ? { "x-csrf-token": csrfToken } : {});

const unauthenticatedListeners = new Set<() => void>();
/** Called when the server says the session has ended, so the app can return to the sign-in page. */
export const onUnauthenticated = (fn: () => void) => {
  unauthenticatedListeners.add(fn);
  return () => { unauthenticatedListeners.delete(fn); };
};

type Query = Record<string, string | number | boolean | null | undefined>;

export function withQuery(path: string, query?: Query): string {
  if (!query) return path;
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null && v !== "") params.set(k, String(v));
  const s = params.toString();
  return s ? `${path}${path.includes("?") ? "&" : "?"}${s}` : path;
}

export type RequestOptions = {
  body?: unknown;
  query?: Query;
  /** Raw bytes (an upload). Sent as is, with `contentType`. */
  raw?: Blob | ArrayBuffer;
  contentType?: string;
  headers?: Record<string, string>;
  signal?: AbortSignal;
};

export async function request<T>(method: string, path: string, opts: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json", ...opts.headers };
  let body: BodyInit | undefined;
  if (opts.raw) {
    headers["Content-Type"] = opts.contentType ?? "application/octet-stream";
    body = opts.raw as BodyInit;
  } else if (opts.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(opts.body);
  }
  if (method !== "GET" && csrfToken) headers["x-csrf-token"] = csrfToken;

  let res: Response;
  try {
    res = await fetch(withQuery(path, opts.query), { method, headers, body, credentials: "same-origin", signal: opts.signal });
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") throw e;
    throw new ApiError(0, "network", "Can't reach the server. Check your connection and try again.");
  }

  if (res.status === 204) return undefined as T;
  const text = await res.text();
  let json: unknown = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* not JSON */ }

  if (!res.ok) {
    const err = (json as { error?: { code?: string; message?: string } & Record<string, unknown> } | null)?.error;
    // The sign-in and session-check calls expect a 401 when nobody is signed in; only other calls mean a session ended.
    if (res.status === 401 && !path.startsWith("/api/auth/")) unauthenticatedListeners.forEach(fn => fn());
    const { code, message, ...details } = err ?? {};
    throw new ApiError(res.status, code ?? "error", message ?? `Something went wrong (${res.status}). Try again.`, details);
  }
  return json as T;
}

export const api = {
  get: <T>(path: string, query?: Query, signal?: AbortSignal) => request<T>("GET", path, { query, signal }),
  post: <T>(path: string, body?: unknown, opts?: RequestOptions) => request<T>("POST", path, { body, ...opts }),
  put: <T>(path: string, body?: unknown) => request<T>("PUT", path, { body }),
  patch: <T>(path: string, body?: unknown) => request<T>("PATCH", path, { body }),
  delete: <T>(path: string) => request<T>("DELETE", path),
};

/** A message to show for any error: ApiError messages are already written for people. */
export const errorMessage = (e: unknown, fallback = "Something went wrong. Try again."): string =>
  e instanceof ApiError ? e.message : e instanceof Error && e.message ? e.message : fallback;
