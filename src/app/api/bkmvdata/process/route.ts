import { NextRequest, NextResponse } from "next/server";
import {
  requireAdminOrSuperUser,
  isAuthError,
} from "@/lib/api-middleware";
import { parseBkmvData } from "@/lib/bkmvdata-parser";
import { processFranchiseeBkmvData } from "@/data-access/crossReferences";
import { getFranchiseeByCompanyId } from "@/data-access/franchisees";
import { getDocument } from "@/lib/storage";

/**
 * POST /api/bkmvdata/process - Process a BKMVDATA file
 *
 * Body can contain either:
 * - file: File object (direct upload)
 * - fileUrl: URL to fetch the file from storage
 * - fileBuffer: Base64 encoded file content
 *
 * Required fields:
 * - periodStartDate: Start date of the period (YYYY-MM-DD)
 * - periodEndDate: End date of the period (YYYY-MM-DD)
 *
 * Optional:
 * - franchiseeId: If provided, uses this franchisee. Otherwise, auto-detects from file.
 */
export async function POST(request: NextRequest) {
  try {
    const authResult = await requireAdminOrSuperUser(request);
    if (isAuthError(authResult)) return authResult;
    const { user } = authResult;

    // Check content type to determine how to parse
    const contentType = request.headers.get("content-type") || "";

    let fileBuffer: Buffer;
    let franchiseeId: string | undefined;
    let periodStartDate: string;
    let periodEndDate: string;

    if (contentType.includes("multipart/form-data")) {
      // Handle form data with file upload
      const formData = await request.formData();
      const file = formData.get("file") as File | null;
      franchiseeId = formData.get("franchiseeId") as string | undefined;
      periodStartDate = formData.get("periodStartDate") as string;
      periodEndDate = formData.get("periodEndDate") as string;

      if (!file) {
        return NextResponse.json(
          { error: "File is required" },
          { status: 400 }
        );
      }

      fileBuffer = Buffer.from(await file.arrayBuffer());
    } else {
      // Handle JSON body with file URL or base64 content
      const body = await request.json();
      franchiseeId = body.franchiseeId;
      periodStartDate = body.periodStartDate;
      periodEndDate = body.periodEndDate;

      if (body.fileBuffer) {
        // Base64 encoded file content
        fileBuffer = Buffer.from(body.fileBuffer, "base64");
      } else if (body.fileUrl) {
        // Fetch from storage
        const fileData = await getDocument(body.fileUrl);
        if (!fileData) {
          return NextResponse.json(
            { error: "File not found at specified URL" },
            { status: 404 }
          );
        }
        fileBuffer = fileData;
      } else {
        return NextResponse.json(
          { error: "Either file, fileUrl, or fileBuffer is required" },
          { status: 400 }
        );
      }
    }

    // Validate period dates
    if (!periodStartDate || !periodEndDate) {
      return NextResponse.json(
        { error: "periodStartDate and periodEndDate are required" },
        { status: 400 }
      );
    }

    // Parse the BKMVDATA file
    const parseResult = parseBkmvData(fileBuffer);

    // Auto-detect franchisee if not provided
    if (!franchiseeId) {
      if (!parseResult.companyId) {
        return NextResponse.json(
          { error: "Could not detect company ID from file and franchiseeId was not provided" },
          { status: 400 }
        );
      }

      const matchedFranchisee = await getFranchiseeByCompanyId(parseResult.companyId);
      if (!matchedFranchisee) {
        return NextResponse.json(
          {
            error: `No franchisee found with company ID: ${parseResult.companyId}`,
            companyId: parseResult.companyId,
          },
          { status: 404 }
        );
      }
      franchiseeId = matchedFranchisee.id;
    }

    // Process the BKMVDATA and update cross-references
    const processingResult = await processFranchiseeBkmvData(
      franchiseeId,
      parseResult,
      periodStartDate,
      periodEndDate,
      user.id
    );

    return NextResponse.json({
      success: true,
      result: processingResult,
      parseInfo: {
        companyId: parseResult.companyId,
        fileVersion: parseResult.fileVersion,
        totalRecords: parseResult.totalRecords,
        totalSuppliers: parseResult.supplierSummary.size,
      },
    });
  } catch (error) {
    console.error("Error processing BKMVDATA:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal server error" },
      { status: 500 }
    );
  }
}
