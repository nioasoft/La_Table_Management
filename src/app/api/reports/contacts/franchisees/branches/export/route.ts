import { NextRequest, NextResponse } from "next/server";
import {
  requireAdminOrSuperUser,
  isAuthError,
} from "@/lib/api-middleware";
import * as XLSX from "xlsx";
import { getFranchiseesWithContacts } from "@/data-access/franchisees";
import { formatDateAsLocal } from "@/lib/date-utils";

/**
 * GET /api/reports/contacts/franchisees/branches/export
 * Export branch directory to Excel with one row per franchisee (branch)
 * Includes company ID, address, and primary contact info
 */
export async function GET(request: NextRequest) {
  try {
    const authResult = await requireAdminOrSuperUser(request);
    if (isAuthError(authResult)) return authResult;

    const franchisees = await getFranchiseesWithContacts({ category: "all" });

    const headers = [
      "מותג",
      "שם הסניף",
      "ח.פ.",
      "כתובת",
      "שם איש קשר",
      "טלפון",
      "אימייל",
    ];

    const rows: string[][] = [];

    for (const f of franchisees) {
      const brandName = f.brand?.nameHe ?? "-";

      // Build address from address + city
      const addressParts = [f.address, f.city].filter(Boolean);
      const fullAddress = addressParts.length > 0 ? addressParts.join(", ") : "-";

      // Resolve primary contact: isPrimary contact first, then franchisee-level fields, then legacy
      let contactName = "-";
      let contactPhone = "-";
      let contactEmail = "-";

      const primaryContact =
        f.contacts?.find((c) => c.isPrimary) ??
        f.contacts?.find((c) => c.role === "owner") ??
        f.contacts?.[0] ??
        null;
      if (primaryContact) {
        contactName = primaryContact.name || "-";
        contactPhone = primaryContact.phone || "-";
        contactEmail = primaryContact.email || "-";
      } else if (f.primaryContactName || f.primaryContactPhone || f.primaryContactEmail) {
        contactName = f.primaryContactName || "-";
        contactPhone = f.primaryContactPhone || "-";
        contactEmail = f.primaryContactEmail || "-";
      } else {
        contactName = f.ownerName || "-";
        contactPhone = f.contactPhone || "-";
        contactEmail = f.contactEmail || "-";
      }

      rows.push([
        brandName,
        f.name,
        f.companyId || "-",
        fullAddress,
        contactName,
        contactPhone,
        contactEmail,
      ]);
    }

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);

    ws["!cols"] = [
      { wch: 15 }, // מותג
      { wch: 25 }, // שם הסניף
      { wch: 15 }, // ח.פ.
      { wch: 35 }, // כתובת
      { wch: 20 }, // שם איש קשר
      { wch: 18 }, // טלפון
      { wch: 30 }, // אימייל
    ];

    XLSX.utils.book_append_sheet(wb, ws, "רשימת סניפים");

    const buffer = XLSX.write(wb, { bookType: "xlsx", type: "buffer" });
    const today = formatDateAsLocal(new Date());
    const filename = `branch_directory_${today}.xlsx`;

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    console.error("Error exporting branch directory:", error);
    return NextResponse.json(
      { error: "שגיאה בייצוא רשימת סניפים" },
      { status: 500 }
    );
  }
}
