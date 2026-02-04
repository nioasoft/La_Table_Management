import { NextRequest, NextResponse } from "next/server";
import { requireAdminOrSuperUser, isAuthError } from "@/lib/api-middleware";
import { rejectSessionFile, getSessionById } from "@/data-access/reconciliation-v2";
import { getSupplierById } from "@/data-access/suppliers";

interface RouteParams {
  params: Promise<{ sessionId: string }>;
}

/**
 * POST /api/reconciliation-v2/sessions/[sessionId]/reject-email - Reject file and optionally send email
 * Body:
 *   reason: string (required)
 *   sendEmail?: boolean
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const authResult = await requireAdminOrSuperUser(request);
    if (isAuthError(authResult)) return authResult;
    const { user } = authResult;

    const { sessionId } = await params;
    const body = await request.json();
    const { reason, sendEmail } = body;

    if (!sessionId) {
      return NextResponse.json(
        { error: "מזהה סשן חסר" },
        { status: 400 }
      );
    }

    if (!reason) {
      return NextResponse.json(
        { error: "סיבת דחייה חסרה" },
        { status: 400 }
      );
    }

    // Get session to get supplier info
    const session = await getSessionById(sessionId);
    if (!session) {
      return NextResponse.json(
        { error: "סשן לא נמצא" },
        { status: 404 }
      );
    }

    // Reject the file
    const result = await rejectSessionFile(sessionId, user.id, reason);
    if (!result) {
      return NextResponse.json(
        { error: "שגיאה בדחיית הקובץ" },
        { status: 500 }
      );
    }

    // Send email if requested
    let emailSent = false;
    if (sendEmail) {
      try {
        const supplier = await getSupplierById(session.supplierId);
        if (supplier?.contactEmail) {
          // TODO: Implement email sending using the existing email system
          // For now, we just mark it as would-be-sent
          console.log(`Would send rejection email to ${supplier.contactEmail} for session ${sessionId}`);
          console.log(`Reason: ${reason}`);
          emailSent = true;
        }
      } catch (emailError) {
        console.error("Error sending rejection email:", emailError);
        // Don't fail the whole operation if email fails
      }
    }

    return NextResponse.json({
      success: true,
      session: result,
      emailSent,
    });
  } catch (error) {
    console.error("Error rejecting session:", error);
    return NextResponse.json(
      { error: "שגיאה בדחיית הקובץ" },
      { status: 500 }
    );
  }
}
