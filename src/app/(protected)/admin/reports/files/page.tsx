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

interface SourceOption {
  value: string;
  label: string;
}

interface EntityTypeOption {
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
  const [sources, setSources] = useState<SourceOption[]>([]);
  const [entityTypes, setEntityTypes] = useState<EntityTypeOption[]>([]);
  const [statuses, setStatuses] = useState<StatusOption[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [selectedSource, setSelectedSource] = useState("");
  const [selectedEntityType, setSelectedEntityType] = useState("");
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
      router.push("/sign-in?redirect=/admin/reports/files");
      return;
    }
    if (!isPending && session?.user && userRole !== "super_user" && userRole !== "admin") {
      router.push("/dashboard");
    }
  }, [isPending, session, userRole, router]);

  // Build query string
  const buildQueryString = useCallback(() => {
    const params = new URLSearchParams();
    if (selectedSource && selectedSource !== "all") params.set("source", selectedSource);
    if (selectedEntityType && selectedEntityType !== "all") params.set("entityType", selectedEntityType);
    if (selectedStatus && selectedStatus !== "all") params.set("status", selectedStatus);
    if (startDate) params.set("startDate", startDate);
    if (endDate) params.set("endDate", endDate);
    return params.toString();
  }, [selectedSource, selectedEntityType, selectedStatus, startDate, endDate]);

  // Fetch report
  const fetchReport = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const queryString = buildQueryString();
      const response = await fetch(`/api/reports/files${queryString ? `?${queryString}` : ""}`);
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to fetch report");
      }
      const data = await response.json();
      setReport(data.report);
      setSources(data.filters.sources || []);
      setEntityTypes(data.filters.entityTypes || []);
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
    setSelectedSource("");
    setSelectedEntityType("");
    setSelectedStatus("");
    setStartDate("");
    setEndDate("");
    setPeriodType("");
    setPeriodKey("");
    setUseCustomDateRange(true);
  };

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
          queryString={buildQueryString()}
          reportType="files"
          disabled={!report || report.files.length === 0}
        />
      }
    >
      {/* Compact Filters Card */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base">סינון</CardTitle>
              <CardDescription className="text-sm">סנן לפי מקור, סוג ישות, סטטוס או תקופה</CardDescription>
            </div>
            <Button variant="ghost" size="sm" onClick={handleResetFilters}>
              איפוס
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* Period Selector */}
          <div className="p-2.5 border rounded-md bg-muted/20">
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

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="source" className="text-xs">מקור</Label>
              <Select value={selectedSource} onValueChange={setSelectedSource}>
                <SelectTrigger id="source" className="h-9 text-sm">
                  <SelectValue placeholder="כל המקורות" />
                </SelectTrigger>
                <SelectContent>
                  {sources.map((s) => (
                    <SelectItem key={s.value} value={s.value}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="entityType" className="text-xs">סוג ישות</Label>
              <Select value={selectedEntityType} onValueChange={setSelectedEntityType}>
                <SelectTrigger id="entityType" className="h-9 text-sm">
                  <SelectValue placeholder="כל הסוגים" />
                </SelectTrigger>
                <SelectContent>
                  {entityTypes.map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="status" className="text-xs">סטטוס</Label>
              <Select value={selectedStatus} onValueChange={setSelectedStatus}>
                <SelectTrigger id="status" className="h-9 text-sm">
                  <SelectValue placeholder="כל הסטטוסים" />
                </SelectTrigger>
                <SelectContent>
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
                <div className="space-y-1.5">
                  <Label htmlFor="startDate" className="text-xs">מתאריך</Label>
                  <Input
                    id="startDate"
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="h-9 text-sm"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="endDate" className="text-xs">עד תאריך</Label>
                  <Input
                    id="endDate"
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    className="h-9 text-sm"
                  />
                </div>
              </>
            )}
          </div>

          <div className="flex gap-2 pt-1">
            <Button onClick={fetchReport} disabled={isLoading} size="sm">
              {isLoading && <Loader2 className="h-3.5 w-3.5 me-2 animate-spin" />}
              החל סינון
            </Button>
          </div>
        </CardContent>
      </Card>

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
          <Tabs defaultValue="all" className="w-full" dir="rtl">
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
