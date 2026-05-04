import { NextRequest, NextResponse } from "next/server";
import { eq, and } from "drizzle-orm";
import { database } from "@/db";
import {
  supplier,
  supplierBrand,
  brand,
  franchisee,
  contact,
  fileRequest,
} from "@/db/schema";
import { requireAdminOrSuperUser, isAuthError } from "@/lib/api-middleware";
import { createFileRequest } from "@/data-access/fileRequests";
import { getOrCreateSettlementPeriodByPeriodKey } from "@/data-access/settlements";
import { getEmailTemplateByCode } from "@/data-access/emailTemplates";
import { getPeriodsForFrequency } from "@/lib/settlement-periods";
import { formatDateAsLocal } from "@/lib/date-utils";

/**
 * Manual "send reminder" endpoint for the Schedules tab in Communications.
 *
 * Mirrors the per-entity logic of the settlement-requests / bkmv-requests
 * cron jobs so that a manual click produces the same file_request as the
 * automated daily run. Always targets the most recently CLOSED period (for
 * suppliers) or the most recent past BKMV cycle (for franchisees) — never
 * the open period currently in progress.
 *
 * Body: { entityType: "supplier" | "franchisee", entityId: string }
 */

function formatDateForDisplay(date: Date): string {
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const year = date.getFullYear();
  return `${day}/${month}/${year}`;
}

async function getSupplierBrandNames(supplierId: string): Promise<string> {
  const results = await database
    .select({ nameHe: brand.nameHe })
    .from(supplierBrand)
    .innerJoin(brand, eq(supplierBrand.brandId, brand.id))
    .where(eq(supplierBrand.supplierId, supplierId));
  if (results.length === 0) return "לה טייבל";
  return results.map((r) => r.nameHe).join(" / ");
}

async function hasExistingSupplierFileRequest(
  supplierId: string,
  periodDescription: string
): Promise<boolean> {
  const existing = await database
    .select()
    .from(fileRequest)
    .where(
      and(
        eq(fileRequest.entityType, "supplier"),
        eq(fileRequest.entityId, supplierId),
        eq(fileRequest.documentType, "settlement_report")
      )
    );
  for (const req of existing) {
    const meta = req.metadata as Record<string, unknown> | null;
    if (meta?.periodDescription === periodDescription) return true;
  }
  return false;
}

async function hasExistingBkmvRequest(
  franchiseeId: string,
  cycleKey: string,
  startDate: string
): Promise<boolean> {
  const existing = await database
    .select()
    .from(fileRequest)
    .where(
      and(
        eq(fileRequest.entityType, "franchisee"),
        eq(fileRequest.entityId, franchiseeId),
        eq(fileRequest.documentType, "bkmv")
      )
    );
  for (const req of existing) {
    const meta = req.metadata as Record<string, unknown> | null;
    if (meta?.requestType !== "bkmv") continue;
    if (meta?.cycleKey === cycleKey) return true;
    if (!meta?.cycleKey && meta?.startDate === startDate) {
      const created = req.createdAt ? new Date(req.createdAt) : null;
      if (created) {
        const [yearStr, monthStr] = cycleKey.split("-");
        const cycleStart = new Date(parseInt(yearStr, 10), parseInt(monthStr, 10) - 1, 15);
        const nextCycleStart = new Date(cycleStart);
        nextCycleStart.setMonth(nextCycleStart.getMonth() + 3);
        if (created >= cycleStart && created < nextCycleStart) return true;
      }
    }
  }
  return false;
}

function getCurrentBkmvCycle(date: Date): {
  year: number;
  month: number;
  cycleKey: string;
  startDate: string;
} {
  const year = date.getFullYear();
  const cycleMonths = [1, 4, 7, 10];
  let chosen: { year: number; month: number } | null = null;
  for (const m of cycleMonths) {
    const cycleDate = new Date(year, m - 1, 15);
    if (cycleDate.getTime() <= date.getTime()) chosen = { year, month: m };
  }
  if (!chosen) chosen = { year: year - 1, month: 10 };
  return {
    year: chosen.year,
    month: chosen.month,
    cycleKey: `${chosen.year}-${String(chosen.month).padStart(2, "0")}`,
    startDate: `01/01/${chosen.year}`,
  };
}

async function sendSupplierRequest(
  entityId: string,
  user: { id: string }
): Promise<{ ok: true; alreadySent: boolean; period: string } | { ok: false; status: number; error: string }> {
  const rows = await database.select().from(supplier).where(eq(supplier.id, entityId)).limit(1);
  if (rows.length === 0) return { ok: false, status: 404, error: "Supplier not found" };
  const s = rows[0];

  if (!s.isActive) return { ok: false, status: 400, error: "ספק לא פעיל" };

  const recipientEmail = s.contactEmail || s.secondaryContactEmail;
  if (!recipientEmail) {
    return { ok: false, status: 400, error: "לספק זה לא מוגדר אימייל" };
  }

  const frequency = s.settlementFrequency || "monthly";
  const periodTypeMap: Record<string, "monthly" | "quarterly" | "semi_annual" | "annual" | undefined> = {
    monthly: "monthly",
    quarterly: "quarterly",
    semi_annual: "semi_annual",
    annual: "annual",
  };
  const periodType = periodTypeMap[frequency];
  if (!periodType) {
    return { ok: false, status: 400, error: `תדירות ${frequency} לא נתמכת לשליחה ידנית` };
  }

  const now = new Date();
  const candidates = getPeriodsForFrequency(periodType, now, 1, 1, true);
  const closedPeriod = candidates.find((p) => p.endDate.getTime() <= now.getTime());
  if (!closedPeriod) {
    return { ok: false, status: 400, error: "אין תקופה סגורה לשליחת בקשה" };
  }

  const periodDescription = closedPeriod.nameHe;
  if (await hasExistingSupplierFileRequest(s.id, periodDescription)) {
    return { ok: true, alreadySent: true, period: periodDescription };
  }

  const brandNames = await getSupplierBrandNames(s.id);
  const template = await getEmailTemplateByCode("supplier_request");
  if (!template?.id) {
    return { ok: false, status: 500, error: 'תבנית אימייל "supplier_request" לא נמצאה' };
  }

  await getOrCreateSettlementPeriodByPeriodKey(closedPeriod.key);

  await createFileRequest({
    entityType: "supplier",
    entityId: s.id,
    documentType: "settlement_report",
    description: `דוח עמלות רשת עבור ${periodDescription}`,
    recipientEmail,
    recipientName: s.contactName || s.name,
    emailTemplateId: template.id,
    dueDate: formatDateAsLocal(closedPeriod.dueDate),
    maxFiles: s.fileMapping?.maxUploadFiles ?? 1,
    sendImmediately: true,
    createdBy: user.id,
    metadata: {
      settlementFrequency: frequency,
      periodDescription,
      periodEndDate: formatDateForDisplay(closedPeriod.endDate),
      brandNames,
      requestedAt: new Date().toISOString(),
      manualSend: true,
    },
  });

  return { ok: true, alreadySent: false, period: periodDescription };
}

async function sendFranchiseeBkmvRequest(
  entityId: string,
  user: { id: string }
): Promise<{ ok: true; alreadySent: boolean; cycle: string } | { ok: false; status: number; error: string }> {
  const rows = await database.select().from(franchisee).where(eq(franchisee.id, entityId)).limit(1);
  if (rows.length === 0) return { ok: false, status: 404, error: "Franchisee not found" };
  const f = rows[0];

  if (!f.isActive) return { ok: false, status: 400, error: "זכיין לא פעיל" };

  // Resolve accountant email, fall back to primary contact
  const accountants = await database
    .select({ email: contact.email, name: contact.name })
    .from(contact)
    .where(
      and(
        eq(contact.franchiseeId, f.id),
        eq(contact.role, "accountant"),
        eq(contact.isActive, true)
      )
    )
    .limit(1);
  const accountantEmail = accountants[0]?.email;
  const recipientEmail = accountantEmail || f.primaryContactEmail || f.contactEmail;
  if (!recipientEmail) {
    return { ok: false, status: 400, error: "לזכיין זה לא מוגדר אימייל רואה חשבון או איש קשר ראשי" };
  }

  const cycle = getCurrentBkmvCycle(new Date());
  if (await hasExistingBkmvRequest(f.id, cycle.cycleKey, cycle.startDate)) {
    return { ok: true, alreadySent: true, cycle: cycle.cycleKey };
  }

  const template = await getEmailTemplateByCode("bkmv_request");
  if (!template?.id) {
    return { ok: false, status: 500, error: 'תבנית אימייל "bkmv_request" לא נמצאה' };
  }

  await createFileRequest({
    entityType: "franchisee",
    entityId: f.id,
    documentType: "bkmv",
    description: `קובץ מבנה אחיד BKMV מ-${cycle.startDate} ועד היום`,
    recipientEmail,
    recipientName: accountants[0]?.name || f.primaryContactName || f.name,
    emailTemplateId: template.id,
    maxFiles: 1,
    sendImmediately: true,
    createdBy: user.id,
    metadata: {
      requestType: "bkmv",
      startDate: cycle.startDate,
      cycleKey: cycle.cycleKey,
      manualSend: true,
      requestedAt: new Date().toISOString(),
    },
  });

  return { ok: true, alreadySent: false, cycle: cycle.cycleKey };
}

export async function POST(request: NextRequest) {
  const authResult = await requireAdminOrSuperUser(request);
  if (isAuthError(authResult)) return authResult;
  const { user } = authResult;

  let body: { entityType?: string; entityId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { entityType, entityId } = body;
  if (!entityType || !entityId) {
    return NextResponse.json({ error: "entityType and entityId are required" }, { status: 400 });
  }

  try {
    if (entityType === "supplier") {
      const result = await sendSupplierRequest(entityId, user);
      if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
      return NextResponse.json({
        success: true,
        alreadySent: result.alreadySent,
        period: result.period,
        message: result.alreadySent
          ? `כבר נשלחה בקשה לתקופה ${result.period}`
          : `נשלחה בקשה לתקופה ${result.period}`,
      });
    }

    if (entityType === "franchisee") {
      const result = await sendFranchiseeBkmvRequest(entityId, user);
      if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
      return NextResponse.json({
        success: true,
        alreadySent: result.alreadySent,
        cycle: result.cycle,
        message: result.alreadySent
          ? `כבר נשלחה בקשת BKMV למחזור ${result.cycle}`
          : `נשלחה בקשת BKMV למחזור ${result.cycle}`,
      });
    }

    return NextResponse.json({ error: "entityType must be 'supplier' or 'franchisee'" }, { status: 400 });
  } catch (error) {
    console.error("Error sending manual schedule request:", error);
    return NextResponse.json(
      {
        error: "שגיאה בשליחת הבקשה",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
