import { describe, it, expect } from "vitest";
import { groupFilesIntoPeriods } from "@/data-access/reconciliation-v2";

// Input must arrive ordered createdAt DESC — that's what "latest per period" rides on.
const file = (
  id: string,
  createdAt: string,
  periodStartDate: string | null,
  periodEndDate: string | null = periodStartDate ? "2026-03-31" : null
) => ({
  id,
  periodStartDate,
  periodEndDate,
  originalFileName: `${id}.xlsx`,
  createdAt: new Date(createdAt),
});

describe("groupFilesIntoPeriods", () => {
  it("keeps only the latest file per period for single-file suppliers", () => {
    const result = groupFilesIntoPeriods(
      [file("newer", "2026-04-10", "2026-01-01"), file("older", "2026-04-01", "2026-01-01")],
      false
    );

    expect(result).toHaveLength(1);
    expect(result[0].supplierFileIds).toEqual(["newer"]);
    expect(result[0].supplierFileId).toBe("newer");
    expect(result[0].supplierFileName).toBe("newer.xlsx");
  });

  it("keeps every file of a period for multi-file suppliers", () => {
    const result = groupFilesIntoPeriods(
      [file("newer", "2026-04-10", "2026-01-01"), file("older", "2026-04-01", "2026-01-01")],
      true
    );

    expect(result).toHaveLength(1);
    expect(result[0].supplierFileIds).toEqual(["newer", "older"]);
    expect(result[0].supplierFileId).toBe("newer");
    // The extra-file marker is what tells the UI a merge is coming
    expect(result[0].supplierFileName).toBe("newer.xlsx (+1)");
  });

  it("drops files whose period dates were never parsed", () => {
    const result = groupFilesIntoPeriods(
      [file("undated", "2026-04-10", null), file("dated", "2026-04-01", "2026-01-01")],
      false
    );

    expect(result.map((p) => p.supplierFileId)).toEqual(["dated"]);
  });

  it("returns periods newest first", () => {
    const result = groupFilesIntoPeriods(
      [
        file("q1", "2026-04-10", "2026-01-01"),
        file("q4", "2026-04-09", "2025-10-01"),
        file("q2", "2026-04-08", "2026-04-01"),
      ],
      false
    );

    expect(result.map((p) => p.periodStartDate)).toEqual([
      "2026-04-01",
      "2026-01-01",
      "2025-10-01",
    ]);
  });

  it("returns nothing for no files", () => {
    expect(groupFilesIntoPeriods([], false)).toEqual([]);
  });
});
