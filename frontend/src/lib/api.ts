/**
 * HTTP-клиент API. В Telegram — Bearer-токен, полученный после серверной проверки initData.
 * В браузере — httpOnly-cookie сессии + CSRF-токен в заголовке. Ошибки приводятся к ApiError.
 */

export type FieldError = { loc: string; msg: string };

export class ApiError extends Error {
  status: number;
  code: string;
  details: unknown;
  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
  get fieldErrors(): Record<string, string> {
    if (!Array.isArray(this.details)) return {};
    return Object.fromEntries((this.details as FieldError[]).filter((d) => d && d.loc).map((d) => [d.loc, d.msg]));
  }
  get isNetwork(): boolean {
    return this.status === 0;
  }
}

const TOKEN_KEY = "sp_token";
let token: string | null = null;
try {
  token = sessionStorage.getItem(TOKEN_KEY);
} catch {
  token = null;
}

export function setToken(t: string | null): void {
  token = t;
  try {
    if (t) sessionStorage.setItem(TOKEN_KEY, t);
    else sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    /* хранилище недоступно — токен живёт в памяти */
  }
}
export const hasToken = (): boolean => !!token;

function csrfFromCookie(): string | null {
  const m = document.cookie.match(/(?:^|;\s*)sp_csrf=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

// Отслеживание медленных запросов для баннера «медленное соединение»
const inflight = new Map<number, number>();
let seq = 0;
const listeners = new Set<() => void>();
export function slowRequestsSince(ms: number): boolean {
  const now = Date.now();
  for (const started of inflight.values()) if (now - started > ms) return true;
  return false;
}
export function onUnauthorized(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

type Opts = { body?: unknown; signal?: AbortSignal; idempotencyKey?: string; timeoutMs?: number; quiet401?: boolean };

export async function api<T>(method: string, path: string, opts: Opts = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  if (token) headers.Authorization = `Bearer ${token}`;
  else if (!["GET", "HEAD"].includes(method)) {
    const csrf = csrfFromCookie();
    if (csrf) headers["X-CSRF-Token"] = csrf;
  }
  if (opts.idempotencyKey) headers["Idempotency-Key"] = opts.idempotencyKey;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new DOMException("timeout", "TimeoutError")), opts.timeoutMs ?? 20000);
  opts.signal?.addEventListener("abort", () => controller.abort(opts.signal?.reason));
  const id = ++seq;
  inflight.set(id, Date.now());
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      credentials: "same-origin",
      signal: controller.signal,
    });
  } catch (e) {
    const timedOut = controller.signal.reason instanceof DOMException && controller.signal.reason.name === "TimeoutError";
    if (opts.signal?.aborted) throw e;
    throw new ApiError(0, timedOut ? "timeout" : "network", timedOut ? "Сервер долго не отвечает. Проверьте соединение и попробуйте ещё раз" : "Нет соединения с сервером. Проверьте интернет");
  } finally {
    clearTimeout(timeout);
    inflight.delete(id);
  }
  if (res.status === 204) return undefined as T;
  let data: unknown = null;
  const text = await res.text();
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }
  if (!res.ok) {
    const err = (data as { error?: { code?: string; message?: string; details?: unknown } } | null)?.error;
    const apiErr = new ApiError(
      res.status,
      err?.code ?? (res.status >= 500 ? "server_error" : "http_error"),
      err?.message ?? (res.status >= 500 ? "Сервер временно недоступен. Попробуйте позже" : `Ошибка ${res.status}`),
      err?.details,
    );
    if (res.status === 401 && !opts.quiet401) listeners.forEach((l) => l());
    throw apiErr;
  }
  return data as T;
}

export const get = <T>(path: string, signal?: AbortSignal) => api<T>("GET", path, { signal });
export const post = <T>(path: string, body?: unknown, opts: Omit<Opts, "body"> = {}) => api<T>("POST", path, { ...opts, body: body ?? {} });
export const put = <T>(path: string, body?: unknown) => api<T>("PUT", path, { body: body ?? {} });
export const patch = <T>(path: string, body?: unknown) => api<T>("PATCH", path, { body: body ?? {} });

export function newIdempotencyKey(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function qs(params: Record<string, string | number | boolean | null | undefined | string[]>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === null || v === undefined || v === "" || v === false) continue;
    if (Array.isArray(v)) v.forEach((x) => sp.append(k, x));
    else sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : "";
}
