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
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{t.stats.totalJobs}</CardTitle>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{CRON_JOBS.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{t.stats.pendingItems}</CardTitle>
            <AlertCircle className="h-4 w-4 text-yellow-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats?.sent || 0}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">הושלמו</CardTitle>
            <CheckCircle className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats?.submitted || 0}</div>
          </CardContent>
        </Card>
      </div>

      {/* CRON Jobs Grid */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {CRON_JOBS.map((job) => (
          <Card key={job.id}>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div className="p-2 bg-muted rounded-lg">{job.icon}</div>
                <Badge variant="outline" className="gap-1">
                  <CheckCircle className="h-3 w-3 text-green-500" />
                  {t.status.ok}
                </Badge>
              </div>
              <CardTitle className="text-lg">{job.name}</CardTitle>
              <CardDescription className="text-xs">{job.description}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="flex-1"
                  onClick={() => handleRunJob(job.id, job.endpoint, true)}
                  disabled={runningJob === job.id}
                >
                  {runningJob === job.id ? (
                    <Loader2 className="h-4 w-4 animate-spin ms-1" />
                  ) : null}
                  {t.actions.dryRun}
                </Button>
                <Button
                  size="sm"
                  className="flex-1"
                  onClick={() => handleRunJob(job.id, job.endpoint, false)}
                  disabled={runningJob === job.id}
                >
                  {runningJob === job.id ? (
                    <Loader2 className="h-4 w-4 animate-spin ms-1" />
                  ) : (
                    <Play className="h-4 w-4 ms-1" />
                  )}
                  {t.actions.runNow}
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Pending Requests */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Clock className="h-5 w-5" />
              {t.pendingRequests.title}
            </CardTitle>
            <CardDescription>בקשות שנשלחו וטרם התקבל מענה</CardDescription>
          </div>
          <Button variant="outline" onClick={() => refetch()} disabled={pendingLoading}>
            {pendingLoading ? (
              <Loader2 className="h-4 w-4 animate-spin ms-2" />
            ) : (
              <RefreshCw className="h-4 w-4 ms-2" />
            )}
            {t.actions.refresh}
          </Button>
        </CardHeader>
        <CardContent>
          {pendingLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : pendingRequests.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              {t.pendingRequests.emptyState}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-right">שם</TableHead>
                  <TableHead className="text-right">אימייל</TableHead>
                  <TableHead className="text-right">{t.pendingRequests.sentAt}</TableHead>
                  <TableHead className="text-right">{t.pendingRequests.reminders}</TableHead>
                  <TableHead className="text-right">פעולות</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pendingRequests.map((request) => (
                  <TableRow key={request.id}>
                    <TableCell className="text-right font-medium">
                      {request.entityName}
                    </TableCell>
                    <TableCell className="text-right">
                      {request.recipientEmail}
                    </TableCell>
                    <TableCell className="text-right">
                      {formatDate(request.sentAt)}
                    </TableCell>
                    <TableCell className="text-right">
                      <Badge variant="outline">{request.remindersCount}</Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => sendReminderMutation.mutate(request.id)}
                        disabled={sendReminderMutation.isPending}
                      >
                        {sendReminderMutation.isPending ? (
                          <Loader2 className="h-4 w-4 animate-spin ms-1" />
                        ) : (
                          <Send className="h-4 w-4 ms-1" />
                        )}
                        {t.pendingRequests.sendReminder}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
