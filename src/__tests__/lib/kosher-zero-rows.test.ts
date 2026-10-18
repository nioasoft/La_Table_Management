import { describe, it, expect } from "vitest";
import { zeroRowCandidates } from "@/data-access/reconciliation-v2";

// Brand-compatible branches of יבולי גורמה (ויני + קינג קונג), as on prod.
const branches = [
  { id: "kk-afula", isKosher: true },
  { id: "vini-hadera", isKosher: true },
  { id: "kk-horev", isKosher: false },
  { id: "vini-regba", isKosher: false },
];

describe("zeroRowCandidates", () => {
  it("a kosher supplier gets 0/0 rows only for kosher branches", () => {
    expect(zeroRowCandidates(branches, true).map((f) => f.id)).toEqual([
      "kk-afula",
      "vini-hadera",
    ]);
  });

  it("a non-kosher supplier gets 0/0 rows for every brand branch", () => {
    expect(zeroRowCandidates(branches, false)).toEqual(branches);
  });
});
