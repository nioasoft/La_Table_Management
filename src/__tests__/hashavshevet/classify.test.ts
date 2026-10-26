import { describe, it, expect } from "vitest";
import {
  classifyRows,
  rowsToSend,
  blockingStatuses,
  type ActiveLock,
  type CompanyInfo,
} from "@/lib/hashavshevet/classify";
import type { BuiltRow } from "@/lib/hashavshevet/types";

function row(over: Partial<BuiltRow> = {}): BuiltRow {
  return {
    rowKey: "k1",
    companyId: "c1",
    documentKey: "d1",
    amount: 100,
    display: {},
    apiRow: {},
    periodEnd: "2026-11-30",
    ...over,
  };
}

function lock(over: Partial<ActiveLock> = {}): ActiveLock {
  return {
    rowKey: "k1",
    companyId: "c1",
    amount: 100,
    sentAt: new Date("2026-11-02T10:00:00"),
    sentBy: "u1",
    sentByName: "מנהלת",
    sendStatus: "sent",
    ...over,
  };
}

const live: CompanyInfo = { id: "c1", liveFrom: "2026-11-01", requiresApproval: true };
const companies = new Map<string, CompanyInfo>([["c1", live]]);

describe("classifyRows", () => {
  it("classifies by lock, amount, live date and mapping", () => {
    const l = lock();
    const [sent] = classifyRows([row({ amount: 100 })], [l], companies);
    expect(sent.status).toBe("sent");
    expect(sent.lock).toBe(l);

    const [changed] = classifyRows([row({ amount: 120 })], [l], companies);
    expect(changed.status).toBe("changed");
    expect(changed.lock).toBe(l);

    const [before] = classifyRows([row({ periodEnd: "2026-10-31" })], [], companies);
    expect(before.status).toBe("before_live");

    const [noCompany] = classifyRows([row({ companyId: null })], [], companies);
    expect(noCompany.status).toBe("no_company");

    const noLive = new Map([["c1", { ...live, liveFrom: null }]]);
    const [notLive] = classifyRows([row()], [], noLive);
    expect(notLive.status).toBe("not_live");

    const [fresh] = classifyRows([row()], [], companies);
    expect(fresh.status).toBe("new");
    expect(fresh.lock).toBeUndefined();
  });

  it("periodEnd equal to liveFrom is new (live date is inclusive)", () => {
    const [r] = classifyRows([row({ periodEnd: "2026-11-01" })], [], companies);
    expect(r.status).toBe("new");
  });

  it("company missing from the map is not_live", () => {
    const [r] = classifyRows([row({ companyId: "ghost" })], [], companies);
    expect(r.status).toBe("not_live");
  });

  it("no_company wins over everything, even a matching lock", () => {
    const [r] = classifyRows([row({ companyId: null })], [lock()], companies);
    expect(r.status).toBe("no_company");
  });

  it("not_live wins over a lock and over before_live", () => {
    const noLive = new Map([["c1", { ...live, liveFrom: null }]]);
    const [withLock] = classifyRows([row()], [lock()], noLive);
    expect(withLock.status).toBe("not_live");
    const [early] = classifyRows([row({ periodEnd: "2020-01-01" })], [], noLive);
    expect(early.status).toBe("not_live");
  });

  it("a lock wins over before_live", () => {
    const [r] = classifyRows([row({ periodEnd: "2026-10-31" })], [lock()], companies);
    expect(r.status).toBe("sent");
  });

  it("compares amounts after rounding to 2 decimals", () => {
    const [same] = classifyRows([row({ amount: 100.004 })], [lock({ amount: 100 })], companies);
    expect(same.status).toBe("sent");
    const [diff] = classifyRows([row({ amount: 100.01 })], [lock({ amount: 100 })], companies);
    expect(diff.status).toBe("changed");
    const [float] = classifyRows([row({ amount: 0.1 + 0.2 })], [lock({ amount: 0.3 })], companies);
    expect(float.status).toBe("sent");
  });

  it("a lock on the same rowKey but another company does not count", () => {
    const [r] = classifyRows([row()], [lock({ companyId: "c2" })], companies);
    expect(r.status).toBe("new");
    expect(r.lock).toBeUndefined();
  });

  it("a lock for another rowKey does not count", () => {
    const [r] = classifyRows([row()], [lock({ rowKey: "other" })], companies);
    expect(r.status).toBe("new");
  });

  it("keeps order and the BuiltRow fields", () => {
    const rows = [row({ rowKey: "a" }), row({ rowKey: "b", companyId: null })];
    const out = classifyRows(rows, [], companies);
    expect(out.map((r) => r.rowKey)).toEqual(["a", "b"]);
    expect(out[0].documentKey).toBe("d1");
  });
});

describe("rowsToSend / blockingStatuses", () => {
  const rows = [
    row({ rowKey: "n" }),
    row({ rowKey: "s" }),
    row({ rowKey: "nc", companyId: null }),
    row({ rowKey: "nl", companyId: "c9" }),
    row({ rowKey: "nl2", companyId: "c9" }),
  ];
  const classified = classifyRows(rows, [lock({ rowKey: "s" })], companies);

  it("rowsToSend returns only new rows", () => {
    expect(rowsToSend(classified).map((r) => r.rowKey)).toEqual(["n"]);
  });

  it("a not-live company blocks; an unmapped row is skipped, not blocking", () => {
    expect(blockingStatuses(classified)).toEqual(["not_live"]);
  });

  it("an unmapped row alone does not block and is never sent", () => {
    const onlyUnmapped = classifyRows([row({ rowKey: "n" }), row({ rowKey: "nc", companyId: null })], [], companies);
    expect(blockingStatuses(onlyUnmapped)).toEqual([]);
    expect(rowsToSend(onlyUnmapped).map((r) => r.rowKey)).toEqual(["n"]);
  });

  it("sent, changed and before_live do not block", () => {
    const ok = classifyRows(
      [row({ rowKey: "s" }), row({ rowKey: "c", amount: 5 }), row({ rowKey: "b", periodEnd: "2020-01-01" })],
      [lock({ rowKey: "s" }), lock({ rowKey: "c" })],
      companies,
    );
    expect(blockingStatuses(ok)).toEqual([]);
  });
});
