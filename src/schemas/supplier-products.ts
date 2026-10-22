import { z } from "zod";

/** Body of `PATCH /api/suppliers/[supplierId]/products` — the VAT-flag save. */
export const productVatUpdateSchema = z.object({
  updates: z
    .array(z.object({ id: z.string().min(1), vatApplicable: z.boolean() }))
    .min(1)
    .max(2000),
});
