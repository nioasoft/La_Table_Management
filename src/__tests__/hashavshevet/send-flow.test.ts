import { describe, expect, it } from "vitest";
import { sentApiRow } from "@/lib/hashavshevet/send-flow";
import type { BuiltRow } from "@/lib/hashavshevet/types";

const row = (over: Partial<BuiltRow>): BuiltRow =>
  ({ rowKey: "k", companyId: "c", amount: 1, display: {}, apiRow: { Reference: "1" }, periodEnd: "2026-09-30", ...over }) as BuiltRow;

describe("sentApiRow", () => {
  it("dates every invoice (imovein) the last day of its period (Reut, 01/11/2026)", () => {
    expect(sentApiRow("imovein", row({}))).toEqual({ valueDate: "30/09/2026", Reference: "1" });
  });

  it("keeps a builder's own date, and never touches journal entries (movein)", () => {
    expect(sentApiRow("imovein", row({ apiRow: { valueDate: "01/09/2026" } }))).toEqual({ valueDate: "01/09/2026" });
    expect(sentApiRow("movein", row({}))).toEqual({ Reference: "1" });
  });

  it("sends no date when the row has no period end (Hashavshevet then uses today)", () => {
    expect(sentApiRow("imovein", row({ periodEnd: "" }))).toEqual({ Reference: "1" });
  });
});
