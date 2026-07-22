import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as XLSX from "xlsx";
import { parseDiplomatFile } from "../diplomat-parser";

const fixturesDir = resolve(__dirname, "fixtures");

function xlsx(rows: unknown[][]): Buffer {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), "Sheet1");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

describe("parseDiplomatFile — month-matrix layout (Q2-2026 export)", () => {
  // Real production export from upload 9bd15e0c (2026-07-07). The generic
  // file_mapping expected the amount in col F and dropped every row.
  const buffer = readFileSync(resolve(fixturesDir, "diplomat-q2-2026.xlsx"));

  it("emits one row per franchisee per month, dated to month end", () => {
    const r = parseDiplomatFile(buffer, 0.18);

    expect(r.success).toBe(true);
    // 14 franchisees; "-" cells (e.g. ויליג' נצרת in April) are skipped
    expect(r.summary.processedRows).toBe(14);

    // File's own grand total: 161,005 + 246,561 + 248,218 = 655,784
    expect(Math.abs(r.summary.totalNetAmount - 655784)).toBeLessThanOrEqual(2);

    // Every row is dated to a month end inside Q2-2026, so the upload route
    // can derive the settlement period from content
    for (const row of r.data) {
      expect(row.date).toBeInstanceOf(Date);
      expect(row.date!.getFullYear()).toBe(2026);
      expect([3, 4, 5]).toContain(row.date!.getMonth());
    }

    // Spot check: אודון April = 19,631 net
    const odon = r.data.find(
      (d) => d.franchisee.includes("אודון") && d.date!.getMonth() === 3
    )!;
    expect(odon.netAmount).toBe(19631);
    expect(odon.grossAmount).toBe(23165); // 19631 * 1.18 rounded
  });

  it("skips the grand-total row (empty Customer cell)", () => {
    const r = parseDiplomatFile(buffer, 0.18);
    const badRows = r.data.filter((d) => !d.franchisee);
    expect(badRows).toHaveLength(0);
  });
});

describe("parseDiplomatFile — guards", () => {
  it("fails cleanly when no Customer header exists", () => {
    const r = parseDiplomatFile(
      xlsx([
        ["לקוח", "סכום"],
        ["מינה שרונה", "100"],
      ])
    );
    expect(r.success).toBe(false);
    expect(r.legacyErrors[0]).toContain("Customer");
  });

  it("fails cleanly when no month columns exist", () => {
    const r = parseDiplomatFile(
      xlsx([
        ["Customer", "Amount"],
        ["מינה שרונה", "100"],
      ])
    );
    expect(r.success).toBe(false);
    expect(r.legacyErrors[0]).toContain("month");
  });
});
