import { describe, it, expect } from "vitest";
import {
  selectCommissionCleanupIds,
  buildDuplicateBlockMap,
} from "../commissions";

describe("selectCommissionCleanupIds — לא מחיקות", () => {
  const rows = [
    { id: "own", sourceFileId: "file-A" },
    { id: "legacy", sourceFileId: null },
    { id: "sibling-live", sourceFileId: "file-B" },
    { id: "sibling-rejected", sourceFileId: "file-C" },
  ];

  it("spares rows of other files that are still approved", () => {
    // file-B is approved; file-A is the syncing file (not in the live set),
    // file-C was rejected
    const deleteIds = selectCommissionCleanupIds(rows, new Set(["file-B"]));
    expect(deleteIds).toEqual(["own", "legacy", "sibling-rejected"]);
  });

  it("deletes everything when no sibling is live (single-file supplier re-sync)", () => {
    const deleteIds = selectCommissionCleanupIds(rows, new Set());
    expect(deleteIds).toEqual(["own", "legacy", "sibling-live", "sibling-rejected"]);
  });

  it("real incident shape: 19 sibling files spared, only own row deleted", () => {
    const dagei = [
      { id: "own-row", sourceFileId: "doc-20" },
      ...Array.from({ length: 19 }, (_, i) => ({
        id: `sib-${i}`,
        sourceFileId: `doc-${i}`,
      })),
    ];
    const live = new Set(Array.from({ length: 19 }, (_, i) => `doc-${i}`));
    expect(selectCommissionCleanupIds(dagei, live)).toEqual(["own-row"]);
  });
});

describe("buildDuplicateBlockMap — לא כפילויות", () => {
  const Q2 = { start: "2026-04-01", end: "2026-06-30" };

  it("blocks a franchisee whose same-period row survived from another approved file", () => {
    const blocked = buildDuplicateBlockMap(
      [
        {
          franchiseeId: "fr-1",
          periodStartDate: Q2.start,
          periodEndDate: Q2.end,
          status: "calculated",
        },
      ],
      Q2.start,
      Q2.end
    );
    expect(blocked.get("fr-1")).toContain("another approved file");
  });

  it("blocks on overlapping-but-different period (שרי שוקו: Q1 file tagged as April)", () => {
    const blocked = buildDuplicateBlockMap(
      [
        {
          franchiseeId: "fr-1",
          periodStartDate: "2026-01-01",
          periodEndDate: "2026-03-31",
          status: "calculated",
        },
      ],
      "2026-04-01",
      "2026-04-30"
    );
    // Q1 row does NOT overlap April — the caller's query only returns
    // overlapping rows; here we simulate a cumulative H1 report instead:
    const h1Blocked = buildDuplicateBlockMap(
      [
        {
          franchiseeId: "fr-2",
          periodStartDate: "2026-01-01",
          periodEndDate: "2026-03-31",
          status: "approved",
        },
      ],
      "2026-01-01",
      "2026-06-30"
    );
    expect(h1Blocked.get("fr-2")).toContain("overlaps");
    expect(h1Blocked.get("fr-2")).toContain("approved");
    expect(blocked.has("fr-1")).toBe(true); // any row passed in is blocked
  });

  it("does not block franchisees with no overlapping rows", () => {
    const blocked = buildDuplicateBlockMap([], Q2.start, Q2.end);
    expect(blocked.size).toBe(0);
  });
});
