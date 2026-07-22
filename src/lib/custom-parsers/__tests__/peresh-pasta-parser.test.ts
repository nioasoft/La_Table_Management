import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import { parsePereshPastaFile } from "../peresh-pasta-parser";

function xlsx(rows: unknown[][]): Buffer {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), "גיליון1");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

// The real Q2-2026 file, reproduced as an AoA (data starts at column E)
const REAL_FILE: unknown[][] = [
  ['פרש פסטה פרימיום פקטורי בע"מ', null, null, null, null, null, null],
  ["מכירות 2026 לפי לקוח (כספי) - רבעוני", null, null, null, null, null, null],
  [null, null, null, null, "מפתח", "שם חשבון", "רבעון2"],
  ["קוד מיון", "0", null, 0, null, null, null],
  [null, null, null, null, "21305", 'פט ויני עזריאלי בע"מ / קניון חיפה', -18117.77],
  [null, null, null, null, "21320", 'ויני רגבה בע"מ / פט ויני רגבה', -20997.44],
  [null, null, null, null, "21322", 'ויני כרמיאל בע"מ', -11441.52],
  [null, null, null, null, "21324", 'טמפר הסעדה בע"מ / ויני יהוד', -8763.54],
  [null, null, null, null, "21328", 'סידיוס בע"מ / ויני נתניה', -11483.04],
  [null, null, null, null, "21331", 'מיאמוטו בע"מ / ויני ק.אתא', -12581.35],
  [null, null, null, null, "21333", 'ויני חדרה מול חוף בע"מ', -6788.13],
  [null, null, null, null, null, null, null],
  [null, null, null, null, null, null, -90172.79],
  [null, null, null, null, null, 0.1, -9017.279],
];

describe("parsePereshPastaFile", () => {
  it("parses the real Q2-2026 file", () => {
    const r = parsePereshPastaFile(xlsx(REAL_FILE));

    expect(r.success).toBe(true);
    expect(r.errors).toHaveLength(0);
    expect(r.data).toHaveLength(7);
    expect(r.summary.totalNetAmount).toBe(90173);

    const haifa = r.data.find(d => d.franchisee.includes("עזריאלי"))!;
    expect(haifa.netAmount).toBe(18118); // sign flipped, rounded
    expect(haifa.grossAmount).toBe(21379); // net * 1.18
    expect(haifa.preCalculatedCommission).toBeUndefined(); // system applies 10%
  });

  it("never turns the totals or commission row into a franchisee", () => {
    const r = parsePereshPastaFile(xlsx(REAL_FILE));
    // Row 13 puts "0.1" in the name column — it must not become a customer
    expect(r.data.some(d => d.franchisee === "0.1")).toBe(false);
    expect(r.data.every(d => d.netAmount > 0)).toBe(true);
    expect(r.legacyWarnings).toHaveLength(0); // totals row matches parsed sum
  });

  it("locates columns by header, not by index", () => {
    // Same data shifted left so the headers sit in columns A-C
    const shifted = REAL_FILE.map(row => row.slice(4));
    const r = parsePereshPastaFile(xlsx(shifted));

    expect(r.success).toBe(true);
    expect(r.data).toHaveLength(7);
    expect(r.summary.totalNetAmount).toBe(90173);
  });

  it("picks the last period column and warns when a full year is exported", () => {
    const fullYear: unknown[][] = [
      [null, null, null, null, "מפתח", "שם חשבון", "רבעון1", "רבעון2"],
      [null, null, null, null, "21322", 'ויני כרמיאל בע"מ', -5000, -11441.52],
    ];
    const r = parsePereshPastaFile(xlsx(fullYear));

    expect(r.success).toBe(true);
    expect(r.data[0].netAmount).toBe(11442); // רבעון2, not רבעון1
    expect(r.legacyWarnings.join()).toContain("Multiple amount columns");
  });

  it("skips refunds (positive in the ledger) with a warning", () => {
    const withRefund: unknown[][] = [
      [null, null, null, null, "מפתח", "שם חשבון", "רבעון2"],
      [null, null, null, null, "21322", 'ויני כרמיאל בע"מ', -11441.52],
      [null, null, null, null, "21333", 'ויני חדרה מול חוף בע"מ', 500],
    ];
    const r = parsePereshPastaFile(xlsx(withRefund));

    expect(r.data).toHaveLength(1);
    expect(r.warnings.some(w => w.code === "NEGATIVE_AMOUNT")).toBe(true);
  });

  it("fails loudly when the header row is missing", () => {
    const r = parsePereshPastaFile(xlsx([["רעש", "בלי", "כותרות"], [1, 2, 3]]));
    expect(r.success).toBe(false);
    expect(r.legacyErrors.join()).toContain("Header row");
  });
});
