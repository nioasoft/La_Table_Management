import type { HConnectPlugin } from "@/lib/hconnect";
import { clientCommissionInvoicesExport } from "./builders/client-commission-invoices";
import { clientCommissionsExport } from "./builders/client-commissions";
import { franchiseeClientInvoicesExport } from "./builders/franchisee-client-invoices";
import { journalEntriesExport } from "./builders/journal-entries";
import { royaltiesExport } from "./builders/royalties";
import { supplierCommissionsExport } from "./builders/supplier-commissions";
import type { BuiltRow, ExportType } from "./types";

/** The six exports sendable to Hashavshevet. */
export interface ExportDefinition {
  type: ExportType;
  plugin: HConnectPlugin;
  labelHe: string;
  build(params: unknown): Promise<{ rows: BuiltRow[]; blockingErrors: string[] }>;
}

export const EXPORTS: Record<ExportType, ExportDefinition> = {
  supplier_commissions: supplierCommissionsExport,
  royalties: royaltiesExport,
  client_commissions: clientCommissionsExport,
  franchisee_client_invoices: franchiseeClientInvoicesExport,
  journal_entries: journalEntriesExport,
  client_commission_invoices: clientCommissionInvoicesExport,
};
