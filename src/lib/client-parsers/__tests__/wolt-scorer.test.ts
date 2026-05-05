import { describe, expect, it } from "vitest";
import { scoreWoltEzcountAttachment } from "../wolt-parser";

/**
 * Minimal text fixtures simulating the relevant Hebrew/English regions of
 * pdf-parse output. The full PDFs live under fixtures/wolt-*.pdf and are
 * exercised by the E2E parser tests; here we only care about the File A
 * vs File B classification heuristic.
 */
const FILE_B_TEXT = `
חשבונית מס מקור 4946028
לכבוד
Wolt Enterprises Israel Ltd
רח' המנופים 1, הרצליה
ע.מ 514568123
פירוט עסקאות
06/04 ...
`;

const FILE_A_TEXT = `
Wolt Enterprises Israel Ltd
ע.מ 514568123
חשבונית עמלה
לכבוד
פט ויני עזריאלי בע"מ
ע.מ 516161361
תאריך 30/04/2026
`;

const AMBIGUOUS_TEXT = `
חשבונית מס 12345
לקוח: מסעדה כלשהי
תאריך: 30/04/2026
`;

describe("scoreWoltEzcountAttachment", () => {
  it("returns verdict=fileB for a clean File B (Wolt is the recipient)", () => {
    const r = scoreWoltEzcountAttachment(FILE_B_TEXT, "פט ויני עזריאלי_2026-04.pdf");
    expect(r.verdict).toBe("fileB");
    expect(r.fileBScore).toBeGreaterThanOrEqual(3);
    expect(r.signals.some((s) => s.startsWith("recipient:"))).toBe(true);
  });

  it("returns verdict=fileA when Wolt is the issuer (header block, no לכבוד-Wolt proximity)", () => {
    const r = scoreWoltEzcountAttachment(FILE_A_TEXT, "פט ויני עזריאלי_2026-04.pdf");
    expect(r.verdict).toBe("fileA");
    expect(r.fileBScore).toBeLessThan(3);
    expect(r.fileAScore).toBeGreaterThan(0);
  });

  it("returns verdict=unknown for content with no Wolt markers", () => {
    const r = scoreWoltEzcountAttachment(AMBIGUOUS_TEXT, "x.pdf");
    expect(r.verdict).toBe("unknown");
  });

  it("recognises Hebrew recipient variant 'וולט אנטרפרייזס' near 'לכבוד'", () => {
    const text = `שלום,\nלכבוד\nוולט אנטרפרייזס בע"מ\nחשבונית מס 9999`;
    const r = scoreWoltEzcountAttachment(text, undefined);
    expect(r.verdict).toBe("fileB");
  });

  it("filename hints add weight without overriding content score", () => {
    const r = scoreWoltEzcountAttachment(FILE_B_TEXT, "natanzon_to_wolt_april.pdf");
    expect(r.verdict).toBe("fileB");
    expect(r.signals).toContain("filename:to-wolt");
  });
});
