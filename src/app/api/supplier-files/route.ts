import { NextRequest, NextResponse } from "next/server";
import {
  requireAdminOrSuperUser,
  isAuthError,
} from "@/lib/api-middleware";
import {
  createSupplierFileUpload,
  getSupplierFileUploads,
} from "@/data-access/supplier-file-uploads";
import { getSupplierById } from "@/data-access/suppliers";
import type { SupplierFileProcessingResult } from "@/db/schema";

/**
 * GET /api/supplier-files - Get list of supplier file uploads
 */
export async function GET(request: NextRequest) {
  try {
    const authResult = await requireAdminOrSuperUser(request);
    if (isAuthError(authResult)) return authResult;

    const { searchParams } = new URL(request.url);
    const supplierId = searchParams.get("supplierId") || undefined;
    const statusParam = searchParams.get("status");
    const status = statusParam ? statusParam.split(",") : undefined;
    const limit = searchParams.get("limit")
      ? parseInt(searchParams.get("limit")!)
      : undefined;
    const offset = searchParams.get("offset")
      ? parseInt(searchParams.get("offset")!)
      : undefined;

    const result = await getSupplierFileUploads({
      supplierId,
      status,
      limit,
      offset,
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error("Error fetching supplier files:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/supplier-files - Create a new supplier file upload record
 * Body: {
 *   supplierId: string,
 *   fileName: string,
 *   fileSize: number,
 *   processingResult: SupplierFileProcessingResult,
 *   periodStartDate?: string,
 *   periodEndDate?: string
 * }
 */
export async function POST(request: NextRequest) {
  try {
    const authResult = await requireAdminOrSuperUser(request);
    if (isAuthError(authResult)) return authResult;
    const { user } = authResult;

    const body = await request.json();
    const {
      supplierId,
      fileName,
      fileSize,
      processingResult,
      periodStartDate,
      periodEndDate,
    } = body;

    // Validate required fields
    if (!supplierId) {
      return NextResponse.json(
        { error: "מזהה ספק הוא שדה חובה" },
        { status: 400 }
      );
    }

    if (!fileName) {
      return NextResponse.json(
        { error: "שם קובץ הוא שדה חובה" },
        { status: 400 }
      );
    }

    if (!processingResult) {
      return NextResponse.json(
        { error: "תוצאות עיבוד הן שדה חובה" },
        { status: 400 }
      );
    }

    // Verify supplier exists
    const supplier = await getSupplierById(supplierId);
    if (!supplier) {
      return NextResponse.json(
        { error: "הספק לא נמצא" },
        { status: 404 }
      );
    }

    // Determine the processing status based on match results
    const { matchStats } = processingResult as SupplierFileProcessingResult;
    let processingStatus: "auto_approved" | "needs_review";

    if (matchStats.unmatched === 0 && matchStats.fuzzyMatches === 0) {
      // All rows are exactly matched - auto approve
      processingStatus = "auto_approved";
    } else {
      // Has unmatched or fuzzy matches - needs review
      processingStatus = "needs_review";
    }

    // Create the record
    const newFile = await createSupplierFileUpload({
      supplierId,
      originalFileName: fileName,
      fileSize: fileSize || 0,
      processingStatus,
      processingResult: processingResult as SupplierFileProcessingResult,
      periodStartDate: periodStartDate || null,
      periodEndDate: periodEndDate || null,
      createdBy: user.id,
    });

    return NextResponse.json({
      success: true,
      file: {
        id: newFile.id,
        fileName: newFile.originalFileName,
        processingStatus: newFile.processingStatus,
        supplierId: newFile.supplierId,
        supplierName: supplier.name,
      },
      message:
        processingStatus === "auto_approved"
          ? "הקובץ אושר אוטומטית - כל הזכיינים מותאמים"
          : "הקובץ נוסף לתור הבדיקה",
    });
  } catch (error) {
    console.error("Error creating supplier file upload:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
