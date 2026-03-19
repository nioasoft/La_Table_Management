"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Scale,
  Loader2,
  Plus,
  CheckCircle2,
  AlertCircle,
  Clock,
  Minus,
  Check,
  X,
  FileSpreadsheet,
  Download,
} from "lucide-react";
import { useClients } from "@/queries/clients";
import {
  useClientReconciliationSessions,
  useClientReconciliationSession,
  useCreateClientReconciliation,
  useApproveSession,
  useUpdateComparisonStatus,
} from "@/queries/client-reconciliation";
import { toast } from "sonner";

// ─────────────────────────────────────────────────────────────────────────────

const MONTHS = [
  "ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני",
  "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר",
];

function formatAmount(amount: string | null): string {
  if (!amount) return "-";
  const num = parseFloat(amount);
  return new Intl.NumberFormat("he-IL", {
    style: "currency",
    currency: "ILS",
    maximumFractionDigits: 0,
  }).format(num);
}

function getStatusBadge(status: string) {
  switch (status) {
    case "in_progress":
      return <Badge variant="secondary"><Clock className="h-3 w-3 me-1" />בעבודה</Badge>;
    case "completed":
      return <Badge className="bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300">הושלם</Badge>;
    case "file_approved":
      return <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300"><Check className="h-3 w-3 me-1" />אושר</Badge>;
    case "file_rejected":
      return <Badge variant="destructive"><X className="h-3 w-3 me-1" />נדחה</Badge>;
    default:
      return <Badge variant="outline">{status}</Badge>;
  }
}

function getComparisonStatusIcon(status: string) {
  switch (status) {
    case "auto_approved":
    case "manually_approved":
      return <CheckCircle2 className="h-4 w-4 text-emerald-500" />;
    case "needs_review":
      return <AlertCircle className="h-4 w-4 text-amber-500" />;
    case "pending":
      return <Clock className="h-4 w-4 text-blue-500" />;
    case "sent_to_review_queue":
      return <AlertCircle className="h-4 w-4 text-red-500" />;
    default:
      return <Minus className="h-4 w-4 text-muted-foreground" />;
  }
}

// ─────────────────────────────────────────────────────────────────────────────

export default function ClientReconciliationPage() {
  const now = new Date();
  const [periodMonth, setPeriodMonth] = useState(now.getMonth() + 1);
  const [periodYear, setPeriodYear] = useState(now.getFullYear());
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [createClientId, setCreateClientId] = useState("");
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);

  const { data: clients } = useClients({ active: true });
  const { data: sessions, isLoading: sessionsLoading } =
    useClientReconciliationSessions();
  const { data: sessionDetail, isLoading: detailLoading } =
    useClientReconciliationSession(selectedSessionId ?? "");
  const createMutation = useCreateClientReconciliation();
  const approveMutation = useApproveSession();
  const updateComparisonMutation = useUpdateComparisonStatus();

  const activeClients = (clients ?? []).filter(
    (c: { isActive: boolean }) => c.isActive
  );

  // Filter sessions by period
  const periodSessions = (sessions ?? []).filter(
    (s: { periodMonth: number; periodYear: number }) =>
      s.periodMonth === periodMonth && s.periodYear === periodYear
  );

  const handleCreate = () => {
    if (!createClientId) return;
    createMutation.mutate(
      { clientId: createClientId, periodMonth, periodYear },
      {
        onSuccess: (data: { id: string }) => {
          toast.success("התאמה נוצרה בהצלחה");
          setCreateDialogOpen(false);
          setCreateClientId("");
          setSelectedSessionId(data.id);
        },
        onError: (error: Error) => toast.error(error.message),
      }
    );
  };

  const handleApprove = (sessionId: string) => {
    approveMutation.mutate(sessionId, {
      onSuccess: () => toast.success("ההתאמה אושרה"),
      onError: (error: Error) => toast.error(error.message),
    });
  };

  const handleComparisonApprove = (comparisonId: string) => {
    updateComparisonMutation.mutate(
      { id: comparisonId, status: "manually_approved" },
      {
        onSuccess: () => toast.success("שורה אושרה"),
        onError: (error: Error) => toast.error(error.message),
      }
    );
  };

  const handleExportHashavshevet = async (sessionId: string) => {
    try {
      const res = await fetch(
        `/api/reports/hashavshevet/client-export?sessionId=${sessionId}`
      );
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "שגיאה בייצוא");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download =
        res.headers.get("content-disposition")?.split("filename=")[1]?.replace(/"/g, "") ||
        "export.xlsx";
      a.click();
      URL.revokeObjectURL(url);
      toast.success("הקובץ הורד בהצלחה");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "שגיאה בייצוא");
    }
  };

  // ─── Session Detail View ──────────────────────────────────────────────────

  if (selectedSessionId && sessionDetail) {
    const { session, comparisons } = sessionDetail;

    return (
      <div className="p-6 space-y-6">
        {/* Back button + header */}
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSelectedSessionId(null)}
            >
              → חזרה לרשימה
            </Button>
            <div>
              <h1 className="text-xl font-bold">
                התאמת {session.clientName} — {MONTHS[session.periodMonth - 1]}{" "}
                {session.periodYear}
              </h1>
              <div className="flex items-center gap-3 mt-1">
                {getStatusBadge(session.status)}
                <span className="text-sm text-muted-foreground">
                  {session.totalFranchisees} זכיינים · {session.matchedCount}{" "}
                  תואמים · {session.needsReviewCount} לבדיקה
                </span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {session.status === "in_progress" && (
              <Button
                variant="default"
                size="sm"
                onClick={() => handleApprove(session.id)}
                disabled={approveMutation.isPending}
              >
                <Check className="h-4 w-4 me-1" />
                אשר הכל
              </Button>
            )}
            {(session.status === "file_approved" ||
              session.status === "in_progress") && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleExportHashavshevet(session.id)}
              >
                <Download className="h-4 w-4 me-1" />
                ייצוא לחשבשבת
              </Button>
            )}
          </div>
        </div>

        {/* Summary cards */}
        <div className="grid grid-cols-3 gap-4">
          <Card>
            <CardContent className="p-4 text-center">
              <p className="text-xl font-bold tabular-nums">
                {formatAmount(session.totalClientAmount)}
              </p>
              <p className="text-xs text-muted-foreground">סה&quot;כ לקוח</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 text-center">
              <p className="text-xl font-bold tabular-nums">
                {formatAmount(session.totalTabitAmount)}
              </p>
              <p className="text-xs text-muted-foreground">סה&quot;כ טאביט</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 text-center">
              <p
                className={`text-xl font-bold tabular-nums ${
                  Math.abs(parseFloat(session.totalDifference || "0")) > 30
                    ? "text-amber-600"
                    : "text-emerald-600"
                }`}
              >
                {formatAmount(session.totalDifference)}
              </p>
              <p className="text-xs text-muted-foreground">הפרש</p>
            </CardContent>
          </Card>
        </div>

        {/* Comparison table */}
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="text-right pe-4">זכיין</TableHead>
                  <TableHead className="text-right">סכום לקוח</TableHead>
                  <TableHead className="text-right">סכום טאביט</TableHead>
                  <TableHead className="text-right">הפרש</TableHead>
                  <TableHead className="text-right">עמלה %</TableHead>
                  <TableHead className="text-right">סכום עמלה</TableHead>
                  <TableHead className="text-right">סכום לחשבונית</TableHead>
                  <TableHead className="text-center">סטטוס</TableHead>
                  <TableHead className="text-center w-[100px]">פעולות</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {comparisons.map(
                  (comp: {
                    id: string;
                    franchiseeName: string;
                    clientAmount: string | null;
                    tabitAmount: string | null;
                    difference: string | null;
                    actualCommissionRate: string | null;
                    commissionAmount: string | null;
                    netAmount: string | null;
                    status: string;
                    clientDocFileName: string | null;
                    tabitDocFileName: string | null;
                  }) => {
                    const diff = comp.difference
                      ? parseFloat(comp.difference)
                      : null;
                    const isLargeDiff =
                      diff !== null && Math.abs(diff) > 30;

                    return (
                      <TableRow key={comp.id}>
                        <TableCell className="pe-4 font-medium">
                          {comp.franchiseeName}
                        </TableCell>
                        <TableCell>
                          <span className="tabular-nums text-sm">
                            {formatAmount(comp.clientAmount)}
                          </span>
                          {!comp.clientDocFileName && comp.clientAmount === null && (
                            <Badge
                              variant="outline"
                              className="ms-2 text-[10px] text-amber-600 border-amber-300"
                            >
                              חסר
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          <span className="tabular-nums text-sm">
                            {formatAmount(comp.tabitAmount)}
                          </span>
                          {!comp.tabitDocFileName && comp.tabitAmount === null && (
                            <Badge
                              variant="outline"
                              className="ms-2 text-[10px] text-amber-600 border-amber-300"
                            >
                              חסר
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          <span
                            className={`tabular-nums text-sm ${
                              isLargeDiff
                                ? "text-amber-600 font-medium"
                                : ""
                            }`}
                          >
                            {formatAmount(comp.difference)}
                          </span>
                        </TableCell>
                        <TableCell>
                          <span className="tabular-nums text-sm" dir="ltr">
                            {comp.actualCommissionRate
                              ? `${comp.actualCommissionRate}%`
                              : "-"}
                          </span>
                        </TableCell>
                        <TableCell>
                          <span className="tabular-nums text-sm">
                            {formatAmount(comp.commissionAmount)}
                          </span>
                        </TableCell>
                        <TableCell>
                          <span className="tabular-nums text-sm font-medium">
                            {formatAmount(comp.netAmount)}
                          </span>
                        </TableCell>
                        <TableCell className="text-center">
                          {getComparisonStatusIcon(comp.status)}
                        </TableCell>
                        <TableCell className="text-center">
                          {comp.status === "needs_review" && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 text-xs"
                              onClick={() =>
                                handleComparisonApprove(comp.id)
                              }
                              disabled={updateComparisonMutation.isPending}
                            >
                              <Check className="h-3 w-3 me-1" />
                              אשר
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  }
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Loading session detail
  if (selectedSessionId && detailLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // ─── Sessions List View ───────────────────────────────────────────────────

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
            <Scale className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">התאמת לקוחות</h1>
            <p className="text-sm text-muted-foreground">
              השוואת דוחות לקוחות מול טאביט
            </p>
          </div>
        </div>
        <Button onClick={() => setCreateDialogOpen(true)}>
          <Plus className="h-4 w-4 me-2" />
          יצירת התאמה
        </Button>
      </div>

      {/* Period selector */}
      <div className="flex items-center gap-3">
        <Select
          value={String(periodMonth)}
          onValueChange={(v) => setPeriodMonth(parseInt(v))}
        >
          <SelectTrigger className="w-[130px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {MONTHS.map((name, idx) => (
              <SelectItem key={idx + 1} value={String(idx + 1)}>
                {name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={String(periodYear)}
          onValueChange={(v) => setPeriodYear(parseInt(v))}
        >
          <SelectTrigger className="w-[90px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {[2024, 2025, 2026, 2027].map((y) => (
              <SelectItem key={y} value={String(y)}>
                {y}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Sessions table */}
      <Card>
        <CardContent className="p-0">
          {sessionsLoading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : periodSessions.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <Scale className="h-10 w-10 text-muted-foreground/40 mb-3" />
              <p className="text-sm text-muted-foreground">
                אין התאמות לתקופה זו. לחץ &quot;יצירת התאמה&quot; להתחלה.
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="text-right pe-4">לקוח</TableHead>
                  <TableHead className="text-right">תקופה</TableHead>
                  <TableHead className="text-right">זכיינים</TableHead>
                  <TableHead className="text-right">תואמים</TableHead>
                  <TableHead className="text-right">לבדיקה</TableHead>
                  <TableHead className="text-right">סה&quot;כ לקוח</TableHead>
                  <TableHead className="text-right">סה&quot;כ טאביט</TableHead>
                  <TableHead className="text-right">הפרש</TableHead>
                  <TableHead className="text-center">סטטוס</TableHead>
                  <TableHead className="text-center w-[100px]">פעולות</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {periodSessions.map(
                  (s: {
                    id: string;
                    clientName: string;
                    clientCode: string | null;
                    periodMonth: number;
                    periodYear: number;
                    totalFranchisees: number;
                    matchedCount: number;
                    needsReviewCount: number;
                    totalClientAmount: string | null;
                    totalTabitAmount: string | null;
                    totalDifference: string | null;
                    status: string;
                  }) => (
                    <TableRow
                      key={s.id}
                      className="cursor-pointer"
                      onClick={() => setSelectedSessionId(s.id)}
                    >
                      <TableCell className="pe-4">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{s.clientName}</span>
                          {s.clientCode && (
                            <Badge
                              variant="outline"
                              className="font-mono text-xs"
                            >
                              {s.clientCode}
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <span className="text-sm">
                          {MONTHS[s.periodMonth - 1]} {s.periodYear}
                        </span>
                      </TableCell>
                      <TableCell>
                        <span className="tabular-nums text-sm">
                          {s.totalFranchisees}
                        </span>
                      </TableCell>
                      <TableCell>
                        <span className="tabular-nums text-sm text-emerald-600">
                          {s.matchedCount}
                        </span>
                      </TableCell>
                      <TableCell>
                        <span
                          className={`tabular-nums text-sm ${
                            s.needsReviewCount > 0 ? "text-amber-600" : ""
                          }`}
                        >
                          {s.needsReviewCount}
                        </span>
                      </TableCell>
                      <TableCell>
                        <span className="tabular-nums text-sm">
                          {formatAmount(s.totalClientAmount)}
                        </span>
                      </TableCell>
                      <TableCell>
                        <span className="tabular-nums text-sm">
                          {formatAmount(s.totalTabitAmount)}
                        </span>
                      </TableCell>
                      <TableCell>
                        <span className="tabular-nums text-sm">
                          {formatAmount(s.totalDifference)}
                        </span>
                      </TableCell>
                      <TableCell className="text-center">
                        {getStatusBadge(s.status)}
                      </TableCell>
                      <TableCell className="text-center">
                        {s.status === "file_approved" && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 text-xs"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleExportHashavshevet(s.id);
                            }}
                          >
                            <FileSpreadsheet className="h-3 w-3 me-1" />
                            ייצוא
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  )
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Create Dialog */}
      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>יצירת התאמה חדשה</DialogTitle>
            <DialogDescription>
              בחר לקוח ליצירת השוואה מול דוחות טאביט עבור{" "}
              {MONTHS[periodMonth - 1]} {periodYear}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">לקוח</label>
              <Select
                value={createClientId}
                onValueChange={setCreateClientId}
              >
                <SelectTrigger>
                  <SelectValue placeholder="בחר לקוח..." />
                </SelectTrigger>
                <SelectContent>
                  {activeClients.map(
                    (c: { id: string; name: string; code: string | null }) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                        {c.code ? ` (${c.code})` : ""}
                      </SelectItem>
                    )
                  )}
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter className="gap-2 pt-2">
            <Button
              variant="outline"
              onClick={() => {
                setCreateDialogOpen(false);
                setCreateClientId("");
              }}
            >
              ביטול
            </Button>
            <Button
              onClick={handleCreate}
              disabled={!createClientId || createMutation.isPending}
            >
              {createMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin me-2" />
              ) : (
                <Plus className="h-4 w-4 me-2" />
              )}
              צור התאמה
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
