"use client";

import { useState, useRef, useEffect } from "react";
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
  TableFooter,
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
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Textarea } from "@/components/ui/textarea";
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
  FileText,
  MessageSquare,
  Pencil,
  Zap,
} from "lucide-react";
import { useClients } from "@/queries/clients";
import { useFranchisees } from "@/queries/franchisees";
import {
  useClientReconciliationSessions,
  useClientReconciliationSession,
  useCreateClientReconciliation,
  useCreateBatchReconciliation,
  useDeleteClientReconciliation,
  useApproveSession,
  useUpdateComparisonStatus,
  useUpdateComparisonNotes,
  useReconciliationByFranchisee,
  useApproveRow,
  useUnapproveRow,
  useBatchApproveFranchisee,
  useUpsertReconciliationNote,
  type ByFranchiseeRow,
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

// ─── Notes Cell ──────────────────────────────────────────────────────────────

function NotesCell({
  comparisonId,
  notes,
  onSave,
  isSaving,
}: {
  comparisonId: string;
  notes: string | null;
  onSave: (id: string, notes: string) => void;
  isSaving: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(notes ?? "");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (open) {
      setDraft(notes ?? "");
      setTimeout(() => textareaRef.current?.focus(), 50);
    }
  }, [open, notes]);

  const handleSave = () => {
    onSave(comparisonId, draft);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors max-w-[150px]"
          title={notes || "הוסף הערה"}
        >
          {notes ? (
            <span className="truncate">{notes}</span>
          ) : (
            <MessageSquare className="h-3.5 w-3.5" />
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-3" dir="rtl" align="start">
        <div className="space-y-2">
          <Textarea
            ref={textareaRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="הערה..."
            className="text-sm min-h-[60px] resize-none"
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                handleSave();
              }
            }}
          />
          <div className="flex justify-end gap-1">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              onClick={() => setOpen(false)}
            >
              ביטול
            </Button>
            <Button
              size="sm"
              className="h-7 text-xs"
              onClick={handleSave}
              disabled={isSaving}
            >
              {isSaving ? (
                <Loader2 className="h-3 w-3 animate-spin me-1" />
              ) : (
                <Check className="h-3 w-3 me-1" />
              )}
              שמור
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

// ─── By-Franchisee Note Cell (per-row note, independent of approval) ────────

function ByFranchiseeNoteCell({
  note,
  onSave,
  onClear,
  isSaving,
}: {
  note: string | null;
  onSave: (next: string) => void;
  onClear: () => void;
  isSaving: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(note ?? "");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (open) {
      setDraft(note ?? "");
      setTimeout(() => textareaRef.current?.focus(), 50);
    }
  }, [open, note]);

  const handleSave = () => {
    if (draft.trim() === (note ?? "").trim()) {
      setOpen(false);
      return;
    }
    onSave(draft);
    setOpen(false);
  };

  const handleClear = () => {
    onClear();
    setOpen(false);
  };

  const hasNote = !!note && note.trim().length > 0;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className={`h-7 w-7 p-0 mx-auto ${
            hasNote ? "text-blue-600 hover:text-blue-700" : "text-muted-foreground"
          }`}
          title={hasNote ? note! : "הוסף הערה"}
        >
          <MessageSquare
            className={`h-4 w-4 ${hasNote ? "fill-blue-100" : ""}`}
          />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-3" dir="rtl" align="center">
        <div className="space-y-2">
          <Textarea
            ref={textareaRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="הערה לשורה זו..."
            className="text-sm min-h-[72px] resize-none"
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                handleSave();
              }
            }}
          />
          <div className="flex items-center justify-between gap-1">
            {hasNote ? (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs text-destructive hover:text-destructive"
                onClick={handleClear}
                disabled={isSaving}
              >
                <X className="h-3 w-3 me-1" />
                מחק
              </Button>
            ) : (
              <span />
            )}
            <div className="flex gap-1">
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs"
                onClick={() => setOpen(false)}
              >
                ביטול
              </Button>
              <Button
                size="sm"
                className="h-7 text-xs"
                onClick={handleSave}
                disabled={isSaving}
              >
                {isSaving ? (
                  <Loader2 className="h-3 w-3 animate-spin me-1" />
                ) : (
                  <Check className="h-3 w-3 me-1" />
                )}
                שמור
              </Button>
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

export default function ClientReconciliationPage() {
  const now = new Date();
  const [periodMonth, setPeriodMonth] = useState(now.getMonth() + 1);
  const [periodYear, setPeriodYear] = useState(now.getFullYear());
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [createClientId, setCreateClientId] = useState("");
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [viewTab, setViewTab] = useState<"by-client" | "by-franchisee">("by-franchisee");
  const [selectedFranchiseeId, setSelectedFranchiseeId] = useState("");

  const { data: clients } = useClients({ active: true });
  const { data: allFranchisees } = useFranchisees();
  const { data: byFranchiseeData, isLoading: byFranchiseeLoading } =
    useReconciliationByFranchisee(selectedFranchiseeId, periodMonth, periodYear);
  const { data: sessions, isLoading: sessionsLoading } =
    useClientReconciliationSessions();
  const { data: sessionDetail, isLoading: detailLoading } =
    useClientReconciliationSession(selectedSessionId ?? "");
  const createMutation = useCreateClientReconciliation();
  const batchMutation = useCreateBatchReconciliation();
  const notesMutation = useUpdateComparisonNotes();
  const deleteMutation = useDeleteClientReconciliation();
  const approveMutation = useApproveSession();
  const updateComparisonMutation = useUpdateComparisonStatus();
  const approveRowMutation = useApproveRow();
  const unapproveRowMutation = useUnapproveRow();
  const batchApproveFranchiseeMutation = useBatchApproveFranchisee();
  const upsertNoteMutation = useUpsertReconciliationNote();

  const activeClients = (clients ?? []).filter(
    (c: { isActive: boolean }) => c.isActive
  );

  // Filter sessions by period
  const periodSessions = (sessions ?? []).filter(
    (s: { periodMonth: number; periodYear: number }) =>
      s.periodMonth === periodMonth && s.periodYear === periodYear
  );

  // Check if selected client already has a session for this period
  const existingSessionForClient = createClientId
    ? (periodSessions as { id: string; clientId: string }[]).find(
        (s) => s.clientId === createClientId
      )
    : null;

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

  const handleDeleteAndRecreate = () => {
    if (!existingSessionForClient) return;
    deleteMutation.mutate(existingSessionForClient.id, {
      onSuccess: () => {
        // Now create the new session
        handleCreate();
      },
      onError: (error: Error) => toast.error(error.message),
    });
  };

  const handleContinueExisting = () => {
    if (!existingSessionForClient) return;
    setSelectedSessionId(existingSessionForClient.id);
    setCreateDialogOpen(false);
    setCreateClientId("");
  };

  const handleApprove = (sessionId: string) => {
    approveMutation.mutate(sessionId, {
      onSuccess: () => toast.success("ההתאמה אושרה"),
      onError: (error: Error) => toast.error(error.message),
    });
  };

  const handleBatchCreate = () => {
    batchMutation.mutate(
      { periodMonth, periodYear },
      {
        onSuccess: (result) => {
          if (result.created > 0) {
            toast.success(
              `נוצרו ${result.created} התאמות` +
                (result.skipped > 0 ? ` (${result.skipped} כבר קיימות)` : "")
            );
          } else if (result.skipped > 0) {
            toast.info(`כל ההתאמות כבר קיימות לתקופה זו (${result.skipped})`);
          }
          if (result.failed > 0) {
            toast.error(`${result.failed} התאמות נכשלו`);
          }
          // Switch to by-client view to see results
          setViewTab("by-client");
        },
        onError: (error: Error) => toast.error(error.message),
      }
    );
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

  const handleByFranchiseeRowApprove = (clientId: string) => {
    if (!selectedFranchiseeId) return;
    approveRowMutation.mutate(
      {
        clientId,
        franchiseeId: selectedFranchiseeId,
        periodMonth,
        periodYear,
      },
      {
        onSuccess: () => toast.success("שורה אושרה"),
        onError: (error: Error) => toast.error(error.message),
      }
    );
  };

  const handleByFranchiseeRowUnapprove = (clientId: string) => {
    if (!selectedFranchiseeId) return;
    unapproveRowMutation.mutate(
      {
        clientId,
        franchiseeId: selectedFranchiseeId,
        periodMonth,
        periodYear,
      },
      {
        onSuccess: () => toast.success("האישור בוטל"),
        onError: (error: Error) => toast.error(error.message),
      }
    );
  };

  const handleByFranchiseeApproveAll = () => {
    if (!selectedFranchiseeId) return;
    batchApproveFranchiseeMutation.mutate(
      { franchiseeId: selectedFranchiseeId, periodMonth, periodYear },
      {
        onSuccess: (res) =>
          toast.success(
            res.approvedCount > 0
              ? `${res.approvedCount} שורות אושרו`
              : "אין שורות חדשות לאישור"
          ),
        onError: (error: Error) => toast.error(error.message),
      }
    );
  };

  const handleByFranchiseeExport = async (
    exportType: "client_invoices" | "journal_entries"
  ) => {
    if (!selectedFranchiseeId) return;
    try {
      const baseParams = {
        franchiseeId: selectedFranchiseeId,
        periodMonth: String(periodMonth),
        periodYear: String(periodYear),
      };
      const endpointUrl =
        exportType === "client_invoices"
          ? `/api/reports/hashavshevet/franchisee-client-invoices-export?${new URLSearchParams(baseParams)}`
          : `/api/reports/hashavshevet/franchisee-journal-entries-export?${new URLSearchParams(baseParams)}`;
      const res = await fetch(endpointUrl);
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "שגיאה בייצוא");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const filename =
        res.headers
          .get("Content-Disposition")
          ?.match(/filename\*=UTF-8''([^;]+)/)?.[1];
      a.download = filename ? decodeURIComponent(filename) : "hashavshevet.xlsx";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success("הקובץ יוצא");
    } catch (error) {
      toast.error((error as Error).message);
    }
  };

  const handleExportHashavshevet = async (sessionId: string, exportType: "invoice" | "journal" = "invoice") => {
    try {
      const res = await fetch(
        `/api/reports/hashavshevet/client-export?sessionId=${sessionId}&exportType=${exportType}`
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
                  <TableHead className="text-right">הערות</TableHead>
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
                    notes: string | null;
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
                        <TableCell>
                          <NotesCell
                            comparisonId={comp.id}
                            notes={comp.notes}
                            onSave={(id, notes) =>
                              notesMutation.mutate(
                                { id, notes },
                                {
                                  onSuccess: () => toast.success("הערה נשמרה"),
                                  onError: (err: Error) => toast.error(err.message),
                                }
                              )
                            }
                            isSaving={notesMutation.isPending}
                          />
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
        <div className="flex items-center gap-2">
          <Button
            variant="default"
            onClick={handleBatchCreate}
            disabled={batchMutation.isPending}
          >
            {batchMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin me-2" />
            ) : (
              <Zap className="h-4 w-4 me-2" />
            )}
            התאם הכל
          </Button>
          <Button variant="outline" onClick={() => setCreateDialogOpen(true)}>
            <Plus className="h-4 w-4 me-2" />
            התאמה ללקוח
          </Button>
        </div>
      </div>

      {/* Tab toggle + Period selector */}
      <div className="flex items-center gap-4 flex-wrap">
        <div className="flex items-center rounded-lg border p-1 gap-1">
          <Button
            variant={viewTab === "by-franchisee" ? "default" : "ghost"}
            size="sm"
            className="h-7 text-xs"
            onClick={() => setViewTab("by-franchisee")}
          >
            לפי זכיין
          </Button>
          <Button
            variant={viewTab === "by-client" ? "default" : "ghost"}
            size="sm"
            className="h-7 text-xs"
            onClick={() => setViewTab("by-client")}
          >
            לפי לקוח
          </Button>
        </div>

        {viewTab === "by-franchisee" && (
          <Select
            value={selectedFranchiseeId}
            onValueChange={setSelectedFranchiseeId}
          >
            <SelectTrigger className="w-[200px]">
              <SelectValue placeholder="בחר זכיין..." />
            </SelectTrigger>
            <SelectContent>
              {(allFranchisees ?? []).map(
                (f: { id: string; name: string }) => (
                  <SelectItem key={f.id} value={f.id}>
                    {f.name}
                  </SelectItem>
                )
              )}
            </SelectContent>
          </Select>
        )}

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

      {/* ─── By Franchisee View ──────────────────────────────────────────── */}
      {viewTab === "by-franchisee" && (
        <Card>
          <CardContent className="p-0">
            {!selectedFranchiseeId ? (
              <div className="flex flex-col items-center justify-center py-16 text-center max-w-md mx-auto">
                <Scale className="h-10 w-10 text-muted-foreground/40 mb-3" />
                <p className="text-sm font-medium mb-1">בדיקת זכיין מול כל הלקוחות</p>
                <p className="text-xs text-muted-foreground">
                  בחר זכיין כדי לראות סיכום של כל הדוחות שהתקבלו מהלקוחות (סיבוס, טנביס, וולט וכו&apos;) מול דוח טאביט — ללא צורך ביצירת התאמה.
                </p>
              </div>
            ) : byFranchiseeLoading ? (
              <div className="flex items-center justify-center py-16">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : !byFranchiseeData || byFranchiseeData.rows.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <Scale className="h-10 w-10 text-muted-foreground/40 mb-3" />
                <p className="text-sm text-muted-foreground">
                  אין נתונים לזכיין זה בתקופה הנבחרת
                </p>
              </div>
            ) : (
              <>
                {/* Toolbar + Summary */}
                <div className="flex items-center justify-between gap-2 p-4 border-b">
                  <div className="grid grid-cols-4 gap-6 flex-1">
                    <div className="text-center">
                      <p className="text-lg font-bold tabular-nums text-emerald-600">
                        {byFranchiseeData.summary.ok}
                      </p>
                      <p className="text-xs text-muted-foreground">תקינים</p>
                    </div>
                    <div className="text-center">
                      <p className="text-lg font-bold tabular-nums text-amber-600">
                        {byFranchiseeData.summary.mismatch}
                      </p>
                      <p className="text-xs text-muted-foreground">פערים</p>
                    </div>
                    <div className="text-center">
                      <p className="text-lg font-bold tabular-nums text-blue-600">
                        {byFranchiseeData.summary.approved}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        אושרו ידנית
                      </p>
                    </div>
                    <div className="text-center">
                      <p className="text-lg font-bold tabular-nums text-muted-foreground">
                        {byFranchiseeData.summary.missing}
                      </p>
                      <p className="text-xs text-muted-foreground">חסרים</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={handleByFranchiseeApproveAll}
                      disabled={
                        batchApproveFranchiseeMutation.isPending ||
                        byFranchiseeData.summary.mismatch +
                          byFranchiseeData.summary.missing <=
                          byFranchiseeData.summary.approved
                      }
                    >
                      <Check className="h-4 w-4 me-1" />
                      אשר הכל
                    </Button>
                    <DropdownMenu dir="rtl">
                      <DropdownMenuTrigger asChild>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={
                            byFranchiseeData.summary.ok +
                              byFranchiseeData.summary.approved ===
                            0
                          }
                          title={
                            byFranchiseeData.summary.ok +
                              byFranchiseeData.summary.approved ===
                            0
                              ? "אין שורות מאושרות לייצוא"
                              : "ייצוא לחשבשבת"
                          }
                        >
                          ייצוא
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onClick={() =>
                            handleByFranchiseeExport("client_invoices")
                          }
                        >
                          חשבוניות לקוחות
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() =>
                            handleByFranchiseeExport("journal_entries")
                          }
                        >
                          תנועות יומן
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>

                {/* Table */}
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="text-right pe-4">לקוח</TableHead>
                      <TableHead className="text-right">סכום לקוח</TableHead>
                      <TableHead className="text-right">סכום טאביט</TableHead>
                      <TableHead className="text-right">הפרש</TableHead>
                      <TableHead className="text-center">סטטוס</TableHead>
                      <TableHead className="text-center">הערה</TableHead>
                      <TableHead className="text-center">פעולות</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {byFranchiseeData.rows.map((row: ByFranchiseeRow) => {
                      const isLargeDiff =
                        row.absoluteDifference !== null &&
                        row.absoluteDifference > 30;
                      const isApproved = row.approvedAt !== null;
                      const canApprove =
                        !isApproved &&
                        (row.status === "mismatch" ||
                          row.status === "missing_client" ||
                          row.status === "missing_tabit");

                      return (
                        <TableRow key={row.clientId}>
                          <TableCell className="pe-4">
                            <div className="flex items-center gap-2">
                              <span className="font-medium">
                                {row.clientName}
                              </span>
                              {row.clientCode && (
                                <Badge
                                  variant="outline"
                                  className="font-mono text-xs"
                                >
                                  {row.clientCode}
                                </Badge>
                              )}
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-1.5">
                              <span className="tabular-nums text-sm">
                                {row.clientAmount !== null
                                  ? formatAmount(String(row.clientAmount))
                                  : "-"}
                              </span>
                              {row.clientFileDocId ? (
                                <a
                                  href={`/api/clients/documents/${row.clientFileDocId}/download`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  title={row.clientFileName ?? "פתח קובץ לקוח"}
                                  className="inline-flex items-center justify-center h-6 w-6 rounded text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  <FileText className="h-3.5 w-3.5" />
                                </a>
                              ) : null}
                              {row.status === "missing_client" ||
                              row.status === "missing_both" ? (
                                <Badge
                                  variant="outline"
                                  className="text-[10px] text-amber-600 border-amber-300"
                                >
                                  חסר
                                </Badge>
                              ) : null}
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-1.5">
                              <span className="tabular-nums text-sm">
                                {row.tabitAmount !== null
                                  ? formatAmount(String(row.tabitAmount))
                                  : "-"}
                              </span>
                              {row.tabitFileDocId ? (
                                <a
                                  href={`/api/clients/documents/${row.tabitFileDocId}/download`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  title={row.tabitFileName ?? "פתח קובץ טאביט"}
                                  className="inline-flex items-center justify-center h-6 w-6 rounded text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  <FileSpreadsheet className="h-3.5 w-3.5" />
                                </a>
                              ) : null}
                              {row.status === "missing_tabit" ||
                              row.status === "missing_both" ? (
                                <Badge
                                  variant="outline"
                                  className="text-[10px] text-amber-600 border-amber-300"
                                >
                                  חסר
                                </Badge>
                              ) : null}
                            </div>
                          </TableCell>
                          <TableCell>
                            <span
                              className={`tabular-nums text-sm ${
                                isLargeDiff
                                  ? "text-amber-600 font-medium"
                                  : row.status === "ok"
                                    ? "text-emerald-600"
                                    : ""
                              }`}
                            >
                              {row.difference !== null
                                ? formatAmount(String(row.difference))
                                : "-"}
                            </span>
                          </TableCell>
                          <TableCell className="text-center">
                            {isApproved ? (
                              <div
                                className="flex items-center justify-center gap-1"
                                title={
                                  row.approvedByName
                                    ? `אושר ע״י ${row.approvedByName}`
                                    : "אושר ידנית"
                                }
                              >
                                <CheckCircle2 className="h-4 w-4 text-blue-500" />
                                <span className="text-[10px] text-blue-600">
                                  אושר ידנית
                                </span>
                              </div>
                            ) : row.status === "ok" ? (
                              <CheckCircle2 className="h-4 w-4 text-emerald-500 mx-auto" />
                            ) : row.status === "mismatch" ? (
                              <AlertCircle className="h-4 w-4 text-amber-500 mx-auto" />
                            ) : (
                              <Minus className="h-4 w-4 text-muted-foreground mx-auto" />
                            )}
                          </TableCell>
                          <TableCell className="text-center">
                            <ByFranchiseeNoteCell
                              note={row.approvalNotes}
                              isSaving={
                                upsertNoteMutation.isPending &&
                                upsertNoteMutation.variables?.clientId ===
                                  row.clientId
                              }
                              onSave={(next) => {
                                upsertNoteMutation.mutate(
                                  {
                                    clientId: row.clientId,
                                    franchiseeId: selectedFranchiseeId,
                                    periodMonth,
                                    periodYear,
                                    note: next,
                                  },
                                  {
                                    onSuccess: () =>
                                      toast.success("ההערה נשמרה"),
                                    onError: (err: Error) =>
                                      toast.error(err.message),
                                  }
                                );
                              }}
                              onClear={() => {
                                upsertNoteMutation.mutate(
                                  {
                                    clientId: row.clientId,
                                    franchiseeId: selectedFranchiseeId,
                                    periodMonth,
                                    periodYear,
                                    note: null,
                                  },
                                  {
                                    onSuccess: () =>
                                      toast.success("ההערה נמחקה"),
                                    onError: (err: Error) =>
                                      toast.error(err.message),
                                  }
                                );
                              }}
                            />
                          </TableCell>
                          <TableCell className="text-center">
                            {canApprove ? (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 text-xs"
                                onClick={() =>
                                  handleByFranchiseeRowApprove(row.clientId)
                                }
                                disabled={approveRowMutation.isPending}
                              >
                                <Check className="h-3 w-3 me-1" />
                                אשר
                              </Button>
                            ) : isApproved ? (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 text-xs text-muted-foreground hover:text-foreground"
                                onClick={() =>
                                  handleByFranchiseeRowUnapprove(row.clientId)
                                }
                                disabled={unapproveRowMutation.isPending}
                              >
                                בטל אישור
                              </Button>
                            ) : null}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                  {(() => {
                    const totalClient = byFranchiseeData.rows.reduce(
                      (s, r) => s + (r.clientAmount ?? 0),
                      0
                    );
                    const totalTabit = byFranchiseeData.rows.reduce(
                      (s, r) => s + (r.tabitAmount ?? 0),
                      0
                    );
                    const totalDiff = byFranchiseeData.rows.reduce(
                      (s, r) => s + (r.difference ?? 0),
                      0
                    );
                    return (
                      <TableFooter>
                        <TableRow>
                          <TableCell className="pe-4 font-medium">
                            סה&quot;כ
                          </TableCell>
                          <TableCell className="tabular-nums text-sm font-medium">
                            {formatAmount(String(totalClient))}
                          </TableCell>
                          <TableCell className="tabular-nums text-sm font-medium">
                            {formatAmount(String(totalTabit))}
                          </TableCell>
                          <TableCell
                            className={`tabular-nums text-sm font-medium ${
                              Math.abs(totalDiff) > 30
                                ? "text-amber-600"
                                : "text-emerald-600"
                            }`}
                          >
                            {formatAmount(String(totalDiff))}
                          </TableCell>
                          <TableCell />
                          <TableCell />
                          <TableCell />
                        </TableRow>
                      </TableFooter>
                    );
                  })()}
                </Table>
              </>
            )}
          </CardContent>
        </Card>
      )}

      {/* ─── By Client View (Sessions table) ─────────────────────────────── */}
      {viewTab === "by-client" && (
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
                      <TableCell className="text-center" onClick={(e) => e.stopPropagation()}>
                        {(s.status === "file_approved" || s.status === "in_progress" || s.status === "completed") && (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 text-xs"
                              >
                                <FileSpreadsheet className="h-3 w-3 me-1" />
                                ייצוא
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => handleExportHashavshevet(s.id, "invoice")}>
                                חשבונית
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => handleExportHashavshevet(s.id, "journal")}>
                                פקודת יומן
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
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
      )}

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

            {/* Warning: session already exists */}
            {existingSessionForClient && (
              <div className="flex items-center gap-2 p-3 bg-amber-50 dark:bg-amber-950/20 rounded-lg text-sm text-amber-800 dark:text-amber-300">
                <AlertCircle className="h-5 w-5 shrink-0" />
                <span>
                  קיים כבר סשן התאמה לתקופה זו. ניתן להמשיך לעבוד עליו או למחוק ולהתחיל מחדש.
                </span>
              </div>
            )}
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

            {existingSessionForClient ? (
              <>
                <Button
                  variant="destructive"
                  onClick={handleDeleteAndRecreate}
                  disabled={deleteMutation.isPending || createMutation.isPending}
                >
                  {deleteMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin me-2" />
                  ) : (
                    <X className="h-4 w-4 me-2" />
                  )}
                  מחק והתחל מחדש
                </Button>
                <Button onClick={handleContinueExisting}>
                  <Check className="h-4 w-4 me-2" />
                  המשך עבודה
                </Button>
              </>
            ) : (
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
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
