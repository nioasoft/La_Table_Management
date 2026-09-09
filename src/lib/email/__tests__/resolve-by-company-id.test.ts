import { describe, it, expect } from "vitest";
import { resolveFranchiseeByCompanyId } from "../resolve-by-company-id";

const FRANCHISEES = [
  { id: "f1", name: 'קינג קונג מוצקין בע"מ', companyId: "517245957" },
  { id: "f2", name: 'קינג קונג חדרה בע"מ', companyId: "517012217" },
  { id: "f3", name: "נתנזון עזריאלי חיפה", companyId: null },
];

describe("resolveFranchiseeByCompanyId", () => {
  it("matches the recipient ח.פ even when the name is mojibake", () => {
    // Real pdf-parse output of ezcount invoice 170325 — the name block is
    // unreadable, the ח.פ line is not.
    const text = [
      "משלוחה )דיב אנד רד פרוג'קטס בע\"מ(",
      "514570290 :.פ.ח",
      "×ž×•×¦×§×™×Ÿ(×§×™× ×’ ×§×•× ×’",
      "517245957 :.פ/ת.ז.ח",
    ].join("\n");
    expect(resolveFranchiseeByCompanyId(text, FRANCHISEES)?.id).toBe("f1");
  });

  it("ignores the issuer's ח.פ because it is not a franchisee", () => {
    expect(
      resolveFranchiseeByCompanyId("514570290 :.פ.ח", FRANCHISEES),
    ).toBeNull();
  });

  it("refuses to guess when two franchisees appear", () => {
    expect(
      resolveFranchiseeByCompanyId("517245957 ... 517012217", FRANCHISEES),
    ).toBeNull();
  });

  it("does not match a 9-digit run inside a longer number", () => {
    // 17-digit allocation numbers sit next to the ח.פ on these invoices.
    expect(
      resolveFranchiseeByCompanyId("20260803125417245957", FRANCHISEES),
    ).toBeNull();
  });

  it("ignores franchisees with no ח.פ on record", () => {
    expect(resolveFranchiseeByCompanyId("999999999", FRANCHISEES)).toBeNull();
    expect(resolveFranchiseeByCompanyId("", FRANCHISEES)).toBeNull();
  });
});
