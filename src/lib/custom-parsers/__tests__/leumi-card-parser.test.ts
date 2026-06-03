import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseLeumiCardFile } from "../leumi-card-parser";

const fixturesDir = resolve(__dirname, "fixtures");

function loadXlsx(name: string): Buffer {
  return readFileSync(resolve(fixturesDir, name));
}

describe("parseLeumiCardFile", () => {
  // Real production export Reut sent on 2026-06-03 ("חישוב החזר לה טייבל.xlsx").
  // Pivot: col E = "Row Labels" (מספר עוסק), col F = "תחשיב החזר" (final refund).
  const buffer = loadXlsx("leumi-card-annual.xlsx");

  it("parses the pivot export and records the refund as pre-calculated commission", () => {
    const result = parseLeumiCardFile(buffer);

    expect(result.success).toBe(true);
    expect(result.errors).toHaveLength(0);

    // 19 business-ID rows, minus the two ₪0-rounding noise rows (514631043 →
    // 0.0032 and 516761152 → 22.55 rounds fine; only 0.0032 drops to 0).
    // Every emitted row must carry the refund verbatim in all amount fields.
    for (const row of result.data) {
      expect(row.preCalculatedCommission).toBeDefined();
      expect(row.netAmount).toBe(row.preCalculatedCommission);
      expect(row.grossAmount).toBe(row.preCalculatedCommission);
      expect(row.originalAmount).toBe(row.preCalculatedCommission);
      expect(row.franchiseeId).toMatch(/^\d+$/);
      expect(row.date).toBeNull();
    }
  });

  it("matches the file's Grand Total (~134,413 ₪) and skips the totals row", () => {
    const result = parseLeumiCardFile(buffer);

    const sumCommission = result.data.reduce(
      (acc, r) => acc + (r.preCalculatedCommission ?? 0),
      0
    );

    // Grand Total in the file is 134,413.273312. Amounts are stored in whole
    // shekels (roundAmount = Math.round), so the per-row rounded sum is ~134,415
    // — within a couple shekels of the reported total. The summary mirrors it.
    expect(sumCommission).toBe(result.summary.totalNetAmount);
    expect(sumCommission).toBeGreaterThan(134410);
    expect(sumCommission).toBeLessThan(134420);

    // No franchisee row should be the "Grand Total" label.
    expect(
      result.data.some((r) => /total/i.test(r.franchiseeId ?? ""))
    ).toBe(false);
  });

  it("extracts King Kong Carmiel's refund (8,699.69 → 8,700 ₪ whole-shekel)", () => {
    const result = parseLeumiCardFile(buffer);
    const kkCarmiel = result.data.find((r) => r.franchiseeId === "516476561");

    expect(kkCarmiel).toBeDefined();
    // roundAmount rounds to whole shekels: Math.round(8699.6908) === 8700.
    expect(kkCarmiel?.preCalculatedCommission).toBe(8700);
  });

  it("emits a DATES_NOT_EXTRACTED anomaly so the admin verifies the period", () => {
    const result = parseLeumiCardFile(buffer);
    expect(result.anomalies?.some((a) => a.code === "DATES_NOT_EXTRACTED")).toBe(
      true
    );
  });

  it("drops the ₪0-rounding pivot noise row (business id 514631043 → 0.0032)", () => {
    const result = parseLeumiCardFile(buffer);
    expect(result.data.some((r) => r.franchiseeId === "514631043")).toBe(false);
    expect(result.summary.skippedRows).toBeGreaterThanOrEqual(1);
  });

  it("fails cleanly on an empty buffer", () => {
    const result = parseLeumiCardFile(Buffer.from(""));
    expect(result.success).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });
});
