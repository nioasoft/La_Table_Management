import { describe, it, expect } from "vitest";
import { repairMojibake } from "../pdf-text";

/**
 * Inputs are the literal pdf-parse output of ezcount invoice 170325
 * (Mishloha → King Kong Motzkin, period 08/2026), the file that failed
 * franchisee resolution on 2026-09-02.
 */
describe("repairMojibake", () => {
  it("recovers a Hebrew legal-entity name mangled to cp1252", () => {
    expect(repairMojibake('(×ž×•×¦×§×™×Ÿ ×‘×¢"×ž')).toBe('(מוצקין בע"מ');
  });

  it("recovers a run whose NBSP bytes were flattened to spaces", () => {
    // "×§×™× ×’" only decodes once the space after the 0xD7 lead byte is
    // read back as 0xA0 (ן). Without that pass this line stays garbage.
    expect(repairMojibake("×ž×•×¦×§×™×Ÿ(×§×™× ×’ ×§×•× ×’")).toBe(
      "מוצקין(קינג קונג",
    );
  });

  it("leaves clean Hebrew, Latin and numbers untouched", () => {
    const clean = 'לכבוד: "קסטרא טומאיי בע""מ )מינה טומיי סטיישן חיפה("';
    expect(repairMojibake(clean)).toBe(clean);
    expect(repairMojibake("Mishloha.digital")).toBe("Mishloha.digital");
    expect(repairMojibake("514570290 :.פ.ח")).toBe("514570290 :.פ.ח");
    expect(repairMojibake("₪1,529.57")).toBe("₪1,529.57");
  });

  it("repairs only the damaged island on a mixed line", () => {
    const out = repairMojibake('×ž×•×¦×§×™×Ÿ ×‘×¢"×ž :לכבוד');
    expect(out).toBe('מוצקין בע"מ :לכבוד');
  });

  it("returns an undecodable run unchanged instead of throwing", () => {
    expect(repairMojibake("café")).toBe("café");
    expect(repairMojibake("")).toBe("");
  });

  it("preserves line structure", () => {
    expect(repairMojibake('a\n(×ž×•×¦×§×™×Ÿ ×‘×¢"×ž\nb')).toBe('a\n(מוצקין בע"מ\nb');
  });
});
