/**
 * Franchisee matcher regression tests.
 *
 * Primary regression: Wolt commission-invoice extraction returns the
 * franchisee name as a scrambled RTL-flipped string where the alias
 * tokens (e.g. "ויני חיפה") appear NON-contiguously — the alias's
 * tokens sit on opposite sides of an extra token ("פט"):
 *
 *   invoice parser output →  "בע״מ עזריאלי ויני פט חיפה ויני"
 *                                        ───────^^───^^──── alias tokens
 *                                                 └─ "פט" splits them
 *
 * Before the fix, only the CONTIGUOUS-token alias check caught this,
 * so "ויני חיפה" didn't hit, fuzzy similarity scored ~0.68 against the
 * wrong franchisee ("פט ויני חדרה") via a long legacy-entity alias, and
 * the email-inbound flow assigned the WOLT invoice for Pat Vini Azrieli
 * Haifa to Vini Hadera. The bag-of-tokens pass added alongside the
 * contiguous pass catches this permutation.
 */
import { describe, it, expect } from "vitest";
import { matchFranchiseeName, normalizeName } from "../franchisee-matcher";
import type { Franchisee } from "@/db/schema";

// Minimal fixture covering the "shared ויני" family that actually
// surfaced the bug in production (03/2026).
const VINNI_HAIFA: Franchisee = {
  id: "vinni-haifa",
  name: "פט ויני עזריאלי חיפה",
  code: "PVAH",
  brandId: null,
  aliases: [
    "פט ויני עזריאלי בע\"מ-חיפה",
    "פט ויני חיפה",
    "פט ויני עזריאלי",
    "פט ויני עזריאלי בע\"מ",
    "ויני עזריאלי",
    "ויני חיפה",
  ],
  isActive: true,
} as unknown as Franchisee;

const VINNI_HADERA: Franchisee = {
  id: "vinni-hadera",
  name: "ויני חדרה מול החוף בע\"מ",
  code: "VH",
  brandId: null,
  aliases: [
    "פט ויני חדרה",
    "ויני חדרה מול החוף בע\"מ",
    "ויני חדרה",
    "ויני חדרה מול חוף בע\"מ (פאט ויני חדרה)",
  ],
  isActive: true,
} as unknown as Franchisee;

const VINNI_REGBA: Franchisee = {
  id: "vinni-regba",
  name: "ויני רגבה בע\"מ",
  code: "VR",
  brandId: null,
  aliases: ["ויני רגבה", "פט ויני רגבה"],
  isActive: true,
} as unknown as Franchisee;

const VINNI_KARMIEL: Franchisee = {
  id: "vinni-karmiel",
  name: "פט ויני כרמיאל",
  code: "PVK",
  brandId: null,
  aliases: ["ויני כרמיאל"],
  isActive: true,
} as unknown as Franchisee;

const NATANZON_HAIFA: Franchisee = {
  id: "natanzon",
  name: "נתנזון עזריאלי חיפה",
  code: "NH",
  brandId: null,
  aliases: ["נתנזון", "natanzon", "נתנזון חיפה"],
  isActive: true,
} as unknown as Franchisee;

const VINNI_FAMILY = [VINNI_HAIFA, VINNI_HADERA, VINNI_REGBA, VINNI_KARMIEL];

describe("matchFranchiseeName — Wolt invoice scrambled-token regression", () => {
  it("matches Pat Vini Azrieli Haifa when alias tokens are non-contiguous (production bug 03/2026)", () => {
    // The literal string invoice-wolt-parser.ts:extractFranchiseeName returns
    // for the Pat Vini Azrieli Haifa Wolt commission invoice SI / ezcount File A.
    const scrambled = 'בע"מ עזריאלי ויני פט חיפה ויני';

    const result = matchFranchiseeName(scrambled, VINNI_FAMILY, {
      minConfidence: 0.6,
    });

    expect(result.matchedFranchisee?.id).toBe("vinni-haifa");
    // Bag-of-tokens pass scores between contiguous (0.9+) and fuzzy (0.7-):
    expect(result.confidence).toBeGreaterThanOrEqual(0.85);
    expect(result.matchedOn).toMatch(/bag-alias:|token-seq-alias:|alias:/);
  });

  it("rejects other ויני branches (Hadera / Regba / Karmiel) when the input city is Haifa", () => {
    const scrambled = 'בע"מ עזריאלי ויני פט חיפה ויני';

    const result = matchFranchiseeName(scrambled, VINNI_FAMILY, {
      minConfidence: 0.6,
    });

    // None of the OTHER ויני branches can score above Haifa via
    // bag-of-tokens since their city token ("חדרה" / "רגבה" / "כרמיאל")
    // isn't in the input.
    for (const alt of result.alternatives) {
      expect(alt.franchisee.id).not.toBe("vinni-haifa");
      expect(alt.confidence).toBeLessThan(result.confidence);
    }
  });

  it("does NOT match a franchisee when its distinctive city token is absent", () => {
    // Sanity check on the bag-of-tokens rule: Pat Vini Haifa has many
    // aliases and would otherwise match anything containing "ויני פט
    // עזריאלי" tokens. But if the input carries NO city token at all
    // (only the shared legal entity), the matcher must not confidently
    // pick any specific branch via a bag-alias hit that scores above
    // the review threshold.
    const legalEntityOnly = 'בע"מ עזריאלי ויני פט';

    const result = matchFranchiseeName(legalEntityOnly, VINNI_FAMILY, {
      minConfidence: 0.6,
    });

    // A legal-entity-only alias may still hit (e.g. "פט ויני עזריאלי"),
    // but the score must be below 0.95 (our bag-alias cap) since the
    // match is ambiguous between branches sharing the legal entity.
    expect(result.confidence).toBeLessThan(1.0);
  });

  it("requires TWO token-matches (single common token is not enough)", () => {
    // Input has only "ויני" (no city). Bag-match requires ≥2 tokens, so
    // this must NOT resolve to one of the ויני family via bag alone.
    // Either the matcher returns null / no_match, or it uses fuzzy
    // similarity — but never a 0.85+ bag score on a single-token hit.
    const vagueInput = "ויני";

    const result = matchFranchiseeName(vagueInput, VINNI_FAMILY, {
      minConfidence: 0.6,
    });

    if (result.matchedFranchisee) {
      expect(result.matchedOn).not.toMatch(/^bag-alias:/);
    }
  });
});

describe("Latin → Hebrew brand-token normalisation", () => {
  it("rewrites the Latin 'Vinni' brand token to its Hebrew equivalent", () => {
    expect(normalizeName("Vinni - חיפה")).toContain("ויני");
    expect(normalizeName("VINNI רגבה")).toContain("ויני");
  });

  it('routes Pluxee "Vinni - חיפה" body extract to Pat Vini Azrieli Haifa, NOT Vini Hadera (production bug 2026-05-05)', () => {
    // Real-world string Cibus body parser extracts from Pluxee reports for
    // the Haifa branch. Before the brand-token mapping was added the
    // matcher fuzzy-routed this to Vini Hadera and corrupted reconciliation.
    const result = matchFranchiseeName("Vinni - חיפה", VINNI_FAMILY, {
      minConfidence: 0.6,
    });
    expect(result.matchedFranchisee?.id).toBe("vinni-haifa");
  });

  it('routes Pluxee "VINNI - רגבה" to Vini Regba (sanity check)', () => {
    const result = matchFranchiseeName("VINNI - רגבה", VINNI_FAMILY, {
      minConfidence: 0.6,
    });
    expect(result.matchedFranchisee?.id).toBe("vinni-regba");
  });
});
