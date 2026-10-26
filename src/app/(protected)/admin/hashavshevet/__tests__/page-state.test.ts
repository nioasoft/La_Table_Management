import { afterEach, describe, expect, it, vi } from "vitest";

import {
  canReject,
  canUnlock,
  companyIdFromSelect,
  companyOptions,
  companyRowView,
  filterHistory,
  formatSentAt,
  formatYmd,
  NO_COMPANY,
  selectValueOf,
  partitionSends,
  periodLabel,
  resolveActionsFor,
  rowLockView,
  statusBadgeVariant,
  todayLocalYmd,
  unlockReasonLabel,
  type HistoryFilter,
} from "../page-state";

afterEach(() => vi.restoreAllMocks());

describe("todayLocalYmd", () => {
  it("builds YYYY-MM-DD from local parts, zero padded", () => {
    expect(todayLocalYmd(new Date(2026, 0, 5, 10, 0))).toBe("2026-01-05");
  });

  it("stays on the local day just after midnight, where toISOString would step back to the previous UTC day", () => {
    vi.spyOn(Date.prototype, "toISOString").mockImplementation(() => {
      throw new Error("toISOString must not be used for dates");
    });
    expect(todayLocalYmd(new Date(2026, 9, 1, 0, 30))).toBe("2026-10-01");
  });

  it("defaults to now", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 2, 23, 59));
    expect(todayLocalYmd()).toBe("2026-07-02");
    vi.useRealTimers();
  });
});

describe("formatYmd", () => {
  it("shows a stored date as dd/mm/yyyy without going through Date", () => {
    expect(formatYmd("2026-07-01")).toBe("01/07/2026");
  });
});

describe("canReject / canUnlock", () => {
  it("need a real note: blank and under three characters are refused, whitespace does not count", () => {
    expect(canReject("")).toBe(false);
    expect(canReject("   ")).toBe(false);
    expect(canReject(" ab ")).toBe(false);
    expect(canReject("סכום שגוי")).toBe(true);
    expect(canUnlock("  ab ")).toBe(false);
    expect(canUnlock("נשלח בטעות")).toBe(true);
  });
});

describe("resolveActionsFor", () => {
  const labels = (status: Parameters<typeof resolveActionsFor>[0]["status"], stalePending = false) =>
    resolveActionsFor({ status, stalePending }).map((a) => [a.outcome, a.label, a.needsNote]);

  it("awaiting approval: Reut confirms (no note) or rejects (note required)", () => {
    expect(labels("awaiting_approval")).toEqual([
      ["approved", "אישרתי בחשבשבת", false],
      ["rejected", "דחיתי", true],
    ]);
  });

  it("unknown: arrived / did not arrive", () => {
    expect(labels("unknown")).toEqual([
      ["arrived", "הגיע", false],
      ["rejected", "לא הגיע", true],
    ]);
  });

  it("a stale pending send offers the same two choices as unknown", () => {
    expect(labels("pending", true)).toEqual(labels("unknown"));
  });

  it("a fresh pending send and every settled status offer nothing", () => {
    for (const status of ["pending", "approved", "rejected", "failed"] as const) {
      expect(labels(status)).toEqual([]);
    }
  });
});

describe("periodLabel", () => {
  it("supplier commissions: the date range as dd/mm/yyyy", () => {
    expect(periodLabel("supplier_commissions", { startDate: "2026-04-01", endDate: "2026-06-30" })).toBe("01/04/2026 – 30/06/2026");
  });

  it("royalties use year and month", () => {
    expect(periodLabel("royalties", { year: 2026, month: 6, brandId: "b1", itemType: "royalty" })).toBe("06/2026");
  });

  it.each(["franchisee_client_invoices", "journal_entries", "client_commission_invoices"] as const)(
    "%s use periodMonth and periodYear",
    (type) => {
      expect(periodLabel(type, { periodMonth: 9, periodYear: 2026, franchiseeId: "f1" })).toBe("09/2026");
    },
  );

  it("falls back to a dash for an export without a period or params of an unexpected shape", () => {
    expect(periodLabel("client_commissions", { sessionId: "s1", docKind: "invoice" })).toBe("—");
    expect(periodLabel("royalties", null)).toBe("—");
    expect(periodLabel("journal_entries", { periodMonth: "x" })).toBe("—");
    expect(periodLabel("supplier_commissions", { startDate: "2026-04-01" })).toBe("—");
  });
});

describe("companyRowView", () => {
  const live = { liveFrom: "2026-07-01" };
  const off = { liveFrom: null };

  it("says 'active from <date>' or 'not enabled'", () => {
    expect(companyRowView(live, true).statusText).toBe("פעילה מ-01/07/2026");
    expect(companyRowView(off, true).statusText).toBe("לא מופעלת");
  });

  it("a super user can activate an inactive company, turn off an active one, and toggle approval", () => {
    expect(companyRowView(off, true)).toMatchObject({ isLive: false, canActivate: true, canDeactivate: false, canEditApproval: true });
    expect(companyRowView(live, true)).toMatchObject({ isLive: true, canActivate: false, canDeactivate: true, canEditApproval: true });
  });

  it("an admin who is not a super user gets no management controls at all", () => {
    for (const company of [live, off]) {
      expect(companyRowView(company, false)).toMatchObject({ canActivate: false, canDeactivate: false, canEditApproval: false });
    }
  });
});

describe("rowLockView / unlockReasonLabel", () => {
  const locked = { unlockedAt: null, unlockReason: null };
  const released = { unlockedAt: "2026-07-02T10:00:00.000Z", unlockReason: "send_failed" };

  it("only a super user can open a row that is still locked", () => {
    expect(rowLockView(locked, true)).toEqual({ locked: true, canUnlock: true });
    expect(rowLockView(locked, false)).toEqual({ locked: true, canUnlock: false });
    expect(rowLockView(released, true)).toEqual({ locked: false, canUnlock: false });
  });

  it("explains system and rejection releases in Hebrew and passes a manual reason through", () => {
    expect(unlockReasonLabel("send_failed")).toBe("לא הגיעה לחשבשבת, שוחררה אוטומטית");
    expect(unlockReasonLabel("rejected: סכום שגוי")).toBe("נדחתה: סכום שגוי");
    expect(unlockReasonLabel("נשלח בטעות")).toBe("נשלח בטעות");
    expect(unlockReasonLabel(null)).toBe("");
  });
});

describe("partitionSends / filterHistory", () => {
  const s = (id: string, status: string, over: Record<string, unknown> = {}) => ({
    id,
    status: status as Parameters<typeof statusBadgeVariant>[0],
    stalePending: false,
    companyId: "c1",
    exportType: "royalties" as const,
    ...over,
  });
  const sends = [
    s("a", "awaiting_approval"),
    s("b", "unknown"),
    s("c", "pending", { stalePending: true }),
    s("d", "pending"),
    s("e", "approved", { companyId: "c2" }),
    s("f", "rejected", { exportType: "journal_entries" }),
    s("g", "failed"),
  ];

  it("queues what needs Reut: awaiting approval, unknown and stale pending; everything else is history", () => {
    const { queue, history } = partitionSends(sends);
    expect(queue.map((x) => x.id)).toEqual(["a", "b", "c"]);
    expect(history.map((x) => x.id)).toEqual(["d", "e", "f", "g"]);
  });

  const filter = (over: Partial<HistoryFilter>): HistoryFilter => ({ status: "all", companyId: "all", exportType: "all", ...over });
  const ids = (f: Partial<HistoryFilter>) => filterHistory(partitionSends(sends).history, filter(f)).map((x) => x.id);

  it("filters history by status, company and export type, all together", () => {
    expect(ids({})).toEqual(["d", "e", "f", "g"]);
    expect(ids({ status: "approved" })).toEqual(["e"]);
    expect(ids({ companyId: "c2" })).toEqual(["e"]);
    expect(ids({ exportType: "journal_entries" })).toEqual(["f"]);
    expect(ids({ status: "rejected", companyId: "c2" })).toEqual([]);
  });
});

describe("statusBadgeVariant", () => {
  it("colours each status", () => {
    expect(statusBadgeVariant("approved")).toBe("success");
    expect(statusBadgeVariant("awaiting_approval")).toBe("info");
    expect(statusBadgeVariant("unknown")).toBe("warning");
    expect(statusBadgeVariant("failed")).toBe("destructive");
    expect(statusBadgeVariant("rejected")).toBe("secondary");
    expect(statusBadgeVariant("pending")).toBe("outline");
  });
});

describe("company select values", () => {
  it("maps 'no company' to a non-empty sentinel (Radix Select refuses empty values) and back to null", () => {
    expect(selectValueOf(null)).toBe(NO_COMPANY);
    expect(selectValueOf("c1")).toBe("c1");
    expect(companyIdFromSelect(NO_COMPANY)).toBeNull();
    expect(companyIdFromSelect("c1")).toBe("c1");
    expect(NO_COMPANY).not.toBe("");
  });
});

describe("companyOptions", () => {
  it("lists each company that has sends once, by name", () => {
    const sends = [
      { companyId: "c2", companyName: "פט ויני" },
      { companyId: "c1", companyName: "ויני" },
      { companyId: "c2", companyName: "פט ויני" },
    ];
    expect(companyOptions(sends)).toEqual([
      { id: "c1", name: "ויני" },
      { id: "c2", name: "פט ויני" },
    ]);
  });
});

describe("formatSentAt", () => {
  it("shows local date and time as dd/mm/yyyy hh:mm", () => {
    expect(formatSentAt(new Date(2026, 6, 2, 9, 5).toISOString())).toBe("02/07/2026 09:05");
  });
});
