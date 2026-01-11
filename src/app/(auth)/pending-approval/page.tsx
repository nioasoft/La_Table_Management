"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Clock, LogOut, RefreshCw, CheckCircle2 } from "lucide-react";
import { he } from "@/lib/translations";

// Get pending approval translations
const t = he.auth.pendingApproval;

export default function PendingApprovalPage() {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const { data: session, isPending } = authClient.useSession();

  useEffect(() => {
    // Check if user is logged in
    if (!isPending && !session) {
      router.push("/sign-in");
      return;
    }

    // Check if user is already active
    const userStatus = session ? (session.user as typeof session.user & { status?: string })?.status : undefined;
    if (!isPending && session?.user && userStatus === "active") {
      router.push("/dashboard");
      return;
    }

    setIsLoading(false);
  }, [session, isPending, router]);

  const handleSignOut = async () => {
    await authClient.signOut();
    router.push("/sign-in");
  };

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      // Refresh the session to check for status updates
      const refreshedSession = await authClient.getSession();

      // Check if status has been updated
      const userStatus = refreshedSession?.data ? (refreshedSession.data.user as { status?: string })?.status : undefined;
      if (refreshedSession?.data?.user && userStatus === "active") {
        router.push("/dashboard");
      }
    } finally {
      setIsRefreshing(false);
    }
  };

  if (isLoading || isPending) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-md text-center">
        <CardHeader className="space-y-4">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-900">
            <Clock className="h-8 w-8 text-amber-600 dark:text-amber-400" />
          </div>
          <CardTitle className="text-2xl font-bold">
            {t.title}
          </CardTitle>
          <CardDescription className="text-base">
            {t.description}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="rounded-lg border bg-muted/50 p-4">
            <div className="flex items-start gap-3 text-start">
              <CheckCircle2 className="h-5 w-5 text-green-500 mt-0.5 shrink-0" />
              <div>
                <p className="font-medium">{t.registrationComplete}</p>
                <p className="text-sm text-muted-foreground">
                  {t.accountCreatedWith}{" "}
                  <span className="font-medium" dir="ltr">{session?.user?.email}</span>
                </p>
              </div>
            </div>
          </div>

          <div className="space-y-2 text-sm text-muted-foreground">
            <p>
              {t.waitingMessage}
            </p>
            <p>
              {t.takingTooLong}
            </p>
          </div>

          <Button
            variant="outline"
            className="w-full"
            onClick={handleRefresh}
            disabled={isRefreshing}
          >
            {isRefreshing ? (
              <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="mr-2 h-4 w-4" />
            )}
            {t.checkStatus}
          </Button>
        </CardContent>
        <CardFooter className="flex justify-center">
          <Button variant="ghost" onClick={handleSignOut}>
            <LogOut className="mr-2 h-4 w-4" />
            {t.signOut}
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
