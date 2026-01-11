import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/utils/auth";
import { getUserById, deleteUser } from "@/data-access/users";
import { createAuditContext, logAuditEvent } from "@/data-access/auditLog";

interface RouteContext {
  params: Promise<{ userId: string }>;
}

/**
 * POST /api/users/[userId]/reject - Reject a pending user
 * This deletes the user from the system
 */
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const session = await auth.api.getSession({
      headers: request.headers,
    });

    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Only super_user can reject users
    const userRole = (session.user as typeof session.user & { role?: string })
      .role;
    if (userRole !== "super_user") {
      return NextResponse.json(
        { error: "Only Super User can reject users" },
        { status: 403 }
      );
    }

    const { userId } = await context.params;
    const body = await request.json().catch(() => ({}));
    const { reason } = body as { reason?: string };

    // Check if user exists and is pending
    const targetUser = await getUserById(userId);
    if (!targetUser) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    if (targetUser.status !== "pending") {
      return NextResponse.json(
        { error: "User is not pending approval" },
        { status: 400 }
      );
    }

    // Create audit context for logging
    const auditContext = createAuditContext(session, request);

    // Log the rejection before deleting
    await logAuditEvent(
      auditContext,
      "reject",
      "user",
      userId,
      {
        entityName: targetUser.name,
        beforeValue: {
          name: targetUser.name,
          email: targetUser.email,
          status: targetUser.status,
        },
        afterValue: null,
        reason: reason || "User registration rejected",
      }
    );

    // Delete the rejected user
    const deleted = await deleteUser(userId);
    if (!deleted) {
      return NextResponse.json(
        { error: "Failed to reject user" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: "User registration rejected and removed",
    });
  } catch (error) {
    console.error("Error rejecting user:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
