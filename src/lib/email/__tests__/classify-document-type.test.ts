import { describe, expect, it } from "vitest";
import {
  detectDocumentType,
  isPromotionalSubject,
  isHaatMonthlyReport,
  isReceiptDocument,
} from "../classify-document-type";

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
      [
        "FW: חשבונית מס מס' 12345 מאת תן ביס בע\"מ",
        "Tnbis tax invoice (no [העתק])",
      ],
      // 2026-06-11: a platform-issued direct ezcount invoice ("מאת משלוחה")
      // must STAY commission_invoice — the franchisee-issued override below
      // keys on the issuer after "מאת", so Mishloha's own invoice is excluded.
      [
        "חשבונית מס 160782 מאת משלוחה (דיב אנד רד פרוג'קטס בע\"מ)",
        "Mishloha direct ezcount commission invoice",
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
      // 2026-06-11 (Reut): the EasyCount invoice IS the HAAT "report" —
      // it's issued BY the franchisee TO Haat (revenue evidence). It was
      // previously classified commission_invoice, which let HAAT's real
      // "חשבונית מרכזת SI..." overwrite it a day later.
      ["EasyCount Invoice for HAAT", "ezcount franchisee→HAAT invoice"],
      ["FW: EasyCount Invoice for HAAT", "forwarded ezcount invoice"],
      // 2026-06-11 (Reut): the un-forwarded [מקור] direct-ezcount form of a
      // franchisee sales invoice. No "[העתק]" prefix, so the copy override
      // doesn't fire; classified by the franchisee issuer after "מאת". This
      // is the invoice 10076 (פאט ויני עזריאלי → משלוחה) that never ingested.
      [
        'חשבונית מס 10076 מאת פאט ויני עזריאלי בע"מ',
        "Mishloha direct ezcount franchisee invoice (the missing May report)",
      ],
      [
        'חשבונית מס 10078 מאת נתנזון בורגר חיפה בע"מ',
        "franchisee invoice, Natanzon operating brand",
      ],
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

describe("isPromotionalSubject", () => {
  it.each([
    ["תגידו שלום למוצר החדש שלנו: Wolt Benefits!", "Wolt Benefits launch"],
    ["Wolt Benefits עכשיו זמין", "Wolt Benefits variant"],
    ["הסכם התקשרות סיבוס", "Cibus contract"],
    ["הסכם  התקשרות  פלאקסי", "contract with extra spaces"],
    ["ביקשתם, קיבלתם! עדכנו את תנאי הקמפיין", "Wolt campaign-terms update"],
  ])("flags %j as promotional (%s)", (subject) => {
    expect(isPromotionalSubject(subject)).toBe(true);
  });

  it.each([
    ["Pluxee דוח", "Cibus monthly report"],
    ["דו''ח חודשי למסעדה", "10bis monthly report"],
    ["FW: חשבונית מס מאת Wolt Enterprises", "Wolt tax invoice"],
    ["", "empty subject"],
  ])("does NOT flag %j as promotional (%s)", (subject) => {
    expect(isPromotionalSubject(subject)).toBe(false);
  });

  it("handles null/undefined safely", () => {
    expect(isPromotionalSubject(null)).toBe(false);
    expect(isPromotionalSubject(undefined)).toBe(false);
  });
});

describe("isHaatMonthlyReport", () => {
  it("flags the HAAT red monthly summary for the HAAT client", () => {
    expect(
      isHaatMonthlyReport(
        "HAAT",
        "HAAT Delivery | הדוח החודשי שלך עבור 05/2026 מוכן",
      ),
    ).toBe(true);
  });

  it("is case-insensitive on the client code", () => {
    expect(
      isHaatMonthlyReport("haat", "הדוח החודשי שלך עבור 04/2026 מוכן"),
    ).toBe(true);
  });

  it("does not flag other HAAT emails", () => {
    expect(isHaatMonthlyReport("HAAT", "EasyCount Invoice for HAAT")).toBe(
      false,
    );
    expect(
      isHaatMonthlyReport(
        "HAAT",
        "(מסמך ממוחשב) הדפסת חשבונית מרכזת - 05.2026 ,SI266013298 חוד",
      ),
    ).toBe(false);
  });

  it("does not flag the same subject for other clients", () => {
    expect(
      isHaatMonthlyReport("WOLT", "הדוח החודשי שלך עבור 05/2026 מוכן"),
    ).toBe(false);
    expect(isHaatMonthlyReport(null, "הדוח החודשי שלך עבור 05/2026")).toBe(
      false,
    );
  });
});

describe("isReceiptDocument", () => {
  it("flags an ezcount payment receipt (the June 2026 HAAT incident)", () => {
    expect(
      isReceiptDocument('[העתק] קבלה 20007 מאת קינג קונג חורב בע"מ'),
    ).toBe(true);
  });

  it("flags [מקור] and un-prefixed receipt subjects", () => {
    expect(isReceiptDocument('[מקור] קבלה 20008 מאת קסטרא טומאיי בע"מ')).toBe(
      true,
    );
    expect(isReceiptDocument('קבלה 12345 מאת מסעדה כלשהי בע"מ')).toBe(true);
  });

  it("does NOT flag a tax invoice (which must still be captured)", () => {
    expect(
      isReceiptDocument('[העתק] חשבונית מס 10052 מאת קינג קונג חורב בע"מ'),
    ).toBe(false);
  });

  it("does NOT flag a combined חשבונית מס/קבלה (a real invoice)", () => {
    expect(
      isReceiptDocument('[העתק] חשבונית מס/קבלה 555 מאת קינג קונג חורב בע"מ'),
    ).toBe(false);
  });

  it("does not flag unrelated subjects or empty input", () => {
    expect(isReceiptDocument("EasyCount Invoice for HAAT")).toBe(false);
    expect(isReceiptDocument("קבלה בברכה")).toBe(false); // no "NNNN מאת"
    expect(isReceiptDocument(null)).toBe(false);
    expect(isReceiptDocument(undefined)).toBe(false);
  });
});
