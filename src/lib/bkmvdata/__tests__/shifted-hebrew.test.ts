import { describe, it, expect } from "vitest";
import { decodeBuffer, unshiftHebrew } from "../encoding";
import { parseBkmvData } from "../router";

// Fixed-width B110 line: key at 22, name at 37, type at 200 (see B110_FIELDS).
const b110 = (key: string, name: string, type: string) =>
  `B110${"0".repeat(9)}516087038${key.padStart(15, "0")}${name.padEnd(30)}`.padEnd(200) + type.padEnd(30);

const A100 = "A100000000001516087038000000000000&OF1.31&";

describe("unshiftHebrew", () => {
  it("decodes the 7-bit shifted names as they appear in מיאמוטו's 2026-07 export", () => {
    const text = [A100, b110("2100010", "DKPQEZ NDQRCD", "DKPQEZ NDQRCD"), b110("1", "APW DTERLIM", "")].join("\r\n");
    const out = unshiftHebrew(text).split("\r\n");
    expect(out[0]).toBe(A100); // record codes and the &OF1.31& constant are real ASCII
    expect(out[1].substring(37, 67).trim()).toBe("הכנסות מהסעדה");
    expect(out[2].substring(37, 67).trim()).toBe("בנק הפועלים");
  });

  it("maps & to א and final letters correctly", () => {
    const out = unshiftHebrew(b110("1", 'WETZ &YX&I NXEKFZ NWQ &IH TIPPQIM AR"N', ""));
    expect(out).toContain('קופת אשראי מרוכזת');
    expect(unshiftHebrew(b110("1", "NWQ &IH", ""))).toContain("מקס איט");
  });

  it("leaves a normal Hebrew file untouched", () => {
    const text = [A100, b110("2100010", "הכנסות מהסעדה", "הכנסות מהסעדה"), b110("2", "VINNI קריות", "")].join("\r\n");
    expect(unshiftHebrew(text)).toBe(text);
  });
});

describe("parseBkmvData on a shifted file", () => {
  it("detects the revenue account once the Hebrew is restored", () => {
    const buf = Buffer.from([A100, b110("2100010", "DKPQEZ NDQRCD", "DKPQEZ NDQRCD")].join("\r\n"), "latin1");
    expect(decodeBuffer(buf)).toContain("הכנסות מהסעדה");
    const result = parseBkmvData(buf);
    expect(result.companyId).toBe("516087038");
    expect(result.accounts[0].accountName.trim()).toBe("הכנסות מהסעדה");
  });
});
