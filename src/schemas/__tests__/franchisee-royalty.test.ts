import { describe, expect, it } from "vitest";

import {
  createDraft,
  createFranchiseeRoyaltyPatch,
  networkSaveErrorMessage,
  responseSaveErrorMessage,
  thresholdHint,
} from "@/components/franchisee-royalty-tier-editor";
import {
  franchiseeRoyaltyPatchSchema,
  serializeFranchiseeRoyaltyPatch,
} from "@/schemas/franchisee-royalty";

const FIXED_ZERO = [{ upTo: null, rate: 0 }] as const;
const FIXED_THREE = [{ upTo: null, rate: 3 }] as const;
const FIXED_FOUR = [{ upTo: null, rate: 4 }] as const;
const MINA_YEHUD = [
  { upTo: 700_000, rate: 0 },
  { upTo: null, rate: 5 },
] as const;
const MINA_EIN_SHEMER = [
  { upTo: 700_000, rate: 0 },
  { upTo: 1_200_000, rate: 3.5 },
  { upTo: null, rate: 4 },
] as const;
const MINA_SHARONA = [
  { upTo: 1_200_000, rate: 2.5 },
  { upTo: null, rate: 3 },
] as const;
const VINI_STANDARD = [
  { upTo: 500_000, rate: 0 },
  { upTo: 600_000, rate: 4 },
  { upTo: 700_000, rate: 4.5 },
  { upTo: null, rate: 5 },
] as const;
const VINI_CARMIEL = [
  { upTo: 550_000, rate: 0 },
  { upTo: 700_000, rate: 4 },
  { upTo: null, rate: 4.5 },
] as const;
const KING_CARMIEL = [
  { upTo: 550_000, rate: 0 },
  { upTo: 1_000_000, rate: 4.5 },
  { upTo: null, rate: 5 },
] as const;
const KING_NAHARIYA = [
  { upTo: 550_000, rate: 0 },
  { upTo: 850_000, rate: 4.5 },
  { upTo: null, rate: 5 },
] as const;
const KING_RAANANA = [
  { upTo: 700_000, rate: 0 },
  { upTo: null, rate: 5 },
] as const;
const KING_AFULA = [
  { upTo: 600_000, rate: 0 },
  { upTo: 800_000, rate: 16, marginal: true },
  { upTo: null, rate: 4.5, marginal: true },
] as const;

const KNOWN_ROYALTY_TIER_SCALES = [
  { name: "FIXED_ZERO", tiers: FIXED_ZERO },
  { name: "FIXED_THREE", tiers: FIXED_THREE },
  { name: "FIXED_FOUR", tiers: FIXED_FOUR },
  { name: "MINA_YEHUD", tiers: MINA_YEHUD },
  { name: "MINA_EIN_SHEMER", tiers: MINA_EIN_SHEMER },
  { name: "MINA_SHARONA", tiers: MINA_SHARONA },
  { name: "VINI_STANDARD", tiers: VINI_STANDARD },
  { name: "VINI_CARMIEL", tiers: VINI_CARMIEL },
  { name: "KING_CARMIEL", tiers: KING_CARMIEL },
  { name: "KING_NAHARIYA", tiers: KING_NAHARIYA },
  { name: "KING_RAANANA", tiers: KING_RAANANA },
  { name: "KING_AFULA", tiers: KING_AFULA },
] as const;

function createValidPayload() {
  return {
    royaltyTiers: [{ upTo: null, rate: 3 }],
    royaltyTierBasis: "gross",
    royaltyTiersConfirmed: false,
    royaltyIncludeTips: false,
    hashavshevetAccountKey: null,
    marketingFeeRate: 1,
  } as const;
}

describe("franchisee royalty editor round trip", () => {
  it.each(KNOWN_ROYALTY_TIER_SCALES)(
    "round-trips $name through the draft, PATCH mapping, and server parsing",
    ({ tiers }) => {
      const initialSettings = {
        royaltyTiers: tiers.map((tier) => ({ ...tier })),
        royaltyTierBasis: "gross",
        royaltyTiersConfirmed: false,
        royaltyIncludeTips: false,
        hashavshevetAccountKey: "מפתח בדיקה",
        marketingFeeRate: "1.25",
      } as const;
      const expected = {
        ...initialSettings,
        marketingFeeRate: 1.25,
        tipsAbsenceAcknowledged: false,
      };

      const draft = createDraft(initialSettings);
      const patchBody = createFranchiseeRoyaltyPatch(draft, false);
      const clientParsed = franchiseeRoyaltyPatchSchema.parse(patchBody);
      const serialized = serializeFranchiseeRoyaltyPatch(clientParsed);
      const serverParsed = franchiseeRoyaltyPatchSchema.parse(
        JSON.parse(serialized),
      );

      expect(serverParsed).toEqual(expected);
    },
  );

  it("uses the supplied VAT rate for the alternate-basis hint", () => {
    expect(thresholdHint("700000", "net", 0.17)).toContain("819,000");
    expect(thresholdHint("700000", "net", 0.18)).toContain("826,000");
  });

  it("maps validation, server, network, and timeout failures to Hebrew", () => {
    expect(responseSaveErrorMessage(400)).toContain("הנתונים");
    expect(responseSaveErrorMessage(500)).toContain("בשרת");
    expect(networkSaveErrorMessage(new TypeError("Failed to fetch"))).toContain(
      "תקשורת",
    );
    expect(
      networkSaveErrorMessage(new DOMException("Timed out", "AbortError")),
    ).toContain("בזמן");
  });
});

describe("franchisee royalty PATCH validation", () => {
  it.each([
    {
      name: "an unsorted scale",
      tiers: [
        { upTo: 700_000, rate: 3 },
        { upTo: 600_000, rate: 4 },
        { upTo: null, rate: 5 },
      ],
    },
    {
      name: "duplicate thresholds",
      tiers: [
        { upTo: 700_000, rate: 3 },
        { upTo: 700_000, rate: 4 },
        { upTo: null, rate: 5 },
      ],
    },
    {
      name: "a finite final tier",
      tiers: [
        { upTo: 700_000, rate: 3 },
        { upTo: 800_000, rate: 5 },
      ],
    },
    {
      name: "an infinite tier before the end",
      tiers: [
        { upTo: null, rate: 3 },
        { upTo: null, rate: 5 },
      ],
    },
  ])("rejects $name", ({ tiers }) => {
    const result = franchiseeRoyaltyPatchSchema.safeParse({
      ...createValidPayload(),
      royaltyTiers: tiers,
    });

    expect(result.success).toBe(false);
  });

  it.each([-0.01, 100.01])("rejects an out-of-range rate of %s", (rate) => {
    const result = franchiseeRoyaltyPatchSchema.safeParse({
      ...createValidPayload(),
      royaltyTiers: [{ upTo: null, rate }],
    });

    expect(result.success).toBe(false);
  });

  it.each([
    { field: "tier rate", tierRate: 1.235, marketingFeeRate: 1 },
    { field: "marketing rate", tierRate: 1, marketingFeeRate: 1.235 },
  ])(
    "rejects more than two decimal places in $field",
    ({ tierRate, marketingFeeRate }) => {
      const result = franchiseeRoyaltyPatchSchema.safeParse({
        ...createValidPayload(),
        royaltyTiers: [{ upTo: null, rate: tierRate }],
        marketingFeeRate,
      });

      expect(result.success).toBe(false);
    },
  );

  it.each([0, 1.2, 1.23, 100])(
    "accepts a rate representable by numeric(5,2): %s",
    (rate) => {
      const result = franchiseeRoyaltyPatchSchema.safeParse({
        ...createValidPayload(),
        royaltyTiers: [{ upTo: null, rate }],
        marketingFeeRate: rate,
      });

      expect(result.success).toBe(true);
    },
  );
});
