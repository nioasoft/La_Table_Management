import { describe, expect, it } from "vitest";
import { detectRecipientClientCodeFromText } from "../detect-invoice-recipient";

// All fixtures below are verbatim pdf-parse output slices from real May 2026
// production PDFs (probe 2026-06-11).

describe("detectRecipientClientCodeFromText", () => {
  it("detects a Haat-bound invoice (Latin recipient flipped before לכבוד) — חורב 10051", () => {
    const text =
      "31/05/2026 :תאריך\nמסמך ממוחשב, חתום דיגיטלית\nHaat Delivery :לכבוד\n516136603 :.פ/ת.ז.ח\nטלפון: 046000905\nחשבונית מס מספר 10051";
    expect(detectRecipientClientCodeFromText(text)).toBe("HAAT");
  });

  it("detects a Mishloha-bound invoice (Hebrew recipient) — חורב 10050", () => {
    const text =
      "31/05/2026 :תאריך\nמסמך ממוחשב, חתום דיגיטלית\nלכבוד: משלוחה )דיב אנד רד פרוגקטס בעמ(\n514570290 :.פ/ת.ז.ח\nחשבונית מס מספר 10050";
    expect(detectRecipientClientCodeFromText(text)).toBe("MISHLOCHA");
  });

  it("returns null when the recipient is a franchisee (Mishloha→franchisee commission invoice 160782)", () => {
    const text =
      '1/1\n]מקור[\n31/05/2026 :תאריך\nמסמך ממוחשב, חתום דיגיטלית\nלכבוד: "פאט ויני חיפה)פט ויני עזריאלי בע""מ("\n516161361 :.פ/ת.ז.ח\nחשבונית מס מספר 160782';
    expect(detectRecipientClientCodeFromText(text)).toBeNull();
  });

  it("does not key off client mentions OUTSIDE the recipient window (line items)", () => {
    // A franchisee-recipient invoice whose line items mention the Mishloha
    // app must not be detected as Mishloha-bound via those line items —
    // only the לכבוד window counts. (It IS detected as MISHLOCHA here only
    // if the recipient line itself says so; this fixture's recipient is a
    // franchisee, so expect null.)
    const text =
      'לכבוד: "פאט ויני חיפה"\n516161361 :.פ/ת.ז.ח\nחשבונית מס מספר 162041\nפריטים:\nנתנזון בורגר חיפה _ הזמנות אונליין אפליקציית משלוחה';
    expect(detectRecipientClientCodeFromText(text)).toBeNull();
  });

  it("handles fully RTL-reversed text (דובכל)", () => {
    const text = "תילטיגיד םותח ,בשחוממ ךמסמ\nירבליד טאאה :דובכל\n516136603";
    expect(detectRecipientClientCodeFromText(text)).toBe("HAAT");
  });

  it("returns null for empty / markerless text", () => {
    expect(detectRecipientClientCodeFromText("")).toBeNull();
    expect(detectRecipientClientCodeFromText("חשבונית מס 123")).toBeNull();
  });
});
