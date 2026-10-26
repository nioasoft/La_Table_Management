import { describe, expect, it } from "vitest";

import { copy, formatShekel, previewCopy, sendStatusLabels } from "@/lib/hashavshevet/copy";
import {
  skippedNotice,
  blockingMessages,
  buildExpected,
  canSend,
  describeLock,
  describeRow,
  displayColumns,
  groupTotals,
  resolveView,
  sendOutcome,
  sendResultMessages,
  statusBadge,
  statusDetail,
  type ClientGroup,
  type ClientPreview,
  type ClientRow,
} from "../preview-state";

function row(over: Partial<ClientRow> & Pick<ClientRow, "rowKey" | "status">): ClientRow {
  return {
    companyId: "c1",
    documentKey: over.rowKey,
    amount: 100,
    periodEnd: "2026-09-30",
    display: { לקוח: "ויני", סכום: 100 },
    ...over,
  };
}

function group(rows: ClientRow[], over: Partial<ClientGroup> = {}): ClientGroup {
  const totalNew = rows.filter((r) => r.status === "new").reduce((s, r) => s + r.amount, 0);
  return { companyId: "c1", companyName: "פט ויני בע״מ", requiresApproval: true, rows, totalNew, ...over };
}

function preview(groups: ClientGroup[], over: Partial<ClientPreview> = {}): ClientPreview {
  return { exportType: "supplier_commissions", plugin: "imovein", groups, blockingErrors: [], blockingStatuses: [], ...over };
}

describe("buildExpected", () => {
  it("lists only new rows, across groups, with their amounts and companies", () => {
    const data = preview([
      group([row({ rowKey: "a", status: "new", amount: 10.5 }), row({ rowKey: "b", status: "sent" })]),
      group(
        [row({ rowKey: "c", status: "new", amount: 3, companyId: "c2" }), row({ rowKey: "d", status: "changed", companyId: "c2" })],
        { companyId: "c2" },
      ),
    ]);
    expect(buildExpected(data)).toEqual([
      { rowKey: "a", amount: 10.5, companyId: "c1" },
      { rowKey: "c", amount: 3, companyId: "c2" },
    ]);
  });
});

describe("canSend", () => {
  const withNew = [group([row({ rowKey: "a", status: "new" })])];

  it("is ok with new rows and nothing blocking", () => {
    expect(canSend(preview(withNew))).toEqual({ ok: true, reason: null });
  });

  it("is disabled when there are no new rows", () => {
    const data = preview([group([row({ rowKey: "a", status: "sent" })])]);
    expect(canSend(data)).toEqual({ ok: false, reason: previewCopy.nothingToSend });
  });

  it("is disabled by blocking errors even with new rows", () => {
    const data = preview(withNew, { blockingErrors: ["ספק בלי קוד חשבשבת"] });
    expect(canSend(data)).toEqual({ ok: false, reason: copy.sendBlocked });
  });

  it("is disabled by blocking statuses even with new rows", () => {
    const data = preview(withNew, { blockingStatuses: ["not_live"] });
    expect(canSend(data)).toEqual({ ok: false, reason: copy.sendBlocked });
  });
});

describe("blockingMessages", () => {
  it("lists blocking errors, then one line per blocking status", () => {
    const data = preview([], { blockingErrors: ["שגיאה א"], blockingStatuses: ["not_live"] });
    expect(blockingMessages(data)).toEqual(["שגיאה א", previewCopy.someCompaniesNotLive]);
  });
});

describe("skippedNotice", () => {
  it("is null when every row has a company", () => {
    expect(skippedNotice(preview([group([row({ rowKey: "a", status: "new" })])]))).toBeNull();
  });

  it("says how many rows won't be sent because they have no company", () => {
    const data = preview([
      group([row({ rowKey: "a", status: "new" })]),
      group([row({ rowKey: "x", status: "no_company", companyId: null }), row({ rowKey: "y", status: "no_company", companyId: null })], { companyId: null }),
    ]);
    expect(skippedNotice(data)).toBe(previewCopy.noCompanySkipped(2));
    expect(canSend(data).ok).toBe(true);
  });
});

describe("groupTotals", () => {
  it("sums new rows across groups, rounded to cents", () => {
    const data = preview([
      group([row({ rowKey: "a", status: "new", amount: 0.1 }), row({ rowKey: "b", status: "sent" })]),
      group([row({ rowKey: "c", status: "new", amount: 0.2 })], { companyId: "c2" }),
    ]);
    expect(groupTotals(data)).toEqual({ newCount: 2, newTotal: 0.3 });
  });
});

describe("statusBadge", () => {
  it("colors new green, sent gray, changed orange, the blocked ones dark", () => {
    expect(statusBadge("new")).toEqual({ label: previewCopy.rowStatus.new, tone: "success" });
    expect(statusBadge("sent").tone).toBe("muted");
    expect(statusBadge("changed").tone).toBe("warning");
    for (const s of ["before_live", "no_company", "not_live"] as const) expect(statusBadge(s).tone).toBe("dark");
  });
});

describe("describeLock", () => {
  it("formats sentAt (ISO string) in Israel time with the sender's name", () => {
    const text = describeLock({
      rowKey: "a", companyId: "c1", amount: 100, sendStatus: "awaiting_approval",
      sentAt: "2026-09-30T21:30:00.000Z", sentBy: "u1", sentByName: "רעות",
    });
    // 21:30Z on 30 Sep is 00:30 on 1 Oct in Israel (UTC+3).
    expect(text).toContain("1.10.2026");
    expect(text).toContain("00:30");
    expect(text).toContain("רעות");
  });

  it("names a deleted sender as unknown", () => {
    const text = describeLock({
      rowKey: "a", companyId: "c1", amount: 100, sendStatus: "approved",
      sentAt: "2026-01-15T10:00:00.000Z", sentBy: null, sentByName: null,
    });
    expect(text).toContain(previewCopy.unknownSender);
  });
});

describe("statusDetail", () => {
  const lock = {
    rowKey: "a", companyId: "c1", amount: 100, sendStatus: "approved",
    sentAt: "2026-01-15T10:00:00.000Z", sentBy: "u1", sentByName: "רעות",
  };
  const g = group([]);

  it("shows when and by whom for sent rows", () => {
    expect(statusDetail(row({ rowKey: "a", status: "sent", lock }), g)).toBe(describeLock(lock));
  });

  it("shows old and new amount for changed rows", () => {
    expect(statusDetail(row({ rowKey: "a", status: "changed", amount: 120, lock }), g)).toBe(
      previewCopy.changedAmount(formatShekel(100), formatShekel(120)),
    );
  });

  it("explains the blocked statuses", () => {
    expect(statusDetail(row({ rowKey: "a", status: "before_live" }), g)).toBe(copy.beforeLive);
    expect(statusDetail(row({ rowKey: "a", status: "no_company", companyId: null }), g)).toBe(copy.noCompany);
    expect(statusDetail(row({ rowKey: "a", status: "not_live" }), g)).toBe(copy.notLive("פט ויני בע״מ"));
  });

  it("has nothing to add for a new row", () => {
    expect(statusDetail(row({ rowKey: "a", status: "new" }), g)).toBeNull();
  });
});

describe("describeRow", () => {
  const data = preview([group([row({ rowKey: "k1", status: "new", display: { א: "ויני", ב: 5, ג: "x", ד: "y" } })])]);

  it("uses the first display values of the row", () => {
    expect(describeRow(data, "k1")).toBe("ויני · 5 · x");
  });

  it("falls back to the raw key", () => {
    expect(describeRow(data, "zzz")).toBe("zzz");
    expect(describeRow(undefined, "zzz")).toBe("zzz");
  });
});

describe("displayColumns", () => {
  it("keeps first-seen order and merges differing keys", () => {
    const rows = [row({ rowKey: "a", status: "new", display: { א: 1, ב: 2 } }), row({ rowKey: "b", status: "new", display: { ב: 3, ג: 4 } })];
    expect(displayColumns(rows)).toEqual(["א", "ב", "ג"]);
    expect(displayColumns([])).toEqual([]);
  });
});

describe("sendResultMessages", () => {
  it("maps every status, keeping row errors, and unknown always carries the check-in-Hashavshevet copy", () => {
    const out = sendResultMessages([
      { sendId: "s1", companyId: "c1", companyName: "א", status: "awaiting_approval", rowCount: 2, total: 5, chunks: 1, message: "נשלחו" },
      { sendId: "s2", companyId: "c2", companyName: "ב", status: "failed", rowCount: 0, total: 0, chunks: 1, message: "נדחה", errors: [{ rowKey: "k", message: "שורה" }] },
      { sendId: "s3", companyId: "c3", companyName: "ג", status: "unknown", rowCount: 1, total: 1, chunks: 1, message: "" },
      { sendId: null, companyId: "c4", companyName: "ד", status: "not_sent", rowCount: 0, total: 0, chunks: 0, message: "אין זמן" },
      { sendId: "s5", companyId: "c5", companyName: "ה", status: "approved", rowCount: 1, total: 1, chunks: 1, message: "אושר" },
    ]);
    expect(out.map((r) => r.tone)).toEqual(["success", "danger", "warning", "danger", "success"]);
    expect(out[0].statusLabel).toBe(sendStatusLabels.awaiting_approval);
    expect(out[1].rowErrors).toEqual([{ rowKey: "k", message: "שורה" }]);
    expect(out[2].message).toBe(copy.unknownOutcome);
    expect(out[3].statusLabel).toBe(previewCopy.notSent);
    expect(out[0].rowErrors).toEqual([]);
  });
});

describe("sendOutcome", () => {
  it("is empty before any send", () => {
    expect(sendOutcome(undefined, null)).toEqual({ sends: [], errorMessage: null, canRefresh: false });
  });

  it("returns the sends of a successful response", () => {
    const sends = [{ sendId: "s", companyId: "c", companyName: "א", status: "approved" as const, rowCount: 1, total: 1, chunks: 1, message: "ok" }];
    expect(sendOutcome({ sends }, null).sends).toEqual(sends);
  });

  it("409 offers a refresh, and keeps the companies that were already sent", () => {
    const sends = [{ sendId: "s", companyId: "c", companyName: "א", status: "awaiting_approval" as const, rowCount: 1, total: 1, chunks: 1, message: "ok" }];
    expect(sendOutcome(undefined, { status: 409, message: copy.dataChanged, sends })).toEqual({
      sends,
      errorMessage: copy.dataChanged,
      canRefresh: true,
    });
  });

  // M9: with no JSON answer the request may still have locked and sent rows on the server.
  it.each([
    ["a network failure", 0],
    ["a 502 from the edge", 502],
    ["a 504 timeout", 504],
  ])("%s says the outcome is unknown and points to the sends screen", (_name, status) => {
    const out = sendOutcome(undefined, { status, message: previewCopy.requestFailed, answered: false });
    expect(out.errorMessage).toBe(previewCopy.sendOutcomeUnknown);
    expect(out.errorMessage).toContain(copy.unknownOutcome);
    expect(out.errorMessage).toContain("שליחות לחשבשבת");
    expect(out.canRefresh).toBe(false);
  });

  it("keeps the server's own message when it answered, and a non-JSON 4xx stays a plain failure", () => {
    expect(sendOutcome(undefined, { status: 500, message: copy.serverError("r1"), answered: true }).errorMessage).toBe(copy.serverError("r1"));
    expect(sendOutcome(undefined, { status: 413, message: previewCopy.requestFailed, answered: false }).errorMessage).toBe(
      previewCopy.requestFailed,
    );
  });

  it("422 offers a refresh, 429 and 500 do not", () => {
    expect(sendOutcome(undefined, { status: 422, message: copy.sendBlocked }).canRefresh).toBe(true);
    expect(sendOutcome(undefined, { status: 429, message: copy.rateLimited }).canRefresh).toBe(false);
    expect(sendOutcome(undefined, { status: 500, message: "x" }).canRefresh).toBe(false);
  });
});

describe("resolveView", () => {
  const ready = preview([group([row({ rowKey: "a", status: "new" })])]);
  const base = { previewPending: false, previewFailed: false, data: ready as ClientPreview | undefined, hasSends: false };

  it("covers the four states", () => {
    expect(resolveView({ ...base, previewPending: true })).toBe("loading");
    expect(resolveView({ ...base, previewFailed: true, data: undefined })).toBe("error");
    expect(resolveView({ ...base, data: preview([]) })).toBe("empty");
    expect(resolveView(base)).toBe("ready");
  });

  it("an empty preview that carries a blocking error is shown, not hidden as empty", () => {
    expect(resolveView({ ...base, data: preview([], { blockingErrors: [copy.noCommissionInvoices] }) })).toBe("ready");
  });

  it("shows the result once sends came back", () => {
    expect(resolveView({ ...base, hasSends: true })).toBe("result");
  });

  it("is loading before the first preview was requested", () => {
    expect(resolveView({ ...base, data: undefined })).toBe("loading");
  });
});
