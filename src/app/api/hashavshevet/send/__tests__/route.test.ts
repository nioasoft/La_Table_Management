import { NextRequest, NextResponse } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { handleSend, POST } from "@/app/api/hashavshevet/send/route";
import { drizzleHashavshevetStore, type CompanyRecord, type HashavshevetStore } from "@/data-access/hashavshevet";
import type { ActiveLock } from "@/lib/hashavshevet/classify";
import { apiErrorMessage, copy } from "@/lib/hashavshevet/copy";
import { EXPORTS, type ExportDefinition } from "@/lib/hashavshevet/registry";
import type { BuiltRow, ExportType, HConnectOutcome } from "@/lib/hashavshevet/types";
import { EXPORT_TYPES } from "@/lib/hashavshevet/types";
import { sendToHashavshevet } from "@/lib/hconnect";
import { RateLimitConfigs } from "@/lib/rate-limit";

const h = vi.hoisted(() => {
  class LockConflictError extends Error {}
  return {
    LockConflictError,
    requireAdminOrSuperUser: vi.fn(),
    checkRateLimit: vi.fn(),
  };
});

vi.mock("@/lib/api-middleware", () => ({
  requireAdminOrSuperUser: h.requireAdminOrSuperUser,
  isAuthError: (r: unknown) => r instanceof Response,
}));
// Nothing here may reach the DB or H-Connect: the default deps of the route import both modules.
vi.mock("@/data-access/hashavshevet", () => ({
  LockConflictError: h.LockConflictError,
  drizzleHashavshevetStore: {
    getCompanies: vi.fn(),
    getActiveLocks: vi.fn(),
    createSendWithLocks: vi.fn(),
    finishSend: vi.fn(),
  },
}));
// ponytail: fake chunker = one request per document, so tests pick chunk boundaries via documentKey.
vi.mock("@/lib/hconnect", () => ({
  HCONNECT_TIMEOUT_MS: 30_000,
  sendToHashavshevet: vi.fn(),
  chunkByDocument: (rows: BuiltRow[]) => {
    const docs = new Map<string, BuiltRow[]>();
    for (const r of rows) docs.set(r.documentKey, [...(docs.get(r.documentKey) ?? []), r]);
    return [...docs.values()];
  },
}));
vi.mock("@/lib/rate-limit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/rate-limit")>()),
  checkRateLimit: h.checkRateLimit,
}));

const PARAMS = { franchiseeId: "f1", periodMonth: 6, periodYear: 2026 };

const company = (id: string, over: Partial<CompanyRecord> = {}): CompanyRecord => ({
  id,
  fileName: `file-${id}`,
  nameHe: `חברה ${id}`,
  liveFrom: "2026-01-01",
  requiresApproval: true,
  ...over,
});

function row(rowKey: string, over: Partial<BuiltRow> = {}): BuiltRow {
  return {
    rowKey,
    companyId: "c1",
    documentKey: "d1",
    amount: 100,
    display: {},
    apiRow: { Reference: rowKey },
    periodEnd: "2026-06-30",
    ...over,
  };
}

const lockFor = (rowKey: string, amount: number): ActiveLock => ({
  rowKey,
  companyId: "c1",
  amount,
  sentAt: new Date("2026-07-02T10:00:00"),
  sentBy: "u1",
  sentByName: "מנהלת",
  sendStatus: "awaiting_approval",
});

const OK_BODY = { apiRes: { status: "ok" } };
const OK: HConnectOutcome = { kind: "ok", latencyMs: 12, httpStatus: 200, body: OK_BODY };
const UNKNOWN: HConnectOutcome = { kind: "unknown", message: "timeout" };
const apiError = (rowErrors: Record<number, string> = {}): HConnectOutcome => ({
  kind: "api_error",
  code: "validation",
  message: "invalid data",
  rowErrors,
  httpStatus: 200,
  body: { apiRes: { err: "invalid data" } },
});

interface Setup {
  rows?: BuiltRow[];
  blockingErrors?: string[];
  locks?: ActiveLock[];
  companies?: CompanyRecord[];
  outcomes?: HConnectOutcome[];
  /** Fake clock: ms each H-Connect request / each createSendWithLocks takes. */
  sendMs?: number;
  lockMs?: number;
}

function deps(setup: Setup = {}) {
  const { rows = [], blockingErrors = [], locks = [], companies = [company("c1")], outcomes = [] } = setup;
  const clock = { t: 0 };
  let n = 0;
  const store = {
    getCompanies: vi.fn(async () => new Map(companies.map((c) => [c.id, c]))),
    getActiveLocks: vi.fn(async () => locks),
    createSendWithLocks: vi.fn(async () => {
      clock.t += setup.lockMs ?? 0;
      return { sendId: `s${++n}` };
    }),
    finishSend: vi.fn(async () => {}),
  } satisfies Partial<HashavshevetStore>;
  const queue = [...outcomes];
  const send = vi.fn(async () => {
    clock.t += setup.sendMs ?? 0;
    return queue.shift() ?? OK;
  });
  const now = () => clock.t;
  const build = vi.fn(async () => ({ rows, blockingErrors }));
  const onApproved = vi.fn(async (_sendId: string, _rowKeys: string[]) => {});
  const exports = Object.fromEntries(
    EXPORT_TYPES.map((type) => [type, { type, plugin: "movein", labelHe: type, build, onApproved }]),
  ) as unknown as Record<ExportType, ExportDefinition>;
  return { store, exports, send, build, onApproved, now };
}

const expectedOf = (rows: BuiltRow[]) => rows.map(({ rowKey, amount }) => ({ rowKey, amount }));

function req(body: unknown, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest("http://localhost/api/hashavshevet/send", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json", "x-vercel-id": "req-1", ...headers },
  });
}

const sendReq = (expected: { rowKey: string; amount: number }[]) =>
  req({ exportType: "journal_entries", params: PARAMS, expected });

beforeEach(() => {
  h.requireAdminOrSuperUser.mockReset().mockResolvedValue({ user: { id: "admin-1" } });
  h.checkRateLimit.mockReset().mockReturnValue({ success: true, remaining: 2, reset: Date.now() + 1000, limit: 3 });
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("handleSend", () => {
  it("sends new rows and leaves them awaiting approval", async () => {
    const rows = [row("a", { amount: 100.1 }), row("b", { amount: 50 })];
    const d = deps({ rows });

    const res = await handleSend(sendReq(expectedOf(rows)), d);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(d.store.createSendWithLocks).toHaveBeenCalledWith(
      expect.objectContaining({
        exportType: "journal_entries",
        companyId: "c1",
        targetFileName: "file-c1",
        plugin: "movein",
        params: PARAMS,
        sentBy: "admin-1",
        rows: [expect.objectContaining({ rowKey: "a" }), expect.objectContaining({ rowKey: "b" })],
      }),
    );
    expect(d.send).toHaveBeenCalledTimes(1);
    expect(d.send).toHaveBeenCalledWith("movein", "file-c1", [{ Reference: "a" }, { Reference: "b" }]);
    expect(d.store.finishSend).toHaveBeenCalledWith("s1", {
      status: "awaiting_approval",
      failedRowKeys: [],
      httpStatus: 200,
      response: OK_BODY,
      latencyMs: 12,
      requestId: "req-1",
    });
    expect(json).toEqual({
      success: true,
      data: {
        sends: [
          {
            sendId: "s1",
            companyId: "c1",
            companyName: "חברה c1",
            status: "awaiting_approval",
            rowCount: 2,
            total: 150.1,
            chunks: 1,
            message: copy.sentAwaitingApproval(2, 150.1, "חברה c1", 1),
          },
        ],
      },
    });

    const logCalls = vi.mocked(console.log).mock.calls;
    const line = JSON.parse(String(logCalls[logCalls.length - 1][0]));
    expect(line).toMatchObject({ requestId: "req-1", exportType: "journal_entries", companyId: "c1", status: "awaiting_approval", rows: 2, chunks: 1 });
    expect(JSON.stringify(line)).not.toContain("Reference");
  });

  it("auto-approves when company does not require approval", async () => {
    const rows = [row("a"), row("b", { documentKey: "d2" })];
    const d = deps({ rows, companies: [company("c1", { requiresApproval: false })] });
    const json = await (await handleSend(sendReq(expectedOf(rows)), d)).json();

    expect(d.store.finishSend).toHaveBeenCalledWith("s1", expect.objectContaining({ status: "approved", failedRowKeys: [] }));
    expect(json.data.sends[0]).toMatchObject({ status: "approved", chunks: 2, rowCount: 2, total: 200 });
    expect(json.data.sends[0].message).toBe(copy.sentApproved(2, 200, "חברה c1", 2));
    // Ruling R27: settled approved here, so the export's bookkeeping runs now, on the delivered rows.
    expect(d.onApproved).toHaveBeenCalledWith("s1", ["a", "b"]);
  });

  it("never runs the approve hook for a send that waits for Reut or failed", async () => {
    const rows = [row("a"), row("b", { documentKey: "d2" })];
    for (const outcomes of [[OK, OK], [OK, apiError()], [apiError()], [UNKNOWN]]) {
      const d = deps({ rows, outcomes });
      await handleSend(sendReq(expectedOf(rows)), d);
      expect(d.onApproved).not.toHaveBeenCalled();
    }
  });

  it("a failing approve hook keeps the send's result and says the bookkeeping failed", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    const rows = [row("a")];
    const d = deps({ rows, companies: [company("c1", { requiresApproval: false })] });
    d.onApproved.mockRejectedValueOnce(Object.assign(new Error("Failed query: update ... params: secret-row"), { cause: { code: "40P01" } }));

    const res = await handleSend(sendReq(expectedOf(rows)), d);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.sends[0]).toMatchObject({ sendId: "s1", status: "approved", rowCount: 1 });
    expect(json.data.sends[0].message).toBe(`${copy.sentApproved(1, 100, "חברה c1", 1)}. ${copy.approvedBookkeepingFailed}`);
    const logged = errorLog.mock.calls.map(([line]) => String(line)).join("\n");
    expect(logged).toContain("hashavshevet.on_approved_failed");
    expect(logged).toContain("40P01");
    expect(logged).not.toContain("secret-row");
  });

  it("drifted rows abort without locking", async () => {
    const rows = [row("a", { amount: 100 }), row("b")];
    for (const expected of [
      [{ rowKey: "a", amount: 101 }, { rowKey: "b", amount: 100 }], // amount changed
      [{ rowKey: "a", amount: 100 }], // new row appeared
      [...expectedOf(rows), { rowKey: "c", amount: 1 }], // row disappeared
    ]) {
      const d = deps({ rows });
      const res = await handleSend(sendReq(expected), d);
      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ success: false, error: copy.dataChanged });
      expect(d.store.createSendWithLocks).not.toHaveBeenCalled();
      expect(d.send).not.toHaveBeenCalled();
    }
  });

  it("accepts amounts equal after rounding to cents", async () => {
    const d = deps({ rows: [row("a", { amount: 100.004 })] });
    const res = await handleSend(sendReq([{ rowKey: "a", amount: 100 }]), d);
    expect(res.status).toBe(200);
  });

  it("blocking statuses or errors return 422", async () => {
    const withNoCompany = deps({ rows: [row("a"), row("b", { companyId: null })] });
    const res = await handleSend(sendReq([{ rowKey: "a", amount: 100 }]), withNoCompany);
    const json = await res.json();
    expect(res.status).toBe(422);
    expect(json.success).toBe(false);
    expect(json.error).toMatch(/[֐-׿]/);
    expect(json.data).toEqual({ blockingErrors: [], blockingStatuses: ["no_company"] });
    expect(withNoCompany.store.createSendWithLocks).not.toHaveBeenCalled();

    const withErrors = deps({ rows: [row("a")], blockingErrors: ["ספק X ללא כרטיס"] });
    const res2 = await handleSend(sendReq([{ rowKey: "a", amount: 100 }]), withErrors);
    expect(res2.status).toBe(422);
    expect((await res2.json()).data.blockingErrors).toEqual(["ספק X ללא כרטיס"]);
    expect(withErrors.send).not.toHaveBeenCalled();
  });

  it("a zero-amount or empty-apiRow row blocks the send with 422 before anything is locked (I3)", async () => {
    for (const bad of [row("z", { amount: 0.001 }), row("e", { apiRow: {} })]) {
      const rows = [row("a"), bad];
      const d = deps({ rows });
      const res = await handleSend(sendReq(expectedOf(rows)), d);
      expect(res.status).toBe(422);
      expect((await res.json()).data.blockingErrors).toEqual([copy.unsendableRow(bad.rowKey)]);
      expect(d.store.createSendWithLocks).not.toHaveBeenCalled();
      expect(d.send).not.toHaveBeenCalled();
    }
  });

  it("concurrent send loses on unique lock", async () => {
    const rows = [row("a")];
    const d = deps({ rows });
    d.store.createSendWithLocks.mockRejectedValueOnce(new h.LockConflictError());

    const res = await handleSend(sendReq(expectedOf(rows)), d);
    const json = await res.json();

    expect(res.status).toBe(409);
    expect(json.success).toBe(false);
    expect(json.error).toMatch(/[֐-׿]/);
    expect(json.data.sends).toEqual([]);
    expect(d.send).not.toHaveBeenCalled();
    expect(d.store.finishSend).not.toHaveBeenCalled();
  });

  it("api validation error fails and releases", async () => {
    const rows = [row("a"), row("b")];
    const d = deps({ rows, outcomes: [apiError({ 1: "quantity:  type error , 1 is not  decimal" })] });

    const res = await handleSend(sendReq(expectedOf(rows)), d);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(d.store.finishSend).toHaveBeenCalledWith(
      "s1",
      expect.objectContaining({ status: "failed", failedRowKeys: ["a", "b"], httpStatus: 200, requestId: "req-1" }),
    );
    const [sent] = json.data.sends;
    expect(sent).toMatchObject({ status: "failed", rowCount: 0, total: 0, chunks: 1 });
    expect(sent.message).toBe(apiErrorMessage("validation", "movein", "חברה c1"));
    expect(sent.errors).toHaveLength(1);
    expect(sent.errors[0].rowKey).toBe("b");
    expect(sent.errors[0].message).toContain("quantity");
    expect(sent.errors[0].message).toMatch(/[֐-׿]/);
  });

  it("partial failure releases only failed chunk", async () => {
    const rows = [
      row("a", { documentKey: "d1", amount: 10 }),
      row("b", { documentKey: "d2" }),
      row("c", { documentKey: "d3" }),
    ];
    const d = deps({ rows, outcomes: [OK, apiError({ 0: "price: bad" })] });

    const json = await (await handleSend(sendReq(expectedOf(rows)), d)).json();

    expect(d.send).toHaveBeenCalledTimes(2);
    // Ruling R11: chunk 1 reached the temporary batch, so the send waits for Reut's decision.
    expect(d.store.finishSend).toHaveBeenCalledWith(
      "s1",
      expect.objectContaining({ status: "awaiting_approval", failedRowKeys: ["b", "c"] }),
    );
    const [sent] = json.data.sends;
    expect(sent).toMatchObject({ status: "awaiting_approval", rowCount: 1, total: 10, chunks: 2 });
    expect(sent.errors).toEqual([{ rowKey: "b", message: expect.stringContaining("price: bad") }]);
    expect(sent.message).toContain(apiErrorMessage("validation", "movein", "חברה c1"));
  });

  it("unknown outcome keeps locks", async () => {
    const rows = [row("a"), row("b")];
    const d = deps({ rows, outcomes: [UNKNOWN] });
    const json = await (await handleSend(sendReq(expectedOf(rows)), d)).json();

    expect(d.store.finishSend).toHaveBeenCalledWith(
      "s1",
      expect.objectContaining({ status: "unknown", failedRowKeys: [], requestId: "req-1" }),
    );
    expect(json.data.sends[0]).toMatchObject({ status: "unknown", rowCount: 2, message: copy.unknownOutcome });
  });

  it("unknown mid-way keeps that chunk locked and releases only unattempted", async () => {
    const rows = [row("a", { documentKey: "d1" }), row("b", { documentKey: "d2" }), row("c", { documentKey: "d3" })];
    const d = deps({ rows, outcomes: [OK, UNKNOWN] });
    const json = await (await handleSend(sendReq(expectedOf(rows)), d)).json();

    expect(d.send).toHaveBeenCalledTimes(2);
    expect(d.store.finishSend).toHaveBeenCalledWith("s1", expect.objectContaining({ status: "unknown", failedRowKeys: ["c"] }));
    expect(json.data.sends[0]).toMatchObject({ status: "unknown", rowCount: 2, total: 200, chunks: 2 });
  });

  it("rate limited returns 429", async () => {
    h.checkRateLimit.mockReturnValue({ success: false, remaining: 0, reset: Date.now() + 60_000, limit: 30 });
    const d = deps({ rows: [row("a")] });

    const res = await handleSend(sendReq([{ rowKey: "a", amount: 100 }]), d);

    expect(res.status).toBe(429);
    expect(res.headers.get("X-RateLimit-Limit")).toBe("30");
    expect((await res.json()).error).toMatch(/[֐-׿]/);
    // Ruling R15: Reut sends 20+ exports at month start; row locks, not the limiter, stop duplicates.
    expect(h.checkRateLimit).toHaveBeenCalledWith(expect.stringContaining("admin-1"), RateLimitConfigs.api);
    expect(d.build).not.toHaveBeenCalled();
  });

  it("only new rows are sent", async () => {
    const rows = [
      row("new"),
      row("sent", { amount: 500 }),
      row("changed", { amount: 600 }),
      row("old", { periodEnd: "2025-12-31" }),
    ];
    const d = deps({ rows, locks: [lockFor("sent", 500), lockFor("changed", 599)] });

    const res = await handleSend(sendReq([{ rowKey: "new", amount: 100 }]), d);

    expect(res.status).toBe(200);
    expect(d.send).toHaveBeenCalledWith("movein", "file-c1", [{ Reference: "new" }]);
    expect(d.store.createSendWithLocks).toHaveBeenCalledWith(
      expect.objectContaining({ rows: [expect.objectContaining({ rowKey: "new", status: "new" })] }),
    );
  });

  it("splits per company: one locked send per company with only its rows", async () => {
    const rows = [row("a"), row("b", { companyId: "c2" }), row("c")];
    const d = deps({ rows, companies: [company("c1"), company("c2", { requiresApproval: false })] });

    const json = await (await handleSend(sendReq(expectedOf(rows)), d)).json();

    const calls = d.store.createSendWithLocks.mock.calls as unknown as [{ companyId: string; targetFileName: string; rows: BuiltRow[] }][];
    expect(calls.map(([c]) => [c.companyId, c.targetFileName, c.rows.map((r) => r.rowKey)])).toEqual([
      ["c1", "file-c1", ["a", "c"]],
      ["c2", "file-c2", ["b"]],
    ]);
    expect(d.send).toHaveBeenNthCalledWith(1, "movein", "file-c1", [{ Reference: "a" }, { Reference: "c" }]);
    expect(d.send).toHaveBeenNthCalledWith(2, "movein", "file-c2", [{ Reference: "b" }]);
    expect(json.data.sends.map((s: { sendId: string; status: string }) => [s.sendId, s.status])).toEqual([
      ["s1", "awaiting_approval"],
      ["s2", "approved"],
    ]);
  });

  it("lock conflict on a later company still reports the sends already made", async () => {
    const rows = [row("a"), row("b", { companyId: "c2" })];
    const d = deps({ rows, companies: [company("c1"), company("c2")] });
    d.store.createSendWithLocks
      .mockResolvedValueOnce({ sendId: "s1" })
      .mockRejectedValueOnce(new h.LockConflictError());

    const res = await handleSend(sendReq(expectedOf(rows)), d);
    const json = await res.json();

    expect(res.status).toBe(409);
    expect(json.data.sends).toHaveLength(1);
    expect(json.data.sends[0]).toMatchObject({ sendId: "s1", companyId: "c1", status: "awaiting_approval" });
    expect(d.send).toHaveBeenCalledTimes(1);
  });

  it("exception after createSendWithLocks calls finishSend unknown then 500", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    const rows = [row("a", { documentKey: "d1" }), row("b", { documentKey: "d2" })];
    const d = deps({ rows });
    d.send.mockRejectedValueOnce(new Error("boom: secret detail"));

    const res = await handleSend(sendReq(expectedOf(rows)), d);
    const text = await res.text();

    expect(d.store.finishSend).toHaveBeenCalledWith("s1", { status: "unknown", failedRowKeys: ["b"], requestId: "req-1" });
    expect(res.status).toBe(500);
    expect(JSON.parse(text)).toEqual({ success: false, error: copy.serverError("req-1"), requestId: "req-1" });
    expect(text).not.toContain("boom");
    expect(errorLog).toHaveBeenCalled();
  });

  it("400 on invalid body", async () => {
    const d = deps({ rows: [row("a")] });
    const res = await handleSend(sendReq([]), d);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe(copy.invalidRequest);
    expect(d.build).not.toHaveBeenCalled();
  });

  it("401 when unauthenticated", async () => {
    h.requireAdminOrSuperUser.mockResolvedValue(NextResponse.json({ success: false }, { status: 401 }));
    const d = deps({ rows: [row("a")] });
    const res = await handleSend(sendReq([{ rowKey: "a", amount: 100 }]), d);
    expect(res.status).toBe(401);
    expect(d.build).not.toHaveBeenCalled();
    expect(h.checkRateLimit).not.toHaveBeenCalled();
  });
});

describe("time budget (ruling R16)", () => {
  // Budget = (maxDuration 300 - 30) s = 270 s; a request may only start if 30 s (H-Connect timeout) still fit.
  it("exports maxDuration 300", async () => {
    expect((await import("@/app/api/hashavshevet/send/route")).maxDuration).toBe(300);
  });

  it("stops before a chunk that may not finish in time: it and later chunks are released", async () => {
    const rows = [row("a", { documentKey: "d1", amount: 10 }), row("b", { documentKey: "d2" }), row("c", { documentKey: "d3" })];
    const d = deps({ rows, sendMs: 250_000 }); // after chunk 1: 250 s + 30 s > 270 s

    const res = await handleSend(sendReq(expectedOf(rows)), d);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(d.send).toHaveBeenCalledTimes(1);
    expect(d.store.finishSend).toHaveBeenCalledWith(
      "s1",
      expect.objectContaining({ status: "awaiting_approval", failedRowKeys: ["b", "c"] }),
    );
    const [sent] = json.data.sends;
    expect(sent).toMatchObject({ status: "awaiting_approval", rowCount: 1, total: 10, chunks: 1 });
    expect(sent.message).toContain(copy.sendTimeBudgetExceeded);
  });

  it("no chunk started after locking: the send fails and every row is released", async () => {
    const rows = [row("a"), row("b", { documentKey: "d2" })];
    const d = deps({ rows, lockMs: 241_000 });

    const json = await (await handleSend(sendReq(expectedOf(rows)), d)).json();

    expect(d.send).not.toHaveBeenCalled();
    expect(d.store.finishSend).toHaveBeenCalledWith("s1", expect.objectContaining({ status: "failed", failedRowKeys: ["a", "b"] }));
    expect(json.data.sends[0]).toMatchObject({ status: "failed", rowCount: 0, chunks: 0, message: copy.sendTimeBudgetExceeded });
  });

  it("a company not reached in time is never locked and is reported as not sent", async () => {
    const rows = [row("a"), row("b", { companyId: "c2", amount: 40 })];
    const d = deps({ rows, companies: [company("c1"), company("c2")], sendMs: 250_000 });

    const res = await handleSend(sendReq(expectedOf(rows)), d);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(d.store.createSendWithLocks).toHaveBeenCalledTimes(1);
    expect(d.send).toHaveBeenCalledTimes(1);
    expect(json.data.sends).toEqual([
      expect.objectContaining({ sendId: "s1", companyId: "c1", status: "awaiting_approval" }),
      {
        sendId: null,
        companyId: "c2",
        companyName: "חברה c2",
        status: "not_sent",
        rowCount: 0,
        total: 0,
        chunks: 0,
        message: copy.sendTimeBudgetExceeded,
      },
    ]);
  });
});

describe("POST", () => {
  it("uses the real default deps even when Next passes a route context", async () => {
    const rows = [row("a")];
    const build = vi.spyOn(EXPORTS.journal_entries, "build").mockResolvedValue({ rows, blockingErrors: [] });
    const store = vi.mocked(drizzleHashavshevetStore);
    store.getCompanies.mockResolvedValue(new Map([["c1", company("c1")]]));
    store.getActiveLocks.mockResolvedValue([]);
    store.createSendWithLocks.mockResolvedValue({ sendId: "s9" });
    store.finishSend.mockResolvedValue();
    vi.mocked(sendToHashavshevet).mockResolvedValue(OK);

    // Call it the way Next does: with a route context as the second argument.
    const callAsNext = POST as (req: NextRequest, ctx: unknown) => Promise<Response>;
    const res = await callAsNext(sendReq(expectedOf(rows)), { params: Promise.resolve({}) });

    expect(res.status).toBe(200);
    expect(build).toHaveBeenCalledWith(PARAMS);
    expect(store.createSendWithLocks).toHaveBeenCalled();
    expect(sendToHashavshevet).toHaveBeenCalledWith("movein", "file-c1", [{ Reference: "a" }]);
  });
});
