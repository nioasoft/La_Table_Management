import { describe, it, expect, vi } from "vitest";

// The store module builds a pg Pool on import; no test here touches the DB.
vi.mock("@/db", () => ({ database: {} }));

import { EXPORTS } from "@/lib/hashavshevet/registry";
import { EXPORT_TYPES } from "@/lib/hashavshevet/types";
import {
  InvalidTransitionError,
  LockConflictError,
  isUniqueViolation,
} from "@/data-access/hashavshevet";

describe("EXPORTS registry", () => {
  it("has an entry for every export type, keyed by its own type", () => {
    for (const type of EXPORT_TYPES) expect(EXPORTS[type].type).toBe(type);
  });
  it("uses movein only for the journal-entry exports", () => {
    const movein = EXPORT_TYPES.filter((t) => EXPORTS[t].plugin === "movein");
    expect(movein.sort()).toEqual(["client_commission_invoices", "journal_entries"]);
  });
  it("has a Hebrew label and an unmigrated build", async () => {
    for (const type of EXPORT_TYPES) {
      expect(EXPORTS[type].labelHe).toMatch(/[֐-׿]/);
      await expect(EXPORTS[type].build({})).rejects.toThrow("not migrated");
    }
  });
});

describe("isUniqueViolation", () => {
  it("detects a bare pg error and a Drizzle-wrapped one", () => {
    expect(isUniqueViolation({ code: "23505" })).toBe(true);
    expect(isUniqueViolation({ cause: { code: "23505" } })).toBe(true);
  });
  it("ignores other errors", () => {
    expect(isUniqueViolation({ code: "23503" })).toBe(false);
    expect(isUniqueViolation(new Error("boom"))).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
  });
});

describe("typed store errors", () => {
  it("are identifiable with instanceof", () => {
    expect(new LockConflictError()).toBeInstanceOf(Error);
    const e = new InvalidTransitionError("approved", "unknown");
    expect(e).toBeInstanceOf(InvalidTransitionError);
    expect(e.currentStatus).toBe("unknown");
    expect(e.message).toContain("approved");
  });
});
