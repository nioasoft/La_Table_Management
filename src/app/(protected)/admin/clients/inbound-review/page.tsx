"use client";

/**
 * /admin/clients/inbound-review — Layer 2 Visibility surface.
 *
 * Read-only Hebrew RTL table showing every inbound email processed by
 * /api/clients/email-inbound (per inbound_review_queue). Header summarizes
 * arrivals per status. Filter by status/client/range. No actions yet —
 * Phase 2b adds confirm/reject/revert.
 */

import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { RefreshCw } from "lucide-react";

type InboundReviewStatus = "auto_committed" | "failed" | "needs_review";

interface InboundReviewEntry {
  id: string;
  gmailSyncLogId: string | null;
  gmailMessageId: string | null;
  emailSubject: string | null;
  emailFrom: string | null;
  emailReceivedAt: string | null;
  clientId: string | null;
  clientCode: string | null;
  proposedFranchiseeId: string | null;
  proposedFranchiseeName: string | null;
  franchiseeConfidence: string | null;
  franchiseeAlternatives:
    | Array<{ id: string; name: string; confidence: number }>
    | null;
  resolutionStrategy: string | null;
  proposedDocumentType: string | null;
  docTypeSource: string | null;
  status: InboundReviewStatus;
  failureReason: string | null;
  committedClientDocumentId: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  reviewNotes: string | null;
  createdAt: string;
  updatedAt: string;
}

interface InboundReviewResponse {
  entries: InboundReviewEntry[];
  statusCounts: Record<string, number>;
  range: { since: string; days: number };
}

const CLIENT_CODES = [
  "ALL",
  "WOLT",
  "HAAT",
  "MISHLOCHA",
  "CIBUS",
  "TENBIS",
  "TABIT",
  "HEVER",
] as const;

const STATUS_LABELS: Record<InboundReviewStatus | "ALL", string> = {
  ALL: "הכל",
  auto_committed: "אושר אוטומטית",
  failed: "נכשל",
  needs_review: "ממתין לסקירה",
};

const STATUS_BADGE: Record<InboundReviewStatus, string> = {
  auto_committed: "bg-green-100 text-green-800 hover:bg-green-100",
  failed: "bg-red-100 text-red-800 hover:bg-red-100",
  needs_review: "bg-yellow-100 text-yellow-800 hover:bg-yellow-100",
};

const DOC_TYPE_LABELS: Record<string, string> = {
  client_report: "דוח",
  commission_invoice: "חשבונית עמלה",
  tabit_report: "דוח Tabit",
};

function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString("he-IL", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatConfidence(value: string | null): string {
  if (!value) return "—";
  const num = parseFloat(value);
  if (Number.isNaN(num)) return value;
  return num.toFixed(2);
}

export default function InboundReviewPage() {
  const [status, setStatus] = useState<InboundReviewStatus | "ALL">("ALL");
  const [clientCode, setClientCode] =
    useState<(typeof CLIENT_CODES)[number]>("ALL");
  const [days, setDays] = useState<7 | 14 | 30>(7);

  const queryKey = useMemo(
    () => ["inbound-review", status, clientCode, days],
    [status, clientCode, days],
  );

  const { data, isLoading, isFetching, refetch } =
    useQuery<InboundReviewResponse>({
      queryKey,
      queryFn: async () => {
        const params = new URLSearchParams();
        if (status !== "ALL") params.set("status", status);
        if (clientCode !== "ALL") params.set("clientCode", clientCode);
        params.set("days", String(days));
        params.set("limit", "200");
        const res = await fetch(
          `/api/admin/inbound-review?${params.toString()}`,
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      },
      refetchInterval: 60_000, // auto-refresh every minute
    });

  const entries = data?.entries ?? [];
  const counts = data?.statusCounts ?? {};

  return (
    <div className="space-y-4 p-4" dir="rtl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">תיבת מיילים נכנסים</h1>
          <p className="text-sm text-muted-foreground">
            כל מייל מספקים שנכנס למערכת ב-{days} הימים האחרונים — מה הצליח, מה
            נכשל, ולאיזה זכיין הוצמד.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => refetch()}
          disabled={isFetching}
        >
          <RefreshCw
            className={`h-4 w-4 ms-2 ${isFetching ? "animate-spin" : ""}`}
          />
          רענן
        </Button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground">
              סך הכל
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {Object.values(counts).reduce((a, b) => a + b, 0)}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-green-700">
              אושרו אוטומטית
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-700">
              {counts.auto_committed ?? 0}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-red-700">
              נכשלו
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-700">
              {counts.failed ?? 0}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-yellow-700">
              ממתינים לסקירה
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-yellow-700">
              {counts.needs_review ?? 0}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-end">
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">סטטוס</label>
          <Select
            value={status}
            onValueChange={(v) => setStatus(v as typeof status)}
            dir="rtl"
          >
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(STATUS_LABELS) as Array<keyof typeof STATUS_LABELS>).map(
                (k) => (
                  <SelectItem key={k} value={k}>
                    {STATUS_LABELS[k]}
                  </SelectItem>
                ),
              )}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">ספק</label>
          <Select
            value={clientCode}
            onValueChange={(v) => setClientCode(v as typeof clientCode)}
            dir="rtl"
          >
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CLIENT_CODES.map((c) => (
                <SelectItem key={c} value={c}>
                  {c === "ALL" ? "הכל" : c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">טווח</label>
          <Select
            value={String(days)}
            onValueChange={(v) => setDays(Number(v) as typeof days)}
            dir="rtl"
          >
            <SelectTrigger className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7">7 ימים</SelectItem>
              <SelectItem value="14">14 ימים</SelectItem>
              <SelectItem value="30">30 ימים</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-right">סטטוס</TableHead>
                <TableHead className="text-right">התקבל</TableHead>
                <TableHead className="text-right">ספק</TableHead>
                <TableHead className="text-right">נושא</TableHead>
                <TableHead className="text-right">סוג</TableHead>
                <TableHead className="text-right">זכיין מוצע</TableHead>
                <TableHead className="text-right">ביטחון</TableHead>
                <TableHead className="text-right">סיבת כשל</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-8">
                    טוען...
                  </TableCell>
                </TableRow>
              )}
              {!isLoading && entries.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={8}
                    className="text-center py-8 text-muted-foreground"
                  >
                    אין מיילים בטווח שנבחר
                  </TableCell>
                </TableRow>
              )}
              {entries.map((e) => (
                <TableRow key={e.id}>
                  <TableCell>
                    <Badge className={STATUS_BADGE[e.status]} variant="outline">
                      {STATUS_LABELS[e.status]}
                    </Badge>
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-xs">
                    {formatDateTime(e.emailReceivedAt ?? e.createdAt)}
                  </TableCell>
                  <TableCell className="text-xs font-mono">
                    {e.clientCode ?? "—"}
                  </TableCell>
                  <TableCell
                    className="max-w-[300px] truncate text-xs"
                    title={e.emailSubject ?? ""}
                  >
                    {e.emailSubject ?? "—"}
                  </TableCell>
                  <TableCell className="text-xs">
                    {e.proposedDocumentType
                      ? DOC_TYPE_LABELS[e.proposedDocumentType] ??
                        e.proposedDocumentType
                      : "—"}
                  </TableCell>
                  <TableCell
                    className="max-w-[200px] truncate text-xs"
                    title={e.proposedFranchiseeName ?? ""}
                  >
                    {e.proposedFranchiseeName ?? "—"}
                  </TableCell>
                  <TableCell className="text-xs font-mono">
                    {formatConfidence(e.franchiseeConfidence)}
                  </TableCell>
                  <TableCell
                    className="max-w-[300px] truncate text-xs text-red-700"
                    title={e.failureReason ?? ""}
                  >
                    {e.failureReason ?? "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        הטבלה מתעדכנת אוטומטית כל דקה. שורות עם סטטוס &quot;נכשל&quot; או
        &quot;ממתין לסקירה&quot; דורשות התערבות ידנית — Layer 2b יוסיף כפתורי
        אישור/דחייה ישירות מכאן.
      </p>
    </div>
  );
}
