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

  // Regression: 2026-05-10 — Reut reported a חשבונית הכנסה (franchisee
  // income invoice) was committed as a חשבונית עמלה (commission invoice)
  // because the subject contained "חשבונית מס" and the classifier had no
  // rule for income invoices. Income invoices belong to the client_report
  // bucket: the franchisee is the issuer, the client is the recipient,
  // and it is revenue evidence — not a commission charge to us.
  describe("income-invoice classification (חשבונית הכנסה)", () => {
    it.each([
      ["חשבונית הכנסה 12345", "Plain Hebrew income invoice"],
      ['FW: חשבונית הכנסה מאת קינג קונג בע"מ', "Forwarded income invoice"],
      ["Income Invoice from HAAT", "English income invoice"],
      ["FW: חשבונית הכנסה מס 10049", "Income invoice with מס token"],
    ])("classifies %j as client_report (%s)", (subject) => {
      expect(detectDocumentType(subject)).toBe("client_report");
    });

    it("income-invoice keyword wins over commission-invoice keyword", () => {
      // Subject technically contains both "חשבונית הכנסה" and "חשבונית מס"
      // (because "חשבונית הכנסה מס" is a real Hebrew form). The income
      // rule must be checked first, otherwise the commission rule wins.
      const subject = "חשבונית הכנסה מס 10049";
      expect(detectDocumentType(subject)).toBe("client_report");
    });

    it("body fallback: ambiguous subject + body containing 'חשבונית הכנסה' classifies as client_report", () => {
      const subject = "FW: invoice"; // ambiguous, no clear keyword
      const body = "שלום, מצורפת חשבונית הכנסה עבור התקופה.";
      expect(detectDocumentType(subject, body)).toBe("client_report");
    });

    it("body fallback: ambiguous subject + body containing commission keyword stays as commission_invoice", () => {
      const subject = "FW: invoice"; // ambiguous
      const body = "מצורפת חשבונית עמלה עבור החודש שעבר.";
      expect(detectDocumentType(subject, body)).toBe("commission_invoice");
    });

    it("body has no effect when subject is unambiguous", () => {
      // Subject already says commission_invoice — body should not override
      // (otherwise we re-introduce ambiguity for the legitimate case).
      const subject = "FW: חשבונית מס מאת Wolt Enterprises";
      const body = "אזכור של חשבונית הכנסה (לא קשור)";
      expect(detectDocumentType(subject, body)).toBe("commission_invoice");
    });
  });
});
