"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert";
import {
  RefreshCw,
  FileSpreadsheet,
  Loader2,
  Calendar,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  Users,
  ChevronLeft,
  ArrowUpDown,
} from "lucide-react";
import Link from "next/link";
import { he } from "@/lib/translations/he";

// Translation constants
const t = he.admin.commissions.variance;

// Types matching the API response
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
    currentPeriod: {
      startDate: string;
      endDate: string;
    };
    previousPeriod: {
      startDate: string;
      endDate: string;
    };
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

// Format currency in ILS
const formatCurrency = (amount: number): string => {
  return new Intl.NumberFormat("he-IL", {
    style: "currency",
    currency: "ILS",
    minimumFractionDigits: 2,
  }).format(amount);
};

// Format percentage
const formatPercent = (rate: number): string => {
  return `${rate.toFixed(2)}%`;
};

// Format date for display
const formatDate = (dateStr: string): string => {
  if (!dateStr) return "";
  return new Date(dateStr).toLocaleDateString("he-IL");
};

// Get default dates (current month and previous month)
const getDefaultDates = () => {
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth();

  // Current period: current month
  const currentStartDate = new Date(currentYear, currentMonth, 1)
    .toISOString()
    .split("T")[0];
  const currentEndDate = new Date(currentYear, currentMonth + 1, 0)
    .toISOString()
    .split("T")[0];

  // Previous period: previous month
  const previousStartDate = new Date(currentYear, currentMonth - 1, 1)
    .toISOString()
    .split("T")[0];
  const previousEndDate = new Date(currentYear, currentMonth, 0)
    .toISOString()
    .split("T")[0];

  return {
    currentStartDate,
    currentEndDate,
    previousStartDate,
    previousEndDate,
  };
};

// Get variance badge
const getVarianceBadge = (supplier: SupplierVarianceData) => {
  if (supplier.isFlagged) {
    return (
      <Badge variant="destructive" className="flex items-center gap-1">
        <AlertTriangle className="h-3 w-3" />
        {t.statuses.flagged}
      </Badge>
    );
  }
  return <Badge variant="secondary">{t.statuses.normal}</Badge>;
};

// Get trend icon
const getTrendIcon = (variancePercent: number) => {
  if (variancePercent > 0) {
    return <TrendingUp className="h-4 w-4 text-green-500" />;
  } else if (variancePercent < 0) {
    return <TrendingDown className="h-4 w-4 text-red-500" />;
  }
  return null;
};

export default function VarianceReportPage() {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [report, setReport] = useState<VarianceReport | null>(null);
  const [brands, setBrands] = useState<FilterOption[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Filters - default to current and previous month
  const defaultDates = getDefaultDates();
  const [currentStartDate, setCurrentStartDate] = useState<string>(
    defaultDates.currentStartDate
  );
  const [currentEndDate, setCurrentEndDate] = useState<string>(
    defaultDates.currentEndDate
  );
  const [previousStartDate, setPreviousStartDate] = useState<string>(
    defaultDates.previousStartDate
  );
  const [previousEndDate, setPreviousEndDate] = useState<string>(
    defaultDates.previousEndDate
  );
  const [selectedBrand, setSelectedBrand] = useState<string>("");
  const [varianceThreshold, setVarianceThreshold] = useState<string>("10");

  const { data: session, isPending } = authClient.useSession();
  const userRole = session
    ? (session.user as { role?: string })?.role
    : undefined;

  // Redirect if not authenticated or not admin
  useEffect(() => {
    if (!isPending && !session) {
      router.push("/sign-in?redirect=/admin/commissions/variance");
      return;
    }

    if (
      !isPending &&
      session?.user &&
      userRole !== "super_user" &&
      userRole !== "admin"
    ) {
      router.push("/dashboard");
    }
  }, [isPending, session, userRole, router]);

  // Build query string from filters
  const buildQueryString = useCallback(() => {
    const params = new URLSearchParams();
    params.set("currentStartDate", currentStartDate);
    params.set("currentEndDate", currentEndDate);
    params.set("previousStartDate", previousStartDate);
    params.set("previousEndDate", previousEndDate);
    if (selectedBrand && selectedBrand !== "all") {
      params.set("brandId", selectedBrand);
    }
    params.set("varianceThreshold", varianceThreshold);
    return params.toString();
  }, [
    currentStartDate,
    currentEndDate,
    previousStartDate,
    previousEndDate,
    selectedBrand,
    varianceThreshold,
  ]);

  // Fetch report data
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
      console.error("Error fetching report:", err);
      setError(err instanceof Error ? err.message : "Failed to fetch report");
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

  // Handle export to Excel
  const handleExport = async () => {
    setIsExporting(true);
    try {
      const queryString = buildQueryString();
      const response = await fetch(
        `/api/commissions/variance/export?${queryString}`
      );

      if (!response.ok) {
        throw new Error("Failed to export report");
      }

      // Download the file
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `variance_report_${new Date().toISOString().split("T")[0]}.xlsx`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (err) {
      console.error("Error exporting report:", err);
    } finally {
      setIsExporting(false);
    }
  };

  // Handle filter apply
  const handleApplyFilters = () => {
    fetchReport();
  };

  // Handle preset periods
  const handlePresetPeriod = (preset: string) => {
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth();

    switch (preset) {
      case "month":
        // Current vs previous month
        setCurrentStartDate(
          new Date(currentYear, currentMonth, 1).toISOString().split("T")[0]
        );
        setCurrentEndDate(
          new Date(currentYear, currentMonth + 1, 0).toISOString().split("T")[0]
        );
        setPreviousStartDate(
          new Date(currentYear, currentMonth - 1, 1).toISOString().split("T")[0]
        );
        setPreviousEndDate(
          new Date(currentYear, currentMonth, 0).toISOString().split("T")[0]
        );
        break;
      case "quarter":
        // Current vs previous quarter
        const currentQuarter = Math.floor(currentMonth / 3);
        setCurrentStartDate(
          new Date(currentYear, currentQuarter * 3, 1)
            .toISOString()
            .split("T")[0]
        );
        setCurrentEndDate(
          new Date(currentYear, currentQuarter * 3 + 3, 0)
            .toISOString()
            .split("T")[0]
        );
        setPreviousStartDate(
          new Date(currentYear, (currentQuarter - 1) * 3, 1)
            .toISOString()
            .split("T")[0]
        );
        setPreviousEndDate(
          new Date(currentYear, currentQuarter * 3, 0)
            .toISOString()
            .split("T")[0]
        );
        break;
      case "year":
        // Current vs previous year (same period last year)
        setCurrentStartDate(new Date(currentYear, 0, 1).toISOString().split("T")[0]);
        setCurrentEndDate(
          new Date(currentYear, currentMonth + 1, 0).toISOString().split("T")[0]
        );
        setPreviousStartDate(
          new Date(currentYear - 1, 0, 1).toISOString().split("T")[0]
        );
        setPreviousEndDate(
          new Date(currentYear - 1, currentMonth + 1, 0)
            .toISOString()
            .split("T")[0]
        );
        break;
    }
  };

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
    <div className="container mx-auto py-6 space-y-6" dir="rtl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <nav className="flex items-center space-x-1 space-x-reverse text-sm text-muted-foreground mb-2">
            <Link href="/admin" className="hover:text-foreground">
              {t.breadcrumb.admin}
            </Link>
            <ChevronLeft className="h-4 w-4 rtl-flip" />
            <Link href="/admin/commissions/report" className="hover:text-foreground">
              {t.breadcrumb.reports}
            </Link>
            <ChevronLeft className="h-4 w-4 rtl-flip" />
            <span className="text-foreground">{t.breadcrumb.variance}</span>
          </nav>
          <h1 className="text-3xl font-bold tracking-tight">
            {t.pageTitle}
          </h1>
          <p className="text-muted-foreground mt-1">
            {t.description}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={() => fetchReport()}
            disabled={isLoading}
          >
            <RefreshCw
              className={`h-4 w-4 ml-2 ${isLoading ? "animate-spin" : ""}`}
            />
            {t.actions.refresh}
          </Button>
          <Button
            onClick={handleExport}
            disabled={isExporting || !report}
            className="bg-green-600 hover:bg-green-700"
          >
            {isExporting ? (
              <Loader2 className="h-4 w-4 ml-2 animate-spin" />
            ) : (
              <FileSpreadsheet className="h-4 w-4 ml-2" />
            )}
            {t.actions.exportToExcel}
          </Button>
        </div>
      </div>

      {/* Filters Card */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">{t.filters.title}</CardTitle>
          <CardDescription>
            {t.filters.description}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Preset buttons */}
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => handlePresetPeriod("month")}
            >
              {t.presets.monthVsPrevious}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => handlePresetPeriod("quarter")}
            >
              {t.presets.quarterVsPrevious}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => handlePresetPeriod("year")}
            >
              {t.presets.yearVsPrevious}
            </Button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Current Period */}
            <div className="space-y-3 p-4 border rounded-lg bg-muted/50">
              <h4 className="font-medium flex items-center gap-2">
                <Calendar className="h-4 w-4" />
                {t.filters.currentPeriod}
              </h4>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="currentStartDate">{t.filters.fromDate}</Label>
                  <Input
                    id="currentStartDate"
                    type="date"
                    value={currentStartDate}
                    onChange={(e) => setCurrentStartDate(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="currentEndDate">{t.filters.toDate}</Label>
                  <Input
                    id="currentEndDate"
                    type="date"
                    value={currentEndDate}
                    onChange={(e) => setCurrentEndDate(e.target.value)}
                  />
                </div>
              </div>
            </div>

            {/* Previous Period */}
            <div className="space-y-3 p-4 border rounded-lg bg-muted/50">
              <h4 className="font-medium flex items-center gap-2">
                <Calendar className="h-4 w-4" />
                {t.filters.previousPeriod}
              </h4>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="previousStartDate">{t.filters.fromDate}</Label>
                  <Input
                    id="previousStartDate"
                    type="date"
                    value={previousStartDate}
                    onChange={(e) => setPreviousStartDate(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="previousEndDate">{t.filters.toDate}</Label>
                  <Input
                    id="previousEndDate"
                    type="date"
                    value={previousEndDate}
                    onChange={(e) => setPreviousEndDate(e.target.value)}
                  />
                </div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label htmlFor="brand">{t.filters.brand}</Label>
              <Select value={selectedBrand} onValueChange={setSelectedBrand}>
                <SelectTrigger id="brand">
                  <SelectValue placeholder={t.filters.allBrands} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t.filters.allBrands}</SelectItem>
                  {brands.map((brand) => (
                    <SelectItem key={brand.id} value={brand.id}>
                      {brand.nameHe}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="threshold">{t.filters.threshold}</Label>
              <Select
                value={varianceThreshold}
                onValueChange={setVarianceThreshold}
              >
                <SelectTrigger id="threshold">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="5">5%</SelectItem>
                  <SelectItem value="10">{t.filters.thresholdDefault}</SelectItem>
                  <SelectItem value="15">15%</SelectItem>
                  <SelectItem value="20">20%</SelectItem>
                  <SelectItem value="25">25%</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end">
              <Button onClick={handleApplyFilters} disabled={isLoading} className="w-full">
                {isLoading && <Loader2 className="h-4 w-4 ml-2 animate-spin" />}
                {t.actions.generateReport}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Error State */}
      {error && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>{t.errors.title}</AlertTitle>
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
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">
                  {t.summary.totalSuppliers}
                </CardTitle>
                <Users className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {report.summary.totalSuppliers}
                </div>
                <p className="text-xs text-muted-foreground">
                  {t.summary.activeSuppliers}
                </p>
              </CardContent>
            </Card>

            <Card className={report.summary.flaggedSuppliers > 0 ? "border-red-500" : ""}>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">
                  {t.summary.suppliersWithVariance}
                </CardTitle>
                <AlertTriangle
                  className={`h-4 w-4 ${
                    report.summary.flaggedSuppliers > 0
                      ? "text-red-500"
                      : "text-muted-foreground"
                  }`}
                />
              </CardHeader>
              <CardContent>
                <div
                  className={`text-2xl font-bold ${
                    report.summary.flaggedSuppliers > 0 ? "text-red-500" : ""
                  }`}
                >
                  {report.summary.flaggedSuppliers}
                </div>
                <p className="text-xs text-muted-foreground">
                  {t.summary.varianceAbove.replace("{threshold}", String(report.summary.varianceThreshold))}
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">
                  {t.summary.currentPurchases}
                </CardTitle>
                <TrendingUp className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {formatCurrency(report.summary.totalCurrentGross)}
                </div>
                <p className="text-xs text-muted-foreground">
                  {formatDate(report.summary.currentPeriod.startDate)} -{" "}
                  {formatDate(report.summary.currentPeriod.endDate)}
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">
                  {t.summary.previousPurchases}
                </CardTitle>
                <ArrowUpDown className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {formatCurrency(report.summary.totalPreviousGross)}
                </div>
                <p className="text-xs text-muted-foreground">
                  {formatDate(report.summary.previousPeriod.startDate)} -{" "}
                  {formatDate(report.summary.previousPeriod.endDate)}
                </p>
              </CardContent>
            </Card>
          </div>

          {/* Flagged Suppliers Alert */}
          {report.summary.flaggedSuppliers > 0 && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>{t.alerts.varianceDetected}</AlertTitle>
              <AlertDescription>
                {t.alerts.varianceDescription
                  .replace("{count}", String(report.summary.flaggedSuppliers))
                  .replace("{threshold}", String(report.summary.varianceThreshold))}
              </AlertDescription>
            </Alert>
          )}

          {/* Tabs for different views */}
          <Tabs defaultValue="flagged" className="w-full">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="flagged" className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4" />
                {t.tabs.flagged} ({report.flaggedOnly.length})
              </TabsTrigger>
              <TabsTrigger value="all" className="flex items-center gap-2">
                <Users className="h-4 w-4" />
                {t.tabs.all} ({report.suppliers.length})
              </TabsTrigger>
            </TabsList>

            {/* Flagged Suppliers Tab */}
            <TabsContent value="flagged">
              <Card>
                <CardHeader>
                  <CardTitle>{t.table.flaggedTitle}</CardTitle>
                  <CardDescription>
                    {t.table.flaggedDescription.replace("{threshold}", String(report.summary.varianceThreshold))}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {report.flaggedOnly.length === 0 ? (
                    <div className="text-center py-8">
                      <AlertTriangle className="h-12 w-12 mx-auto text-green-500 mb-4" />
                      <h3 className="text-lg font-medium mb-2">
                        {t.alerts.noVariance}
                      </h3>
                      <p className="text-muted-foreground">
                        {t.alerts.noVarianceDescription.replace("{threshold}", String(report.summary.varianceThreshold))}
                      </p>
                    </div>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>{t.table.supplier}</TableHead>
                          <TableHead>{t.table.code}</TableHead>
                          <TableHead>{t.table.currentPercent}</TableHead>
                          <TableHead>{t.table.previousPercent}</TableHead>
                          <TableHead>{t.table.variance}</TableHead>
                          <TableHead>{t.table.change}</TableHead>
                          <TableHead>{t.table.status}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {report.flaggedOnly.map((supplier) => (
                          <TableRow
                            key={supplier.supplierId}
                            className="bg-red-50"
                          >
                            <TableCell className="font-medium">
                              {supplier.supplierName}
                            </TableCell>
                            <TableCell>{supplier.supplierCode}</TableCell>
                            <TableCell>
                              {formatPercent(
                                supplier.currentPeriod.purchasePercentage
                              )}
                            </TableCell>
                            <TableCell>
                              {formatPercent(
                                supplier.previousPeriod.purchasePercentage
                              )}
                            </TableCell>
                            <TableCell className="font-bold text-red-600">
                              {formatPercent(supplier.variance)}
                            </TableCell>
                            <TableCell className="flex items-center gap-1">
                              {getTrendIcon(supplier.variancePercent)}
                              {formatPercent(supplier.variancePercent)}
                            </TableCell>
                            <TableCell>
                              {getVarianceBadge(supplier)}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            {/* All Suppliers Tab */}
            <TabsContent value="all">
              <Card>
                <CardHeader>
                  <CardTitle>{t.table.allTitle}</CardTitle>
                  <CardDescription>
                    {t.table.allDescription}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {report.suppliers.length === 0 ? (
                    <p className="text-center text-muted-foreground py-8">
                      {t.table.noData}
                    </p>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>{t.table.supplier}</TableHead>
                          <TableHead>{t.table.code}</TableHead>
                          <TableHead>
                            {t.table.currentPurchases}
                          </TableHead>
                          <TableHead>{t.table.currentPercent}</TableHead>
                          <TableHead>{t.table.previousPurchases}</TableHead>
                          <TableHead>{t.table.previousPercent}</TableHead>
                          <TableHead>{t.table.variance}</TableHead>
                          <TableHead>{t.table.status}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {report.suppliers.map((supplier) => (
                          <TableRow
                            key={supplier.supplierId}
                            className={supplier.isFlagged ? "bg-red-50" : ""}
                          >
                            <TableCell className="font-medium">
                              {supplier.supplierName}
                            </TableCell>
                            <TableCell>{supplier.supplierCode}</TableCell>
                            <TableCell>
                              {formatCurrency(
                                supplier.currentPeriod.totalGrossAmount
                              )}
                            </TableCell>
                            <TableCell>
                              {formatPercent(
                                supplier.currentPeriod.purchasePercentage
                              )}
                            </TableCell>
                            <TableCell>
                              {formatCurrency(
                                supplier.previousPeriod.totalGrossAmount
                              )}
                            </TableCell>
                            <TableCell>
                              {formatPercent(
                                supplier.previousPeriod.purchasePercentage
                              )}
                            </TableCell>
                            <TableCell
                              className={
                                supplier.isFlagged
                                  ? "font-bold text-red-600"
                                  : ""
                              }
                            >
                              {formatPercent(supplier.variance)}
                            </TableCell>
                            <TableCell>
                              {getVarianceBadge(supplier)}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </>
      )}

      {/* Empty State */}
      {!isLoading && !report && !error && (
        <Card>
          <CardContent className="py-12 text-center">
            <FileSpreadsheet className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium mb-2">{t.emptyState.title}</h3>
            <p className="text-muted-foreground">
              {t.emptyState.description}
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
