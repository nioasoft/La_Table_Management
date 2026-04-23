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
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { cn } from "@/lib/utils";
import {
  Receipt,
  Loader2,
  Upload,
  CheckCircle2,
  AlertTriangle,
  Clock,
  ChevronRight,
  ChevronLeft,
  ChevronsUpDown,
  Check,
  X,
  FileText,
  Mail,
  UserCog,
} from "lucide-react";
import { useClients } from "@/queries/clients";
import { useFranchisees } from "@/queries/franchisees";
import {
  useInvoiceVerificationSummary,
  useInvoiceVerification,
  commissionInvoiceKeys,
} from "@/queries/commission-invoices";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

// ─────────────────────────────────────────────────────────────────────────────

const MONTHS = [
  "ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני",
  "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר",
];

function formatAmountDetailed(amount: number | null): string {
  if (amount === null || amount === undefined) return "—";
  return new Intl.NumberFormat("he-IL", {
    style: "currency",
    currency: "ILS",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

function InvoiceSourceBadge({
  source,
}: {
  source: "manual_upload" | "gmail_fetch" | null;
}) {
  if (!source) return null;
  if (source === "gmail_fetch") {
    return (
      <Badge
        variant="outline"
        className="h-5 px-1.5 text-[10px] gap-1 border-blue-300 text-blue-700 dark:text-blue-300"
        title="התקבל אוטומטית מהמייל"
      >
        <Mail className="h-3 w-3" />
        מהמייל
      </Badge>
    );
  }
  return (
    <Badge
      variant="outline"
      className="h-5 px-1.5 text-[10px] text-muted-foreground"
      title="הועלה ידנית"
    >
      ידני
    </Badge>
  );
}

function DocumentLink({
  documentId,
  fileName,
  variant = "blue",
}: {
  documentId: string | null;
  fileName?: string | null;
  variant?: "blue" | "emerald";
}) {
  if (!documentId) return null;
  const colorClasses =
    variant === "blue"
      ? "text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950"
      : "text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950";
  return (
    <a
      href={`/api/clients/documents/${documentId}/download`}
      target="_blank"
      rel="noopener noreferrer"
      title={fileName ?? "פתח מסמך"}
      onClick={(e) => e.stopPropagation()}
      className={cn(
        "inline-flex items-center justify-center h-6 w-6 rounded shrink-0",
        colorClasses
      )}
    >
      <FileText className="h-3.5 w-3.5" />
    </a>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

export default function CommissionInvoicesPage() {
  const now = new Date();
  const [periodMonth, setPeriodMonth] = useState(now.getMonth() + 1);
  const [periodYear, setPeriodYear] = useState(now.getFullYear());
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
  const [selectedFranchiseeId, setSelectedFranchiseeId] = useState<
    string | null
  >(null);
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);

  const { data: clients } = useClients({ active: true });
  const { data: filterFranchisees } = useFranchisees({ category: "all" });

  const {
    data: summaryData,
    isLoading: summaryLoading,
  } = useInvoiceVerificationSummary(
    periodMonth,
    periodYear,
    selectedFranchiseeId
  );

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

      {/* Period Selector + Franchisee Filter */}
      <div className="flex flex-wrap items-center justify-center gap-4">
        <div className="flex items-center gap-2">
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
        <FranchiseeFilterCombobox
          franchisees={filterFranchisees ?? []}
          selectedId={selectedFranchiseeId}
          onChange={setSelectedFranchiseeId}
        />
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
                  <TableHead className="text-start">סכום מחשבונית</TableHead>
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
                    <TableCell>{formatAmountDetailed(row.totalInvoiced)}</TableCell>
                    <TableCell>{formatAmountDetailed(row.totalExpected)}</TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedClientId(row.clientId);
                        }}
                      >
                        פירוט
                        <ChevronLeft className="h-4 w-4 ms-1" />
                      </Button>
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
          rows={
            selectedFranchiseeId
              ? (verificationRows ?? []).filter(
                  (r) => r.franchiseeId === selectedFranchiseeId
                )
              : (verificationRows ?? [])
          }
          allClientFranchisees={(verificationRows ?? []).map((r) => ({
            id: r.franchiseeId,
            name: r.franchiseeName,
          }))}
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
        setPeriodMonth={setPeriodMonth}
        setPeriodYear={setPeriodYear}
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
    invoiceSource: "manual_upload" | "gmail_fetch" | null;
    reportDocumentId: string | null;
    reportTotalAmount: number | null;
    systemCommissionRate: number | null;
    systemCommissionRates: number[];
    expectedCommission: number | null;
    difference: number | null;
    verificationStatus: string;
  }>;
  allClientFranchisees: Array<{ id: string; name: string }>;
  isLoading: boolean;
  onClose: () => void;
}

function ClientVerificationDetail({
  clientName,
  periodMonth,
  periodYear,
  rows,
  allClientFranchisees,
  isLoading,
  onClose,
}: ClientVerificationDetailProps) {
  const [search, setSearch] = useState("");

  const filteredRows = search
    ? rows.filter((r) =>
        r.franchiseeName.toLowerCase().includes(search.toLowerCase())
      )
    : rows;

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
        {rows.length > 0 && (
          <Input
            placeholder="חיפוש זכיין..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="max-w-xs mt-2"
          />
        )}
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        ) : filteredRows.length === 0 ? (
          <div className="py-8 text-center text-muted-foreground">
            {search ? "לא נמצאו זכיינים תואמים" : "אין זכיינים מקושרים ללקוח זה"}
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
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredRows.map((row) => (
                <TableRow key={row.franchiseeId}>
                  <TableCell className="font-medium">
                    {row.franchiseeName}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1.5">
                      <span>{formatAmountDetailed(row.reportTotalAmount)}</span>
                      <DocumentLink
                        documentId={row.reportDocumentId}
                        variant="emerald"
                      />
                    </div>
                  </TableCell>
                  <TableCell>
                    {row.expectedCommission !== null ? (
                      <>
                        <div>{formatAmountDetailed(row.expectedCommission)}</div>
                        {row.systemCommissionRate !== null && (
                          <div className="text-xs text-muted-foreground">
                            ({row.systemCommissionRate}%)
                          </div>
                        )}
                      </>
                    ) : row.systemCommissionRates.length > 1 ? (
                      <div className="text-xs text-muted-foreground">
                        מעורב ({row.systemCommissionRates.map((r) => `${r}%`).join(" / ")})
                      </div>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1.5">
                      <span>{formatAmountDetailed(row.invoiceAmount)}</span>
                      <DocumentLink
                        documentId={row.invoiceDocumentId}
                        fileName={row.invoiceFileName}
                        variant="blue"
                      />
                      <InvoiceSourceBadge source={row.invoiceSource} />
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
                  <TableCell>
                    {row.invoiceDocumentId && (
                      <ReassignFranchiseeAction
                        documentId={row.invoiceDocumentId}
                        currentFranchiseeId={row.franchiseeId}
                        currentFranchiseeName={row.franchiseeName}
                        candidates={allClientFranchisees}
                      />
                    )}
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

function ReassignFranchiseeAction({
  documentId,
  currentFranchiseeId,
  currentFranchiseeName,
  candidates,
}: {
  documentId: string;
  currentFranchiseeId: string;
  currentFranchiseeName: string;
  candidates: Array<{ id: string; name: string }>;
}) {
  const [open, setOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const queryClient = useQueryClient();

  const others = candidates.filter((c) => c.id !== currentFranchiseeId);

  const handleSave = async () => {
    if (!selectedId) return;
    setIsSaving(true);
    try {
      const res = await fetch(`/api/clients/documents/${documentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ franchiseeId: selectedId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data?.error ?? "שגיאה בשינוי שיוך הזכיין");
        return;
      }
      toast.success("שיוך הזכיין עודכן");
      queryClient.invalidateQueries({ queryKey: commissionInvoiceKeys.all });
      setOpen(false);
      setSelectedId(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "שגיאה בשינוי שיוך הזכיין");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setSelectedId(null);
      }}
    >
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8"
        title="שנה שיוך זכיין"
        onClick={() => setOpen(true)}
      >
        <UserCog className="h-4 w-4" />
      </Button>
      <DialogContent className="sm:max-w-[420px]" dir="rtl">
        <DialogHeader>
          <DialogTitle>שינוי שיוך זכיין</DialogTitle>
          <DialogDescription>
            החשבונית משויכת כעת ל-<strong>{currentFranchiseeName}</strong>.
            בחר זכיין אחר מאותו לקוח.
          </DialogDescription>
        </DialogHeader>
        <div className="py-2">
          <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="outline"
                role="combobox"
                aria-expanded={pickerOpen}
                className="w-full justify-between font-normal"
                dir="rtl"
              >
                <span className={cn(!selectedId && "text-muted-foreground")}>
                  {selectedId
                    ? others.find((o) => o.id === selectedId)?.name
                    : "בחר זכיין..."}
                </span>
                <ChevronsUpDown className="h-3.5 w-3.5 opacity-50" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[380px] p-0" align="start" dir="rtl">
              <Command>
                <CommandInput placeholder="חפש זכיין..." className="h-9" />
                <CommandList>
                  <CommandEmpty>לא נמצאו זכיינים</CommandEmpty>
                  <CommandGroup>
                    {others.map((f) => (
                      <CommandItem
                        key={f.id}
                        value={`${f.name} ${f.id}`}
                        onSelect={() => {
                          setSelectedId(f.id);
                          setPickerOpen(false);
                        }}
                      >
                        <Check
                          className={cn(
                            "me-2 h-4 w-4",
                            selectedId === f.id ? "opacity-100" : "opacity-0"
                          )}
                        />
                        {f.name}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={isSaving}>
            ביטול
          </Button>
          <Button onClick={handleSave} disabled={!selectedId || isSaving}>
            {isSaving && <Loader2 className="h-4 w-4 me-2 animate-spin" />}
            שמור
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
// Upload Dialog — multi-file, auto-match franchisee from PDF
// ─────────────────────────────────────────────────────────────────────────────

type FileStatus =
  | "pending"
  | "uploading"
  | "success"
  | "error"
  | "needs_franchisee";

interface FileRow {
  id: string;
  file: File;
  status: FileStatus;
  message?: string;
  invoiceNumber?: string | null;
  totalAmount?: number | null;
  periodMonth?: number | null;
  periodYear?: number | null;
  franchiseeName?: string | null;
  extractedName?: string | null;
  candidates?: Array<{ id: string; name: string; confidence: number }>;
  pickedFranchiseeId?: string;
}

interface UploadInvoiceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clients: Array<{ id: string; name: string; code: string | null }>;
  periodMonth: number;
  periodYear: number;
  setPeriodMonth: (month: number) => void;
  setPeriodYear: (year: number) => void;
}

function UploadInvoiceDialog({
  open,
  onOpenChange,
  clients,
  periodMonth,
  periodYear,
  setPeriodMonth,
  setPeriodYear,
}: UploadInvoiceDialogProps) {
  const [clientId, setClientId] = useState("");
  const [rows, setRows] = useState<FileRow[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  // category=all so the picker can fall back to ANY franchisee (incl. "other")
  // when the server can't auto-match from the PDF.
  const { data: allFranchisees, isLoading: franchiseesLoading } =
    useFranchisees({ category: "all" });
  const queryClient = useQueryClient();

  const reset = useCallback(() => {
    setClientId("");
    setRows([]);
    setIsUploading(false);
  }, []);

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) reset();
    onOpenChange(nextOpen);
  };

  const [isDragging, setIsDragging] = useState(false);

  const addFiles = useCallback((files: File[]) => {
    const pdfs = files.filter(
      (f) => f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf")
    );
    if (pdfs.length === 0) return;
    if (pdfs.length < files.length) {
      toast.warning("רק קבצי PDF התווספו; שאר הקבצים נפסלו");
    }
    const newRows: FileRow[] = pdfs.map((f) => ({
      id: `${f.name}-${f.size}-${f.lastModified}`,
      file: f,
      status: "pending",
    }));
    setRows((prev) => [...prev, ...newRows]);
  }, []);

  const handleFilesPicked = (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(e.target.files ?? []);
    addFiles(picked);
    // allow re-selecting the same file after removing it
    e.target.value = "";
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    if (isUploading || !clientId) return;
    e.preventDefault();
    e.stopPropagation();
    if (!isDragging) setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    if (isUploading || !clientId) return;
    addFiles(Array.from(e.dataTransfer.files ?? []));
  };

  const updateRow = useCallback(
    (id: string, patch: Partial<FileRow>) => {
      setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
    },
    []
  );

  const removeRow = (id: string) => {
    setRows((prev) => prev.filter((r) => r.id !== id));
  };

  type UploadOutcome = "success" | "needs_franchisee" | "error" | "skipped";

  const uploadOne = useCallback(
    async (row: FileRow, explicitFranchiseeId?: string): Promise<UploadOutcome> => {
      const formData = new FormData();
      formData.append("file", row.file);
      formData.append("documentType", "commission_invoice");
      formData.append("clientId", clientId);
      formData.append("periodMonth", String(periodMonth));
      formData.append("periodYear", String(periodYear));
      if (explicitFranchiseeId) {
        formData.append("franchiseeId", explicitFranchiseeId);
      }

      updateRow(row.id, { status: "uploading", message: undefined });

      try {
        const res = await fetch("/api/clients/documents", {
          method: "POST",
          body: formData,
        });
        const data = await res.json().catch(() => ({}));

        if (res.status === 422 && data?.needsFranchiseeSelection) {
          updateRow(row.id, {
            status: "needs_franchisee",
            message: data.error,
            extractedName: data.extractedName ?? null,
            candidates: data.candidates ?? [],
          });
          return "needs_franchisee";
        }

        if (!res.ok) {
          updateRow(row.id, {
            status: "error",
            message: data?.error ?? "שגיאה בהעלאת חשבונית",
          });
          return "error";
        }

        // Success — pull parsed data for display
        const doc = data?.document ?? {};
        const pr = data?.processingResult?.data ?? {};
        const matchedFranchiseeName =
          (allFranchisees ?? []).find(
            (f: { id: string; name: string }) => f.id === doc.franchiseeId
          )?.name ?? null;

        updateRow(row.id, {
          status: "success",
          message: data?.skippedDuplicate ? "כבר הועלה (דילוג)" : undefined,
          invoiceNumber: pr.invoiceNumber ?? doc.invoiceNumber ?? null,
          totalAmount:
            pr.totalAmount ??
            (doc.totalAmount ? parseFloat(doc.totalAmount) : null),
          periodMonth: pr.periodMonth ?? doc.periodMonth ?? null,
          periodYear: pr.periodYear ?? doc.periodYear ?? null,
          franchiseeName: matchedFranchiseeName,
        });
        return "success";
      } catch (err) {
        updateRow(row.id, {
          status: "error",
          message: err instanceof Error ? err.message : "שגיאה בהעלאה",
        });
        return "error";
      }
    },
    [clientId, periodMonth, periodYear, allFranchisees, updateRow]
  );

  const handleUploadAll = async () => {
    if (!clientId || rows.length === 0) return;
    setIsUploading(true);

    let ok = 0;
    let needsFr = 0;
    let errs = 0;
    // Sequential — each call runs a PDF parse on the server; avoids burst.
    for (const row of rows) {
      if (row.status === "success" || row.status === "uploading") {
        continue;
      }
      const outcome = await uploadOne(row);
      if (outcome === "success") ok++;
      else if (outcome === "needs_franchisee") needsFr++;
      else if (outcome === "error") errs++;
    }

    setIsUploading(false);

    const parts: string[] = [];
    if (ok > 0) parts.push(`${ok} הועלו`);
    if (needsFr > 0) parts.push(`${needsFr} דורשים בחירת זכיין`);
    if (errs > 0) parts.push(`${errs} שגיאות`);
    if (parts.length > 0) {
      toast.success(parts.join(" | "), { duration: 6000 });
    }

    queryClient.invalidateQueries({ queryKey: commissionInvoiceKeys.all });
  };

  const retryWithFranchisee = (row: FileRow, franchiseeId?: string) => {
    const targetId = franchiseeId ?? row.pickedFranchiseeId;
    if (!targetId) return;
    void uploadOne(row, targetId);
  };

  const hasPendingOrNeedsFranchisee = rows.some(
    (r) => r.status === "pending" || r.status === "needs_franchisee"
  );

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="sm:max-w-[900px] max-h-[85vh] overflow-y-auto"
        dir="rtl"
      >
        <DialogHeader>
          <DialogTitle>העלאת חשבוניות עמלה</DialogTitle>
          <DialogDescription>
            אפשר לבחור מספר PDF-ים באותו מייל. הזכיין יזוהה אוטומטית
            מתוך תוכן החשבונית.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          {/* Client + period */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label>לקוח</Label>
              <Select
                value={clientId}
                onValueChange={setClientId}
                dir="rtl"
                disabled={isUploading}
              >
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
              <Label>תקופה</Label>
              <div className="grid grid-cols-2 gap-2">
                <Select
                  value={String(periodMonth)}
                  onValueChange={(v) => setPeriodMonth(parseInt(v))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent dir="rtl">
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
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent dir="rtl">
                    {[2024, 2025, 2026, 2027].map((y) => (
                      <SelectItem key={y} value={String(y)}>
                        {y}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <p className="text-xs text-muted-foreground">
                תקופה תעודכן אוטומטית מהחשבונית אם תזוהה
              </p>
            </div>
          </div>

          {/* File input + drag-drop zone */}
          <div className="grid gap-2">
            <Label>קבצי חשבונית (PDF — ניתן לבחור מספר קבצים או לגרור לכאן)</Label>
            <div
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              className={cn(
                "rounded-md border-2 border-dashed p-4 transition-colors",
                isDragging
                  ? "border-primary bg-primary/5"
                  : "border-muted-foreground/25",
                (isUploading || !clientId) && "opacity-60"
              )}
            >
              <Input
                type="file"
                accept=".pdf,application/pdf"
                multiple
                dir="ltr"
                disabled={isUploading || !clientId}
                onChange={handleFilesPicked}
              />
              <p className="text-xs text-muted-foreground text-center mt-2">
                {isDragging ? "שחרר כאן להוספת הקבצים" : "ניתן גם לגרור קבצי PDF לתיבה זו"}
              </p>
            </div>
            {!clientId && (
              <p className="text-xs text-amber-600">
                יש לבחור לקוח לפני העלאת קבצים
              </p>
            )}
          </div>

          {/* Files table */}
          {rows.length > 0 && (
            <div className="rounded-md border overflow-hidden">
              <Table dir="rtl">
                <TableHeader>
                  <TableRow>
                    <TableHead>קובץ</TableHead>
                    <TableHead className="text-center">סטטוס</TableHead>
                    <TableHead>מס׳ חשבונית</TableHead>
                    <TableHead>סכום</TableHead>
                    <TableHead>זכיין / הערה</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell
                        className="max-w-[200px] truncate text-xs"
                        title={row.file.name}
                      >
                        {row.file.name}
                      </TableCell>
                      <TableCell className="text-center">
                        <FileStatusBadge status={row.status} />
                      </TableCell>
                      <TableCell className="text-xs">
                        {row.invoiceNumber ?? "—"}
                      </TableCell>
                      <TableCell className="text-xs">
                        {formatAmountDetailed(row.totalAmount ?? null)}
                      </TableCell>
                      <TableCell className="text-xs">
                        {row.status === "needs_franchisee" ? (
                          <FranchiseePicker
                            row={row}
                            allFranchisees={allFranchisees ?? []}
                            isLoading={franchiseesLoading}
                            onPick={(franchiseeId) => {
                              updateRow(row.id, {
                                pickedFranchiseeId: franchiseeId,
                              });
                              retryWithFranchisee(row, franchiseeId);
                            }}
                          />
                        ) : row.status === "success" ? (
                          <span className="text-emerald-700">
                            {row.franchiseeName ?? "—"}
                          </span>
                        ) : row.message ? (
                          <span className="text-red-600">{row.message}</span>
                        ) : (
                          "—"
                        )}
                      </TableCell>
                      <TableCell>
                        {row.status === "needs_franchisee" &&
                        row.pickedFranchiseeId ? (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => retryWithFranchisee(row)}
                            disabled={isUploading}
                          >
                            נסה שוב
                          </Button>
                        ) : row.status === "pending" ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => removeRow(row.id)}
                          >
                            <X className="h-3.5 w-3.5" />
                          </Button>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => handleOpenChange(false)}
            disabled={isUploading}
          >
            {rows.some((r) => r.status === "success") ? "סגור" : "ביטול"}
          </Button>
          <Button
            onClick={handleUploadAll}
            disabled={
              !clientId ||
              rows.length === 0 ||
              isUploading ||
              !hasPendingOrNeedsFranchisee
            }
          >
            {isUploading && <Loader2 className="h-4 w-4 me-2 animate-spin" />}
            {isUploading
              ? "מעלה..."
              : `העלה ${rows.filter((r) => r.status === "pending").length || ""} קבצים`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function FileStatusBadge({ status }: { status: FileStatus }) {
  switch (status) {
    case "pending":
      return <Badge variant="outline">ממתין</Badge>;
    case "uploading":
      return (
        <Badge variant="outline" className="gap-1">
          <Loader2 className="h-3 w-3 animate-spin" />
          מעלה
        </Badge>
      );
    case "success":
      return (
        <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300">
          <CheckCircle2 className="h-3 w-3 me-1" />
          הועלה
        </Badge>
      );
    case "needs_franchisee":
      return (
        <Badge variant="secondary" className="gap-1">
          <AlertTriangle className="h-3 w-3" />
          זכיין?
        </Badge>
      );
    case "error":
      return (
        <Badge variant="destructive" className="gap-1">
          <AlertTriangle className="h-3 w-3" />
          שגיאה
        </Badge>
      );
  }
}

function FranchiseePicker({
  row,
  allFranchisees,
  isLoading,
  onPick,
}: {
  row: FileRow;
  allFranchisees: Array<{ id: string; name: string }>;
  isLoading?: boolean;
  onPick: (franchiseeId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const candidates = (row.candidates ?? []).filter((c) => c.id);
  const candidateIds = new Set(candidates.map((c) => c.id));
  const remaining = allFranchisees.filter(
    (f) => f.id && !candidateIds.has(f.id)
  );

  const selectedName = row.pickedFranchiseeId
    ? (candidates.find((c) => c.id === row.pickedFranchiseeId)?.name ??
        allFranchisees.find((f) => f.id === row.pickedFranchiseeId)?.name ??
        null)
    : null;

  const handleSelect = (franchiseeId: string) => {
    onPick(franchiseeId);
    setOpen(false);
  };

  return (
    <div className="space-y-1">
      {row.extractedName && (
        <div className="text-xs text-muted-foreground">
          זוהה: &quot;{row.extractedName}&quot;
        </div>
      )}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className="h-8 w-full justify-between text-xs font-normal"
            dir="rtl"
          >
            <span className={cn(!selectedName && "text-muted-foreground")}>
              {isLoading && !selectedName
                ? "טוען זכיינים..."
                : (selectedName ?? "בחר זכיין...")}
            </span>
            <ChevronsUpDown className="h-3.5 w-3.5 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          className="w-[280px] p-0"
          align="start"
          dir="rtl"
        >
          <Command>
            <CommandInput placeholder="חפש זכיין..." className="h-9" />
            <CommandList>
              <CommandEmpty>לא נמצאו זכיינים</CommandEmpty>
              {candidates.length > 0 && (
                <CommandGroup heading="התאמות מוצעות">
                  {candidates.map((c) => (
                    <CommandItem
                      key={c.id}
                      value={`${c.name} ${c.id}`}
                      onSelect={() => handleSelect(c.id)}
                    >
                      <Check
                        className={cn(
                          "me-2 h-4 w-4",
                          row.pickedFranchiseeId === c.id
                            ? "opacity-100"
                            : "opacity-0"
                        )}
                      />
                      {c.name} ({Math.round(c.confidence * 100)}%)
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}
              {remaining.length > 0 && (
                <CommandGroup
                  heading={candidates.length > 0 ? "כל הזכיינים" : undefined}
                >
                  {remaining.map((f) => (
                    <CommandItem
                      key={f.id}
                      value={`${f.name} ${f.id}`}
                      onSelect={() => handleSelect(f.id)}
                    >
                      <Check
                        className={cn(
                          "me-2 h-4 w-4",
                          row.pickedFranchiseeId === f.id
                            ? "opacity-100"
                            : "opacity-0"
                        )}
                      />
                      {f.name}
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Franchisee filter combobox (page-level filter)
// ─────────────────────────────────────────────────────────────────────────────

function FranchiseeFilterCombobox({
  franchisees,
  selectedId,
  onChange,
}: {
  franchisees: Array<{ id: string; name: string }>;
  selectedId: string | null;
  onChange: (id: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const selected = selectedId
    ? franchisees.find((f) => f.id === selectedId)
    : null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="min-w-[200px] justify-between font-normal"
          dir="rtl"
        >
          <span className={cn(!selected && "text-muted-foreground")}>
            {selected?.name ?? "כל הזכיינים"}
          </span>
          <ChevronsUpDown className="h-3.5 w-3.5 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[280px] p-0" align="start" dir="rtl">
        <Command>
          <CommandInput placeholder="חפש זכיין..." className="h-9" />
          <CommandList>
            <CommandEmpty>לא נמצאו זכיינים</CommandEmpty>
            <CommandGroup>
              <CommandItem
                value="__all__"
                onSelect={() => {
                  onChange(null);
                  setOpen(false);
                }}
              >
                <Check
                  className={cn(
                    "me-2 h-4 w-4",
                    !selectedId ? "opacity-100" : "opacity-0"
                  )}
                />
                כל הזכיינים
              </CommandItem>
              {franchisees
                .filter((f) => f.id)
                .map((f) => (
                  <CommandItem
                    key={f.id}
                    value={`${f.name} ${f.id}`}
                    onSelect={() => {
                      onChange(f.id);
                      setOpen(false);
                    }}
                  >
                    <Check
                      className={cn(
                        "me-2 h-4 w-4",
                        selectedId === f.id ? "opacity-100" : "opacity-0"
                      )}
                    />
                    {f.name}
                  </CommandItem>
                ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
