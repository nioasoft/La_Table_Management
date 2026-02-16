import { NextRequest, NextResponse } from "next/server";
import {
  requireAdminOrSuperUser,
  isAuthError,
} from "@/lib/api-middleware";
import * as XLSX from "xlsx";
import { getFranchiseesWithContacts } from "@/data-access/franchisees";
import { formatDateAsLocal } from "@/lib/date-utils";

/**
 * GET /api/reports/contacts/franchisees/export
 * Export franchisee contacts to Excel with one row per owner (from contact table)
 */
export async function GET(request: NextRequest) {
  try {
    const authResult = await requireAdminOrSuperUser(request);
    if (isAuthError(authResult)) return authResult;

    const franchisees = await getFranchiseesWithContacts({ category: "all" });

    const headers = [
      "מותג",
      "שם זכיין",
      "שם בעלים",
      "טלפון בעלים",
      "אימייל בעלים",
      "אחוז בעלות",
    ];

    const rows: (string | number)[][] = [];

    for (const f of franchisees) {
      const brandName = f.brand?.nameHe ?? "-";
      // Get owner contacts from the contact table
      const ownerContacts = f.contacts?.filter((c) => c.role === "owner") || [];

      if (ownerContacts.length > 0) {
        for (const owner of ownerContacts) {
          rows.push([
            brandName,
            f.name,
            owner.name || "-",
            owner.phone || "-",
            owner.email || "-",
            owner.ownershipPercentage ? parseFloat(owner.ownershipPercentage) : 0,
          ]);
        }
      } else {
        // Fallback to legacy JSONB owners field
        const legacyOwners = f.owners as Array<{
          name: string;
          phone: string;
          email: string;
          ownershipPercentage?: number;
        }> | null;

        if (legacyOwners && legacyOwners.length > 0) {
          for (const owner of legacyOwners) {
            rows.push([
              brandName,
              f.name,
              owner.name || "-",
              owner.phone || "-",
              owner.email || "-",
              owner.ownershipPercentage ?? 0,
            ]);
          }
        } else {
          // No owners at all
          rows.push([
            brandName,
            f.name,
            f.ownerName || "-",
            f.contactPhone || "-",
            f.contactEmail || "-",
            0,
          ]);
        }
      }
    }

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);

    ws["!cols"] = [
      { wch: 15 }, // מותג
      { wch: 25 }, // שם זכיין
      { wch: 20 }, // שם בעלים
      { wch: 18 }, // טלפון
      { wch: 30 }, // אימייל
      { wch: 12 }, // אחוז בעלות
    ];

    XLSX.utils.book_append_sheet(wb, ws, "אנשי קשר זכיינים");

    const buffer = XLSX.write(wb, { bookType: "xlsx", type: "buffer" });
    const today = formatDateAsLocal(new Date());
    const filename = `franchisee_contacts_${today}.xlsx`;

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    console.error("Error exporting franchisee contacts:", error);
    return NextResponse.json(
      { error: "שגיאה בייצוא דוח אנשי קשר זכיינים" },
      { status: 500 }
    );
  }
}
