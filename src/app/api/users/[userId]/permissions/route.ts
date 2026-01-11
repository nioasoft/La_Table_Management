import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/utils/auth";
import {
  getUserById,
  updateUserPermissions,
  getUserPermissions,
  resetUserPermissionsToDefault,
} from "@/data-access/users";
import { validatePermissions } from "@/lib/permissions";
import { type UserPermissions, DEFAULT_PERMISSIONS } from "@/db/schema";

interface RouteContext {
  params: Promise<{ userId: string }>;
}

/**
 * GET /api/users/[userId]/permissions - Get user permissions
 */
export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const session = await auth.api.getSession({
      headers: request.headers,
    });

    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userRole = (session.user as typeof session.user & { role?: string })
      .role;
    const { userId } = await context.params;

    // Only super_user can view other users' permissions
    // Users can view their own permissions
    if (session.user.id !== userId && userRole !== "super_user") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const targetUser = await getUserById(userId);
    if (!targetUser) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const permissions = await getUserPermissions(userId);

    return NextResponse.json({
      permissions,
      hasCustomPermissions:
        targetUser.permissions !== null &&
        Object.keys(targetUser.permissions || {}).length > 0,
      role: targetUser.role,
      defaultPermissions: targetUser.role
        ? DEFAULT_PERMISSIONS[targetUser.role]
        : null,
    });
  } catch (error) {
    console.error("Error fetching user permissions:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/users/[userId]/permissions - Update user permissions
 */
export async function PUT(request: NextRequest, context: RouteContext) {
  try {
    const session = await auth.api.getSession({
      headers: request.headers,
    });

    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userRole = (session.user as typeof session.user & { role?: string })
      .role;

    // Only super_user can update permissions
    if (userRole !== "super_user") {
      return NextResponse.json(
        { error: "Only Super User can modify permissions" },
        { status: 403 }
      );
    }

    const { userId } = await context.params;
    const body = await request.json();
    const { permissions } = body as { permissions: UserPermissions };

    // Validate permissions structure
    if (!validatePermissions(permissions)) {
      return NextResponse.json(
        { error: "Invalid permissions structure" },
        { status: 400 }
      );
    }

    const targetUser = await getUserById(userId);
    if (!targetUser) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const updatedUser = await updateUserPermissions(userId, permissions);
    if (!updatedUser) {
      return NextResponse.json(
        { error: "Failed to update permissions" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      user: updatedUser,
      permissions: updatedUser.permissions,
    });
  } catch (error) {
    console.error("Error updating user permissions:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/users/[userId]/permissions - Reset permissions to role defaults
 */
export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const session = await auth.api.getSession({
      headers: request.headers,
    });

    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userRole = (session.user as typeof session.user & { role?: string })
      .role;

    // Only super_user can reset permissions
    if (userRole !== "super_user") {
      return NextResponse.json(
        { error: "Only Super User can reset permissions" },
        { status: 403 }
      );
    }

    const { userId } = await context.params;

    const targetUser = await getUserById(userId);
    if (!targetUser) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const updatedUser = await resetUserPermissionsToDefault(userId);
    if (!updatedUser) {
      return NextResponse.json(
        { error: "Failed to reset permissions" },
        { status: 500 }
      );
    }

    // Return the role-based default permissions
    const defaultPermissions = targetUser.role
      ? DEFAULT_PERMISSIONS[targetUser.role]
      : null;

    return NextResponse.json({
      success: true,
      user: updatedUser,
      permissions: defaultPermissions,
      message: "Permissions reset to role defaults",
    });
  } catch (error) {
    console.error("Error resetting user permissions:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
