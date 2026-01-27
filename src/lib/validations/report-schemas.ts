import { z } from "zod";

// ============================================================================
// Base Schemas
// ============================================================================

/**
 * UUID validation schema
 */
export const uuidSchema = z.string().uuid({
  message: "מזהה לא תקין",
});

/**
 * Period key validation schema (format: YYYY-Q[1-4] or YYYY-M[01-12])
 * Examples: "2024-Q1", "2024-M03", "2024-M12"
 */
export const periodKeySchema = z.string().regex(
  /^\d{4}-(Q[1-4]|M(0[1-9]|1[0-2]))$/,
  {
    message: "פורמט מפתח תקופה לא תקין. יש להשתמש בפורמט YYYY-Q[1-4] או YYYY-M[01-12]",
  }
);

/**
 * Pagination schema with defaults
 */
export const paginationSchema = z.object({
  page: z.coerce
    .number()
    .int({
      message: "מספר עמוד חייב להיות מספר שלם",
    })
    .positive({
      message: "מספר עמוד חייב להיות חיובי",
    })
    .default(1),
  pageSize: z.coerce
    .number()
    .int({
      message: "גודל עמוד חייב להיות מספר שלם",
    })
    .positive({
      message: "גודל עמוד חייב להיות חיובי",
    })
    .max(100, {
      message: "גודל עמוד מקסימלי הוא 100",
    })
    .default(50),
});

/**
 * Date range validation schema
 * Ensures startDate <= endDate when both are present
 */
export const dateRangeSchema = z
  .object({
    startDate: z.coerce.date().optional(),
    endDate: z.coerce.date().optional(),
  })
  .refine(
    (data) => {
      if (data.startDate && data.endDate) {
        return data.startDate <= data.endDate;
      }
      return true;
    },
    {
      message: "תאריך התחלה חייב להיות לפני או שווה לתאריך סיום",
      path: ["endDate"],
    }
  );

/**
 * Amount filter validation schema
 * Ensures amounts are non-negative
 */
export const amountFilterSchema = z.object({
  minAmount: z.coerce
    .number()
    .min(0, {
      message: "סכום מינימלי חייב להיות אפס או גדול יותר",
    })
    .optional(),
  maxAmount: z.coerce
    .number()
    .min(0, {
      message: "סכום מקסימלי חייב להיות אפס או גדול יותר",
    })
    .optional(),
}).refine(
  (data) => {
    if (data.minAmount !== undefined && data.maxAmount !== undefined) {
      return data.minAmount <= data.maxAmount;
    }
    return true;
  },
  {
    message: "סכום מינימלי חייב להיות קטן או שווה לסכום מקסימלי",
    path: ["maxAmount"],
  }
);

// ============================================================================
// Report Filter Schemas
// ============================================================================

/**
 * Commission report filters schema
 */
export const commissionFiltersSchema = z
  .object({
    supplierId: uuidSchema.optional(),
    franchiseeId: uuidSchema.optional(),
    brandId: uuidSchema.optional(),
    status: z
      .enum(["pending", "calculated", "approved", "paid", "cancelled"], {
        message: "סטטוס לא תקין. יש לבחור: pending, calculated, approved, paid או cancelled",
      })
      .optional(),
    periodKey: periodKeySchema.optional(),
  })
  .merge(dateRangeSchema)
  .merge(amountFilterSchema);

/**
 * Deposits report filters schema
 */
export const depositsFiltersSchema = z
  .object({
    supplierId: uuidSchema.optional(),
    franchiseeId: uuidSchema.optional(),
    brandId: uuidSchema.optional(),
    depositType: z
      .enum(["security", "advance", "credit", "other"], {
        message: "סוג פיקדון לא תקין",
      })
      .optional(),
    status: z
      .enum(["active", "used", "returned"], {
        message: "סטטוס פיקדון לא תקין",
      })
      .optional(),
  })
  .merge(dateRangeSchema)
  .merge(amountFilterSchema);

/**
 * Unauthorized suppliers report filters schema
 */
export const unauthorizedSuppliersFiltersSchema = z
  .object({
    franchiseeId: uuidSchema.optional(),
    brandId: uuidSchema.optional(),
    supplierName: z
      .string()
      .trim()
      .min(1, {
        message: "שם ספק חייב להכיל לפחות תו אחד",
      })
      .optional(),
    periodKey: periodKeySchema.optional(),
  })
  .merge(dateRangeSchema)
  .merge(amountFilterSchema);

/**
 * Variance report filters schema
 */
export const varianceFiltersSchema = z
  .object({
    supplierId: uuidSchema.optional(),
    franchiseeId: uuidSchema.optional(),
    brandId: uuidSchema.optional(),
    periodKey: periodKeySchema.optional(),
    minVariance: z.coerce
      .number()
      .optional(),
    maxVariance: z.coerce
      .number()
      .optional(),
    varianceType: z
      .enum(["positive", "negative", "all"], {
        message: "סוג סטייה לא תקין",
      })
      .default("all")
      .optional(),
  })
  .merge(dateRangeSchema);

/**
 * Variance report API filters schema
 * For the /api/commissions/variance endpoint with period comparison
 */
export const varianceReportApiFiltersSchema = z
  .object({
    currentStartDate: z.coerce.date({
      message: "תאריך התחלה לתקופה נוכחית נדרש ולא תקין",
    }),
    currentEndDate: z.coerce.date({
      message: "תאריך סיום לתקופה נוכחית נדרש ולא תקין",
    }),
    previousStartDate: z.coerce.date({
      message: "תאריך התחלה לתקופה קודמת נדרש ולא תקין",
    }),
    previousEndDate: z.coerce.date({
      message: "תאריך סיום לתקופה קודמת נדרש ולא תקין",
    }),
    brandId: uuidSchema.optional(),
    varianceThreshold: z.coerce
      .number()
      .min(0, {
        message: "סף סטייה חייב להיות אפס או גדול יותר",
      })
      .max(100, {
        message: "סף סטייה חייב להיות עד 100",
      })
      .default(10),
  })
  .refine(
    (data) => data.currentStartDate <= data.currentEndDate,
    {
      message: "תאריך התחלה לתקופה נוכחית חייב להיות לפני או שווה לתאריך סיום",
      path: ["currentEndDate"],
    }
  )
  .refine(
    (data) => data.previousStartDate <= data.previousEndDate,
    {
      message: "תאריך התחלה לתקופה קודמת חייב להיות לפני או שווה לתאריך סיום",
      path: ["previousEndDate"],
    }
  );

/**
 * Invoice report filters schema
 */
export const invoiceFiltersSchema = z
  .object({
    managementCompanyId: uuidSchema.optional(),
    brandId: uuidSchema.optional(),
    periodKey: periodKeySchema.optional(),
    invoiceStatus: z
      .enum(["draft", "issued", "sent", "paid"], {
        message: "סטטוס חשבונית לא תקין",
      })
      .optional(),
  })
  .merge(dateRangeSchema)
  .merge(amountFilterSchema);

/**
 * Supplier files report filters schema
 */
export const supplierFilesFiltersSchema = z
  .object({
    supplierId: uuidSchema.optional(),
    brandId: uuidSchema.optional(),
    status: z
      .enum(["pending", "processing", "auto_approved", "needs_review", "approved", "rejected"], {
        message: "סטטוס לא תקין",
      })
      .optional(),
  })
  .merge(dateRangeSchema);

// ============================================================================
// Batch Operation Schemas
// ============================================================================

/**
 * Batch create/update validation schema
 * Limits batch operations to 100 items
 */
export const batchCreateSchema = <T extends z.ZodTypeAny>(itemSchema: T) =>
  z
    .object({
      items: z
        .array(itemSchema)
        .min(1, {
          message: "חייב להכיל לפחות פריט אחד",
        })
        .max(100, {
          message: "ניתן לבצע פעולה על עד 100 פריטים בו-זמנית",
        }),
    })
    .strict();

/**
 * Batch delete validation schema
 */
export const batchDeleteSchema = z
  .object({
    ids: z
      .array(uuidSchema)
      .min(1, {
        message: "חייב להכיל לפחות מזהה אחד",
      })
      .max(100, {
        message: "ניתן למחוק עד 100 פריטים בו-זמנית",
      }),
  })
  .strict();

// ============================================================================
// Export Schemas
// ============================================================================

/**
 * Export request schema
 */
export const exportRequestSchema = z.object({
  format: z
    .enum(["csv", "xlsx", "pdf"], {
      message: "פורמט ייצוא לא תקין. יש לבחור: csv, xlsx או pdf",
    })
    .default("xlsx"),
  includeMetadata: z.boolean().default(true),
  filename: z
    .string()
    .trim()
    .min(1, {
      message: "שם קובץ לא יכול להיות רק",
    })
    .max(255, {
      message: "שם קובץ יכול להכיל עד 255 תווים",
    })
    .regex(/^[a-zA-Z0-9_\-\u0590-\u05FF\s]+$/, {
      message: "שם קובץ יכול להכיל רק אותיות, מספרים, מקף תחתון ומקף",
    })
    .optional(),
});

// ============================================================================
// Sort and Order Schemas
// ============================================================================

/**
 * Sort direction schema
 */
export const sortDirectionSchema = z.enum(["asc", "desc"], {
  message: "כיוון מיון לא תקין. יש לבחור: asc או desc",
}).default("asc");

/**
 * Generic sort schema
 */
export const createSortSchema = <T extends readonly [string, ...string[]]>(
  sortableFields: T
) =>
  z.object({
    sortBy: z.enum(sortableFields).optional(),
    sortDirection: sortDirectionSchema.optional(),
  });

// ============================================================================
// Type Exports
// ============================================================================

export type UUID = z.infer<typeof uuidSchema>;
export type PeriodKey = z.infer<typeof periodKeySchema>;
export type Pagination = z.infer<typeof paginationSchema>;
export type DateRange = z.infer<typeof dateRangeSchema>;
export type AmountFilter = z.infer<typeof amountFilterSchema>;

export type CommissionFilters = z.infer<typeof commissionFiltersSchema>;
export type DepositsFilters = z.infer<typeof depositsFiltersSchema>;
export type UnauthorizedSuppliersFilters = z.infer<typeof unauthorizedSuppliersFiltersSchema>;
export type VarianceFilters = z.infer<typeof varianceFiltersSchema>;
export type VarianceReportApiFilters = z.infer<typeof varianceReportApiFiltersSchema>;
export type InvoiceFilters = z.infer<typeof invoiceFiltersSchema>;
export type SupplierFilesFilters = z.infer<typeof supplierFilesFiltersSchema>;

/**
 * Unified files report filters schema
 */
export const unifiedFilesFiltersSchema = z
  .object({
    source: z
      .enum(["supplier", "uploaded"], {
        message: "מקור קובץ לא תקין. יש לבחור: supplier או uploaded",
      })
      .optional(),
    entityType: z
      .enum(["supplier", "franchisee"], {
        message: "סוג ישות לא תקין. יש לבחור: supplier או franchisee",
      })
      .optional(),
    status: z
      .enum(["pending", "processing", "auto_approved", "needs_review", "approved", "rejected"], {
        message: "סטטוס לא תקין",
      })
      .optional(),
  })
  .merge(dateRangeSchema);

export type UnifiedFilesFilters = z.infer<typeof unifiedFilesFiltersSchema>;

export type BatchDelete = z.infer<typeof batchDeleteSchema>;
export type ExportRequest = z.infer<typeof exportRequestSchema>;
export type SortDirection = z.infer<typeof sortDirectionSchema>;
