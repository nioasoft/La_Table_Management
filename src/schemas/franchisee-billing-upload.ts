import { z } from "zod";

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
const EXCEL_MIME_TYPES = new Set([
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
  "application/octet-stream",
]);

export const franchiseeBillingUploadSchema = z.object({
  file: z
    .instanceof(File, { error: "נדרש קובץ Excel" })
    .refine((file) => file.size > 0, "הקובץ ריק")
    .refine(
      (file) => file.size <= MAX_UPLOAD_BYTES,
      "הקובץ גדול מדי. הגודל המרבי הוא 20MB",
    )
    .refine(
      (file) =>
        EXCEL_MIME_TYPES.has(file.type) ||
        /\.(xlsx|xls)$/i.test(file.name),
      "סוג הקובץ אינו נתמך. יש להעלות קובץ Excel",
    ),
});

export type FranchiseeBillingUploadInput = z.infer<
  typeof franchiseeBillingUploadSchema
>;

/**
 * Replays a workbook already stored, so only its id crosses the wire — plus,
 * when the replay exists to settle a blocked row, the decision about that row.
 * A null franchisee means the row is not a franchisee and should be dropped.
 */
export const franchiseeBillingReprocessSchema = z.object({
  sourceFileId: z.string().min(1),
  override: z
    .object({
      rowIndex: z.number().int().min(0, "מזהה השורה אינו תקין"),
      franchiseeId: z.string().trim().min(1, "מזהה הזכיין חסר").nullable(),
    })
    .optional(),
});
