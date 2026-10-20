import { describe, expect, it } from "vitest";
import { findIdenticalEarlierFile, type EarlierFile } from "../stale-file-guard";

// רסטרטו Q2-2026 as stored: the "Totals" row was blacklisted, eight branches matched.
const q2: EarlierFile = {
  fileName: "חישוב פט ויני Q2 2026.xlsx",
  periodStart: "2026-04-01",
  periodEnd: "2026-06-30",
  matches: [
    { originalName: "Totals", netAmount: 424817, matchType: "blacklisted" },
    { originalName: "מיאמוטו", netAmount: 78704, matchType: "exact" },
    { originalName: "ויני רגבה", netAmount: 70289, matchType: "exact" },
    { originalName: "סידיוס", netAmount: 60087, matchType: "exact" },
  ],
};

const row = (franchisee: string, netAmount: number) => ({ franchisee, netAmount });

describe("findIdenticalEarlierFile", () => {
  it("flags a file whose amounts equal an earlier period's, ignoring row order and agorot", () => {
    const rows = [row("Totals", 424817.19), row("סידיוס", 60086.92), row("מיאמוטו", 78704.17), row("ויני רגבה", 70288.72)];
    expect(findIdenticalEarlierFile(rows, [q2])).toBe(q2);
  });

  it("passes a file with real new amounts", () => {
    const rows = [row("מיאמוטו", 99964), row("ויני רגבה", 104341), row("סידיוס", 85694)];
    expect(findIdenticalEarlierFile(rows, [q2])).toBeNull();
  });

  it("passes when a single amount differs", () => {
    const rows = [row("מיאמוטו", 78704), row("ויני רגבה", 70289), row("סידיוס", 60088)];
    expect(findIdenticalEarlierFile(rows, [q2])).toBeNull();
  });

  it("ignores one-row files — a fixed amount can legitimately repeat", () => {
    const one: EarlierFile = { ...q2, matches: [{ originalName: "א", netAmount: 500, matchType: "exact" }] };
    expect(findIdenticalEarlierFile([row("א", 500)], [one])).toBeNull();
  });
});
