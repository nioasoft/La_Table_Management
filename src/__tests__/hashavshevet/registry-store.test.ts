import { describe, it, expect, vi } from "vitest";

// No test here touches the DB. `database.select` is a real Drizzle builder over a mock driver;
// awaiting it records the generated SQL and resolves to no rows.
const captured = vi.hoisted(() => ({ sql: "" }));
vi.mock("@/db", async () => {
  const { drizzle } = await import("drizzle-orm/node-postgres");
  const schema = await import("@/db/schema");
  const real = drizzle.mock({ schema });
  const wrap = (builder: any): any =>
    new Proxy(builder, {
      get(target, prop) {
        if (prop === "then") {
          return (resolve: (v: unknown[]) => void) => {
            captured.sql = target.toSQL().sql;
            resolve([]);
          };
        }
        const value = target[prop];
        if (typeof value !== "function") return value;
        return (...args: unknown[]) => {
          const out = value.apply(target, args);
          return out && typeof out.toSQL === "function" ? wrap(out) : out;
        };
      },
    });
  return { database: { select: (...args: unknown[]) => wrap((real.select as any)(...args)) } };
});

import { EXPORTS } from "@/lib/hashavshevet/registry";
import { EXPORT_TYPES } from "@/lib/hashavshevet/types";
import {
  InvalidTransitionError,
  LockConflictError,
  drizzleHashavshevetStore,
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

describe("listSends summary", () => {
  it("counts and sums only rows that were not released as send_failed", async () => {
    await drizzleHashavshevetStore.listSends({});
    const filter = `FILTER (WHERE "hashavshevet_sent_row"."unlock_reason" IS DISTINCT FROM 'send_failed')`;
    expect(captured.sql).toContain(`count("hashavshevet_sent_row"."id") ${filter}`);
    expect(captured.sql).toContain(`sum("hashavshevet_sent_row"."amount") ${filter}`);
    expect(captured.sql).not.toContain('"hashavshevet_send"."row_count"');
  });
});
