import { describe, expect, it, vi } from "vitest";

import {
  ROYALTY_SEED_CONFIGS,
  buildSeedDeltas,
  buildSeedPlan,
  executeDatabaseSeed,
  parseSeedMode,
  type SeedFranchiseeRow,
} from "@/scripts/seed-royalty-config";
import type { RoyaltyTier } from "@/lib/royalty";

const STANDARD_VINNI: RoyaltyTier[] = [
  { upTo: 500_000, rate: 0 },
  { upTo: 600_000, rate: 4 },
  { upTo: 700_000, rate: 4.5 },
  { upTo: null, rate: 5 },
];
const NORTH_VINNI: RoyaltyTier[] = [
  { upTo: 550_000, rate: 0 },
  { upTo: 700_000, rate: 4 },
  { upTo: null, rate: 4.5 },
];

const EXPECTED_TIERS: Record<string, RoyaltyTier[] | null> = {
  "מינה טומאיי יהוד": [
    { upTo: 700_000, rate: 0 },
    { upTo: null, rate: 5 },
  ],
  "מינה טומאיי עין שמר": [
    { upTo: 700_000, rate: 0 },
    { upTo: 1_200_000, rate: 3.5 },
    { upTo: null, rate: 4 },
  ],
  "מינה טומאיי שרונה": [
    { upTo: 1_200_000, rate: 2.5 },
    { upTo: null, rate: 3 },
  ],
  "מינה טומאיי קסטרא": [{ upTo: null, rate: 3 }],
  "מינה טומאיי קריון": [{ upTo: null, rate: 4 }],
  "ויני חדרה": STANDARD_VINNI,
  "ויני יהוד": STANDARD_VINNI,
  "ויני נתניה": STANDARD_VINNI,
  "ויני קריית אתא": STANDARD_VINNI,
  "ויני כרמיאל": NORTH_VINNI,
  "ויני רגבה": NORTH_VINNI,
  "ויני עזריאלי חיפה": [{ upTo: null, rate: 3 }],
  "קינג קונג כרמיאל": [
    { upTo: 550_000, rate: 0 },
    { upTo: 1_000_000, rate: 4.5 },
    { upTo: null, rate: 5 },
  ],
  "קינג קונג נהריה": [
    { upTo: 550_000, rate: 0 },
    { upTo: 850_000, rate: 4.5 },
    { upTo: null, rate: 5 },
  ],
  "קינג קונג רעננה": [
    { upTo: 700_000, rate: 0 },
    { upTo: null, rate: 5 },
  ],
  "קינג קונג חדרה": [{ upTo: null, rate: 3 }],
  "קינג קונג חורב": [{ upTo: null, rate: 3 }],
  "קינג קונג ביג קריות": [{ upTo: null, rate: 3 }],
  "קינג קונג עפולה": [{ upTo: null, rate: 4.5 }],
  "קינג קונג מוצקין": null,
  "נתנזון עזריאלי חיפה": [{ upTo: null, rate: 0 }],
};

const EXPECTED_ACCOUNTS: Record<string, string> = {
  "מינה טומאיי יהוד": "אושיבה",
  "מינה טומאיי קסטרא": "מינה",
  "מינה טומאיי קריון": "אודון",
  "ויני יהוד": "טמפר",
  "ויני נתניה": "סידיוס",
  "ויני קריית אתא": "מיאמוטו",
  "ויני עזריאלי חיפה": "פט ויני ע",
  "קינג קונג חדרה": "קינג ח",
  "קינג קונג נהריה": "קינג ג",
  "קינג קונג ביג קריות": "קינג ב",
  "קינג קונג רעננה": "ק.ק מסעדה",
  "קינג קונג עפולה": "קינג עפולה",
  "קינג קונג מוצקין": "קינג מ",
};

function createDatabaseRows(): SeedFranchiseeRow[] {
  return ROYALTY_SEED_CONFIGS.map((config, index) => ({
    id: `franchisee-${index}`,
    name: config.matchNames[0],
    brandCode: config.brandCode,
    aliases: config.account ? [config.account.evidenceAliases[0]] : [],
    marketingFeeRate: null,
    royaltyTiers: null,
    royaltyTierBasis: "net",
    royaltyTiersConfirmed: false,
    royaltyTiersNote: null,
    hashavshevetAccountKey: null,
  }));
}

describe("royalty seed configuration", () => {
  it("contains all 21 franchisees and the required special cases", () => {
    expect(ROYALTY_SEED_CONFIGS).toHaveLength(21);
    expect(
      ROYALTY_SEED_CONFIGS.filter((config) => config.account),
    ).toHaveLength(13);
    expect(
      ROYALTY_SEED_CONFIGS.filter((config) => config.normalizationNote),
    ).toHaveLength(12);
    expect(
      ROYALTY_SEED_CONFIGS.filter(
        (config) => config.royaltyTiers && config.royaltyTiers.length > 1,
      ),
    ).toHaveLength(12);

    const motzkin = ROYALTY_SEED_CONFIGS.find((config) =>
      config.label.includes("מוצקין"),
    );
    const afula = ROYALTY_SEED_CONFIGS.find((config) =>
      config.label.includes("עפולה"),
    );
    const natanzon = ROYALTY_SEED_CONFIGS.find(
      (config) => config.brandCode === "NATANZON",
    );

    expect(motzkin?.royaltyTiers).toBeNull();
    expect(afula?.royaltyTiers).toEqual([{ upTo: null, rate: 4.5 }]);
    expect(natanzon).toMatchObject({
      label: "נתנזון עזריאלי חיפה",
      marketingFeeRate: "0.00",
      royaltyTiers: [{ upTo: null, rate: 0 }],
      normalizationNote: null,
    });
    expect(
      ROYALTY_SEED_CONFIGS.every(
        (config) => config.marketingFeeRate === "1.00" || config === natanzon,
      ),
    ).toBe(true);
  });

  it("matches every extracted tier and reconstructed account key", () => {
    const tiers = Object.fromEntries(
      ROYALTY_SEED_CONFIGS.map((config) => [config.label, config.royaltyTiers]),
    );
    const accounts = Object.fromEntries(
      ROYALTY_SEED_CONFIGS.filter((config) => config.account).map((config) => [
        config.label,
        config.account?.key,
      ]),
    );

    expect(tiers).toEqual(EXPECTED_TIERS);
    expect(accounts).toEqual(EXPECTED_ACCOUNTS);
  });

  it("uses dry-run by default and rejects ambiguous flags", () => {
    expect(parseSeedMode([])).toBe("dry-run");
    expect(parseSeedMode(["--dry-run"])).toBe("dry-run");
    expect(parseSeedMode(["--verify"])).toBe("verify");
    expect(parseSeedMode(["--apply"])).toBe("apply");
    expect(() => parseSeedMode(["--verify", "--apply"])).toThrow();
    expect(() => parseSeedMode(["--apply", "--dry-run"])).toThrow();
    expect(() => parseSeedMode(["--unknown"])).toThrow();
  });

  it("contains the exact tiers extracted from the client formulas", () => {
    const tierSignatures = Object.fromEntries(
      ROYALTY_SEED_CONFIGS.map((config) => [
        config.label,
        config.royaltyTiers
          ?.map((tier) => `${tier.upTo ?? "∞"}:${tier.rate}`)
          .join("|") ?? null,
      ]),
    );

    expect(tierSignatures).toEqual({
      "מינה טומאיי יהוד": "700000:0|∞:5",
      "מינה טומאיי עין שמר": "700000:0|1200000:3.5|∞:4",
      "מינה טומאיי שרונה": "1200000:2.5|∞:3",
      "מינה טומאיי קסטרא": "∞:3",
      "מינה טומאיי קריון": "∞:4",
      "ויני חדרה": "500000:0|600000:4|700000:4.5|∞:5",
      "ויני יהוד": "500000:0|600000:4|700000:4.5|∞:5",
      "ויני נתניה": "500000:0|600000:4|700000:4.5|∞:5",
      "ויני קריית אתא": "500000:0|600000:4|700000:4.5|∞:5",
      "ויני כרמיאל": "550000:0|700000:4|∞:4.5",
      "ויני רגבה": "550000:0|700000:4|∞:4.5",
      "ויני עזריאלי חיפה": "∞:3",
      "קינג קונג כרמיאל": "550000:0|1000000:4.5|∞:5",
      "קינג קונג נהריה": "550000:0|850000:4.5|∞:5",
      "קינג קונג רעננה": "700000:0|∞:5",
      "קינג קונג חדרה": "∞:3",
      "קינג קונג חורב": "∞:3",
      "קינג קונג ביג קריות": "∞:3",
      "קינג קונג עפולה": "∞:4.5",
      "קינג קונג מוצקין": null,
      "נתנזון עזריאלי חיפה": "∞:0",
    });
  });

  it("contains the exact 13 Hashavshevet account mappings", () => {
    const accountMappings = Object.fromEntries(
      ROYALTY_SEED_CONFIGS.flatMap((config) =>
        config.account ? [[config.label, config.account.key]] : [],
      ),
    );

    expect(accountMappings).toEqual({
      "מינה טומאיי יהוד": "אושיבה",
      "מינה טומאיי קסטרא": "מינה",
      "מינה טומאיי קריון": "אודון",
      "ויני יהוד": "טמפר",
      "ויני נתניה": "סידיוס",
      "ויני קריית אתא": "מיאמוטו",
      "ויני עזריאלי חיפה": "פט ויני ע",
      "קינג קונג נהריה": "קינג ג",
      "קינג קונג רעננה": "ק.ק מסעדה",
      "קינג קונג חדרה": "קינג ח",
      "קינג קונג ביג קריות": "קינג ב",
      "קינג קונג עפולה": "קינג עפולה",
      "קינג קונג מוצקין": "קינג מ",
    });
  });
});

describe("buildSeedPlan", () => {
  it("plans all 21 rows and verifies all 13 account mappings", () => {
    const plan = buildSeedPlan(createDatabaseRows());

    expect(plan.errors).toEqual([]);
    expect(plan.entries).toHaveLength(21);
    expect(plan.entries.every((entry) => entry.status === "לעדכון")).toBe(true);
    expect(
      plan.entries.every(
        (entry) =>
          entry.patch.royaltyTierBasis === "gross" &&
          entry.patch.royaltyTiersConfirmed === false,
      ),
    ).toBe(true);
    expect(
      plan.entries.filter(
        (entry) => entry.config.account && !entry.accountWarning,
      ),
    ).toHaveLength(13);
    expect(
      plan.entries.filter(
        (entry) => entry.patch.royaltyTiersNote !== undefined,
      ),
    ).toHaveLength(12);
  });

  it("skips an unverified account key but retains the other changes", () => {
    const rows = createDatabaseRows().map((row) =>
      row.name.includes("מינה טומאיי יהוד")
        ? { ...row, aliases: ["כינוי אחר"] }
        : row,
    );

    const entry = buildSeedPlan(rows).entries.find((item) =>
      item.config.label.includes("יהוד"),
    );

    expect(entry?.accountWarning).toContain("לא נמצא כינוי מאמת");
    expect(entry?.patch.hashavshevetAccountKey).toBeUndefined();
    expect(entry?.patch.royaltyTiers).toEqual([
      { upTo: 700_000, rate: 0 },
      { upTo: null, rate: 5 },
    ]);
  });

  it("does not overwrite any field after a tier was confirmed", () => {
    const rows = createDatabaseRows().map((row, index) =>
      index === 0
        ? {
            ...row,
            aliases: ["כינוי אחר"],
            royaltyTiersConfirmed: true,
            marketingFeeRate: "7.00",
          }
        : row,
    );

    const [entry] = buildSeedPlan(rows).entries;

    expect(entry.status).toBe("מוגן — כבר אושר");
    expect(entry.patch).toEqual({});
    expect(entry.accountWarning).toContain("לא נמצא כינוי מאמת");
  });

  it("is idempotent after applying its planned patches", () => {
    const rows = createDatabaseRows().map((row) =>
      row.name.includes("מוצקין")
        ? {
            ...row,
            royaltyTiers: [{ upTo: null, rate: 9 }],
            royaltyTiersNote: "הערה ישנה שאינה שייכת לזכיין",
          }
        : row,
    );
    const firstPlan = buildSeedPlan(rows);
    const patchesById = new Map(
      firstPlan.entries.map((entry) => [entry.row.id, entry.patch]),
    );
    const updatedRows = rows.map((row) => ({
      ...row,
      ...patchesById.get(row.id),
    }));

    const secondPlan = buildSeedPlan(updatedRows);
    const motzkin = updatedRows.find((row) => row.name.includes("מוצקין"));

    expect(motzkin?.royaltyTiers).toBeNull();
    expect(motzkin?.royaltyTiersNote).toBeNull();
    expect(secondPlan.errors).toEqual([]);
    expect(
      secondPlan.entries.every((entry) => entry.status === "ללא שינוי"),
    ).toBe(true);
    expect(
      secondPlan.entries.every(
        (entry) => Object.keys(entry.patch).length === 0,
      ),
    ).toBe(true);
  });

  it("reports missing, ambiguous, and unexpected active franchisees", () => {
    const rows = createDatabaseRows();
    const withoutFirst = rows.slice(1);
    const duplicate = { ...rows[1], id: "duplicate" };

    const plan = buildSeedPlan([...withoutFirst, duplicate]);

    expect(plan.errors.some((error) => error.includes("נמצאו 0 רשומות"))).toBe(
      true,
    );
    expect(plan.errors.some((error) => error.includes("נמצאו 2 רשומות"))).toBe(
      true,
    );
    expect(
      plan.errors.some((error) => error.includes("ללא קונפיגורציית זריעה")),
    ).toBe(true);
  });
});

describe("database-aware verification", () => {
  it("never invokes the write path in verify mode", async () => {
    const writeEntries = vi.fn(async () => 21);
    const presentPlan = vi.fn();

    const result = await executeDatabaseSeed("verify", {
      readRows: async () => createDatabaseRows(),
      writeEntries,
      presentPlan,
    });

    expect(result.updated).toBe(0);
    expect(presentPlan).toHaveBeenCalledOnce();
    expect(writeEntries).not.toHaveBeenCalled();
  });

  it("reports only changed fields with their before and after values", () => {
    const initialRows = createDatabaseRows();
    const initialPlan = buildSeedPlan(initialRows);
    const patchesById = new Map(
      initialPlan.entries.map((entry) => [entry.row.id, entry.patch]),
    );
    const seededRows = initialRows.map((row) => ({
      ...row,
      ...patchesById.get(row.id),
    }));
    const changedRows = seededRows.map((row) =>
      row.name.includes("מינה טומאיי יהוד")
        ? {
            ...row,
            marketingFeeRate: "2.00",
            royaltyTiers: [{ upTo: null, rate: 9 }],
          }
        : row,
    );

    const deltas = buildSeedDeltas(buildSeedPlan(changedRows).entries);

    expect(deltas).toEqual([
      {
        franchisee: "מינה טומאיי יהוד",
        field: "marketingFeeRate",
        fieldLabel: "אחוז שיווק",
        fromValue: "2.00",
        toValue: "1.00",
      },
      {
        franchisee: "מינה טומאיי יהוד",
        field: "royaltyTiers",
        fieldLabel: "מדרגות",
        fromValue: '[{"upTo":null,"rate":9}]',
        toValue: '[{"upTo":700000,"rate":0},{"upTo":null,"rate":5}]',
      },
    ]);
  });
});
