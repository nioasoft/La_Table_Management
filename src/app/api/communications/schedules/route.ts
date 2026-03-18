import { NextRequest, NextResponse } from "next/server";
import {
  requireAdminOrSuperUser,
  isAuthError,
} from "@/lib/api-middleware";
import { database } from "@/db";
import { supplier, franchisee, contact, fileRequest } from "@/db/schema";
import { eq, and, sql } from "drizzle-orm";
import type { SettlementFrequency, Supplier, Franchisee } from "@/db/schema";

/**
 * Calculate next request date based on settlement frequency
 */
function calculateNextRequestDate(
  frequency: SettlementFrequency,
  fromDate: Date = new Date()
): Date {
  const next = new Date(fromDate);

  switch (frequency) {
    case "weekly":
      // Next Monday
      const daysUntilMonday = (8 - next.getDay()) % 7 || 7;
      next.setDate(next.getDate() + daysUntilMonday);
      break;
    case "bi_weekly":
      // 1st or 15th of month
      if (next.getDate() < 15) {
        next.setDate(15);
      } else {
        next.setMonth(next.getMonth() + 1);
        next.setDate(1);
      }
      break;
    case "monthly":
      // 1st of next month
      next.setMonth(next.getMonth() + 1);
      next.setDate(1);
      break;
    case "quarterly":
      // 1st of next quarter (Jan, Apr, Jul, Oct)
      const currentQuarter = Math.floor(next.getMonth() / 3);
      const nextQuarterMonth = (currentQuarter + 1) * 3;
      if (nextQuarterMonth >= 12) {
        next.setFullYear(next.getFullYear() + 1);
        next.setMonth(0);
      } else {
        next.setMonth(nextQuarterMonth);
      }
      next.setDate(1);
      break;
    case "semi_annual":
      // 1st of Jan or Jul
      if (next.getMonth() < 6) {
        next.setMonth(6);
      } else {
        next.setFullYear(next.getFullYear() + 1);
        next.setMonth(0);
      }
      next.setDate(1);
      break;
    case "annual":
      // 1st of January
      next.setFullYear(next.getFullYear() + 1);
      next.setMonth(0);
      next.setDate(1);
      break;
  }

  return next;
}

/**
 * Get Hebrew label for settlement frequency
 */
function getFrequencyLabel(frequency: SettlementFrequency): string {
  const labels: Record<SettlementFrequency, string> = {
    weekly: "שבועי",
    bi_weekly: "דו-שבועי",
    monthly: "חודשי",
    quarterly: "רבעוני",
    semi_annual: "חצי שנתי",
    annual: "שנתי",
  };
  return labels[frequency] || frequency;
}

/**
 * Calculate the next BKMV request date (15th of Jan/Apr/Jul/Oct)
 */
function getNextBkmvDate(): Date {
  const now = new Date();
  const year = now.getFullYear();
  const bkmvDates = [
    new Date(year, 0, 15), // Jan 15
    new Date(year, 3, 15), // Apr 15
    new Date(year, 6, 15), // Jul 15
    new Date(year, 9, 15), // Oct 15
  ];

  for (const d of bkmvDates) {
    if (d > now) return d;
  }
  return new Date(year + 1, 0, 15);
}

interface ScheduleItem {
  id: string;
  name: string;
  code: string;
  type: "supplier" | "franchisee";
  frequency: SettlementFrequency;
  frequencyLabel: string;
  email: string | null;
  contactName: string | null;
  lastRequestDate: string | null;
  nextRequestDate: string;
  pendingRequests: number;
  isActive: boolean;
}

/**
 * GET /api/communications/schedules - Get communication schedules for suppliers and franchisees
 *
 * Query params:
 * - type: filter by entity type (supplier, franchisee, all)
 * - frequency: filter by settlement frequency
 * - activeOnly: only show active entities (default: true)
 */
export async function GET(request: NextRequest) {
  try {
    // Verify authentication
    const authResult = await requireAdminOrSuperUser(request);
    if (isAuthError(authResult)) return authResult;

    const searchParams = request.nextUrl.searchParams;
    const entityType = searchParams.get("type") || "all";
    const frequencyFilter = searchParams.get("frequency") as SettlementFrequency | null;
    const activeOnly = searchParams.get("activeOnly") !== "false";

    const schedules: ScheduleItem[] = [];

    // Get suppliers
    if (entityType === "all" || entityType === "supplier") {
      const supplierConditions = [];
      if (activeOnly) {
        supplierConditions.push(eq(supplier.isActive, true));
      }
      if (frequencyFilter) {
        supplierConditions.push(eq(supplier.settlementFrequency, frequencyFilter));
      }

      const suppliers = await database
        .select()
        .from(supplier)
        .where(
          supplierConditions.length > 0 ? and(...supplierConditions) : undefined
        )
        .orderBy(supplier.name) as Supplier[];

      // Get pending file requests count per supplier
      const pendingRequestsQuery = await database
        .select({
          entityId: fileRequest.entityId,
          count: sql<number>`count(*)::int`,
        })
        .from(fileRequest)
        .where(
          and(
            eq(fileRequest.entityType, "supplier"),
            eq(fileRequest.status, "sent")
          )
        )
        .groupBy(fileRequest.entityId);

      const pendingRequestsMap = new Map(
        pendingRequestsQuery.map((r) => [r.entityId, r.count])
      );

      // Get last file request date per supplier
      const lastRequestsQuery = await database
        .select({
          entityId: fileRequest.entityId,
          lastSentAt: sql<string>`max(${fileRequest.sentAt})`,
        })
        .from(fileRequest)
        .where(eq(fileRequest.entityType, "supplier"))
        .groupBy(fileRequest.entityId);

      const lastRequestsMap = new Map(
        lastRequestsQuery.map((r) => [r.entityId, r.lastSentAt])
      );

      for (const s of suppliers) {
        const frequency = s.settlementFrequency || "monthly";
        const lastRequestDate = lastRequestsMap.get(s.id);

        schedules.push({
          id: s.id,
          name: s.name,
          code: s.code,
          type: "supplier",
          frequency,
          frequencyLabel: getFrequencyLabel(frequency),
          email: s.contactEmail || s.secondaryContactEmail || null,
          contactName: s.contactName || s.secondaryContactName || null,
          lastRequestDate: lastRequestDate ? new Date(lastRequestDate).toISOString() : null,
          nextRequestDate: calculateNextRequestDate(frequency).toISOString(),
          pendingRequests: pendingRequestsMap.get(s.id) || 0,
          isActive: s.isActive,
        });
      }
    }

    // Get franchisees (quarterly BKMV file requests)
    if (entityType === "all" || entityType === "franchisee") {
      // Only show franchisees when no frequency filter or filtering by quarterly
      if (!frequencyFilter || frequencyFilter === "quarterly") {
        const franchiseeConditions = [eq(franchisee.category, "regular")];
        if (activeOnly) {
          franchiseeConditions.push(eq(franchisee.isActive, true));
        }

        const franchisees = await database
          .select()
          .from(franchisee)
          .where(and(...franchiseeConditions))
          .orderBy(franchisee.name) as Franchisee[];

        // Get accountant emails for all franchisees
        const accountantContacts = await database
          .select({
            franchiseeId: contact.franchiseeId,
            email: contact.email,
            name: contact.name,
          })
          .from(contact)
          .where(
            and(
              eq(contact.role, "accountant"),
              eq(contact.isActive, true)
            )
          );

        const accountantMap = new Map(
          accountantContacts.map((c) => [c.franchiseeId, { email: c.email, name: c.name }])
        );

        // Get pending BKMV file requests per franchisee
        const pendingBkmvQuery = await database
          .select({
            entityId: fileRequest.entityId,
            count: sql<number>`count(*)::int`,
          })
          .from(fileRequest)
          .where(
            and(
              eq(fileRequest.entityType, "franchisee"),
              eq(fileRequest.documentType, "bkmv"),
              eq(fileRequest.status, "sent")
            )
          )
          .groupBy(fileRequest.entityId);

        const pendingBkmvMap = new Map(
          pendingBkmvQuery.map((r) => [r.entityId, r.count])
        );

        // Get last BKMV file request date per franchisee
        const lastBkmvQuery = await database
          .select({
            entityId: fileRequest.entityId,
            lastSentAt: sql<string>`max(${fileRequest.sentAt})`,
          })
          .from(fileRequest)
          .where(
            and(
              eq(fileRequest.entityType, "franchisee"),
              eq(fileRequest.documentType, "bkmv")
            )
          )
          .groupBy(fileRequest.entityId);

        const lastBkmvMap = new Map(
          lastBkmvQuery.map((r) => [r.entityId, r.lastSentAt])
        );

        const nextBkmvDate = getNextBkmvDate();

        for (const f of franchisees) {
          const accountant = accountantMap.get(f.id);
          const fallbackEmail = f.primaryContactEmail || f.contactEmail;
          const lastRequestDate = lastBkmvMap.get(f.id);

          schedules.push({
            id: f.id,
            name: f.name,
            code: f.code,
            type: "franchisee",
            frequency: "quarterly",
            frequencyLabel: "רבעוני (BKMV)",
            email: accountant?.email || fallbackEmail || null,
            contactName: accountant?.name || f.primaryContactName || null,
            lastRequestDate: lastRequestDate ? new Date(lastRequestDate).toISOString() : null,
            nextRequestDate: nextBkmvDate.toISOString(),
            pendingRequests: pendingBkmvMap.get(f.id) || 0,
            isActive: f.isActive,
          });
        }
      }
    }

    // Sort by next request date
    schedules.sort((a, b) =>
      new Date(a.nextRequestDate).getTime() - new Date(b.nextRequestDate).getTime()
    );

    // Calculate stats
    const stats = {
      total: schedules.length,
      byFrequency: {} as Record<string, number>,
      withPendingRequests: schedules.filter((s) => s.pendingRequests > 0).length,
      withoutEmail: schedules.filter((s) => !s.email).length,
    };

    for (const schedule of schedules) {
      stats.byFrequency[schedule.frequency] =
        (stats.byFrequency[schedule.frequency] || 0) + 1;
    }

    return NextResponse.json({
      schedules,
      stats,
    });
  } catch (error) {
    console.error("Error fetching schedules:", error);
    return NextResponse.json(
      {
        error: "Internal server error",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
