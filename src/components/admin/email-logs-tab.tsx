"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Mail,
  RefreshCw,
  Loader2,
  Eye,
  CheckCircle,
  XCircle,
  Clock,
  Send,
  AlertTriangle,
} from "lucide-react";
import type { EmailLog, EmailStatus } from "@/db/schema";
import { he } from "@/lib/translations/he";

const t = he.admin.emailLogs;

interface EmailLogStats {
  total: number;
  byStatus: Record<EmailStatus, number>;
  last24Hours: number;
  last7Days: number;
}

interface EmailLogResponse {
  logs: EmailLog[];
  stats?: EmailLogStats;
}

const statusIcons: Record<EmailStatus, React.ReactNode> = {
  pending: <Clock className="h-4 w-4 text-yellow-500" />,
  sent: <Send className="h-4 w-4 text-blue-500" />,
  delivered: <CheckCircle className="h-4 w-4 text-green-500" />,
  failed: <XCircle className="h-4 w-4 text-red-500" />,
  bounced: <AlertTriangle className="h-4 w-4 text-orange-500" />,
};

const statusColors: Record<EmailStatus, "default" | "secondary" | "destructive" | "outline"> = {
  pending: "secondary",
  sent: "outline",
  delivered: "default",
  failed: "destructive",
  bounced: "destructive",
};

function formatDate(dateString: string | Date | null | undefined): string {
  if (!dateString) return "-";
  return new Date(dateString).toLocaleDateString("he-IL", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function EmailLogsTab() {
  const [statusFilter, setStatusFilter] = useState<"all" | EmailStatus>("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedLog, setSelectedLog] = useState<EmailLog | null>(null);

  // Fetch email logs with stats
  const { data, isLoading, refetch, isFetching } = useQuery<EmailLogResponse>({
    queryKey: ["email-logs", { status: statusFilter, search: searchTerm }],
    queryFn: async () => {
      let url = "/api/email-logs?stats=true&limit=100";
      if (statusFilter !== "all") {
        url += `&status=${statusFilter}`;
      }
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error("Failed to fetch email logs");
      }
      return response.json();
    },
  });

  const logs = data?.logs || [];
  const stats = data?.stats;

  // Filter logs by search term (client-side)
  const filteredLogs = logs.filter((log) => {
    if (!searchTerm) return true;
    const search = searchTerm.toLowerCase();
    return (
      log.toEmail.toLowerCase().includes(search) ||
      log.subject.toLowerCase().includes(search) ||
      (log.toName && log.toName.toLowerCase().includes(search))
    );
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Stats Cards */}
      {stats && (
        <div className="grid gap-4 md:grid-cols-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">{t.stats.total}</CardTitle>
              <Mail className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.total}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">{t.stats.delivered}</CardTitle>
              <CheckCircle className="h-4 w-4 text-green-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.byStatus.delivered || 0}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">{t.stats.failed}</CardTitle>
              <XCircle className="h-4 w-4 text-red-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {(stats.byStatus.failed || 0) + (stats.byStatus.bounced || 0)}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">{t.stats.last24Hours}</CardTitle>
              <Clock className="h-4 w-4 text-blue-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.last24Hours}</div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Filters */}
      <div className="flex items-center gap-4 flex-wrap">
        <Select
          value={statusFilter}
          onValueChange={(value) => setStatusFilter(value as "all" | EmailStatus)}
        >
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder={t.filters.status} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t.filters.allStatuses}</SelectItem>
            <SelectItem value="pending">{t.statuses.pending}</SelectItem>
            <SelectItem value="sent">{t.statuses.sent}</SelectItem>
            <SelectItem value="delivered">{t.statuses.delivered}</SelectItem>
            <SelectItem value="failed">{t.statuses.failed}</SelectItem>
            <SelectItem value="bounced">{t.statuses.bounced}</SelectItem>
          </SelectContent>
        </Select>

        <Input
          placeholder={t.filters.searchPlaceholder}
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="w-[250px]"
        />

        <Button variant="outline" onClick={() => refetch()} disabled={isFetching}>
          {isFetching ? (
            <Loader2 className="h-4 w-4 animate-spin ms-2" />
          ) : (
            <RefreshCw className="h-4 w-4 ms-2" />
          )}
          {t.actions.refresh}
        </Button>
      </div>

      {/* Email Logs Table */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Mail className="h-5 w-5" />
            {t.title}
          </CardTitle>
          <CardDescription>{t.description}</CardDescription>
        </CardHeader>
        <CardContent>
          {filteredLogs.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              {t.emptyState}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-right">{t.table.recipient}</TableHead>
                  <TableHead className="text-right">{t.table.subject}</TableHead>
                  <TableHead className="text-right">{t.table.status}</TableHead>
                  <TableHead className="text-right">{t.table.sentAt}</TableHead>
                  <TableHead className="text-right">{t.table.actions}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredLogs.map((log) => (
                  <TableRow key={log.id}>
                    <TableCell className="text-right">
                      <div>
                        <p className="font-medium">{log.toEmail}</p>
                        {log.toName && (
                          <p className="text-sm text-muted-foreground">{log.toName}</p>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-right max-w-[300px] truncate">
                      {log.subject}
                    </TableCell>
                    <TableCell className="text-right">
                      <Badge variant={statusColors[log.status]} className="gap-1">
                        {statusIcons[log.status]}
                        {t.statuses[log.status]}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      {formatDate(log.sentAt || log.createdAt)}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setSelectedLog(log)}
                      >
                        <Eye className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Email Details Dialog */}
      <Dialog open={!!selectedLog} onOpenChange={() => setSelectedLog(null)}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto" dir="rtl">
          <DialogHeader>
            <DialogTitle>{t.details.title}</DialogTitle>
            <DialogDescription>{selectedLog?.subject}</DialogDescription>
          </DialogHeader>

          {selectedLog && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-muted-foreground">{t.details.from}</p>
                  <p className="font-medium">
                    {selectedLog.fromName ? `${selectedLog.fromName} <${selectedLog.fromEmail}>` : selectedLog.fromEmail}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">{t.details.to}</p>
                  <p className="font-medium">
                    {selectedLog.toName ? `${selectedLog.toName} <${selectedLog.toEmail}>` : selectedLog.toEmail}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">{t.details.status}</p>
                  <Badge variant={statusColors[selectedLog.status]} className="gap-1 mt-1">
                    {statusIcons[selectedLog.status]}
                    {t.statuses[selectedLog.status]}
                  </Badge>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">{t.details.sentAt}</p>
                  <p className="font-medium">{formatDate(selectedLog.sentAt)}</p>
                </div>
                {selectedLog.deliveredAt && (
                  <div>
                    <p className="text-sm text-muted-foreground">{t.details.deliveredAt}</p>
                    <p className="font-medium">{formatDate(selectedLog.deliveredAt)}</p>
                  </div>
                )}
                {selectedLog.failedAt && (
                  <div>
                    <p className="text-sm text-muted-foreground">{t.details.failedAt}</p>
                    <p className="font-medium">{formatDate(selectedLog.failedAt)}</p>
                  </div>
                )}
              </div>

              {selectedLog.errorMessage && (
                <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-3">
                  <p className="text-sm font-medium text-destructive">{t.details.errorMessage}</p>
                  <p className="text-sm text-destructive">{selectedLog.errorMessage}</p>
                </div>
              )}

              {selectedLog.messageId && (
                <div>
                  <p className="text-sm text-muted-foreground">{t.details.messageId}</p>
                  <p className="font-mono text-sm">{selectedLog.messageId}</p>
                </div>
              )}

              {selectedLog.bodyHtml && (
                <div>
                  <p className="text-sm text-muted-foreground mb-2">{t.details.preview}</p>
                  {/*
                    Note: This HTML is safe to render because it comes from our own email templates.
                    The content is generated by the system from trusted templates stored in the database.
                    No user input is directly rendered here.
                  */}
                  <iframe
                    srcDoc={selectedLog.bodyHtml}
                    className="w-full h-[300px] rounded-lg border bg-white"
                    title="Email preview"
                    sandbox=""
                  />
                </div>
              )}

              <div className="flex justify-end">
                <Button variant="outline" onClick={() => setSelectedLog(null)}>
                  {t.details.close}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
