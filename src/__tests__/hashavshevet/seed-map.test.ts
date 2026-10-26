import { describe, it, expect } from "vitest";
import {
  SEED_COMPANIES,
  SEED_BRAND_MAP,
  SEED_FRANCHISEE_MAP,
} from "../../../scripts/seed-hashavshevet-companies";

describe("hashavshevet seed map", () => {
  it("seed covers spec §4 exactly", () => {
    expect(SEED_COMPANIES).toHaveLength(14);
    expect(new Set(SEED_COMPANIES.map((c) => c.fileName)).size).toBe(14);
    expect(SEED_BRAND_MAP).toEqual({
      MINNA_TOMEI: "smminna",
      VINNI: "fv",
      KING_KONG: "smminna_2024",
    });
    expect(SEED_FRANCHISEE_MAP['קינג קונג מוצקין בע"מ']).toBe(
      "kingkong_hadera_2024_2026",
    );
    expect(Object.keys(SEED_FRANCHISEE_MAP)).toHaveLength(8);
    // Natanzon shares Vini Azrieli's legal entity, so it books into the same company.
    expect(SEED_FRANCHISEE_MAP["נתנזון עזריאלי חיפה"]).toBe(SEED_FRANCHISEE_MAP["ויני עזריאלי חיפה"]);
    expect(SEED_COMPANIES.every((c) => c.fileName !== "DEMO")).toBe(true);
  });

  it("every mapped file name exists in the companies list", () => {
    const names = new Set(SEED_COMPANIES.map((c) => c.fileName));
    for (const f of [
      ...Object.values(SEED_BRAND_MAP),
      ...Object.values(SEED_FRANCHISEE_MAP),
    ]) {
      expect(names.has(f)).toBe(true);
    }
  });
});
