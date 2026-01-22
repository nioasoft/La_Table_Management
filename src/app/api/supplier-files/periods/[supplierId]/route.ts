import { NextRequest, NextResponse } from "next/server";
import {
  requireAdminOrSuperUser,
  isAuthError,
} from "@/lib/api-middleware";
import { getSupplierById } from "@/data-access/suppliers";
import {
  getSupplierFileUploadsBySupplierAndYear,
  type SupplierFileUploadWithSupplier,
} from "@/data-access/supplier-file-uploads";
import {
  getAvailablePeriodsForSupplier,
  type SettlementPeriodInfo,
} from "@/lib/settlement-periods";

type Params = Promise<{ supplierId: string }>;

export interface PeriodWithStatus extends SettlementPeriodInfo {
  hasFile: boolean;
  existingFile?: {
    id: string;
    fileName: string;
    status: string;
    uploadedAt: Date;
  } | null;
}

export interface SupplierPeriodsResponse {
  supplierId: string;
  supplierName: string;
  frequency: string;
  periods: PeriodWithStatus[];
}

/**
 * GET /api/supplier-files/periods/[supplierId]
 * Returns available periods for a supplier with file status
 */
export async function GET(
  request: NextRequest,
  segmentData: { params: Params }
) {
  try {
    const authResult = await requireAdminOrSuperUser(request);
    if (isAuthError(authResult)) return authResult;

    const params = await segmentData.params;
    const { supplierId } = params;

    // Get supplier
    const supplier = await getSupplierById(supplierId);
    if (!supplier) {
      return NextResponse.json(
        { error: "הספק לא נמצא" },
        { status: 404 }
      );
    }

    // Get available periods based on supplier's settlement frequency
    // Map unsupported frequencies (weekly, bi_weekly) to quarterly
    const rawFrequency = supplier.settlementFrequency || "quarterly";
    type SupportedFrequency = "monthly" | "quarterly" | "semi_annual" | "annual";
    const supportedFrequencies: SupportedFrequency[] = ["monthly", "quarterly", "semi_annual", "annual"];
    const frequency: SupportedFrequency = supportedFrequencies.includes(rawFrequency as SupportedFrequency)
      ? (rawFrequency as SupportedFrequency)
      : "quarterly";
    const periods = getAvailablePeriodsForSupplier(frequency);

    // Get existing files for current and previous year
    const currentYear = new Date().getFullYear();
    const [currentYearFiles, prevYearFiles] = await Promise.all([
      getSupplierFileUploadsBySupplierAndYear(supplierId, currentYear),
      getSupplierFileUploadsBySupplierAndYear(supplierId, currentYear - 1),
    ]);

    const allFiles = [...currentYearFiles, ...prevYearFiles];

    // Build a map of period key to existing file
    const filesByPeriod = new Map<string, SupplierFileUploadWithSupplier>();
    for (const file of allFiles) {
      if (file.periodStartDate && file.periodEndDate) {
        // Skip rejected files - they shouldn't show as "existing"
        if (file.processingStatus === "rejected") continue;

        // Create a key from the period dates
        const startDate = new Date(file.periodStartDate);
        const endDate = new Date(file.periodEndDate);

        // Find matching period key
        const matchingPeriod = periods.find(
          (p) =>
            p.startDate.getTime() === startDate.getTime() &&
            p.endDate.getTime() === endDate.getTime()
        );

        if (matchingPeriod) {
          // Only keep the most recent file for each period
          const existing = filesByPeriod.get(matchingPeriod.key);
          if (!existing || new Date(file.createdAt) > new Date(existing.createdAt)) {
            filesByPeriod.set(matchingPeriod.key, file);
          }
        }
      }
    }

    // Enhance periods with file status
    const periodsWithStatus: PeriodWithStatus[] = periods.map((period) => {
      const existingFile = filesByPeriod.get(period.key);
      return {
        ...period,
        hasFile: !!existingFile,
        existingFile: existingFile
          ? {
              id: existingFile.id,
              fileName: existingFile.originalFileName,
              status: existingFile.processingStatus,
              uploadedAt: existingFile.createdAt,
            }
          : null,
      };
    });

    const response: SupplierPeriodsResponse = {
      supplierId,
      supplierName: supplier.name,
      frequency,
      periods: periodsWithStatus,
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error("Error fetching supplier periods:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
