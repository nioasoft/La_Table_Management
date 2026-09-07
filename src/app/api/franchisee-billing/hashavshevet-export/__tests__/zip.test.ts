import AdmZip from "adm-zip";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  handleHashavshevetExport,
  type BrandExportContext,
  type ExportBillingRow,
  type HashavshevetExportOperations,
  type HashavshevetExportStore,
  type PersistExportInput,
  type StoredExportFile,
} from "@/app/api/franchisee-billing/hashavshevet-export/route";

vi.mock("@/lib/api-middleware", () => ({
  isAuthError: () => false,
  requireAdminOrSuperUser: async () => ({ user: { id: "user-1" } }),
}));

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
    royalty: "100",
    marketing: "20",
    total: "141.6",
    ...overrides,
  };
}

const BRANDS: readonly BrandExportContext[] = [
  {
    brandId: "brand-mina",
    brandCode: "MINNA_TOMEI",
    brandName: "מינה טומיי",
    rows: [billingRow()],
  },
  {
    brandId: "brand-vinni",
    brandCode: "VINNI",
    brandName: "ויני",
    rows: [billingRow({ billingId: "billing-2", franchiseeId: "f-2" })],
  },
  {
    brandId: "brand-kk",
    brandCode: "KING_KONG",
    brandName: "קינג קונג",
    rows: [billingRow({ billingId: "billing-3", franchiseeId: "f-3" })],
  },
];

class ZipHarness implements HashavshevetExportOperations {
  readonly persisted: PersistExportInput[] = [];
  readonly stored: StoredExportFile[] = [];
  readonly deleted: string[] = [];
  brands: readonly BrandExportContext[] = BRANDS;
  failOnBrandId: string | null = null;

  async readBrandContexts(): Promise<readonly BrandExportContext[]> {
    return this.brands;
  }

  async withTransaction<T>(
    work: (store: HashavshevetExportStore) => Promise<T>,
  ): Promise<T> {
    return work({
      loadBrandContextForUpdate: async (input) =>
        this.brands.find((brand) => brand.brandId === input.brandId) ?? null,
      persistExport: async (input) => {
        if (this.failOnBrandId === input.brandId) {
          throw new Error("persist blew up");
        }
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

function zipRequest(): NextRequest {
  return new NextRequest(
    "https://app.test/api/franchisee-billing/hashavshevet-export?year=2026&month=8&mode=zip",
  );
}

let harness: ZipHarness;

beforeEach(() => {
  harness = new ZipHarness();
});

describe("Hashavshevet ZIP export", () => {
  it("bundles both files for every brand under the agreed names", async () => {
    const response = await handleHashavshevetExport(zipRequest(), harness);

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/zip");
    const zip = new AdmZip(
      Buffer.from(await response.arrayBuffer()),
    );
    expect(zip.getEntries().map((entry) => entry.entryName).sort()).toEqual([
      "מינה טומאיי שיווק זכיינים.xlsx",
      "מינה טומאיי תמלוגים זכיינים.xlsx",
      "פט ויני שיווק זכיינים.xlsx",
      "פט ויני תמלוגים זכיינים.xlsx",
      "קינג קונג שיווק זכיינים.xlsx",
      "קינג קונג תמלוגים זכיינים.xlsx",
    ].sort());
    expect(harness.persisted).toHaveLength(6);
  });

  it("refuses the whole bundle when one brand is not ready", async () => {
    harness.brands = [
      ...BRANDS.slice(0, 2),
      {
        ...BRANDS[2]!,
        rows: [
          billingRow({ billingId: "billing-3", status: "draft" }),
        ],
      },
    ];

    const response = await handleHashavshevetExport(zipRequest(), harness);

    expect(response.status).toBe(409);
    // Nothing was marked exported — a partial bundle is a silent loss.
    expect(harness.persisted).toEqual([]);
    expect(harness.stored).toEqual([]);
  });

  it("cleans up every uploaded file when one export fails midway", async () => {
    harness.failOnBrandId = "brand-kk";

    const response = await handleHashavshevetExport(zipRequest(), harness);

    expect(response.status).toBe(500);
    expect(harness.deleted).toEqual(
      harness.stored.map((file) => file.url),
    );
    expect(harness.deleted.length).toBeGreaterThan(1);
  });
});
