import { NextRequest, NextResponse } from "next/server";
import {
  requireAdminOrSuperUser,
  isAuthError,
} from "@/lib/api-middleware";
import * as XLSX from "xlsx";
import { getSuppliersWithBrands } from "@/data-access/suppliers";
import { formatDateAsLocal } from "@/lib/date-utils";

/**
 * GET /api/reports/contacts/suppliers/export
 * Export supplier contacts to Excel
 */
export async function GET(request: NextRequest) {
  try {
    const authResult = await requireAdminOrSuperUser(request);
    if (isAuthError(authResult)) return authResult;

    const suppliers = await getSuppliersWithBrands();

    const headers = [
      "שם ספק",
      "שם איש קשר",
      "טלפון",
      "אימייל",
      "שם איש קשר משני",
      "טלפון משני",
      "אימייל משני",
      "מותגים",
    ];

    const rows = suppliers.map((s) => [
      s.name,
      s.contactName || "-",
      s.contactPhone || "-",
      s.contactEmail || "-",
      s.secondaryContactName || "-",
      s.secondaryContactPhone || "-",
      s.secondaryContactEmail || "-",
      s.brands.map((b) => b.nameHe).join(", ") || "-",
    ]);

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);

    ws["!cols"] = [
      { wch: 25 }, // שם ספק
      { wch: 20 }, // שם איש קשר
      { wch: 18 }, // טלפון
      { wch: 30 }, // אימייל
      { wch: 20 }, // שם איש קשר משני
      { wch: 18 }, // טלפון משני
      { wch: 30 }, // אימייל משני
      { wch: 30 }, // מותגים
    ];

    XLSX.utils.book_append_sheet(wb, ws, "אנשי קשר ספקים");

    const buffer = XLSX.write(wb, { bookType: "xlsx", type: "buffer" });
    const today = formatDateAsLocal(new Date());
    const filename = `supplier_contacts_${today}.xlsx`;

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    console.error("Error exporting supplier contacts:", error);
    return NextResponse.json(
      { error: "שגיאה בייצוא דוח אנשי קשר ספקים" },
      { status: 500 }
    );
  }
}
