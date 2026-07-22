import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArelArizotFile } from "../arel-arizot-parser";

const fixturesDir = resolve(__dirname, "fixtures");

describe("parseArelArizotFile — compact layout, real CP1255 .xls", () => {
  // Real production export from upload e86e41ab (2026-07-01). The parser was
  // correct all along — this file failed in prod because the server bundle
  // read the BIFF/CP1255 Hebrew as mojibake (no codepage table registered),
  // so the "ריכוז מכירות ללקוחות" title never matched. The registration now
  // lives at the top of file-processor.ts; this test pins the parser side.
  const buffer = readFileSync(resolve(fixturesDir, "arel-arizot-q2-2026.xls"));

  it("parses one aggregated row per customer and back-calculates net", () => {
    const r = parseArelArizotFile(buffer);

    expect(r.success).toBe(true);
    expect(r.data).toHaveLength(19);

    // File's own "סה"כ מכירות" row: 1,721,388.02 gross (±2 rounding)
    expect(Math.abs(r.summary.totalGrossAmount - 1721388)).toBeLessThanOrEqual(2);

    const horev = r.data.find((d) => d.franchisee === 'קינג קונג חורב בע"מ')!;
    expect(horev.grossAmount).toBe(129731);
    expect(horev.netAmount).toBe(109942); // 129731 / 1.18

    // The standing "dates not extracted" anomaly must be surfaced
    expect(r.anomalies?.some((a) => a.code === "DATES_NOT_EXTRACTED")).toBe(true);
  });
});
