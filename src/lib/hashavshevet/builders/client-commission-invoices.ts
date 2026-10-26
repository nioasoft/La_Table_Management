import {
  getCommissionInvoicesForExport,
  type CommissionInvoiceExportRow,
} from "@/data-access/commission-invoices";
import { getVatRateForDate } from "@/data-access/vatRates";

/**
 * Client commission-invoices export ("חשבוניות עמלה מלקוחות"): the row logic shared by the
 * Excel route (clients/commission-invoices/export) and the Hashavshevet API send path.
 * Queries moved out of the route verbatim; the Excel output must not change by a single number.
 */

export interface ClientCommissionInvoicesParams {
  periodMonth: number;
  periodYear: number;
  /** Restrict to one franchisee; null/absent = every franchisee. */
  franchiseeId?: string | null;
}

export interface ClientCommissionInvoicesData {
  periodMonth: number;
  periodYear: number;
  /** One row per commission_invoice document of the period (zero/negative totals already dropped). */
  rows: CommissionInvoiceExportRow[];
  /** VAT rate effective on the period's last day: all rows of the export share it. */
  vatRate: number;
}

/** All DB reads of the export. Read-only. */
export async function loadClientCommissionInvoicesData(
  params: ClientCommissionInvoicesParams
): Promise<ClientCommissionInvoicesData> {
  const { periodMonth, periodYear, franchiseeId = null } = params;
  const rows = await getCommissionInvoicesForExport(periodMonth, periodYear, franchiseeId);
  // new Date(y, m, 0) = last day of month m (1-based), from local parts.
  const vatRate = await getVatRateForDate(new Date(periodYear, periodMonth, 0));
  return { periodMonth, periodYear, rows, vatRate };
}
