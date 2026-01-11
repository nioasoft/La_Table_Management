import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/utils/auth";
import {
  getUserById,
  updateUser,
  deleteUser,
  suspendUser,
  reactivateUser,
} from "@/data-access/users";
import type { UserRole, UserStatus } from "@/db/schema";

interface RouteContext {
  params: Promise<{ userId: string }>;
}

/**
 * GET /api/users/[userId] - Get a single user
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

    // Users can view their own profile, admins can view any profile
    if (session.user.id !== userId && userRole !== "super_user" && userRole !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const targetUser = await getUserById(userId);
    if (!targetUser) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    return NextResponse.json({ user: targetUser });
  } catch (error) {
    console.error("Error fetching user:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/users/[userId] - Update user details
 */
export async function PATCH(request: NextRequest, context: RouteContext) {
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

    // Only super_user can update other users' roles/status
    // Admins can update basic info but not roles
    const body = await request.json();
    const { name, email, image, role, status } = body as {
      name?: string;
      email?: string;
      image?: string;
      role?: UserRole;
      status?: UserStatus;
    };

    // Check permissions based on what's being updated
    const isUpdatingRoleOrStatus = role !== undefined || status !== undefined;

    if (isUpdatingRoleOrStatus) {
      if (userRole !== "super_user") {
        return NextResponse.json(
          { error: "Only Super User can change user role or status" },
          { status: 403 }
        );
      }
    } else {
      // For basic info updates, user can update their own profile or admins can update
      if (session.user.id !== userId && userRole !== "super_user" && userRole !== "admin") {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
    }

    const updateData: Partial<{
      name: string;
      email: string;
      image: string;
      role: UserRole;
      status: UserStatus;
    }> = {};

    if (name !== undefined) updateData.name = name;
    if (email !== undefined) updateData.email = email;
    if (image !== undefined) updateData.image = image;
    if (role !== undefined) updateData.role = role;
    if (status !== undefined) updateData.status = status;

    const updatedUser = await updateUser(userId, updateData);
    if (!updatedUser) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    return NextResponse.json({ user: updatedUser });
  } catch (error) {
    console.error("Error updating user:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/users/[userId] - Delete a user
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

    // Only super_user can delete users
    if (userRole !== "super_user") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { userId } = await context.params;

    // Prevent self-deletion
    if (session.user.id === userId) {
      return NextResponse.json(
        { error: "Cannot delete your own account" },
        { status: 400 }
      );
    }

    const deleted = await deleteUser(userId);
    if (!deleted) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting user:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
