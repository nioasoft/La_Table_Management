import { NextRequest, NextResponse } from "next/server";
import {
  requireAdminOrSuperUser,
  isAuthError,
} from "@/lib/api-middleware";
import { database } from "@/db";
import { fileRequest, supplier } from "@/db/schema";
import { eq, and } from "drizzle-orm";

export interface OverdueSupplierGroup {
  supplierId: string;
  supplierName: string;
  pendingPeriods: number;
  oldestRequestId: string;
  escalated: boolean;
}

export interface OverdueSuppliersResponse {
  suppliers: OverdueSupplierGroup[];
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

    // Group by supplier
    const groupMap = new Map<string, OverdueSupplierGroup>();
    for (const r of results) {
      const meta = r.metadata as Record<string, unknown> | null;
      const supplierId = r.entityId;
      const existing = groupMap.get(supplierId);
      if (existing) {
        existing.pendingPeriods += 1;
        existing.escalated = existing.escalated || !!(meta?.escalatedToAdmin);
      } else {
        groupMap.set(supplierId, {
          supplierId,
          supplierName: r.supplierName || r.recipientName || r.recipientEmail,
          pendingPeriods: 1,
          oldestRequestId: r.id,
          escalated: !!(meta?.escalatedToAdmin),
        });
      }
    }

    const suppliers = Array.from(groupMap.values()).sort(
      (a, b) => b.pendingPeriods - a.pendingPeriods
    );

    return NextResponse.json({
      suppliers,
      total: suppliers.length,
    } satisfies OverdueSuppliersResponse);
  } catch (error) {
    console.error("Error fetching overdue suppliers:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
