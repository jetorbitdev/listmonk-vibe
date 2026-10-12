import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { ListmonkError } from "./client.js";

export function ok(data: unknown, note?: string): CallToolResult {
  const text = typeof data === "string" ? data : JSON.stringify(data, null, 2);
  return {
    content: [{ type: "text", text: note ? `${note}\n\n${text}` : text }],
  };
}

export function fail(err: unknown): CallToolResult {
  let text: string;
  if (err instanceof ListmonkError) {
    text = `listmonk API error (${err.method} ${err.path}): ${err.message}`;
    if (err.body && typeof err.body === "object") {
      text += `\n${JSON.stringify(err.body, null, 2)}`;
    }
  } else if (err instanceof Error) {
    text = err.message;
  } else {
    text = String(err);
  }
  return { content: [{ type: "text", text }], isError: true };
}

/** Wrap a tool handler so thrown errors become MCP error results. */
export function guard<A>(fn: (args: A) => Promise<CallToolResult>) {
  return async (args: A): Promise<CallToolResult> => {
    try {
      return await fn(args);
    } catch (err) {
      return fail(err);
    }
  };
}

/**
 * Normalise a user supplied timestamp to RFC3339 that listmonk accepts.
 * Accepts ISO strings with or without timezone; a naive string is treated as local time.
 * Throws if unparseable or in the past (listmonk rejects past send_at).
 */
export function normalizeSendAt(input: string, { requireFuture = true } = {}): string {
  const d = new Date(input);
  if (Number.isNaN(d.getTime())) {
    throw new Error(`Invalid send_at "${input}". Use ISO 8601, e.g. 2026-10-20T09:00:00+07:00`);
  }
  if (requireFuture && d.getTime() <= Date.now()) {
    throw new Error(`send_at "${input}" is in the past; listmonk only schedules future dates.`);
  }
  return d.toISOString();
}

/** Drop undefined values so we only send fields the caller set. */
export function compact<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) if (v !== undefined) out[k] = v;
  return out as Partial<T>;
}
