import { describe, it, expect } from "vitest";
import {
  monthTxnCounts,
  archiveMonthOwners,
  withTrustedSupplierIds,
  canonicalArchiveMonths,
  type ArchiveSourceFile,
} from "../archive-ownership";
import type { MonthlyBreakdown } from "../types";

const entry = (supplierName: string, amount: number, transactionCount = 1, supplierId: string | null = null) => ({
  supplierId,
  supplierName,
  amount,
  transactionCount,
});

const months = (year: string, from: number, to: number, txns: number): MonthlyBreakdown =>
  Object.fromEntries(
    Array.from({ length: to - from + 1 }, (_, i) => {
      const m = `${year}-${String(from + i).padStart(2, "0")}`;
      return [m, [entry("מקאטי", 1000 * (from + i), txns, "sup-1")]];
    })
  );

const file = (id: string, day: string, mb: MonthlyBreakdown, supplierMatches: ArchiveSourceFile["supplierMatches"] = []): ArchiveSourceFile => ({
  id,
  createdAt: new Date(`${day}T10:00:00`),
  monthlyBreakdown: mb,
  supplierMatches,
});

// קינג קונג רעננה, 2026-10-18: the full-year 2025 file, then a 2026 file that
// carries a stray September 2025 (1 owner-account transaction).
const fullYear2025 = file("f2025", "2026-03-17", months("2025", 1, 12, 80));
const ytd2026 = file("f2026", "2026-10-18", {
  ...months("2026", 1, 10, 300),
  "2025-09": [entry('ניר חן - חו"ז בעלים', 3835, 1)],
});

const owners = (...files: ArchiveSourceFile[]) =>
  archiveMonthOwners(files.map((f) => ({ id: f.id, createdAt: f.createdAt, monthTxns: monthTxnCounts(f.monthlyBreakdown) })));

describe("monthTxnCounts", () => {
  it("sums transactions per month and ignores keys that are not YYYY-MM", () => {
    expect(monthTxnCounts({ unknown: [entry("x", 1, 9)], "2026-01": [entry("a", 1, 2), entry("b", 1, 3)] })).toEqual({ "2026-01": 5 });
  });
});

describe("archiveMonthOwners", () => {
  it("never lets a stray month take a month from a full report", () => {
    const o = owners(fullYear2025, ytd2026);
    expect(o.get("2025-09")).toBe("f2025");
    expect(o.get("2026-03")).toBe("f2026");
  });

  it("gives a cumulative month to the newest file", () => {
    const q1 = file("q1", "2026-04-05", months("2026", 1, 3, 100));
    const h1 = file("h1", "2026-07-05", months("2026", 1, 6, 100));
    const o = owners(h1, q1);
    expect(o.get("2026-02")).toBe("h1");
    expect(o.get("2026-06")).toBe("h1");
  });

  it("lets a multi-year export own the earlier year when it is the fuller version", () => {
    // ויני חדרה: Apr 2025–Oct 2026 in one file, its Nov 2025 fuller than the old file's.
    const old2025 = file("old", "2026-05-20", months("2025", 4, 12, 61));
    const multiYear = file("multi", "2026-10-18", { ...months("2025", 4, 12, 124), ...months("2026", 1, 10, 230) });
    expect(owners(old2025, multiYear).get("2025-11")).toBe("multi");
  });

  it("keeps a slightly smaller correction, refuses a sliver", () => {
    const original = file("orig", "2026-04-01", months("2026", 1, 1, 100));
    expect(owners(original, file("fix", "2026-05-01", months("2026", 1, 1, 50))).get("2026-01")).toBe("fix");
    expect(owners(original, file("sliver", "2026-05-01", months("2026", 1, 1, 49))).get("2026-01")).toBe("orig");
  });

  it("lets a later full report replace an earlier stray", () => {
    const strayFirst = file("stray", "2026-01-10", months("2025", 12, 12, 2));
    const full = file("full", "2026-02-10", months("2025", 12, 12, 109));
    expect(owners(strayFirst, full).get("2025-12")).toBe("full");
  });
});

describe("withTrustedSupplierIds", () => {
  it("links manual and exact matches only; unknown names keep their id", () => {
    const mb: MonthlyBreakdown = {
      "2026-01": [entry("א. ביסקוטי בע\"מ", 10, 1, "sup-b"), entry("ספק ידני", 20, 1, null), entry("לא בהתאמות", 30, 1, "sup-x")],
    };
    const result = withTrustedSupplierIds(mb, [
      { bkmvName: "א. ביסקוטי בע\"מ", matchedSupplierId: "sup-b", confidence: 0.7, matchType: "fuzzy_name" },
      { bkmvName: "ספק ידני", matchedSupplierId: "sup-m", confidence: 0.4, matchType: "manual" },
    ]);
    expect(result["2026-01"].map((e) => e.supplierId)).toEqual([null, "sup-m", "sup-x"]);
  });
});

describe("canonicalArchiveMonths", () => {
  it("restores the real month and drops a month no live file owns", () => {
    // e.g. after the only file with that month was rejected.
    expect(canonicalArchiveMonths([ytd2026], ["2024-05"])).toEqual({ "2024-05": null });
    const result = canonicalArchiveMonths([fullYear2025, ytd2026], ["2025-09", "2026-01"]);
    expect(result["2025-09"]?.[0].amount).toBe(9000);
    expect(result["2026-01"]?.[0].amount).toBe(1000);
  });
});
