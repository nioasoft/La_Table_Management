"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Loader2,
  Download,
  Building2,
  Users,
  FileText,
  Clock,
  CheckCircle2,
  AlertCircle,
  XCircle,
  Eye,
  Files,
  Link2,
  Upload,
} from "lucide-react";
import {
  ReportLayout,
  ReportSummaryCards,
  ReportDataTable,
  ReportExportButton,
  ReportFilters,
  type ColumnDef,
  type SummaryCardData,
} from "@/components/reports";
import { useReportFilters } from "@/hooks/use-report-filters";
import type { StatusOption } from "@/components/reports/report-filters";
import { formatDateHe, formatNumber } from "@/lib/report-utils";
import { toast } from "sonner";

// ============================================================================
// TYPES
// ============================================================================

type UnifiedFileSource = "supplier" | "uploaded";

interface UnifiedFile {
  id: string;
  source: UnifiedFileSource;
  originalFileName: string;
  fileUrl: string | null;
  fileSize: number | null;
  processingStatus: string;
  createdAt: string;
  periodStartDate: string | null;
  periodEndDate: string | null;
  entityType: "supplier" | "franchisee" | "upload_link" | null;
  entityId: string | null;
  entityName: string | null;
  uploadedByName: string | null;
  uploadedByEmail: string | null;
}

interface UnifiedFileSummary {
  source: UnifiedFileSource;
  label: string;
  count: number;
  totalSize: number;
}

interface UnifiedFilesReport {
  summary: {
    totalFiles: number;
    totalSize: number;
    supplierFiles: number;
    uploadedFiles: number;
    pendingReview: number;
    periodRange: {
      startDate: string | null;
      endDate: string | null;
    };
    generatedAt: string;
  };
  bySource: UnifiedFileSummary[];
  files: UnifiedFile[];
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function getStatusBadge(status: string) {
  const config: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline"; icon: React.ReactNode }> = {
    pending: { label: "ממתין", variant: "secondary", icon: <Clock className="h-3 w-3" /> },
    processing: { label: "בעיבוד", variant: "outline", icon: <Loader2 className="h-3 w-3 animate-spin" /> },
    auto_approved: { label: "אושר", variant: "default", icon: <CheckCircle2 className="h-3 w-3" /> },
    needs_review: { label: "דורש בדיקה", variant: "secondary", icon: <Eye className="h-3 w-3" /> },
    approved: { label: "מאושר", variant: "default", icon: <CheckCircle2 className="h-3 w-3" /> },
    rejected: { label: "נדחה", variant: "destructive", icon: <XCircle className="h-3 w-3" /> },
  };

  const { label, variant, icon } = config[status] || { label: status, variant: "outline" as const, icon: <AlertCircle className="h-3 w-3" /> };

  return (
    <Badge variant={variant} className="flex items-center gap-1 text-xs">
      {icon}
      {label}
    </Badge>
  );
}

function formatFileSize(bytes: number | null): string {
  if (bytes === null) return "-";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ============================================================================
// STATUS OPTIONS
// ============================================================================

const fileStatusOptions: StatusOption[] = [
  { value: "pending", label: "ממתין" },
  { value: "processing", label: "בעיבוד" },
  { value: "auto_approved", label: "אושר אוטומטית" },
  { value: "needs_review", label: "דורש בדיקה" },
  { value: "approved", label: "מאושר" },
  { value: "rejected", label: "נדחה" },
];

// ============================================================================
// COLUMN DEFINITIONS
// ============================================================================

const fileColumns: ColumnDef<UnifiedFile>[] = [
  {
    id: "originalFileName",
    header: "קובץ",
    accessorKey: "originalFileName",
    cell: (row) => (
      <div className="max-w-[250px]">
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="font-medium truncate cursor-help text-sm">
                {row.originalFileName}
              </div>
            </TooltipTrigger>
            <TooltipContent>
              <p>{row.originalFileName}</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
        <div className="flex items-center gap-2 mt-1">
          {row.source === "supplier" ? (
            <Badge variant="outline" className="text-xs h-5 px-1.5">
              <Building2 className="h-2.5 w-2.5 me-1" />
              ספק
            </Badge>
          ) : (
            <Badge variant="secondary" className="text-xs h-5 px-1.5">
              <FileText className="h-2.5 w-2.5 me-1" />
              אחיד
            </Badge>
          )}
          {row.entityType === "upload_link" ? (
            <Badge variant="outline" className="text-xs h-5 px-1.5 border-green-300 text-green-700 dark:border-green-700 dark:text-green-400">
              <Link2 className="h-2.5 w-2.5 me-1" />
              לינק
            </Badge>
          ) : (
            <Badge variant="outline" className="text-xs h-5 px-1.5 border-blue-300 text-blue-700 dark:border-blue-700 dark:text-blue-400">
              <Upload className="h-2.5 w-2.5 me-1" />
              ידני
            </Badge>
          )}
          {row.fileSize && (
            <span className="text-xs text-muted-foreground">
              {formatFileSize(row.fileSize)}
            </span>
          )}
        </div>
      </div>
    ),
  },
  {
    id: "entityName",
    header: "ישות",
    accessorKey: "entityName",
    accessor: (row) => row.entityName || "-",
    cell: (row) => (
      <div className="max-w-[180px]">
        {row.entityName ? (
          <>
            <div className="truncate text-sm font-medium" title={row.entityName}>
              {row.entityName}
            </div>
            <div className="flex items-center gap-1 text-xs text-muted-foreground mt-0.5">
              {row.entityType === "supplier" && <Building2 className="h-3 w-3" />}
              {row.entityType === "franchisee" && <Users className="h-3 w-3" />}
              {row.entityType === "upload_link" && <FileText className="h-3 w-3" />}
              {row.entityType === "supplier" && "ספק"}
              {row.entityType === "franchisee" && "זכיין"}
              {row.entityType === "upload_link" && "קישור"}
            </div>
          </>
        ) : (
          <span className="text-muted-foreground text-sm">-</span>
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
    cell: (row) => (
      <span className="text-sm">
        {row.periodStartDate && row.periodEndDate
          ? `${formatDateHe(row.periodStartDate)} - ${formatDateHe(row.periodEndDate)}`
          : <span className="text-muted-foreground">-</span>}
      </span>
    ),
  },
  {
    id: "processingStatus",
    header: "סטטוס",
    cell: (row) => getStatusBadge(row.processingStatus),
    sortable: false,
  },
  {
    id: "createdAt",
    header: "הועלה",
    accessor: (row) => formatDateHe(row.createdAt),
    accessorKey: "createdAt",
    cell: (row) => (
      <span className="text-sm text-muted-foreground">
        {formatDateHe(row.createdAt)}
      </span>
    ),
  },
  {
    id: "actions",
    header: "",
    sortable: false,
    cell: (row) => (
      <div className="flex justify-end">
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                disabled={!row.fileUrl}
                onClick={(e) => {
                  e.stopPropagation();
                  if (row.fileUrl) {
                    window.open(`/api/reports/files/${row.id}/download?source=${row.source}`, "_blank");
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
      </div>
    ),
  },
];

// Columns for supplier files tab
const supplierFileColumns: ColumnDef<UnifiedFile>[] = fileColumns.map((col) =>
  col.id === "originalFileName"
    ? {
        ...col,
        cell: (row: UnifiedFile) => (
          <div className="max-w-[250px]">
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="font-medium truncate cursor-help text-sm">
                    {row.originalFileName}
                  </div>
                </TooltipTrigger>
                <TooltipContent>
                  <p>{row.originalFileName}</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
            {row.fileSize && (
              <div className="text-xs text-muted-foreground mt-1">
                {formatFileSize(row.fileSize)}
              </div>
            )}
          </div>
        ),
      }
    : col
);

// Columns for uploaded files tab
const uploadedFileColumns: ColumnDef<UnifiedFile>[] = supplierFileColumns;

// ============================================================================
// COMPONENT
// ============================================================================

export default function FilesReportPage() {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const [report, setReport] = useState<UnifiedFilesReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState("all");

  // Use shared report filters hook
  const {
    filters,
    updateFilter,
    updatePeriod,
    resetFilters,
    buildQueryString,
    hasActiveFilters,
    activeFilterCount,
    options,
    setOptions,
  } = useReportFilters();

  const { data: session, isPending } = authClient.useSession();
  const userRole = session ? (session.user as { role?: string })?.role : undefined;

  // Redirect if not authenticated or not admin
  useEffect(() => {
    if (!isPending && !session) {
      router.push("/sign-in?redirect=/admin/reports/files");
      return;
    }
    if (!isPending && session?.user && userRole !== "super_user" && userRole !== "admin") {
      router.push("/dashboard");
    }
  }, [isPending, session, userRole, router]);

  // Build query string for API — adds source from active tab for export
  const buildApiQueryString = useCallback(() => {
    const base = buildQueryString();
    return base;
  }, [buildQueryString]);

  // Build export query string — includes source based on active tab
  const buildExportQueryString = useCallback(() => {
    const params = new URLSearchParams(buildQueryString());
    if (activeTab !== "all") {
      params.set("source", activeTab);
    }
    return params.toString();
  }, [buildQueryString, activeTab]);

  // Fetch report
  const fetchReport = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const queryString = buildApiQueryString();
      const response = await fetch(`/api/reports/files${queryString ? `?${queryString}` : ""}`);
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to fetch report");
      }
      const data = await response.json();
      setReport(data.report);

      // Update filter options from API response
      if (data.filters) {
        setOptions({
          brands: data.filters.brands || [],
          suppliers: data.filters.suppliers || [],
          franchisees: data.filters.franchisees || [],
        });
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Failed to fetch report";
      setError(errorMessage);
      toast.error("שגיאה בטעינת הנתונים. נסה שוב.");
    } finally {
      setIsLoading(false);
    }
  }, [buildApiQueryString, setOptions]);

  // Initial load
  useEffect(() => {
    if (session && (userRole === "super_user" || userRole === "admin")) {
      fetchReport();
    }
  }, [session, userRole, fetchReport]);

  // Filter files for tabs
  const supplierFiles = report?.files.filter((f) => f.source === "supplier") || [];
  const uploadedFiles = report?.files.filter((f) => f.source === "uploaded") || [];

  // Summary cards
  const summaryCards: SummaryCardData[] = report
    ? [
        {
          title: "סה״כ קבצים",
          value: formatNumber(report.summary.totalFiles),
          subtitle: formatFileSize(report.summary.totalSize),
          icon: Files,
        },
        {
          title: "קבצי ספקים",
          value: formatNumber(report.summary.supplierFiles),
          subtitle: "קבצים מספקים",
          icon: Building2,
        },
        {
          title: "קבצים אחידים",
          value: formatNumber(report.summary.uploadedFiles),
          subtitle: "קבצים מזכיינים",
          icon: FileText,
        },
        {
          title: "ממתינים לבדיקה",
          value: formatNumber(report.summary.pendingReview),
          subtitle: "דורשים תשומת לב",
          icon: Eye,
          variant: report.summary.pendingReview > 0 ? "warning" : "default",
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
      title="ניהול קבצים"
      description="צפייה ניהול של כל הקבצים במערכת"
      breadcrumbs={[
        { label: "ניהול", href: "/admin" },
        { label: "דוחות", href: "/admin/reports" },
        { label: "ניהול קבצים" },
      ]}
      isLoading={isLoading}
      onRefresh={fetchReport}
      actions={
        <ReportExportButton
          endpoints={{
            excel: "/api/reports/files/export",
          }}
          queryString={buildExportQueryString()}
          reportType="files"
          disabled={!report || report.files.length === 0}
        />
      }
    >
      {/* Shared Filters Component */}
      <ReportFilters
        filters={filters}
        onFilterChange={updateFilter}
        onPeriodChange={updatePeriod}
        onApply={fetchReport}
        onReset={resetFilters}
        suppliers={options.suppliers}
        franchisees={options.franchisees}
        statusOptions={fileStatusOptions}
        showPeriodSelector={true}
        showDateFilters={true}
        showBrandFilter={false}
        showSupplierFilter={true}
        showFranchiseeFilter={true}
        showStatusFilter={true}
        showDatePresets={false}
        isLoading={isLoading}
        activeFilterCount={activeFilterCount}
        description="סנן לפי ספק, זכיין, סטטוס או תקופה"
      />

      {/* Error State */}
      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
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

          {/* Compact Info Alert */}
          {report.summary.totalFiles > 0 && (
            <Alert>
              <Files className="h-4 w-4" />
              <AlertDescription className="text-sm">
                נמצאו {report.summary.totalFiles} קבצים ({report.summary.supplierFiles} מספקים, {report.summary.uploadedFiles} אחידים)
                {report.summary.pendingReview > 0 && (
                  <span className="font-medium text-amber-600 dark:text-amber-400"> · {report.summary.pendingReview} ממתינים לבדיקה</span>
                )}
              </AlertDescription>
            </Alert>
          )}

          {/* Tabs for different views */}
          <Tabs defaultValue="all" value={activeTab} onValueChange={setActiveTab} className="w-full" dir="rtl">
            <TabsList className="grid w-full grid-cols-3 h-9">
              <TabsTrigger value="all" className="text-sm">
                <Files className="h-3.5 w-3.5 me-1.5" />
                הכל ({report.files.length})
              </TabsTrigger>
              <TabsTrigger value="supplier" className="text-sm">
                <Building2 className="h-3.5 w-3.5 me-1.5" />
                ספקים ({supplierFiles.length})
              </TabsTrigger>
              <TabsTrigger value="uploaded" className="text-sm">
                <FileText className="h-3.5 w-3.5 me-1.5" />
                אחידים ({uploadedFiles.length})
              </TabsTrigger>
            </TabsList>

            {/* All Files Tab */}
            <TabsContent value="all" className="mt-4">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">כל הקבצים</CardTitle>
                </CardHeader>
                <CardContent>
                  {report.files.length === 0 ? (
                    <div className="text-center py-12">
                      <Files className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
                      <h3 className="text-base font-medium mb-1">אין קבצים</h3>
                      <p className="text-sm text-muted-foreground">
                        לא נמצאו קבצים בתקופה הנבחרת
                      </p>
                    </div>
                  ) : (
                    <ReportDataTable
                      data={report.files}
                      columns={fileColumns}
                      rowKey="id"
                      searchPlaceholder="חיפוש קובץ או ישות..."
                      emptyMessage="אין נתונים להצגה"
                    />
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            {/* Supplier Files Tab */}
            <TabsContent value="supplier" className="mt-4">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">קבצי ספקים</CardTitle>
                </CardHeader>
                <CardContent>
                  {supplierFiles.length === 0 ? (
                    <div className="text-center py-12">
                      <Building2 className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
                      <h3 className="text-base font-medium mb-1">אין קבצי ספקים</h3>
                      <p className="text-sm text-muted-foreground">
                        לא נמצאו קבצי ספקים בתקופה הנבחרת
                      </p>
                    </div>
                  ) : (
                    <ReportDataTable
                      data={supplierFiles}
                      columns={supplierFileColumns}
                      rowKey="id"
                      searchPlaceholder="חיפוש קובץ או ספק..."
                      emptyMessage="אין נתונים להצגה"
                    />
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            {/* Uploaded Files Tab */}
            <TabsContent value="uploaded" className="mt-4">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">קבצים אחידים</CardTitle>
                </CardHeader>
                <CardContent>
                  {uploadedFiles.length === 0 ? (
                    <div className="text-center py-12">
                      <FileText className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
                      <h3 className="text-base font-medium mb-1">אין קבצים אחידים</h3>
                      <p className="text-sm text-muted-foreground">
                        לא נמצאו קבצים אחידים בתקופה הנבחרת
                      </p>
                    </div>
                  ) : (
                    <ReportDataTable
                      data={uploadedFiles}
                      columns={uploadedFileColumns}
                      rowKey="id"
                      searchPlaceholder="חיפוש קובץ או זכיין..."
                      emptyMessage="אין נתונים להצגה"
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
