import { NextRequest, NextResponse } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { handleListCompanies } from "@/app/api/hashavshevet/companies/route";
import { handlePatchCompany, PATCH as patchCompanyRoute } from "@/app/api/hashavshevet/companies/[id]/route";
import { handleGetMappings, handlePatchMapping } from "@/app/api/hashavshevet/mappings/route";
import { handleUnlockRow, POST as unlockRoute } from "@/app/api/hashavshevet/rows/[id]/unlock/route";
import { handleListSends } from "@/app/api/hashavshevet/sends/route";
import { handleResolveSend, POST as resolveRoute } from "@/app/api/hashavshevet/sends/[id]/resolve/route";
import type { CompanyRow, HashavshevetStore, SendSummary } from "@/data-access/hashavshevet";
import { copy } from "@/lib/hashavshevet/copy";

type Role = "none" | "admin" | "super_user";
const h = vi.hoisted(() => {
  class InvalidTransitionError extends Error {
    constructor(
      readonly outcome: string,
      readonly currentStatus: string | null,
    ) {
      super("invalid transition");
    }
  }
  class RowNotLockedError extends Error {}
  return { InvalidTransitionError, RowNotLockedError, role: "admin" as Role, defaultStore: {} as Record<string, unknown> };
});

// Mirrors api-middleware: requireSuperUser lets only super_user in, requireAdminOrSuperUser lets both.
vi.mock("@/lib/api-middleware", () => {
  const gate = (allowed: Role[]) => async () => {
    if (h.role === "none") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!allowed.includes(h.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    return { user: { id: `${h.role}-1` } };
  };
  return {
    requireSuperUser: gate(["super_user"]),
    requireAdminOrSuperUser: gate(["admin", "super_user"]),
    isAuthError: (r: unknown) => r instanceof Response,
  };
});
// Nothing here may reach the DB: the default deps of every route import this module.
vi.mock("@/data-access/hashavshevet", () => ({
  InvalidTransitionError: h.InvalidTransitionError,
  RowNotLockedError: h.RowNotLockedError,
  drizzleHashavshevetStore: h.defaultStore,
}));

const NOW = new Date("2026-07-02T12:00:00").getTime();
const MINUTES = 60_000;

const companyRow = (over: Partial<CompanyRow> = {}): CompanyRow => ({
  id: "c1",
  fileName: "fv",
  compId: 40,
  nameHe: "ויני",
  liveFrom: null,
  requiresApproval: true,
  ...over,
});

const send = (over: Partial<SendSummary> = {}): SendSummary => ({
  id: "s1",
  exportType: "royalties",
  companyId: "c1",
  companyName: "ויני",
  targetFileName: "fv",
  status: "awaiting_approval",
  rowCount: 2,
  total: 150.1,
  sentAt: new Date(NOW - 5 * MINUTES),
  sentBy: "רעות",
  resolvedAt: null,
  resolutionNote: null,
  ...over,
});

function fakeStore() {
  return {
    listCompanies: vi.fn(async () => [companyRow()]),
    updateCompany: vi.fn<HashavshevetStore["updateCompany"]>(async () => companyRow({ liveFrom: "2026-07-01" })),
    listMappings: vi.fn(async () => ({ brands: [], franchisees: [] })),
    setMapping: vi.fn<HashavshevetStore["setMapping"]>(async () => true),
    listSends: vi.fn(async () => [send()]),
    countAwaitingApproval: vi.fn(async () => 3),
    resolveSend: vi.fn<HashavshevetStore["resolveSend"]>(async () => {}),
    unlockRow: vi.fn<HashavshevetStore["unlockRow"]>(async () => {}),
  };
}

function req(method: string, url: string, body?: unknown): NextRequest {
  return new NextRequest(`http://localhost/api/hashavshevet/${url}`, {
    method,
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
    headers: { "content-type": "application/json", "x-vercel-id": "req-1" },
  });
}

let store: ReturnType<typeof fakeStore>;
beforeEach(() => {
  h.role = "super_user";
  store = fakeStore();
  Object.assign(h.defaultStore, fakeStore());
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("auth", () => {
  it("answers 401 to an unauthenticated read", async () => {
    h.role = "none";
    expect((await handleListCompanies(req("GET", "companies"), { store })).status).toBe(401);
  });
});

describe("GET companies", () => {
  it("is open to an admin and lists the companies", async () => {
    h.role = "admin";
    const res = await handleListCompanies(req("GET", "companies"), { store });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, data: { companies: [companyRow()] } });
  });

  it("answers a generic 500 with the request id and no stack when the store fails", async () => {
    store.listCompanies.mockRejectedValue(new Error("connection refused at db.internal"));
    const res = await handleListCompanies(req("GET", "companies"), { store });
    const json = await res.json();
    expect(res.status).toBe(500);
    expect(json).toEqual({ success: false, error: copy.serverError("req-1"), requestId: "req-1" });
    expect(JSON.stringify(json)).not.toContain("db.internal");
  });
});

describe("PATCH companies/[id]", () => {
  const patch = (body: unknown, s = store) => handlePatchCompany(req("PATCH", "companies/c1", body), "c1", { store: s });

  it("is super-user only: an admin gets 403 and nothing is written", async () => {
    h.role = "admin";
    expect((await patch({ liveFrom: "2026-07-01" })).status).toBe(403);
    expect(store.updateCompany).not.toHaveBeenCalled();
  });

  it("hands liveFrom to the store exactly as sent, with the acting user", async () => {
    const res = await patch({ liveFrom: "2026-07-01" });
    expect(res.status).toBe(200);
    expect(store.updateCompany).toHaveBeenCalledWith("c1", { liveFrom: "2026-07-01" }, "super_user-1");
    expect((await res.json()).data.company.id).toBe("c1");
  });

  it("deactivates a company with liveFrom null", async () => {
    await patch({ liveFrom: null });
    expect(store.updateCompany).toHaveBeenCalledWith("c1", { liveFrom: null }, "super_user-1");
  });

  it("updates requiresApproval alone", async () => {
    await patch({ requiresApproval: false });
    expect(store.updateCompany).toHaveBeenCalledWith("c1", { requiresApproval: false }, "super_user-1");
  });

  it.each(["01/07/2026", "2026-13-45", "2026-02-30", 5])("rejects liveFrom %j with 400", async (liveFrom) => {
    expect((await patch({ liveFrom })).status).toBe(400);
    expect(store.updateCompany).not.toHaveBeenCalled();
  });

  it("answers 404 when the company does not exist", async () => {
    store.updateCompany.mockResolvedValue(null);
    const res = await patch({ liveFrom: "2026-07-01" });
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe(copy.companyNotFound);
  });

  it("answers 400 to a body that is not JSON", async () => {
    expect((await patch("not json")).status).toBe(400);
  });

  it("the exported PATCH forwards the URL id from the route context", async () => {
    const res = await patchCompanyRoute(req("PATCH", "companies/c9", { requiresApproval: false }), {
      params: Promise.resolve({ id: "c9" }),
    });
    expect(res.status).toBe(200);
    expect(h.defaultStore.updateCompany).toHaveBeenCalledWith("c9", { requiresApproval: false }, "super_user-1");
  });
});

describe("mappings", () => {
  it("GET is open to an admin", async () => {
    h.role = "admin";
    const res = await handleGetMappings(req("GET", "mappings"), { store });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, data: { brands: [], franchisees: [] } });
  });

  const patch = (body: unknown) => handlePatchMapping(req("PATCH", "mappings", body), { store });

  it("PATCH is super-user only", async () => {
    h.role = "admin";
    expect((await patch({ kind: "brand", id: "b1", companyId: "c1" })).status).toBe(403);
    expect(store.setMapping).not.toHaveBeenCalled();
  });

  it("assigns a company, and clears one with null", async () => {
    expect((await patch({ kind: "franchisee", id: "f1", companyId: "c1" })).status).toBe(200);
    expect(store.setMapping).toHaveBeenLastCalledWith("franchisee", "f1", "c1");
    expect((await patch({ kind: "brand", id: "b1", companyId: null })).status).toBe(200);
    expect(store.setMapping).toHaveBeenLastCalledWith("brand", "b1", null);
  });

  it("answers 404 when the brand, franchisee or company does not exist", async () => {
    store.setMapping.mockResolvedValue(false);
    const res = await patch({ kind: "brand", id: "nope", companyId: "c1" });
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe(copy.mappingTargetNotFound);
  });

  it("answers 400 to an unknown kind", async () => {
    expect((await patch({ kind: "supplier", id: "x", companyId: null })).status).toBe(400);
  });
});

describe("GET sends", () => {
  const list = (query = "") => handleListSends(req("GET", `sends${query}`), { store, now: () => NOW });

  it("is open to an admin and passes the filters to the store", async () => {
    h.role = "admin";
    const res = await list("?status=unknown&companyId=c1&exportType=royalties");
    expect(res.status).toBe(200);
    expect(store.listSends).toHaveBeenCalledWith({ status: "unknown", companyId: "c1", exportType: "royalties" });
  });

  it("lists with no filter when the query is empty", async () => {
    await list();
    expect(store.listSends).toHaveBeenCalledWith({});
  });

  it("answers 400 to an unknown status", async () => {
    expect((await list("?status=bogus")).status).toBe(400);
    expect(store.listSends).not.toHaveBeenCalled();
  });

  it("marks a pending send older than 15 minutes as stalePending, and only that", async () => {
    store.listSends.mockResolvedValue([
      send({ id: "old-pending", status: "pending", sentAt: new Date(NOW - 16 * MINUTES) }),
      send({ id: "fresh-pending", status: "pending", sentAt: new Date(NOW - 14 * MINUTES) }),
      send({ id: "old-awaiting", status: "awaiting_approval", sentAt: new Date(NOW - 24 * 60 * MINUTES) }),
    ]);
    const { data } = await (await list()).json();
    expect(data.sends.map((s: { id: string; stalePending: boolean }) => [s.id, s.stalePending])).toEqual([
      ["old-pending", true],
      ["fresh-pending", false],
      ["old-awaiting", false],
    ]);
  });

  it("returns only the number with ?count=awaiting", async () => {
    const res = await list("?count=awaiting");
    expect(await res.json()).toEqual({ success: true, data: { count: 3 } });
    expect(store.listSends).not.toHaveBeenCalled();
  });
});

describe("POST sends/[id]/resolve", () => {
  const resolve = (body: unknown) => handleResolveSend(req("POST", "sends/s1/resolve", body), "s1", { store });

  it("is open to an admin: approving is Reut's daily action", async () => {
    h.role = "admin";
    const res = await resolve({ outcome: "approved" });
    expect(res.status).toBe(200);
    expect(store.resolveSend).toHaveBeenCalledWith("s1", "approved", null, "admin-1");
  });

  it("passes the trimmed rejection note through", async () => {
    await resolve({ outcome: "rejected", note: "  סכום שגוי  " });
    expect(store.resolveSend).toHaveBeenCalledWith("s1", "rejected", "סכום שגוי", "super_user-1");
  });

  it("rejected without a note is 400 with the Hebrew reason, and nothing is resolved", async () => {
    const res = await resolve({ outcome: "rejected" });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("בדחייה חובה לכתוב הערה");
    expect(store.resolveSend).not.toHaveBeenCalled();
  });

  it("answers the generic Hebrew 400 to an unknown outcome", async () => {
    const res = await resolve({ outcome: "nuked" });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe(copy.invalidRequest);
  });

  it("answers 404 when the send does not exist", async () => {
    store.resolveSend.mockRejectedValue(new h.InvalidTransitionError("approved", null));
    const res = await resolve({ outcome: "approved" });
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe(copy.sendNotFound);
  });

  it("answers 409 in Hebrew naming the current status on an invalid transition", async () => {
    store.resolveSend.mockRejectedValue(new h.InvalidTransitionError("approved", "rejected"));
    const res = await resolve({ outcome: "approved" });
    const json = await res.json();
    expect(res.status).toBe(409);
    expect(json.error).toBe(copy.invalidTransition("approved", "rejected"));
    expect(json.error).toContain("נדחתה");
    expect(json.error).toMatch(/[֐-׿]/);
  });

  it("answers a generic 500 on an unexpected error", async () => {
    store.resolveSend.mockRejectedValue(new Error("deadlock detected"));
    const res = await resolve({ outcome: "approved" });
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("deadlock");
  });

  it("the exported POST forwards the URL id from the route context", async () => {
    await resolveRoute(req("POST", "sends/s7/resolve", { outcome: "arrived" }), { params: Promise.resolve({ id: "s7" }) });
    expect(h.defaultStore.resolveSend).toHaveBeenCalledWith("s7", "arrived", null, "super_user-1");
  });
});

describe("POST rows/[id]/unlock", () => {
  const unlock = (body: unknown) => handleUnlockRow(req("POST", "rows/r1/unlock", body), "r1", { store });

  it("is super-user only: an admin gets 403 and nothing is unlocked", async () => {
    h.role = "admin";
    expect((await unlock({ reason: "נשלח בטעות" })).status).toBe(403);
    expect(store.unlockRow).not.toHaveBeenCalled();
  });

  it("unlocks with the reason and the acting user", async () => {
    const res = await unlock({ reason: "  צריך לשלוח שוב  " });
    expect(res.status).toBe(200);
    expect(store.unlockRow).toHaveBeenCalledWith("r1", "צריך לשלוח שוב", "super_user-1");
  });

  it.each([{}, { reason: "" }, { reason: "  ab " }])("answers 400 with a Hebrew message to a missing reason %j", async (body) => {
    const res = await unlock(body);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/[֐-׿]/);
    expect(store.unlockRow).not.toHaveBeenCalled();
  });

  it("answers 409 when the row is missing or already unlocked", async () => {
    store.unlockRow.mockRejectedValue(new h.RowNotLockedError());
    const res = await unlock({ reason: "נשלח בטעות" });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe(copy.rowNotLocked);
  });

  it("the exported POST forwards the URL id from the route context", async () => {
    await unlockRoute(req("POST", "rows/r5/unlock", { reason: "נשלח בטעות" }), { params: Promise.resolve({ id: "r5" }) });
    expect(h.defaultStore.unlockRow).toHaveBeenCalledWith("r5", "נשלח בטעות", "super_user-1");
  });
});
