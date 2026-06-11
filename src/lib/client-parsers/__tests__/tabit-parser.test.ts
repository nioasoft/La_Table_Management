import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseTabitFile } from "../tabit-parser";

const XLSX_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

const fixture = (name: string): Buffer =>
  readFileSync(join(__dirname, "fixtures", name));

describe("parseTabitFile", () => {
  // Real production file: Reut's May 2026 VINNI export ("data (3).xlsx"),
  // grouped by period — "שנה וחודש" in col A, "סניף" in col B.
  it("Layout A (period column): extracts period and branch names from col B", async () => {
    const result = await parseTabitFile(
      fixture("tabit-vinni-with-period-col.xlsx"),
      XLSX_MIME,
    );

    expect(result.success).toBe(true);
    expect(result.data?.period).toEqual({ month: 5, year: 2026 });

    const names = result.data!.branches.map((b) => b.branchName);
    expect(names).toContain("VINNI עזריאלי חיפה");
    expect(names).toContain("VINNI רגבה");
    expect(names).not.toContain("Total");

    const azrieli = result.data!.branches.find(
      (b) => b.branchName === "VINNI עזריאלי חיפה",
    )!;
    expect(azrieli.amounts["Haat"]).toBe(4556);
    expect(azrieli.amounts["Wolt"]).toBe(101803);
  });

  // Real production file: Reut's May 2026 Mina Tomai export ("data (6).xlsx"),
  // exported WITHOUT period grouping — "סניף" is col A, payment methods start
  // at col B. Before the 2026-06-11 fix this parsed the GIFT CARD amounts
  // (118, 1065, 2076, 148) as "branch names" → "נוצרו 0 מסמכים".
  it("Layout B (no period column): locates the branch column by the סניף sub-header", async () => {
    const result = await parseTabitFile(
      fixture("tabit-mina-tomai-no-period-col.xlsx"),
      XLSX_MIME,
    );

    expect(result.success).toBe(true);
    // No period in the file — caller falls back to the user-selected period.
    expect(result.data?.period).toBeNull();

    const names = result.data!.branches.map((b) => b.branchName);
    expect(names).toEqual([
      "מינה טומיי יהוד",
      "מינה טומיי עין שמר",
      "מינה טומיי קסטרא חיפה",
      "מינה טומיי קריון",
      "מינה טומיי תל אביב",
    ]);

    // The amounts that were previously mis-read as branch names are the
    // GIFT CARD column — make sure they're back where they belong.
    const yahud = result.data!.branches.find(
      (b) => b.branchName === "מינה טומיי יהוד",
    )!;
    expect(yahud.amounts["GIFT CARD"]).toBe(118);
    expect(yahud.amounts["Wolt"]).toBe(319390);
    expect(yahud.total).toBe(464452.5);

    const castra = result.data!.branches.find(
      (b) => b.branchName === "מינה טומיי קסטרא חיפה",
    )!;
    expect(castra.amounts["GIFT CARD"]).toBe(2076);
    expect(castra.amounts["HAAT"]).toBe(29438);
    expect(castra.amounts["סיבוס"]).toBe(41944);
    expect(castra.amounts["סיבוס Online"]).toBe(87472);
  });
});
