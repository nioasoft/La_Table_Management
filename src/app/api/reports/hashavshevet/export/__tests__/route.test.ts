import AdmZip from "adm-zip";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as XLSX from "xlsx";

import type { SupplierFileProcessingResult } from "@/db/schema";
import {
  loadSupplierCommissionsData,
  type SupplierCommissionFile,
  type SupplierCommissionFranchisee,
  type SupplierCommissionsData,
  type SupplierCommissionsParams,
} from "@/lib/hashavshevet/builders/supplier-commissions";
import { GET } from "../route";

/**
 * Characterization of the supplier-commissions Excel export. The DB is mocked at
 * loadSupplierCommissionsData; everything after the load (gates, aggregation,
 * numbering, workbook, zip) runs for real. Expected values pin what the route
 * produced before the row builder was extracted.
 */

vi.mock("@/lib/api-middleware", () => ({
  isAuthError: () => false,
  requireAdminOrSuperUser: async () => ({ user: { id: "user-1" } }),
}));
vi.mock("@/db", () => ({ database: {} }));
vi.mock("@/lib/hashavshevet/builders/supplier-commissions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/hashavshevet/builders/supplier-commissions")>()),
  loadSupplierCommissionsData: vi.fn(),
}));

type Match = SupplierFileProcessingResult["franchiseeMatches"][number];

function match(franchiseeId: string, netAmount: number, over: Partial<Match> = {}): Match {
  return {
    originalName: franchiseeId,
    rowNumber: 1,
    grossAmount: netAmount,
    netAmount,
    matchedFranchiseeId: franchiseeId,
    matchedFranchiseeName: franchiseeId,
    confidence: 1,
    matchType: "exact",
    requiresReview: false,
    ...over,
  };
}

const SEP = { periodStartDate: "2026-09-01", periodEndDate: "2026-09-30" };

function file(
  over: Partial<SupplierCommissionFile> & { matches: Match[] },
): SupplierCommissionFile {
  const { matches, ...rest } = over;
  return {
    fileId: "file-1",
    supplierId: "s-tnuva",
    supplierName: "תנובה",
    supplierCode: "TNUVA",
    hashavshevetCode: "60001",
    commissionRate: "10",
    commissionType: "percentage",
    settlementFrequency: "monthly",
    processingResult: { franchiseeMatches: matches } as SupplierFileProcessingResult,
    ...SEP,
    ...rest,
  };
}

const FRANCHISEES: SupplierCommissionFranchisee[] = [
  { id: "f-hadera", name: "ויני חדרה", brandId: "b-vini", hashavshevetItemKey: null },
  { id: "f-karmiel", name: "ויני כרמיאל", brandId: "b-vini", hashavshevetItemKey: "ויני כ" },
  { id: "f-sarona", name: "מינה שרונה", brandId: "b-mina", hashavshevetItemKey: null },
  { id: "f-other", name: "דון פדרו", brandId: "b-misc", hashavshevetItemKey: null },
];
// Brands carry only what the Excel needs.
const BRANDS = [
  { id: "b-vini", nameHe: "פט ויני" },
  { id: "b-mina", nameHe: "מינה טומאיי" },
  { id: "b-misc", nameHe: "שונות" },
];

/** Every (supplier, franchisee, period) in the files, i.e. "everything approved". */
function allKeys(files: SupplierCommissionFile[]): Set<string> {
  const keys = new Set<string>();
  for (const f of files) {
    for (const m of f.processingResult?.franchiseeMatches ?? []) {
      keys.add(`${f.supplierId}|${m.matchedFranchiseeId}|${f.periodStartDate}|${f.periodEndDate}`);
    }
  }
  return keys;
}

const load = vi.mocked(loadSupplierCommissionsData);

function givenData(files: SupplierCommissionFile[], approvedKeys = allKeys(files)): void {
  load.mockImplementation(async (params: SupplierCommissionsParams) =>
    ({ ...params, files, franchisees: FRANCHISEES, brands: BRANDS, approvedKeys }) as SupplierCommissionsData,
  );
}

function request(query: Record<string, string>): NextRequest {
  const qs = new URLSearchParams({ startDate: "2026-09-01", endDate: "2026-09-30", ...query });
  return new NextRequest(`http://localhost/api/reports/hashavshevet/export?${qs}`);
}

async function body(response: Response): Promise<Buffer> {
  return Buffer.from(await response.arrayBuffer());
}

function sheetRows(buffer: Buffer): unknown[][] {
  const wb = XLSX.read(buffer);
  expect(wb.SheetNames).toEqual(["ייבוא חשבשבת"]);
  return XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets["ייבוא חשבשבת"], { header: 1 });
}

function namedRange(buffer: Buffer): string | undefined {
  return XLSX.read(buffer).Workbook?.Names?.find((n) => n.Name === "חוזים")?.Ref;
}

function zipEntries(buffer: Buffer): Map<string, Buffer> {
  return new Map(new AdmZip(buffer).getEntries().map((e) => [e.entryName, e.getData()]));
}

function filenameOf(response: Response): string {
  const header = response.headers.get("Content-Disposition") ?? "";
  return decodeURIComponent(header.replace("attachment; filename*=UTF-8''", ""));
}

const HEADER = ["מפתח חשבון", "שם", "מפתח פריט", "שם פריט", "כמות", "מחיר", "סוג המסמך", "מספר מסמך"];

beforeEach(() => {
  load.mockReset();
});

describe("GET /api/reports/hashavshevet/export", () => {
  it("rejects a request without a period", async () => {
    const response = await GET(new NextRequest("http://localhost/api/reports/hashavshevet/export"));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "חובה לבחור תקופה (תאריך התחלה וסיום)" });
    expect(load).not.toHaveBeenCalled();
  });

  it("passes the parsed query to the loader", async () => {
    givenData([]);
    await GET(
      request({ brandIds: "b-vini,,b-mina", supplierIds: "s-1", startDocNumber: "7001", onlyApproved: "false" }),
    );
    expect(load).toHaveBeenCalledWith({
      startDate: "2026-09-01",
      endDate: "2026-09-30",
      brandIds: ["b-vini", "b-mina"],
      supplierIds: ["s-1"],
      startDocNumber: 7001,
      onlyApproved: false,
    });
    await GET(request({}));
    expect(load).toHaveBeenLastCalledWith(
      expect.objectContaining({ brandIds: [], supplierIds: [], startDocNumber: 5001, onlyApproved: true }),
    );
  });

  it("aggregates per supplier x franchisee x period, rounds per match, numbers after aggregation", async () => {
    givenData([
      file({
        matches: [
          match("f-hadera", 1004), // 100.4 -> 100
          match("f-karmiel", 333), // 33.3 -> 33, item key override
          match("f-hadera", 1004), // aggregated: 200, not round(200.8) = 201
          match("f-sarona", 500), // other brand: filtered out by brandIds
          match("f-hadera", 0, { matchType: "blacklisted" }),
          match("f-hadera", 900, { matchType: "none" }),
          match("f-unknown", 900),
          match("f-hadera", 4), // 0.4 -> 0: dropped, adds nothing
        ],
      }),
      // Same supplier/franchisee, two half-month periods: two rows.
      file({
        fileId: "file-2",
        supplierId: "s-sheri",
        supplierName: "שרי שוקו",
        supplierCode: "SHERI",
        hashavshevetCode: "60002",
        commissionRate: "5",
        settlementFrequency: "bi_weekly",
        periodStartDate: "2026-09-01",
        periodEndDate: "2026-09-15",
        matches: [match("f-hadera", 1010)], // 50.5 -> 51
      }),
      file({
        fileId: "file-3",
        supplierId: "s-sheri",
        supplierName: "שרי שוקו",
        supplierCode: "SHERI",
        hashavshevetCode: "60002",
        commissionRate: "5",
        settlementFrequency: "bi_weekly",
        periodStartDate: "2026-09-16",
        periodEndDate: "2026-09-30",
        matches: [match("f-hadera", 2000)],
      }),
      file({ fileId: "file-4", processingResult: null, matches: [] }),
    ]);

    const response = await GET(request({ brandIds: "b-vini", startDocNumber: "7001" }));

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    expect(filenameOf(response)).toBe("עמלות רשת פט ויני.xlsx");
    const buffer = await body(response);
    expect(sheetRows(buffer)).toEqual([
      HEADER,
      ["60001", "", "עמלות ויני חדרה", "", 1, 200, 11, "7001"],
      ["60001", "", "ויני כ", "", 1, 33, 11, "7002"],
      ["60002", "", "עמלות ויני חדרה", "", 1, 51, 11, "7003"],
      ["60002", "", "עמלות ויני חדרה", "", 1, 100, 11, "7004"],
    ]);
    expect(namedRange(buffer)).toBe("'ייבוא חשבשבת'!$A$1:$H$5");
  });

  it("formats quantity, price and document type as numbers", async () => {
    givenData([file({ matches: [match("f-hadera", 12345)] })]);
    const buffer = await body(await GET(request({ brandIds: "b-vini" })));
    const ws = XLSX.read(buffer, { cellNF: true }).Sheets["ייבוא חשבשבת"];
    expect([ws.E2.t, ws.E2.z]).toEqual(["n", "0"]);
    expect([ws.F2.t, ws.F2.z, ws.F2.v]).toEqual(["n", "#,##0.00", 1235]);
    expect([ws.G2.t, ws.G2.z]).toEqual(["n", "0"]);
    expect([ws.A2.t, ws.H2.t, ws.H2.v]).toEqual(["s", "s", "5001"]);
  });

  it("uses the file commission as is for file-commission suppliers, and the rate otherwise", async () => {
    givenData([
      file({
        supplierId: "s-nes",
        supplierName: "נספרסו",
        supplierCode: "NESPRESSO",
        hashavshevetCode: "60003",
        matches: [
          match("f-hadera", 1000, { preCalculatedCommission: 12.5 }), // 13
          match("f-karmiel", 1000, { preCalculatedCommission: 0 }), // 0 = no commission
        ],
      }),
      file({
        fileId: "file-2",
        supplierName: "תנובה",
        commissionType: "per_item",
        commissionRate: "7.6",
        matches: [
          match("f-hadera", 1000, { preCalculatedCommission: 0 }), // ignored: per_item 7.6 -> 8
          match("f-karmiel", 1000, { preCalculatedCommission: 41.5 }), // 42
        ],
      }),
    ]);
    const buffer = await body(await GET(request({ brandIds: "b-vini" })));
    expect(sheetRows(buffer).slice(1)).toEqual([
      ["60003", "", "עמלות ויני חדרה", "", 1, 13, 11, "5001"],
      ["60001", "", "עמלות ויני חדרה", "", 1, 8, 11, "5002"],
      ["60001", "", "ויני כ", "", 1, 42, 11, "5003"],
    ]);
  });

  it("frequency gate: a multi-month run keeps quarterly files and only last-month monthly files", async () => {
    const quarterly = file({
      fileId: "file-q",
      supplierId: "s-q",
      supplierName: "רבעוני",
      hashavshevetCode: "60009",
      settlementFrequency: "quarterly",
      periodStartDate: "2026-07-01",
      periodEndDate: "2026-09-30",
      matches: [match("f-hadera", 3000)],
    });
    givenData([
      quarterly,
      file({ fileId: "jul", periodStartDate: "2026-07-01", periodEndDate: "2026-07-31", matches: [match("f-hadera", 1000)] }),
      file({ fileId: "sep", matches: [match("f-hadera", 2000)] }),
      file({ fileId: "null-freq", settlementFrequency: null, periodStartDate: "2026-08-01", periodEndDate: "2026-08-31", matches: [match("f-hadera", 5000)] }),
    ]);
    const quarter = await GET(request({ brandIds: "b-vini", startDate: "2026-07-01", endDate: "2026-09-30" }));
    expect(sheetRows(await body(quarter)).slice(1)).toEqual([
      ["60009", "", "עמלות ויני חדרה", "", 1, 300, 11, "5001"],
      ["60001", "", "עמלות ויני חדרה", "", 1, 200, 11, "5002"],
    ]);

    givenData([quarterly, file({ fileId: "sep", matches: [match("f-hadera", 2000)] })]);
    const month = await GET(request({ brandIds: "b-vini" }));
    expect(sheetRows(await body(month)).slice(1)).toEqual([
      ["60001", "", "עמלות ויני חדרה", "", 1, 200, 11, "5001"],
    ]);
  });

  it("onlyApproved (default on) drops rows without an approved comparison; off keeps them", async () => {
    const files = [file({ matches: [match("f-hadera", 1000), match("f-karmiel", 2000)] })];
    givenData(files, new Set(["s-tnuva|f-karmiel|2026-09-01|2026-09-30"]));
    const approved = await GET(request({ brandIds: "b-vini" }));
    expect(sheetRows(await body(approved)).slice(1)).toEqual([
      ["60001", "", "ויני כ", "", 1, 200, 11, "5001"],
    ]);

    givenData(files, new Set());
    const all = await GET(request({ brandIds: "b-vini", onlyApproved: "false" }));
    expect(sheetRows(await body(all)).slice(1)).toEqual([
      ["60001", "", "עמלות ויני חדרה", "", 1, 100, 11, "5001"],
      ["60001", "", "ויני כ", "", 1, 200, 11, "5002"],
    ]);
  });

  it("blocks the export when a supplier with commissions has no hashavshevet code", async () => {
    givenData([
      file({ matches: [match("f-hadera", 1000)] }),
      file({ fileId: "file-2", supplierId: "s-z", supplierName: "תפוזינה", supplierCode: "TAPUZ", hashavshevetCode: null, matches: [match("f-hadera", 1000), match("f-karmiel", 50)] }),
      file({ fileId: "file-3", supplierId: "s-a", supplierName: "אסם", supplierCode: "OSEM", hashavshevetCode: "", matches: [match("f-sarona", 1000)] }),
      // No commission (rounds to 0) -> not reported.
      file({ fileId: "file-4", supplierId: "s-b", supplierName: "בלי עמלה", supplierCode: "NONE", hashavshevetCode: null, matches: [match("f-hadera", 1)] }),
    ]);
    const response = await GET(request({}));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "לא ניתן לייצא — יש ספקים ללא כרטיס חשבשבת",
      missingSuppliers: [
        { id: "s-a", name: "אסם", code: "OSEM" },
        { id: "s-z", name: "תפוזינה", code: "TAPUZ" },
      ],
    });
  });

  it("answers 400 when nothing is left to export", async () => {
    givenData([file({ matches: [match("f-sarona", 1000)] })]);
    const response = await GET(request({ brandIds: "b-vini" }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "אין נתונים לייצוא" });
  });

  it("all networks: one xlsx per brand in a zip, each numbered from startDocNumber", async () => {
    givenData([
      file({ matches: [match("f-hadera", 1000), match("f-sarona", 2000), match("f-karmiel", 3000), match("f-other", 4000)] }),
    ]);
    const response = await GET(request({ startDocNumber: "9001" }));
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/zip");
    expect(filenameOf(response)).toBe("עמלות לפי רשת.zip");

    const entries = zipEntries(await body(response));
    // AdmZip orders entries itself; the set of files is what the route decides.
    expect([...entries.keys()].sort()).toEqual(
      ["עמלות רשת פט ויני.xlsx", "עמלות רשת מינה טומאיי.xlsx", "עמלות שונות.xlsx"].sort(),
    );
    const vini = entries.get("עמלות רשת פט ויני.xlsx")!;
    expect(sheetRows(vini)).toEqual([
      HEADER,
      ["60001", "", "עמלות ויני חדרה", "", 1, 100, 11, "9001"],
      ["60001", "", "ויני כ", "", 1, 300, 11, "9002"],
    ]);
    expect(namedRange(vini)).toBe("'ייבוא חשבשבת'!$A$1:$H$3");
    expect(sheetRows(entries.get("עמלות רשת מינה טומאיי.xlsx")!).slice(1)).toEqual([
      ["60001", "", "עמלות מינה שרונה", "", 1, 200, 11, "9001"],
    ]);
    expect(sheetRows(entries.get("עמלות שונות.xlsx")!).slice(1)).toEqual([
      ["60001", "", "עמלות דון פדרו", "", 1, 400, 11, "9001"],
    ]);
  });

  it("several explicit brands: one xlsx numbered straight through", async () => {
    givenData([file({ matches: [match("f-hadera", 1000), match("f-sarona", 2000), match("f-karmiel", 3000)] })]);
    const response = await GET(request({ brandIds: "b-vini,b-mina" }));
    expect(filenameOf(response)).toBe("עמלות כל הרשתות.xlsx");
    expect(sheetRows(await body(response)).slice(1)).toEqual([
      ["60001", "", "עמלות ויני חדרה", "", 1, 100, 11, "5001"],
      ["60001", "", "עמלות מינה שרונה", "", 1, 200, 11, "5002"],
      ["60001", "", "ויני כ", "", 1, 300, 11, "5003"],
    ]);
  });

  it("answers a generic 500 when the load fails", async () => {
    load.mockRejectedValue(new Error("db down"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await GET(request({}));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "שגיאה בייצוא הקובץ" });
    spy.mockRestore();
  });
});
