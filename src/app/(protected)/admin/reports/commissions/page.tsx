"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, DollarSign, Percent, Calendar, Building2, Users, Store } from "lucide-react";
import {
  ReportLayout,
  ReportFilters,
  ReportSummaryCards,
  ReportDataTable,
  ReportExportButton,
  type ColumnDef,
  type SummaryCardData,
} from "@/components/reports";
import { useReportFilters, type FilterOption } from "@/hooks/use-report-filters";
import {
  formatCurrency,
  formatPercent,
  formatDateHe,
  formatDateRange,
  commissionStatusOptions,
  getStatusConfig,
} from "@/lib/report-utils";
import { toast } from "sonner";

// ============================================================================
// TYPES
// ============================================================================

interface CommissionWithDetails {
  id: string;
  supplierId: string;
  supplierName: string;
  supplierCode: string;
  franchiseeId: string;
  franchiseeName: string;
  franchiseeCode: string;
  brandId: string;
  brandNameHe: string;
  brandNameEn: string | null;
  periodStartDate: string;
  periodEndDate: string;
  status: string;
  grossAmount: string;
  netAmount: string | null;
  commissionRate: string;
  commissionAmount: string;
}

interface CommissionSummaryByBrand {
  brandId: string;
  brandNameHe: string;
  brandNameEn: string | null;
  commissionCount: number;
  totalGrossAmount: number;
  totalNetAmount: number;
  totalCommissionAmount: number;
  avgCommissionRate: number;
}

interface CommissionSummaryByPeriod {
  periodStartDate: string;
  periodEndDate: string;
  commissionCount: number;
  totalGrossAmount: number;
  totalNetAmount: number;
  totalCommissionAmount: number;
}

interface CommissionSummaryBySupplier {
  supplierId: string;
  supplierName: string;
  supplierCode: string;
  commissionCount: number;
  totalGrossAmount: number;
  totalNetAmount: number;
  totalCommissionAmount: number;
  avgCommissionRate: number;
}

interface CommissionReport {
  summary: {
    totalCommissions: number;
    totalGrossAmount: number;
    totalNetAmount: number;
    totalCommissionAmount: number;
    avgCommissionRate: number;
    periodRange: {
      startDate: string | null;
      endDate: string | null;
    };
    generatedAt: string;
  };
  byBrand: CommissionSummaryByBrand[];
  byPeriod: CommissionSummaryByPeriod[];
  bySupplier: CommissionSummaryBySupplier[];
  details: CommissionWithDetails[];
}

// ============================================================================
// COLUMN DEFINITIONS
// ============================================================================

const detailColumns: ColumnDef<CommissionWithDetails>[] = [
  {
    id: "supplierName",
    header: "ספק",
    accessorKey: "supplierName",
    className: "font-medium",
  },
  {
    id: "franchiseeName",
    header: "זכיין",
    accessorKey: "franchiseeName",
  },
  {
    id: "brandNameHe",
    header: "מותג",
    accessorKey: "brandNameHe",
  },
  {
    id: "period",
    header: "תקופה",
    accessor: (row) => formatDateRange(row.periodStartDate, row.periodEndDate),
    className: "text-sm",
    sortable: false,
  },
  {
    id: "grossAmount",
    header: "ברוטו",
    accessor: (row) => formatCurrency(Number(row.grossAmount)),
    accessorKey: "grossAmount",
  },
  {
    id: "commissionAmount",
    header: "עמלה",
    accessor: (row) => formatCurrency(Number(row.commissionAmount)),
    accessorKey: "commissionAmount",
    className: "font-medium",
  },
  {
    id: "commissionRate",
    header: "שיעור",
    accessor: (row) => formatPercent(Number(row.commissionRate)),
    accessorKey: "commissionRate",
  },
  {
    id: "status",
    header: "סטטוס",
    cell: (row) => {
      const config = getStatusConfig(row.status, "commission");
      return <Badge variant={config.variant}>{config.label}</Badge>;
    },
    accessorKey: "status",
  },
];

const brandColumns: ColumnDef<CommissionSummaryByBrand>[] = [
  { id: "brandNameHe", header: "מותג", accessorKey: "brandNameHe", className: "font-medium" },
  { id: "commissionCount", header: "מספר עמלות", accessorKey: "commissionCount" },
  { id: "totalGrossAmount", header: "סכום ברוטו", accessor: (row) => formatCurrency(row.totalGrossAmount), accessorKey: "totalGrossAmount" },
  { id: "totalNetAmount", header: "סכום נטו", accessor: (row) => formatCurrency(row.totalNetAmount), accessorKey: "totalNetAmount" },
  { id: "totalCommissionAmount", header: "סכום עמלה", accessor: (row) => formatCurrency(row.totalCommissionAmount), accessorKey: "totalCommissionAmount", className: "font-medium" },
  { id: "avgCommissionRate", header: "עמלה ממוצעת", accessor: (row) => formatPercent(row.avgCommissionRate), accessorKey: "avgCommissionRate" },
];

const periodColumns: ColumnDef<CommissionSummaryByPeriod>[] = [
  { id: "periodStartDate", header: "תאריך התחלה", accessor: (row) => formatDateHe(row.periodStartDate), accessorKey: "periodStartDate" },
  { id: "periodEndDate", header: "תאריך סיום", accessor: (row) => formatDateHe(row.periodEndDate), accessorKey: "periodEndDate" },
  { id: "commissionCount", header: "מספר עמלות", accessorKey: "commissionCount" },
  { id: "totalGrossAmount", header: "סכום ברוטו", accessor: (row) => formatCurrency(row.totalGrossAmount), accessorKey: "totalGrossAmount" },
  { id: "totalNetAmount", header: "סכום נטו", accessor: (row) => formatCurrency(row.totalNetAmount), accessorKey: "totalNetAmount" },
  { id: "totalCommissionAmount", header: "סכום עמלה", accessor: (row) => formatCurrency(row.totalCommissionAmount), accessorKey: "totalCommissionAmount", className: "font-medium" },
];

const supplierColumns: ColumnDef<CommissionSummaryBySupplier>[] = [
  { id: "supplierName", header: "ספק", accessorKey: "supplierName", className: "font-medium" },
  { id: "supplierCode", header: "קוד", accessorKey: "supplierCode" },
  { id: "commissionCount", header: "מספר עמלות", accessorKey: "commissionCount" },
  { id: "totalGrossAmount", header: "סכום ברוטו", accessor: (row) => formatCurrency(row.totalGrossAmount), accessorKey: "totalGrossAmount" },
  { id: "totalNetAmount", header: "סכום נטו", accessor: (row) => formatCurrency(row.totalNetAmount), accessorKey: "totalNetAmount" },
  { id: "totalCommissionAmount", header: "סכום עמלה", accessor: (row) => formatCurrency(row.totalCommissionAmount), accessorKey: "totalCommissionAmount", className: "font-medium" },
  { id: "avgCommissionRate", header: "עמלה ממוצעת", accessor: (row) => formatPercent(row.avgCommissionRate), accessorKey: "avgCommissionRate" },
];

// ============================================================================
// COMPONENT
// ============================================================================

export default function CommissionsReportPage() {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const [report, setReport] = useState<CommissionReport | null>(null);

  const { data: session, isPending } = authClient.useSession();
  const userRole = session ? (session.user as { role?: string })?.role : undefined;

  // Filter state
  const {
    filters,
    updateFilter,
    updatePeriod,
    resetFilters,
    buildQueryString,
    activeFilterCount,
    options,
    setOptions,
  } = useReportFilters({ syncToUrl: true });

  // Redirect if not authenticated or not admin
  useEffect(() => {
    if (!isPending && !session) {
      router.push("/sign-in?redirect=/admin/reports/commissions");
      return;
    }
    if (!isPending && session?.user && userRole !== "super_user" && userRole !== "admin") {
      router.push("/dashboard");
    }
  }, [isPending, session, userRole, router]);

  // Fetch report data
  const fetchReport = useCallback(async () => {
    setIsLoading(true);
    try {
      const queryString = buildQueryString();
      const response = await fetch(`/api/commissions/report${queryString ? `?${queryString}` : ""}`);

      if (!response.ok) {
        throw new Error("Failed to fetch report");
      }

      const data = await response.json();
      setReport(data.report);
      setOptions({
        brands: data.filters.brands || [],
        suppliers: data.filters.suppliers || [],
        franchisees: [],
      });
    } catch (error) {
      console.error("Error fetching report:", error);
      toast.error("שגיאה בטעינת הנתונים. נסה שוב.");
    } finally {
      setIsLoading(false);
    }
  }, [buildQueryString, setOptions]);

  // Initial load
  useEffect(() => {
    if (session && (userRole === "super_user" || userRole === "admin")) {
      fetchReport();
    }
  }, [session, userRole, fetchReport]);

  // Handle filter apply
  const handleApplyFilters = () => {
    fetchReport();
  };

  // Handle filter reset
  const handleResetFilters = () => {
    resetFilters();
    fetchReport();
  };

  // Build summary cards
  const summaryCards: SummaryCardData[] = report
    ? [
        {
          title: "סה״כ עמלות",
          value: formatCurrency(report.summary.totalCommissionAmount),
          subtitle: `${report.summary.totalCommissions} רשומות`,
          icon: DollarSign,
        },
        {
          title: "סה״כ ברוטו",
          value: formatCurrency(report.summary.totalGrossAmount),
          subtitle: `נטו: ${formatCurrency(report.summary.totalNetAmount)}`,
          icon: DollarSign,
        },
        {
          title: "שיעור עמלה ממוצע",
          value: formatPercent(report.summary.avgCommissionRate),
          subtitle: "ממוצע כל העמלות",
          icon: Percent,
        },
        {
          title: "טווח תקופה",
          value:
            report.summary.periodRange.startDate && report.summary.periodRange.endDate
              ? formatDateRange(report.summary.periodRange.startDate, report.summary.periodRange.endDate)
              : "לא זמין",
          subtitle: `הופק: ${formatDateHe(report.summary.generatedAt)}`,
          icon: Calendar,
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

  if (!session) {
    return null;
  }

  return (
    <ReportLayout
      title="דוח עמלות רשת"
      description="סיכום עמלות כולל עם פירוט לפי מותג ותקופה"
      breadcrumbs={[
        { label: "ניהול", href: "/admin" },
        { label: "דוחות", href: "/admin/reports" },
        { label: "עמלות" },
      ]}
      isLoading={isLoading}
      onRefresh={fetchReport}
      actions={
        <ReportExportButton
          endpoints={{
            excel: "/api/commissions/report/export",
            pdf: "/api/commissions/report/export-pdf",
          }}
          queryString={buildQueryString()}
          reportType="commission"
          disabled={!report}
        />
      }
    >
      {/* Filters */}
      <ReportFilters
        filters={filters}
        onFilterChange={updateFilter}
        onPeriodChange={updatePeriod}
        onApply={handleApplyFilters}
        onReset={handleResetFilters}
        brands={options.brands}
        suppliers={options.suppliers}
        statusOptions={commissionStatusOptions}
        showPeriodSelector={true}
        showFranchiseeFilter={false}
        isLoading={isLoading}
        activeFilterCount={activeFilterCount}
      />

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

          {/* Tabs for different views */}
          <Tabs defaultValue="byBrand" className="w-full" dir="rtl">
            <TabsList className="flex w-full gap-1">
              <TabsTrigger value="byBrand" className="flex items-center gap-2">
                <Building2 className="h-4 w-4" />
                לפי מותג
              </TabsTrigger>
              <TabsTrigger value="byPeriod" className="flex items-center gap-2">
                <Calendar className="h-4 w-4" />
                לפי תקופה
              </TabsTrigger>
              <TabsTrigger value="bySupplier" className="flex items-center gap-2">
                <Users className="h-4 w-4" />
                לפי ספק
              </TabsTrigger>
              <TabsTrigger value="details" className="flex items-center gap-2">
                <Store className="h-4 w-4" />
                פירוט מלא
              </TabsTrigger>
            </TabsList>

            {/* By Brand Tab */}
            <TabsContent value="byBrand">
              <Card>
                <CardHeader>
                  <CardTitle>סיכום לפי מותג</CardTitle>
                  <CardDescription>פירוט עמלות מקובץ לפי מותג</CardDescription>
                </CardHeader>
                <CardContent>
                  <ReportDataTable
                    data={report.byBrand}
                    columns={brandColumns}
                    rowKey="brandId"
                    enableSearch={false}
                    enablePagination={false}
                    emptyMessage="אין נתונים להצגה"
                  />
                </CardContent>
              </Card>
            </TabsContent>

            {/* By Period Tab */}
            <TabsContent value="byPeriod">
              <Card>
                <CardHeader>
                  <CardTitle>סיכום לפי תקופה</CardTitle>
                  <CardDescription>פירוט עמלות מקובץ לפי תקופת התחשבנות</CardDescription>
                </CardHeader>
                <CardContent>
                  <ReportDataTable
                    data={report.byPeriod}
                    columns={periodColumns}
                    rowKey={(row) => `${row.periodStartDate}-${row.periodEndDate}`}
                    enableSearch={false}
                    enablePagination={false}
                    emptyMessage="אין נתונים להצגה"
                  />
                </CardContent>
              </Card>
            </TabsContent>

            {/* By Supplier Tab */}
            <TabsContent value="bySupplier">
              <Card>
                <CardHeader>
                  <CardTitle>סיכום לפי ספק</CardTitle>
                  <CardDescription>פירוט עמלות מקובץ לפי ספק</CardDescription>
                </CardHeader>
                <CardContent>
                  <ReportDataTable
                    data={report.bySupplier}
                    columns={supplierColumns}
                    rowKey="supplierId"
                    enablePagination={report.bySupplier.length > 25}
                    emptyMessage="אין נתונים להצגה"
                  />
                </CardContent>
              </Card>
            </TabsContent>

            {/* Details Tab */}
            <TabsContent value="details">
              <Card>
                <CardHeader>
                  <CardTitle>פירוט מלא</CardTitle>
                  <CardDescription>כל רשומות העמלות בפירוט מלא</CardDescription>
                </CardHeader>
                <CardContent>
                  <ReportDataTable
                    data={report.details}
                    columns={detailColumns}
                    rowKey="id"
                    searchPlaceholder="חיפוש לפי ספק, זכיין או מותג..."
                    emptyMessage="אין נתונים להצגה"
                  />
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </>
      )}
    </ReportLayout>
  );
}
