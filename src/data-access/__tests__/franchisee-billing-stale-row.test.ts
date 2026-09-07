import { describe, expect, it } from "vitest";

import {
  resolveStaleBillingRow,
  type BillingScreenOperations,
  type StaleRowContext,
} from "@/data-access/franchisee-billing-screen";

function context(overrides: Partial<StaleRowContext> = {}): StaleRowContext {
  return {
    id: "billing-1",
    isStaleSource: true,
    isExported: false,
    ...overrides,
  };
}

function operations(
  stale: StaleRowContext | null,
  recorded: string[],
): BillingScreenOperations {
  return {
    readStaleRowContext: async () => stale,
    acknowledgeStaleRow: async (billingId: string) => {
      recorded.push(`keep:${billingId}`);
      return true;
    },
    deleteStaleRow: async (billingId: string) => {
      recorded.push(`delete:${billingId}`);
      return true;
    },
  } as unknown as BillingScreenOperations;
}

describe("resolveStaleBillingRow", () => {
  it("keeps a row by acknowledging the file it came from", async () => {
    const recorded: string[] = [];
    const result = await resolveStaleBillingRow(
      { billingId: "billing-1", resolution: "keep" },
      operations(context(), recorded),
    );

    expect(result).toMatchObject({ success: true });
    expect(recorded).toEqual(["keep:billing-1"]);
  });

  it("deletes a row the newer file is not meant to carry", async () => {
    const recorded: string[] = [];
    const result = await resolveStaleBillingRow(
      { billingId: "billing-1", resolution: "delete" },
      operations(context(), recorded),
    );

    expect(result).toMatchObject({ success: true });
    expect(recorded).toEqual(["delete:billing-1"]);
  });

  it("refuses to delete a row already exported to Hashavshevet", async () => {
    const recorded: string[] = [];
    const result = await resolveStaleBillingRow(
      { billingId: "billing-1", resolution: "delete" },
      operations(context({ isExported: true }), recorded),
    );

    expect(result).toMatchObject({ success: false, code: "exported" });
    expect(recorded).toEqual([]);
  });

  it("reports a row that is no longer stale instead of touching it", async () => {
    const recorded: string[] = [];
    const result = await resolveStaleBillingRow(
      { billingId: "billing-1", resolution: "keep" },
      operations(context({ isStaleSource: false }), recorded),
    );

    expect(result).toMatchObject({ success: false, code: "not_found" });
    expect(recorded).toEqual([]);
  });

  it("reports a missing row", async () => {
    const recorded: string[] = [];
    const result = await resolveStaleBillingRow(
      { billingId: "billing-1", resolution: "keep" },
      operations(null, recorded),
    );

    expect(result).toMatchObject({ success: false, code: "not_found" });
  });
});
