import { describe, it, expect } from "vitest";
import { tenbisUsesJournalEntries } from "../client-reconciliation-approval";

describe("tenbisUsesJournalEntries", () => {
  it("keeps pre-July-2026 periods on client invoices", () => {
    expect(tenbisUsesJournalEntries(6, 2026)).toBe(false);
    expect(tenbisUsesJournalEntries(12, 2025)).toBe(false);
  });

  it("uses journal entries from the July-2026 period onward", () => {
    expect(tenbisUsesJournalEntries(7, 2026)).toBe(true);
    expect(tenbisUsesJournalEntries(8, 2026)).toBe(true);
    expect(tenbisUsesJournalEntries(1, 2027)).toBe(true);
  });
});
