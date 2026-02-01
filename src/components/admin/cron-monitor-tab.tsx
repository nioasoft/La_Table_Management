"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  RefreshCw,
  Loader2,
  Play,
  CheckCircle,
  Clock,
  AlertCircle,
  FileText,
  DollarSign,
  Bell,
  Users,
  Send,
} from "lucide-react";
import { toast } from "sonner";
import { he } from "@/lib/translations/he";
import { cn } from "@/lib/utils";

const t = he.admin.cronMonitor;
const tCommon = he.common;

interface CronJob {
  id: string;
  name: string;
  description: string;
  endpoint: string;
  schedule: string;
  icon: React.ReactNode;
}

interface PendingRequest {
  id: string;
  entityName: string;
  entityType: string;
  sentAt: string;
  remindersCount: number;
  recipientEmail: string;
}

interface FileRequestStats {
  pending: number;
  sent: number;
  submitted: number;
}

const CRON_JOBS: CronJob[] = [
  {
    id: "file-requests",
    name: t.jobs.fileRequests.name,
    description: t.jobs.fileRequests.description,
    endpoint: "/api/cron/file-requests",
    schedule: "0 1 * * *",
    icon: <FileText className="h-6 w-6" />,
  },
  {
    id: "settlement-requests",
    name: t.jobs.settlementRequests.name,
    description: t.jobs.settlementRequests.description,
    endpoint: "/api/cron/settlement-requests?action=all",
    schedule: "0 8 1,15 * *",
    icon: <DollarSign className="h-6 w-6" />,
  },
  {
    id: "upload-reminders",
    name: t.jobs.uploadReminders.name,
    description: t.jobs.uploadReminders.description,
    endpoint: "/api/cron/upload-reminders?action=all",
    schedule: "0 9 * * *",
    icon: <Bell className="h-6 w-6" />,
  },
  {
    id: "franchisee-reminders",
    name: t.jobs.franchiseeReminders.name,
    description: t.jobs.franchiseeReminders.description,
    endpoint: "/api/cron/franchisee-reminders?action=all&autoCreate=true",
    schedule: "0 8 * * *",
    icon: <Users className="h-6 w-6" />,
  },
];

function formatDate(dateString: string | Date | null | undefined): string {
  if (!dateString) return "-";
  return new Date(dateString).toLocaleDateString("he-IL", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export default function CronMonitorTab() {
  const queryClient = useQueryClient();
  const [runningJob, setRunningJob] = useState<string | null>(null);

  // Fetch pending file requests
  const { data: pendingData, isLoading: pendingLoading, refetch } = useQuery<{
    requests: PendingRequest[];
    stats: FileRequestStats;
  }>({
    queryKey: ["cron-monitor", "pending-requests"],
    queryFn: async () => {
      const response = await fetch("/api/file-requests/stats");
      if (!response.ok) {
        throw new Error("Failed to fetch pending requests");
      }
      const statsData = await response.json();

      // Fetch actual pending requests
      const requestsResponse = await fetch("/api/file-requests?status=sent&limit=20");
      if (!requestsResponse.ok) {
        throw new Error("Failed to fetch requests");
      }
      const requestsData = await requestsResponse.json();

      return {
        requests: requestsData.requests?.map((r: {
          id: string;
          entityName?: string;
          entityType: string;
          sentAt: string;
          remindersSent?: string[];
          recipientEmail: string;
        }) => ({
          id: r.id,
          entityName: r.entityName || "Unknown",
          entityType: r.entityType,
          sentAt: r.sentAt,
          remindersCount: r.remindersSent?.length || 0,
          recipientEmail: r.recipientEmail,
        })) || [],
        stats: statsData.stats || { pending: 0, sent: 0, submitted: 0 },
      };
    },
  });

  // Run cron job mutation
  const runJobMutation = useMutation({
    mutationFn: async ({ endpoint, dryRun }: { endpoint: string; dryRun: boolean }) => {
      const url = dryRun
        ? `${endpoint}${endpoint.includes("?") ? "&" : "?"}dryRun=true`
        : endpoint;

      const response = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.NEXT_PUBLIC_CRON_SECRET || ""}`,
        },
      });

      if (!response.ok) {
        throw new Error("Failed to run cron job");
      }

      return response.json();
    },
    onSuccess: (data, { dryRun }) => {
      if (dryRun) {
        toast.success(t.messages.dryRunSuccess);
      } else {
        toast.success(t.messages.runSuccess);
      }
      queryClient.invalidateQueries({ queryKey: ["cron-monitor"] });
      setRunningJob(null);
    },
    onError: () => {
      toast.error(t.errors.failedToRun);
      setRunningJob(null);
    },
  });

  // Send reminder mutation
  const sendReminderMutation = useMutation({
    mutationFn: async (requestId: string) => {
      const response = await fetch(`/api/file-requests/${requestId}/send`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ action: "reminder" }),
      });

      if (!response.ok) {
        throw new Error("Failed to send reminder");
      }

      return response.json();
    },
    onSuccess: () => {
      toast.success("התזכורת נשלחה בהצלחה");
      queryClient.invalidateQueries({ queryKey: ["cron-monitor"] });
    },
    onError: () => {
      toast.error("שגיאה בשליחת התזכורת");
    },
  });

  const handleRunJob = (jobId: string, endpoint: string, dryRun: boolean = false) => {
    setRunningJob(jobId);
    runJobMutation.mutate({ endpoint, dryRun });
  };

  const stats = pendingData?.stats;
  const pendingRequests = pendingData?.requests || [];

  return (
    <div className="space-y-6">
      {/* Stats Cards */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card className="border-s-4 border-s-blue-500 bg-gradient-to-l from-blue-50/50 to-transparent dark:from-blue-950/20">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">{t.stats.totalJobs}</CardTitle>
            <div className="rounded-full bg-blue-100 p-2 dark:bg-blue-900/30">
              <Clock className="h-4 w-4 text-blue-600 dark:text-blue-400" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-blue-700 dark:text-blue-300">{CRON_JOBS.length}</div>
          </CardContent>
        </Card>
        <Card className="border-s-4 border-s-amber-500 bg-gradient-to-l from-amber-50/50 to-transparent dark:from-amber-950/20">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">{t.stats.pendingItems}</CardTitle>
            <div className="rounded-full bg-amber-100 p-2 dark:bg-amber-900/30">
              <AlertCircle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-amber-700 dark:text-amber-300">{stats?.sent || 0}</div>
          </CardContent>
        </Card>
        <Card className="border-s-4 border-s-green-500 bg-gradient-to-l from-green-50/50 to-transparent dark:from-green-950/20">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">הושלמו</CardTitle>
            <div className="rounded-full bg-green-100 p-2 dark:bg-green-900/30">
              <CheckCircle className="h-4 w-4 text-green-600 dark:text-green-400" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-green-700 dark:text-green-300">{stats?.submitted || 0}</div>
          </CardContent>
        </Card>
      </div>

      {/* CRON Jobs Grid */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {CRON_JOBS.map((job, index) => {
          const colors = [
            { bg: "from-indigo-50/80", border: "border-indigo-200", icon: "bg-indigo-100 text-indigo-600", dark: "dark:from-indigo-950/30 dark:border-indigo-800" },
            { bg: "from-emerald-50/80", border: "border-emerald-200", icon: "bg-emerald-100 text-emerald-600", dark: "dark:from-emerald-950/30 dark:border-emerald-800" },
            { bg: "from-orange-50/80", border: "border-orange-200", icon: "bg-orange-100 text-orange-600", dark: "dark:from-orange-950/30 dark:border-orange-800" },
            { bg: "from-pink-50/80", border: "border-pink-200", icon: "bg-pink-100 text-pink-600", dark: "dark:from-pink-950/30 dark:border-pink-800" },
          ];
          const color = colors[index % colors.length];

          return (
            <Card
              key={job.id}
              className={cn(
                "bg-gradient-to-b to-transparent transition-shadow hover:shadow-md",
                color.bg,
                color.border,
                color.dark
              )}
            >
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between flex-row-reverse">
                  <div className={cn("p-2.5 rounded-xl", color.icon, "dark:bg-opacity-30")}>
                    {job.icon}
                  </div>
                  <Badge
                    variant="outline"
                    className="gap-1.5 bg-green-50 text-green-700 border-green-200 dark:bg-green-900/30 dark:text-green-300 dark:border-green-800"
                  >
                    <CheckCircle className="h-3 w-3" />
                    {t.status.ok}
                  </Badge>
                </div>
                <div className="text-right mt-3">
                  <CardTitle className="text-base">{job.name}</CardTitle>
                  <CardDescription className="text-xs mt-1">{job.description}</CardDescription>
                </div>
              </CardHeader>
              <CardContent className="space-y-2 pt-0">
                <div className="flex gap-2 flex-row-reverse">
                  <Button
                    size="sm"
                    variant="outline"
                    className="flex-1 gap-2"
                    onClick={() => handleRunJob(job.id, job.endpoint, true)}
                    disabled={runningJob === job.id}
                  >
                    {runningJob === job.id && (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    )}
                    {t.actions.dryRun}
                  </Button>
                  <Button
                    size="sm"
                    className="flex-1 gap-2"
                    onClick={() => handleRunJob(job.id, job.endpoint, false)}
                    disabled={runningJob === job.id}
                  >
                    {runningJob === job.id ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Play className="h-4 w-4" />
                    )}
                    {t.actions.runNow}
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Pending Requests */}
      <Card>
        <CardHeader className="border-b bg-muted/30">
          <div className="flex items-center justify-between flex-row-reverse">
            <div className="flex items-center gap-3 flex-row-reverse">
              <div className="rounded-lg bg-primary/10 p-2">
                <Clock className="h-5 w-5 text-primary" />
              </div>
              <div className="text-right">
                <CardTitle>{t.pendingRequests.title}</CardTitle>
                <p className="text-sm text-muted-foreground mt-1">בקשות שנשלחו וטרם התקבל מענה</p>
              </div>
            </div>
            <Button variant="outline" onClick={() => refetch()} disabled={pendingLoading} className="gap-2">
              {pendingLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
              {t.actions.refresh}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {pendingLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : pendingRequests.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <Clock className="h-12 w-12 mx-auto mb-4 opacity-20" />
              <p>{t.pendingRequests.emptyState}</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50 hover:bg-muted/50">
                    <TableHead className="text-right font-semibold">שם</TableHead>
                    <TableHead className="text-right font-semibold">אימייל</TableHead>
                    <TableHead className="text-right font-semibold">{t.pendingRequests.sentAt}</TableHead>
                    <TableHead className="text-center font-semibold">{t.pendingRequests.reminders}</TableHead>
                    <TableHead className="text-center font-semibold">פעולות</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pendingRequests.map((request, index) => (
                    <TableRow
                      key={request.id}
                      className={cn(
                        "transition-colors",
                        index % 2 === 0 ? "bg-background" : "bg-muted/20"
                      )}
                    >
                      <TableCell className="text-right">
                        <div className="flex items-center gap-3 flex-row-reverse justify-end">
                          <div className="rounded-lg bg-muted p-2">
                            <FileText className="h-4 w-4 text-muted-foreground" />
                          </div>
                          <div className="text-right">
                            <p className="font-medium">{request.entityName}</p>
                            <p className="text-xs text-muted-foreground">{request.entityType === "supplier" ? "ספק" : "זכיין"}</p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <span className="font-mono text-sm text-muted-foreground">{request.recipientEmail}</span>
                      </TableCell>
                      <TableCell className="text-right text-sm text-muted-foreground">
                        {formatDate(request.sentAt)}
                      </TableCell>
                      <TableCell className="text-center">
                        {request.remindersCount > 0 ? (
                          <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-100 dark:bg-amber-900/30 dark:text-amber-300">
                            {request.remindersCount}
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-muted-foreground">0</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-center">
                        <Button
                          size="sm"
                          variant="default"
                          onClick={() => sendReminderMutation.mutate(request.id)}
                          disabled={sendReminderMutation.isPending}
                          className="gap-2"
                        >
                          {sendReminderMutation.isPending ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Send className="h-4 w-4" />
                          )}
                          {t.pendingRequests.sendReminder}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
