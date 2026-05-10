import { describe, expect, it } from "vitest";
import type { Franchisee } from "@/db/schema";
import type { FranchiseeMatchResult } from "../franchisee-matcher";
import {
  decideFranchiseeAcceptance,
  formatVerdictForLog,
} from "../franchisee-match-acceptance";

const F1: Franchisee = {
  id: "f1",
  name: "פט ויני עזריאלי חיפה",
  code: "PVAH",
  brandId: null,
  aliases: [],
  isActive: true,
} as unknown as Franchisee;

const F2: Franchisee = {
  id: "f2",
  name: "ויני חדרה",
  code: "VH",
  brandId: null,
  aliases: [],
  isActive: true,
} as unknown as Franchisee;

const F3: Franchisee = {
  id: "f3",
  name: "ויני רגבה",
  code: "VR",
  brandId: null,
  aliases: [],
  isActive: true,
} as unknown as Franchisee;

function buildResult(overrides: Partial<FranchiseeMatchResult> = {}): FranchiseeMatchResult {
  return {
    originalName: "test",
    matchedFranchisee: F1,
    confidence: 0.97,
    matchType: "exact_alias",
    matchedOn: "alias:foo",
    requiresReview: false,
    alternatives: [],
    ...overrides,
  };
}

describe("decideFranchiseeAcceptance", () => {
  describe("no_match", () => {
    it("rejects when no franchisee matched at all", () => {
      const result = buildResult({
        matchedFranchisee: null,
        confidence: 0,
        matchType: "no_match",
        matchedOn: null,
        requiresReview: true,
      });
      const verdict = decideFranchiseeAcceptance(result);
      expect(verdict.accept).toBe(false);
      if (!verdict.accept) {
        expect(verdict.reason).toBe("no_match");
        expect(verdict.candidates).toEqual([]);
      }
    });
  });

  describe("low_confidence", () => {
    it("rejects matches below the min confidence floor (default 0.85)", () => {
      const result = buildResult({ confidence: 0.84 });
      const verdict = decideFranchiseeAcceptance(result);
      expect(verdict.accept).toBe(false);
      if (!verdict.accept) {
        expect(verdict.reason).toBe("low_confidence");
        expect(verdict.bestConfidence).toBe(0.84);
        expect(verdict.candidates[0]).toEqual({
          id: "f1",
          name: "פט ויני עזריאלי חיפה",
          confidence: 0.84,
        });
      }
    });

    it("rejects 0.6 matches (regression: this is the old default that caused 2026-05-10 incident)", () => {
      const result = buildResult({ confidence: 0.6 });
      const verdict = decideFranchiseeAcceptance(result);
      expect(verdict.accept).toBe(false);
      if (!verdict.accept) {
        expect(verdict.reason).toBe("low_confidence");
      }
    });

    it("respects a custom minAcceptableConfidence", () => {
      const result = buildResult({ confidence: 0.78 });
      // With a relaxed floor of 0.7, this should accept.
      expect(
        decideFranchiseeAcceptance(result, { minAcceptableConfidence: 0.7 })
          .accept,
      ).toBe(true);
      // With the strict default 0.85, it should reject.
      expect(decideFranchiseeAcceptance(result).accept).toBe(false);
    });
  });

  describe("ambiguous", () => {
    it("rejects when the runner-up is within ambiguityGap of the best match", () => {
      const result = buildResult({
        confidence: 0.92,
        alternatives: [
          { franchisee: F2, confidence: 0.9, matchedOn: "fuzzy" },
          { franchisee: F3, confidence: 0.7, matchedOn: "fuzzy" },
        ],
      });
      const verdict = decideFranchiseeAcceptance(result);
      expect(verdict.accept).toBe(false);
      if (!verdict.accept) {
        expect(verdict.reason).toBe("ambiguous");
        // All three candidates surface for reviewer context:
        expect(verdict.candidates.map((c) => c.id)).toEqual(["f1", "f2", "f3"]);
      }
    });

    it("accepts when the runner-up is comfortably below the best match", () => {
      const result = buildResult({
        confidence: 0.95,
        alternatives: [
          { franchisee: F2, confidence: 0.6, matchedOn: "fuzzy" },
        ],
      });
      const verdict = decideFranchiseeAcceptance(result);
      expect(verdict.accept).toBe(true);
    });
  });

  describe("accept", () => {
    it("accepts a clean high-confidence match with no close alternatives", () => {
      const result = buildResult({ confidence: 0.99 });
      const verdict = decideFranchiseeAcceptance(result);
      expect(verdict.accept).toBe(true);
      if (verdict.accept) {
        expect(verdict.franchiseeId).toBe("f1");
        expect(verdict.franchiseeName).toBe("פט ויני עזריאלי חיפה");
        expect(verdict.confidence).toBe(0.99);
      }
    });

    it("accepts at exactly the min confidence floor", () => {
      const result = buildResult({ confidence: 0.85 });
      expect(decideFranchiseeAcceptance(result).accept).toBe(true);
    });
  });

  describe("formatVerdictForLog", () => {
    it("formats accepted verdicts concisely", () => {
      const result = buildResult({ confidence: 0.93 });
      const verdict = decideFranchiseeAcceptance(result);
      expect(formatVerdictForLog(verdict)).toBe(
        "accepted פט ויני עזריאלי חיפה @0.93",
      );
    });

    it("formats rejected verdicts with Hebrew reason and candidates", () => {
      const result = buildResult({
        confidence: 0.7,
        alternatives: [
          { franchisee: F2, confidence: 0.65, matchedOn: "fuzzy" },
        ],
      });
      const verdict = decideFranchiseeAcceptance(result);
      const log = formatVerdictForLog(verdict);
      expect(log).toContain("ביטחון נמוך מדי");
      expect(log).toContain("פט ויני עזריאלי חיפה@0.70");
      expect(log).toContain("ויני חדרה@0.65");
    });
  });
});
