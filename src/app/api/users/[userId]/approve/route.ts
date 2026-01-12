import { NextRequest, NextResponse } from "next/server";
import {
  requireRole,
  isAuthError,
} from "@/lib/api-middleware";
import { approveUser, getUserById } from "@/data-access/users";
import { createAuditContext } from "@/data-access/auditLog";
import type { UserRole } from "@/db/schema";

interface RouteContext {
  params: Promise<{ userId: string }>;
}

/**
 * POST /api/users/[userId]/approve - Approve a pending user and assign role
 */
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const authResult = await requireRole(request, ["super_user"]);
    if (isAuthError(authResult)) return authResult;
    const { user } = authResult;

    const { userId } = await context.params;
    const body = await request.json();
    const { role } = body as { role: UserRole };

    if (!role) {
      return NextResponse.json(
        { error: "Role is required for approval" },
        { status: 400 }
      );
    }

    // Validate role
    const validRoles: UserRole[] = ["super_user", "admin", "franchisee_owner"];
    if (!validRoles.includes(role)) {
      return NextResponse.json({ error: "Invalid role" }, { status: 400 });
    }

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
    const auditContext = createAuditContext({ user }, request);

    const approvedUser = await approveUser(userId, role, user.id, auditContext);
    if (!approvedUser) {
      return NextResponse.json(
        { error: "Failed to approve user" },
        { status: 500 }
      );
    }

    return NextResponse.json({ user: approvedUser });
  } catch (error) {
    console.error("Error approving user:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
