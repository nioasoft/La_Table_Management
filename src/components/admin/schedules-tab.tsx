"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Calendar,
  RefreshCw,
  Loader2,
  Send,
  Clock,
  AlertCircle,
  Building2,
  Mail,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { he } from "@/lib/translations/he";
import type { SettlementFrequency } from "@/db/schema";
import { cn } from "@/lib/utils";

const t = he.admin.schedules;

interface ScheduleItem {
  id: string;
  name: string;
  code: string;
  type: "supplier" | "franchisee";
  frequency: SettlementFrequency;
  frequencyLabel: string;
  email: string | null;
  contactName: string | null;
  lastRequestDate: string | null;
  nextRequestDate: string;
  pendingRequests: number;
  isActive: boolean;
}

interface ScheduleStats {
  total: number;
  byFrequency: Record<string, number>;
  withPendingRequests: number;
  withoutEmail: number;
}

interface ScheduleResponse {
  schedules: ScheduleItem[];
  stats: ScheduleStats;
}

function formatDate(dateString: string | null | undefined): string {
  if (!dateString) return t.table.never;
  return new Date(dateString).toLocaleDateString("he-IL", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function isDateSoon(dateString: string): boolean {
  const date = new Date(dateString);
  const now = new Date();
  const diffDays = Math.ceil((date.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  return diffDays <= 7;
}

export default function SchedulesTab() {
  const queryClient = useQueryClient();
  const [typeFilter, setTypeFilter] = useState<"all" | "supplier" | "franchisee">("all");
  const [frequencyFilter, setFrequencyFilter] = useState<"all" | SettlementFrequency>("all");

  // Fetch schedules
  const { data, isLoading, refetch, isFetching } = useQuery<ScheduleResponse>({
    queryKey: ["communication-schedules", { type: typeFilter, frequency: frequencyFilter }],
    queryFn: async () => {
      let url = "/api/communications/schedules?activeOnly=true";
      if (typeFilter !== "all") {
        url += `&type=${typeFilter}`;
      }
      if (frequencyFilter !== "all") {
        url += `&frequency=${frequencyFilter}`;
      }
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error("Failed to fetch schedules");
      }
      return response.json();
    },
  });

  // Send file request mutation
  const sendRequestMutation = useMutation({
    mutationFn: async ({ entityType, entityId }: { entityType: string; entityId: string }) => {
      const response = await fetch("/api/file-requests", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          entityType,
          entityId,
          documentType: "settlement_report",
          sendImmediately: true,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to send request");
      }

      return response.json();
    },
    onSuccess: () => {
      toast.success(t.messages.sendSuccess);
      queryClient.invalidateQueries({ queryKey: ["communication-schedules"] });
    },
    onError: (error: Error) => {
      toast.error(error.message || t.errors.failedToSend);
    },
  });

  const schedules = data?.schedules || [];
  const stats = data?.stats;

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
        <div className="grid gap-4 md:grid-cols-3">
          <Card className="border-s-4 border-s-blue-500 bg-gradient-to-l from-blue-50/50 to-transparent dark:from-blue-950/20">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">{t.stats.totalSuppliers}</CardTitle>
              <div className="rounded-full bg-blue-100 p-2 dark:bg-blue-900/30">
                <Users className="h-4 w-4 text-blue-600 dark:text-blue-400" />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-blue-700 dark:text-blue-300">{stats.total}</div>
            </CardContent>
          </Card>
          <Card className="border-s-4 border-s-amber-500 bg-gradient-to-l from-amber-50/50 to-transparent dark:from-amber-950/20">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">{t.stats.withPendingRequests}</CardTitle>
              <div className="rounded-full bg-amber-100 p-2 dark:bg-amber-900/30">
                <Clock className="h-4 w-4 text-amber-600 dark:text-amber-400" />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-amber-700 dark:text-amber-300">{stats.withPendingRequests}</div>
            </CardContent>
          </Card>
          <Card className="border-s-4 border-s-red-500 bg-gradient-to-l from-red-50/50 to-transparent dark:from-red-950/20">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">{t.stats.withoutEmail}</CardTitle>
              <div className="rounded-full bg-red-100 p-2 dark:bg-red-900/30">
                <AlertCircle className="h-4 w-4 text-red-600 dark:text-red-400" />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-red-700 dark:text-red-300">{stats.withoutEmail}</div>
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
              value={typeFilter}
              onValueChange={(value) => setTypeFilter(value as "all" | "supplier" | "franchisee")}
            >
              <SelectTrigger className="w-[160px]">
                <SelectValue placeholder={t.filters.allTypes} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t.filters.allTypes}</SelectItem>
                <SelectItem value="supplier">{t.filters.suppliers}</SelectItem>
                <SelectItem value="franchisee">{t.filters.franchisees}</SelectItem>
              </SelectContent>
            </Select>

            <Select
              value={frequencyFilter}
              onValueChange={(value) => setFrequencyFilter(value as "all" | SettlementFrequency)}
            >
              <SelectTrigger className="w-[160px]">
                <SelectValue placeholder={t.filters.allFrequencies} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t.filters.allFrequencies}</SelectItem>
                <SelectItem value="weekly">{t.frequencies.weekly}</SelectItem>
                <SelectItem value="bi_weekly">{t.frequencies.bi_weekly}</SelectItem>
                <SelectItem value="monthly">{t.frequencies.monthly}</SelectItem>
                <SelectItem value="quarterly">{t.frequencies.quarterly}</SelectItem>
                <SelectItem value="semi_annual">{t.frequencies.semi_annual}</SelectItem>
                <SelectItem value="annual">{t.frequencies.annual}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </Card>

      {/* Schedules Table */}
      <Card>
        <CardHeader className="border-b bg-muted/30">
          <div className="flex items-center gap-3 flex-row-reverse">
            <div className="rounded-lg bg-primary/10 p-2">
              <Calendar className="h-5 w-5 text-primary" />
            </div>
            <div className="text-right">
              <CardTitle>{t.title}</CardTitle>
              <p className="text-sm text-muted-foreground mt-1">{t.description}</p>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {schedules.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <Calendar className="h-12 w-12 mx-auto mb-4 opacity-20" />
              <p>{t.emptyState}</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50 hover:bg-muted/50">
                    <TableHead className="text-right font-semibold">{t.table.name}</TableHead>
                    <TableHead className="text-right font-semibold">{t.table.frequency}</TableHead>
                    <TableHead className="text-right font-semibold">{t.table.email}</TableHead>
                    <TableHead className="text-right font-semibold">{t.table.lastRequest}</TableHead>
                    <TableHead className="text-right font-semibold">{t.table.nextRequest}</TableHead>
                    <TableHead className="text-center font-semibold">{t.table.pendingRequests}</TableHead>
                    <TableHead className="text-center font-semibold">{t.table.actions}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {schedules.map((schedule, index) => (
                    <TableRow
                      key={schedule.id}
                      className={cn(
                        "transition-colors",
                        index % 2 === 0 ? "bg-background" : "bg-muted/20"
                      )}
                    >
                      <TableCell className="text-right">
                        <div className="flex items-center gap-3 flex-row-reverse justify-end">
                          <div className="rounded-lg bg-muted p-2">
                            <Building2 className="h-4 w-4 text-muted-foreground" />
                          </div>
                          <div className="text-right">
                            <p className="font-medium">{schedule.name}</p>
                            <p className="text-xs text-muted-foreground font-mono">{schedule.code}</p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <Badge
                          variant="outline"
                          className="bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-950/30 dark:text-purple-300 dark:border-purple-800"
                        >
                          {schedule.frequencyLabel}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        {schedule.email ? (
                          <div className="flex items-center gap-2 flex-row-reverse justify-end">
                            <Mail className="h-3.5 w-3.5 text-green-600" />
                            <span className="text-sm font-mono text-muted-foreground">{schedule.email}</span>
                          </div>
                        ) : (
                          <Badge variant="outline" className="bg-red-50 text-red-600 border-red-200 dark:bg-red-950/30 dark:text-red-300">
                            {t.table.noEmail}
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right text-sm text-muted-foreground">
                        {formatDate(schedule.lastRequestDate)}
                      </TableCell>
                      <TableCell className="text-right">
                        <span className={cn(
                          "text-sm font-medium",
                          isDateSoon(schedule.nextRequestDate)
                            ? "text-amber-600 dark:text-amber-400"
                            : "text-foreground"
                        )}>
                          {formatDate(schedule.nextRequestDate)}
                        </span>
                      </TableCell>
                      <TableCell className="text-center">
                        {schedule.pendingRequests > 0 ? (
                          <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-100 dark:bg-amber-900/30 dark:text-amber-300">
                            {schedule.pendingRequests}
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-muted-foreground">0</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-center">
                        <Button
                          size="sm"
                          variant={schedule.email ? "default" : "outline"}
                          onClick={() =>
                            sendRequestMutation.mutate({
                              entityType: schedule.type,
                              entityId: schedule.id,
                            })
                          }
                          disabled={!schedule.email || sendRequestMutation.isPending}
                          className="gap-2"
                        >
                          {sendRequestMutation.isPending ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Send className="h-4 w-4" />
                          )}
                          {t.actions.sendNow}
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
