import { describe, expect, it } from "vitest";

import { supplierFileUploadsQuerySchema } from "../supplier-file-uploads";

const parse = (params: Record<string, string>) =>
  supplierFileUploadsQuerySchema.safeParse(params);

describe("supplierFileUploadsQuerySchema", () => {
  it("accepts a quarter and coerces limit", () => {
    const result = parse({
      supplierId: "sup-1",
      limit: "200",
      periodStart: "2026-07-01",
      periodEnd: "2026-09-30",
    });
    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({ limit: 200, periodStart: "2026-07-01" });
  });

  it("splits a comma status list", () => {
    expect(parse({ status: "approved,rejected" }).data?.status).toEqual([
      "approved",
      "rejected",
    ]);
  });

  it("needs both period ends or neither", () => {
    expect(parse({}).success).toBe(true);
    expect(parse({ periodStart: "2026-07-01" }).success).toBe(false);
    expect(parse({ periodEnd: "2026-09-30" }).success).toBe(false);
  });

  it("rejects a malformed or inverted period", () => {
    expect(parse({ periodStart: "2026-7-1", periodEnd: "2026-09-30" }).success).toBe(false);
    expect(parse({ periodStart: "2026-10-01", periodEnd: "2026-09-30" }).success).toBe(false);
  });

  it("caps limit", () => {
    expect(parse({ limit: "5000" }).success).toBe(false);
    expect(parse({ limit: "0" }).success).toBe(false);
  });
});
