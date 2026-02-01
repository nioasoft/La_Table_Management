"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Mail, Bell, Loader2, Calendar, Clock, History } from "lucide-react";
import dynamic from "next/dynamic";

// Dynamically import the tab content components
const EmailTemplatesContent = dynamic(
  () => import("@/components/admin/email-templates-tab"),
  {
    loading: () => (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    ),
  }
);

const FranchiseeRemindersContent = dynamic(
  () => import("@/components/admin/franchisee-reminders-tab"),
  {
    loading: () => (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    ),
  }
);

const SchedulesContent = dynamic(
  () => import("@/components/admin/schedules-tab"),
  {
    loading: () => (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    ),
  }
);

const CronMonitorContent = dynamic(
  () => import("@/components/admin/cron-monitor-tab"),
  {
    loading: () => (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    ),
  }
);

const EmailLogsContent = dynamic(
  () => import("@/components/admin/email-logs-tab"),
  {
    loading: () => (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    ),
  }
);

export default function CommunicationsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialTab = searchParams.get("tab") || "email-templates";
  const [activeTab, setActiveTab] = useState(initialTab);

  const { data: session, isPending } = authClient.useSession();
  const userRole = session ? (session.user as { role?: string })?.role : undefined;

  // Redirect if not authenticated or authorized
  if (!isPending && !session) {
    router.push("/sign-in?redirect=/admin/communications");
  }
  if (!isPending && session?.user && userRole !== "super_user" && userRole !== "admin") {
    router.push("/dashboard");
  }

  if (isPending) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const handleTabChange = (value: string) => {
    setActiveTab(value);
    // Update URL without full navigation
    const url = new URL(window.location.href);
    url.searchParams.set("tab", value);
    window.history.replaceState({}, "", url.toString());
  };

  return (
    <div className="container mx-auto p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">תקשורת</h1>
        <p className="text-muted-foreground">ניהול תקשורת, תבניות אימייל ותזכורות</p>
      </div>

      <Tabs value={activeTab} onValueChange={handleTabChange} className="space-y-6" dir="rtl">
        <TabsList className="flex w-full max-w-4xl gap-1 flex-wrap">
          <TabsTrigger value="email-templates" className="gap-2">
            <Mail className="h-4 w-4" />
            תבניות אימייל
          </TabsTrigger>
          <TabsTrigger value="reminders" className="gap-2">
            <Bell className="h-4 w-4" />
            תזכורות
          </TabsTrigger>
          <TabsTrigger value="schedules" className="gap-2">
            <Calendar className="h-4 w-4" />
            לוחות זמנים
          </TabsTrigger>
          <TabsTrigger value="cron-monitor" className="gap-2">
            <Clock className="h-4 w-4" />
            מעקב משימות
          </TabsTrigger>
          <TabsTrigger value="email-logs" className="gap-2">
            <History className="h-4 w-4" />
            יומן אימיילים
          </TabsTrigger>
        </TabsList>

        <TabsContent value="email-templates" className="mt-6">
          <EmailTemplatesContent />
        </TabsContent>

        <TabsContent value="reminders" className="mt-6">
          <FranchiseeRemindersContent />
        </TabsContent>

        <TabsContent value="schedules" className="mt-6">
          <SchedulesContent />
        </TabsContent>

        <TabsContent value="cron-monitor" className="mt-6">
          <CronMonitorContent />
        </TabsContent>

        <TabsContent value="email-logs" className="mt-6">
          <EmailLogsContent />
        </TabsContent>
      </Tabs>
    </div>
  );
}
