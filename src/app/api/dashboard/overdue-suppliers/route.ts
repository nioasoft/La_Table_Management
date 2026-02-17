import { NextRequest, NextResponse } from "next/server";
import {
  requireAdminOrSuperUser,
  isAuthError,
} from "@/lib/api-middleware";
import { database } from "@/db";
import { fileRequest, supplier } from "@/db/schema";
import { eq, and, sql } from "drizzle-orm";

export interface OverdueSupplierRequest {
  id: string;
  supplierId: string;
  supplierName: string;
  recipientEmail: string;
  sentAt: string | null;
  reminderCount: number;
  escalated: boolean;
  periodDescription: string;
}

export interface OverdueSuppliersResponse {
  requests: OverdueSupplierRequest[];
  total: number;
}

/**
 * GET /api/dashboard/overdue-suppliers
 * Returns supplier file requests that are in "sent" status (awaiting upload)
 */
export async function GET(request: NextRequest) {
  try {
    const authResult = await requireAdminOrSuperUser(request);
    if (isAuthError(authResult)) return authResult;

    const results = await database
      .select({
        id: fileRequest.id,
        entityId: fileRequest.entityId,
        recipientEmail: fileRequest.recipientEmail,
        recipientName: fileRequest.recipientName,
        sentAt: fileRequest.sentAt,
        remindersSent: fileRequest.remindersSent,
        metadata: fileRequest.metadata,
        supplierName: supplier.name,
      })
      .from(fileRequest)
      .leftJoin(supplier, eq(fileRequest.entityId, supplier.id))
      .where(
        and(
          eq(fileRequest.entityType, "supplier"),
          eq(fileRequest.status, "sent")
        )
      )
      .orderBy(fileRequest.sentAt);

    const requests: OverdueSupplierRequest[] = results.map((r) => {
      const meta = r.metadata as Record<string, unknown> | null;
      const reminders = (r.remindersSent || []) as string[];
      return {
        id: r.id,
        supplierId: r.entityId,
        supplierName: r.supplierName || r.recipientName || r.recipientEmail,
        recipientEmail: r.recipientEmail,
        sentAt: r.sentAt ? new Date(r.sentAt).toISOString() : null,
        reminderCount: reminders.length,
        escalated: !!(meta?.escalatedToAdmin),
        periodDescription: (meta?.periodDescription as string) || "",
      };
    });

    return NextResponse.json({
      requests,
      total: requests.length,
    } satisfies OverdueSuppliersResponse);
  } catch (error) {
    console.error("Error fetching overdue suppliers:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
