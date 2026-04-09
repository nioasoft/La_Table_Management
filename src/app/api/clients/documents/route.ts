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
import {
  processClientDocument,
  processTabitUpload,
  processHeverUpload,
} from "@/lib/client-document-processor";
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
      documentType: (searchParams.get("documentType") as "client_report" | "tabit_report" | "commission_invoice") ?? undefined,
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
    if (!documentType || !["client_report", "tabit_report", "commission_invoice"].includes(documentType)) {
      return NextResponse.json(
        { error: "סוג מסמך לא תקין" },
        { status: 400 }
      );
    }

    // Convert File to Buffer
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // ---- TABIT PIVOT TABLE UPLOAD ----
    // No franchiseeId or clientId needed — derived from file content
    if (documentType === "tabit_report") {
      const result = await processTabitUpload({
        buffer,
        fileName: file.name,
        mimeType: file.type || "application/octet-stream",
        periodMonth: periodMonth ? parseInt(periodMonth) : undefined,
        periodYear: periodYear ? parseInt(periodYear) : undefined,
        source: "manual_upload",
        userId: user.id,
      });

      if (!result.success) {
        return NextResponse.json(
          { error: result.error ?? "שגיאה בעיבוד קובץ טאביט" },
          { status: 500 }
        );
      }

      return NextResponse.json({ tabitUpload: true, summary: result.summary }, { status: 201 });
    }

    // ---- HEVER (חבר) UPLOAD ----
    // Like Tabit: one file → multiple franchisee records, no franchiseeId needed
    if (clientId) {
      const [clientRecord] = await database
        .select({ code: client.code })
        .from(client)
        .where(eq(client.id, clientId))
        .limit(1);

      if (clientRecord?.code === "HEVER") {
        const result = await processHeverUpload({
          buffer,
          fileName: file.name,
          mimeType: file.type || "application/octet-stream",
          clientId,
          periodMonth: periodMonth ? parseInt(periodMonth) : undefined,
          periodYear: periodYear ? parseInt(periodYear) : undefined,
          source: "manual_upload",
          userId: user.id,
        });

        if (!result.success) {
          return NextResponse.json(
            { error: result.error ?? "שגיאה בעיבוד קובץ חבר" },
            { status: 500 }
          );
        }

        return NextResponse.json({ heverUpload: true, summary: result.summary }, { status: 201 });
      }
    }

    // ---- CLIENT REPORT / COMMISSION INVOICE UPLOAD ----
    if (!franchiseeId) {
      return NextResponse.json({ error: "נדרש זכיין" }, { status: 400 });
    }
    if (!periodMonth || !periodYear) {
      return NextResponse.json(
        { error: "נדרשים חודש ושנה" },
        { status: 400 }
      );
    }
    if (!clientId) {
      return NextResponse.json(
        { error: "נדרש לקוח עבור דוח לקוח" },
        { status: 400 }
      );
    }

    // Determine parser code
    const [clientRecord] = await database
      .select({ code: client.code, parserCode: client.parserCode })
      .from(client)
      .where(eq(client.id, clientId))
      .limit(1);

    if (!clientRecord) {
      return NextResponse.json({ error: "לקוח לא נמצא" }, { status: 404 });
    }

    const parserCode = clientRecord.parserCode ?? clientRecord.code ?? "";

    // Process through unified pipeline
    const result = await processClientDocument({
      buffer,
      fileName: file.name,
      mimeType: file.type || "application/octet-stream",
      clientId,
      parserCode,
      franchiseeId,
      periodMonth: parseInt(periodMonth),
      periodYear: parseInt(periodYear),
      documentType: documentType as "client_report" | "commission_invoice",
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
