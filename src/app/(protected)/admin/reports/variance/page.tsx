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
  Loader2,
  Users,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  ArrowUpDown,
  Calendar,
} from "lucide-react";
import {
  ReportLayout,
  ReportSummaryCards,
  ReportDataTable,
  ExcelExportButton,
  ReportPeriodSelector,
  type ColumnDef,
  type SummaryCardData,
} from "@/components/reports";
import type { SettlementPeriodType } from "@/db/schema";
import {
  getPeriodByKey,
  getPeriodsForFrequency,
} from "@/lib/settlement-periods";
import { formatCurrency, formatPercent, formatDateHe } from "@/lib/report-utils";
import { toast } from "sonner";

// ============================================================================
// TYPES
// ============================================================================

interface SupplierVarianceData {
  supplierId: string;
  supplierName: string;
  supplierCode: string;
  currentPeriod: {
    totalGrossAmount: number;
    purchasePercentage: number;
  };
  previousPeriod: {
    totalGrossAmount: number;
    purchasePercentage: number;
  };
  variance: number;
  variancePercent: number;
  isFlagged: boolean;
}

interface VarianceReport {
  summary: {
    totalSuppliers: number;
    flaggedSuppliers: number;
    totalCurrentGross: number;
    totalPreviousGross: number;
    currentPeriod: { startDate: string; endDate: string };
    previousPeriod: { startDate: string; endDate: string };
    varianceThreshold: number;
    generatedAt: string;
  };
  suppliers: SupplierVarianceData[];
  flaggedOnly: SupplierVarianceData[];
}

interface FilterOption {
  id: string;
  nameHe?: string;
  nameEn?: string | null;
}

// ============================================================================
// HELPERS
// ============================================================================

const getDefaultDates = () => {
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth();

  return {
    currentStartDate: new Date(currentYear, currentMonth, 1).toISOString().split("T")[0],
    currentEndDate: new Date(currentYear, currentMonth + 1, 0).toISOString().split("T")[0],
    previousStartDate: new Date(currentYear, currentMonth - 1, 1).toISOString().split("T")[0],
    previousEndDate: new Date(currentYear, currentMonth, 0).toISOString().split("T")[0],
  };
};

const getTrendIcon = (variancePercent: number) => {
  if (variancePercent > 0) return <TrendingUp className="h-4 w-4 text-emerald-500 dark:text-emerald-400" />;
  if (variancePercent < 0) return <TrendingDown className="h-4 w-4 text-rose-500 dark:text-rose-400" />;
  return null;
};

// ============================================================================
// COLUMN DEFINITIONS
// ============================================================================

const allSuppliersColumns: ColumnDef<SupplierVarianceData>[] = [
  { id: "supplierName", header: "ספק", accessorKey: "supplierName", className: "font-medium" },
  { id: "supplierCode", header: "קוד", accessorKey: "supplierCode" },
  {
    id: "currentGross",
    header: "רכישות נוכחי",
    accessor: (row) => formatCurrency(row.currentPeriod.totalGrossAmount),
    accessorKey: "currentPeriod",
    sortable: false,
  },
  {
    id: "currentPercent",
    header: "% נוכחי",
    accessor: (row) => formatPercent(row.currentPeriod.purchasePercentage),
    sortable: false,
  },
  {
    id: "previousGross",
    header: "רכישות קודם",
    accessor: (row) => formatCurrency(row.previousPeriod.totalGrossAmount),
    sortable: false,
  },
  {
    id: "previousPercent",
    header: "% קודם",
    accessor: (row) => formatPercent(row.previousPeriod.purchasePercentage),
    sortable: false,
  },
  {
    id: "variance",
    header: "סטייה",
    accessor: (row) => formatPercent(row.variance),
    cell: (row) => (
      <span className={row.isFlagged ? "font-bold text-rose-600 dark:text-rose-400" : ""}>
        {formatPercent(row.variance)}
      </span>
    ),
    accessorKey: "variance",
  },
  {
    id: "status",
    header: "סטטוס",
    cell: (row) =>
      row.isFlagged ? (
        <Badge variant="destructive" className="flex items-center gap-1 w-fit">
          <AlertTriangle className="h-3 w-3" />
          חריג
        </Badge>
      ) : (
        <Badge variant="secondary">תקין</Badge>
      ),
    accessorKey: "isFlagged",
  },
];

const flaggedColumns: ColumnDef<SupplierVarianceData>[] = [
  { id: "supplierName", header: "ספק", accessorKey: "supplierName", className: "font-medium" },
  { id: "supplierCode", header: "קוד", accessorKey: "supplierCode" },
  {
    id: "currentPercent",
    header: "% נוכחי",
    accessor: (row) => formatPercent(row.currentPeriod.purchasePercentage),
  },
  {
    id: "previousPercent",
    header: "% קודם",
    accessor: (row) => formatPercent(row.previousPeriod.purchasePercentage),
  },
  {
    id: "variance",
    header: "סטייה",
    cell: (row) => <span className="font-bold text-rose-600 dark:text-rose-400">{formatPercent(row.variance)}</span>,
    accessorKey: "variance",
  },
  {
    id: "change",
    header: "שינוי",
    cell: (row) => (
      <span className="flex items-center gap-1">
        {getTrendIcon(row.variancePercent)}
        {formatPercent(row.variancePercent)}
      </span>
    ),
  },
  {
    id: "status",
    header: "סטטוס",
    cell: () => (
      <Badge variant="destructive" className="flex items-center gap-1 w-fit">
        <AlertTriangle className="h-3 w-3" />
        חריג
      </Badge>
    ),
  },
];

// ============================================================================
// COMPONENT
// ============================================================================

export default function VarianceReportPage() {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const [report, setReport] = useState<VarianceReport | null>(null);
  const [brands, setBrands] = useState<FilterOption[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const defaultDates = getDefaultDates();
  const [currentStartDate, setCurrentStartDate] = useState(defaultDates.currentStartDate);
  const [currentEndDate, setCurrentEndDate] = useState(defaultDates.currentEndDate);
  const [previousStartDate, setPreviousStartDate] = useState(defaultDates.previousStartDate);
  const [previousEndDate, setPreviousEndDate] = useState(defaultDates.previousEndDate);
  const [selectedBrand, setSelectedBrand] = useState("");
  const [varianceThreshold, setVarianceThreshold] = useState("10");

  // Period selection state
  const [currentPeriodType, setCurrentPeriodType] = useState<SettlementPeriodType | "">("");
  const [currentPeriodKey, setCurrentPeriodKey] = useState("");
  const [previousPeriodType, setPreviousPeriodType] = useState<SettlementPeriodType | "">("");
  const [previousPeriodKey, setPreviousPeriodKey] = useState("");
  const [useCustomCurrentRange, setUseCustomCurrentRange] = useState(true);
  const [useCustomPreviousRange, setUseCustomPreviousRange] = useState(true);

  const { data: session, isPending } = authClient.useSession();
  const userRole = session ? (session.user as { role?: string })?.role : undefined;

  // Redirect if not authenticated or not admin
  useEffect(() => {
    if (!isPending && !session) {
      router.push("/sign-in?redirect=/admin/reports/variance");
      return;
    }
    if (!isPending && session?.user && userRole !== "super_user" && userRole !== "admin") {
      router.push("/dashboard");
    }
  }, [isPending, session, userRole, router]);

  // Build query string
  const buildQueryString = useCallback(() => {
    const params = new URLSearchParams();
    params.set("currentStartDate", currentStartDate);
    params.set("currentEndDate", currentEndDate);
    params.set("previousStartDate", previousStartDate);
    params.set("previousEndDate", previousEndDate);
    if (selectedBrand && selectedBrand !== "all") params.set("brandId", selectedBrand);
    params.set("varianceThreshold", varianceThreshold);
    return params.toString();
  }, [currentStartDate, currentEndDate, previousStartDate, previousEndDate, selectedBrand, varianceThreshold]);

  // Fetch report
  const fetchReport = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const queryString = buildQueryString();
      const response = await fetch(`/api/commissions/variance?${queryString}`);
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to fetch report");
      }
      const data = await response.json();
      setReport(data.report);
      setBrands(data.filters.brands);
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

  // Handle current period change
  const handleCurrentPeriodChange = (newPeriodType: SettlementPeriodType | "", newPeriodKey: string) => {
    setCurrentPeriodType(newPeriodType);
    setCurrentPeriodKey(newPeriodKey);
    setUseCustomCurrentRange(!newPeriodType);

    if (newPeriodKey && newPeriodType) {
      const period = getPeriodByKey(newPeriodKey);
      if (period) {
        setCurrentStartDate(period.startDate.toISOString().split("T")[0]);
        setCurrentEndDate(period.endDate.toISOString().split("T")[0]);

        // Auto-select previous period of the same type
        const previousPeriods = getPeriodsForFrequency(newPeriodType, period.startDate, 2);
        if (previousPeriods.length > 0) {
          const prevPeriod = previousPeriods[0]; // Get the previous period
          setPreviousPeriodType(newPeriodType);
          setPreviousPeriodKey(prevPeriod.key);
          setPreviousStartDate(prevPeriod.startDate.toISOString().split("T")[0]);
          setPreviousEndDate(prevPeriod.endDate.toISOString().split("T")[0]);
          setUseCustomPreviousRange(false);
        }
      }
    }
  };

  // Handle previous period change
  const handlePreviousPeriodChange = (newPeriodType: SettlementPeriodType | "", newPeriodKey: string) => {
    setPreviousPeriodType(newPeriodType);
    setPreviousPeriodKey(newPeriodKey);
    setUseCustomPreviousRange(!newPeriodType);

    if (newPeriodKey) {
      const period = getPeriodByKey(newPeriodKey);
      if (period) {
        setPreviousStartDate(period.startDate.toISOString().split("T")[0]);
        setPreviousEndDate(period.endDate.toISOString().split("T")[0]);
      }
    }
  };

  // Handle preset periods
  const handlePresetPeriod = (preset: "month" | "quarter" | "year") => {
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth();

    switch (preset) {
      case "month":
        setCurrentStartDate(new Date(currentYear, currentMonth, 1).toISOString().split("T")[0]);
        setCurrentEndDate(new Date(currentYear, currentMonth + 1, 0).toISOString().split("T")[0]);
        setPreviousStartDate(new Date(currentYear, currentMonth - 1, 1).toISOString().split("T")[0]);
        setPreviousEndDate(new Date(currentYear, currentMonth, 0).toISOString().split("T")[0]);
        break;
      case "quarter":
        const currentQuarter = Math.floor(currentMonth / 3);
        setCurrentStartDate(new Date(currentYear, currentQuarter * 3, 1).toISOString().split("T")[0]);
        setCurrentEndDate(new Date(currentYear, currentQuarter * 3 + 3, 0).toISOString().split("T")[0]);
        setPreviousStartDate(new Date(currentYear, (currentQuarter - 1) * 3, 1).toISOString().split("T")[0]);
        setPreviousEndDate(new Date(currentYear, currentQuarter * 3, 0).toISOString().split("T")[0]);
        break;
      case "year":
        setCurrentStartDate(new Date(currentYear, 0, 1).toISOString().split("T")[0]);
        setCurrentEndDate(new Date(currentYear, currentMonth + 1, 0).toISOString().split("T")[0]);
        setPreviousStartDate(new Date(currentYear - 1, 0, 1).toISOString().split("T")[0]);
        setPreviousEndDate(new Date(currentYear - 1, currentMonth + 1, 0).toISOString().split("T")[0]);
        break;
    }
  };

  // Summary cards
  const summaryCards: SummaryCardData[] = report
    ? [
        { title: "סה״כ ספקים", value: report.summary.totalSuppliers, subtitle: "ספקים פעילים", icon: Users },
        {
          title: "ספקים עם סטייה",
          value: report.summary.flaggedSuppliers,
          subtitle: `סטייה מעל ${report.summary.varianceThreshold}%`,
          icon: AlertTriangle,
          variant: report.summary.flaggedSuppliers > 0 ? "danger" : "default",
        },
        {
          title: "רכישות נוכחי",
          value: formatCurrency(report.summary.totalCurrentGross),
          subtitle: `${formatDateHe(report.summary.currentPeriod.startDate)} - ${formatDateHe(report.summary.currentPeriod.endDate)}`,
          icon: TrendingUp,
        },
        {
          title: "רכישות קודם",
          value: formatCurrency(report.summary.totalPreviousGross),
          subtitle: `${formatDateHe(report.summary.previousPeriod.startDate)} - ${formatDateHe(report.summary.previousPeriod.endDate)}`,
          icon: ArrowUpDown,
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
      title="דוח סטיות רכש ספקים"
      description="השוואת אחוזי רכש בין תקופות וזיהוי סטיות חריגות"
      breadcrumbs={[
        { label: "ניהול", href: "/admin" },
        { label: "דוחות", href: "/admin/reports" },
        { label: "סטיות רכש" },
      ]}
      isLoading={isLoading}
      onRefresh={fetchReport}
      actions={
        <ExcelExportButton
          endpoint="/api/commissions/variance/export"
          queryString={buildQueryString()}
          reportType="variance"
          disabled={!report}
        />
      }
    >
      {/* Filters Card */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">סינון</CardTitle>
          <CardDescription>בחר תקופות להשוואה וסף סטייה</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Preset buttons */}
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => handlePresetPeriod("month")}>
              חודש מול קודם
            </Button>
            <Button variant="outline" size="sm" onClick={() => handlePresetPeriod("quarter")}>
              רבעון מול קודם
            </Button>
            <Button variant="outline" size="sm" onClick={() => handlePresetPeriod("year")}>
              שנה מול קודמת
            </Button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Current Period */}
            <div className="space-y-3 p-4 border rounded-lg bg-muted/50">
              <h4 className="font-medium flex items-center gap-2">
                <Calendar className="h-4 w-4" />
                תקופה נוכחית
              </h4>
              <ReportPeriodSelector
                periodType={currentPeriodType}
                periodKey={currentPeriodKey}
                onChange={handleCurrentPeriodChange}
                onCustomRangeSelect={() => setUseCustomCurrentRange(true)}
                showCustomRange={true}
                layout="vertical"
                showLabels={true}
              />
              {useCustomCurrentRange && (
                <div className="grid grid-cols-2 gap-3 pt-2">
                  <div className="space-y-2">
                    <Label htmlFor="currentStartDate">מתאריך</Label>
                    <Input
                      id="currentStartDate"
                      type="date"
                      value={currentStartDate}
                      onChange={(e) => setCurrentStartDate(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="currentEndDate">עד תאריך</Label>
                    <Input
                      id="currentEndDate"
                      type="date"
                      value={currentEndDate}
                      onChange={(e) => setCurrentEndDate(e.target.value)}
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Previous Period */}
            <div className="space-y-3 p-4 border rounded-lg bg-muted/50">
              <h4 className="font-medium flex items-center gap-2">
                <Calendar className="h-4 w-4" />
                תקופה קודמת
              </h4>
              <ReportPeriodSelector
                periodType={previousPeriodType}
                periodKey={previousPeriodKey}
                onChange={handlePreviousPeriodChange}
                onCustomRangeSelect={() => setUseCustomPreviousRange(true)}
                showCustomRange={true}
                layout="vertical"
                showLabels={true}
              />
              {useCustomPreviousRange && (
                <div className="grid grid-cols-2 gap-3 pt-2">
                  <div className="space-y-2">
                    <Label htmlFor="previousStartDate">מתאריך</Label>
                    <Input
                      id="previousStartDate"
                      type="date"
                      value={previousStartDate}
                      onChange={(e) => setPreviousStartDate(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="previousEndDate">עד תאריך</Label>
                    <Input
                      id="previousEndDate"
                      type="date"
                      value={previousEndDate}
                      onChange={(e) => setPreviousEndDate(e.target.value)}
                    />
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label htmlFor="brand">מותג</Label>
              <Select value={selectedBrand} onValueChange={setSelectedBrand}>
                <SelectTrigger id="brand">
                  <SelectValue placeholder="כל המותגים" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">כל המותגים</SelectItem>
                  {brands.map((brand) => (
                    <SelectItem key={brand.id} value={brand.id}>
                      {brand.nameHe}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="threshold">סף סטייה</Label>
              <Select value={varianceThreshold} onValueChange={setVarianceThreshold}>
                <SelectTrigger id="threshold">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="5">5%</SelectItem>
                  <SelectItem value="10">10% (ברירת מחדל)</SelectItem>
                  <SelectItem value="15">15%</SelectItem>
                  <SelectItem value="20">20%</SelectItem>
                  <SelectItem value="25">25%</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end">
              <Button onClick={fetchReport} disabled={isLoading} className="w-full">
                {isLoading && <Loader2 className="h-4 w-4 me-2 animate-spin" />}
                הפק דוח
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Error State */}
      {error && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
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

          {/* Flagged Suppliers Alert */}
          {report.summary.flaggedSuppliers > 0 && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>זוהו סטיות חריגות</AlertTitle>
              <AlertDescription>
                {report.summary.flaggedSuppliers} ספקים עם סטיית רכש מעל {report.summary.varianceThreshold}%
              </AlertDescription>
            </Alert>
          )}

          {/* Tabs */}
          <Tabs defaultValue="flagged" className="w-full" dir="rtl">
            <TabsList className="flex w-full gap-1">
              <TabsTrigger value="flagged" className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4" />
                ספקים חריגים ({report.flaggedOnly.length})
              </TabsTrigger>
              <TabsTrigger value="all" className="flex items-center gap-2">
                <Users className="h-4 w-4" />
                כל הספקים ({report.suppliers.length})
              </TabsTrigger>
            </TabsList>

            <TabsContent value="flagged">
              <Card>
                <CardHeader>
                  <CardTitle>ספקים עם סטייה חריגה</CardTitle>
                  <CardDescription>
                    ספקים עם סטיית רכש מעל {report.summary.varianceThreshold}%
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {report.flaggedOnly.length === 0 ? (
                    <div className="text-center py-8">
                      <AlertTriangle className="h-12 w-12 mx-auto text-emerald-500 dark:text-emerald-400 mb-4" />
                      <h3 className="text-lg font-medium mb-2">לא זוהו סטיות חריגות</h3>
                      <p className="text-muted-foreground">
                        כל הספקים בטווח סטייה תקין (פחות מ-{report.summary.varianceThreshold}%)
                      </p>
                    </div>
                  ) : (
                    <ReportDataTable
                      data={report.flaggedOnly}
                      columns={flaggedColumns}
                      rowKey="supplierId"
                      enablePagination={report.flaggedOnly.length > 25}
                    />
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="all">
              <Card>
                <CardHeader>
                  <CardTitle>כל הספקים</CardTitle>
                  <CardDescription>השוואת רכישות לכל הספקים</CardDescription>
                </CardHeader>
                <CardContent>
                  <ReportDataTable
                    data={report.suppliers}
                    columns={allSuppliersColumns}
                    rowKey="supplierId"
                    searchPlaceholder="חיפוש ספק..."
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
