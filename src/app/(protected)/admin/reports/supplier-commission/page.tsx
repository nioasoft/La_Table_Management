"use client";

import { fetchWithTimeout } from "@/lib/fetch-with-timeout";
import { useEffect, useState, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import {
  Card,
  CardContent,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Loader2,
  Coins,
  AlertCircle,
  Download,
  RefreshCw,
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
      const response = await fetchWithTimeout("/api/brands?filter=active");
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

      const response = await fetchWithTimeout(
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

      const response = await fetchWithTimeout(
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

  // Sort franchisees: push "דון פדרו" to the end
  const sortedFranchisees = useMemo(() => {
    if (!report) return [];
    return [...report.franchisees].sort((a, b) => {
      if (a.franchiseeName === "דון פדרו") return 1;
      if (b.franchiseeName === "דון פדרו") return -1;
      return 0;
    });
  }, [report]);

  const hasData = report && report.suppliers.length > 0;

  return (
    <div className="container mx-auto space-y-2 px-4 pt-3 pb-4">
      {/* Compact toolbar: title + filters + actions in one row */}
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-lg font-bold me-2">דוח עמלות ספקים</h1>

        <Select value={selectedYear} onValueChange={setSelectedYear}>
          <SelectTrigger className="w-24 h-8 text-sm">
            <SelectValue placeholder="שנה" />
          </SelectTrigger>
          <SelectContent>
            {YEARS.map((y) => (
              <SelectItem key={y.value} value={y.value}>
                {y.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={selectedQuarter}
          onValueChange={setSelectedQuarter}
        >
          <SelectTrigger className="w-40 h-8 text-sm">
            <SelectValue placeholder="רבעון" />
          </SelectTrigger>
          <SelectContent>
            {QUARTERS.map((q) => (
              <SelectItem key={q.value} value={q.value}>
                {q.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={selectedBrandId}
          onValueChange={setSelectedBrandId}
        >
          <SelectTrigger className="w-36 h-8 text-sm">
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

        <Button size="sm" className="h-8" onClick={fetchReport} disabled={isLoading}>
          {isLoading ? (
            <Loader2 className="me-1.5 h-3.5 w-3.5 animate-spin" />
          ) : (
            <Coins className="me-1.5 h-3.5 w-3.5" />
          )}
          הפק דוח
        </Button>

        <div className="flex-1" />

        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={fetchReport}
          disabled={isLoading}
        >
          <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? "animate-spin" : ""}`} />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={handleExport}
          disabled={!hasData || isLoading}
        >
          <Download className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* Compact stats strip — only when data exists */}
      {hasData && !isLoading && (
        <div className="flex items-center gap-3 text-sm border rounded-md px-3 py-1.5 bg-muted/30">
          <span>
            <span className="text-muted-foreground">עמלות:</span>{" "}
            <span className="font-semibold font-mono tabular-nums">
              {formatCurrency(report.grandTotals.totalCommissionBeforeVat)}
            </span>
          </span>
          <span className="text-border">|</span>
          <span>
            <span className="text-muted-foreground">מחזור:</span>{" "}
            <span className="font-semibold font-mono tabular-nums text-blue-600">
              {formatCurrency(report.grandTotals.totalBkmvRevenue)}
            </span>
          </span>
          <span className="text-border">|</span>
          <span>
            <span className="text-muted-foreground">% ממחזור:</span>{" "}
            <span className="font-semibold font-mono tabular-nums text-amber-600">
              {report.grandTotals.overallPercentOfTurnover != null
                ? `${report.grandTotals.overallPercentOfTurnover}%`
                : "-"}
            </span>
          </span>
        </div>
      )}

      {/* Loading State */}
      {isLoading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      )}

      {/* Error State */}
      {error && !isLoading && (
        <Card className="border-destructive">
          <CardContent className="flex items-center gap-4 py-4">
            <AlertCircle className="h-6 w-6 text-destructive" />
            <div>
              <p className="font-medium text-destructive text-sm">{error}</p>
              <p className="text-xs text-muted-foreground">
                נסה שוב או בחר תקופה אחרת
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Empty State */}
      {report && report.suppliers.length === 0 && !isLoading && (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-8">
            <Coins className="h-10 w-10 text-muted-foreground" />
            <div className="text-center">
              <p className="font-medium text-sm">אין נתונים לתקופה זו</p>
              <p className="text-xs text-muted-foreground">
                לא נמצאו קבצי ספקים מאושרים בתקופה שנבחרה
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Matrix Table — no Card wrapper overhead */}
      {hasData && !isLoading && (
        <div className="border rounded-md overflow-auto max-h-[calc(100vh-140px)]">
              <Table className="table-compact table-grid">
                <TableHeader className="sticky top-0 z-20 bg-background [&_th]:bg-background">
                  <TableRow>
                    <TableHead className="sticky start-0 z-30 bg-background text-start">
                      ספק
                    </TableHead>
                    <TableHead className="text-center">%</TableHead>
                    {sortedFranchisees.map((f) => (
                      <TableHead key={f.franchiseeId} className="text-center">
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="text-xs font-medium whitespace-nowrap">{f.franchiseeName}</span>
                            </TooltipTrigger>
                            <TooltipContent>
                              <p>{f.franchiseeName}</p>
                              <p className="text-muted-foreground">{f.franchiseeCode}</p>
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
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
                      <TableCell className="sticky start-0 z-10 bg-background text-start whitespace-nowrap">
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="font-medium">
                                {sup.supplierName}
                                {sup.isVatExempt && (
                                  <Badge
                                    variant="outline"
                                    className="ms-1 text-[10px] px-1 py-0"
                                  >
                                    פטור
                                  </Badge>
                                )}
                              </span>
                            </TooltipTrigger>
                            <TooltipContent>
                              <p>{sup.supplierName}</p>
                              <p className="text-muted-foreground">{sup.supplierCode}</p>
                              {sup.isVatExempt && <p className="text-muted-foreground">פטור מע״מ</p>}
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      </TableCell>
                      <TableCell className="text-center font-mono tabular-nums">
                        {sup.commissionRate}%
                      </TableCell>
                      {sortedFranchisees.map((f) => {
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
                            className="text-center font-mono tabular-nums"
                          >
                            {formatCurrency(cell.commissionAmountBeforeVat)}
                          </TableCell>
                        );
                      })}
                      <TableCell className="text-center font-medium font-mono tabular-nums">
                        {formatCurrency(sup.totalCommissionBeforeVat)}
                      </TableCell>
                    </TableRow>
                  ))}

                  {/* Totals Row */}
                  <TableRow className="bg-muted/50 font-bold">
                    <TableCell className="sticky start-0 z-10 bg-muted text-start">
                      סה״כ
                    </TableCell>
                    <TableCell />
                    {sortedFranchisees.map((f) => (
                      <TableCell
                        key={f.franchiseeId}
                        className="text-center font-mono tabular-nums"
                      >
                        {formatCurrency(f.totalCommissionBeforeVat)}
                      </TableCell>
                    ))}
                    <TableCell className="text-center font-mono tabular-nums">
                      {formatCurrency(
                        report.grandTotals.totalCommissionBeforeVat
                      )}
                    </TableCell>
                  </TableRow>

                  {/* % of Turnover Row */}
                  <TableRow className="bg-amber-50/50">
                    <TableCell className="sticky start-0 z-10 bg-amber-50 font-bold text-start">
                      % ממחזור
                    </TableCell>
                    <TableCell />
                    {sortedFranchisees.map((f) => {
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
                          className="text-center font-mono tabular-nums"
                        >
                          {pct != null ? (
                            `${pct}%`
                          ) : (
                            <span className="text-muted-foreground">-</span>
                          )}
                        </TableCell>
                      );
                    })}
                    <TableCell className="text-center font-mono tabular-nums font-bold">
                      {report.grandTotals.overallPercentOfTurnover != null
                        ? `${report.grandTotals.overallPercentOfTurnover}%`
                        : "-"}
                    </TableCell>
                  </TableRow>

                  {/* BKMV Revenue Row */}
                  <TableRow className="bg-blue-50/50">
                    <TableCell className="sticky start-0 z-10 bg-blue-50 font-bold text-start">
                      מחזור (BKMV)
                    </TableCell>
                    <TableCell />
                    {sortedFranchisees.map((f) => (
                      <TableCell
                        key={f.franchiseeId}
                        className="text-center font-mono tabular-nums"
                      >
                        {f.bkmvRevenue > 0 ? (
                          formatCurrency(f.bkmvRevenue)
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </TableCell>
                    ))}
                    <TableCell className="text-center font-medium font-mono tabular-nums">
                      {formatCurrency(report.grandTotals.totalBkmvRevenue)}
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
      )}
    </div>
  );
}
