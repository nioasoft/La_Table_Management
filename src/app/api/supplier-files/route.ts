import { NextRequest, NextResponse } from "next/server";
import {
  requireAdminOrSuperUser,
  isAuthError,
} from "@/lib/api-middleware";
import {
  createSupplierFileUpload,
  getSupplierFileUploads,
  getSupplierFileByPeriod,
  findDuplicateSupplierFiles,
  reviewSupplierFile,
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
 *   periodStartDate: string (required),
 *   periodEndDate: string (required),
 *   overwrite?: boolean - if true, rejects existing file and creates new one
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
      fileUrl,
      fileSize,
      processingResult,
      periodStartDate,
      periodEndDate,
      overwrite,
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

    // Period dates are now required
    if (!periodStartDate || !periodEndDate) {
      return NextResponse.json(
        { error: "תאריכי תקופה הם שדה חובה" },
        { status: 400 }
      );
    }

    // fileUrl is required - files without a storage URL cannot be downloaded
    if (!fileUrl) {
      return NextResponse.json(
        { error: "לא ניתן לשמור קובץ ללא קישור אחסון. יש לנסות להעלות שוב." },
        { status: 400 }
      );
    }

    // Validate fileUrl (must be from Vercel Blob Storage)
    if (fileUrl) {
      try {
        const url = new URL(fileUrl);
        // Only allow HTTPS URLs from Vercel Blob domain
        const isVercelBlob = url.protocol === 'https:' &&
          (url.hostname.endsWith('.public.blob.vercel-storage.com') ||
           url.hostname.endsWith('.blob.vercel-storage.com'));
        if (!isVercelBlob) {
          return NextResponse.json(
            { error: "כתובת קובץ לא חוקית - חייבת להיות מ-Vercel Blob Storage" },
            { status: 400 }
          );
        }
      } catch {
        return NextResponse.json(
          { error: "פורמט כתובת קובץ לא חוקי" },
          { status: 400 }
        );
      }
    }

    // Verify supplier exists
    const supplier = await getSupplierById(supplierId);
    if (!supplier) {
      return NextResponse.json(
        { error: "הספק לא נמצא" },
        { status: 404 }
      );
    }

    // Validate period length is plausible for the supplier's settlement
    // frequency. We only reject files whose period is LONGER than the
    // settlement window (clearly wrong data). Shorter files are allowed —
    // a quarterly supplier may legitimately receive monthly breakdowns
    // that get aggregated, and franchisees often submit partial periods.
    if (supplier.settlementFrequency && periodStartDate && periodEndDate) {
      const start = new Date(periodStartDate);
      const end = new Date(periodEndDate);
      const daySpan = Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));

      // Upper-bound + a small tolerance per frequency.
      const frequencyMax: Record<string, { max: number; label: string }> = {
        weekly: { max: 10, label: "שבועי" },
        bi_weekly: { max: 18, label: "דו-שבועי" },
        monthly: { max: 35, label: "חודשי" },
        quarterly: { max: 100, label: "רבעוני" },
        semi_annual: { max: 190, label: "חצי שנתי" },
        annual: { max: 375, label: "שנתי" },
      };

      const expected = frequencyMax[supplier.settlementFrequency];
      if (expected && daySpan > expected.max) {
        return NextResponse.json(
          {
            error: `תקופת הקובץ (${daySpan} ימים) ארוכה מתקופת ההתחשבנות של הספק (${expected.label}, עד ${expected.max} ימים).`,
          },
          { status: 400 }
        );
      }

      if (daySpan < 1) {
        return NextResponse.json(
          { error: "תקופת הקובץ קצרה מדי (פחות מיום אחד)." },
          { status: 400 }
        );
      }
    }

    // Check for existing file for this period
    const isMultiFile = (supplier.fileMapping?.maxUploadFiles ?? 1) > 1;
    let replacedFileId: string | undefined;

    if (isMultiFile) {
      // Multi-file supplier: per-franchisee duplicate detection
      const typedResult = processingResult as SupplierFileProcessingResult;
      const matchedFranchiseeIds = (typedResult.franchiseeMatches ?? [])
        .map((m) => m.matchedFranchiseeId)
        .filter((id): id is string => !!id && id.trim() !== "");

      if (matchedFranchiseeIds.length > 0) {
        const duplicates = await findDuplicateSupplierFiles(
          supplierId,
          periodStartDate,
          periodEndDate,
          matchedFranchiseeIds
        );

        if (duplicates.length > 0 && !overwrite) {
          // Find the overlapping franchisee names from the new file's processing result
          const overlappingIds = new Set(duplicates.flatMap((d) => d.overlappingFranchiseeIds));
          const overlappingNames = (typedResult.franchiseeMatches ?? [])
            .filter((m) => m.matchedFranchiseeId && overlappingIds.has(m.matchedFranchiseeId))
            .map((m) => m.matchedFranchiseeName || m.originalName)
            .filter((name, idx, arr) => arr.indexOf(name) === idx);

          return NextResponse.json(
            {
              error: "קיים כבר קובץ עבור זכיינים אלו בתקופה זו",
              existingFile: {
                id: duplicates[0].fileId,
                fileName: duplicates[0].originalFileName,
                status: "exists",
                uploadedAt: duplicates[0].createdAt,
              },
              overlappingFranchiseeNames: overlappingNames,
            },
            { status: 409 }
          );
        }

        if (overwrite && duplicates.length > 0) {
          // Reject only the specific overlapping file
          replacedFileId = duplicates[0].fileId;
          await reviewSupplierFile(
            duplicates[0].fileId,
            "reject",
            user.id,
            "הוחלף על ידי קובץ חדש (זכיינים חופפים)"
          );
        }
      }
    } else {
      // Single-file supplier: existing behavior
      const existingFile = await getSupplierFileByPeriod(
        supplierId,
        new Date(periodStartDate),
        new Date(periodEndDate)
      );

      if (existingFile) {
        if (!overwrite) {
          return NextResponse.json(
            {
              error: "קיים כבר קובץ לתקופה זו",
              existingFile: {
                id: existingFile.id,
                fileName: existingFile.originalFileName,
                status: existingFile.processingStatus,
                uploadedAt: existingFile.createdAt,
              },
            },
            { status: 409 }
          );
        }

        replacedFileId = existingFile.id;
        await reviewSupplierFile(
          existingFile.id,
          "reject",
          user.id,
          "הוחלף על ידי קובץ חדש"
        );
      }
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
      fileUrl: fileUrl || null, // URL from Blob Storage
      fileSize: fileSize || 0,
      processingStatus,
      processingResult: processingResult as SupplierFileProcessingResult,
      periodStartDate: periodStartDate,
      periodEndDate: periodEndDate,
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
      replacedFile: replacedFileId,
    });
  } catch (error) {
    console.error("Error creating supplier file upload:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
