import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminOrSuperUser, isAuthError } from "@/lib/api-middleware";
import { database } from "@/db";
import { reconciliationSession, supplier } from "@/db/schema";
import { eq } from "drizzle-orm";
import { sendDirectEmail } from "@/lib/email";

interface RouteParams {
  params: Promise<{ sessionId: string }>;
}

const bodySchema = z.object({
  to: z.string().email("כתובת מייל לא תקינה"),
  subject: z.string().min(1, "נושא חסר").max(200, "נושא ארוך מדי"),
  bodyHtml: z.string().min(1, "גוף ההודעה ריק"),
  bodyText: z.string().optional(),
});

/**
 * Strip HTML tags to produce a plain-text fallback body.
 * Lightweight — sufficient for client mail readers without HTML rendering.
 */
function htmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * POST /api/reconciliation-v2/sessions/[sessionId]/email
 *
 * Send a free-form email to the supplier from inside the reconciliation page.
 * Logged in `email_logs` with entityType="reconciliation_session" so it's auditable
 * from Communications > Email Logs.
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const authResult = await requireAdminOrSuperUser(request);
    if (isAuthError(authResult)) return authResult;
    const { user } = authResult;

    const { sessionId } = await params;
    if (!sessionId) {
      return NextResponse.json({ error: "מזהה סשן חסר" }, { status: 400 });
    }

    const json = await request.json();
    const parsed = bodySchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "נתונים לא תקינים" },
        { status: 400 }
      );
    }

    const { to, subject, bodyHtml, bodyText } = parsed.data;

    // Confirm session exists + load supplier for metadata trail.
    const [row] = await database
      .select({
        sessionId: reconciliationSession.id,
        supplierId: reconciliationSession.supplierId,
        supplierName: supplier.name,
      })
      .from(reconciliationSession)
      .innerJoin(supplier, eq(reconciliationSession.supplierId, supplier.id))
      .where(eq(reconciliationSession.id, sessionId))
      .limit(1);

    if (!row) {
      return NextResponse.json({ error: "הסשן לא נמצא" }, { status: 404 });
    }

    const text = bodyText && bodyText.trim().length > 0 ? bodyText : htmlToText(bodyHtml);

    const result = await sendDirectEmail({
      to,
      subject,
      html: bodyHtml,
      text,
      entityType: "reconciliation_session",
      entityId: sessionId,
      metadata: {
        supplierId: row.supplierId,
        supplierName: row.supplierName,
        sentBy: user.id,
        source: "reconciliation_v2_composer",
      },
    });

    if (!result.success) {
      return NextResponse.json(
        { error: result.error ?? "שליחת המייל נכשלה" },
        { status: 502 }
      );
    }

    return NextResponse.json({
      success: true,
      messageId: result.messageId,
    });
  } catch (error) {
    console.error("[reconciliation email] failed:", error);
    return NextResponse.json(
      { error: "שגיאה בשליחת המייל" },
      { status: 500 }
    );
  }
}
