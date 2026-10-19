import { describe, it, expect } from "vitest";
import type { Franchisee } from "@/db/schema";
import type { FranchiseeMatchResult } from "@/lib/franchisee-matcher";
import { computeMatchAnomalies } from "../franchisees";

// Incident shape (2026-10-19): a parser passed supplier customer code 629 as
// franchiseeId, and the modal offered to overwrite קסטרא's real ח.פ with it.
const KASTRA = {
  id: "kastra",
  name: "קסטרא טומאיי בע\"מ",
  companyId: "514177112",
  aliases: [],
  isActive: true,
  status: "active",
} as unknown as Franchisee;

function row(franchiseeId: string, matched: Franchisee | null) {
  const matchResult: FranchiseeMatchResult = {
    originalName: KASTRA.name,
    matchedFranchisee: matched,
    confidence: matched ? 0.97 : 0,
    matchType: matched ? "exact_alias" : "no_match",
    matchedOn: matched ? "alias" : "",
    requiresReview: !matched,
    alternatives: [],
  };
  return { franchisee: KASTRA.name, franchiseeId, rowNumber: 2, netAmount: 100, matchResult };
}

const overwriteActions = (rows: ReturnType<typeof row>[]) =>
  computeMatchAnomalies(rows, [KASTRA])
    .flatMap((a) => a.suggestedActions ?? [])
    .filter((a) => a.type === "update_franchisee_company_id");

describe("computeMatchAnomalies — business-ID guard", () => {
  it("never offers a ח.פ overwrite for a name-matched row carrying a customer code", () => {
    expect(overwriteActions([row("629", KASTRA)])).toEqual([]);
  });

  it("never offers a ח.פ overwrite for an unmatched row carrying a customer code", () => {
    expect(overwriteActions([row("00629", null)])).toEqual([]);
  });

  it("skips a 9-digit ID with a bad check digit", () => {
    expect(overwriteActions([row("515289702", KASTRA)])).toEqual([]);
  });

  it("still flags a valid ח.פ that differs from the stored one", () => {
    const actions = overwriteActions([row("516148947", KASTRA)]);
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({ newCompanyId: "516148947" });
  });
});
