import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as XLSX from "xlsx";
import { parseYamaVekadmaFile } from "../yama-vekadma-parser";

const fixturesDir = resolve(__dirname, "fixtures");

describe("parseYamaVekadmaFile — ניתוח מכירות תקופתי (HTML sales report)", () => {
  // Real supplier export, printed 30/07/2026 for the range 01/04–01/07/2026:
  // UTF-16LE HTML with a `.xls` extension, one row per month × customer × item.
  const buffer = readFileSync(
    resolve(fixturesDir, "yama-vekadma-sales-report.xls")
  );

  it("aggregates one row per customer with ex-VAT amounts", () => {
    const r = parseYamaVekadmaFile(buffer);

    expect(r.success).toBe(true);
    expect(r.data).toHaveLength(11);

    // Amounts in this report exclude VAT: net is taken as-is, gross adds 18%
    const hadera = r.data.find((d) => d.franchisee === "קינג קונג סניף חדרה")!;
    expect(hadera.netAmount).toBe(1414); // 586.56 + 340.16 + 487.56
    expect(hadera.grossAmount).toBe(1669);
    // date = latest month present for that customer (July)
    expect(hadera.date?.getMonth()).toBe(6);
    expect(hadera.date?.getFullYear()).toBe(2026);

    // Sum of the per-customer rounded amounts (file sums to 14,335.36)
    expect(r.summary.totalNetAmount).toBe(14336);
    expect(r.summary.vatAdjusted).toBe(false);
  });

  it("keeps credit rows negative and warns about them", () => {
    const r = parseYamaVekadmaFile(buffer);

    // קסטרה has a -4,239.68 credit in May that outweighs its sales
    const kastra = r.data.find((d) => d.franchisee.includes("קסטרה"))!;
    expect(kastra.netAmount).toBe(-1640);
    expect(r.warnings.some((w) => w.code === "NEGATIVE_AMOUNT")).toBe(true);
  });

  it("flags the month range so a stray month can't slip into a quarter", () => {
    const r = parseYamaVekadmaFile(buffer);

    const anomaly = r.anomalies!.find((a) => a.code === "MIXED_PERIODS")!;
    expect(anomaly.severity).toBe("warning");
    expect(anomaly.details!.monthlyTotals).toHaveLength(4); // 04–07/2026
    expect(anomaly.messageHe).toContain("07/2026");
  });
});

describe("parseYamaVekadmaFile — the same report as a real workbook", () => {
  // Reut's corrected Q2-2026 file, 02/09/2026. Opening the ERP's HTML-table
  // .xls in Excel and saving it turns it into a genuine OLE2 workbook, so the
  // <table> sniffer no longer recognises it and every row used to fail the
  // כרטסת ledger's shape — ALL_ROWS_FILTERED, nothing saveable.
  const buffer = readFileSync(
    resolve(fixturesDir, "yama-vekadma-sales-report-workbook.xls")
  );

  it("parses the workbook form to the same eleven customers", () => {
    const r = parseYamaVekadmaFile(buffer);

    expect(r.success).toBe(true);
    expect(r.data).toHaveLength(11);
    expect(r.summary.totalNetAmount).toBe(15646);
    expect(r.summary.vatAdjusted).toBe(false);

    const kastra = r.data.find((d) => d.franchisee === "קסטרא טומאיי")!;
    expect(kastra.netAmount).toBe(2975);
    const big = r.data.find((d) => d.franchisee.includes("קרית אתא"))!;
    expect(big.netAmount).toBe(3229);
  });

  it("reads the month column even after the .xls→.xlsx re-encode drops its format", () => {
    // This is the path production actually takes: the browser converts .xls to
    // .xlsx before upload because the WAF blocks .xls, and the conversion drops
    // the number format — the month arrives as a bare Excel serial with nothing
    // left to say it was a date.
    const workbook = XLSX.read(buffer, { type: "buffer" });
    const reencoded = Buffer.from(
      XLSX.write(workbook, { type: "array", bookType: "xlsx" }) as ArrayBuffer
    );

    const r = parseYamaVekadmaFile(reencoded);
    expect(r.success).toBe(true);
    expect(r.summary.totalNetAmount).toBe(15646);

    // April–June, not January–March: a serial read as M/D/YY vs D/M/YY differs
    // by five months and both readings look plausible.
    const months = new Set(r.data.map((d) => d.date!.getMonth()));
    expect([...months].sort()).toEqual([3, 4, 5]);
    expect(r.data.every((d) => d.date!.getFullYear() === 2026)).toBe(true);
  });
});
