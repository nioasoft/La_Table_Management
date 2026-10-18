import { createHash } from "node:crypto";

/**
 * Hashavshevet H-Connect client. Docs: docs/hashavshevet-api-guide.html
 *
 * An "ok" reply only means a .dat file reached C:\hash7\Hconnect on the
 * Hashavshevet server; Masofon2 does the real import and its errors never
 * come back through this API.
 */
const HCONNECT_URL = "https://ws.wizground.com/api";
const MAX_BODY_BYTES = 4 * 1024 * 1024; // documented per-request cap

export type HConnectPlugin = "movein" | "imovein" | "bankin" | "itemin" | "heshin" | "kupain";

export interface HConnectResult {
  ok: boolean;
  status: number;
  latencyMs: number;
  body: unknown;
}

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
 * Builds the request body. The exact signed pluginData string is spliced in
 * verbatim so re-serialization can never drift from the signature.
 */
export function buildBody(plugin: HConnectPlugin, rows: Record<string, string>[]): string {
  const data = JSON.stringify(rows);
  const signature = signPluginData(data, env("HCONNECT_TOKEN"));
  return (
    `{"station":${JSON.stringify(env("HCONNECT_STATION"))},` +
    `"plugin":${JSON.stringify(plugin)},` +
    `"company":${JSON.stringify(env("HCONNECT_COMPANY"))},` +
    `"message":{"netPassportID":${JSON.stringify(env("HCONNECT_PASSPORT_ID"))},"pluginData":${data}},` +
    `"signature":"${signature}"}`
  );
}

/** Sends one batch of rows. All values must be strings (allocation numbers keep leading zeros). */
export async function sendToHashavshevet(
  plugin: HConnectPlugin,
  rows: Record<string, string>[]
): Promise<HConnectResult> {
  const body = buildBody(plugin, rows);
  if (Buffer.byteLength(body) > MAX_BODY_BYTES) {
    throw new Error(`H-Connect body exceeds 4MB (${rows.length} rows) — split the batch`);
  }
  const started = Date.now();
  const res = await fetch(HCONNECT_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
  const text = await res.text();
  let parsed: unknown = text;
  try {
    parsed = JSON.parse(text);
  } catch {
    // non-JSON error body — keep raw text
  }
  const latencyMs = Date.now() - started;
  const apiStatus = (parsed as { apiRes?: { status?: string } })?.apiRes?.status;
  const ok = res.ok && apiStatus === "ok";
  console.log(
    JSON.stringify({ event: "hconnect.send", plugin, rows: rows.length, httpStatus: res.status, ok, latencyMs })
  );
  return { ok, status: res.status, latencyMs, body: parsed };
}
