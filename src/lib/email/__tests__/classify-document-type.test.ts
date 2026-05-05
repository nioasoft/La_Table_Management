import { describe, expect, it } from "vitest";
import { detectDocumentType } from "../classify-document-type";

describe("detectDocumentType", () => {
  describe("commission_invoice classification", () => {
    it.each([
      ["FW: חשבונית מס מס' 4946028 מאת Wolt Enterprises", "Wolt tax invoice"],
      [
        '(מסמך ממוחשב) הדפסת חשבונית מרכזת - 04.2026 ,SI266010419 חוד',
        "HAAT centralised invoice",
      ],
      [
        "FW: החשבונית החודשית מפלאקסי ישראל",
        "Cibus/Plaxie monthly commission invoice",
      ],
      ["EasyCount Invoice for HAAT", "Generic ezcount invoice"],
      [
        "FW: חשבונית מס מס' 12345 מאת תן ביס בע\"מ",
        "Tnbis tax invoice (no [העתק])",
      ],
    ])('classifies %j as commission_invoice (%s)', (subject) => {
      expect(detectDocumentType(subject)).toBe("commission_invoice");
    });
  });

  describe("client_report classification", () => {
    it.each([
      [
        'FW: [העתק] חשבונית מס 10049 מאת קינג קונג חורב בע"מ',
        "HAAT EasyCount franchisee→HAAT (the bug Reut reported 2026-05-05)",
      ],
      [
        'FW: [העתק] חשבונית מס 10072 מאת קסטרא טומאיי בע"מ (מינה טומיי סטיישן חיפה)',
        "HAAT EasyCount with brand suffix",
      ],
      [
        'FW: [העתק] חשבונית מס 10074 מאת פאט ויני עזריאלי בע"מ',
        "HAAT EasyCount Pat Vini",
      ],
      ["Pluxee דוח", "Cibus monthly report"],
      [
        "FW: דוח חודשי מתן ביס לויני רגבה בע''מ",
        "Tnbis monthly report",
      ],
      ["FW: דוח חודשי", "Generic monthly report"],
    ])('classifies %j as client_report (%s)', (subject) => {
      expect(detectDocumentType(subject)).toBe("client_report");
    });
  });

  it("override pattern beats invoice keywords (priority test)", () => {
    // The "[העתק] ... חשבונית ... מאת" override must be evaluated BEFORE
    // the global "חשבונית מס" keyword check, otherwise it does nothing.
    const subject = 'FW: [העתק] חשבונית מס 10049 מאת קינג קונג בע"מ';
    expect(detectDocumentType(subject)).toBe("client_report");
  });

  it("empty/missing subject defaults to client_report", () => {
    expect(detectDocumentType("")).toBe("client_report");
  });
});
