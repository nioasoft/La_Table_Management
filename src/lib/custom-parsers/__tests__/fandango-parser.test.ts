import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import { parseFandangoFile } from "../fandango-parser";

function xlsx(rows: unknown[][]): Buffer {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), "AlmogERP&CRM");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

const TAIL = ["10.00", "0000031180", 'קינג קונג (ניהול מותג) בע"מ', "טיפול שמנים כולל", "קבוצת ניהול"];

// Q2-2026 layout: purchases in F, commission in G
const Q2: unknown[][] = [
  ["מספר לקוח", "שם לקוח", "תאריך", "קוד מסמך", "תאור פריט", 'סה"כ קניות (ש"ח)', 'עמלת רשת (ש"ח)', "אחוז עמלת רשת", "קוד רשת מועדון", "שם רשת מועדון", "משפחה", "itmCode", "qty", "accnamemain"],
  ["0000032512", "קינג קונג - רעננה", "4/8/26", "44.26.002932", "שמן טיגון", "1,881.60", "188.16", "10.00", "", "", "", "3500001", "21.00", ""],
  ["0000032512", "קינג קונג - רעננה", "4/8/26", "44.26.002932", "אבקת סינון", "750.00", "75.00", "10.00", "", "", "", "3500005", "1.00", ""],
];

// Q3-2026 layout: itmCode + qty moved in front, purchases now H, commission I,
// and an unlabeled grand-total row at the bottom.
const Q3: unknown[][] = [
  ["מספר לקוח", "שם לקוח", "תאריך", "קוד מסמך", "itmCode", "תאור פריט", "qty", 'סה"כ קניות (ש"ח)', 'עמלת רשת (ש"ח)', "אחוז עמלת רשת", "קוד רשת מועדון", "שם רשת מועדון", "משפחה", "accnamemain"],
  ["0000032512", "קינג קונג - רעננה", "7/1/26", "44.26.005918", "3500001", "שמן טיגון מתקדם 10 ליטר", "20.00", "1,840.00", "184.00", ...TAIL],
  ["0000032512", "קינג קונג - רעננה", "7/2/26", "47.26.000383", "3500001", "שמן טיגון מתקדם 10 ליטר", "-4.00", "-368.00", "-36.80", ...TAIL],
  ["0000032867", "מינה טומיי - יהוד", "7/14/26", "44.26.006392", "Z3", "הפרש מחיר", "20.00", "184.00", "18.40", ...TAIL],
  ["", "", "", "", "", "", "36.00", "1,656.00", "165.60", "", "", "", "", ""],
];

describe("parseFandangoFile", () => {
  it("still parses the Q2-2026 layout", () => {
    const r = parseFandangoFile(xlsx(Q2));
    expect(r.success).toBe(true);
    expect(r.data).toHaveLength(1);
    expect(r.data[0].netAmount).toBe(2632); // 1,881.60 + 750
    expect(r.data[0].preCalculatedCommission).toBe(263); // 188.16 + 75
  });

  it("finds purchases and commission by header in the Q3-2026 layout", () => {
    const r = parseFandangoFile(xlsx(Q3));
    expect(r.success).toBe(true);
    const raanana = r.data.find(d => d.franchisee === "קינג קונג - רעננה")!;
    expect(raanana.netAmount).toBe(1472); // 1,840 - 368 credit
    expect(raanana.preCalculatedCommission).toBe(147); // 184 - 36.80
    // Commission comes from עמלת רשת, never from the אחוז עמלת רשת rate column
    const yehud = r.data.find(d => d.franchisee === "מינה טומיי - יהוד")!;
    expect(yehud.preCalculatedCommission).toBe(18);
  });

  it("fails with the missing header named when the layout is unrecognizable", () => {
    const r = parseFandangoFile(xlsx([["שם לקוח", "סכום"], ["x", "1"]]));
    expect(r.success).toBe(false);
    expect(r.errors[0].details).toContain("עמלת רשת");
  });
});
