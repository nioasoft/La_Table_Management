import type { HConnectPlugin } from "@/lib/hconnect";
import { clientCommissionsExport } from "./builders/client-commissions";
import { royaltiesExport } from "./builders/royalties";
import { supplierCommissionsExport } from "./builders/supplier-commissions";
import { exportLabels } from "./copy";
import type { BuiltRow, ExportType } from "./types";

/** The six exports sendable to Hashavshevet. `build` is filled in by the builder tasks. */
export interface ExportDefinition {
  type: ExportType;
  plugin: HConnectPlugin;
  labelHe: string;
  build(params: unknown): Promise<{ rows: BuiltRow[]; blockingErrors: string[] }>;
}

async function notMigrated(): Promise<never> {
  throw new Error("not migrated");
}

function def(type: ExportType, plugin: HConnectPlugin): ExportDefinition {
  return { type, plugin, labelHe: exportLabels[type], build: notMigrated };
}

export const EXPORTS: Record<ExportType, ExportDefinition> = {
  supplier_commissions: supplierCommissionsExport,
  royalties: royaltiesExport,
  client_commissions: clientCommissionsExport,
  franchisee_client_invoices: def("franchisee_client_invoices", "imovein"),
  journal_entries: def("journal_entries", "movein"),
  client_commission_invoices: def("client_commission_invoices", "movein"),
};
