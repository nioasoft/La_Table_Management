import { describe, expect, it } from "vitest";
import { filesInOpenPeriods } from "../vat-reprocess-targets";

const Q2 = { periodStartDate: "2026-04-01", periodEndDate: "2026-06-30" };
const Q3 = { periodStartDate: "2026-07-01", periodEndDate: "2026-09-30" };

describe("filesInOpenPeriods", () => {
  it("keeps a file whose period's session is still in progress (Vini Azrieli Q3-2026)", () => {
    const files = [{ id: "q3", ...Q3 }];
    expect(filesInOpenPeriods(files, [{ ...Q3, status: "in_progress" }])).toEqual(files);
  });

  it("leaves a closed period alone — completed or file approved", () => {
    const files = [{ id: "q2", ...Q2 }, { id: "q3", ...Q3 }];
    const sessions = [
      { ...Q2, status: "file_approved" },
      { ...Q3, status: "completed" },
    ];
    expect(filesInOpenPeriods(files, sessions)).toEqual([]);
  });

  it("keeps a file that has no session yet — the session will be built from it", () => {
    const files = [{ id: "q3", ...Q3 }];
    expect(filesInOpenPeriods(files, [])).toEqual(files);
  });

  it("keeps a period whose file was rejected — it still waits for a file", () => {
    const files = [{ id: "q3", ...Q3 }];
    expect(filesInOpenPeriods(files, [{ ...Q3, status: "file_rejected" }])).toEqual(files);
  });

  it("matches the period exactly, not by overlap", () => {
    const july = { id: "jul", periodStartDate: "2026-07-01", periodEndDate: "2026-07-31" };
    expect(filesInOpenPeriods([july], [{ ...Q3, status: "completed" }])).toEqual([july]);
  });
});
