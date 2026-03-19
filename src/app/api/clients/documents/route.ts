/**
 * Client Documents API
 *
 * GET  /api/clients/documents - List documents with filters
 * POST /api/clients/documents - Upload and process a new document
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAdminOrSuperUser, isAuthError } from "@/lib/api-middleware";
import {
  getClientDocuments,
  getDocumentTrackingMatrix,
  getDocumentPeriodSummary,
} from "@/data-access/client-documents";
import { processClientDocument } from "@/lib/client-document-processor";
import { database } from "@/db";
import { client } from "@/db/schema";
import { eq } from "drizzle-orm";

export async function GET(request: NextRequest) {
  const authResult = await requireAdminOrSuperUser(request);
  if (isAuthError(authResult)) return authResult;

  const { searchParams } = new URL(request.url);
  const view = searchParams.get("view"); // "list" | "matrix" | "summary"

  try {
    if (view === "matrix") {
      const periodMonth = parseInt(searchParams.get("periodMonth") ?? "");
      const periodYear = parseInt(searchParams.get("periodYear") ?? "");

      if (isNaN(periodMonth) || isNaN(periodYear)) {
        return NextResponse.json(
          { error: "נדרשים פרמטרים periodMonth ו-periodYear" },
          { status: 400 }
        );
      }

      const clientIds = searchParams.get("clientIds")?.split(",").filter(Boolean);
      const matrix = await getDocumentTrackingMatrix(periodMonth, periodYear, clientIds);
      return NextResponse.json(matrix);
    }

    if (view === "summary") {
      const periodMonth = parseInt(searchParams.get("periodMonth") ?? "");
      const periodYear = parseInt(searchParams.get("periodYear") ?? "");

      if (isNaN(periodMonth) || isNaN(periodYear)) {
        return NextResponse.json(
          { error: "נדרשים פרמטרים periodMonth ו-periodYear" },
          { status: 400 }
        );
      }

      const summary = await getDocumentPeriodSummary(periodMonth, periodYear);
      return NextResponse.json(summary);
    }

    // Default: list view
    const documents = await getClientDocuments({
      clientId: searchParams.get("clientId") ?? undefined,
      franchiseeId: searchParams.get("franchiseeId") ?? undefined,
      documentType: (searchParams.get("documentType") as "client_report" | "tabit_report") ?? undefined,
      periodMonth: searchParams.has("periodMonth")
        ? parseInt(searchParams.get("periodMonth")!)
        : undefined,
      periodYear: searchParams.has("periodYear")
        ? parseInt(searchParams.get("periodYear")!)
        : undefined,
      limit: searchParams.has("limit")
        ? parseInt(searchParams.get("limit")!)
        : undefined,
    });

    return NextResponse.json(documents);
  } catch (error) {
    console.error("Error fetching client documents:", error);
    return NextResponse.json(
      { error: "שגיאה בטעינת מסמכים" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const authResult = await requireAdminOrSuperUser(request);
  if (isAuthError(authResult)) return authResult;
  const { user } = authResult;

  try {
    const formData = await request.formData();

    // Extract fields
    const file = formData.get("file") as File | null;
    const clientId = formData.get("clientId") as string | null;
    const franchiseeId = formData.get("franchiseeId") as string | null;
    const documentType = formData.get("documentType") as string | null;
    const periodMonth = formData.get("periodMonth") as string | null;
    const periodYear = formData.get("periodYear") as string | null;

    // Validate required fields
    if (!file) {
      return NextResponse.json({ error: "נדרש קובץ" }, { status: 400 });
    }
    if (!franchiseeId) {
      return NextResponse.json({ error: "נדרש זכיין" }, { status: 400 });
    }
    if (!documentType || !["client_report", "tabit_report"].includes(documentType)) {
      return NextResponse.json(
        { error: "סוג מסמך לא תקין (client_report / tabit_report)" },
        { status: 400 }
      );
    }
    if (!periodMonth || !periodYear) {
      return NextResponse.json(
        { error: "נדרשים חודש ושנה" },
        { status: 400 }
      );
    }

    // For client_report, clientId is required
    if (documentType === "client_report" && !clientId) {
      return NextResponse.json(
        { error: "נדרש לקוח עבור דוח לקוח" },
        { status: 400 }
      );
    }

    // Determine parser code
    let parserCode = "TABIT";
    if (documentType === "client_report" && clientId) {
      const [clientRecord] = await database
        .select({ code: client.code, parserCode: client.parserCode })
        .from(client)
        .where(eq(client.id, clientId))
        .limit(1);

      if (!clientRecord) {
        return NextResponse.json({ error: "לקוח לא נמצא" }, { status: 404 });
      }

      parserCode = clientRecord.parserCode ?? clientRecord.code ?? "";
    }

    // Convert File to Buffer
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Process through unified pipeline
    const result = await processClientDocument({
      buffer,
      fileName: file.name,
      mimeType: file.type || "application/octet-stream",
      clientId: documentType === "client_report" ? clientId : null,
      parserCode,
      franchiseeId,
      periodMonth: parseInt(periodMonth),
      periodYear: parseInt(periodYear),
      documentType: documentType as "client_report" | "tabit_report",
      source: "manual_upload",
      userId: user.id,
    });

    if (!result.success) {
      return NextResponse.json(
        { error: result.error ?? "שגיאה בעיבוד המסמך" },
        { status: 500 }
      );
    }

    return NextResponse.json(
      {
        document: result.document,
        processingResult: result.processingResult,
        skippedDuplicate: result.skippedDuplicate,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("Error uploading client document:", error);
    return NextResponse.json(
      { error: "שגיאה בהעלאת מסמך" },
      { status: 500 }
    );
  }
}
