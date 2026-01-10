"use client";

import { useEffect, useState } from "react";
import { authClient } from "@/lib/auth-client";
import type { UserRole } from "@/db/schema";
import { MinimalDashboard } from "@/components/minimal-dashboard";
import { he } from "@/lib/translations";

export default function DashboardPage() {
  const [isLoading, setIsLoading] = useState(true);
  const { data: session, isPending } = authClient.useSession();

  const userRole = session
    ? (session.user as { role?: UserRole })?.role
    : undefined;

  useEffect(() => {
    // Auth checks are handled by the protected layout
    // Just wait for session to load
    if (!isPending) {
      setIsLoading(false);
    }
  }, [isPending]);

  if (isLoading || isPending) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  const isSuperUserOrAdmin = userRole === "super_user" || userRole === "admin";

  return (
    <div className="container mx-auto p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">{he.dashboard.title}</h1>
      </div>

      {isSuperUserOrAdmin ? (
        <MinimalDashboard userRole={userRole} />
      ) : (
        // Franchisee owner view - simple placeholder for now
        <div className="rounded-lg border bg-muted/50 p-8 text-center">
          <p className="text-muted-foreground">
            {he.dashboard.franchiseeOwner.description2}
          </p>
        </div>
      )}
    </div>
  );
}
