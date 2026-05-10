import { describe, expect, it } from "vitest";
import { findOperatingBrand } from "../franchisee-parent-map";

describe("findOperatingBrand", () => {
  it('routes "פט ויני עזריאלי בע\\"מ" to Natanzon Azrieli Haifa (Asaf 2026-04-30 rule)', () => {
    const pair = findOperatingBrand('פט ויני עזריאלי בע"מ');
    expect(pair).not.toBeNull();
    expect(pair?.operatingFranchiseeId).toBe(
      "ab020323-fefe-4543-9a69-16d14dd54b99",
    );
    expect(pair?.operatingFranchiseeName).toBe("נתנזון עזריאלי חיפה");
  });

  it.each([
    'פט ויני עזריאלי בע"מ',
    "פט ויני עזריאלי בעמ",
    'פאט ויני עזריאלי בע"מ',
    "פאט ויני עזריאלי בעמ",
    "פט ויני עזריאלי",
    "פאט ויני עזריאלי",
    'פט ויני עזריאלי בע"מ - חיפה',
  ])("matches Pat Vini Azrieli alias %j", (name) => {
    const pair = findOperatingBrand(name);
    expect(pair?.operatingFranchiseeName).toBe("נתנזון עזריאלי חיפה");
  });

  it("returns null for franchisees without a parent override", () => {
    expect(findOperatingBrand('קינג קונג חורב בע"מ')).toBeNull();
    expect(findOperatingBrand("ויני רגבה")).toBeNull();
    expect(findOperatingBrand("נתנזון עזריאלי חיפה")).toBeNull();
  });

  it("returns null for empty / null / undefined inputs", () => {
    expect(findOperatingBrand("")).toBeNull();
    expect(findOperatingBrand("   ")).toBeNull();
    expect(findOperatingBrand(undefined)).toBeNull();
    expect(findOperatingBrand(null)).toBeNull();
  });

  // Regression: bidirectional .includes() previously fired parent override on
  // generic substrings of aliases (e.g., "ויני" alone matched alias
  // "פט ויני עזריאלי" via reverse-includes), hijacking legitimate franchisee
  // matches. After fix: only forward containment (candidate ⊇ alias) and
  // exact match are allowed.
  it("does not trigger parent override on generic substrings of aliases", () => {
    expect(findOperatingBrand("ויני עזריאלי")).toBeNull();
    expect(findOperatingBrand("ויני")).toBeNull();
    expect(findOperatingBrand("עזריאלי")).toBeNull();
    expect(findOperatingBrand("פט ויני")).toBeNull();
    expect(findOperatingBrand("פט")).toBeNull();
  });

  it("does not trigger parent override on unrelated franchisee names that share a token", () => {
    // "האט נתנזון" should NOT route to Netanzon-Azrieli via parent map —
    // it should reach the regular fuzzy matcher with no override.
    expect(findOperatingBrand("האט נתנזון")).toBeNull();
    // Unrelated brand that happens to share the "ויני" token:
    expect(findOperatingBrand("ויני רגבה")).toBeNull();
  });
});
