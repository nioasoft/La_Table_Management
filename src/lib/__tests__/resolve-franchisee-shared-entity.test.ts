/**
 * Shared-legal-entity guard regression tests (June 2026 incident).
 *
 * Pat Vini Azrieli Haifa + Natanzon Azrieli Haifa share one ח.פ and one
 * ezcount account. An EasyCount client_report carries NO customer number,
 * so any name/subject/filename match to either of them is a coin flip —
 * June 2026 proved it lands wrong (the invoice-number order flipped vs
 * May). The resolver must park such documents (ok:false with both
 * candidates) instead of auto-committing.
 *
 * The test drives resolveFranchisee end-to-end with a garbage buffer (the
 * parser fails → falls through to the subject strategy), which exercises
 * the guard on the real code path rather than a mock.
 */
import { describe, expect, it } from "vitest";
import { resolveFranchisee } from "../email/resolve-franchisee";
import type { Franchisee } from "@/db/schema";

// Real prod ids — the guard keys on CLIENT_CUSTOMER_NUMBER_MAP entries.
const VINI_ID = "0e2a027a-18bb-4274-af4e-be451799a29b";
const NATANZON_ID = "ab020323-fefe-4543-9a69-16d14dd54b99";

const VINI: Franchisee = {
  id: VINI_ID,
  name: "פט ויני עזריאלי חיפה",
  code: "PVAH",
  brandId: null,
  aliases: ['פט ויני עזריאלי בע"מ', "פאט ויני עזריאלי בעמ"],
  isActive: true,
} as unknown as Franchisee;

const NATANZON: Franchisee = {
  id: NATANZON_ID,
  name: "נתנזון עזריאלי חיפה",
  code: "NATANZON",
  brandId: null,
  aliases: ["נתנזון בורגר"],
  isActive: true,
} as unknown as Franchisee;

const REGBA: Franchisee = {
  id: "vinni-regba",
  name: 'ויני רגבה בע"מ',
  code: "REGBA",
  brandId: null,
  aliases: ["ויני רגבה"],
  isActive: true,
} as unknown as Franchisee;

const FRANCHISEES = [VINI, NATANZON, REGBA];
const GARBAGE = Buffer.from("not a real document");

describe("resolveFranchisee shared-entity guard (HAAT)", () => {
  it("parks a HAAT doc whose subject matches Vini Azrieli (no customer number)", async () => {
    const result = await resolveFranchisee(
      GARBAGE,
      "application/pdf",
      "HAAT",
      'חשבונית מס 10080 מאת פאט ויני עזריאלי בע"מ',
      FRANCHISEES,
    );
    expect(result.ok).toBe(false);
    if (result.ok || !("reason" in result)) throw new Error("expected failure with reason");
    expect(result.reason).toContain("shares a legal entity");
    expect(
      result.rejectedVerdict?.candidates.map((c) => c.id).sort(),
    ).toEqual([VINI_ID, NATANZON_ID].sort());
  });

  it("parks a HAAT doc whose subject matches Natanzon (no customer number)", async () => {
    const result = await resolveFranchisee(
      GARBAGE,
      "application/pdf",
      "HAAT",
      "דוח חודשי - נתנזון עזריאלי חיפה",
      FRANCHISEES,
    );
    expect(result.ok).toBe(false);
    if (result.ok || !("reason" in result)) throw new Error("expected failure with reason");
    expect(result.reason).toContain("shares a legal entity");
  });

  it("does NOT park a HAAT doc for a franchisee outside the shared entity", async () => {
    const result = await resolveFranchisee(
      GARBAGE,
      "application/pdf",
      "HAAT",
      'חשבונית מס 10060 מאת ויני רגבה בע"מ',
      FRANCHISEES,
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.franchiseeId).toBe("vinni-regba");
  });

  it("does NOT park shared-entity franchisees under other parsers (WOLT)", async () => {
    const result = await resolveFranchisee(
      GARBAGE,
      "application/pdf",
      "WOLT",
      "דוח חודשי - נתנזון עזריאלי חיפה",
      FRANCHISEES,
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.franchiseeId).toBe(NATANZON_ID);
  });
});
