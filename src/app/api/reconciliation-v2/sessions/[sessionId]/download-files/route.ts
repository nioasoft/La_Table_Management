import { NextRequest, NextResponse } from "next/server";
import AdmZip from "adm-zip";
import { requireAdminOrSuperUser, isAuthError } from "@/lib/api-middleware";
import { getSessionById, getSupplierPeriods } from "@/data-access/reconciliation-v2";
import { getUnifiedFileByIdForDownload } from "@/data-access/unified-files";

interface RouteParams {
  params: Promise<{ sessionId: string }>;
}

/**
 * GET /api/reconciliation-v2/sessions/[sessionId]/download-files
 *
 * Downloads the supplier file(s) behind a reconciliation session.
 * Multi-file suppliers (דגי הקיבוצים — one file per branch) get every file of
 * the period zipped; everyone else redirects straight to the single blob URL.
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const authResult = await requireAdminOrSuperUser(request);
    if (isAuthError(authResult)) return authResult;

    const { sessionId } = await params;
    const session = await getSessionById(sessionId);
    if (!session) {
      return NextResponse.json({ error: "סשן לא נמצא" }, { status: 404 });
    }

    // Same grouping the session was built from — honours maxUploadFiles, so
    // single-file suppliers never get stale re-uploads bundled in.
    const periodKey = `${session.periodStartDate}_${session.periodEndDate}`;
    const period = (await getSupplierPeriods(session.supplierId)).find(
      (p) => p.periodKey === periodKey
    );
    const fileIds = period?.supplierFileIds?.length
      ? period.supplierFileIds
      : [session.supplierFileId].filter((id): id is string => !!id);

    const files = (
      await Promise.all(fileIds.map((id) => getUnifiedFileByIdForDownload(id, "supplier")))
    ).filter((f): f is NonNullable<typeof f> => !!f?.fileUrl);

    if (files.length === 0) {
      return NextResponse.json({ error: "קישור להורדה לא זמין" }, { status: 404 });
    }

    if (files.length === 1) {
      return NextResponse.redirect(files[0].fileUrl!, 302);
    }

    const zip = new AdmZip();
    const usedNames = new Set<string>();
    for (const file of files) {
      const response = await fetch(file.fileUrl!);
      if (!response.ok) continue;
      // Suppliers reuse the same filename across branches — dedupe or entries drop.
      let name = file.fileName;
      for (let i = 2; usedNames.has(name); i++) {
        name = file.fileName.replace(/(\.[^.]+)?$/, `_${i}$1`);
      }
      usedNames.add(name);
      zip.addFile(name, Buffer.from(await response.arrayBuffer()));
    }

    if (zip.getEntries().length === 0) {
      return NextResponse.json({ error: "שגיאה בהורדת הקבצים" }, { status: 502 });
    }

    const zipName = encodeURIComponent(`${session.supplierName} ${periodKey}.zip`);
    return new NextResponse(new Uint8Array(zip.toBuffer()), {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename*=UTF-8''${zipName}`,
      },
    });
  } catch (error) {
    console.error("Error downloading session files:", error);
    return NextResponse.json({ error: "שגיאה בהורדת הקבצים" }, { status: 500 });
  }
}
