import { describe, expect, it } from "vitest";
import {
  findFranchiseeByCustomerNumber,
  findOperatingBrand,
  getSharedEntityFranchisees,
} from "../franchisee-parent-map";

describe("findFranchiseeByCustomerNumber (HAAT shared legal entity)", () => {
  const VINI = "0e2a027a-18bb-4274-af4e-be451799a29b";
  const NATANZON = "ab020323-fefe-4543-9a69-16d14dd54b99";

  // Real HAAT commission-invoice raw text — both restaurants share ח.פ
  // 516161361 (the "מס. חברה לקוח" line) but differ on "מס. לקוח".
  const viniInvoice =
    'לכבוד:\nפט ויני עזריאלי בע"מ\nHaifa\n107127מס. לקוח:\n516161361מס. חברה לקוח:';
  const natanzonInvoice =
    'לכבוד:\nפט ויני עזריאלי בע"מ\nHaifa\n107143מס. לקוח:\n516161361מס. חברה לקוח:';

  it("routes HAAT customer 107127 → Pat Vini Azrieli Haifa", () => {
    expect(findFranchiseeByCustomerNumber("HAAT", viniInvoice)?.franchiseeId).toBe(VINI);
  });

  it("routes HAAT customer 107143 → Natanzon Azrieli Haifa", () => {
    expect(findFranchiseeByCustomerNumber("HAAT", natanzonInvoice)?.franchiseeId).toBe(
      NATANZON,
    );
  });

  it("is case-insensitive on the parser code", () => {
    expect(findFranchiseeByCustomerNumber("haat", natanzonInvoice)?.franchiseeId).toBe(
      NATANZON,
    );
  });

  it("does not match the shared 9-digit company number (516161361)", () => {
    // Only the company number present, no customer number → no route.
    expect(
      findFranchiseeByCustomerNumber("HAAT", "516161361מס. חברה לקוח:"),
    ).toBeNull();
  });

  it("does not match a customer number embedded in a longer digit run", () => {
    expect(findFranchiseeByCustomerNumber("HAAT", "9107127מס. לקוח:")).toBeNull();
    expect(findFranchiseeByCustomerNumber("HAAT", "1071270מס. לקוח:")).toBeNull();
  });

  it("returns null for clients with no customer-number map / empty input", () => {
    expect(findFranchiseeByCustomerNumber("MISHLOCHA", natanzonInvoice)).toBeNull();
    expect(findFranchiseeByCustomerNumber("HAAT", "")).toBeNull();
    expect(findFranchiseeByCustomerNumber(null, natanzonInvoice)).toBeNull();
  });
});

describe("getSharedEntityFranchisees", () => {
  it("returns both HAAT shared-entity franchisees", () => {
    const shared = getSharedEntityFranchisees("HAAT");
    expect(shared.map((f) => f.franchiseeId).sort()).toEqual(
      [
        "0e2a027a-18bb-4274-af4e-be451799a29b",
        "ab020323-fefe-4543-9a69-16d14dd54b99",
      ].sort(),
    );
  });

  it("is case-insensitive on the parser code", () => {
    expect(getSharedEntityFranchisees("haat")).toHaveLength(2);
  });

  it("returns empty for parsers without a shared entity / empty input", () => {
    expect(getSharedEntityFranchisees("MISHLOCHA")).toEqual([]);
    expect(getSharedEntityFranchisees("WOLT")).toEqual([]);
    expect(getSharedEntityFranchisees(null)).toEqual([]);
    expect(getSharedEntityFranchisees(undefined)).toEqual([]);
  });
});

describe("findOperatingBrand", () => {
  it('routes "פט ויני עזריאלי בע\\"מ" to Natanzon Azrieli Haifa (Asaf 2026-04-30 rule)', () => {
    const pair = findOperatingBrand('פט ויני עזריאלי בע"מ');
    expect(pair).not.toBeNull();
    expect(pair?.operatingFranchiseeId).toBe(
      "ab020323-fefe-4543-9a69-16d14dd54b99",
    );
    expect(pair?.operatingFranchiseeName).toBe("נתנזון עזריאלי חיפה");
  });

  it.each([
    'פט ויני עזריאלי בע"מ',
    "פט ויני עזריאלי בעמ",
    'פאט ויני עזריאלי בע"מ',
    "פאט ויני עזריאלי בעמ",
    "פט ויני עזריאלי",
    "פאט ויני עזריאלי",
    'פט ויני עזריאלי בע"מ - חיפה',
  ])("matches Pat Vini Azrieli alias %j", (name) => {
    const pair = findOperatingBrand(name);
    expect(pair?.operatingFranchiseeName).toBe("נתנזון עזריאלי חיפה");
  });

  it("returns null for franchisees without a parent override", () => {
    expect(findOperatingBrand('קינג קונג חורב בע"מ')).toBeNull();
    expect(findOperatingBrand("ויני רגבה")).toBeNull();
    expect(findOperatingBrand("נתנזון עזריאלי חיפה")).toBeNull();
  });

  it("returns null for empty / null / undefined inputs", () => {
    expect(findOperatingBrand("")).toBeNull();
    expect(findOperatingBrand("   ")).toBeNull();
    expect(findOperatingBrand(undefined)).toBeNull();
    expect(findOperatingBrand(null)).toBeNull();
  });

  // Regression: bidirectional .includes() previously fired parent override on
  // generic substrings of aliases (e.g., "ויני" alone matched alias
  // "פט ויני עזריאלי" via reverse-includes), hijacking legitimate franchisee
  // matches. After fix: only forward containment (candidate ⊇ alias) and
  // exact match are allowed.
  it("does not trigger parent override on generic substrings of aliases", () => {
    expect(findOperatingBrand("ויני עזריאלי")).toBeNull();
    expect(findOperatingBrand("ויני")).toBeNull();
    expect(findOperatingBrand("עזריאלי")).toBeNull();
    expect(findOperatingBrand("פט ויני")).toBeNull();
    expect(findOperatingBrand("פט")).toBeNull();
  });

  it("does not trigger parent override on unrelated franchisee names that share a token", () => {
    // "האט נתנזון" should NOT route to Netanzon-Azrieli via parent map —
    // it should reach the regular fuzzy matcher with no override.
    expect(findOperatingBrand("האט נתנזון")).toBeNull();
    // Unrelated brand that happens to share the "ויני" token:
    expect(findOperatingBrand("ויני רגבה")).toBeNull();
  });

  describe("content gate (2026-05-10)", () => {
    const PAT_VINI = 'פאט ויני עזריאלי בע"מ';

    it("fires when content text mentions the operating-brand keyword", () => {
      const pair = findOperatingBrand(
        PAT_VINI,
        "הזמנות אונליין נתנזון בורגר חיפה 1155 ש\"ח"
      );
      expect(pair?.operatingFranchiseeName).toBe("נתנזון עזריאלי חיפה");
    });

    it("blocks override when content mentions a conflicting brand keyword (mixed invoice)", () => {
      // Real-world Mishlocha 10075: line items reference both VINNI ויני חיפה
      // and נתנזון בורגר חיפה. The override would mis-attribute the whole
      // invoice to Natanzon when the dominant brand is Vini Azrieli.
      const mixed =
        "VINNI ויני חיפה — הזמנות אונליין 4778\n" +
        "נתנזון בורגר חיפה — הזמנות אונליין 1155";
      expect(findOperatingBrand(PAT_VINI, mixed)).toBeNull();
    });

    it("blocks override when no operating-brand keyword is present at all", () => {
      // Real-world HAAT income invoice 10074: only a generic
      // "סה\"כ אשראי חיוב במע\"מ" line item, no Natanzon mention.
      // Must fall through to fuzzy match → Pat Vini Azrieli Haifa.
      const haatGeneric = 'סה"כ אשראי חיוב במע"מ 2667.80';
      expect(findOperatingBrand(PAT_VINI, haatGeneric)).toBeNull();
    });

    // Regression 2026-06-11 (May 2026 incident): the recipient header of
    // EVERY Mishloha invoice to this legal entity reads
    // 'לכבוד: "פאט ויני חיפה(פט ויני עזריאלי בע"מ)"' — it contains the old
    // blocking keyword "ויני חיפה" even on pure-Natanzon invoices, so the
    // override never fired and Natanzon documents overwrote Pat Vini's.
    // Blocking now keys on the Latin brand marker "VINNI" only.
    it("does NOT block on the recipient header of a pure-Natanzon invoice (invoice 162041)", () => {
      const pureNatanzon =
        'לכבוד: "פאט ויני חיפה(פט ויני עזריאלי בע"מ)"\n' +
        "נתנזון בורגר חיפה _ הזמנות אונליין אפליקציית משלוחה 1220.70";
      expect(
        findOperatingBrand(PAT_VINI, pureNatanzon)?.operatingFranchiseeName
      ).toBe("נתנזון עזריאלי חיפה");
    });

    // Regression 2026-06-11: HAAT documents carry the brand in English only
    // ("Natanzon Burger" on the business-8095 monthly summary). The Hebrew-
    // only keyword missed them and the document routed to Pat Vini.
    it("fires on the English brand marker (HAAT 'Natanzon Burger')", () => {
      const haatRed =
        'פט ויני עזריאלי בע"מ Natanzon Burger\nמספר העסק: 8095';
      expect(
        findOperatingBrand(PAT_VINI, haatRed)?.operatingFranchiseeName
      ).toBe("נתנזון עזריאלי חיפה");
    });

    it("still blocks when the VINNI brand marker is present (business 8093 red report)", () => {
      const haatVini = 'פט ויני עזריאלי בע"מ VINNI\nמספר העסק: 8093';
      expect(findOperatingBrand(PAT_VINI, haatVini)).toBeNull();
    });

    it("preserves legacy callers that pass no content text", () => {
      // Backward-compatible: when contentText is undefined/null, the gate
      // is skipped and the override fires as before. Used so the same
      // helper can be invoked from older code paths during migration.
      expect(findOperatingBrand(PAT_VINI)?.operatingFranchiseeName).toBe(
        "נתנזון עזריאלי חיפה"
      );
      expect(findOperatingBrand(PAT_VINI, null)?.operatingFranchiseeName).toBe(
        "נתנזון עזריאלי חיפה"
      );
    });
  });
});
