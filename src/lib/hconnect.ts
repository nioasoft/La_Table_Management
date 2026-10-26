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
type ErrorCode = ApiErrorOutcome["code"];

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

/** Error code from API error text; null when the text says nothing recognisable. */
function codeFromText(text: string): ErrorCode | null {
  const lower = text.toLowerCase();
  if (lower.includes("not in service")) return "not_in_service";
  if (lower.includes("invalid data")) return "validation";
  if (lower.includes("not allowed")) return "permission";
  return null;
}

/** `apiRes.err` is present: the API itself rejected the request. */
function apiErrorFromErr(err: unknown, httpStatus: number, body: unknown): ApiErrorOutcome {
  const obj = typeof err === "object" ? (err as { message?: unknown; errors?: unknown } | null) : null;
  const text = typeof err === "string" ? err : JSON.stringify(err);
  const message =
    typeof err === "string" ? err : typeof obj?.message === "string" ? obj.message : `HTTP ${httpStatus}`;
  return {
    kind: "api_error",
    code: codeFromText(text) ?? "other",
    message,
    rowErrors: parseRowErrors(obj?.errors),
    httpStatus,
    body,
  };
}

/**
 * Pure reply -> outcome. `api_error` means "definitely rejected" and lets the
 * caller release row locks and resend, so it is returned only when the API
 * said so (apiRes.err, or a known error phrase on a non-2xx reply) or on a
 * 4xx. Everything ambiguous (proxy 502/503/504, non-JSON, unexpected shape)
 * is `unknown`: the .dat may already have been delivered.
 */
export function classifyReply(httpStatus: number, text: string, latencyMs: number): HConnectOutcome {
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    // non-JSON body: handled by the raw-text fallback below
  }
  const apiRes = (body as { apiRes?: { status?: string; err?: unknown } } | null)?.apiRes;
  const is2xx = httpStatus >= 200 && httpStatus < 300;

  if (apiRes?.err != null) return apiErrorFromErr(apiRes.err, httpStatus, body);
  if (is2xx && apiRes?.status === "ok") return { kind: "ok", latencyMs, httpStatus, body };
  if (!is2xx) {
    const code = codeFromText(text);
    const known = code === "not_in_service" || code === "permission";
    if (known || (httpStatus >= 400 && httpStatus < 500)) {
      return {
        kind: "api_error",
        code: known ? code : "other",
        message: `HTTP ${httpStatus}: ${text.trim().slice(0, 200)}`,
        rowErrors: {},
        httpStatus,
        body,
      };
    }
  }
  return { kind: "unknown", message: `Unrecognised HTTP ${httpStatus} reply from H-Connect` };
}

type RawReply = { status: number; text: string } | { error: string };

/** POST with timeout. Timeout or network failure -> `{ error }` (delivery unknown). */
async function postBody(body: string, timeoutMs: number, doFetch: typeof fetch): Promise<RawReply> {
  try {
    const res = await doFetch(HCONNECT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      signal: AbortSignal.timeout(timeoutMs),
    });
    return { status: res.status, text: await res.text() };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
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
  const started = Date.now();
  const reply = await postBody(body, opts.timeoutMs ?? DEFAULT_TIMEOUT_MS, opts.fetchImpl ?? fetch);
  const latencyMs = Date.now() - started;
  const outcome: HConnectOutcome =
    "error" in reply ? { kind: "unknown", message: reply.error } : classifyReply(reply.status, reply.text, latencyMs);
  console.log(
    JSON.stringify({
      event: "hconnect.send",
      plugin,
      company,
      rows: rows.length,
      kind: outcome.kind,
      httpStatus: "status" in reply ? reply.status : undefined,
      latencyMs,
    })
  );
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
