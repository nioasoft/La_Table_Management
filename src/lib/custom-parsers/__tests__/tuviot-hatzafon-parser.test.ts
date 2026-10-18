import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as XLSX from "xlsx";
import { parseTuviotHatzafonFile } from "../tuviot-hatzafon-parser";

const fixturesDir = resolve(__dirname, "fixtures");

describe("parseTuviotHatzafonFile — Q3-2026 quarterly blocks", () => {
  // Real upload f91713b1 ("חשבוניות רבעון - 07-08-09-2026.xlsx"). The
  // "ויני עזריאלי / נתנזון" block has blank "0.00" spacer rows before its
  // total row; they used to close the block, so its ₪8,875.48 was dropped.
  const buffer = readFileSync(resolve(fixturesDir, "tuviot-hatzafon-q3-2026.xlsx"));

  it("keeps a block whose total sits below zero-value spacer rows", () => {
    const r = parseTuviotHatzafonFile(buffer);

    expect(r.success).toBe(true);
    const azrieli = r.data.find((d) => d.franchisee === "ויני עזריאלי / נתנזון");
    expect(azrieli?.netAmount).toBe(8875);
  });

  it("parsed sum equals the file's own סה\"כ כללי, with no warnings", () => {
    const r = parseTuviotHatzafonFile(buffer);

    // rows are rounded to whole shekels, so allow per-row drift
    expect(Math.abs(r.summary.totalNetAmount - 122262.8)).toBeLessThanOrEqual(5);
    expect(r.warnings).toHaveLength(0);
  });

  it("warns when a block is lost against סה\"כ כללי", () => {
    // Blank the Azrieli block's total cell (sheet row 181) so it is dropped
    const wb = XLSX.read(buffer, { type: "buffer" });
    const ws = wb.Sheets[wb.SheetNames[0]];
    delete ws["U181"];
    const tampered = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;

    const r = parseTuviotHatzafonFile(tampered);

    expect(r.data.find((d) => d.franchisee.includes("עזריאלי"))).toBeUndefined();
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0].details).toContain("ייתכן שזכיין לא נקלט");
  });
});
