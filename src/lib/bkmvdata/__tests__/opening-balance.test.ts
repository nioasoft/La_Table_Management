import { describe, it, expect } from "vitest";
import { isOpeningBalanceEntry } from "../parser";
import type { BkmvTransaction } from "../types";

const tx = (over: Partial<BkmvTransaction>): BkmvTransaction => ({
  lineNumber: 1,
  companyId: "515639052",
  accountCode: "00001",
  documentNumber: "00000001",
  description: "",
  documentDate: new Date(2026, 0, 1),
  valueDate: new Date(2026, 0, 1),
  counterpartyName: "הון מניות",
  side: "credit",
  currency: "",
  amount: -1000,
  reference: "000",
  accountSort: "",
  rawLine: "",
  resolvedAccountKey: "",
  ...over,
});

describe("isOpeningBalanceEntry", () => {
  it("catches the batch as it actually appears in סידיוס / מיאמוטו", () => {
    // Real shape: Jan 1, document 1, description is the single char "י".
    expect(isOpeningBalanceEntry(tx({ description: "י" }))).toBe(true);
  });

  it("catches it with a blank description too", () => {
    expect(isOpeningBalanceEntry(tx({ description: "   " }))).toBe(true);
  });

  it("keeps legitimate Jan-1 document-1 entries that carry a description", () => {
    // These exist in other franchisees' files — rent, insurance, management fees.
    for (const description of ["דמי שכירות", "ביטוח עסק", "השכרת ציוד", "דמי ניהול"]) {
      expect(isOpeningBalanceEntry(tx({ description }))).toBe(false);
    }
  });

  it("keeps an undescribed document 1 that is not dated Jan 1", () => {
    expect(
      isOpeningBalanceEntry(tx({ description: "י", documentDate: new Date(2026, 1, 1) }))
    ).toBe(false);
    expect(
      isOpeningBalanceEntry(tx({ description: "י", documentDate: new Date(2026, 0, 2) }))
    ).toBe(false);
  });

  it("keeps an undescribed Jan-1 entry from a different document", () => {
    expect(isOpeningBalanceEntry(tx({ description: "י", documentNumber: "26000145" }))).toBe(
      false
    );
  });
});
