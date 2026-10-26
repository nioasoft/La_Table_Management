import type { HConnectPlugin } from "@/lib/hconnect";
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
  supplier_commissions: def("supplier_commissions", "imovein"),
  royalties: def("royalties", "imovein"),
  client_commissions: def("client_commissions", "imovein"),
  franchisee_client_invoices: def("franchisee_client_invoices", "imovein"),
  journal_entries: def("journal_entries", "movein"),
  client_commission_invoices: def("client_commission_invoices", "movein"),
};
