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
        (c: { id: string; name: string; code: string | null; isActive: boolean }) => c.isActive
      ),
    [clients]
  );

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

      {/* Tracking Matrix */}
      <Card className="overflow-hidden">
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">מטריצת מעקב</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {matrixLoading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : !matrix || matrix.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <FileText className="h-10 w-10 text-muted-foreground/40 mb-3" />
              <p className="text-sm text-muted-foreground">
                אין נתונים לתקופה זו. העלה מסמכים או שייך לקוחות לזכיינים.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table className="table-fixed">
                <colgroup>
                  <col className="w-[80px]" />
                  <col className="w-[100px]" />
                  {activeClients.map((c: { id: string }) => (
                    <col key={c.id} className="w-[90px]" />
                  ))}
                </colgroup>
                <TableHeader>
                  <TableRow className="hover:bg-transparent h-7">
                    <TableHead className="text-right pe-1 sticky start-0 bg-background z-10 text-sm">
                      זכיין
                    </TableHead>
                    <TableHead className="text-center px-0 text-sm">
                      טאביט
                    </TableHead>
                    {activeClients.map(
                      (c: { id: string; name: string; code: string | null }) => (
                        <TableHead key={c.id} className="text-center px-0 text-sm">
                          {c.name}
                        </TableHead>
                      )
                    )}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {matrix.map((row) => (
                    <TableRow key={row.franchiseeId} className="h-7">
                      <TableCell className="pe-1 py-0.5 sticky start-0 bg-background z-10 overflow-hidden">
                        <div className="truncate text-sm font-medium" title={row.franchiseeName}>
                          {row.franchiseeName}
                        </div>
                      </TableCell>
                      <TableCell
                        className={`text-center py-0.5 px-0 ${getStatusColor(row.tabitStatus)}`}
                      >
                        <div className="flex items-center justify-center gap-0.5">
                          {getStatusIcon(row.tabitStatus)}
                          {row.tabitAmount && (
                            <span className="text-sm tabular-nums text-muted-foreground">
                              {formatAmount(row.tabitAmount)}
                            </span>
                          )}
                        </div>
                      </TableCell>
                      {activeClients.map(
                        (c: { id: string; name: string }) => {
                          const cell = row.clients[c.id];
                          const status = cell?.status ?? "missing";
                          return (
                            <TableCell
                              key={c.id}
                              className={`text-center py-0.5 px-0 ${getStatusColor(status)}`}
                            >
                              <div className="flex items-center justify-center gap-0.5">
                                {getStatusIcon(status)}
                                {cell?.totalAmount && (
                                  <span className="text-sm tabular-nums text-muted-foreground">
                                    {formatAmount(cell.totalAmount)}
                                  </span>
                                )}
                              </div>
                            </TableCell>
                          );
                        }
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Recent Documents */}
      {recentDocs && recentDocs.length > 0 && (
        <Card className="overflow-hidden">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg">
              מסמכים אחרונים
              <Badge variant="secondary" className="ms-2 tabular-nums">
                {recentDocs.length}
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
                {recentDocs.map(
                  (doc: {
                    id: string;
                    originalFileName: string;
                    documentType: string;
                    clientName: string | null;
                    franchiseeName: string;
                    totalAmount: string | null;
                    source: string;
                    processingStatus: string;
                  }) => (
                    <TableRow key={doc.id}>
                      <TableCell className="pe-4">
                        <span className="text-sm font-medium truncate max-w-[200px] block">
                          {doc.originalFileName}
                        </span>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className="text-xs"
                        >
                          {doc.documentType === "tabit_report"
                            ? "טאביט"
                            : "לקוח"}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <span className="text-sm">
                          {doc.clientName ?? "-"}
                        </span>
                      </TableCell>
                      <TableCell>
                        <span className="text-sm">
                          {doc.franchiseeName}
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
                  )
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
