import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as XLSX from "xlsx";
import { parseYevuleiGourmetFile } from "../yevulei-gourmet-parser";

const DOC_REPORT_FIXTURE = join(
  __dirname,
  "fixtures",
  "yevulei-gourmet-doc-report.xlsx"
);

function loadDocReport(): Buffer {
  return readFileSync(DOC_REPORT_FIXTURE);
}

/**
 * Build a minimal legacy "monthly pivot" workbook in-memory so we can prove
 * backward compatibility without shipping a real (PII-bearing) old file.
 */
function buildLegacyPivot(): Buffer {
  const aoa: unknown[][] = [
    ["לשנת : 2025"],
    ['סה"כ', "ינואר", "פברואר", "מרץ"], // month header
    [1500, 500, 500, 500], // data row (months populated)
    [1500, null, null, null, "מסעדת בדיקה 990", ':סה"כ'], // per-customer subtotal (990 = supplier code)
    [1500, null, null, null, null, ':סה"כ לדוח'], // grand total (skipped)
  ];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "דוח מכירות 2025");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
}

describe("parseYevuleiGourmetFile — documents report (Format A)", () => {
  it("detects the documents-report layout and parses its rows", () => {
    const result = parseYevuleiGourmetFile(loadDocReport());
    expect(result.success).toBe(true);
    // Sample is filtered to one customer with 3 monthly invoice rows.
    expect(result.data).toHaveLength(3);
  });

  it("uses net-after-discount-excl-VAT (סה\"כ − מע\"מ) as the amount", () => {
    const result = parseYevuleiGourmetFile(loadDocReport());
    const amounts = result.data.map((r) => r.netAmount).sort((a, b) => a - b);
    // 22158.6-249.38=21909.22→21909 | 22189.3-254.99=21934.31→21934 | 21011-287.45=20723.55→20724
    expect(amounts).toEqual([20724, 21934, 21909].sort((a, b) => a - b));
    // gross == net for the vat_exempt supplier
    for (const row of result.data) {
      expect(row.grossAmount).toBe(row.netAmount);
      expect(row.originalAmount).toBe(row.netAmount);
    }
  });

  it("does NOT include the two trailing total rows", () => {
    const result = parseYevuleiGourmetFile(loadDocReport());
    const sum = result.data.reduce((acc, r) => acc + r.netAmount, 0);
    // 21909 + 21934 + 20724 = 64567 (3 invoice rows only, not the ₪92,626 grand total)
    expect(sum).toBe(64567);
    expect(result.summary.totalNetAmount).toBe(64567);
  });

  it("strips the trailing customer code from the franchisee name", () => {
    const result = parseYevuleiGourmetFile(loadDocReport());
    for (const row of result.data) {
      expect(row.franchisee).toBe('ויני חדרה מול החוף בע"מ');
    }
  });

  it("extracts the real per-document dates (month-end, 2026)", () => {
    const result = parseYevuleiGourmetFile(loadDocReport());
    const iso = result.data
      .map((r) => r.date)
      .filter((d): d is Date => d instanceof Date)
      .map((d) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`)
      .sort();
    expect(iso).toEqual(["2026-1-31", "2026-2-28", "2026-3-31"]);
  });
});

describe("parseYevuleiGourmetFile — monthly pivot (Format B, legacy)", () => {
  it("still parses the legacy monthly-pivot layout", () => {
    const result = parseYevuleiGourmetFile(buildLegacyPivot());
    expect(result.success).toBe(true);
    expect(result.data).toHaveLength(1);
    const [row] = result.data;
    expect(row.franchisee).toBe("מסעדת בדיקה");
    expect(row.netAmount).toBe(1500);
    expect(row.date).toBeInstanceOf(Date);
    // Latest populated month is March → last day of March 2025.
    expect(row.date?.getFullYear()).toBe(2025);
    expect(row.date?.getMonth()).toBe(2); // March (0-indexed)
    expect(row.date?.getDate()).toBe(31);
  });
});

describe("parseYevuleiGourmetFile — error handling", () => {
  it("fails cleanly on an empty buffer", () => {
    const result = parseYevuleiGourmetFile(Buffer.from([]));
    expect(result.success).toBe(false);
    expect(result.data).toHaveLength(0);
    expect(result.errors.length).toBeGreaterThan(0);
  });
});
