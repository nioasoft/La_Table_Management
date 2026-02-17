"use client";

import { useEffect, useState, useCallback, Fragment } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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
  Loader2,
  Calendar,
  AlertCircle,
  Download,
  RefreshCw,
  Percent,
  TrendingUp,
  Coins,
  BarChart3,
  ChevronDown,
  ChevronLeft,
} from "lucide-react";
import { toast } from "sonner";
import { formatCurrency } from "@/lib/report-utils";

// ============================================================================
// TYPES
// ============================================================================

interface Brand {
  id: string;
  nameHe: string;
  nameEn: string | null;
}

interface SupplierBreakdownEntry {
  supplierName: string;
  supplierId: string | null;
  amount: number;
  transactionCount: number;
  isSmallSupplier: boolean;
}

interface RevenueBreakdownEntry {
  month: string;
  amount: number;
}

interface CommissionRevenueRow {
  franchiseeId: string;
  name: string;
  code: string;
  brandName: string;
  totalRevenue: number;
  totalSupplierPurchases: number;
  supplierPurchasesPercentage: number | null;
  supplierBreakdown: SupplierBreakdownEntry[];
  revenueBreakdown: RevenueBreakdownEntry[];
}

interface CommissionRevenueReport {
  rows: CommissionRevenueRow[];
  summary: {
    totalRevenue: number;
    totalSupplierPurchases: number;
    avgPercent: number;
    count: number;
  };
  year: number;
  startMonth: number;
  endMonth: number;
  brandId: string | null;
  brandName: string | null;
  generatedAt: string;
}

// ============================================================================
// CONSTANTS
// ============================================================================

const MONTH_NAMES_HE = [
  "ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני",
  "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר",
];

const MONTHS = MONTH_NAMES_HE.map((label, i) => ({
  value: String(i + 1),
  label,
}));

const currentYear = new Date().getFullYear();
const YEARS = Array.from({ length: 5 }, (_, i) => currentYear - 2 + i).map(
  (y) => ({
    value: y.toString(),
    label: y.toString(),
  })
);

const getCurrentQuarterStart = (): number => {
  const month = new Date().getMonth(); // 0-11
  return Math.floor(month / 3) * 3 + 1; // 1, 4, 7, 10
};

const getCurrentQuarterEnd = (): number => {
  return getCurrentQuarterStart() + 2; // 3, 6, 9, 12
};

const PRESETS = [
  { label: "שנתי", startMonth: 1, endMonth: 12 },
  { label: "Q1", startMonth: 1, endMonth: 3 },
  { label: "Q2", startMonth: 4, endMonth: 6 },
  { label: "Q3", startMonth: 7, endMonth: 9 },
  { label: "Q4", startMonth: 10, endMonth: 12 },
];

// ============================================================================
// COMPONENT
// ============================================================================

export default function CommissionRevenuePage() {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const [report, setReport] = useState<CommissionRevenueReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [expandedRow, setExpandedRow] = useState<string | null>(null);

  // Filter state
  const [selectedYear, setSelectedYear] = useState<string>(
    currentYear.toString()
  );
  const [selectedStartMonth, setSelectedStartMonth] = useState<number>(
    getCurrentQuarterStart()
  );
  const [selectedEndMonth, setSelectedEndMonth] = useState<number>(
    getCurrentQuarterEnd()
  );
  const [selectedBrandId, setSelectedBrandId] = useState<string>("all");

  const { data: session, isPending } = authClient.useSession();
  const userRole = session
    ? (session.user as { role?: string })?.role
    : undefined;

  // Redirect if not authenticated or not admin
  useEffect(() => {
    if (!isPending && !session) {
      router.push("/sign-in?redirect=/admin/reports/commission-revenue");
      return;
    }
    if (
      !isPending &&
      session?.user &&
      userRole !== "super_user" &&
      userRole !== "admin"
    ) {
      router.push("/dashboard");
      return;
    }
  }, [isPending, session, userRole, router]);

  // Fetch brands
  const fetchBrands = useCallback(async () => {
    try {
      const response = await fetch("/api/brands?filter=active");
      if (!response.ok) throw new Error("Failed to fetch brands");
      const data = await response.json();
      setBrands(data.brands || []);
    } catch (err) {
      console.error("Error fetching brands:", err);
      toast.error("שגיאה בטעינת רשימת המותגים");
    }
  }, []);

  useEffect(() => {
    if (session && (userRole === "super_user" || userRole === "admin")) {
      fetchBrands();
    }
  }, [session, userRole, fetchBrands]);

  // Fetch report data
  const fetchReport = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    setExpandedRow(null);
    try {
      const params = new URLSearchParams({
        year: selectedYear,
        startMonth: String(selectedStartMonth),
        endMonth: String(selectedEndMonth),
      });
      if (selectedBrandId && selectedBrandId !== "all") {
        params.append("brandId", selectedBrandId);
      }

      const response = await fetch(
        `/api/reports/commission-revenue?${params.toString()}`
      );
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "שגיאה בטעינת הדוח");
      }
      const data = await response.json();
      setReport(data.report);
    } catch (err) {
      console.error("Error fetching report:", err);
      const errorMessage =
        err instanceof Error ? err.message : "שגיאה בטעינת הדוח";
      setError(errorMessage);
      setReport(null);
      toast.error("שגיאה בטעינת הנתונים");
    } finally {
      setIsLoading(false);
    }
  }, [selectedYear, selectedStartMonth, selectedEndMonth, selectedBrandId]);

  // Export to Excel
  const handleExport = useCallback(async () => {
    if (!report || report.rows.length === 0) {
      toast.error("אין נתונים לייצוא");
      return;
    }

    try {
      const params = new URLSearchParams({
        year: selectedYear,
        startMonth: String(selectedStartMonth),
        endMonth: String(selectedEndMonth),
      });
      if (selectedBrandId && selectedBrandId !== "all") {
        params.append("brandId", selectedBrandId);
      }

      const response = await fetch(
        `/api/reports/commission-revenue/export?${params.toString()}`
      );
      if (!response.ok) {
        throw new Error("שגיאה בייצוא הדוח");
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const startLabel = `M${String(selectedStartMonth).padStart(2, "0")}`;
      const endLabel = `M${String(selectedEndMonth).padStart(2, "0")}`;
      const fileLabel =
        selectedStartMonth === selectedEndMonth
          ? startLabel
          : selectedStartMonth === 1 && selectedEndMonth === 12
            ? "annual"
            : `${startLabel}-${endLabel}`;
      a.download = `commission-revenue-${selectedYear}-${fileLabel}.xlsx`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      toast.success("הקובץ הורד בהצלחה");
    } catch (err) {
      console.error("Error exporting report:", err);
      toast.error("שגיאה בייצוא הדוח");
    }
  }, [report, selectedYear, selectedStartMonth, selectedEndMonth, selectedBrandId]);

  // Handle preset clicks
  const applyPreset = (startMonth: number, endMonth: number) => {
    setSelectedStartMonth(startMonth);
    setSelectedEndMonth(endMonth);
  };

  // Ensure endMonth >= startMonth when startMonth changes
  const handleStartMonthChange = (value: string) => {
    const m = parseInt(value, 10);
    setSelectedStartMonth(m);
    if (m > selectedEndMonth) {
      setSelectedEndMonth(m);
    }
  };

  // Ensure startMonth <= endMonth when endMonth changes
  const handleEndMonthChange = (value: string) => {
    const m = parseInt(value, 10);
    setSelectedEndMonth(m);
    if (m < selectedStartMonth) {
      setSelectedStartMonth(m);
    }
  };

  // Check which preset is currently active
  const activePreset = PRESETS.find(
    (p) => p.startMonth === selectedStartMonth && p.endMonth === selectedEndMonth
  );

  // Build period label for display
  const getPeriodLabel = () => {
    if (!report) return "";
    const { startMonth, endMonth, year } = report;
    if (startMonth === 1 && endMonth === 12) return `שנתי ${year}`;
    if (startMonth === endMonth)
      return `${MONTH_NAMES_HE[startMonth - 1]} ${year}`;
    return `${MONTH_NAMES_HE[startMonth - 1]}-${MONTH_NAMES_HE[endMonth - 1]} ${year}`;
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

  const hasData = report && report.rows.length > 0;
  const showMultiMonths = report && report.startMonth !== report.endMonth;

  return (
    <div className="container mx-auto space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">דוח אחוז קניות ממחזור</h1>
          <p className="text-muted-foreground">
            השוואת קניות מספקים מול מחזור זכיינים
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={fetchReport}
            disabled={isLoading}
          >
            <RefreshCw
              className={`me-2 h-4 w-4 ${isLoading ? "animate-spin" : ""}`}
            />
            רענון
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleExport}
            disabled={!hasData || isLoading}
          >
            <Download className="me-2 h-4 w-4" />
            ייצוא לאקסל
          </Button>
        </div>
      </div>

      {/* Filters Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calendar className="h-5 w-5" />
            בחירת תקופה
          </CardTitle>
          <CardDescription>בחר שנה וטווח חודשים להפקת הדוח</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-end gap-4">
            <div className="space-y-2">
              <Label>שנה</Label>
              <Select value={selectedYear} onValueChange={setSelectedYear}>
                <SelectTrigger className="w-32">
                  <SelectValue placeholder="בחר שנה" />
                </SelectTrigger>
                <SelectContent>
                  {YEARS.map((y) => (
                    <SelectItem key={y.value} value={y.value}>
                      {y.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>מחודש</Label>
              <Select
                value={String(selectedStartMonth)}
                onValueChange={handleStartMonthChange}
              >
                <SelectTrigger className="w-36">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MONTHS.map((m) => (
                    <SelectItem key={m.value} value={m.value}>
                      {m.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>עד חודש</Label>
              <Select
                value={String(selectedEndMonth)}
                onValueChange={handleEndMonthChange}
              >
                <SelectTrigger className="w-36">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MONTHS.map((m) => (
                    <SelectItem key={m.value} value={m.value}>
                      {m.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>מותג</Label>
              <Select
                value={selectedBrandId}
                onValueChange={setSelectedBrandId}
              >
                <SelectTrigger className="w-48">
                  <SelectValue placeholder="כל המותגים" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">כל המותגים</SelectItem>
                  {brands.map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      {b.nameHe}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <Button onClick={fetchReport} disabled={isLoading}>
              {isLoading ? (
                <Loader2 className="me-2 h-4 w-4 animate-spin" />
              ) : (
                <Percent className="me-2 h-4 w-4" />
              )}
              הפק דוח
            </Button>
          </div>

          {/* Quick presets */}
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">בחירה מהירה:</span>
            {PRESETS.map((preset) => (
              <Button
                key={preset.label}
                variant={activePreset?.label === preset.label ? "default" : "outline"}
                size="sm"
                onClick={() => applyPreset(preset.startMonth, preset.endMonth)}
              >
                {preset.label}
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Loading State */}
      {isLoading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      )}

      {/* Error State */}
      {error && !isLoading && (
        <Card className="border-destructive">
          <CardContent className="flex items-center gap-4 py-6">
            <AlertCircle className="h-8 w-8 text-destructive" />
            <div>
              <p className="font-medium text-destructive">{error}</p>
              <p className="text-sm text-muted-foreground">
                נסה שוב או בחר תקופה אחרת
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Empty State */}
      {report && report.rows.length === 0 && !isLoading && (
        <Card>
          <CardContent className="flex flex-col items-center gap-4 py-12">
            <BarChart3 className="h-12 w-12 text-muted-foreground" />
            <div className="text-center">
              <p className="font-medium">אין נתונים לתקופה שנבחרה</p>
              <p className="text-sm text-muted-foreground">
                לא נמצאו נתוני מחזור או קניות מספקים בתקופה שנבחרה
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Report Content */}
      {hasData && !isLoading && (
        <>
          {/* Summary Cards */}
          <div className="grid gap-4 md:grid-cols-3">
            <Card>
              <CardContent className="flex items-center gap-4 py-6">
                <div className="rounded-lg bg-green-500/10 p-3">
                  <TrendingUp className="h-6 w-6 text-green-600" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">סה״כ מחזור</p>
                  <p className="text-2xl font-bold">
                    {formatCurrency(report.summary.totalRevenue)}
                  </p>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="flex items-center gap-4 py-6">
                <div className="rounded-lg bg-primary/10 p-3">
                  <Coins className="h-6 w-6 text-primary" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">סה״כ קניות מספקים</p>
                  <p className="text-2xl font-bold">
                    {formatCurrency(report.summary.totalSupplierPurchases)}
                  </p>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="flex items-center gap-4 py-6">
                <div className="rounded-lg bg-violet-500/10 p-3">
                  <Percent className="h-6 w-6 text-violet-600" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">
                    ממוצע אחוז קניות
                  </p>
                  <p className="text-2xl font-bold text-violet-600">
                    {report.summary.avgPercent}%
                  </p>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Period Info */}
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Calendar className="h-4 w-4" />
            <span>תקופה: {getPeriodLabel()}</span>
            {report.brandName && (
              <>
                <span>|</span>
                <span>מותג: {report.brandName}</span>
              </>
            )}
            <span>|</span>
            <span>{report.summary.count} זכיינים</span>
          </div>

          {/* Data Table */}
          <Card>
            <CardHeader>
              <CardTitle>פירוט לפי זכיין</CardTitle>
              <CardDescription>
                מחזור, קניות מספקים ואחוז קניות מסך המחזור. לחץ על שורה לפירוט.
              </CardDescription>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8" />
                    <TableHead>שם זכיין</TableHead>
                    <TableHead>קוד</TableHead>
                    <TableHead>מותג</TableHead>
                    <TableHead className="text-start">מחזור (₪)</TableHead>
                    <TableHead className="text-start">קניות מספקים (₪)</TableHead>
                    <TableHead className="text-start">אחוז קניות (%)</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {report.rows.map((row) => {
                    const isExpanded = expandedRow === row.franchiseeId;
                    const hasBreakdown =
                      row.supplierBreakdown.length > 0 ||
                      row.revenueBreakdown.length > 0;

                    return (
                      <Fragment key={row.franchiseeId}>
                        <TableRow
                          className={
                            hasBreakdown
                              ? "cursor-pointer hover:bg-muted/50"
                              : ""
                          }
                          onClick={() => {
                            if (hasBreakdown) {
                              setExpandedRow(
                                isExpanded ? null : row.franchiseeId
                              );
                            }
                          }}
                        >
                          <TableCell className="w-8 pe-0">
                            {hasBreakdown &&
                              (isExpanded ? (
                                <ChevronDown className="h-4 w-4 text-muted-foreground" />
                              ) : (
                                <ChevronLeft className="h-4 w-4 text-muted-foreground" />
                              ))}
                          </TableCell>
                          <TableCell className="font-medium">
                            {row.name}
                          </TableCell>
                          <TableCell>{row.code}</TableCell>
                          <TableCell>{row.brandName}</TableCell>
                          <TableCell className="text-start">
                            {row.totalRevenue > 0
                              ? formatCurrency(row.totalRevenue)
                              : "-"}
                          </TableCell>
                          <TableCell className="text-start">
                            {formatCurrency(row.totalSupplierPurchases)}
                          </TableCell>
                          <TableCell className="text-start">
                            {row.supplierPurchasesPercentage !== null
                              ? `${row.supplierPurchasesPercentage}%`
                              : "N/A"}
                          </TableCell>
                        </TableRow>

                        {/* Expanded Drill-Down */}
                        {isExpanded && (
                          <TableRow>
                            <TableCell colSpan={7} className="bg-muted/20 p-4">
                              <div className="flex flex-wrap gap-8">
                                {/* Supplier Breakdown */}
                                {row.supplierBreakdown.length > 0 && (
                                  <div className="flex-1 min-w-[300px]">
                                    <h4 className="mb-2 text-sm font-semibold">
                                      קניות מספקים - פירוט
                                    </h4>
                                    <Table>
                                      <TableHeader>
                                        <TableRow>
                                          <TableHead className="text-xs">
                                            ספק
                                          </TableHead>
                                          <TableHead className="text-xs text-start">
                                            סכום (₪)
                                          </TableHead>
                                          <TableHead className="text-xs text-start">
                                            עסקאות
                                          </TableHead>
                                          <TableHead className="text-xs">
                                            סוג
                                          </TableHead>
                                        </TableRow>
                                      </TableHeader>
                                      <TableBody>
                                        {row.supplierBreakdown.map(
                                          (supplier, idx) => (
                                            <TableRow key={idx}>
                                              <TableCell className="py-1 text-xs">
                                                {supplier.supplierName}
                                              </TableCell>
                                              <TableCell className="py-1 text-xs text-start">
                                                {formatCurrency(
                                                  supplier.amount
                                                )}
                                              </TableCell>
                                              <TableCell className="py-1 text-xs text-start">
                                                {supplier.transactionCount}
                                              </TableCell>
                                              <TableCell className="py-1 text-xs">
                                                {supplier.isSmallSupplier
                                                  ? "ספק קטן"
                                                  : "מותאם"}
                                              </TableCell>
                                            </TableRow>
                                          )
                                        )}
                                      </TableBody>
                                    </Table>
                                  </div>
                                )}

                                {/* Revenue Monthly Breakdown */}
                                {showMultiMonths &&
                                  row.revenueBreakdown.length > 0 && (
                                    <div className="min-w-[200px]">
                                      <h4 className="mb-2 text-sm font-semibold">
                                        מחזור - פירוט חודשי
                                      </h4>
                                      <Table>
                                        <TableHeader>
                                          <TableRow>
                                            <TableHead className="text-xs">
                                              חודש
                                            </TableHead>
                                            <TableHead className="text-xs text-start">
                                              סכום (₪)
                                            </TableHead>
                                          </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                          {row.revenueBreakdown.map(
                                            (rev) => {
                                              const monthIdx =
                                                parseInt(
                                                  rev.month.split("-")[1],
                                                  10
                                                ) - 1;
                                              return (
                                                <TableRow key={rev.month}>
                                                  <TableCell className="py-1 text-xs">
                                                    {MONTH_NAMES_HE[monthIdx]}
                                                  </TableCell>
                                                  <TableCell className="py-1 text-xs text-start">
                                                    {formatCurrency(rev.amount)}
                                                  </TableCell>
                                                </TableRow>
                                              );
                                            }
                                          )}
                                        </TableBody>
                                      </Table>
                                    </div>
                                  )}
                              </div>
                            </TableCell>
                          </TableRow>
                        )}
                      </Fragment>
                    );
                  })}

                  {/* Totals Row */}
                  <TableRow className="bg-muted/50 font-bold">
                    <TableCell />
                    <TableCell>סה״כ</TableCell>
                    <TableCell />
                    <TableCell />
                    <TableCell className="text-start">
                      {formatCurrency(report.summary.totalRevenue)}
                    </TableCell>
                    <TableCell className="text-start">
                      {formatCurrency(report.summary.totalSupplierPurchases)}
                    </TableCell>
                    <TableCell className="text-start">
                      {report.summary.totalRevenue > 0
                        ? `${Math.round((report.summary.totalSupplierPurchases / report.summary.totalRevenue) * 100 * 100) / 100}%`
                        : "N/A"}
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
