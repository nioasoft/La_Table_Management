import { z } from "zod";
import { exportFileQuerySchema } from "@/schemas/franchisee-billing-screen";
import { EXPORT_TYPES, HASHAVSHEVET_SEND_STATUSES, type ExportType } from "@/lib/hashavshevet/types";

/** Request-body schemas for the Hashavshevet send API. Shared by client and server. */

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "התאריך חייב להיות בפורמט YYYY-MM-DD");
const id = z.string().trim().min(1);
const periodMonth = z.number().int().min(1).max(12);
const periodYear = z.number().int().min(2020).max(2100);

/** Shape-valid is not enough for a stored date: "2026-02-30" passes the regex and Postgres would answer 500. */
const realIsoDate = isoDate.refine(
  (s) => {
    const [y, m, d] = s.split("-").map(Number);
    const date = new Date(Date.UTC(y, m - 1, d));
    return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
  },
  "התאריך אינו תקין",
);

export const exportTypeSchema = z.enum(EXPORT_TYPES);

/** Params mirror each export route's current query params (arrays instead of comma lists, JSON body). */
export const supplierCommissionsParams = z.object({
  startDate: isoDate,
  endDate: isoDate,
  brandIds: z.array(id).optional(),
  supplierIds: z.array(id).optional(),
  startDocNumber: z.number().int().min(1).default(5001),
  onlyApproved: z.boolean().default(true),
});

/** The billing route's `mode=file` query: one brand, one item type, one month. */
export const royaltiesParams = exportFileQuerySchema.omit({ mode: true });

export const clientCommissionsParams = z.object({
  sessionId: id,
  /** The route calls this `exportType`; renamed to avoid clashing with the discriminator. */
  docKind: z.enum(["invoice", "journal"]).default("invoice"),
});

export const franchiseePeriodParams = z.object({ franchiseeId: id, periodMonth, periodYear });

export const clientCommissionInvoicesParams = z.object({
  periodMonth,
  periodYear,
  franchiseeId: id.optional(),
});

function variant<T extends ExportType, P extends z.ZodType>(exportType: T, params: P) {
  return z.object({ exportType: z.literal(exportType), params });
}

/** `{ exportType, params }` where params depend on exportType. */
export const exportParamsSchema = z.discriminatedUnion("exportType", [
  variant("supplier_commissions", supplierCommissionsParams),
  variant("royalties", royaltiesParams),
  variant("client_commissions", clientCommissionsParams),
  variant("franchisee_client_invoices", franchiseePeriodParams),
  variant("journal_entries", franchiseePeriodParams),
  variant("client_commission_invoices", clientCommissionInvoicesParams),
]);

export type ExportParamsInput = z.infer<typeof exportParamsSchema>;

export const previewRequestSchema = exportParamsSchema;

/**
 * What the user saw in the preview; the server rebuilds and compares (409 on drift). Only new rows
 * are sent, and a new row always has a company: a mapping change since the preview is drift too.
 */
export const sendRequestSchema = previewRequestSchema.and(
  z.object({
    expected: z
      .array(z.object({ rowKey: z.string().min(1), amount: z.number(), companyId: z.string().min(1) }))
      .min(1),
  }),
);

export const resolveSendSchema = z
  .object({
    outcome: z.enum(["approved", "rejected", "arrived"]),
    note: z.string().trim().optional(),
  })
  .refine((v) => v.outcome !== "rejected" || (v.note?.length ?? 0) >= 3, {
    message: "בדחייה חובה לכתוב הערה",
    path: ["note"],
  });

export const unlockRowSchema = z.object({ reason: z.string().trim().min(3, "חובה לכתוב סיבה לפתיחת השורה") });

export const companyPatchSchema = z.object({
  liveFrom: realIsoDate.nullable().optional(),
  requiresApproval: z.boolean().optional(),
});

export const mappingPatchSchema = z.object({
  kind: z.enum(["brand", "franchisee"]),
  id: z.string(),
  companyId: z.string().nullable(),
});

export const sendsListQuerySchema = z.object({
  status: z.enum(HASHAVSHEVET_SEND_STATUSES).optional(),
  companyId: id.optional(),
  exportType: exportTypeSchema.optional(),
});
