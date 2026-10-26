import { createHash } from "node:crypto";
import type { ApiRow, BuiltRow, HConnectOutcome } from "@/lib/hashavshevet/types";

/**
 * Hashavshevet H-Connect client. Docs: docs/hashavshevet-api-guide.html
 *
 * An "ok" reply only means a .dat file reached C:\hash7\Hconnect on the
 * Hashavshevet server; Masofon2 does the real import and its errors never
 * come back through this API.
 */
const HCONNECT_URL = "https://ws.wizground.com/api";
const MAX_BODY_BYTES = 4 * 1024 * 1024; // documented per-request cap
const DEFAULT_TIMEOUT_MS = 30_000;

export type HConnectPlugin = "movein" | "imovein" | "bankin" | "itemin" | "heshin" | "kupain";

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var ${name}`);
  return v;
}

/** md5(JSON(pluginData) + token), lowercase hex. */
export function signPluginData(pluginDataJson: string, token: string): string {
  return createHash("md5").update(pluginDataJson + token, "utf8").digest("hex");
}

/**
 * Builds the request body for one Hashavshevet company. The exact signed
 * pluginData string is spliced in verbatim so re-serialization can never
 * drift from the signature.
 */
export function buildBody(plugin: HConnectPlugin, company: string, rows: ApiRow[]): string {
  const data = JSON.stringify(rows);
  const signature = signPluginData(data, env("HCONNECT_TOKEN"));
  return (
    `{"station":${JSON.stringify(env("HCONNECT_STATION"))},` +
    `"plugin":${JSON.stringify(plugin)},` +
    `"company":${JSON.stringify(company)},` +
    `"message":{"netPassportID":${JSON.stringify(env("HCONNECT_PASSPORT_ID"))},"pluginData":${data}},` +
    `"signature":"${signature}"}`
  );
}

type ApiErrorOutcome = Extract<HConnectOutcome, { kind: "api_error" }>;

/** Turns `{"data":{"0":{"quantity":"..."}}}` into `{0: "quantity: ..."}`. */
function parseRowErrors(errors: unknown): Record<number, string> {
  const out: Record<number, string> = {};
  let parsed: unknown = errors;
  if (typeof errors === "string") {
    try {
      parsed = JSON.parse(errors);
    } catch {
      return out;
    }
  }
  const data = (parsed as { data?: Record<string, unknown> } | null)?.data;
  if (!data || typeof data !== "object") return out;
  for (const [index, fields] of Object.entries(data)) {
    if (!fields || typeof fields !== "object") continue;
    out[Number(index)] = Object.entries(fields as Record<string, unknown>)
      .map(([field, msg]) => `${field}: ${String(msg).trim()}`)
      .join("; ");
  }
  return out;
}

function classifyError(
  err: unknown,
  rawText: string,
  httpStatus: number,
  body: unknown
): ApiErrorOutcome {
  const errObj = err && typeof err === "object" ? (err as { message?: unknown; errors?: unknown }) : null;
  const text = typeof err === "string" ? err : err == null ? rawText : JSON.stringify(err);
  const lower = text.toLowerCase();
  const code: ApiErrorOutcome["code"] = lower.includes("not in service")
    ? "not_in_service"
    : lower.includes("invalid data")
      ? "validation"
      : lower.includes("not allowed")
        ? "permission"
        : "other";
  const message =
    typeof err === "string" ? err : typeof errObj?.message === "string" ? errObj.message : `HTTP ${httpStatus}`;
  return { kind: "api_error", code, message, rowErrors: parseRowErrors(errObj?.errors), httpStatus, body };
}

/**
 * Sends one batch of rows to one company. All values must be strings
 * (allocation numbers keep leading zeros). Never throws on network/API
 * failure: the caller decides what to do with each outcome kind.
 */
export async function sendToHashavshevet(
  plugin: HConnectPlugin,
  company: string,
  rows: ApiRow[],
  opts: { timeoutMs?: number; fetchImpl?: typeof fetch } = {}
): Promise<HConnectOutcome> {
  const body = buildBody(plugin, company, rows);
  if (Buffer.byteLength(body) > MAX_BODY_BYTES) {
    throw new Error(`H-Connect body exceeds 4MB (${rows.length} rows) — use chunkByDocument`);
  }
  const doFetch = opts.fetchImpl ?? fetch;
  const started = Date.now();
  const log = (fields: Record<string, unknown>) =>
    console.log(JSON.stringify({ event: "hconnect.send", plugin, company, rows: rows.length, ...fields }));

  let res: Response;
  let text: string;
  try {
    res = await doFetch(HCONNECT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      signal: AbortSignal.timeout(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
    text = await res.text();
  } catch (e) {
    // Timeout or network failure: the request may or may not have arrived.
    const message = e instanceof Error ? e.message : String(e);
    log({ kind: "unknown", latencyMs: Date.now() - started, error: message });
    return { kind: "unknown", message };
  }

  const latencyMs = Date.now() - started;
  let parsed: unknown;
  let isJson = true;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = text;
    isJson = false;
  }
  const apiRes = isJson ? (parsed as { apiRes?: { status?: string; err?: unknown } } | null)?.apiRes : undefined;

  let outcome: HConnectOutcome;
  if (res.ok && apiRes?.status === "ok" && apiRes.err == null) {
    outcome = { kind: "ok", latencyMs, httpStatus: res.status, body: parsed };
  } else if (res.ok && apiRes?.err == null) {
    // 2xx but not a recognisable reply: delivery is unknown, never assume failure.
    outcome = { kind: "unknown", message: `Unexpected HTTP ${res.status} reply from H-Connect` };
  } else {
    outcome = classifyError(apiRes?.err, text, res.status, parsed);
  }
  log({ kind: outcome.kind, httpStatus: res.status, latencyMs });
  return outcome;
}

/**
 * Splits rows into request-sized chunks without ever splitting a document
 * (rows sharing a documentKey). Input order is preserved. Sizes are exact:
 * body bytes = empty-body bytes + each row's JSON bytes + separating commas.
 */
export function chunkByDocument(
  rows: BuiltRow[],
  plugin: HConnectPlugin,
  company: string,
  maxBytes: number = MAX_BODY_BYTES
): BuiltRow[][] {
  const docs = new Map<string, BuiltRow[]>();
  for (const row of rows) {
    const doc = docs.get(row.documentKey);
    if (doc) doc.push(row);
    else docs.set(row.documentKey, [row]);
  }

  const emptyBytes = Buffer.byteLength(buildBody(plugin, company, []));
  const chunks: BuiltRow[][] = [];
  let current: BuiltRow[] = [];
  let currentBytes = emptyBytes;

  for (const [documentKey, docRows] of docs) {
    const rowBytes = docRows.map((r) => Buffer.byteLength(JSON.stringify(r.apiRow)));
    const docBytes = rowBytes.reduce((a, b) => a + b, 0) + (docRows.length - 1);
    if (emptyBytes + docBytes > maxBytes) {
      throw new Error(`document exceeds 4MB: ${documentKey} (${emptyBytes + docBytes} bytes)`);
    }
    const addBytes = docBytes + (current.length > 0 ? 1 : 0);
    if (currentBytes + addBytes > maxBytes) {
      chunks.push(current);
      current = [];
      currentBytes = emptyBytes;
    }
    currentBytes += docBytes + (current.length > 0 ? 1 : 0);
    current.push(...docRows);
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}
