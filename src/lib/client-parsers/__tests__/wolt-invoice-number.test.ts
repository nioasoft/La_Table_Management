import { describe, expect, it } from "vitest";
import { extractWoltInvoiceNumber } from "../wolt-parser";
import { extractAllocationNumber } from "../extract-allocation-number";

/**
 * Text fixture mirroring the pdf-parse visual-RTL output of the real
 * self-billed Wolt invoice (ויני רגבה, June 2026). The invoice number
 * (660012) sits on the line BEFORE the "מס' חשבונית" label, while the
 * 9-digit allocation number (182075826) comes right after it — the old
 * after-label-only regex captured the allocation as the invoice number.
 */
const SELF_BILLED_TEXT = `( רוקמ ) סמ תינובשח
516148947
516148947
660012
מורשה עוסק מספר
פ"ח מספר
חשבונית 'מס
לפרטים ראה דוח פירוט עסקאות
בע״מ רגבה ויני
30.06.2026

חשבונית תאריך
660012

חשבונית 'מס
182075826

הקצאה מספר

לכבוד
Wolt Enterprises Israel Ltd
30.06.2026 - 01.06.2026 החיוב תקופת
מכירות כ"סה 72,535.5918.00% 13,056.41 85,592.00
כ"סה 73,684.75 13,263.25 86,948.00
4992449 מספר וולט חשבונית בניכוי יהיה זו חשבונית תשלום`;

describe("extractWoltInvoiceNumber", () => {
  it("takes the value before the label, not the allocation number after it", () => {
    const allocation = extractAllocationNumber(SELF_BILLED_TEXT);
    expect(allocation).toBe("182075826");
    expect(extractWoltInvoiceNumber(SELF_BILLED_TEXT, allocation)).toBe(
      "660012"
    );
  });

  it("falls back to the after-label pattern on legacy layouts", () => {
    const legacy = `חשבונית מס מקור\nחשבונית 'מס\n4946028\nלכבוד`;
    expect(extractWoltInvoiceNumber(legacy, undefined)).toBe("4946028");
  });

  it("never returns the allocation number even when it follows the label", () => {
    const allocationOnly = `חשבונית 'מס\n182075826\nהקצאה מספר`;
    expect(extractWoltInvoiceNumber(allocationOnly, "182075826")).toBe("");
  });
});
