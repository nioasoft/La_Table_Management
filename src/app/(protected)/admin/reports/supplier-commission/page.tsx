"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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
  Coins,
  Calendar,
  AlertCircle,
  Download,
  RefreshCw,
  TrendingUp,
  BarChart3,
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

interface SupplierCommissionCell {
  grossAmount: number;
  netAmount: number;
  commissionAmount: number;
  commissionAmountBeforeVat: number;
}

interface SupplierCommissionRow {
  supplierId: string;
  supplierName: string;
  supplierCode: string;
  commissionRate: number;
  isVatExempt: boolean;
  cells: Record<string, SupplierCommissionCell>;
  totalCommission: number;
  totalCommissionBeforeVat: number;
  percentOfTurnover: number | null;
}

interface SupplierCommissionFranchiseeColumn {
  franchiseeId: string;
  franchiseeName: string;
  franchiseeCode: string;
  totalCommission: number;
  totalCommissionBeforeVat: number;
  bkmvRevenue: number;
}

interface SupplierCommissionReport {
  year: number;
  quarter: 1 | 2 | 3 | 4;
  brandId: string | null;
  brandName: string | null;
  suppliers: SupplierCommissionRow[];
  franchisees: SupplierCommissionFranchiseeColumn[];
  grandTotals: {
    totalCommission: number;
    totalCommissionBeforeVat: number;
    totalBkmvRevenue: number;
    overallPercentOfTurnover: number | null;
  };
  generatedAt: string;
}

// ============================================================================
// CONSTANTS
// ============================================================================

const QUARTERS = [
  { value: "1", label: "Q1 (ינואר-מרץ)" },
  { value: "2", label: "Q2 (אפריל-יוני)" },
  { value: "3", label: "Q3 (יולי-ספטמבר)" },
  { value: "4", label: "Q4 (אוקטובר-דצמבר)" },
];

const currentYear = new Date().getFullYear();
const YEARS = Array.from({ length: 5 }, (_, i) => currentYear - 2 + i).map(
  (y) => ({
    value: y.toString(),
    label: y.toString(),
  })
);

const getCurrentQuarter = (): 1 | 2 | 3 | 4 => {
  const month = new Date().getMonth();
  return (Math.floor(month / 3) + 1) as 1 | 2 | 3 | 4;
};

// ============================================================================
// COMPONENT
// ============================================================================

export default function SupplierCommissionReportPage() {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const [report, setReport] = useState<SupplierCommissionReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [brands, setBrands] = useState<Brand[]>([]);

  // Filter state
  const [selectedYear, setSelectedYear] = useState<string>(
    currentYear.toString()
  );
  const [selectedQuarter, setSelectedQuarter] = useState<string>(
    getCurrentQuarter().toString()
  );
  const [selectedBrandId, setSelectedBrandId] = useState<string>("all");

  const { data: session, isPending } = authClient.useSession();
  const userRole = session
    ? (session.user as { role?: string })?.role
    : undefined;

  // Redirect if not authenticated or not admin
  useEffect(() => {
    if (!isPending && !session) {
      router.push("/sign-in?redirect=/admin/reports/supplier-commission");
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

  // Fetch brands for dropdown
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

  // Initial load - fetch brands
  useEffect(() => {
    if (session && (userRole === "super_user" || userRole === "admin")) {
      fetchBrands();
    }
  }, [session, userRole, fetchBrands]);

  // Fetch report data
  const fetchReport = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        year: selectedYear,
        quarter: selectedQuarter,
      });
      if (selectedBrandId && selectedBrandId !== "all") {
        params.append("brandId", selectedBrandId);
      }

      const response = await fetch(
        `/api/reports/supplier-commission?${params.toString()}`
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
  }, [selectedYear, selectedQuarter, selectedBrandId]);

  // Export to Excel
  const handleExport = useCallback(async () => {
    if (!report || report.suppliers.length === 0) {
      toast.error("אין נתונים לייצוא");
      return;
    }

    try {
      const params = new URLSearchParams({
        year: selectedYear,
        quarter: selectedQuarter,
      });
      if (selectedBrandId && selectedBrandId !== "all") {
        params.append("brandId", selectedBrandId);
      }

      const response = await fetch(
        `/api/reports/supplier-commission/export?${params.toString()}`
      );
      if (!response.ok) {
        throw new Error("שגיאה בייצוא הדוח");
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `supplier-commissions-${selectedYear}-Q${selectedQuarter}.xlsx`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      toast.success("הקובץ הורד בהצלחה");
    } catch (err) {
      console.error("Error exporting report:", err);
      toast.error("שגיאה בייצוא הדוח");
    }
  }, [report, selectedYear, selectedQuarter, selectedBrandId]);

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

  const hasData = report && report.suppliers.length > 0;

  return (
    <div className="container mx-auto space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">דוח עמלות ספקים</h1>
          <p className="text-muted-foreground">
            מטריצת עמלות ספקים לפי סניף עם אחוז ממחזור
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
          <CardDescription>בחר שנה ורבעון להפקת הדוח</CardDescription>
        </CardHeader>
        <CardContent>
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
              <Label>רבעון</Label>
              <Select
                value={selectedQuarter}
                onValueChange={setSelectedQuarter}
              >
                <SelectTrigger className="w-48">
                  <SelectValue placeholder="בחר רבעון" />
                </SelectTrigger>
                <SelectContent>
                  {QUARTERS.map((q) => (
                    <SelectItem key={q.value} value={q.value}>
                      {q.label}
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
                <Coins className="me-2 h-4 w-4" />
              )}
              הפק דוח
            </Button>
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
      {report && report.suppliers.length === 0 && !isLoading && (
        <Card>
          <CardContent className="flex flex-col items-center gap-4 py-12">
            <Coins className="h-12 w-12 text-muted-foreground" />
            <div className="text-center">
              <p className="font-medium">אין נתונים לתקופה זו</p>
              <p className="text-sm text-muted-foreground">
                לא נמצאו קבצי ספקים מאושרים בתקופה שנבחרה
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
                <div className="rounded-lg bg-primary/10 p-3">
                  <Coins className="h-6 w-6 text-primary" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">
                    סה״כ עמלות (לפני מע״מ)
                  </p>
                  <p className="text-2xl font-bold">
                    {formatCurrency(report.grandTotals.totalCommissionBeforeVat)}
                  </p>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="flex items-center gap-4 py-6">
                <div className="rounded-lg bg-blue-500/10 p-3">
                  <BarChart3 className="h-6 w-6 text-blue-500" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">
                    סה״כ מחזור (BKMV)
                  </p>
                  <p className="text-2xl font-bold text-blue-600">
                    {formatCurrency(report.grandTotals.totalBkmvRevenue)}
                  </p>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="flex items-center gap-4 py-6">
                <div className="rounded-lg bg-amber-500/10 p-3">
                  <TrendingUp className="h-6 w-6 text-amber-500" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">
                    % עמלות ממחזור
                  </p>
                  <p className="text-2xl font-bold text-amber-600">
                    {report.grandTotals.overallPercentOfTurnover != null
                      ? `${report.grandTotals.overallPercentOfTurnover}%`
                      : "-"}
                  </p>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Period Info */}
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Calendar className="h-4 w-4" />
            <span>
              שנה: {report.year} | רבעון: Q{report.quarter}
            </span>
            {report.brandName && (
              <>
                <span>•</span>
                <span>מותג: {report.brandName}</span>
              </>
            )}
          </div>

          {/* Matrix Table */}
          <Card>
            <CardHeader>
              <CardTitle>מטריצת עמלות ספקים</CardTitle>
              <CardDescription>
                עמלות לפני מע״מ לפי ספק וסניף
              </CardDescription>
            </CardHeader>
            <CardContent className="[&>div]:max-h-[70vh]">
              <Table>
                <TableHeader className="sticky top-0 z-20 bg-background shadow-[0_1px_0_0_hsl(var(--border))] [&_th]:bg-background">
                  <TableRow>
                    <TableHead className="sticky start-0 z-30 bg-background">
                      ספק
                    </TableHead>
                    <TableHead className="text-center">% עמלה</TableHead>
                    {report.franchisees.map((f) => (
                      <TableHead key={f.franchiseeId} className="text-center">
                        <div className="text-xs">
                          <div className="font-medium">{f.franchiseeName}</div>
                          <div className="text-muted-foreground">
                            {f.franchiseeCode}
                          </div>
                        </div>
                      </TableHead>
                    ))}
                    <TableHead className="text-center font-bold">
                      סה״כ
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {report.suppliers.map((sup) => (
                    <TableRow key={sup.supplierId}>
                      <TableCell className="sticky start-0 z-10 bg-background">
                        <div>
                          <div className="font-medium">{sup.supplierName}</div>
                          <div className="text-xs text-muted-foreground">
                            {sup.supplierCode}
                            {sup.isVatExempt && (
                              <Badge
                                variant="outline"
                                className="ms-1 text-xs"
                              >
                                פטור מע״מ
                              </Badge>
                            )}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="text-center">
                        <Badge variant="outline">{sup.commissionRate}%</Badge>
                      </TableCell>
                      {report.franchisees.map((f) => {
                        const cell = sup.cells[f.franchiseeId];
                        if (!cell || cell.commissionAmountBeforeVat === 0) {
                          return (
                            <TableCell
                              key={f.franchiseeId}
                              className="text-center text-muted-foreground"
                            >
                              -
                            </TableCell>
                          );
                        }
                        return (
                          <TableCell
                            key={f.franchiseeId}
                            className="text-center text-xs"
                          >
                            {formatCurrency(cell.commissionAmountBeforeVat)}
                          </TableCell>
                        );
                      })}
                      <TableCell className="text-center font-medium">
                        {formatCurrency(sup.totalCommissionBeforeVat)}
                      </TableCell>
                    </TableRow>
                  ))}

                  {/* Totals Row */}
                  <TableRow className="bg-muted/50 font-bold">
                    <TableCell className="sticky start-0 z-10 bg-muted">
                      סה״כ
                    </TableCell>
                    <TableCell />
                    {report.franchisees.map((f) => (
                      <TableCell
                        key={f.franchiseeId}
                        className="text-center text-xs"
                      >
                        {formatCurrency(f.totalCommissionBeforeVat)}
                      </TableCell>
                    ))}
                    <TableCell className="text-center">
                      {formatCurrency(
                        report.grandTotals.totalCommissionBeforeVat
                      )}
                    </TableCell>
                  </TableRow>

                  {/* % of Turnover Row */}
                  <TableRow className="bg-amber-50/50">
                    <TableCell className="sticky start-0 z-10 bg-amber-50 font-bold">
                      % ממחזור
                    </TableCell>
                    <TableCell />
                    {report.franchisees.map((f) => {
                      const pct =
                        f.bkmvRevenue > 0
                          ? Math.round(
                              (f.totalCommissionBeforeVat / f.bkmvRevenue) *
                                10000
                            ) / 100
                          : null;
                      return (
                        <TableCell
                          key={f.franchiseeId}
                          className="text-center"
                        >
                          {pct != null ? (
                            <Badge variant="secondary">{pct}%</Badge>
                          ) : (
                            <span className="text-muted-foreground">-</span>
                          )}
                        </TableCell>
                      );
                    })}
                    <TableCell className="text-center">
                      {report.grandTotals.overallPercentOfTurnover != null ? (
                        <Badge variant="default">
                          {report.grandTotals.overallPercentOfTurnover}%
                        </Badge>
                      ) : (
                        "-"
                      )}
                    </TableCell>
                  </TableRow>

                  {/* BKMV Revenue Row */}
                  <TableRow className="bg-blue-50/50">
                    <TableCell className="sticky start-0 z-10 bg-blue-50 font-bold">
                      מחזור (BKMV)
                    </TableCell>
                    <TableCell />
                    {report.franchisees.map((f) => (
                      <TableCell
                        key={f.franchiseeId}
                        className="text-center text-xs"
                      >
                        {f.bkmvRevenue > 0 ? (
                          formatCurrency(f.bkmvRevenue)
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </TableCell>
                    ))}
                    <TableCell className="text-center font-medium">
                      {formatCurrency(report.grandTotals.totalBkmvRevenue)}
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
