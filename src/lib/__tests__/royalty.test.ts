import { describe, expect, it } from "vitest";

import { calculateRoyalty, type RoyaltyTier } from "@/lib/royalty";

const VAT = 0.18;

const FIXED_ZERO = [{ upTo: null, rate: 0 }] as const;
const FIXED_THREE = [{ upTo: null, rate: 3 }] as const;
const FIXED_FOUR = [{ upTo: null, rate: 4 }] as const;
const MINA_YEHUD = [{ upTo: 700_000, rate: 0 }, { upTo: null, rate: 5 }] as const;
const MINA_EIN_SHEMER = [{ upTo: 700_000, rate: 0 }, { upTo: 1_200_000, rate: 3.5 }, { upTo: null, rate: 4 }] as const;
const MINA_SHARONA = [{ upTo: 1_200_000, rate: 2.5 }, { upTo: null, rate: 3 }] as const;
const VINI_STANDARD = [
  { upTo: 500_000, rate: 0 },
  { upTo: 600_000, rate: 4 }, { upTo: 700_000, rate: 4.5 },
  { upTo: null, rate: 5 },
] as const;
const VINI_CARMIEL = [{ upTo: 550_000, rate: 0 }, { upTo: 700_000, rate: 4 }, { upTo: null, rate: 4.5 }] as const;
const KING_CARMIEL = [{ upTo: 550_000, rate: 0 }, { upTo: 1_000_000, rate: 4.5 }, { upTo: null, rate: 5 }] as const;
const KING_NAHARIYA = [
  { upTo: 550_000, rate: 0 },
  { upTo: 850_000, rate: 4.5 },
  { upTo: null, rate: 5 },
] as const;
const KING_RAANANA = [{ upTo: 700_000, rate: 0 }, { upTo: null, rate: 5 }] as const;

interface RealFixture {
  readonly name: string;
  readonly receipts: number;
  readonly tiers: readonly RoyaltyTier[];
  readonly expectedRoyalty: number;
  readonly expectedMarketing: number;
  readonly marketingRate?: number;
  readonly discountRatePoints?: number;
}

const JANUARY_FIXTURES: readonly RealFixture[] = [
  {
    name: "מינה טומיי יהוד",
    receipts: 1_217_320.1,
    tiers: MINA_YEHUD,
    expectedRoyalty: 51_581.360169491534,
    expectedMarketing: 10_316.272033898307,
  },
  {
    name: "מינה עין שמר",
    receipts: 1_749_776.9000000004,
    tiers: MINA_EIN_SHEMER,
    expectedRoyalty: 59_314.47118644069,
    expectedMarketing: 14_828.617796610173,
  },
  {
    name: "קסטרא טומאיי",
    receipts: 3_128_069,
    tiers: FIXED_THREE,
    expectedRoyalty: 79_527.1779661017,
    expectedMarketing: 26_509.059322033903,
  },
  {
    name: "מינה טומאיי קריון",
    receipts: 1_485_059,
    tiers: FIXED_FOUR,
    expectedRoyalty: 50_340.98305084746,
    expectedMarketing: 12_585.245762711866,
  },
  {
    name: "מינה שרונה",
    receipts: 1_199_741.3,
    tiers: MINA_SHARONA,
    expectedRoyalty: 25_418.247881355936,
    expectedMarketing: 10_167.299152542373,
  },
  {
    name: "חדרה - דארת'",
    receipts: 739_638.2999999999,
    tiers: VINI_STANDARD,
    expectedRoyalty: 31_340.60593220339,
    expectedMarketing: 6_268.121186440678,
  },
  {
    name: "ויני יהוד",
    receipts: 872_593.2499999998,
    tiers: VINI_STANDARD,
    expectedRoyalty: 36_974.29025423728,
    expectedMarketing: 7_394.858050847456,
  },
  {
    name: "ויני כרמיאל",
    receipts: 960_291.0000000001,
    tiers: VINI_CARMIEL,
    expectedRoyalty: 36_621.266949152545,
    expectedMarketing: 8_138.0593220339,
  },
  {
    name: "נתניה - סידיוס",
    receipts: 1_100_999.3499999996,
    tiers: VINI_STANDARD,
    expectedRoyalty: 46_652.514830508466,
    expectedMarketing: 9_330.502966101692,
  },
  {
    name: "עזריאלי חיפה",
    receipts: 1_041_500.4500000001,
    tiers: FIXED_THREE,
    expectedRoyalty: 26_478.825,
    expectedMarketing: 8_826.275000000001,
  },
  {
    name: "קריית אתא - מיאמוטו",
    receipts: 1_298_304.2,
    tiers: VINI_STANDARD,
    expectedRoyalty: 55_012.88983050848,
    expectedMarketing: 11_002.577966101697,
  },
  {
    name: "ויני רגבה",
    receipts: 1_178_056.6999999993,
    tiers: VINI_CARMIEL,
    expectedRoyalty: 44_925.89110169489,
    expectedMarketing: 9_983.531355932198,
  },
  {
    name: "קינג חדרה",
    receipts: 1_057_720.5,
    tiers: FIXED_THREE,
    expectedRoyalty: 26_891.199152542376,
    expectedMarketing: 8_963.733050847459,
  },
  {
    name: "קינג חורב חיפה",
    receipts: 1_489_769.65,
    tiers: FIXED_THREE,
    expectedRoyalty: 37_875.499576271184,
    expectedMarketing: 12_625.16652542373,
  },
  {
    name: "קינג כרמיאל",
    receipts: 970_967,
    tiers: KING_CARMIEL,
    expectedRoyalty: 37_028.40254237288,
    expectedMarketing: 8_228.533898305086,
  },
  {
    name: "קינג נהריה",
    receipts: 1_306_055,
    tiers: KING_NAHARIYA,
    expectedRoyalty: 55_341.313559322036,
    expectedMarketing: 11_068.262711864407,
  },
  {
    name: "קינג ביג קריות",
    receipts: 1_804_479.9999999998,
    tiers: FIXED_THREE,
    expectedRoyalty: 45_876.61016949152,
    expectedMarketing: 15_292.203389830509,
  },
  {
    name: "קינג רעננה",
    receipts: 1_620_525.2499999993,
    tiers: KING_RAANANA,
    expectedRoyalty: 68_666.32415254235,
    expectedMarketing: 13_733.26483050847,
  },
  {
    name: "נתנזון - פט ויני חיפה",
    receipts: 38_738,
    tiers: FIXED_ZERO,
    expectedRoyalty: 0,
    expectedMarketing: 0,
    marketingRate: 0,
  },
];

const HASHAVSHEVET_FIXTURES: readonly RealFixture[] = [
  { name: "אושיבה", receipts: 1_138_200.35, tiers: MINA_YEHUD, expectedRoyalty: 48_228.82838983051, expectedMarketing: 9_645.765677966101 },
  { name: "מינה עין שמר", receipts: 1_796_076.9, tiers: MINA_EIN_SHEMER, expectedRoyalty: 60_883.962711864406, expectedMarketing: 15_220.990677966101 },
  { name: "מינה", receipts: 2_923_066, tiers: FIXED_THREE, expectedRoyalty: 74_315.2372881356, expectedMarketing: 24_771.745762711867 },
  { name: "אודון", receipts: 1_401_228.4, tiers: FIXED_FOUR, expectedRoyalty: 35_624.450847457636, expectedMarketing: 11_874.816949152546, discountRatePoints: 1 },
  { name: "מינה שרונה", receipts: 1_065_202.65, tiers: MINA_SHARONA, expectedRoyalty: 22_567.85275423729, expectedMarketing: 9_027.141101694915 },
  { name: "ויני חדרה", receipts: 688_670, tiers: VINI_STANDARD, expectedRoyalty: 20_426.652542372885, expectedMarketing: 5_836.186440677967, discountRatePoints: 1 },
  { name: "טמפר", receipts: 699_090.9, tiers: VINI_STANDARD, expectedRoyalty: 20_735.747033898315, expectedMarketing: 5_924.499152542375, discountRatePoints: 1 },
  { name: "ויני כרמיאל", receipts: 817_806.3, tiers: VINI_CARMIEL, expectedRoyalty: 31_187.528389830513, expectedMarketing: 6_930.561864406781 },
  { name: "סידיוס", receipts: 856_659.8, tiers: VINI_STANDARD, expectedRoyalty: 32_669.229661016947, expectedMarketing: 7_259.828813559322, discountRatePoints: 0.5 },
  { name: "פט ויני ע", receipts: 765_199.8, tiers: FIXED_THREE, expectedRoyalty: 19_454.23220338983, expectedMarketing: 6_484.744067796611 },
  { name: "מיאמוטו", receipts: 1_061_152, tiers: VINI_STANDARD, expectedRoyalty: 44_964.067796610165, expectedMarketing: 8_992.813559322032 },
  { name: "ויני רגבה", receipts: 1_041_471.5, tiers: VINI_CARMIEL, expectedRoyalty: 39_717.13347457627, expectedMarketing: 8_826.02966101695 },
  { name: "קינג ח", receipts: 1_198_391.5, tiers: FIXED_THREE, expectedRoyalty: 30_467.58050847457, expectedMarketing: 10_155.860169491523 },
  { name: "קינג קונג חורב", receipts: 1_565_627.65, tiers: FIXED_THREE, expectedRoyalty: 39_804.09279661019, expectedMarketing: 13_268.030932203397 },
  { name: "קינג כרמיאל", receipts: 1_183_354.3, tiers: KING_CARMIEL, expectedRoyalty: 50_142.131355932186, expectedMarketing: 10_028.426271186438 },
  { name: "קינג ג", receipts: 1_445_832, tiers: KING_NAHARIYA, expectedRoyalty: 61_264.06779661017, expectedMarketing: 12_252.813559322034 },
  { name: "קינג ב", receipts: 1_784_683, tiers: FIXED_THREE, expectedRoyalty: 45_373.2966101695, expectedMarketing: 15_124.432203389833 },
  { name: "ק.ק מסעדה", receipts: 1_737_658.75, tiers: KING_RAANANA, expectedRoyalty: 73_629.60805084747, expectedMarketing: 14_725.921610169493 },
];

function calculateFixture(fixture: RealFixture) {
  return calculateRoyalty({
    receipts: fixture.receipts,
    tips: 0,
    includeTips: false,
    tiers: fixture.tiers,
    tierBasis: "gross",
    marketingRate: fixture.marketingRate ?? 1,
    discountRatePoints: fixture.discountRatePoints ?? 0,
    vat: VAT,
  });
}

describe("calculateRoyalty real client data", () => {
  it.each(JANUARY_FIXTURES)(
    "matches the January workbook for $name",
    (fixture) => {
      expect(JANUARY_FIXTURES).toHaveLength(19);
      const result = calculateFixture(fixture);

      expect(result.royalty).toBeCloseTo(fixture.expectedRoyalty, 10);
      expect(result.marketing).toBeCloseTo(fixture.expectedMarketing, 10);
    },
  );

  it.each(HASHAVSHEVET_FIXTURES)(
    "matches the Hashavshevet exports for $name",
    (fixture) => {
      expect(HASHAVSHEVET_FIXTURES).toHaveLength(18);
      const result = calculateFixture(fixture);

      expect(result.royalty).toBeCloseTo(fixture.expectedRoyalty, 10);
      expect(result.marketing).toBeCloseTo(fixture.expectedMarketing, 10);
    },
  );
});

describe("calculateRoyalty contract", () => {
  it("uses an inclusive tier boundary and crosses it immediately above", () => {
    const atBoundary = calculateRoyalty({
      receipts: 700_000,
      tips: 0,
      includeTips: false,
      tiers: MINA_YEHUD,
      tierBasis: "gross",
      marketingRate: 1,
      discountRatePoints: 0,
      vat: VAT,
    });
    const aboveBoundary = calculateRoyalty({
      receipts: 700_000.01,
      tips: 0,
      includeTips: false,
      tiers: MINA_YEHUD,
      tierBasis: "gross",
      marketingRate: 1,
      discountRatePoints: 0,
      vat: VAT,
    });

    expect(atBoundary.tierRate).toBe(0);
    expect(aboveBoundary.tierRate).toBe(5);
  });

  it("selects a 0% tier", () => {
    const result = calculateRoyalty({
      receipts: 500_000,
      tips: 0,
      includeTips: false,
      tiers: VINI_STANDARD,
      tierBasis: "gross",
      marketingRate: 1,
      discountRatePoints: 0,
      vat: VAT,
    });

    expect(result.royalty).toBe(0);
    expect(result.marketing).toBeGreaterThan(0);
  });

  it("uses the first tier when the base is below its threshold", () => {
    const result = calculateRoyalty({
      receipts: 1,
      tips: 0,
      includeTips: false,
      tiers: VINI_STANDARD,
      tierBasis: "gross",
      marketingRate: 1,
      discountRatePoints: 0,
      vat: VAT,
    });

    expect(result.tierRate).toBe(0);
  });

  it.each([
    {
      name: "an empty tier list",
      tiers: [],
      expected:
        "No matching royalty tier for grossBase=600000, tierBasis=gross, tiersChecked=0",
    },
    {
      name: "a base above the last finite tier",
      tiers: [{ upTo: 500_000, rate: 4 }],
      expected:
        "No matching royalty tier for grossBase=600000, tierBasis=gross, tiersChecked=1",
    },
  ])("throws a diagnostic error for $name", ({ tiers, expected }) => {
    expect(() =>
      calculateRoyalty({
        receipts: 600_000,
        tips: 0,
        includeTips: false,
        tiers,
        tierBasis: "gross",
        marketingRate: 1,
        discountRatePoints: 0,
        vat: VAT,
      }),
    ).toThrow(expected);
  });

  it("produces different tiers for gross and net threshold bases", () => {
    const input = {
      receipts: 750_000,
      tips: 0,
      includeTips: false,
      tiers: [
        { upTo: 700_000, rate: 2 },
        { upTo: null, rate: 4 },
      ],
      marketingRate: 1,
      discountRatePoints: 0,
      vat: VAT,
    } as const;

    expect(calculateRoyalty({ ...input, tierBasis: "gross" }).tierRate).toBe(4);
    expect(calculateRoyalty({ ...input, tierBasis: "net" }).tierRate).toBe(2);
  });

  it("converts a net threshold using the supplied VAT rate", () => {
    const input = {
      receipts: 820_000,
      tips: 0,
      includeTips: false,
      tiers: [
        { upTo: 700_000, rate: 2 },
        { upTo: null, rate: 4 },
      ],
      tierBasis: "net",
      marketingRate: 1,
      discountRatePoints: 0,
    } as const;

    expect(calculateRoyalty({ ...input, vat: 0.17 }).tierRate).toBe(4);
    expect(calculateRoyalty({ ...input, vat: 0.18 }).tierRate).toBe(2);
  });

  it("subtracts the tips from the receipts only when excluded", () => {
    // Tabit's receipts column already carries the tips, so including them is
    // the column untouched and excluding them takes them back out.
    const input = {
      receipts: 710_000,
      tips: 20_000,
      tiers: [
        { upTo: 700_000, rate: 2 },
        { upTo: null, rate: 4 },
      ],
      tierBasis: "gross",
      marketingRate: 1,
      discountRatePoints: 0,
      vat: VAT,
    } as const;

    const excluded = calculateRoyalty({ ...input, includeTips: false });
    const included = calculateRoyalty({ ...input, includeTips: true });
    const excludedNetBase = 690_000 / (1 + VAT);
    const includedNetBase = 710_000 / (1 + VAT);

    expect(excluded.grossBase).toBe(690_000);
    expect(excluded.netBase).toBe(excludedNetBase);
    expect(excluded.tierRate).toBe(2);
    expect(excluded.royalty).toBe((excludedNetBase * 2) / 100);
    expect(excluded.marketing).toBe(excludedNetBase / 100);
    expect(included.grossBase).toBe(710_000);
    expect(included.netBase).toBe(includedNetBase);
    expect(included.tierRate).toBe(4);
    expect(included.royalty).toBe((includedNetBase * 4) / 100);
    expect(included.marketing).toBe(includedNetBase / 100);
  });

  it("never counts the tips twice", () => {
    const base = {
      receipts: 1_000_000,
      tips: 40_000,
      tiers: [{ upTo: null, rate: 5 }],
      tierBasis: "gross",
      marketingRate: 1,
      discountRatePoints: 0,
      vat: VAT,
    } as const;

    // The two bases differ by exactly the tips, and the larger one is the
    // untouched column — never the column plus the tips again.
    const included = calculateRoyalty({ ...base, includeTips: true });
    const excluded = calculateRoyalty({ ...base, includeTips: false });

    expect(included.grossBase).toBe(1_000_000);
    expect(excluded.grossBase).toBe(960_000);
    expect(included.grossBase - excluded.grossBase).toBe(40_000);
  });

  it("clamps a discount larger than the tier rate to zero", () => {
    const result = calculateRoyalty({
      receipts: 1_180,
      tips: 0,
      includeTips: false,
      tiers: FIXED_THREE,
      tierBasis: "gross",
      marketingRate: 1,
      discountRatePoints: 5,
      vat: VAT,
    });

    expect(result.effectiveRate).toBe(0);
    expect(result.royalty).toBe(0);
    expect(result.discountValue).toBe(result.royaltyFull);
  });

  it("supports a zero marketing rate", () => {
    const result = calculateRoyalty({
      receipts: 1_180,
      tips: 0,
      includeTips: false,
      tiers: FIXED_THREE,
      tierBasis: "gross",
      marketingRate: 0,
      discountRatePoints: 0,
      vat: VAT,
    });

    expect(result.marketing).toBe(0);
    expect(result.subtotal).toBe(result.royalty);
  });

  it.each([
    { receipts: 1_180, tips: 0, includeTips: false },
    { receipts: 900_000, tips: 12_345.67, includeTips: true },
    { receipts: 0, tips: 0, includeTips: false },
  ])("always derives subtotal from royalty and marketing", (base) => {
    const result = calculateRoyalty({
      ...base,
      tiers: VINI_STANDARD,
      tierBasis: "gross",
      marketingRate: 1,
      discountRatePoints: 0.5,
      vat: VAT,
    });

    expect(result.subtotal).toBe(result.royalty + result.marketing);
    expect(result.total).toBe(result.subtotal * (1 + VAT));
  });
});

const KING_AFULA = [
  { upTo: 600_000, rate: 0 },
  { upTo: 800_000, rate: 16, marginal: true },
  { upTo: null, rate: 4.5, marginal: true },
] as const;
const KING_AFULA_FLAT_TOP = [
  { upTo: 600_000, rate: 0 },
  { upTo: 800_000, rate: 16, marginal: true },
  { upTo: null, rate: 4.5 },
] as const;

function marginalResult(
  receipts: number,
  tiers: readonly RoyaltyTier[] = KING_AFULA,
  overrides: Partial<Parameters<typeof calculateRoyalty>[0]> = {},
) {
  return calculateRoyalty({
    receipts,
    tips: 0,
    includeTips: false,
    tiers,
    tierBasis: "gross",
    marketingRate: 1,
    discountRatePoints: 0,
    vat: VAT,
    ...overrides,
  });
}

describe("marginal royalty tiers", () => {
  it("charges nothing below the first band", () => {
    const result = marginalResult(600_000);

    expect(result.tierRate).toBe(0);
    expect(result.royalty).toBe(0);
    expect(result.marketing).toBeCloseTo(5_084.745762711865, 10);
  });

  it("charges a marginal band on the difference only", () => {
    const result = marginalResult(700_000);

    // 16% of the 100,000 above the 600,000 threshold, net of VAT.
    expect(result.royalty).toBeCloseTo(13_559.322033898306, 10);
    expect(result.tierRate).toBeCloseTo(2.285714285714286, 10);
    expect(result.netBase).toBeCloseTo(593_220.3389830509, 10);
  });

  it("charges the full band at its inclusive upper bound", () => {
    const result = marginalResult(800_000);

    expect(result.royalty).toBeCloseTo(27_118.644067796612, 10);
    expect(result.tierRate).toBeCloseTo(4, 10);
  });

  it("stacks an open-ended marginal band on top of the ones below it", () => {
    const result = marginalResult(900_000);

    expect(result.royalty).toBeCloseTo(30_932.20338983051, 10);
    expect(result.tierRate).toBeCloseTo(4.055555555555556, 10);
  });

  it("charges a flat tier above a marginal band on the whole base", () => {
    const result = marginalResult(900_000, KING_AFULA_FLAT_TOP);

    expect(result.tierRate).toBe(4.5);
    expect(result.royalty).toBeCloseTo(34_322.03389830509, 10);
  });

  it("keeps the discount as points off the blended rate", () => {
    const result = marginalResult(700_000, KING_AFULA, {
      discountRatePoints: 1,
    });

    expect(result.effectiveRate).toBeCloseTo(1.285714285714286, 10);
    expect(result.royaltyFull).toBeCloseTo(13_559.322033898306, 10);
    // A single point off is exactly 1% of the net base, marginal or not.
    expect(result.discountValue).toBeCloseTo(5_932.203389830509, 10);
  });

  it("leaves no floating residue when there is no discount", () => {
    // An undiscounted royalty must equal royaltyFull exactly, or the approval
    // consistency gate rejects the row on a -1e-12 drift.
    expect(marginalResult(700_000).discountValue).toBe(0);
  });

  it("selects on gross but charges band edges on net", () => {
    const result = marginalResult(
      708_000,
      [
        { upTo: 500_000, rate: 0 },
        { upTo: 700_000, rate: 16, marginal: true },
        { upTo: null, rate: 4 },
      ],
      { tierBasis: "net" },
    );

    expect(result.netBase).toBeCloseTo(600_000, 8);
    expect(result.royalty).toBeCloseTo(16_000, 8);
    expect(result.tierRate).toBeCloseTo(2.666666666666667, 10);
  });

  it("treats the flag on the first tier as a no-op", () => {
    const result = marginalResult(300_000, [
      { upTo: 600_000, rate: 5, marginal: true },
      { upTo: null, rate: 6 },
    ]);

    expect(result.tierRate).toBeCloseTo(5, 10);
    expect(result.royalty).toBeCloseTo(12_711.864406779661, 10);
  });

  it("falls back to the flat rate on a zero base", () => {
    const result = marginalResult(0);

    expect(result.tierRate).toBe(0);
    expect(result.royalty).toBe(0);
  });
});
