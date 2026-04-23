/**
 * Data Access Layer for Commission Invoice Verification
 *
 * Compares commission invoices submitted by clients against expected commissions
 * calculated from client report totals × system commission rates.
 * Uses ₪30 threshold (same as client reconciliation).
 */

import { database } from "@/db";
import {
  clientDocument,
  clientFranchisee,
  client,
  franchisee,
} from "@/db/schema";
import { eq, and, inArray } from "drizzle-orm";

// ============================================================================
// CONSTANTS
// ============================================================================

export const COMMISSION_INVOICE_THRESHOLD = 30; // NIS

// ============================================================================
// TYPES
// ============================================================================

export type VerificationStatus =
  | "matched"
  | "mismatch"
  | "missing_invoice"
  | "missing_report";

export interface InvoiceVerificationRow {
  franchiseeId: string;
  franchiseeName: string;
  // Invoice side (from commission_invoice document)
  invoiceDocumentId: string | null;
  invoiceAmount: number | null; // pre-VAT (= totalAmount on commission_invoice doc)
  invoiceFileName: string | null;
  invoiceSource: "manual_upload" | "gmail_fetch" | null;
  invoiceNotes: string | null; // free-text review notes from clientDocument.reviewNotes
  // Client report side
  reportDocumentId: string | null;
  reportTotalAmount: number | null; // total sales from client_report
  reportCommissionAmount: number | null;
  // System config
  systemCommissionRate: number | null; // from client table (single rate; null if multiple/none)
  systemCommissionRates: number[]; // all positive rates (for display when multiple)
  expectedCommission: number | null; // reportTotalAmount × systemCommissionRate / 100
  // Computed
  difference: number | null; // invoiceAmount - expectedCommission
  verificationStatus: VerificationStatus;
}

export interface InvoiceVerificationSummaryRow {
  clientId: string;
  clientName: string;
  clientCode: string | null;
  invoiceCount: number;
  matchedCount: number;
  mismatchCount: number;
  missingInvoiceCount: number;
  missingReportCount: number;
  totalInvoiced: number;
  totalExpected: number;
}

export interface InvoiceVerificationFlatRow extends InvoiceVerificationRow {
  clientId: string;
  clientName: string;
  clientCode: string | null;
}

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Resolve the commission rate(s) (%) for a client.
 *
 * Returns:
 *   - rate: a single % to use for `expected = sales * rate / 100` when the
 *     client has exactly one positive rate. `null` if no rates or multiple.
 *   - allRates: every positive rate found, for display ("20% / 10%") and so
 *     callers can detect the mixed-rate case.
 *
 * Why not pick the first when there are multiple?
 *   Wolt (delivery 20%, takeaway 10%) used to fall back to delivery=20% which
 *   over-estimated the expected commission and produced false "mismatch"
 *   alerts. With multiple rates we cannot compute a meaningful expected
 *   without per-service-type sales splits, which the client_report doesn't
 *   provide. Skipping the calculation is more honest than guessing.
 *
 * Note: posTerminalCommission is a fixed NIS amount (not a %) and is
 * intentionally excluded.
 */
function getClientCommissionRate(clientRecord: {
  deliveryCommission: string | null;
  dineInCommission: string | null;
  takeawayCommission: string | null;
  eventsCommission: string | null;
}): { rate: number | null; allRates: number[] } {
  const rawRates = [
    clientRecord.deliveryCommission,
    clientRecord.dineInCommission,
    clientRecord.takeawayCommission,
    clientRecord.eventsCommission,
  ];

  const positive: number[] = [];
  for (const raw of rawRates) {
    if (raw === null || raw === undefined) continue;
    const parsed = parseFloat(raw);
    if (!isNaN(parsed) && parsed > 0) positive.push(parsed);
  }

  if (positive.length === 0) return { rate: null, allRates: [] };
  if (positive.length === 1) return { rate: positive[0], allRates: positive };
  // Multiple rates — cannot derive a single expected without sales breakdown
  return { rate: null, allRates: positive };
}

// ============================================================================
// QUERIES
// ============================================================================

/**
 * Get per-franchisee invoice verification rows for a specific client and period.
 */
export async function getInvoiceVerification(
  clientId: string,
  periodMonth: number,
  periodYear: number
): Promise<InvoiceVerificationRow[]> {
  // 1. Get the client with commission rates
  const [clientRecord] = await database
    .select({
      id: client.id,
      deliveryCommission: client.deliveryCommission,
      dineInCommission: client.dineInCommission,
      takeawayCommission: client.takeawayCommission,
      eventsCommission: client.eventsCommission,
    })
    .from(client)
    .where(eq(client.id, clientId))
    .limit(1);

  if (!clientRecord) return [];

  const { rate: systemRate, allRates: systemRates } =
    getClientCommissionRate(clientRecord);

  // 2. Get linked franchisees
  const links = await database
    .select({
      franchiseeId: clientFranchisee.franchiseeId,
    })
    .from(clientFranchisee)
    .where(eq(clientFranchisee.clientId, clientId));

  if (links.length === 0) return [];

  const franchiseeIds = links.map((l) => l.franchiseeId);

  // 3. Get franchisee details
  const franchisees = await database
    .select({
      id: franchisee.id,
      name: franchisee.name,
    })
    .from(franchisee)
    .where(inArray(franchisee.id, franchiseeIds));

  const franchiseeMap = new Map(franchisees.map((f) => [f.id, f.name]));

  // 4. Get commission_invoice documents for this period
  const invoiceDocs = await database
    .select({
      id: clientDocument.id,
      franchiseeId: clientDocument.franchiseeId,
      totalAmount: clientDocument.totalAmount,
      originalFileName: clientDocument.originalFileName,
      source: clientDocument.source,
      reviewNotes: clientDocument.reviewNotes,
    })
    .from(clientDocument)
    .where(
      and(
        eq(clientDocument.clientId, clientId),
        eq(clientDocument.periodMonth, periodMonth),
        eq(clientDocument.periodYear, periodYear),
        eq(clientDocument.documentType, "commission_invoice")
      )
    );

  const invoiceMap = new Map(
    invoiceDocs.map((d) => [
      d.franchiseeId,
      {
        id: d.id,
        amount: d.totalAmount ? parseFloat(d.totalAmount) : null,
        fileName: d.originalFileName,
        source: d.source,
        reviewNotes: d.reviewNotes,
      },
    ])
  );

  // 5. Get client_report documents for this period
  const reportDocs = await database
    .select({
      id: clientDocument.id,
      franchiseeId: clientDocument.franchiseeId,
      totalAmount: clientDocument.totalAmount,
      commissionAmount: clientDocument.commissionAmount,
    })
    .from(clientDocument)
    .where(
      and(
        eq(clientDocument.clientId, clientId),
        eq(clientDocument.periodMonth, periodMonth),
        eq(clientDocument.periodYear, periodYear),
        eq(clientDocument.documentType, "client_report")
      )
    );

  const reportMap = new Map(
    reportDocs.map((d) => [
      d.franchiseeId,
      {
        id: d.id,
        totalAmount: d.totalAmount ? parseFloat(d.totalAmount) : null,
        commissionAmount: d.commissionAmount
          ? parseFloat(d.commissionAmount)
          : null,
      },
    ])
  );

  // 6. Build verification rows
  const rows: InvoiceVerificationRow[] = [];

  for (const fId of franchiseeIds) {
    const name = franchiseeMap.get(fId) ?? "לא ידוע";
    const invoice = invoiceMap.get(fId);
    const report = reportMap.get(fId);

    const invoiceAmount = invoice?.amount ?? null;
    const reportTotalAmount = report?.totalAmount ?? null;
    const reportCommissionAmount = report?.commissionAmount ?? null;

    // Calculate expected commission
    const expectedCommission =
      reportTotalAmount !== null && systemRate !== null
        ? Math.round(reportTotalAmount * (systemRate / 100) * 100) / 100
        : null;

    // Determine status
    let verificationStatus: VerificationStatus;
    let difference: number | null = null;

    if (!invoice) {
      verificationStatus = "missing_invoice";
    } else if (!report) {
      verificationStatus = "missing_report";
    } else if (expectedCommission !== null && invoiceAmount !== null) {
      difference = Math.round((invoiceAmount - expectedCommission) * 100) / 100;
      verificationStatus =
        Math.abs(difference) <= COMMISSION_INVOICE_THRESHOLD
          ? "matched"
          : "mismatch";
    } else {
      verificationStatus = "missing_report";
    }

    rows.push({
      franchiseeId: fId,
      franchiseeName: name,
      invoiceDocumentId: invoice?.id ?? null,
      invoiceAmount,
      invoiceFileName: invoice?.fileName ?? null,
      invoiceSource: invoice?.source ?? null,
      invoiceNotes: invoice?.reviewNotes ?? null,
      reportDocumentId: report?.id ?? null,
      reportTotalAmount,
      reportCommissionAmount,
      systemCommissionRate: systemRate,
      systemCommissionRates: systemRates,
      expectedCommission,
      difference,
      verificationStatus,
    });
  }

  // Sort: mismatches first, then missing, then matched
  const statusOrder: Record<VerificationStatus, number> = {
    mismatch: 0,
    missing_invoice: 1,
    missing_report: 2,
    matched: 3,
  };

  rows.sort(
    (a, b) =>
      statusOrder[a.verificationStatus] - statusOrder[b.verificationStatus]
  );

  return rows;
}

/**
 * Get summary of invoice verification across all clients for a period.
 * When `franchiseeId` is provided, the summary reflects only that franchisee's
 * invoices/reports across all clients.
 *
 * Performance: runs 5 queries total (parallel), regardless of client count.
 * Previously this called getInvoiceVerification() per-client, which produced
 * ~5×N queries serially for ~N clients.
 */
export async function getInvoiceVerificationSummary(
  periodMonth: number,
  periodYear: number,
  franchiseeId?: string | null
): Promise<InvoiceVerificationSummaryRow[]> {
  // Fire all 5 queries in parallel. Each is a simple indexed SELECT.
  const [clients, links, franchisees, invoiceDocs, reportDocs] =
    await Promise.all([
      database
        .select({
          id: client.id,
          name: client.name,
          code: client.code,
          deliveryCommission: client.deliveryCommission,
          dineInCommission: client.dineInCommission,
          takeawayCommission: client.takeawayCommission,
          eventsCommission: client.eventsCommission,
        })
        .from(client)
        .where(eq(client.isActive, true)),
      database
        .select({
          clientId: clientFranchisee.clientId,
          franchiseeId: clientFranchisee.franchiseeId,
        })
        .from(clientFranchisee),
      database
        .select({
          id: franchisee.id,
          name: franchisee.name,
        })
        .from(franchisee),
      database
        .select({
          clientId: clientDocument.clientId,
          franchiseeId: clientDocument.franchiseeId,
          totalAmount: clientDocument.totalAmount,
        })
        .from(clientDocument)
        .where(
          and(
            eq(clientDocument.periodMonth, periodMonth),
            eq(clientDocument.periodYear, periodYear),
            eq(clientDocument.documentType, "commission_invoice")
          )
        ),
      database
        .select({
          clientId: clientDocument.clientId,
          franchiseeId: clientDocument.franchiseeId,
          totalAmount: clientDocument.totalAmount,
        })
        .from(clientDocument)
        .where(
          and(
            eq(clientDocument.periodMonth, periodMonth),
            eq(clientDocument.periodYear, periodYear),
            eq(clientDocument.documentType, "client_report")
          )
        ),
    ]);

  const franchiseeNameById = new Map(franchisees.map((f) => [f.id, f.name]));

  // Group links by client
  const linksByClient = new Map<string, string[]>();
  for (const link of links) {
    const list = linksByClient.get(link.clientId) ?? [];
    list.push(link.franchiseeId);
    linksByClient.set(link.clientId, list);
  }

  // Index invoice/report docs by (clientId, franchiseeId)
  const keyOf = (cId: string, fId: string) => `${cId}::${fId}`;
  const invoiceByKey = new Map<string, number>();
  for (const d of invoiceDocs) {
    if (!d.clientId || !d.franchiseeId) continue;
    invoiceByKey.set(
      keyOf(d.clientId, d.franchiseeId),
      d.totalAmount ? parseFloat(d.totalAmount) : 0
    );
  }
  const reportByKey = new Map<string, number>();
  for (const d of reportDocs) {
    if (!d.clientId || !d.franchiseeId) continue;
    reportByKey.set(
      keyOf(d.clientId, d.franchiseeId),
      d.totalAmount ? parseFloat(d.totalAmount) : 0
    );
  }

  const summaries: InvoiceVerificationSummaryRow[] = [];

  for (const c of clients) {
    const { rate: systemRate } = getClientCommissionRate(c);
    let franchiseeIds = linksByClient.get(c.id) ?? [];
    if (franchiseeId) {
      franchiseeIds = franchiseeIds.filter((id) => id === franchiseeId);
    }
    if (franchiseeIds.length === 0) continue;

    let invoiceCount = 0;
    let matchedCount = 0;
    let mismatchCount = 0;
    let missingInvoiceCount = 0;
    let missingReportCount = 0;
    let totalInvoiced = 0;
    let totalExpected = 0;

    for (const fId of franchiseeIds) {
      // Skip unknown franchisees (consistent with per-client function)
      if (!franchiseeNameById.has(fId)) continue;

      const key = keyOf(c.id, fId);
      const hasInvoice = invoiceByKey.has(key);
      const hasReport = reportByKey.has(key);
      const invoiceAmount = invoiceByKey.get(key) ?? null;
      const reportTotal = reportByKey.get(key) ?? null;

      const expected =
        reportTotal !== null && systemRate !== null
          ? Math.round(reportTotal * (systemRate / 100) * 100) / 100
          : null;

      if (hasInvoice) invoiceCount++;
      if (invoiceAmount !== null) totalInvoiced += invoiceAmount;
      if (expected !== null) totalExpected += expected;

      if (!hasInvoice) {
        missingInvoiceCount++;
      } else if (!hasReport) {
        missingReportCount++;
      } else if (expected !== null && invoiceAmount !== null) {
        const diff = Math.abs(invoiceAmount - expected);
        if (diff <= COMMISSION_INVOICE_THRESHOLD) matchedCount++;
        else mismatchCount++;
      } else {
        missingReportCount++;
      }
    }

    summaries.push({
      clientId: c.id,
      clientName: c.name,
      clientCode: c.code,
      invoiceCount,
      matchedCount,
      mismatchCount,
      missingInvoiceCount,
      missingReportCount,
      totalInvoiced: Math.round(totalInvoiced * 100) / 100,
      totalExpected: Math.round(totalExpected * 100) / 100,
    });
  }

  return summaries;
}

/**
 * Get per-franchisee invoice verification rows across ALL clients for a period.
 *
 * Same 5-queries-in-parallel pattern as getInvoiceVerificationSummary — avoids
 * the N×5 queries that would result from looping getInvoiceVerification per
 * client. Each row carries clientId/clientName/clientCode so a single flat
 * table can render the full landscape.
 *
 * Sort order: clientName → status severity (mismatch → missing → matched) →
 * franchiseeName, so problem rows float to the top within each client.
 */
export async function getInvoiceVerificationAll(
  periodMonth: number,
  periodYear: number,
  franchiseeIdFilter?: string | null
): Promise<InvoiceVerificationFlatRow[]> {
  const [clients, links, franchisees, invoiceDocs, reportDocs] =
    await Promise.all([
      database
        .select({
          id: client.id,
          name: client.name,
          code: client.code,
          deliveryCommission: client.deliveryCommission,
          dineInCommission: client.dineInCommission,
          takeawayCommission: client.takeawayCommission,
          eventsCommission: client.eventsCommission,
        })
        .from(client)
        .where(eq(client.isActive, true)),
      database
        .select({
          clientId: clientFranchisee.clientId,
          franchiseeId: clientFranchisee.franchiseeId,
        })
        .from(clientFranchisee),
      database
        .select({
          id: franchisee.id,
          name: franchisee.name,
        })
        .from(franchisee),
      database
        .select({
          id: clientDocument.id,
          clientId: clientDocument.clientId,
          franchiseeId: clientDocument.franchiseeId,
          totalAmount: clientDocument.totalAmount,
          originalFileName: clientDocument.originalFileName,
          source: clientDocument.source,
          reviewNotes: clientDocument.reviewNotes,
        })
        .from(clientDocument)
        .where(
          and(
            eq(clientDocument.periodMonth, periodMonth),
            eq(clientDocument.periodYear, periodYear),
            eq(clientDocument.documentType, "commission_invoice")
          )
        ),
      database
        .select({
          id: clientDocument.id,
          clientId: clientDocument.clientId,
          franchiseeId: clientDocument.franchiseeId,
          totalAmount: clientDocument.totalAmount,
          commissionAmount: clientDocument.commissionAmount,
        })
        .from(clientDocument)
        .where(
          and(
            eq(clientDocument.periodMonth, periodMonth),
            eq(clientDocument.periodYear, periodYear),
            eq(clientDocument.documentType, "client_report")
          )
        ),
    ]);

  const franchiseeNameById = new Map(franchisees.map((f) => [f.id, f.name]));

  const linksByClient = new Map<string, string[]>();
  for (const link of links) {
    const list = linksByClient.get(link.clientId) ?? [];
    list.push(link.franchiseeId);
    linksByClient.set(link.clientId, list);
  }

  const keyOf = (cId: string, fId: string) => `${cId}::${fId}`;

  const invoiceByKey = new Map<
    string,
    {
      id: string;
      amount: number | null;
      fileName: string | null;
      source: "manual_upload" | "gmail_fetch" | null;
      reviewNotes: string | null;
    }
  >();
  for (const d of invoiceDocs) {
    if (!d.clientId || !d.franchiseeId) continue;
    invoiceByKey.set(keyOf(d.clientId, d.franchiseeId), {
      id: d.id,
      amount: d.totalAmount ? parseFloat(d.totalAmount) : null,
      fileName: d.originalFileName,
      source: d.source as "manual_upload" | "gmail_fetch" | null,
      reviewNotes: d.reviewNotes,
    });
  }

  const reportByKey = new Map<
    string,
    { id: string; totalAmount: number | null; commissionAmount: number | null }
  >();
  for (const d of reportDocs) {
    if (!d.clientId || !d.franchiseeId) continue;
    reportByKey.set(keyOf(d.clientId, d.franchiseeId), {
      id: d.id,
      totalAmount: d.totalAmount ? parseFloat(d.totalAmount) : null,
      commissionAmount: d.commissionAmount
        ? parseFloat(d.commissionAmount)
        : null,
    });
  }

  const rows: InvoiceVerificationFlatRow[] = [];

  for (const c of clients) {
    const { rate: systemRate, allRates: systemRates } =
      getClientCommissionRate(c);
    let franchiseeIds = linksByClient.get(c.id) ?? [];
    if (franchiseeIdFilter) {
      franchiseeIds = franchiseeIds.filter((id) => id === franchiseeIdFilter);
    }
    if (franchiseeIds.length === 0) continue;

    for (const fId of franchiseeIds) {
      const name = franchiseeNameById.get(fId);
      // Skip unknown franchisees (consistent with the other queries)
      if (!name) continue;

      const key = keyOf(c.id, fId);
      const invoice = invoiceByKey.get(key);
      const report = reportByKey.get(key);

      const invoiceAmount = invoice?.amount ?? null;
      const reportTotalAmount = report?.totalAmount ?? null;
      const reportCommissionAmount = report?.commissionAmount ?? null;

      const expectedCommission =
        reportTotalAmount !== null && systemRate !== null
          ? Math.round(reportTotalAmount * (systemRate / 100) * 100) / 100
          : null;

      let verificationStatus: VerificationStatus;
      let difference: number | null = null;

      if (!invoice) {
        verificationStatus = "missing_invoice";
      } else if (!report) {
        verificationStatus = "missing_report";
      } else if (expectedCommission !== null && invoiceAmount !== null) {
        difference =
          Math.round((invoiceAmount - expectedCommission) * 100) / 100;
        verificationStatus =
          Math.abs(difference) <= COMMISSION_INVOICE_THRESHOLD
            ? "matched"
            : "mismatch";
      } else {
        verificationStatus = "missing_report";
      }

      rows.push({
        clientId: c.id,
        clientName: c.name,
        clientCode: c.code,
        franchiseeId: fId,
        franchiseeName: name,
        invoiceDocumentId: invoice?.id ?? null,
        invoiceAmount,
        invoiceFileName: invoice?.fileName ?? null,
        invoiceSource: invoice?.source ?? null,
        invoiceNotes: invoice?.reviewNotes ?? null,
        reportDocumentId: report?.id ?? null,
        reportTotalAmount,
        reportCommissionAmount,
        systemCommissionRate: systemRate,
        systemCommissionRates: systemRates,
        expectedCommission,
        difference,
        verificationStatus,
      });
    }
  }

  const statusOrder: Record<VerificationStatus, number> = {
    mismatch: 0,
    missing_invoice: 1,
    missing_report: 2,
    matched: 3,
  };

  rows.sort((a, b) => {
    const clientCmp = a.clientName.localeCompare(b.clientName, "he");
    if (clientCmp !== 0) return clientCmp;
    const statusCmp =
      statusOrder[a.verificationStatus] - statusOrder[b.verificationStatus];
    if (statusCmp !== 0) return statusCmp;
    return a.franchiseeName.localeCompare(b.franchiseeName, "he");
  });

  return rows;
}

// ============================================================================
// HASHAVSHEVET EXPORT
// ============================================================================

export interface CommissionInvoiceExportRow {
  invoiceDocumentId: string;
  invoiceNumber: string | null;
  totalAmountWithVat: number;
  periodMonth: number;
  periodYear: number;
  clientId: string;
  clientName: string;
  clientHashavshevet: {
    name: string;
    hashavshevetCode: string | null;
    hashavshevetName: string | null;
    hashavshevetByBrand: Record<string, string> | null;
  };
  franchiseeId: string;
  franchiseeName: string;
  brandId: string | null;
}

/**
 * Fetch the rows needed to build the Hashavshevet "לקוחות עמלות" export file.
 *
 * One row per uploaded commission_invoice document in the period; rows without
 * a totalAmount are skipped (nothing to book). Joins in franchisee.brandId and
 * the client's hashavshevet fields so the route handler can resolve the
 * per-brand account name via resolveClientHashavshevetAccount().
 */
export async function getCommissionInvoicesForExport(
  periodMonth: number,
  periodYear: number,
  franchiseeId: string | null
): Promise<CommissionInvoiceExportRow[]> {
  const conditions = [
    eq(clientDocument.periodMonth, periodMonth),
    eq(clientDocument.periodYear, periodYear),
    eq(clientDocument.documentType, "commission_invoice"),
  ];
  if (franchiseeId) {
    conditions.push(eq(clientDocument.franchiseeId, franchiseeId));
  }

  const results = await database
    .select({
      invoiceDocumentId: clientDocument.id,
      invoiceNumber: clientDocument.invoiceNumber,
      totalAmount: clientDocument.totalAmount,
      periodMonth: clientDocument.periodMonth,
      periodYear: clientDocument.periodYear,
      clientId: client.id,
      clientName: client.name,
      clientHashavshevetCode: client.hashavshevetCode,
      clientHashavshevetName: client.hashavshevetName,
      clientHashavshevetByBrand: client.hashavshevetByBrand,
      franchiseeId: franchisee.id,
      franchiseeName: franchisee.name,
      brandId: franchisee.brandId,
    })
    .from(clientDocument)
    .innerJoin(franchisee, eq(franchisee.id, clientDocument.franchiseeId))
    .innerJoin(client, eq(client.id, clientDocument.clientId))
    .where(and(...conditions));

  const rows: CommissionInvoiceExportRow[] = [];
  for (const r of results) {
    if (!r.totalAmount) continue;
    const total = parseFloat(r.totalAmount);
    if (!Number.isFinite(total) || total <= 0) continue;
    if (!r.clientId || !r.clientName) continue;

    rows.push({
      invoiceDocumentId: r.invoiceDocumentId,
      invoiceNumber: r.invoiceNumber,
      totalAmountWithVat: total,
      periodMonth: r.periodMonth,
      periodYear: r.periodYear,
      clientId: r.clientId,
      clientName: r.clientName,
      clientHashavshevet: {
        name: r.clientName,
        hashavshevetCode: r.clientHashavshevetCode,
        hashavshevetName: r.clientHashavshevetName,
        hashavshevetByBrand: r.clientHashavshevetByBrand ?? null,
      },
      franchiseeId: r.franchiseeId,
      franchiseeName: r.franchiseeName,
      brandId: r.brandId ?? null,
    });
  }

  // Stable order: by client name, then franchisee name.
  rows.sort((a, b) => {
    const c = a.clientName.localeCompare(b.clientName, "he");
    if (c !== 0) return c;
    return a.franchiseeName.localeCompare(b.franchiseeName, "he");
  });

  return rows;
}
