import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { database } from "@/db";
import { franchisee } from "@/db/schema";
import { requireAdminOrSuperUser, isAuthError } from "@/lib/api-middleware";
import { logAuditEvent, createAuditContext } from "@/data-access/auditLog";
import { normalizeBusinessId } from "@/lib/business-id-utils";

/**
 * POST /api/admin/franchisees/[id]/update-company-id
 *
 * 1-click corrective action invoked from the AnomalyReviewModal when an
 * UNKNOWN_BUSINESS_ID or BIZ_ID_MISMATCH anomaly is resolved by updating
 * the franchisee's stored company_id to the value found in the supplier
 * file. Writes an audit_log entry capturing before/after.
 *
 * Auth: admin or super_user only.
 *
 * Body: { newCompanyId: string }
 *   newCompanyId — the value from the file (already trimmed; we re-normalize
 *   server-side defensively).
 */

const bodySchema = z.object({
  newCompanyId: z.string().min(1, "newCompanyId is required"),
});

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(
  request: NextRequest,
  context: RouteContext
): Promise<NextResponse> {
  const authResult = await requireAdminOrSuperUser(request);
  if (isAuthError(authResult)) return authResult;
  const user = authResult.user;

  const { id } = await context.params;
  if (!id) {
    return NextResponse.json(
      { error: "Missing franchisee id" },
      { status: 400 }
    );
  }

  let body: z.infer<typeof bodySchema>;
  try {
    const json = await request.json();
    body = bodySchema.parse(json);
  } catch (err) {
    return NextResponse.json(
      { error: "Invalid request body", details: err instanceof Error ? err.message : "parse error" },
      { status: 400 }
    );
  }

  const normalized = normalizeBusinessId(body.newCompanyId);
  if (!normalized) {
    return NextResponse.json(
      { error: "newCompanyId could not be normalized to a digit string" },
      { status: 400 }
    );
  }

  const existing = await database
    .select()
    .from(franchisee)
    .where(eq(franchisee.id, id))
    .limit(1);

  if (existing.length === 0) {
    return NextResponse.json(
      { error: "Franchisee not found" },
      { status: 404 }
    );
  }
  const before = existing[0];
  const previousCompanyId = before.companyId ?? null;

  if (previousCompanyId === normalized) {
    return NextResponse.json({
      success: true,
      noChange: true,
      franchisee: { id, companyId: normalized },
    });
  }

  await database
    .update(franchisee)
    .set({ companyId: normalized, updatedAt: new Date() })
    .where(eq(franchisee.id, id));

  // Audit log: include both old and new values so this change can be reviewed.
  try {
    const auditContext = createAuditContext(
      { user: { id: user.id, name: user.name, email: user.email } },
      request
    );
    await logAuditEvent(auditContext, "update", "franchisee", id, {
      entityName: before.name,
      beforeValue: { companyId: previousCompanyId },
      afterValue: { companyId: normalized },
      reason: "Resolved UNKNOWN_BUSINESS_ID / BIZ_ID_MISMATCH anomaly via 1-click action.",
      metadata: { source: "anomaly-review-modal" },
    });
  } catch (logErr) {
    // Audit failure must not block the user-facing fix; surface it in logs only.
    console.error("[update-company-id] audit log failed:", logErr);
  }

  return NextResponse.json({
    success: true,
    franchisee: {
      id,
      name: before.name,
      previousCompanyId,
      newCompanyId: normalized,
    },
  });
}
