"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Loader2,
  FileSpreadsheet,
  Download,
  Building2,
  DollarSign,
  FileText,
  Calendar,
  CheckCircle2,
  Clock,
  AlertCircle,
  XCircle,
  Eye,
  HardDrive,
} from "lucide-react";
import {
  ReportLayout,
  ReportSummaryCards,
  ReportDataTable,
  ReportExportButton,
  ReportPeriodSelector,
  type ColumnDef,
  type SummaryCardData,
} from "@/components/reports";
import type { SettlementPeriodType } from "@/db/schema";
import { getPeriodByKey } from "@/lib/settlement-periods";
import { formatDateAsLocal } from "@/lib/date-utils";
import { formatCurrency, formatDateHe, formatNumber } from "@/lib/report-utils";
import { toast } from "sonner";

// ============================================================================
// TYPES
// ============================================================================

interface SupplierFileEntry {
  id: string;
  supplierId: string;
  supplierName: string;
  supplierCode: string;
  fileName: string;
  fileUrl: string | null;
  fileSize: number | null;
  periodStartDate: string | null;
  periodEndDate: string | null;
  processingStatus: string;
  totalGrossAmount: number;
  totalNetAmount: number;
  commissionRate: number | null;
  commissionType: string | null;
  calculatedCommission: number;
  preCalculatedCommission: number | null;
  franchiseeCount: number;
  transactionCount: number;
  uploadedAt: string;
  uploadedByName: string | null;
}

interface SupplierFileSummary {
  supplierId: string;
  supplierName: string;
  supplierCode: string;
  fileCount: number;
  totalGrossAmount: number;
  totalNetAmount: number;
  totalCommission: number;
}

interface SupplierFilesReport {
  summary: {
    totalFiles: number;
    totalGrossAmount: number;
    totalNetAmount: number;
    totalCalculatedCommission: number;
    supplierCount: number;
    periodRange: {
      startDate: string | null;
      endDate: string | null;
    };
    generatedAt: string;
  };
  bySupplier: SupplierFileSummary[];
  files: SupplierFileEntry[];
}

interface FilterOption {
  id: string;
  name?: string;
  nameHe?: string;
  code?: string;
}

interface StatusOption {
  value: string;
  label: string;
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function getStatusBadge(status: string) {
  const config: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline"; icon: React.ReactNode }> = {
    pending: { label: "ממתין", variant: "secondary", icon: <Clock className="h-3 w-3" /> },
    processing: { label: "בעיבוד", variant: "outline", icon: <Loader2 className="h-3 w-3 animate-spin" /> },
    auto_approved: { label: "אושר אוטומטית", variant: "default", icon: <CheckCircle2 className="h-3 w-3" /> },
    needs_review: { label: "דורש בדיקה", variant: "secondary", icon: <Eye className="h-3 w-3" /> },
    approved: { label: "מאושר", variant: "default", icon: <CheckCircle2 className="h-3 w-3" /> },
    rejected: { label: "נדחה", variant: "destructive", icon: <XCircle className="h-3 w-3" /> },
  };

  const { label, variant, icon } = config[status] || { label: status, variant: "outline" as const, icon: <AlertCircle className="h-3 w-3" /> };

  return (
    <Badge variant={variant} className="flex items-center gap-1">
      {icon}
      {label}
    </Badge>
  );
}

function formatCommissionRate(rate: number | null, type: string | null): string {
  if (rate === null) return "-";
  if (type === "percentage") return `${rate}%`;
  return formatCurrency(rate);
}

function formatFileSize(bytes: number | null): string {
  if (bytes === null) return "-";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ============================================================================
// COLUMN DEFINITIONS
// ============================================================================

const fileColumns: ColumnDef<SupplierFileEntry>[] = [
  {
    id: "supplierName",
    header: "ספק",
    accessorKey: "supplierName",
    cell: (row) => (
      <div>
        <div className="font-medium">{row.supplierName}</div>
        <div className="text-xs text-muted-foreground">{row.supplierCode}</div>
      </div>
    ),
  },
  {
    id: "fileName",
    header: "קובץ",
    accessorKey: "fileName",
    cell: (row) => (
      <div className="max-w-[200px]">
        <div className="font-medium truncate" title={row.fileName}>
          {row.fileName}
        </div>
        {row.fileSize && (
          <div className="text-xs text-muted-foreground">
            {formatFileSize(row.fileSize)}
          </div>
        )}
      </div>
    ),
  },
  {
    id: "period",
    header: "תקופה",
    accessor: (row) =>
      row.periodStartDate && row.periodEndDate
        ? `${formatDateHe(row.periodStartDate)} - ${formatDateHe(row.periodEndDate)}`
        : "-",
  },
  {
    id: "processingStatus",
    header: "סטטוס",
    cell: (row) => getStatusBadge(row.processingStatus),
    sortable: false,
  },
  {
    id: "totalGrossAmount",
    header: "כולל מע״מ",
    accessor: (row) => formatCurrency(row.totalGrossAmount),
    accessorKey: "totalGrossAmount",
    className: "text-left",
  },
  {
    id: "totalNetAmount",
    header: "לפני מע״מ",
    accessor: (row) => formatCurrency(row.totalNetAmount),
    accessorKey: "totalNetAmount",
    className: "text-left",
  },
  {
    id: "commissionRate",
    header: "שיעור עמלה",
    accessor: (row) => formatCommissionRate(row.commissionRate, row.commissionType),
  },
  {
    id: "calculatedCommission",
    header: "עמלה",
    accessorKey: "calculatedCommission",
    cell: (row) => (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="font-medium text-emerald-600 dark:text-emerald-400 cursor-help">
              {formatCurrency(row.calculatedCommission)}
            </span>
          </TooltipTrigger>
          <TooltipContent>
            {row.preCalculatedCommission !== null
              ? "עמלה מחושבת מראש מהקובץ"
              : "עמלה מחושבת לפי שיעור הספק"}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    ),
  },
  {
    id: "franchiseeCount",
    header: "זכיינים",
    accessorKey: "franchiseeCount",
  },
  {
    id: "uploadedAt",
    header: "הועלה",
    accessor: (row) => formatDateHe(row.uploadedAt),
    accessorKey: "uploadedAt",
  },
  {
    id: "actions",
    header: "פעולות",
    sortable: false,
    cell: (row) => (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              disabled={!row.fileUrl}
              onClick={(e) => {
                e.stopPropagation();
                if (row.fileUrl) {
                  window.open(`/api/reports/supplier-files/${row.id}/download`, "_blank");
                }
              }}
            >
              <Download className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            {row.fileUrl ? "הורד קובץ" : "קובץ לא זמין"}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    ),
  },
];

const supplierColumns: ColumnDef<SupplierFileSummary>[] = [
  {
    id: "supplierName",
    header: "ספק",
    accessorKey: "supplierName",
    cell: (row) => (
      <div>
        <div className="font-medium">{row.supplierName}</div>
        <div className="text-xs text-muted-foreground">{row.supplierCode}</div>
      </div>
    ),
  },
  {
    id: "fileCount",
    header: "קבצים",
    accessorKey: "fileCount",
  },
  {
    id: "totalGrossAmount",
    header: "סה״כ כולל מע״מ",
    accessor: (row) => formatCurrency(row.totalGrossAmount),
    accessorKey: "totalGrossAmount",
    className: "font-medium",
  },
  {
    id: "totalNetAmount",
    header: "סה״כ לפני מע״מ",
    accessor: (row) => formatCurrency(row.totalNetAmount),
    accessorKey: "totalNetAmount",
    className: "font-medium",
  },
  {
    id: "totalCommission",
    header: "עמלות כולל",
    accessor: (row) => formatCurrency(row.totalCommission),
    accessorKey: "totalCommission",
    className: "font-medium text-emerald-600 dark:text-emerald-400",
    cell: (row) => (
      <span className="font-medium text-emerald-600 dark:text-emerald-400">
        {formatCurrency(row.totalCommission)}
      </span>
    ),
  },
];

// ============================================================================
// HELPER: Row styling for suppliers with zero amounts
// ============================================================================

function getSupplierRowClassName(row: SupplierFileSummary): string | undefined {
  if (row.totalNetAmount === 0 && row.totalGrossAmount === 0) {
    return "bg-muted/30 text-muted-foreground";
  }
  return undefined;
}

// ============================================================================
// COMPONENT
// ============================================================================

export default function SupplierFilesReportPage() {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const [report, setReport] = useState<SupplierFilesReport | null>(null);
  const [suppliers, setSuppliers] = useState<FilterOption[]>([]);
  const [brands, setBrands] = useState<FilterOption[]>([]);
  const [statuses, setStatuses] = useState<StatusOption[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [selectedSupplier, setSelectedSupplier] = useState("");
  const [selectedBrand, setSelectedBrand] = useState("");
  const [selectedStatus, setSelectedStatus] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [periodType, setPeriodType] = useState<SettlementPeriodType | "">("");
  const [periodKey, setPeriodKey] = useState("");
  const [useCustomDateRange, setUseCustomDateRange] = useState(true);

  const { data: session, isPending } = authClient.useSession();
  const userRole = session ? (session.user as { role?: string })?.role : undefined;

  // Redirect if not authenticated or not admin
  useEffect(() => {
    if (!isPending && !session) {
      router.push("/sign-in?redirect=/admin/reports/supplier-files");
      return;
    }
    if (!isPending && session?.user && userRole !== "super_user" && userRole !== "admin") {
      router.push("/dashboard");
    }
  }, [isPending, session, userRole, router]);

  // Build query string
  const buildQueryString = useCallback(() => {
    const params = new URLSearchParams();
    if (selectedSupplier && selectedSupplier !== "all") params.set("supplierId", selectedSupplier);
    if (selectedBrand && selectedBrand !== "all") params.set("brandId", selectedBrand);
    if (selectedStatus && selectedStatus !== "all") params.set("status", selectedStatus);
    if (startDate) params.set("startDate", startDate);
    if (endDate) params.set("endDate", endDate);
    return params.toString();
  }, [selectedSupplier, selectedBrand, selectedStatus, startDate, endDate]);

  // Fetch report
  const fetchReport = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const queryString = buildQueryString();
      const response = await fetch(`/api/reports/supplier-files${queryString ? `?${queryString}` : ""}`);
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to fetch report");
      }
      const data = await response.json();
      setReport(data.report);
      setSuppliers(data.filters.suppliers || []);
      setBrands(data.filters.brands || []);
      setStatuses(data.filters.statuses || []);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Failed to fetch report";
      setError(errorMessage);
      toast.error("שגיאה בטעינת הנתונים. נסה שוב.");
    } finally {
      setIsLoading(false);
    }
  }, [buildQueryString]);

  // Initial load
  useEffect(() => {
    if (session && (userRole === "super_user" || userRole === "admin")) {
      fetchReport();
    }
  }, [session, userRole, fetchReport]);

  // Handle period change
  const handlePeriodChange = (newPeriodType: SettlementPeriodType | "", newPeriodKey: string) => {
    setPeriodType(newPeriodType);
    setPeriodKey(newPeriodKey);
    setUseCustomDateRange(!newPeriodType);

    if (newPeriodKey) {
      const period = getPeriodByKey(newPeriodKey);
      if (period) {
        setStartDate(formatDateAsLocal(period.startDate));
        setEndDate(formatDateAsLocal(period.endDate));
      }
    }
  };

  // Handle filter reset
  const handleResetFilters = () => {
    setSelectedSupplier("");
    setSelectedBrand("");
    setSelectedStatus("");
    setStartDate("");
    setEndDate("");
    setPeriodType("");
    setPeriodKey("");
    setUseCustomDateRange(true);
  };

  // Summary cards
  const summaryCards: SummaryCardData[] = report
    ? [
        {
          title: "סה״כ קבצים",
          value: formatNumber(report.summary.totalFiles),
          subtitle: `${report.summary.supplierCount} ספקים`,
          icon: FileSpreadsheet,
        },
        {
          title: "סה״כ כולל מע״מ",
          value: formatCurrency(report.summary.totalGrossAmount),
          subtitle: "סכום כולל מע״מ",
          icon: DollarSign,
        },
        {
          title: "סה״כ לפני מע״מ",
          value: formatCurrency(report.summary.totalNetAmount),
          subtitle: "סכום לפני מע״מ",
          icon: HardDrive,
        },
        {
          title: "סה״כ עמלות",
          value: formatCurrency(report.summary.totalCalculatedCommission),
          subtitle: "עמלות מחושבות",
          icon: DollarSign,
          variant: "success",
        },
      ]
    : [];

  if (isPending) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!session) return null;

  return (
    <ReportLayout
      title="דוח קבצי ספקים"
      description="צפייה בקבצים שהועלו מספקים עם חישוב עמלות והורדה"
      breadcrumbs={[
        { label: "ניהול", href: "/admin" },
        { label: "דוחות", href: "/admin/reports" },
        { label: "קבצי ספקים" },
      ]}
      isLoading={isLoading}
      onRefresh={fetchReport}
      actions={
        <ReportExportButton
          endpoints={{
            excel: "/api/reports/supplier-files/export",
          }}
          queryString={buildQueryString()}
          reportType="supplier-files"
          disabled={!report || report.files.length === 0}
        />
      }
    >
      {/* Filters Card */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">סינון</CardTitle>
          <CardDescription>סנן לפי ספק, מותג, סטטוס או תקופה</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Period Selector */}
          <div className="p-3 border rounded-lg bg-muted/30">
            <ReportPeriodSelector
              periodType={periodType}
              periodKey={periodKey}
              onChange={handlePeriodChange}
              onCustomRangeSelect={() => setUseCustomDateRange(true)}
              showCustomRange={true}
              layout="horizontal"
              showLabels={true}
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
            <div className="space-y-2">
              <Label htmlFor="supplier">ספק</Label>
              <Select value={selectedSupplier} onValueChange={setSelectedSupplier}>
                <SelectTrigger id="supplier">
                  <SelectValue placeholder="כל הספקים" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">כל הספקים</SelectItem>
                  {suppliers.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name} ({s.code})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="brand">מותג</Label>
              <Select value={selectedBrand} onValueChange={setSelectedBrand}>
                <SelectTrigger id="brand">
                  <SelectValue placeholder="כל המותגים" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">כל המותגים</SelectItem>
                  {brands.map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      {b.nameHe || b.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="status">סטטוס</Label>
              <Select value={selectedStatus} onValueChange={setSelectedStatus}>
                <SelectTrigger id="status">
                  <SelectValue placeholder="כל הסטטוסים" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">כל הסטטוסים</SelectItem>
                  {statuses.map((s) => (
                    <SelectItem key={s.value} value={s.value}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Date inputs - only show when using custom range */}
            {useCustomDateRange && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="startDate">מתאריך</Label>
                  <Input
                    id="startDate"
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="endDate">עד תאריך</Label>
                  <Input
                    id="endDate"
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                  />
                </div>
              </>
            )}
          </div>

          <div className="flex gap-2 mt-4">
            <Button onClick={fetchReport} disabled={isLoading}>
              {isLoading && <Loader2 className="h-4 w-4 me-2 animate-spin" />}
              החל סינון
            </Button>
            <Button variant="outline" onClick={handleResetFilters}>
              איפוס
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Error State */}
      {error && (
        <Alert variant="destructive">
          <FileSpreadsheet className="h-4 w-4" />
          <AlertTitle>שגיאה</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Loading State */}
      {isLoading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      )}

      {/* Report Content */}
      {!isLoading && report && (
        <>
          {/* Summary Cards */}
          <ReportSummaryCards cards={summaryCards} columns={4} />

          {/* Info Alert */}
          {report.summary.totalFiles > 0 && (
            <Alert>
              <FileSpreadsheet className="h-4 w-4" />
              <AlertTitle>סיכום קבצים</AlertTitle>
              <AlertDescription>
                נמצאו {report.summary.totalFiles} קבצים מ-{report.summary.supplierCount} ספקים.
                סה״כ עמלות: {formatCurrency(report.summary.totalCalculatedCommission)}.
              </AlertDescription>
            </Alert>
          )}

          {/* Tabs for different views */}
          <Tabs defaultValue="files" className="w-full" dir="rtl">
            <TabsList className="flex w-full gap-1">
              <TabsTrigger value="files" className="flex items-center gap-2">
                <FileText className="h-4 w-4" />
                פירוט קבצים
              </TabsTrigger>
              <TabsTrigger value="bySupplier" className="flex items-center gap-2">
                <Building2 className="h-4 w-4" />
                לפי ספק
              </TabsTrigger>
            </TabsList>

            {/* Files Tab */}
            <TabsContent value="files">
              <Card>
                <CardHeader>
                  <CardTitle>פירוט קבצים</CardTitle>
                  <CardDescription>כל הקבצים שהועלו מספקים</CardDescription>
                </CardHeader>
                <CardContent>
                  {report.files.length === 0 ? (
                    <div className="text-center py-8">
                      <FileSpreadsheet className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                      <h3 className="text-lg font-medium mb-2">אין קבצים</h3>
                      <p className="text-muted-foreground">
                        לא נמצאו קבצים בתקופה הנבחרת
                      </p>
                    </div>
                  ) : (
                    <ReportDataTable
                      data={report.files}
                      columns={fileColumns}
                      rowKey="id"
                      searchPlaceholder="חיפוש קובץ או ספק..."
                      emptyMessage="אין נתונים להצגה"
                    />
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            {/* By Supplier Tab */}
            <TabsContent value="bySupplier">
              <Card>
                <CardHeader>
                  <CardTitle>סיכום לפי ספק</CardTitle>
                  <CardDescription>קבצים ועמלות מקובצים לפי ספק</CardDescription>
                </CardHeader>
                <CardContent>
                  {report.bySupplier.length === 0 ? (
                    <div className="text-center py-8">
                      <Building2 className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                      <h3 className="text-lg font-medium mb-2">אין נתונים</h3>
                      <p className="text-muted-foreground">
                        לא נמצאו קבצים לפי ספק
                      </p>
                    </div>
                  ) : (
                    <ReportDataTable
                      data={report.bySupplier}
                      columns={supplierColumns}
                      rowKey="supplierId"
                      searchPlaceholder="חיפוש ספק..."
                      emptyMessage="אין נתונים להצגה"
                      rowClassName={getSupplierRowClassName}
                    />
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </>
      )}
    </ReportLayout>
  );
}
