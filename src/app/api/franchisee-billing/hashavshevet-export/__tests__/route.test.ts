import fs from "node:fs";
import path from "node:path";

import { NextRequest } from "next/server";
import * as XLSX from "xlsx";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildHashavshevetExportRows,
  buildHashavshevetWorkbookBuffer,
  executeHashavshevetExport,
  handleHashavshevetExport,
  summarizeBrandCompleteness,
  type BrandExportContext,
  type ExportBillingRow,
  type HashavshevetExportOperations,
  type HashavshevetExportStore,
  type PersistExportInput,
  type StoredExportFile,
} from "@/app/api/franchisee-billing/hashavshevet-export/route";
import {
  calculateCanonicalApproval,
  canonicalStoredDecimal,
} from "@/lib/franchisee-billing-approval";
import type { RoyaltyTier } from "@/lib/royalty";
import { ROYALTY_SEED_CONFIGS } from "@/scripts/seed-royalty-config";

const { requireAdminOrSuperUser } = vi.hoisted(() => ({
  requireAdminOrSuperUser: vi.fn(async () => ({
    session: { id: "session-1" },
    user: {
      id: "admin-1",
      email: "admin@example.com",
      name: "מנהלת",
      role: "admin",
      status: "active",
      isAdmin: true,
    },
  })),
}));

vi.mock("@/lib/api-middleware", () => ({
  requireAdminOrSuperUser,
  isAuthError: vi.fn(() => false),
}));

const PERIOD = { year: 2026, month: 6 } as const;
const HEADERS = [
  "מפתח חשבון",
  "שם",
  "מפתח פריט",
  "שם פריט",
  "כמות",
  "מחיר",
  "סוג המסמך",
  "מספר מסמך",
  "פרטים",
] as const;

function billingRow(
  overrides: Partial<ExportBillingRow> = {},
): ExportBillingRow {
  return {
    billingId: "billing-1",
    franchiseeId: "franchisee-1",
    franchiseeName: "מינה טומאיי יהוד",
    accountKeySnapshot: "אושיבה",
    status: "approved",
    noRevenueReason: null,
    royalty: "48228.82838983051",
    marketing: "9645.765677966101",
    total: "68291.822400000005",
    ...overrides,
  };
}

function brandContext(
  rows: readonly ExportBillingRow[] = [billingRow()],
): BrandExportContext {
  return {
    brandId: "brand-mina",
    brandCode: "MINNA_TOMEI",
    brandName: "מינה טומאיי",
    rows,
  };
}

function workbookRows(buffer: Buffer): unknown[][] {
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new Error("Missing workbook sheet");
  return XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], {
    header: 1,
    raw: true,
    defval: "",
  });
}

interface TurnoverFixture {
  readonly brandCode: "MINNA_TOMEI" | "VINNI" | "KING_KONG";
  readonly configLabel: string;
  readonly accountKey: string;
  readonly receipts: number;
  readonly discountRatePoints?: number;
  /** Pins the scale January was actually billed under, when it has since changed. */
  readonly tiers?: readonly RoyaltyTier[];
}

const TURNOVER_FIXTURES: readonly TurnoverFixture[] = [
  { brandCode: "MINNA_TOMEI", configLabel: "מינה טומאיי יהוד", accountKey: "אושיבה", receipts: 1_138_200.35 },
  { brandCode: "MINNA_TOMEI", configLabel: "מינה טומאיי עין שמר", accountKey: "מינה עין שמר", receipts: 1_796_076.9 },
  { brandCode: "MINNA_TOMEI", configLabel: "מינה טומאיי קסטרא", accountKey: "מינה", receipts: 2_923_066 },
  { brandCode: "MINNA_TOMEI", configLabel: "מינה טומאיי קריון", accountKey: "אודון", receipts: 1_401_228.4, discountRatePoints: 1 },
  { brandCode: "MINNA_TOMEI", configLabel: "מינה טומאיי שרונה", accountKey: "מינה שרונה", receipts: 1_065_202.65 },
  { brandCode: "VINNI", configLabel: "ויני חדרה", accountKey: "ויני חדרה", receipts: 688_670, discountRatePoints: 1 },
  { brandCode: "VINNI", configLabel: "ויני יהוד", accountKey: "טמפר", receipts: 699_090.9, discountRatePoints: 1 },
  { brandCode: "VINNI", configLabel: "ויני כרמיאל", accountKey: "ויני כרמיאל", receipts: 817_806.3 },
  { brandCode: "VINNI", configLabel: "ויני נתניה", accountKey: "סידיוס", receipts: 856_659.8, discountRatePoints: 0.5 },
  { brandCode: "VINNI", configLabel: "ויני עזריאלי חיפה", accountKey: "פט ויני ע", receipts: 765_199.8 },
  { brandCode: "VINNI", configLabel: "ויני קריית אתא", accountKey: "מיאמוטו", receipts: 1_061_152 },
  { brandCode: "VINNI", configLabel: "ויני רגבה", accountKey: "ויני רגבה", receipts: 1_041_471.5 },
  { brandCode: "KING_KONG", configLabel: "קינג קונג חדרה", accountKey: "קינג ח", receipts: 1_198_391.5 },
  { brandCode: "KING_KONG", configLabel: "קינג קונג חורב", accountKey: "קינג קונג חורב", receipts: 1_565_627.65 },
  { brandCode: "KING_KONG", configLabel: "קינג קונג כרמיאל", accountKey: "קינג כרמיאל", receipts: 1_183_354.3 },
  { brandCode: "KING_KONG", configLabel: "קינג קונג נהריה", accountKey: "קינג ג", receipts: 1_445_832 },
  // Afula moved to a marginal scale after January; the client's workbook for
  // that month was billed flat 4.5%, so parity is checked against that scale.
  { brandCode: "KING_KONG", configLabel: "קינג קונג עפולה", accountKey: "קינג עפולה", receipts: 1_124_856.89, tiers: [{ upTo: null, rate: 4.5 }] },
  { brandCode: "KING_KONG", configLabel: "קינג קונג ביג קריות", accountKey: "קינג ב", receipts: 1_784_683 },
  { brandCode: "KING_KONG", configLabel: "קינג קונג רעננה", accountKey: "ק.ק מסעדה", receipts: 1_737_658.75 },
] as const;

function calculatedBillingRow(
  fixture: TurnoverFixture,
  index: number,
): ExportBillingRow {
  const config = ROYALTY_SEED_CONFIGS.find(
    (candidate) => candidate.label === fixture.configLabel,
  );
  if (!config?.royaltyTiers) {
    throw new Error(`Missing royalty configuration for ${fixture.configLabel}`);
  }
  const calculated = calculateCanonicalApproval({
    receipts: String(fixture.receipts),
    tips: "0",
    includeTips: false,
    discountRatePoints: String(fixture.discountRatePoints ?? 0),
    grossBase: "0",
    netBase: "0",
    tierRate: "0",
    effectiveRate: "0",
    royaltyFull: "0",
    royalty: "0",
    discountValue: "0",
    marketing: "0",
    subtotal: "0",
    total: "0",
  }, {
    tiers: fixture.tiers ?? config.royaltyTiers,
    tierBasis: "gross",
    marketingRate: Number(config.marketingFeeRate),
    vat: 0.18,
  });
  return billingRow({
    billingId: `billing-${index}`,
    franchiseeId: `franchisee-${index}`,
    franchiseeName: fixture.configLabel,
    accountKeySnapshot: fixture.accountKey,
    royalty: calculated.royalty,
    marketing: calculated.marketing,
    total: calculated.total,
  });
}

function expectedDocumentNumber(
  fileName: string,
  sourceRow: readonly unknown[],
): string {
  const accountKey = String(sourceRow[0]);
  const sourceNumber = Number(sourceRow[7]);
  if (fileName === "מינה טומאיי שיווק זכיינים.xlsx" && accountKey !== "אושיבה") {
    return String(sourceNumber + 1);
  }
  if (fileName.startsWith("קינג קונג") && sourceNumber > 5006) {
    return String(sourceNumber - 1);
  }
  return String(sourceRow[7]);
}

function normalizedComparisonRows(rows: readonly unknown[][]): unknown[][] {
  return rows.map((row, index) =>
    index === 0
      ? row
      : row.map((value, column) =>
          column === 5
            ? canonicalStoredDecimal(Number(value), 6)
            : value,
        ),
  );
}

class ExportHarness implements HashavshevetExportOperations {
  readonly persisted: PersistExportInput[] = [];
  readonly stored: StoredExportFile[] = [];
  readonly deleted: string[] = [];
  context = brandContext();
  persistError: Error | null = null;

  async readBrandContexts(): Promise<readonly BrandExportContext[]> {
    return [this.context];
  }

  async withTransaction<T>(
    work: (store: HashavshevetExportStore) => Promise<T>,
  ): Promise<T> {
    return work({
      loadBrandContextForUpdate: async () => this.context,
      persistExport: async (input) => {
        if (this.persistError) throw this.persistError;
        this.persisted.push(input);
      },
    });
  }

  async storeFile(input: {
    readonly pathname: string;
    readonly buffer: Buffer;
  }): Promise<StoredExportFile> {
    const stored = {
      url: `https://blob.example/${input.pathname}`,
      pathname: input.pathname,
    };
    this.stored.push(stored);
    return stored;
  }

  async deleteFile(url: string): Promise<void> {
    this.deleted.push(url);
  }
}

describe("Hashavshevet workbook", () => {
  it("preserves the exact nine columns, string document type and unrounded price", () => {
    const rows = buildHashavshevetExportRows(
      brandContext(),
      "royalty",
    );
    const buffer = buildHashavshevetWorkbookBuffer(rows);
    const parsed = workbookRows(buffer);

    expect(parsed).toEqual([
      [...HEADERS],
      [
        "אושיבה",
        "",
        "הכנסותת",
        "",
        1,
        48228.82838983051,
        "11",
        "5000",
        "",
      ],
    ]);
    const workbook = XLSX.read(buffer, { type: "buffer" });
    expect(workbook.Workbook?.Names).toContainEqual({
      Name: "חוזים",
      Ref: "'ייבוא חשבשבת'!$A$1:$I$2",
    });
  });

  it("filters zero rows before numbering and restarts at 5000", () => {
    const context = brandContext([
      billingRow({
        billingId: "billing-3",
        franchiseeId: "franchisee-3",
        franchiseeName: "קינג קונג רעננה",
        accountKeySnapshot: "ק.ק מסעדה",
        royalty: "73629.60805084747",
      }),
      billingRow({
        billingId: "billing-zero",
        franchiseeId: "franchisee-zero",
        franchiseeName: "קינג קונג מוצקין",
        accountKeySnapshot: "קינג מ",
        royalty: "0",
      }),
      billingRow({
        billingId: "billing-2",
        franchiseeId: "franchisee-2",
        franchiseeName: "קינג קונג חדרה",
        accountKeySnapshot: "קינג ח",
        royalty: "30467.58050847457",
      }),
    ]);

    expect(buildHashavshevetExportRows(context, "royalty")).toEqual([
      expect.objectContaining({
        accountKey: "קינג ח",
        documentNumber: "5000",
      }),
      expect.objectContaining({
        accountKey: "ק.ק מסעדה",
        documentNumber: "5001",
      }),
    ]);
  });

  it.each([
    ["מינה טומאיי תמלוגים זכיינים.xlsx", "royalty", "MINNA_TOMEI"],
    ["מינה טומאיי שיווק זכיינים.xlsx", "marketing", "MINNA_TOMEI"],
    ["פט ויני תמלוגים זכיינים.xlsx", "royalty", "VINNI"],
    ["פט ויני שיווק זכיינים.xlsx", "marketing", "VINNI"],
    ["קינג קונג תמלוגים זכיינים.xlsx", "royalty", "KING_KONG"],
    ["קינג קונג שיווק זכיינים.xlsx", "marketing", "KING_KONG"],
  ] as const)(
    "matches calculated turnover rows to six stored decimals: %s",
    (fileName, itemType, brandCode) => {
      const sourcePath = path.join(
        process.cwd(),
        "raw_data",
        "תמלוגים זכיינים",
        "חשבשבת",
        fileName,
      );
      const sourceRows = workbookRows(fs.readFileSync(sourcePath));
      const dataRows = sourceRows
        .slice(1)
        .filter((row) => Number(row[5]) !== 0 && String(row[0]).trim());
      const rows = TURNOVER_FIXTURES
        .filter((fixture) => fixture.brandCode === brandCode)
        .map(calculatedBillingRow)
        .reverse();
      const generated = workbookRows(
        buildHashavshevetWorkbookBuffer(
          buildHashavshevetExportRows(
            {
              ...brandContext(rows),
              brandCode,
            },
            itemType,
          ),
        ),
      );
      const normalizedSource = [
        [...HEADERS],
        ...dataRows.map((row) => [
          row[0],
          "",
          itemType === "royalty" ? "הכנסותת" : "שיווק",
          "",
          1,
          row[5],
          "11",
          expectedDocumentNumber(fileName, row),
          "",
        ]),
      ];

      // PostgreSQL numeric(16,6) canonicalizes calculated values to six
      // decimals. This comparison intentionally checks that exact stored
      // precision; the client workbooks carry more digits than the schema can.
      expect(normalizedComparisonRows(generated)).toEqual(
        normalizedComparisonRows(normalizedSource),
      );
    },
  );
});

describe("completeness gate", () => {
  it("reports the exact missing franchisees and the approved ratio", () => {
    const summary = summarizeBrandCompleteness(
      brandContext([
        billingRow(),
        billingRow({
          billingId: null,
          franchiseeId: "franchisee-2",
          franchiseeName: "מינה טומאיי קריון",
          accountKeySnapshot: null,
          status: null,
          royalty: null,
          marketing: null,
        }),
        billingRow({
          billingId: "billing-3",
          franchiseeId: "franchisee-3",
          franchiseeName: "מינה טומאיי שרונה",
          status: "draft",
          noRevenueReason: "הסניף היה סגור",
          royalty: "0",
          marketing: "0",
          total: "0",
        }),
      ]),
    );

    expect(summary).toMatchObject({
      readyCount: 2,
      totalActive: 3,
      canExport: false,
      missing: [
        {
          franchiseeId: "franchisee-2",
          franchiseeName: "מינה טומאיי קריון",
        },
      ],
    });
  });

  it("does not accept a no-revenue reason when any stored amount is positive", () => {
    const summary = summarizeBrandCompleteness(
      brandContext([
        billingRow({
          status: "draft",
          noRevenueReason: "הסניף היה סגור",
        }),
      ]),
    );

    expect(summary).toMatchObject({
      readyCount: 0,
      totalActive: 1,
      canExport: false,
      missing: [{
        franchiseeId: "franchisee-1",
        franchiseeName: "מינה טומאיי יהוד",
      }],
    });
  });
});

describe("export execution", () => {
  it("stores the file and writes only the royalty export pair", async () => {
    const harness = new ExportHarness();

    const result = await executeHashavshevetExport(
      { ...PERIOD, brandId: "brand-mina", itemType: "royalty" },
      "admin-1",
      harness,
    );

    expect(result.rowCount).toBe(1);
    expect(harness.persisted).toHaveLength(1);
    expect(harness.persisted[0]).toMatchObject({
      itemType: "royalty",
      billingIds: ["billing-1"],
      exportedBy: "admin-1",
      blobUrl: harness.stored[0]?.url,
    });
    expect(harness.persisted[0]).not.toHaveProperty("marketingExportedAt");
  });

  it("blocks storage and writes when even one active franchisee is missing", async () => {
    const harness = new ExportHarness();
    harness.context = brandContext([
      billingRow(),
      billingRow({
        billingId: null,
        franchiseeId: "missing",
        franchiseeName: "מינה טומאיי קריון",
        accountKeySnapshot: null,
        status: null,
        royalty: null,
        marketing: null,
      }),
    ]);

    await expect(
      executeHashavshevetExport(
        { ...PERIOD, brandId: "brand-mina", itemType: "marketing" },
        "admin-1",
        harness,
      ),
    ).rejects.toMatchObject({
      code: "incomplete",
      message: expect.stringContaining("מינה טומאיי קריון"),
    });
    expect(harness.stored).toHaveLength(0);
    expect(harness.persisted).toHaveLength(0);
  });

  it("deletes an uploaded blob when the database transaction fails", async () => {
    const harness = new ExportHarness();
    harness.persistError = new Error("database unavailable");

    await expect(
      executeHashavshevetExport(
        { ...PERIOD, brandId: "brand-mina", itemType: "marketing" },
        "admin-1",
        harness,
      ),
    ).rejects.toThrow("database unavailable");
    expect(harness.deleted).toEqual([harness.stored[0]?.url]);
  });
});

describe("GET /api/franchisee-billing/hashavshevet-export", () => {
  beforeEach(() => requireAdminOrSuperUser.mockClear());

  it("returns all brand completeness summaries in status mode", async () => {
    const harness = new ExportHarness();
    const response = await handleHashavshevetExport(
      new NextRequest(
        "http://localhost/api/franchisee-billing/hashavshevet-export?mode=status&year=2026&month=6",
      ),
      harness,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      data: {
        brands: [{
          brandId: "brand-mina",
          readyCount: 1,
          totalActive: 1,
          canExport: true,
        }],
      },
    });
  });

  it("rejects unsupported item types before calling operations", async () => {
    const harness = new ExportHarness();
    const readSpy = vi.spyOn(harness, "readBrandContexts");
    const response = await handleHashavshevetExport(
      new NextRequest(
        "http://localhost/api/franchisee-billing/hashavshevet-export?year=2026&month=6&brandId=brand-mina&itemType=other",
      ),
      harness,
    );

    expect(response.status).toBe(400);
    expect(readSpy).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      error: expect.stringContaining("סוג"),
    });
  });
});
