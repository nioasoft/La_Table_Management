import { describe, it, expect, beforeEach, vi } from "vitest";
import { buildBody, chunkByDocument, sendToHashavshevet, signPluginData } from "@/lib/hconnect";
import type { ApiRow, BuiltRow } from "@/lib/hashavshevet/types";

const OK_BODY = '{"apiRes":{"status":"ok"},"actionType":"movein","messType":"apiReplay"}';
const VALIDATION_BODY =
  '{"apiRes":{"err":{"message":"invalid data","errors":"{\\"data\\":{\\"0\\":{\\"quantity\\":\\" type error , 1 is not  decimal \\"},\\"1\\":{\\"quantity\\":\\" type error , 1 is not  decimal \\"}}}"}},"actionType":"imovein","messType":"apiReplay"}';
const PERMISSION_BODY =
  '{"apiRes":{"err":"movein module error:  Error: you are not allowed to use movein module"},"actionType":"movein","messType":"apiReplay"}';

function reply(status: number, body: string): typeof fetch {
  return vi.fn(async () => new Response(body, { status })) as unknown as typeof fetch;
}

beforeEach(() => {
  process.env.HCONNECT_STATION = "STATION";
  process.env.HCONNECT_COMPANY = "must-not-be-read";
  process.env.HCONNECT_PASSPORT_ID = "PASSPORT";
  process.env.HCONNECT_TOKEN = "TOKEN";
  vi.spyOn(console, "log").mockImplementation(() => {});
});

describe("buildBody", () => {
  it("signs and preserves hebrew, quotes and leading zeros", () => {
    const body = buildBody("movein", "fv", [
      { AccountKeyCred2: 'מע"מ', AccountKeyDeb1: "ויני ע", TaxAPINumber: "012345678" },
    ]);
    const parsed = JSON.parse(body);
    expect(parsed.company).toBe("fv");
    expect(parsed.message.pluginData[0].AccountKeyCred2).toBe('מע"מ');
    expect(parsed.message.pluginData[0].TaxAPINumber).toBe("012345678");
    expect(parsed.signature).toBe(signPluginData(JSON.stringify(parsed.message.pluginData), "TOKEN"));
  });
});

describe("sendToHashavshevet", () => {
  const rows: ApiRow[] = [{ Reference: "1" }];

  it("sends the company it was given, not the env one", async () => {
    const fetchImpl = reply(200, OK_BODY);
    await sendToHashavshevet("movein", "fv", rows, { fetchImpl });
    const sent = JSON.parse((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
    expect(sent.company).toBe("fv");
  });

  it("classifies ok", async () => {
    const out = await sendToHashavshevet("movein", "fv", rows, { fetchImpl: reply(200, OK_BODY) });
    expect(out).toMatchObject({ kind: "ok", httpStatus: 200 });
  });

  it("classifies invalid data with per-row errors", async () => {
    const out = await sendToHashavshevet("imovein", "fv", rows, { fetchImpl: reply(500, VALIDATION_BODY) });
    expect(out).toMatchObject({ kind: "api_error", code: "validation", httpStatus: 500 });
    if (out.kind !== "api_error") throw new Error("unreachable");
    expect(out.rowErrors[0]).toContain("quantity");
    expect(out.rowErrors[1]).toContain("quantity");
  });

  it("classifies not allowed as permission", async () => {
    const out = await sendToHashavshevet("movein", "fv", rows, { fetchImpl: reply(500, PERMISSION_BODY) });
    expect(out).toMatchObject({ kind: "api_error", code: "permission" });
  });

  it("classifies Not in service", async () => {
    const body = '{"apiRes":{"err":"Not in service"},"actionType":"movein","messType":"apiReplay"}';
    const out = await sendToHashavshevet("movein", "fv", rows, { fetchImpl: reply(500, body) });
    expect(out).toMatchObject({ kind: "api_error", code: "not_in_service" });
  });

  it("classifies other errors", async () => {
    const body = '{"apiRes":{"err":"boom"}}';
    const out = await sendToHashavshevet("movein", "fv", rows, { fetchImpl: reply(500, body) });
    expect(out).toMatchObject({ kind: "api_error", code: "other" });
  });

  it("ambiguous replies are unknown, never a definite api_error", async () => {
    const send = (status: number, body: string) =>
      sendToHashavshevet("movein", "fv", rows, { fetchImpl: reply(status, body) });
    expect(await send(502, "<html><body>502 Bad Gateway</body></html>")).toMatchObject({ kind: "unknown" });
    expect(await send(503, "")).toMatchObject({ kind: "unknown" });
    expect(await send(500, "Internal Server Error")).toMatchObject({ kind: "unknown" });
    expect(await send(500, '{"apiRes":{"status":"ok"}}')).toMatchObject({ kind: "unknown" });
    expect(await send(500, '{"message":"oops"}')).toMatchObject({ kind: "unknown" });
  });

  it("a 200 whose apiRes has err is api_error, classified by err", async () => {
    const body = '{"apiRes":{"err":"movein module error: you are not allowed to use movein module"}}';
    const out = await sendToHashavshevet("movein", "fv", rows, { fetchImpl: reply(200, body) });
    expect(out).toMatchObject({ kind: "api_error", code: "permission", httpStatus: 200 });
  });

  it("known error phrases in a non-JSON non-2xx body are api_error", async () => {
    const send = (body: string) => sendToHashavshevet("movein", "fv", rows, { fetchImpl: reply(500, body) });
    expect(await send("Not in service")).toMatchObject({ kind: "api_error", code: "not_in_service" });
    expect(await send("you are NOT ALLOWED here")).toMatchObject({ kind: "api_error", code: "permission" });
  });

  it("a 4xx without an envelope is api_error other", async () => {
    const out = await sendToHashavshevet("movein", "fv", rows, { fetchImpl: reply(400, "Bad Request") });
    expect(out).toMatchObject({ kind: "api_error", code: "other", httpStatus: 400 });
  });

  it("network failure and timeout are unknown", async () => {
    const down = vi.fn(async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    expect(await sendToHashavshevet("movein", "fv", rows, { fetchImpl: down })).toMatchObject({ kind: "unknown" });

    const aborted = vi.fn(async () => {
      throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
    }) as unknown as typeof fetch;
    expect(await sendToHashavshevet("movein", "fv", rows, { fetchImpl: aborted })).toMatchObject({ kind: "unknown" });
  });

  it("a 2xx reply that is not JSON is unknown", async () => {
    const out = await sendToHashavshevet("movein", "fv", rows, { fetchImpl: reply(200, "<html>proxy</html>") });
    expect(out).toMatchObject({ kind: "unknown" });
  });

  it("never logs the token", async () => {
    await sendToHashavshevet("movein", "fv", rows, { fetchImpl: reply(200, OK_BODY) });
    const logged = (console.log as unknown as ReturnType<typeof vi.fn>).mock.calls.flat().join(" ");
    expect(logged).toContain('"company":"fv"');
    expect(logged).not.toContain("TOKEN");
  });
});

describe("chunkByDocument", () => {
  const row = (doc: string, n: number): BuiltRow => ({
    rowKey: `${doc}-${n}`,
    companyId: "c1",
    documentKey: doc,
    amount: 1,
    display: {},
    apiRow: { Reference: `${doc}-${n}`, Details: "x".repeat(100) },
    periodEnd: "2026-09-30",
  });
  const size = (rs: BuiltRow[]) => Buffer.byteLength(buildBody("movein", "fv", rs.map((r) => r.apiRow)));

  it("chunks keep documents whole", () => {
    const rows = [row("d1", 1), row("d1", 2), row("d2", 1), row("d2", 2), row("d3", 1), row("d3", 2)];
    const maxBytes = size(rows.slice(0, 4)) + 10; // fits 2 docs, not 3
    const chunks = chunkByDocument(rows, "movein", "fv", maxBytes);
    expect(chunks.map((c) => c.map((r) => r.documentKey))).toEqual([
      ["d1", "d1", "d2", "d2"],
      ["d3", "d3"],
    ]);
    // the arithmetic must match the real serialized body
    for (const c of chunks) expect(size(c)).toBeLessThanOrEqual(maxBytes);
    expect(size(rows.slice(0, 4))).toBe(size(chunks[0]));
  });

  it("returns one chunk when everything fits and none for no rows", () => {
    const rows = [row("d1", 1), row("d2", 1)];
    expect(chunkByDocument(rows, "movein", "fv")).toEqual([rows]);
    expect(chunkByDocument([], "movein", "fv")).toEqual([]);
  });

  it("throws when a single document exceeds the limit", () => {
    const rows = [row("d1", 1), row("d1", 2)];
    expect(() => chunkByDocument(rows, "movein", "fv", size(rows.slice(0, 1)))).toThrow("document exceeds 4MB");
  });
});
