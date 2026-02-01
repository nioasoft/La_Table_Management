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
} from "lucide-react";
import { toast } from "sonner";
import { he } from "@/lib/translations/he";
import type { SettlementFrequency } from "@/db/schema";

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
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">{t.stats.totalSuppliers}</CardTitle>
              <Building2 className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.total}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">{t.stats.withPendingRequests}</CardTitle>
              <Clock className="h-4 w-4 text-yellow-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.withPendingRequests}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">{t.stats.withoutEmail}</CardTitle>
              <AlertCircle className="h-4 w-4 text-red-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.withoutEmail}</div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Filters */}
      <div className="flex items-center gap-4 flex-wrap">
        <Select
          value={typeFilter}
          onValueChange={(value) => setTypeFilter(value as "all" | "supplier" | "franchisee")}
        >
          <SelectTrigger className="w-[180px]">
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
          <SelectTrigger className="w-[180px]">
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

        <Button variant="outline" onClick={() => refetch()} disabled={isFetching}>
          {isFetching ? (
            <Loader2 className="h-4 w-4 animate-spin ms-2" />
          ) : (
            <RefreshCw className="h-4 w-4 ms-2" />
          )}
          {t.actions.refresh}
        </Button>
      </div>

      {/* Schedules Table */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calendar className="h-5 w-5" />
            {t.title}
          </CardTitle>
          <CardDescription>{t.description}</CardDescription>
        </CardHeader>
        <CardContent>
          {schedules.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              {t.emptyState}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-right">{t.table.name}</TableHead>
                  <TableHead className="text-right">{t.table.frequency}</TableHead>
                  <TableHead className="text-right">{t.table.email}</TableHead>
                  <TableHead className="text-right">{t.table.lastRequest}</TableHead>
                  <TableHead className="text-right">{t.table.nextRequest}</TableHead>
                  <TableHead className="text-right">{t.table.pendingRequests}</TableHead>
                  <TableHead className="text-right">{t.table.actions}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {schedules.map((schedule) => (
                  <TableRow key={schedule.id}>
                    <TableCell className="text-right">
                      <div className="flex items-center gap-2 justify-end">
                        <div>
                          <p className="font-medium">{schedule.name}</p>
                          <p className="text-sm text-muted-foreground">{schedule.code}</p>
                        </div>
                        <Building2 className="h-4 w-4 text-muted-foreground" />
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <Badge variant="outline">{schedule.frequencyLabel}</Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      {schedule.email ? (
                        <div className="flex items-center gap-1 justify-end">
                          <Mail className="h-3 w-3 text-muted-foreground" />
                          <span className="text-sm">{schedule.email}</span>
                        </div>
                      ) : (
                        <span className="text-sm text-muted-foreground">{t.table.noEmail}</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {formatDate(schedule.lastRequestDate)}
                    </TableCell>
                    <TableCell className="text-right">
                      <span className={isDateSoon(schedule.nextRequestDate) ? "text-yellow-600 font-medium" : ""}>
                        {formatDate(schedule.nextRequestDate)}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      {schedule.pendingRequests > 0 ? (
                        <Badge variant="secondary" className="bg-yellow-100 text-yellow-800">
                          {schedule.pendingRequests}
                        </Badge>
                      ) : (
                        <Badge variant="outline">0</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          sendRequestMutation.mutate({
                            entityType: schedule.type,
                            entityId: schedule.id,
                          })
                        }
                        disabled={!schedule.email || sendRequestMutation.isPending}
                      >
                        {sendRequestMutation.isPending ? (
                          <Loader2 className="h-4 w-4 animate-spin ms-1" />
                        ) : (
                          <Send className="h-4 w-4 ms-1" />
                        )}
                        {t.actions.sendNow}
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
