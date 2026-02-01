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
import { cn } from "@/lib/utils";

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
          <Card className="border-s-4 border-s-blue-500 bg-gradient-to-l from-blue-50/50 to-transparent dark:from-blue-950/20">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">{t.stats.total}</CardTitle>
              <div className="rounded-full bg-blue-100 p-2 dark:bg-blue-900/30">
                <Mail className="h-4 w-4 text-blue-600 dark:text-blue-400" />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-blue-700 dark:text-blue-300">{stats.total}</div>
            </CardContent>
          </Card>
          <Card className="border-s-4 border-s-green-500 bg-gradient-to-l from-green-50/50 to-transparent dark:from-green-950/20">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">{t.stats.delivered}</CardTitle>
              <div className="rounded-full bg-green-100 p-2 dark:bg-green-900/30">
                <CheckCircle className="h-4 w-4 text-green-600 dark:text-green-400" />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-green-700 dark:text-green-300">{stats.byStatus.delivered || 0}</div>
            </CardContent>
          </Card>
          <Card className="border-s-4 border-s-red-500 bg-gradient-to-l from-red-50/50 to-transparent dark:from-red-950/20">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">{t.stats.failed}</CardTitle>
              <div className="rounded-full bg-red-100 p-2 dark:bg-red-900/30">
                <XCircle className="h-4 w-4 text-red-600 dark:text-red-400" />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-red-700 dark:text-red-300">
                {(stats.byStatus.failed || 0) + (stats.byStatus.bounced || 0)}
              </div>
            </CardContent>
          </Card>
          <Card className="border-s-4 border-s-purple-500 bg-gradient-to-l from-purple-50/50 to-transparent dark:from-purple-950/20">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">{t.stats.last24Hours}</CardTitle>
              <div className="rounded-full bg-purple-100 p-2 dark:bg-purple-900/30">
                <Clock className="h-4 w-4 text-purple-600 dark:text-purple-400" />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-purple-700 dark:text-purple-300">{stats.last24Hours}</div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Filters */}
      <Card className="p-4">
        <div className="flex items-center gap-4 flex-wrap flex-row-reverse justify-end">
          <Button variant="outline" onClick={() => refetch()} disabled={isFetching} className="gap-2">
            {isFetching ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            {t.actions.refresh}
          </Button>

          <div className="flex items-center gap-2 flex-row-reverse">
            <span className="text-sm text-muted-foreground">סינון:</span>
            <Select
              value={statusFilter}
              onValueChange={(value) => setStatusFilter(value as "all" | EmailStatus)}
            >
              <SelectTrigger className="w-[160px]">
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
              className="w-[220px]"
            />
          </div>
        </div>
      </Card>

      {/* Email Logs Table */}
      <Card>
        <CardHeader className="border-b bg-muted/30">
          <div className="flex items-center gap-3 flex-row-reverse">
            <div className="rounded-lg bg-primary/10 p-2">
              <Mail className="h-5 w-5 text-primary" />
            </div>
            <div className="text-right">
              <CardTitle>{t.title}</CardTitle>
              <p className="text-sm text-muted-foreground mt-1">{t.description}</p>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {filteredLogs.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <Mail className="h-12 w-12 mx-auto mb-4 opacity-20" />
              <p>{t.emptyState}</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50 hover:bg-muted/50">
                    <TableHead className="text-right font-semibold">{t.table.recipient}</TableHead>
                    <TableHead className="text-right font-semibold">{t.table.subject}</TableHead>
                    <TableHead className="text-center font-semibold">{t.table.status}</TableHead>
                    <TableHead className="text-right font-semibold">{t.table.sentAt}</TableHead>
                    <TableHead className="text-center font-semibold">{t.table.actions}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredLogs.map((log, index) => (
                    <TableRow
                      key={log.id}
                      className={cn(
                        "transition-colors cursor-pointer hover:bg-muted/40",
                        index % 2 === 0 ? "bg-background" : "bg-muted/20"
                      )}
                      onClick={() => setSelectedLog(log)}
                    >
                      <TableCell className="text-right">
                        <div className="flex items-center gap-3 flex-row-reverse justify-end">
                          <div className="rounded-lg bg-muted p-2">
                            <Mail className="h-4 w-4 text-muted-foreground" />
                          </div>
                          <div className="text-right">
                            <p className="font-medium font-mono text-sm">{log.toEmail}</p>
                            {log.toName && (
                              <p className="text-sm text-muted-foreground">{log.toName}</p>
                            )}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="text-right max-w-[300px]">
                        <span className="truncate block text-sm">{log.subject}</span>
                      </TableCell>
                      <TableCell className="text-center">
                        <Badge
                          variant={statusColors[log.status]}
                          className={cn(
                            "gap-1.5",
                            log.status === "delivered" && "bg-green-100 text-green-800 hover:bg-green-100 dark:bg-green-900/30 dark:text-green-300",
                            log.status === "sent" && "bg-blue-100 text-blue-800 hover:bg-blue-100 dark:bg-blue-900/30 dark:text-blue-300",
                            log.status === "pending" && "bg-amber-100 text-amber-800 hover:bg-amber-100 dark:bg-amber-900/30 dark:text-amber-300"
                          )}
                        >
                          {statusIcons[log.status]}
                          {t.statuses[log.status]}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right text-sm text-muted-foreground">
                        {formatDate(log.sentAt || log.createdAt)}
                      </TableCell>
                      <TableCell className="text-center">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedLog(log);
                          }}
                          className="gap-2"
                        >
                          <Eye className="h-4 w-4" />
                          {t.actions.viewDetails}
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
