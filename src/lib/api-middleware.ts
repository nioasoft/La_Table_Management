/**
 * API Route Middleware Helpers
 *
 * Centralizes authentication and authorization logic for API routes.
 * Reduces code duplication across 64+ API route handlers.
 *
 * Usage:
 * ```typescript
 * export async function GET(request: NextRequest) {
 *   const authResult = await requireAdminOrSuperUser(request);
 *   if (authResult instanceof NextResponse) return authResult;
 *   const { session, user } = authResult;
 *   // ... rest of handler
 * }
 * ```
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/utils/auth";

// User roles in the system
export type UserRole = "super_user" | "admin" | "franchisee_owner";

// Extended user type with role
export interface AuthenticatedUser {
  id: string;
  email: string;
  name: string;
  role: UserRole | null;
  status: string;
  isAdmin: boolean;
}

// Session with typed user
export interface AuthenticatedSession {
  session: {
    id: string;
    userId: string;
    expiresAt: Date;
  };
  user: AuthenticatedUser;
}

/**
 * Error response for unauthorized requests
 */
function unauthorizedResponse(): NextResponse {
  return NextResponse.json(
    { error: "Unauthorized", code: "UNAUTHORIZED" },
    { status: 401 }
  );
}

/**
 * Error response for forbidden requests
 */
function forbiddenResponse(): NextResponse {
  return NextResponse.json(
    { error: "Forbidden", code: "FORBIDDEN" },
    { status: 403 }
  );
}

/**
 * Get authenticated session from request
 * Returns NextResponse error if not authenticated
 */
export async function requireAuth(
  request: NextRequest
): Promise<AuthenticatedSession | NextResponse> {
  try {
    const session = await auth.api.getSession({
      headers: request.headers,
    });

    if (!session) {
      return unauthorizedResponse();
    }

    // Type the user with role information
    const user = session.user as AuthenticatedUser;

    return {
      session: session.session,
      user,
    };
  } catch (error) {
    console.error("Auth error:", error);
    return unauthorizedResponse();
  }
}

/**
 * Require authentication with specific role(s)
 * Returns NextResponse error if not authenticated or not authorized
 */
export async function requireRole(
  request: NextRequest,
  allowedRoles: UserRole[]
): Promise<AuthenticatedSession | NextResponse> {
  const authResult = await requireAuth(request);

  // If auth failed, return the error response
  if (authResult instanceof NextResponse) {
    return authResult;
  }

  const { user } = authResult;

  // Check if user has one of the allowed roles
  if (!user.role || !allowedRoles.includes(user.role)) {
    return forbiddenResponse();
  }

  return authResult;
}

/**
 * Require super_user role
 */
export async function requireSuperUser(
  request: NextRequest
): Promise<AuthenticatedSession | NextResponse> {
  return requireRole(request, ["super_user"]);
}

/**
 * Require admin or super_user role
 * This is the most common authorization check in the codebase
 */
export async function requireAdminOrSuperUser(
  request: NextRequest
): Promise<AuthenticatedSession | NextResponse> {
  return requireRole(request, ["super_user", "admin"]);
}

/**
 * Require any authenticated user (including franchisee_owner)
 */
export async function requireAnyAuthenticatedUser(
  request: NextRequest
): Promise<AuthenticatedSession | NextResponse> {
  return requireRole(request, ["super_user", "admin", "franchisee_owner"]);
}

/**
 * Type guard to check if result is an error response
 */
export function isAuthError(
  result: AuthenticatedSession | NextResponse
): result is NextResponse {
  return result instanceof NextResponse;
}
