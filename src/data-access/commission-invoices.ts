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
  // Client report side
  reportDocumentId: string | null;
  reportTotalAmount: number | null; // total sales from client_report
  reportCommissionAmount: number | null;
  // System config
  systemCommissionRate: number | null; // from client table (first non-null rate)
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

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Get the primary commission rate (%) for a client.
 * Returns the first non-null rate from: delivery, dineIn, takeaway, events.
 * Note: posTerminalCommission is a fixed NIS amount, not a % rate, so it is
 * intentionally excluded from this rate-picker.
 */
function getClientCommissionRate(clientRecord: {
  deliveryCommission: string | null;
  dineInCommission: string | null;
  takeawayCommission: string | null;
  eventsCommission: string | null;
}): number | null {
  const rates = [
    clientRecord.deliveryCommission,
    clientRecord.dineInCommission,
    clientRecord.takeawayCommission,
    clientRecord.eventsCommission,
  ];

  for (const rate of rates) {
    if (rate !== null && rate !== undefined) {
      const parsed = parseFloat(rate);
      if (!isNaN(parsed) && parsed > 0) return parsed;
    }
  }

  return null;
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

  const systemRate = getClientCommissionRate(clientRecord);

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
      reportDocumentId: report?.id ?? null,
      reportTotalAmount,
      reportCommissionAmount,
      systemCommissionRate: systemRate,
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
 */
export async function getInvoiceVerificationSummary(
  periodMonth: number,
  periodYear: number,
  franchiseeId?: string | null
): Promise<InvoiceVerificationSummaryRow[]> {
  // Get all active clients
  const clients = await database
    .select({
      id: client.id,
      name: client.name,
      code: client.code,
    })
    .from(client)
    .where(eq(client.isActive, true));

  const summaries: InvoiceVerificationSummaryRow[] = [];

  for (const c of clients) {
    let rows = await getInvoiceVerification(c.id, periodMonth, periodYear);

    if (franchiseeId) {
      rows = rows.filter((r) => r.franchiseeId === franchiseeId);
    }

    // Skip clients with no linked franchisees
    if (rows.length === 0) continue;

    const invoiceCount = rows.filter(
      (r) => r.invoiceDocumentId !== null
    ).length;
    const matchedCount = rows.filter(
      (r) => r.verificationStatus === "matched"
    ).length;
    const mismatchCount = rows.filter(
      (r) => r.verificationStatus === "mismatch"
    ).length;
    const missingInvoiceCount = rows.filter(
      (r) => r.verificationStatus === "missing_invoice"
    ).length;
    const missingReportCount = rows.filter(
      (r) => r.verificationStatus === "missing_report"
    ).length;
    const totalInvoiced = rows.reduce(
      (sum, r) => sum + (r.invoiceAmount ?? 0),
      0
    );
    const totalExpected = rows.reduce(
      (sum, r) => sum + (r.expectedCommission ?? 0),
      0
    );

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
