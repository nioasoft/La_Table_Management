"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import {
  Sidebar,
  MobileSidebarToggle,
  SidebarProvider,
  useSidebar,
} from "@/components/sidebar";
import { QueryProvider } from "@/lib/query-client";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { UserRole, UserStatus } from "@/db/schema";
import { cn } from "@/lib/utils";

function ProtectedLayoutContent({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(true);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const { data: session, isPending } = authClient.useSession();
  const { isCollapsed } = useSidebar();

  const userStatus = session
    ? (session.user as { status?: UserStatus })?.status
    : undefined;
  const userRole = session
    ? (session.user as { role?: UserRole })?.role
    : undefined;
  const userName = session?.user?.name;
  const userEmail = session?.user?.email;

  useEffect(() => {
    // Check if user is logged in
    if (!isPending && !session) {
      router.push("/sign-in");
      return;
    }

    // Check if user is pending
    if (!isPending && session?.user && userStatus === "pending") {
      router.push("/pending-approval");
      return;
    }

    // Check if user is suspended
    if (!isPending && session?.user && userStatus === "suspended") {
      router.push("/sign-in");
      return;
    }

    if (!isPending) {
      setIsLoading(false);
    }
  }, [session, isPending, router, userStatus]);

  // Loading state
  if (isLoading || isPending) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Desktop Sidebar */}
      <div className="hidden lg:block">
        <Sidebar
          userRole={userRole}
          userName={userName}
          userEmail={userEmail}
        />
      </div>

      {/* Mobile Sidebar Overlay */}
      {isMobileSidebarOpen && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-40 bg-black/50 lg:hidden"
            onClick={() => setIsMobileSidebarOpen(false)}
          />
          {/* Mobile Sidebar */}
          <div className="lg:hidden">
            <Sidebar
              userRole={userRole}
              userName={userName}
              userEmail={userEmail}
            />
          </div>
        </>
      )}

      {/* Mobile Toggle Button */}
      <MobileSidebarToggle onClick={() => setIsMobileSidebarOpen(true)} />

      {/* Main Content */}
      <main
        className={cn(
          "transition-[margin] duration-250 ease-[cubic-bezier(0.4,0,0.2,1)]",
          isCollapsed ? "lg:ms-16" : "lg:ms-64"
        )}
      >
        {children}
      </main>
    </div>
  );
}

export default function ProtectedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <QueryProvider>
      <TooltipProvider>
        <SidebarProvider>
          <ProtectedLayoutContent>{children}</ProtectedLayoutContent>
        </SidebarProvider>
      </TooltipProvider>
    </QueryProvider>
  );
}
