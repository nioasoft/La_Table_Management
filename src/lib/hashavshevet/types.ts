/** Shared types for the Hashavshevet API send feature. */

export type ExportType =
  | "supplier_commissions"
  | "royalties"
  | "client_commissions"
  | "franchisee_client_invoices"
  | "journal_entries"
  | "client_commission_invoices";

/** One H-Connect row. All values are strings (decimals need a point, allocation numbers keep leading zeros). */
export type ApiRow = Record<string, string>;

export interface BuiltRow {
  rowKey: string;
  companyId: string | null;
  documentKey: string;
  amount: number;
  display: Record<string, string | number>;
  apiRow: ApiRow;
  /** YYYY-MM-DD, built from local date parts (never toISOString). */
  periodEnd: string;
}

export type HConnectOutcome =
  | { kind: "ok"; latencyMs: number; httpStatus: number; body: unknown }
  | {
      kind: "api_error";
      code: "validation" | "permission" | "not_in_service" | "other";
      message: string;
      rowErrors: Record<number, string>;
      httpStatus: number;
      body: unknown;
    }
  | { kind: "unknown"; message: string };
