import { z } from "zod";

/**
 * Query params of `GET /api/supplier-files`. `periodStart`/`periodEnd`
 * (YYYY-MM-DD, local dates) select files whose period OVERLAPS that range —
 * never an exact-key match.
 */
export const supplierFileUploadsQuerySchema = z
  .object({
    supplierId: z.string().min(1).optional(),
    status: z
      .string()
      .transform((s) => s.split(",").filter(Boolean))
      .optional(),
    limit: z.coerce.number().int().min(1).max(200).optional(),
    offset: z.coerce.number().int().min(0).optional(),
    periodStart: z.iso.date().optional(),
    periodEnd: z.iso.date().optional(),
  })
  .refine((q) => !q.periodStart === !q.periodEnd, {
    message: "יש לשלוח תאריך התחלה וסיום יחד",
  })
  .refine((q) => !q.periodStart || !q.periodEnd || q.periodStart <= q.periodEnd, {
    message: "תאריך ההתחלה אחרי תאריך הסיום",
  });

export type SupplierFileUploadsQuery = z.infer<typeof supplierFileUploadsQuerySchema>;
