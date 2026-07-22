import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseMakatiFile } from "../makati-parser";

const fixturesDir = resolve(__dirname, "fixtures");

describe("parseMakatiFile — Q1-2026 export (positive, E = C + D)", () => {
  // Real upload 02e6c735 ("ש.מ מינה טומיי 01-03.2026.xlsx")
  const buffer = readFileSync(resolve(fixturesDir, "makati-q1-2026.xlsx"));

  it("keeps the historical commission base (net = taxable + exempt = E)", () => {
    const r = parseMakatiFile(buffer, 0.18);

    expect(r.success).toBe(true);
    expect(r.data).toHaveLength(5);
    expect(r.anomalies).toBeUndefined();

    // אודון: 11,851.24 taxable + 3,275.05 exempt = 15,126.29 (= file's E)
    const odon = r.data.find((d) => d.franchisee.includes("אודון"))!;
    expect(odon.netAmount).toBe(15126);
    // gross = net + taxable × 18% (17,259.51 → 17,260, matches the Q1 value already in prod)
    expect(odon.grossAmount).toBe(17260);

    expect(Math.abs(r.summary.totalNetAmount - 111985)).toBeLessThanOrEqual(3);
  });
});

describe("parseMakatiFile — Q2-2026 credit-side export (all negative, E includes VAT)", () => {
  // Real upload cfa0e9df ("דוח עמלות רשת.xlsx"): bookkeeping credit-side
  // report — every amount negative, and E = C×1.17 + D (VAT baked in).
  // Synced commissions negative into the invoice report before the fix.
  const buffer = readFileSync(
    resolve(fixturesDir, "makati-q2-2026-credit-side.xlsx")
  );

  it("flips all-negative files to positive and bases net on C + D, not E", () => {
    const r = parseMakatiFile(buffer, 0.18);

    expect(r.success).toBe(true);
    expect(r.data).toHaveLength(5);

    for (const row of r.data) {
      expect(row.netAmount).toBeGreaterThan(0);
      expect(row.grossAmount).toBeGreaterThan(0);
    }

    // אודון: |−7,635.04| + |−3,141.00| = 10,776.04 — NOT the file's E (12,074)
    const odon = r.data.find((d) => d.franchisee.includes("אודון"))!;
    expect(odon.netAmount).toBe(10776);
    expect(odon.grossAmount).toBe(12150); // 10776.04 + 7635.04 × 0.18

    // Total base excludes the supplier's baked-in VAT (file total: 80,428)
    expect(Math.abs(r.summary.totalNetAmount - 72181)).toBeLessThanOrEqual(3);

    // The sign flip is surfaced to the admin
    expect(r.anomalies?.some((a) => a.code === "NEGATIVE_AMOUNTS")).toBe(true);
    expect(
      r.legacyWarnings.some((w) => w.includes("credit-side"))
    ).toBe(true);
  });

  it("finds the header row via the new 'שם חשבון' header", () => {
    const r = parseMakatiFile(buffer, 0.18);
    // Header + title + totals rows are excluded from data — only 5 franchisees
    expect(r.summary.processedRows).toBe(5);
    expect(r.data.some((d) => d.franchisee.includes("חשבון"))).toBe(false);
  });
});
