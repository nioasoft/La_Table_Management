import { describe, it, expect } from "vitest";
import {
  apiMoney,
  apiQuantity,
  apiDate,
  apiDocumentId,
  internalReference,
  JOURNAL_TRANS_TYPE,
} from "@/lib/hashavshevet/format";

describe("hashavshevet format", () => {
  it("formats api values", () => {
    expect(apiMoney(5000)).toBe("5000.00");
    expect(apiMoney(0.1 + 0.2)).toBe("0.30");
    expect(apiQuantity(1)).toBe("1.000");
    expect(apiDate("2026-10-31")).toBe("31/10/2026");
    expect(apiDocumentId(11)).toBe("1");
    expect(apiDocumentId(1)).toBeNull();
    expect(internalReference("H", "a|b")).toBe(internalReference("H", "a|b"));
    expect(internalReference("H", "a|b")).toMatch(/^\d{1,9}$/);
  });

  it("apiMoney rounds to cents and allows negatives", () => {
    expect(apiMoney(-12.345)).toBe("-12.35");
    expect(apiMoney(12.345)).toBe("12.35");
    expect(apiMoney(-0.1 - 0.2)).toBe("-0.30");
    expect(apiMoney(0)).toBe("0.00");
    expect(apiMoney(-0.001)).toBe("0.00");
  });

  it("apiDate accepts only YYYY-MM-DD", () => {
    expect(() => apiDate("31/10/2026")).toThrow();
    expect(() => apiDate("2026-10-31T00:00:00.000Z")).toThrow();
    expect(() => apiDate("2026-1-3")).toThrow();
    expect(() => apiDate("")).toThrow();
  });

  it("internalReference differs per rowKey and per prefix, and stays <= 9 digits", () => {
    expect(internalReference("H", "a|b")).not.toBe(internalReference("H", "a|c"));
    expect(internalReference("H", "a|b")).not.toBe(internalReference("G", "a|b"));
    for (const key of ["", "x", 'מע"מ|ויני ע|012345678', "a".repeat(500)]) {
      expect(internalReference("HS-", key)).toMatch(/^\d{1,9}$/);
    }
  });

  it("exposes the placeholder journal trans type", () => {
    expect(JOURNAL_TRANS_TYPE).toBe("00");
  });
});
