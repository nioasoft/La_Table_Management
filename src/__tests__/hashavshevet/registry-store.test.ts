import { describe, it, expect, vi } from "vitest";

// No test here touches the DB. `database.select` is a real Drizzle builder over a mock driver;
// awaiting it records the generated SQL and resolves to no rows.
const captured = vi.hoisted(() => ({ sql: "", params: [] as unknown[], all: [] as string[] }));
vi.mock("@/db", async () => {
  const { drizzle } = await import("drizzle-orm/node-postgres");
  const schema = await import("@/db/schema");
  const real = drizzle.mock({ schema });
  const wrap = (builder: any): any =>
    new Proxy(builder, {
      get(target, prop) {
        if (prop === "then") {
          return (resolve: (v: unknown[]) => void) => {
            ({ sql: captured.sql, params: captured.params } = target.toSQL());
            captured.all.push(captured.sql);
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
  const db = {
    select: (...args: unknown[]) => wrap((real.select as any)(...args)),
    update: (...args: unknown[]) => wrap((real.update as any)(...args)),
  };
  return { database: { ...db, transaction: (fn: (tx: typeof db) => unknown) => fn(db) } };
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
  // Each builder task (8-13) adds its type here as it replaces the placeholder build.
  const MIGRATED: readonly string[] = [
    "client_commissions",
    "franchisee_client_invoices",
    "royalties",
    "supplier_commissions",
  ];
  it("has a Hebrew label, and an unmigrated build until its builder lands", async () => {
    for (const type of EXPORT_TYPES) {
      expect(EXPORTS[type].labelHe).toMatch(/[֐-׿]/);
      if (MIGRATED.includes(type)) continue;
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

describe("getActiveLocks sender name", () => {
  it("left-joins the user table so a deleted sender still yields the lock", async () => {
    await drizzleHashavshevetStore.getActiveLocks("royalties", ["k1"]);
    expect(captured.sql).toMatch(/left join "user" on "hashavshevet_send"\."sent_by" = "user"\."id"/i);
    expect(captured.sql).toContain('"user"."name"');
  });
});

describe("finishSend", () => {
  it("only finishes a pending send, and a late call releases nothing", async () => {
    captured.all = [];
    await drizzleHashavshevetStore.finishSend("s1", { status: "failed", failedRowKeys: ["k1"], requestId: "r1" });
    // The mock driver matches no rows, so this is a late/duplicate call: one guarded status update, no release.
    expect(captured.all).toHaveLength(1);
    expect(captured.sql).toMatch(/^update "hashavshevet_send" set .* where \("hashavshevet_send"\."id" = \$\d+ and "hashavshevet_send"\."status" = \$\d+\)/);
    expect(captured.params).toContain("pending");
  });
});

describe("resolveSend escape hatch for a send stuck in pending", () => {
  const STALE = /"hashavshevet_send"\."status" = \$\d+ and "hashavshevet_send"\."sent_at" < now\(\) - interval '15 minutes'/;

  it.each(["arrived", "rejected"] as const)("%s may also leave pending, only once the send is 15 minutes old", async (outcome) => {
    captured.all = [];
    // The mock driver matches nothing, so the transition is refused after the one atomic UPDATE.
    await expect(drizzleHashavshevetStore.resolveSend("s1", outcome, "לא הגיע", "u1")).rejects.toBeInstanceOf(InvalidTransitionError);
    const [update] = captured.all;
    expect(update).toMatch(/^update "hashavshevet_send" set .* returning/);
    expect(update).toMatch(STALE);
  });

  it("approved never leaves pending", async () => {
    captured.all = [];
    await expect(drizzleHashavshevetStore.resolveSend("s1", "approved", null, "u1")).rejects.toBeInstanceOf(InvalidTransitionError);
    expect(captured.all[0]).toMatch(/^update "hashavshevet_send"/);
    expect(captured.all[0]).not.toContain("interval");
  });
});

describe("admin store: companies", () => {
  it("listCompanies selects the display columns, ordered by Hashavshevet comp id", async () => {
    await drizzleHashavshevetStore.listCompanies();
    // Single-table selects come out unqualified (Drizzle drops the table prefix), except in ORDER BY.
    expect(captured.sql).toMatch(/^select .*"comp_id".*"live_from".*"requires_approval".* from "hashavshevet_company"/);
    expect(captured.sql).toMatch(/order by "hashavshevet_company"\."comp_id"/i);
  });

  it("updateCompany stamps updated_at and updated_by, scopes by id and is null when nothing matched", async () => {
    const result = await drizzleHashavshevetStore.updateCompany("c1", { liveFrom: null, requiresApproval: false }, "u1");
    expect(result).toBeNull();
    expect(captured.sql).toMatch(/^update "hashavshevet_company" set .*"live_from" = \$\d+.*"updated_at" = \$\d+.*"updated_by" = \$\d+ where "hashavshevet_company"\."id" = \$\d+ returning/);
    expect(captured.params).toEqual(expect.arrayContaining([null, false, "u1", "c1"]));
  });

  it("updateCompany leaves untouched fields out of the SET", async () => {
    await drizzleHashavshevetStore.updateCompany("c1", { requiresApproval: true }, "u1");
    expect(captured.sql).not.toContain('"live_from" =');
  });
});

describe("admin store: mappings", () => {
  it("listMappings returns real brands only, and active franchisees joined to their brand code", async () => {
    captured.all = [];
    await drizzleHashavshevetStore.listMappings();
    const [brands, franchisees] = captured.all;
    expect(brands).toMatch(/^select "id", "code", "name_he", "hashavshevet_company_id" from "brand"/);
    expect(brands).toContain('"brand"."is_system_brand" = $');
    expect(franchisees).toMatch(/inner join "brand" on "franchisee"\."brand_id" = "brand"\."id"/i);
    expect(franchisees).toContain('"franchisee"."status" = $');
    expect(franchisees).toContain('"brand"."code"');
  });

  it("setMapping is false for an unknown company without touching the mapped row", async () => {
    captured.all = [];
    await expect(drizzleHashavshevetStore.setMapping("brand", "b1", "missing")).resolves.toBe(false);
    expect(captured.all).toHaveLength(1);
    expect(captured.all[0]).toMatch(/^select .* from "hashavshevet_company" where "hashavshevet_company"\."id" = \$\d+/);
  });

  it.each([
    ["brand", "brand"],
    ["franchisee", "franchisee"],
  ] as const)("setMapping(%s, null) clears the company, scoped to that row, and is false when no row matched", async (kind, table) => {
    captured.all = [];
    await expect(drizzleHashavshevetStore.setMapping(kind, "x1", null)).resolves.toBe(false);
    expect(captured.all).toHaveLength(1);
    expect(captured.sql).toMatch(new RegExp(`^update "${table}" set .*"hashavshevet_company_id" = \\$\\d+.* where "${table}"\\."id" = \\$\\d+ returning`));
    expect(captured.params).toEqual(expect.arrayContaining([null, "x1"]));
  });
});
