/**
 * Subject-based franchisee resolution: the pipe inside a Wolt branch name.
 *
 * Wolt writes "<brand> | <branch>" in the subject ("קינג קונג | חדרה הכשר").
 * While Wolt still put the Hebrew branch name in the attachment FILENAME this
 * never mattered — Strategy 2 resolved the document long before the subject
 * was consulted. On 2026-07-16 Wolt started ASCII-sanitising filenames
 * ("|_sales_report_monthly_2026-07-01_2026-08-01.pdf"), the subject became the
 * only signal, and splitting it on "|" produced two half-names:
 *
 *   - "קינג קונג | ביג קריית אתא" → neither half cleared the 0.85 gate (0.84),
 *     so the email failed outright;
 *   - "קינג קונג | חדרה הכשר" → the brand-only leading half "קינג קונג"
 *     matched a SIBLING branch and July 2026's חדרה report (₪308,406) was
 *     committed to חורב, auto-approved and silent.
 *
 * These cases pin the pipe-joined form winning, while "|" as a genuine
 * delimiter still resolves for senders that use it that way.
 */
import { describe, it, expect } from "vitest";
import { resolveFranchisee } from "../resolve-franchisee";
import type { Franchisee } from "@/db/schema";

const franchiseeOf = (id: string, name: string, aliases: string[]): Franchisee =>
  ({ id, name, code: id, brandId: null, aliases, isActive: true }) as unknown as Franchisee;

const KK_HADERA = franchiseeOf("kk-hadera", 'קינג קונג חדרה בע"מ', [
  "קינג קונג חדרה",
  "קינג קונג חדרה הכשר",
]);
const KK_HOREV = franchiseeOf("kk-horev", 'קינג קונג חורב בע"מ', [
  "קינג קונג חורב",
  "קינג קונג חיפה",
]);
const KK_BIG = franchiseeOf("kk-big", 'קינג קונג ביג בע"מ', [
  "קינג קונג ביג",
  "קינג קונג ביג קריית אתא",
]);
const ALL = [KK_HADERA, KK_HOREV, KK_BIG];

/** No parser output, no filename — exactly what a post-2026-07-16 Wolt email hits. */
const resolveFromSubject = (subject: string) =>
  resolveFranchisee(
    Buffer.alloc(0),
    "application/pdf",
    "WOLT",
    subject,
    ALL,
    undefined,
    "client_report",
  );

describe("resolveFranchisee — subject pipe handling", () => {
  it("routes a brand|branch subject to the branch, not a sibling", async () => {
    const result = await resolveFromSubject(
      "קינג קונג | חדרה הכשר - Wolt payout report 01/07/2026 - 01/08/2026",
    );
    expect(result.ok).toBe(true);
    // The regression: this used to resolve to קינג קונג חורב.
    expect(result.ok && result.franchiseeName).toBe('קינג קונג חדרה בע"מ');
  });

  it("clears the acceptance gate for a branch that scored 0.84 when split", async () => {
    const result = await resolveFromSubject(
      "קינג קונג | ביג קריית אתא - Wolt payout report 01/07/2026 - 01/08/2026",
    );
    expect(result.ok).toBe(true);
    expect(result.ok && result.franchiseeName).toBe('קינג קונג ביג בע"מ');
  });

  it("still treats | as a delimiter when it separates unrelated segments", async () => {
    const result = await resolveFromSubject("דוח חודשי | קינג קונג חורב | 07/2026");
    expect(result.ok).toBe(true);
    expect(result.ok && result.franchiseeName).toBe('קינג קונג חורב בע"מ');
  });
});
