"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "@/lib/auth-client";
import type { UserRole } from "@/db/schema";

interface UseAdminAuthOptions {
  redirectPath?: string;
  requireSuperUser?: boolean;
}

interface UseAdminAuthReturn {
  session: ReturnType<typeof useSession>["data"];
  isPending: boolean;
  isAdmin: boolean;
  isSuperUser: boolean;
  userRole: UserRole | undefined;
  isAuthorized: boolean;
}

/**
 * Custom hook for admin authentication and authorization.
 *
 * Checks if user has admin or super_user role and handles redirects:
 * - Redirects to sign-in if no session
 * - Redirects to dashboard if user lacks required permissions
 *
 * @param options.redirectPath - Path to redirect unauthorized users (default: '/dashboard')
 * @param options.requireSuperUser - If true, only super_user role is authorized
 * @returns Session data, loading state, role checks, and authorization status
 *
 * @example
 * ```tsx
 * function AdminPage() {
 *   const { isAuthorized, isPending, isSuperUser } = useAdminAuth();
 *
 *   if (isPending) return <LoadingSpinner />;
 *   if (!isAuthorized) return null; // Will redirect
 *
 *   return <AdminContent />;
 * }
 * ```
 */
export function useAdminAuth(options: UseAdminAuthOptions = {}): UseAdminAuthReturn {
  const { redirectPath = "/dashboard", requireSuperUser = false } = options;
  const router = useRouter();
  const { data: session, isPending } = useSession();

  // Type assertion to access extended user fields
  const userRole = session ? (session.user as { role?: UserRole })?.role : undefined;
  const isSuperUser = userRole === "super_user";
  const isAdmin = userRole === "admin" || isSuperUser;
  const isAuthorized = requireSuperUser ? isSuperUser : isAdmin;

  useEffect(() => {
    // Don't redirect while still loading session
    if (isPending) return;

    // Redirect to sign-in if no session
    if (!session) {
      router.push("/sign-in");
      return;
    }

    // Redirect to dashboard if user lacks required permissions
    if (!isAuthorized) {
      router.push(redirectPath);
      return;
    }
  }, [session, isPending, isAuthorized, redirectPath, router]);

  return {
    session,
    isPending,
    isAdmin,
    isSuperUser,
    userRole,
    isAuthorized,
  };
}
