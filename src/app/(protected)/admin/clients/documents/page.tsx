"use client";

import { useState, useMemo, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  FileText,
  Upload,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Clock,
  Minus,
  RefreshCw,
  Search,
  Copy,
  X,
  Download,
} from "lucide-react";
import { useClients } from "@/queries/clients";
import { useFranchisees } from "@/queries/franchisees";
import {
  useDocumentTrackingMatrix,
  useDocumentPeriodSummary,
  useUploadClientDocument,
  useClientDocuments,
} from "@/queries/client-documents";
import { toast } from "sonner";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const MONTHS = [
  "ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני",
  "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר",
];

function getStatusIcon(status: string) {
  switch (status) {
    case "auto_approved":
    case "approved":
      return <CheckCircle2 className="h-4 w-4 text-emerald-500" />;
    case "needs_review":
      return <AlertCircle className="h-4 w-4 text-amber-500" />;
    case "pending":
    case "processing":
      return <Clock className="h-4 w-4 text-blue-500" />;
    case "rejected":
      return <AlertCircle className="h-4 w-4 text-red-500" />;
    case "missing":
      return <Minus className="h-4 w-4 text-muted-foreground/40" />;
    default:
      return <Minus className="h-4 w-4 text-muted-foreground/40" />;
  }
}

function getStatusColor(status: string): string {
  switch (status) {
    case "auto_approved":
    case "approved":
      return "bg-emerald-50 dark:bg-emerald-950/20";
    case "needs_review":
      return "bg-amber-50 dark:bg-amber-950/20";
    case "pending":
    case "processing":
      return "bg-blue-50 dark:bg-blue-950/20";
    case "rejected":
      return "bg-red-50 dark:bg-red-950/20";
    default:
      return "";
  }
}

function formatAmount(amount: string | null): string {
  if (!amount) return "-";
  const num = parseFloat(amount);
  return new Intl.NumberFormat("he-IL", {
    style: "currency",
    currency: "ILS",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(num);
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Page
// ─────────────────────────────────────────────────────────────────────────────

export default function ClientDocumentsPage() {
  const now = new Date();
  // Default to previous month — client reports arrive ~1 month after the period they cover
  const prevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const [periodMonth, setPeriodMonth] = useState(prevMonth.getMonth() + 1); // 1-based
  const [periodYear, setPeriodYear] = useState(prevMonth.getFullYear());
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [filterClientId, setFilterClientId] = useState<string>("all");

  const { data: clients } = useClients({ active: true });
  const { data: allFranchisees } = useFranchisees();
  const { data: matrix, isLoading: matrixLoading, refetch: refetchMatrix } =
    useDocumentTrackingMatrix(periodMonth, periodYear);
  const { data: summary } = useDocumentPeriodSummary(periodMonth, periodYear);
  const { data: recentDocs } = useClientDocuments({
    periodMonth,
    periodYear,
  });

  // Active clients with codes (for matrix columns)
  const activeClients = useMemo(
    () =>
      (clients ?? []).filter(
        (c: { id: string; name: string; code: string | null; isActive: boolean }) =>
          c.isActive && c.code !== "GIFTCARD"
      ),
    [clients]
  );

  // Client inbound email lookup (our receiving address, not the sender's)
  const clientEmailMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of activeClients) {
      const code = (c as { code?: string | null }).code;
      if (code) {
        map.set(c.id, `${code.toLowerCase()}@inbound.latable.co.il`);
      }
    }
    return map;
  }, [activeClients]);

  // Visible clients (filtered by client dropdown)
  const visibleClients = useMemo(
    () =>
      filterClientId === "all"
        ? activeClients
        : activeClients.filter((c: { id: string }) => c.id === filterClientId),
    [activeClients, filterClientId]
  );

  // Filtered matrix rows
  const filteredMatrix = useMemo(() => {
    if (!matrix) return [];
    const search = searchTerm.trim().toLowerCase();
    return matrix.filter((row) => {
      // Search filter
      if (search && !row.franchiseeName.toLowerCase().includes(search)) return false;
      // Status filter
      if (filterStatus !== "all") {
        const statuses: string[] = [row.tabitStatus];
        for (const c of visibleClients) {
          statuses.push(row.clients[c.id]?.status ?? "missing");
        }
        if (!statuses.includes(filterStatus)) return false;
      }
      return true;
    });
  }, [matrix, searchTerm, filterStatus, visibleClients]);

  // Filtered recent docs
  const filteredRecentDocs = useMemo(() => {
    if (!recentDocs) return [];
    const search = searchTerm.trim().toLowerCase();
    return recentDocs.filter((doc: {
      franchiseeName: string;
      processingStatus: string;
      clientName: string | null;
    }) => {
      if (search && !doc.franchiseeName.toLowerCase().includes(search)) return false;
      if (filterStatus !== "all" && doc.processingStatus !== filterStatus) return false;
      if (filterClientId !== "all" && doc.clientName !== activeClients.find((c: { id: string }) => c.id === filterClientId)?.name) return false;
      return true;
    });
  }, [recentDocs, searchTerm, filterStatus, filterClientId, activeClients]);

  // Column totals
  const columnTotals = useMemo(() => {
    if (!filteredMatrix || filteredMatrix.length === 0) return null;
    let tabitTotal = 0;
    const clientTotals: Record<string, number> = {};
    for (const row of filteredMatrix) {
      if (row.tabitAmount) tabitTotal += parseFloat(row.tabitAmount);
      for (const c of visibleClients) {
        const cell = row.clients[c.id];
        if (cell?.totalAmount) {
          clientTotals[c.id] = (clientTotals[c.id] ?? 0) + parseFloat(cell.totalAmount);
        }
      }
    }
    return { tabitTotal, clientTotals };
  }, [filteredMatrix, visibleClients]);

  const hasActiveFilters = searchTerm !== "" || filterStatus !== "all" || filterClientId !== "all";

  const clearFilters = useCallback(() => {
    setSearchTerm("");
    setFilterStatus("all");
    setFilterClientId("all");
  }, []);

  function copyEmailToClipboard(email: string) {
    navigator.clipboard.writeText(email);
    toast.success("אימייל הועתק ללוח");
  }

  // ─── Upload Dialog State ──────────────────────────────────────────────────

  const [uploadDocType, setUploadDocType] = useState<string>("client_report");
  const [uploadClientId, setUploadClientId] = useState("");
  const [uploadFranchiseeId, setUploadFranchiseeId] = useState("");
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const uploadMutation = useUploadClientDocument();

  const resetUploadForm = useCallback(() => {
    setUploadDocType("client_report");
    setUploadClientId("");
    setUploadFranchiseeId("");
    setUploadFile(null);
  }, []);

  const handleUpload = async () => {
    if (!uploadFile) return;
    // For client_report: franchisee + client required (except multi-franchisee clients like Hever)
    const selectedClient = activeClients.find((c: { id: string; code: string | null }) => c.id === uploadClientId);
    const isMultiFranchisee = selectedClient?.code === "HEVER";
    if (uploadDocType === "client_report" && !isMultiFranchisee && (!uploadFranchiseeId || !uploadClientId)) return;

    const formData = new FormData();
    formData.set("file", uploadFile);
    formData.set("documentType", uploadDocType);
    formData.set("periodMonth", String(periodMonth));
    formData.set("periodYear", String(periodYear));

    if (uploadDocType === "client_report") {
      formData.set("clientId", uploadClientId);
      if (!isMultiFranchisee) {
        formData.set("franchiseeId", uploadFranchiseeId);
      }
    }

    uploadMutation.mutate(formData, {
      onSuccess: (data) => {
        if ((data.tabitUpload || data.heverUpload) && data.summary) {
          const s = data.summary;
          const parts: string[] = [];
          parts.push(`נוצרו ${s.documentsCreated} מסמכים`);
          if (s.documentsUpdated > 0) parts.push(`עודכנו ${s.documentsUpdated}`);
          if (s.unmatchedBranches?.length > 0) {
            parts.push(`סניפים לא מזוהים: ${s.unmatchedBranches.join(", ")}`);
          }
          if (s.unmappedColumns?.length > 0) {
            parts.push(`עמודות ללא לקוח: ${s.unmappedColumns.join(", ")}`);
          }
          toast.success(parts.join(" | "), { duration: 8000 });
        } else {
          toast.success("המסמך הועלה בהצלחה");
        }
        setUploadDialogOpen(false);
        resetUploadForm();
      },
      onError: (error: Error) => {
        toast.error(error.message);
      },
    });
  };

  // ─── Period Navigation ────────────────────────────────────────────────────

  const goToPrevMonth = () => {
    if (periodMonth === 1) {
      setPeriodMonth(12);
      setPeriodYear((y) => y - 1);
    } else {
      setPeriodMonth((m) => m - 1);
    }
  };

  const goToNextMonth = () => {
    if (periodMonth === 12) {
      setPeriodMonth(1);
      setPeriodYear((y) => y + 1);
    } else {
      setPeriodMonth((m) => m + 1);
    }
  };

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="p-3 sm:p-6 space-y-4 sm:space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex h-9 w-9 sm:h-10 sm:w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
            <FileText className="h-4 w-4 sm:h-5 sm:w-5 text-primary" />
          </div>
          <div className="min-w-0">
            <h1 className="text-xl sm:text-2xl font-bold">מסמכי לקוחות</h1>
            <p className="text-xs sm:text-sm text-muted-foreground">
              מעקב אחר מסמכי לקוחות ודוחות טאביט
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button variant="outline" size="sm" onClick={() => refetchMatrix()}>
            <RefreshCw className="h-4 w-4 me-1" />
            <span className="hidden sm:inline">רענן</span>
          </Button>
          <Button size="sm" onClick={() => setUploadDialogOpen(true)}>
            <Upload className="h-4 w-4 me-2" />
            העלאת מסמך
          </Button>
        </div>
      </div>

      {/* Period Selector */}
      <div className="flex items-center gap-3">
        <Button variant="outline" size="sm" onClick={goToPrevMonth}>
          ←
        </Button>
        <div className="flex items-center gap-2">
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
        <Button variant="outline" size="sm" onClick={goToNextMonth}>
          →
        </Button>
      </div>

      {/* Summary Cards */}
      {summary && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <Card>
            <CardContent className="p-4 text-center">
              <p className="text-2xl font-bold tabular-nums">
                {summary.totalDocuments}
              </p>
              <p className="text-xs text-muted-foreground">סה&quot;כ מסמכים</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 text-center">
              <p className="text-2xl font-bold tabular-nums">
                {summary.clientReports}
              </p>
              <p className="text-xs text-muted-foreground">דוחות לקוחות</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 text-center">
              <p className="text-2xl font-bold tabular-nums">
                {summary.tabitReports}
              </p>
              <p className="text-xs text-muted-foreground">דוחות טאביט</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 text-center">
              <p className="text-2xl font-bold text-emerald-600 tabular-nums">
                {summary.approved}
              </p>
              <p className="text-xs text-muted-foreground">אושרו</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 text-center">
              <p className="text-2xl font-bold text-amber-600 tabular-nums">
                {summary.needsReview}
              </p>
              <p className="text-xs text-muted-foreground">לבדיקה</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 text-center">
              <p className="text-2xl font-bold text-blue-600 tabular-nums">
                {summary.pending}
              </p>
              <p className="text-xs text-muted-foreground">ממתינים</p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            type="text"
            placeholder="חיפוש זכיין..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="h-8 text-sm pe-9"
          />
        </div>
        <Select value={filterStatus} onValueChange={setFilterStatus}>
          <SelectTrigger className="w-[150px] h-8 text-sm">
            <SelectValue placeholder="סטטוס" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">כל הסטטוסים</SelectItem>
            <SelectItem value="approved">אושר</SelectItem>
            <SelectItem value="auto_approved">אושר אוטומטית</SelectItem>
            <SelectItem value="needs_review">לבדיקה</SelectItem>
            <SelectItem value="pending">ממתין</SelectItem>
            <SelectItem value="missing">חסר</SelectItem>
          </SelectContent>
        </Select>
        <Select value={filterClientId} onValueChange={setFilterClientId}>
          <SelectTrigger className="w-[150px] h-8 text-sm">
            <SelectValue placeholder="לקוח" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">כל הלקוחות</SelectItem>
            {activeClients.map(
              (c: { id: string; name: string }) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              )
            )}
          </SelectContent>
        </Select>
        {hasActiveFilters && (
          <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={clearFilters}>
            <X className="h-3.5 w-3.5 me-1" />
            נקה סינון
          </Button>
        )}
      </div>

      {/* Tracking Matrix */}
      <Card className="overflow-hidden">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg">מטריצת מעקב</CardTitle>
            <Badge variant="secondary" className="text-xs font-normal">
              כל הסכומים כוללים מע&quot;מ
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {matrixLoading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : filteredMatrix.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <FileText className="h-10 w-10 text-muted-foreground/40 mb-3" />
              <p className="text-sm text-muted-foreground">
                {hasActiveFilters
                  ? "אין תוצאות לסינון הנוכחי"
                  : "אין נתונים לתקופה זו. העלה מסמכים או שייך לקוחות לזכיינים."}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto border border-border rounded-md">
              <table
                dir="rtl"
                className="w-full table-fixed border-collapse text-sm"
              >
                <colgroup>
                  <col className="w-[140px]" />
                  <col className="w-[120px]" />
                  {visibleClients.map((c: { id: string }) => (
                    <col key={c.id} className="w-[140px]" />
                  ))}
                </colgroup>
                <thead>
                  <tr className="bg-muted/50">
                    <th className="text-right pe-2 py-2 text-sm font-bold text-muted-foreground border border-border sticky start-0 bg-muted/50 z-10">
                      זכיין
                    </th>
                    <th className="text-center px-1 py-2 text-sm font-bold text-muted-foreground border border-border">
                      טאביט
                    </th>
                    {visibleClients.map(
                      (c: { id: string; name: string }) => {
                        const email = clientEmailMap.get(c.id);
                        return (
                          <th key={c.id} className="text-center px-1 py-2 text-sm font-bold text-muted-foreground border border-border">
                            <div className="flex flex-col items-center gap-0.5">
                              <span>{c.name}</span>
                              {email && (
                                <div className="flex items-center gap-1">
                                  <span className="text-[10px] font-normal text-muted-foreground/70 truncate max-w-[110px]" dir="ltr">
                                    {email}
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => copyEmailToClipboard(email)}
                                    className="inline-flex items-center justify-center h-4 w-4 rounded hover:bg-muted transition-colors"
                                    title="העתק אימייל"
                                  >
                                    <Copy className="h-2.5 w-2.5 text-muted-foreground/60" />
                                  </button>
                                </div>
                              )}
                            </div>
                          </th>
                        );
                      }
                    )}
                  </tr>
                </thead>
                <tbody>
                  {filteredMatrix.map((row) => (
                    <tr key={row.franchiseeId} className="hover:bg-muted/30">
                      <td className="pe-2 py-1.5 border border-border sticky start-0 bg-background z-10 overflow-hidden">
                        <div className="truncate text-sm font-medium" title={row.franchiseeName}>
                          {row.franchiseeName}
                        </div>
                      </td>
                      <td
                        className={`text-center py-1.5 px-1 border border-border ${getStatusColor(row.tabitStatus)}`}
                      >
                        <div className="flex items-center justify-center gap-1">
                          {getStatusIcon(row.tabitStatus)}
                          {row.tabitAmount && (
                            <span className="text-xs tabular-nums text-muted-foreground">
                              {formatAmount(row.tabitAmount)}
                            </span>
                          )}
                        </div>
                      </td>
                      {visibleClients.map(
                        (c: { id: string }) => {
                          const cell = row.clients[c.id];
                          const status = cell?.status ?? "missing";
                          return (
                            <td
                              key={c.id}
                              className={`text-center py-1.5 px-1 border border-border ${getStatusColor(status)}`}
                            >
                              <div className="flex items-center justify-center gap-1">
                                {getStatusIcon(status)}
                                {cell?.totalAmount && (
                                  <span className="text-xs tabular-nums text-muted-foreground">
                                    {formatAmount(cell.totalAmount)}
                                  </span>
                                )}
                              </div>
                            </td>
                          );
                        }
                      )}
                    </tr>
                  ))}
                </tbody>
                {columnTotals && (
                  <tfoot>
                    <tr className="bg-muted/70 font-bold border-t-2 border-border">
                      <td className="pe-2 py-2 border border-border sticky start-0 bg-muted/70 z-10 text-sm">
                        סה&quot;כ
                      </td>
                      <td className="text-center py-2 px-1 border border-border">
                        <span className="text-xs tabular-nums font-bold">
                          {formatAmount(columnTotals.tabitTotal > 0 ? String(columnTotals.tabitTotal) : null)}
                        </span>
                      </td>
                      {visibleClients.map((c: { id: string }) => (
                        <td key={c.id} className="text-center py-2 px-1 border border-border">
                          <span className="text-xs tabular-nums font-bold">
                            {formatAmount(
                              columnTotals.clientTotals[c.id]
                                ? String(columnTotals.clientTotals[c.id])
                                : null
                            )}
                          </span>
                        </td>
                      ))}
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Recent Documents */}
      {filteredRecentDocs.length > 0 && (
        <Card className="overflow-hidden">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg">
              מסמכים אחרונים
              <Badge variant="secondary" className="ms-2 tabular-nums">
                {filteredRecentDocs.length}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="text-right pe-4">קובץ</TableHead>
                  <TableHead className="text-right">סוג</TableHead>
                  <TableHead className="text-right">לקוח</TableHead>
                  <TableHead className="text-right">זכיין</TableHead>
                  <TableHead className="text-right">סכום</TableHead>
                  <TableHead className="text-right">מקור</TableHead>
                  <TableHead className="text-right">סטטוס</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredRecentDocs.map(
                  (doc: {
                    id: string;
                    originalFileName: string;
                    documentType: string;
                    clientName: string | null;
                    franchiseeName: string;
                    totalAmount: string | null;
                    source: string;
                    processingStatus: string;
                  }) => {
                    const isTabit = doc.documentType === "tabit_report";
                    return (
                    <TableRow key={doc.id}>
                      <TableCell className="pe-4">
                        <a
                          href={`/api/clients/documents/${doc.id}/download`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-1.5 text-sm font-medium truncate max-w-[250px] hover:text-primary transition-colors"
                          title={`הורד ${doc.originalFileName}`}
                        >
                          <Download className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                          <span className="truncate">{doc.originalFileName}</span>
                        </a>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className="text-xs"
                        >
                          {isTabit ? "טאביט" : "לקוח"}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {/* Tabit files contain data for ALL clients — client/franchisee columns are not meaningful per-row */}
                        <span className="text-sm text-muted-foreground">
                          {isTabit ? "—" : (doc.clientName ?? "-")}
                        </span>
                      </TableCell>
                      <TableCell>
                        <span className="text-sm text-muted-foreground">
                          {isTabit ? "—" : doc.franchiseeName}
                        </span>
                      </TableCell>
                      <TableCell>
                        <span className="text-sm tabular-nums">
                          {formatAmount(doc.totalAmount)}
                        </span>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="secondary"
                          className="text-xs"
                        >
                          {doc.source === "gmail_fetch" ? "Gmail" : "ידני"}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1.5">
                          {getStatusIcon(doc.processingStatus)}
                        </div>
                      </TableCell>
                    </TableRow>
                    );
                  }
                )}
              </TableBody>
            </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Upload Dialog */}
      <Dialog
        open={uploadDialogOpen}
        onOpenChange={(open) => {
          setUploadDialogOpen(open);
          if (!open) resetUploadForm();
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>העלאת מסמך</DialogTitle>
            <DialogDescription>
              העלה מסמך לקוח או דוח טאביט עבור{" "}
              {MONTHS[periodMonth - 1]} {periodYear}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {/* Document type */}
            <div className="space-y-2">
              <Label>סוג מסמך</Label>
              <Select value={uploadDocType} onValueChange={setUploadDocType}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="client_report">דוח לקוח</SelectItem>
                  <SelectItem value="tabit_report">דוח טאביט</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Tabit info */}
            {uploadDocType === "tabit_report" && (
              <div className="rounded-md bg-muted/50 p-3 text-sm text-muted-foreground">
                קובץ טאביט מכיל נתונים של כל הסניפים וכל אמצעי התשלום.
                הזכיינים והלקוחות יזוהו אוטומטית מתוך הקובץ.
              </div>
            )}

            {/* Client (only for client_report) */}
            {uploadDocType === "client_report" && (
              <>
                <div className="space-y-2">
                  <Label>לקוח</Label>
                  <Select
                    value={uploadClientId}
                    onValueChange={(v) => {
                      setUploadClientId(v);
                      setUploadFranchiseeId("");
                    }}
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

                {/* Multi-franchisee clients (Hever) — no franchisee selection needed */}
                {(() => {
                  const sc = activeClients.find((c: { id: string; code: string | null }) => c.id === uploadClientId);
                  if (sc?.code === "HEVER") {
                    return (
                      <div className="rounded-md bg-muted/50 p-3 text-sm text-muted-foreground">
                        קובץ חבר מכיל נתונים של כל הזכיינים.
                        הזכיינים יזוהו אוטומטית מתוך הקובץ.
                      </div>
                    );
                  }
                  return (
                    <div className="space-y-2">
                      <Label>זכיין</Label>
                      <Select
                        value={uploadFranchiseeId}
                        onValueChange={setUploadFranchiseeId}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="בחר זכיין..." />
                        </SelectTrigger>
                        <SelectContent>
                          {(allFranchisees ?? []).map(
                            (f: { id: string; name: string; code: string }) => (
                              <SelectItem key={f.id} value={f.id}>
                                {f.name} ({f.code})
                              </SelectItem>
                            )
                          )}
                        </SelectContent>
                      </Select>
                    </div>
                  );
                })()}
              </>
            )}

            {/* File input */}
            <div className="space-y-2">
              <Label>קובץ</Label>
              <Input
                type="file"
                accept=".xlsx,.xls,.csv,.pdf,.png,.jpg,.jpeg"
                onChange={(e) => setUploadFile(e.target.files?.[0] ?? null)}
                dir="ltr"
              />
              {uploadFile && (
                <p className="text-xs text-muted-foreground" dir="ltr">
                  {uploadFile.name} ({(uploadFile.size / 1024).toFixed(1)} KB)
                </p>
              )}
            </div>
          </div>

          <DialogFooter className="gap-2 pt-2">
            <Button
              variant="outline"
              onClick={() => {
                setUploadDialogOpen(false);
                resetUploadForm();
              }}
              disabled={uploadMutation.isPending}
            >
              ביטול
            </Button>
            <Button
              onClick={handleUpload}
              disabled={
                uploadMutation.isPending ||
                !uploadFile ||
                (uploadDocType === "client_report" && !uploadClientId) ||
                (uploadDocType === "client_report" &&
                  !activeClients.find((c: { id: string; code: string | null }) => c.id === uploadClientId && c.code === "HEVER") &&
                  !uploadFranchiseeId)
              }
            >
              {uploadMutation.isPending ? (
                <>
                  <Loader2 className="me-2 h-4 w-4 animate-spin" />
                  מעלה...
                </>
              ) : (
                <>
                  <Upload className="me-2 h-4 w-4" />
                  העלה
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
