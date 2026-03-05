"use client";

import { Component, useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
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

class ErrorBoundary extends Component<
  { children: React.ReactNode },
  { hasError: boolean }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error) {
    console.error("ErrorBoundary caught:", error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4 p-8 text-center" dir="rtl">
          <h2 className="text-xl font-semibold">אירעה שגיאה</h2>
          <p className="text-muted-foreground">משהו השתבש. נסו לרענן את הדף.</p>
          <button
            onClick={() => {
              this.setState({ hasError: false });
              window.location.reload();
            }}
            className="rounded-md bg-primary px-4 py-2 text-primary-foreground hover:bg-primary/90"
          >
            רענן דף
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

function ProtectedLayoutContent({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const { data: session, isPending } = authClient.useSession();
  const { isCollapsed } = useSidebar();

  // Close mobile sidebar on navigation
  useEffect(() => {
    setIsMobileSidebarOpen(false);
  }, [pathname]);

  const userStatus = session
    ? (session.user as { status?: UserStatus })?.status
    : undefined;
  const userRole = session
    ? (session.user as { role?: UserRole })?.role
    : undefined;
  const userName = session?.user?.name;
  const userEmail = session?.user?.email;

  // Handle redirects for unauthenticated/invalid users
  useEffect(() => {
    if (isPending) return;

    // Check if user is logged in
    if (!session) {
      router.push("/sign-in");
      return;
    }

    // Check if user is pending
    if (userStatus === "pending") {
      router.push("/pending-approval");
      return;
    }

    // Check if user is suspended
    if (userStatus === "suspended") {
      router.push("/sign-in");
      return;
    }
  }, [session, isPending, router, userStatus]);

  // Loading state - show while pending or if redirect conditions are met
  const shouldRedirect =
    !isPending &&
    (!session || userStatus === "pending" || userStatus === "suspended");

  if (isPending || shouldRedirect) {
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
          "transition-[margin] duration-250 ease-[cubic-bezier(0.4,0,0.2,1)] overflow-x-hidden",
          isCollapsed ? "lg:ms-16" : "lg:ms-64"
        )}
      >
        <ErrorBoundary>{children}</ErrorBoundary>
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
