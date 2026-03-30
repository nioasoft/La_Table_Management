"use client";

import { useState, useCallback } from "react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Receipt,
  Loader2,
  Upload,
  CheckCircle2,
  AlertTriangle,
  Clock,
  ChevronRight,
  ChevronLeft,
} from "lucide-react";
import { useClients } from "@/queries/clients";
import { useFranchisees } from "@/queries/franchisees";
import {
  useInvoiceVerificationSummary,
  useInvoiceVerification,
  useUploadCommissionInvoice,
} from "@/queries/commission-invoices";
import { toast } from "sonner";

// ─────────────────────────────────────────────────────────────────────────────

const MONTHS = [
  "ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני",
  "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר",
];

function formatAmount(amount: number | null): string {
  if (amount === null || amount === undefined) return "—";
  return new Intl.NumberFormat("he-IL", {
    style: "currency",
    currency: "ILS",
    maximumFractionDigits: 0,
  }).format(amount);
}

function formatAmountDetailed(amount: number | null): string {
  if (amount === null || amount === undefined) return "—";
  return new Intl.NumberFormat("he-IL", {
    style: "currency",
    currency: "ILS",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

// ─────────────────────────────────────────────────────────────────────────────

export default function CommissionInvoicesPage() {
  const now = new Date();
  const [periodMonth, setPeriodMonth] = useState(now.getMonth() + 1);
  const [periodYear, setPeriodYear] = useState(now.getFullYear());
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);

  const { data: clients } = useClients({ active: true });

  const {
    data: summaryData,
    isLoading: summaryLoading,
  } = useInvoiceVerificationSummary(periodMonth, periodYear);

  const {
    data: verificationRows,
    isLoading: verificationLoading,
  } = useInvoiceVerification(selectedClientId, periodMonth, periodYear);

  // Period navigation
  const goToPrevMonth = useCallback(() => {
    if (periodMonth === 1) {
      setPeriodMonth(12);
      setPeriodYear((y) => y - 1);
    } else {
      setPeriodMonth((m) => m - 1);
    }
  }, [periodMonth]);

  const goToNextMonth = useCallback(() => {
    if (periodMonth === 12) {
      setPeriodMonth(1);
      setPeriodYear((y) => y + 1);
    } else {
      setPeriodMonth((m) => m + 1);
    }
  }, [periodMonth]);

  // Summary totals
  const totalInvoices = summaryData?.reduce((s, r) => s + r.invoiceCount, 0) ?? 0;
  const totalMatched = summaryData?.reduce((s, r) => s + r.matchedCount, 0) ?? 0;
  const totalMismatch = summaryData?.reduce((s, r) => s + r.mismatchCount, 0) ?? 0;
  const totalMissing = summaryData?.reduce(
    (s, r) => s + r.missingInvoiceCount,
    0
  ) ?? 0;

  return (
    <div className="space-y-6" dir="rtl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Receipt className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-bold">אימות חשבוניות עמלה</h1>
        </div>
        <Button onClick={() => setUploadDialogOpen(true)}>
          <Upload className="h-4 w-4 me-2" />
          העלאת חשבונית
        </Button>
      </div>

      {/* Period Selector */}
      <div className="flex items-center justify-center gap-4">
        <Button variant="ghost" size="icon" onClick={goToPrevMonth}>
          <ChevronRight className="h-4 w-4" />
        </Button>
        <span className="text-lg font-medium min-w-[160px] text-center">
          {MONTHS[periodMonth - 1]} {periodYear}
        </span>
        <Button variant="ghost" size="icon" onClick={goToNextMonth}>
          <ChevronLeft className="h-4 w-4" />
        </Button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              סה&quot;כ חשבוניות
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalInvoices}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-emerald-600">
              תקין
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-emerald-600">
              {totalMatched}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-amber-600">
              חריג
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-amber-600">
              {totalMismatch}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-blue-600">
              חסר
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-blue-600">
              {totalMissing}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Client Summary Table */}
      {summaryLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : summaryData && summaryData.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">סיכום לפי לקוח</CardTitle>
          </CardHeader>
          <CardContent>
            <Table dir="rtl">
              <TableHeader>
                <TableRow>
                  <TableHead>לקוח</TableHead>
                  <TableHead className="text-center">חשבוניות</TableHead>
                  <TableHead className="text-center">תקין</TableHead>
                  <TableHead className="text-center">חריג</TableHead>
                  <TableHead className="text-center">חסר</TableHead>
                  <TableHead className="text-start">סכום מחושבונית</TableHead>
                  <TableHead className="text-start">סכום צפוי</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {summaryData.map((row) => (
                  <TableRow
                    key={row.clientId}
                    className="cursor-pointer hover:bg-muted/50"
                    onClick={() => setSelectedClientId(row.clientId)}
                  >
                    <TableCell className="font-medium">
                      {row.clientName}
                      {row.clientCode && (
                        <span className="text-muted-foreground text-xs ms-2">
                          ({row.clientCode})
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-center">
                      {row.invoiceCount}
                    </TableCell>
                    <TableCell className="text-center">
                      {row.matchedCount > 0 && (
                        <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300">
                          {row.matchedCount}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-center">
                      {row.mismatchCount > 0 && (
                        <Badge variant="destructive">{row.mismatchCount}</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-center">
                      {row.missingInvoiceCount > 0 && (
                        <Badge variant="secondary">
                          {row.missingInvoiceCount}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>{formatAmount(row.totalInvoiced)}</TableCell>
                    <TableCell>{formatAmount(row.totalExpected)}</TableCell>
                    <TableCell>
                      <ChevronLeft className="h-4 w-4 text-muted-foreground" />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            אין נתונים לתקופה זו
          </CardContent>
        </Card>
      )}

      {/* Per-Franchisee Detail View */}
      {selectedClientId && (
        <ClientVerificationDetail
          clientId={selectedClientId}
          clientName={
            summaryData?.find((s) => s.clientId === selectedClientId)
              ?.clientName ?? ""
          }
          periodMonth={periodMonth}
          periodYear={periodYear}
          rows={verificationRows ?? []}
          isLoading={verificationLoading}
          onClose={() => setSelectedClientId(null)}
        />
      )}

      {/* Upload Dialog */}
      <UploadInvoiceDialog
        open={uploadDialogOpen}
        onOpenChange={setUploadDialogOpen}
        clients={clients ?? []}
        periodMonth={periodMonth}
        periodYear={periodYear}
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Client Verification Detail
// ─────────────────────────────────────────────────────────────────────────────

interface ClientVerificationDetailProps {
  clientId: string;
  clientName: string;
  periodMonth: number;
  periodYear: number;
  rows: Array<{
    franchiseeId: string;
    franchiseeName: string;
    invoiceDocumentId: string | null;
    invoiceAmount: number | null;
    invoiceFileName: string | null;
    reportDocumentId: string | null;
    reportTotalAmount: number | null;
    systemCommissionRate: number | null;
    expectedCommission: number | null;
    difference: number | null;
    verificationStatus: string;
  }>;
  isLoading: boolean;
  onClose: () => void;
}

function ClientVerificationDetail({
  clientName,
  periodMonth,
  periodYear,
  rows,
  isLoading,
  onClose,
}: ClientVerificationDetailProps) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">
            פירוט אימות — {clientName} — {MONTHS[periodMonth - 1]} {periodYear}
          </CardTitle>
          <Button variant="ghost" size="sm" onClick={onClose}>
            סגור
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        ) : rows.length === 0 ? (
          <div className="py-8 text-center text-muted-foreground">
            אין זכיינים מקושרים ללקוח זה
          </div>
        ) : (
          <Table dir="rtl">
            <TableHeader>
              <TableRow>
                <TableHead>זכיין</TableHead>
                <TableHead className="text-start">סכום דוח לקוח</TableHead>
                <TableHead className="text-start">עמלה צפויה</TableHead>
                <TableHead className="text-start">סכום חשבונית</TableHead>
                <TableHead className="text-start">הפרש</TableHead>
                <TableHead className="text-center">סטטוס</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.franchiseeId}>
                  <TableCell className="font-medium">
                    {row.franchiseeName}
                  </TableCell>
                  <TableCell>
                    {formatAmountDetailed(row.reportTotalAmount)}
                  </TableCell>
                  <TableCell>
                    <div>{formatAmountDetailed(row.expectedCommission)}</div>
                    {row.systemCommissionRate !== null && (
                      <div className="text-xs text-muted-foreground">
                        ({row.systemCommissionRate}%)
                      </div>
                    )}
                  </TableCell>
                  <TableCell>
                    <div>
                      {formatAmountDetailed(row.invoiceAmount)}
                    </div>
                    {row.invoiceFileName && (
                      <div
                        className="text-xs text-muted-foreground truncate max-w-[150px]"
                        title={row.invoiceFileName}
                      >
                        {row.invoiceFileName}
                      </div>
                    )}
                  </TableCell>
                  <TableCell>
                    {row.difference !== null ? (
                      <span
                        className={
                          Math.abs(row.difference) > 30
                            ? "text-amber-600 font-medium"
                            : "text-muted-foreground"
                        }
                      >
                        {row.difference > 0 ? "+" : ""}
                        {formatAmountDetailed(row.difference)}
                      </span>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                  <TableCell className="text-center">
                    <VerificationStatusBadge
                      status={row.verificationStatus}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Status Badge
// ─────────────────────────────────────────────────────────────────────────────

function VerificationStatusBadge({ status }: { status: string }) {
  switch (status) {
    case "matched":
      return (
        <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300">
          <CheckCircle2 className="h-3 w-3 me-1" />
          תקין
        </Badge>
      );
    case "mismatch":
      return (
        <Badge variant="destructive">
          <AlertTriangle className="h-3 w-3 me-1" />
          חריג
        </Badge>
      );
    case "missing_invoice":
      return (
        <Badge variant="secondary">
          <Clock className="h-3 w-3 me-1" />
          חסר חשבונית
        </Badge>
      );
    case "missing_report":
      return (
        <Badge variant="outline">
          <Clock className="h-3 w-3 me-1" />
          חסר דוח
        </Badge>
      );
    default:
      return <Badge variant="outline">{status}</Badge>;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Upload Dialog
// ─────────────────────────────────────────────────────────────────────────────

interface UploadInvoiceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clients: Array<{ id: string; name: string; code: string | null }>;
  periodMonth: number;
  periodYear: number;
}

function UploadInvoiceDialog({
  open,
  onOpenChange,
  clients,
  periodMonth,
  periodYear,
}: UploadInvoiceDialogProps) {
  const [clientId, setClientId] = useState("");
  const [franchiseeId, setFranchiseeId] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const { data: allFranchisees } = useFranchisees();
  const uploadMutation = useUploadCommissionInvoice();

  const handleUpload = async () => {
    if (!file || !clientId || !franchiseeId) return;

    const formData = new FormData();
    formData.append("file", file);
    formData.append("documentType", "commission_invoice");
    formData.append("clientId", clientId);
    formData.append("franchiseeId", franchiseeId);
    formData.append("periodMonth", String(periodMonth));
    formData.append("periodYear", String(periodYear));

    try {
      await uploadMutation.mutateAsync(formData);
      toast.success("החשבונית הועלתה בהצלחה");
      onOpenChange(false);
      setFile(null);
      setClientId("");
      setFranchiseeId("");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "שגיאה בהעלאת חשבונית"
      );
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]" dir="rtl">
        <DialogHeader>
          <DialogTitle>העלאת חשבונית עמלה</DialogTitle>
          <DialogDescription>
            העלו חשבונית עמלה מלקוח לאימות מול הדוח
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            <Label>לקוח</Label>
            <Select value={clientId} onValueChange={setClientId} dir="rtl">
              <SelectTrigger>
                <SelectValue placeholder="בחר לקוח" />
              </SelectTrigger>
              <SelectContent dir="rtl">
                {clients.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                    {c.code && ` (${c.code})`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-2">
            <Label>זכיין</Label>
            <Select
              value={franchiseeId}
              onValueChange={setFranchiseeId}
              dir="rtl"
            >
              <SelectTrigger>
                <SelectValue placeholder="בחר זכיין" />
              </SelectTrigger>
              <SelectContent dir="rtl">
                {(allFranchisees ?? []).map((f: { id: string; name: string }) => (
                  <SelectItem key={f.id} value={f.id}>
                    {f.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-2">
            <Label>תקופה</Label>
            <div className="text-sm text-muted-foreground">
              {MONTHS[periodMonth - 1]} {periodYear}
            </div>
          </div>

          <div className="grid gap-2">
            <Label>קובץ חשבונית (PDF)</Label>
            <Input
              type="file"
              accept=".pdf"
              dir="ltr"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button
            onClick={handleUpload}
            disabled={
              !file || !clientId || !franchiseeId || uploadMutation.isPending
            }
          >
            {uploadMutation.isPending && (
              <Loader2 className="h-4 w-4 me-2 animate-spin" />
            )}
            העלאה ואימות
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
