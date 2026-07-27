import { describe, it, expect } from "vitest";
import { matchBkmvSuppliers, matchSupplierName } from "@/lib/supplier-matcher";
import type { Supplier } from "@/db/schema";

/**
 * Regression: deactivating a supplier used to unlink its rows from every
 * franchisee's BKMV data on the next מבנה אחיד upload — including months that
 * were already reconciled and approved. גרינטי (deactivated 2026-05-14) and
 * היכל היין (2026-07-22) dropped to ₪0 across the Q1 2026 sessions.
 */
const makeSupplier = (over: Partial<Supplier>): Supplier =>
  ({
    id: "sup-green",
    code: "GREEN_TEA",
    name: "גרינטי",
    bkmvAliases: ['גרינטי אוירי די בע"מ'],
    isActive: true,
    isHidden: false,
  }) as Supplier;

const summary = (name: string) =>
  new Map([[name, { totalAmount: 5675, transactionCount: 3 }]]);

describe("BKMV matching vs supplier lifecycle flags", () => {
  it("still matches an inactive supplier by its BKMV alias", () => {
    const inactive = makeSupplier({ isActive: false });
    const [result] = matchBkmvSuppliers(
      summary('גרינטי אוירי די בע"מ'),
      [{ ...inactive, isActive: false }],
      { minConfidence: 0.6, reviewThreshold: 1.0 }
    );

    expect(result.matchResult.matchedSupplier?.id).toBe("sup-green");
    // Only confidence === 1 is written into the monthly breakdown.
    expect(result.matchResult.confidence).toBe(1);
    expect(result.matchResult.matchType).toBe("exact_alias");
  });

  it("keeps hidden suppliers out — הסתר מדוחות עמלות is deliberate", () => {
    const hidden = { ...makeSupplier({}), isHidden: true } as Supplier;
    const [result] = matchBkmvSuppliers(
      summary('גרינטי אוירי די בע"מ'),
      [hidden],
      { minConfidence: 0.6, reviewThreshold: 1.0 }
    );

    expect(result.matchResult.matchedSupplier).toBeNull();
  });

  it("leaves the general matcher's active-only default alone", () => {
    const inactive = { ...makeSupplier({}), isActive: false } as Supplier;
    const result = matchSupplierName('גרינטי אוירי די בע"מ', [inactive]);
    expect(result.matchedSupplier).toBeNull();
  });
});
