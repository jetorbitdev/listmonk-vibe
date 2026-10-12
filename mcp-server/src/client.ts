/**
 * Thin HTTP client for the listmonk REST API.
 * Auth: `Authorization: token <api_user>:<token>` (see docs/apis.md).
 */

export type QueryValue = string | number | boolean | undefined | null | Array<string | number>;
export type Query = Record<string, QueryValue>;

export interface ClientConfig {
  baseUrl: string;
  apiUser: string;
  apiToken: string;
  timeoutMs?: number;
}

export class ListmonkError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly method: string,
    public readonly path: string,
    public readonly body?: unknown,
  ) {
    super(message);
    this.name = "ListmonkError";
  }
}

export class ListmonkClient {
  private readonly baseUrl: string;
  private readonly authHeader: string;
  private readonly timeoutMs: number;

  constructor(cfg: ClientConfig) {
    this.baseUrl = cfg.baseUrl.replace(/\/+$/, "");
    this.authHeader = `token ${cfg.apiUser}:${cfg.apiToken}`;
    this.timeoutMs = cfg.timeoutMs ?? 30_000;
  }

  buildUrl(path: string, query?: Query): string {
    const p = path.startsWith("/") ? path : `/${path}`;
    const url = new URL(this.baseUrl + p);
    if (query) {
      for (const [k, v] of Object.entries(query)) {
        if (v === undefined || v === null || v === "") continue;
        if (Array.isArray(v)) {
          for (const item of v) url.searchParams.append(k, String(item));
        } else {
          url.searchParams.set(k, String(v));
        }
      }
    }
    return url.toString();
  }

  /**
   * Perform a request. Returns the `data` payload of listmonk's JSON envelope
   * when present, the whole JSON otherwise, or raw text for non-JSON responses.
   */
  async request<T = unknown>(
    method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
    path: string,
    opts: { query?: Query; body?: unknown; raw?: boolean } = {},
  ): Promise<T> {
    const url = this.buildUrl(path, opts.query);
    const headers: Record<string, string> = {
      Authorization: this.authHeader,
      Accept: "application/json, text/html;q=0.9, */*;q=0.8",
    };
    let body: string | undefined;
    if (opts.body !== undefined) {
      headers["Content-Type"] = "application/json; charset=utf-8";
      body = JSON.stringify(opts.body);
    }

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    let res: Response;
    try {
      res = await fetch(url, { method, headers, body, signal: ctrl.signal });
    } catch (err) {
      clearTimeout(timer);
      const msg = err instanceof Error ? err.message : String(err);
      throw new ListmonkError(`Request failed: ${msg}`, 0, method, path);
    }
    clearTimeout(timer);

    const text = await res.text();
    const ctype = res.headers.get("content-type") ?? "";
    let parsed: unknown = text;
    if (ctype.includes("application/json") || /^\s*[{[]/.test(text)) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }
    }

    if (!res.ok) {
      let msg = `HTTP ${res.status} ${res.statusText}`;
      if (parsed && typeof parsed === "object" && "message" in parsed) {
        msg += `: ${(parsed as { message: unknown }).message}`;
      } else if (typeof parsed === "string" && parsed.trim()) {
        msg += `: ${parsed.trim().slice(0, 500)}`;
      }
      throw new ListmonkError(msg, res.status, method, path, parsed);
    }

    if (opts.raw) return parsed as T;
    if (parsed && typeof parsed === "object" && "data" in parsed) {
      return (parsed as { data: T }).data;
    }
    return parsed as T;
  }

  get<T = unknown>(path: string, query?: Query) {
    return this.request<T>("GET", path, { query });
  }
  post<T = unknown>(path: string, body?: unknown, query?: Query) {
    return this.request<T>("POST", path, { body, query });
  }
  put<T = unknown>(path: string, body?: unknown, query?: Query) {
    return this.request<T>("PUT", path, { body, query });
  }
  patch<T = unknown>(path: string, body?: unknown, query?: Query) {
    return this.request<T>("PATCH", path, { body, query });
  }
  delete<T = unknown>(path: string, query?: Query, body?: unknown) {
    return this.request<T>("DELETE", path, { query, body });
  }
}

export function clientFromEnv(env: NodeJS.ProcessEnv = process.env): ListmonkClient {
  const baseUrl = env.LISTMONK_URL;
  const apiUser = env.LISTMONK_API_USER;
  const apiToken = env.LISTMONK_API_TOKEN;
  const missing = [
    !baseUrl && "LISTMONK_URL",
    !apiUser && "LISTMONK_API_USER",
    !apiToken && "LISTMONK_API_TOKEN",
  ].filter(Boolean);
  if (missing.length) {
    throw new Error(
      `Missing required environment variable(s): ${missing.join(", ")}. ` +
        `Create an API user in listmonk (Admin -> Users, type "API") and set these.`,
    );
  }
  const timeoutMs = env.LISTMONK_TIMEOUT_MS ? Number(env.LISTMONK_TIMEOUT_MS) : undefined;
  return new ListmonkClient({ baseUrl: baseUrl!, apiUser: apiUser!, apiToken: apiToken!, timeoutMs });
}
