import { describe, it, expect } from "vitest";
import { findCollidingAliases } from "@/data-access/franchisees";

const OWNERS = [
  {
    id: "karmiel",
    name: "קינג קונג כרמיאל",
    code: "516476561",
    aliases: ['קינג כרמיאל בע"מ', "כרמיאל (קינג קונג)"],
  },
  {
    id: "motzkin",
    name: 'קינג קונג מוצקין בע"מ',
    code: "517245957",
    aliases: ["קינג מוצקין", "מוצקין"],
  },
];

describe("findCollidingAliases", () => {
  it("rejects an alias already owned by another franchisee", () => {
    // The exact Q2-2026 bug: מוצקין's alias registered under כרמיאל
    const collisions = findCollidingAliases(['קינג קונג מוצקין בע"מ'], OWNERS, "karmiel");
    expect(collisions).toHaveLength(1);
    expect(collisions[0].ownerId).toBe("motzkin");
  });

  it("matches despite quote/spacing variants (normalizeName semantics)", () => {
    const collisions = findCollidingAliases(["קינג כרמיאל בע״מ"], OWNERS, "motzkin");
    expect(collisions).toHaveLength(1);
    expect(collisions[0].ownerId).toBe("karmiel");
  });

  it("allows an alias on its own franchisee (excludeFranchiseeId)", () => {
    expect(findCollidingAliases(["קינג מוצקין"], OWNERS, "motzkin")).toHaveLength(0);
  });

  it("allows a genuinely new alias", () => {
    expect(findCollidingAliases(["קינג קונג חדרה"], OWNERS, "karmiel")).toHaveLength(0);
  });

  it("also protects primary names and codes", () => {
    expect(findCollidingAliases(["קינג קונג כרמיאל"], OWNERS, "motzkin")).toHaveLength(1);
    expect(findCollidingAliases(["516476561"], OWNERS, "motzkin")).toHaveLength(1);
  });
});
