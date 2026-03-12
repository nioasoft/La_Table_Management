import { NextRequest, NextResponse } from "next/server";
import {
  requireAdminOrSuperUser,
  isAuthError,
} from "@/lib/api-middleware";
import * as XLSX from "xlsx";
import { getStaffContacts } from "@/data-access/staff-contacts";
import { formatDateAsLocal } from "@/lib/date-utils";
import { he } from "@/lib/translations/he";

const ROLE_LABELS = he.staffContacts.roles;

/**
 * GET /api/reports/contacts/staff/export
 * Export staff contacts to Excel
 */
export async function GET(request: NextRequest) {
  try {
    const authResult = await requireAdminOrSuperUser(request);
    if (isAuthError(authResult)) return authResult;

    const staffContacts = await getStaffContacts({ isActive: true });

    const headers = ["תפקיד", "מותג / קבוצה", "שם", "טלפון", "אימייל"];

    const rows = staffContacts.map((contact) => [
      ROLE_LABELS[contact.role as keyof typeof ROLE_LABELS] || contact.role,
      contact.brand?.nameHe || he.staffContacts.group,
      contact.name,
      contact.phone || "-",
      contact.email || "-",
    ]);

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);

    ws["!cols"] = [
      { wch: 15 }, // תפקיד
      { wch: 20 }, // מותג / קבוצה
      { wch: 20 }, // שם
      { wch: 18 }, // טלפון
      { wch: 30 }, // אימייל
    ];

    XLSX.utils.book_append_sheet(wb, ws, "אנשי מטה");

    const buffer = XLSX.write(wb, { bookType: "xlsx", type: "buffer" });
    const today = formatDateAsLocal(new Date());
    const filename = `staff_contacts_${today}.xlsx`;

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    console.error("Error exporting staff contacts:", error);
    return NextResponse.json(
      { error: "שגיאה בייצוא דוח אנשי מטה" },
      { status: 500 }
    );
  }
}
