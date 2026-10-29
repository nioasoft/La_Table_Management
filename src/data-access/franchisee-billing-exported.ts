import { and, isNotNull, isNull, or, type SQL } from "drizzle-orm";

import * as schema from "@/db/schema";

/**
 * The four columns that say a billing row already reached Hashavshevet.
 * An Excel export writes a batch id AND a timestamp; an approved H-Connect
 * send writes only the timestamp (no Excel batch row exists). Any one of them
 * means the row is invoiced — no upload, reopen or delete may touch it.
 */
export interface BillingExportMarkers {
  readonly royaltyExportedAt: Date | null;
  readonly royaltyExportBatchId: string | null;
  readonly marketingExportedAt: Date | null;
  readonly marketingExportBatchId: string | null;
}

/** The marker columns, for spreading into a select. */
export const billingExportMarkerColumns = {
  royaltyExportedAt: schema.franchiseeBilling.royaltyExportedAt,
  royaltyExportBatchId: schema.franchiseeBilling.royaltyExportBatchId,
  marketingExportedAt: schema.franchiseeBilling.marketingExportedAt,
  marketingExportBatchId: schema.franchiseeBilling.marketingExportBatchId,
} as const;

export function isBillingExported(
  row: BillingExportMarkers | null | undefined,
): boolean {
  return Boolean(
    row &&
      (row.royaltyExportedAt !== null ||
        row.royaltyExportBatchId !== null ||
        row.marketingExportedAt !== null ||
        row.marketingExportBatchId !== null),
  );
}

/** WHERE condition: the row never reached Hashavshevet. */
export function billingNotExported(): SQL {
  const columns = Object.values(billingExportMarkerColumns);
  return and(...columns.map((column) => isNull(column))) as SQL;
}

/** WHERE / select expression: the row reached Hashavshevet. */
export function billingExported(): SQL {
  const columns = Object.values(billingExportMarkerColumns);
  return or(...columns.map((column) => isNotNull(column))) as SQL;
}
