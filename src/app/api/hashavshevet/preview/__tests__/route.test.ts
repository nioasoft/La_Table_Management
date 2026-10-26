import { NextRequest, NextResponse } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { handlePreview } from "@/app/api/hashavshevet/preview/route";
import { copy } from "@/lib/hashavshevet/copy";
import type { ActiveLock } from "@/lib/hashavshevet/classify";
import type { ExportDefinition } from "@/lib/hashavshevet/registry";
import type { BuiltRow, ExportType } from "@/lib/hashavshevet/types";
import { EXPORT_TYPES } from "@/lib/hashavshevet/types";
import type { CompanyRecord, HashavshevetStore } from "@/data-access/hashavshevet";

const { requireAdminOrSuperUser } = vi.hoisted(() => ({
  requireAdminOrSuperUser: vi.fn(),
}));

vi.mock("@/lib/api-middleware", () => ({
  requireAdminOrSuperUser,
  isAuthError: (r: unknown) => r instanceof Response,
}));
// The route's default `deps` import the Drizzle store; no test here may reach the DB.
vi.mock("@/data-access/hashavshevet", () => ({ drizzleHashavshevetStore: {} }));

const VALID_BODY = {
  exportType: "journal_entries",
  params: { franchiseeId: "f1", periodMonth: 6, periodYear: 2026 },
};

const company = (id: string, over: Partial<CompanyRecord> = {}): CompanyRecord => ({
  id,
  fileName: `${id}.dat`,
  nameHe: `חברה ${id}`,
  liveFrom: "2026-01-01",
  requiresApproval: false,
  ...over,
});

function row(over: Partial<BuiltRow> = {}): BuiltRow {
  return {
    rowKey: "k1",
    companyId: "c1",
    documentKey: "d1",
    amount: 100,
    display: {},
    apiRow: { "מפתח חשבון": "secret-payload" },
    periodEnd: "2026-06-30",
    ...over,
  };
}

const lockFor = (over: Partial<ActiveLock> = {}): ActiveLock => ({
  rowKey: "k1",
  companyId: "c1",
  amount: 100,
  sentAt: new Date("2026-07-02T10:00:00"),
  sentBy: "u1",
  sentByName: "מנהלת",
  sendStatus: "awaiting_approval",
  ...over,
});

interface Setup {
  rows?: BuiltRow[];
  blockingErrors?: string[];
  locks?: ActiveLock[];
  companies?: CompanyRecord[];
  build?: ExportDefinition["build"];
}

function deps({ rows = [], blockingErrors = [], locks = [], companies = [], build }: Setup = {}) {
  const store = {
    getCompanies: vi.fn(async () => new Map(companies.map((c) => [c.id, c]))),
    getActiveLocks: vi.fn(async () => locks),
  } as unknown as HashavshevetStore;
  const buildFn = vi.fn(build ?? (async () => ({ rows, blockingErrors })));
  const exports = Object.fromEntries(
    EXPORT_TYPES.map((type) => [
      type,
      { type, plugin: type === "journal_entries" ? "movein" : "imovein", labelHe: type, build: buildFn },
    ]),
  ) as unknown as Record<ExportType, ExportDefinition>;
  return { store, exports, buildFn };
}

function req(body: unknown, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest("http://localhost/api/hashavshevet/preview", {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
    headers: { "content-type": "application/json", ...headers },
  });
}

beforeEach(() => {
  requireAdminOrSuperUser.mockReset();
  requireAdminOrSuperUser.mockResolvedValue({ user: { id: "admin-1" } });
});
afterEach(() => vi.restoreAllMocks());

describe("handlePreview", () => {
  it("groups rows per company with statuses", async () => {
    const d = deps({
      companies: [company("c1", { requiresApproval: true }), company("c2")],
      rows: [
        row({ rowKey: "a", amount: 100.1 }),
        row({ rowKey: "b", amount: 50 }),
        row({ rowKey: "c", companyId: "c2", amount: 20 }),
      ],
      locks: [lockFor({ rowKey: "b", amount: 50 })],
    });

    const res = await handlePreview(req(VALID_BODY), d);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data.exportType).toBe("journal_entries");
    expect(json.data.plugin).toBe("movein");
    expect(json.data.blockingStatuses).toEqual([]);
    expect(json.data.groups).toHaveLength(2);
    const [g1, g2] = json.data.groups;
    expect(g1).toMatchObject({ companyId: "c1", companyName: "חברה c1", requiresApproval: true, totalNew: 100.1 });
    expect(g1.rows.map((r: { status: string }) => r.status)).toEqual(["new", "sent"]);
    expect(g1.rows[1].lock.sentByName).toBe("מנהלת");
    expect(g2).toMatchObject({ companyId: "c2", requiresApproval: false, totalNew: 20 });
    expect(d.store.getActiveLocks).toHaveBeenCalledWith("journal_entries", ["a", "b", "c"]);
    expect(d.buildFn).toHaveBeenCalledWith(VALID_BODY.params);
  });

  it("never exposes the H-Connect payload (apiRow) to the client", async () => {
    const d = deps({
      companies: [company("c1")],
      rows: [row({ rowKey: "a" }), row({ rowKey: "b" }), row({ rowKey: "c", companyId: null })],
      locks: [lockFor({ rowKey: "b" })],
    });
    const res = await handlePreview(req(VALID_BODY), d);
    const text = await res.text();
    const rows = JSON.parse(text).data.groups.flatMap((g: { rows: object[] }) => g.rows);

    expect(rows).toHaveLength(3);
    for (const r of rows) {
      expect(r).not.toHaveProperty("apiRow");
      expect(r).toHaveProperty("rowKey");
      expect(r).toHaveProperty("display");
      expect(r).toHaveProperty("status");
    }
    expect(text).not.toContain("secret-payload");
  });

  it("returns builder blocking errors", async () => {
    const d = deps({ blockingErrors: ["ספק X ללא כרטיס חשבשבת"] });
    const json = await (await handlePreview(req(VALID_BODY), d)).json();
    expect(json.data.blockingErrors).toEqual(["ספק X ללא כרטיס חשבשבת"]);
    expect(json.data.groups).toEqual([]);
  });

  it("blocks a row whose amount rounds to 0.00 or whose apiRow is empty, naming it (I3)", async () => {
    const d = deps({
      companies: [company("c1")],
      rows: [
        row({ rowKey: "ok" }),
        row({ rowKey: "zero", amount: 0.004, display: { "מפתח חשבון": "אושיבה", "מחיר": 0.004 } }),
        row({ rowKey: "neg-zero", amount: -0.001 }),
        row({ rowKey: "empty", apiRow: {}, display: { "מפתח חשבון": "קינג ח" } }),
      ],
    });
    const json = await (await handlePreview(req(VALID_BODY), d)).json();
    expect(json.data.blockingErrors).toEqual([
      copy.unsendableRow("אושיבה · 0.004"),
      copy.unsendableRow("neg-zero"),
      copy.unsendableRow("קינג ח"),
    ]);
    expect(json.data.blockingErrors[0]).toMatch(/[֐-׿]/);
  });

  it("keeps the builder's blocking errors ahead of the unsendable-row ones", async () => {
    const d = deps({ companies: [company("c1")], rows: [row({ amount: 0 })], blockingErrors: ["שגיאת בונה"] });
    const json = await (await handlePreview(req(VALID_BODY), d)).json();
    expect(json.data.blockingErrors).toEqual(["שגיאת בונה", copy.unsendableRow("k1")]);
  });

  it("rows without a company form their own group and block as no_company", async () => {
    const d = deps({
      companies: [company("c1"), company("c3", { liveFrom: null })],
      rows: [
        row({ rowKey: "a", companyId: null, amount: 70 }),
        row({ rowKey: "b" }),
        row({ rowKey: "c", companyId: "c3" }),
      ],
    });
    const json = await (await handlePreview(req(VALID_BODY), d)).json();
    const noCompany = json.data.groups.find((g: { companyId: string | null }) => g.companyId === null);
    expect(noCompany).toMatchObject({ companyName: null, requiresApproval: false, totalNew: 0 });
    expect(noCompany.rows[0].status).toBe("no_company");
    expect(json.data.groups).toHaveLength(3);
    expect([...json.data.blockingStatuses].sort()).toEqual(["no_company", "not_live"]);
  });

  it("totalNew counts only new rows, rounded to cents", async () => {
    const d = deps({
      companies: [company("c1", { liveFrom: "2026-06-01" })],
      rows: [
        row({ rowKey: "n1", amount: 0.1 }),
        row({ rowKey: "n2", amount: 0.2 }),
        row({ rowKey: "n3", amount: -0.05 }),
        row({ rowKey: "sent", amount: 500 }),
        row({ rowKey: "changed", amount: 600 }),
        row({ rowKey: "old", amount: 700, periodEnd: "2026-05-31" }),
      ],
      locks: [lockFor({ rowKey: "sent", amount: 500 }), lockFor({ rowKey: "changed", amount: 599 })],
    });
    const json = await (await handlePreview(req(VALID_BODY), d)).json();
    const [group] = json.data.groups;
    expect(group.rows.map((r: { status: string }) => r.status)).toEqual([
      "new", "new", "new", "sent", "changed", "before_live",
    ]);
    expect(group.totalNew).toBe(0.25);
  });

  it("400 on invalid body", async () => {
    const d = deps();
    const res = await handlePreview(req({ exportType: "nope" }), d);
    const json = await res.json();
    expect(res.status).toBe(400);
    expect(json.success).toBe(false);
    expect(json.error).toMatch(/[֐-׿]/);
    expect(d.buildFn).not.toHaveBeenCalled();
  });

  it("400 on malformed JSON", async () => {
    const d = deps();
    const res = await handlePreview(req("{not json"), d);
    expect(res.status).toBe(400);
    expect((await res.json()).success).toBe(false);
    expect(d.buildFn).not.toHaveBeenCalled();
  });

  it("401 when unauthenticated", async () => {
    requireAdminOrSuperUser.mockResolvedValue(NextResponse.json({ success: false }, { status: 401 }));
    const d = deps();
    const res = await handlePreview(req(VALID_BODY), d);
    expect(res.status).toBe(401);
    expect(d.buildFn).not.toHaveBeenCalled();
    expect(d.store.getCompanies).not.toHaveBeenCalled();
  });

  it("500 with requestId and no stack when the builder throws", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    const d = deps({
      build: async () => {
        throw new Error("boom: secret detail");
      },
    });

    const res = await handlePreview(req(VALID_BODY, { "x-vercel-id": "req-42" }), d);
    const text = await res.text();
    const json = JSON.parse(text);

    expect(res.status).toBe(500);
    expect(json.success).toBe(false);
    expect(json.requestId).toBe("req-42");
    expect(json.error).toContain("req-42");
    expect(text).not.toContain("boom");
    expect(text).not.toMatch(/\bat \S+ \(/);

    // M3: the error's name, never its message (a Drizzle error's message carries row payloads).
    const line = JSON.parse(String(errorLog.mock.calls[0][0]));
    expect(line).toMatchObject({ requestId: "req-42", error: "Error" });
    expect(JSON.stringify(line)).not.toContain("secret");
    expect(line.stack).toBeUndefined();
  });

  it("generates a requestId when x-vercel-id is absent", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const d = deps({ build: async () => { throw new Error("x"); } });
    const json = await (await handlePreview(req(VALID_BODY), d)).json();
    expect(typeof json.requestId).toBe("string");
    expect(json.requestId.length).toBeGreaterThan(10);
  });
});
