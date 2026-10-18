import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as XLSX from "xlsx";
import { processSupplierFile } from "@/lib/file-processor";
import { supplierFileUploadStatus } from "@/lib/supplier-file-status";

const tuviotFixture = resolve(
  __dirname,
  "../custom-parsers/__tests__/fixtures/tuviot-hatzafon-q3-2026.xlsx"
);

describe("supplierFileUploadStatus", () => {
  it("auto-approves when no row needs review and no anomaly says rows were lost", () => {
    expect(supplierFileUploadStatus(0, undefined)).toBe("auto_approved");
    expect(supplierFileUploadStatus(0, [])).toBe("auto_approved");
  });

  it("sends rows needing review to needs_review", () => {
    expect(supplierFileUploadStatus(2, [])).toBe("needs_review");
  });

  it("sends a grand-total mismatch to needs_review even when every row matched", () => {
    expect(
      supplierFileUploadStatus(0, [
        { code: "GRAND_TOTAL_MISMATCH", severity: "warning", messageHe: "x", acknowledged: true },
      ])
    ).toBe("needs_review");
  });

  it("ignores other warning anomalies", () => {
    expect(
      supplierFileUploadStatus(0, [
        { code: "FILTERED_ROWS_BY_DOCTYPE", severity: "warning", messageHe: "x" },
      ])
    ).toBe("auto_approved");
  });
});

describe("processSupplierFile → status (תויות הצפון Q3-2026)", () => {
  const buffer = readFileSync(tuviotFixture);

  it("a parser that loses a block yields a GRAND_TOTAL_MISMATCH anomaly → needs_review", async () => {
    // Blank the Azrieli block's total cell so the parser drops the block
    const wb = XLSX.read(buffer, { type: "buffer" });
    delete wb.Sheets[wb.SheetNames[0]]["U181"];
    const tampered = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;

    const r = await processSupplierFile(tampered, null, false, 0.18, "TAVIOT_HATZAFON");

    expect(r.warnings.map((w) => w.code)).toEqual(["GRAND_TOTAL_MISMATCH"]);
    const anomaly = r.anomalies?.find((a) => a.code === "GRAND_TOTAL_MISMATCH");
    expect(anomaly?.severity).toBe("warning");
    expect(anomaly?.messageHe).toContain("ייתכן שזכיין לא נקלט");
    expect(supplierFileUploadStatus(0, r.anomalies)).toBe("needs_review");
  });

  it("the intact file stays auto-approvable", async () => {
    const r = await processSupplierFile(buffer, null, false, 0.18, "TAVIOT_HATZAFON");

    expect(r.anomalies?.some((a) => a.code === "GRAND_TOTAL_MISMATCH") ?? false).toBe(false);
    expect(supplierFileUploadStatus(0, r.anomalies)).toBe("auto_approved");
  });
});
