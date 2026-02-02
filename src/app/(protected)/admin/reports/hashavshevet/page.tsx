"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Loader2,
  FileSpreadsheet,
  Download,
  Building2,
  Coins,
  AlertCircle,
  Store,
  Users,
  Calendar,
  CheckCircle2,
  Info,
} from "lucide-react";
import {
  ReportLayout,
  ReportSummaryCards,
  ReportDataTable,
  ReportPeriodSelector,
  type ColumnDef,
  type SummaryCardData,
} from "@/components/reports";
import type { SettlementPeriodType } from "@/db/schema";
import { getPeriodByKey } from "@/lib/settlement-periods";
import { formatDateAsLocal } from "@/lib/date-utils";
import { formatCurrency, formatNumber } from "@/lib/report-utils";
import { toast } from "sonner";

// ============================================================================
// TYPES
// ============================================================================

interface HashavshevetEntry {
  hashavshevetCode: string;
  supplierName: string;
  supplierId: string;
  franchiseeId: string;
  franchiseeName: string;
  brandId: string;
  brandName: string;
  commissionAmount: number;
  periodStartDate: string;
  periodEndDate: string;
  // Derived fields for display
  itemKey: string; // "עמלות " + franchisee name
}

interface BrandOption {
  id: string;
  nameHe: string;
  nameEn: string | null;
  code: string;
}

interface SupplierOption {
  id: string;
  name: string;
  code: string;
  hashavshevetCode: string | null;
}

interface HashavshevetReport {
  summary: {
    totalEntries: number;
    totalCommission: number;
    supplierCount: number;
    franchiseeCount: number;
    generatedAt: string;
  };
  entries: HashavshevetEntry[];
}

// ============================================================================
// COLUMN DEFINITIONS
// ============================================================================

const entryColumns: ColumnDef<HashavshevetEntry>[] = [
  {
    id: "hashavshevetCode",
    header: "מפתח חשבון",
    accessorKey: "hashavshevetCode",
    className: "font-mono",
  },
  {
    id: "supplierName",
    header: "ספק",
    accessorKey: "supplierName",
    cell: (row) => (
      <div>
        <div className="font-medium">{row.supplierName}</div>
      </div>
    ),
  },
  {
    id: "itemKey",
    header: "מפתח פריט",
    accessorKey: "itemKey",
    cell: (row) => (
      <div className="text-sm">
        <span className="text-muted-foreground">עמלות </span>
        {row.franchiseeName}
      </div>
    ),
  },
  {
    id: "brandName",
    header: "רשת",
    accessorKey: "brandName",
    cell: (row) => <Badge variant="outline">{row.brandName}</Badge>,
  },
  {
    id: "commissionAmount",
    header: "מחיר (עמלה)",
    accessor: (row) => formatCurrency(row.commissionAmount),
    accessorKey: "commissionAmount",
    className: "font-medium text-emerald-600 dark:text-emerald-400",
  },
];

// ============================================================================
// LOCAL STORAGE KEYS
// ============================================================================

const EXPORT_HISTORY_KEY = "hashavshevet_export_history";

interface ExportHistoryEntry {
  exportedAt: string;
  startDate: string;
  endDate: string;
  brandIds: string[];
  supplierIds: string[];
  entryCount: number;
  totalAmount: number;
}

function getExportHistory(): ExportHistoryEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const data = localStorage.getItem(EXPORT_HISTORY_KEY);
    return data ? JSON.parse(data) : [];
  } catch {
    return [];
  }
}

function saveExportToHistory(entry: ExportHistoryEntry): void {
  if (typeof window === "undefined") return;
  try {
    const history = getExportHistory();
    history.unshift(entry);
    // Keep only last 50 entries
    const trimmed = history.slice(0, 50);
    localStorage.setItem(EXPORT_HISTORY_KEY, JSON.stringify(trimmed));
  } catch {
    // Ignore localStorage errors
  }
}

function checkForDuplicateExport(
  startDate: string,
  endDate: string,
  brandIds: string[],
  supplierIds: string[]
): ExportHistoryEntry | null {
  const history = getExportHistory();
  return history.find(
    (entry) =>
      entry.startDate === startDate &&
      entry.endDate === endDate &&
      JSON.stringify(entry.brandIds.sort()) === JSON.stringify(brandIds.sort()) &&
      JSON.stringify(entry.supplierIds.sort()) === JSON.stringify(supplierIds.sort())
  ) || null;
}

// ============================================================================
// COMPONENT
// ============================================================================

export default function HashavshevetExportPage() {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [report, setReport] = useState<HashavshevetReport | null>(null);
  const [brands, setBrands] = useState<BrandOption[]>([]);
  const [suppliers, setSuppliers] = useState<SupplierOption[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [duplicateWarning, setDuplicateWarning] = useState<ExportHistoryEntry | null>(null);

  // Filters
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [periodType, setPeriodType] = useState<SettlementPeriodType | "">("");
  const [periodKey, setPeriodKey] = useState("");
  const [useCustomDateRange, setUseCustomDateRange] = useState(true);
  const [selectedBrandIds, setSelectedBrandIds] = useState<string[]>([]);
  const [selectedSupplierIds, setSelectedSupplierIds] = useState<string[]>([]);

  const { data: session, isPending } = authClient.useSession();
  const userRole = session ? (session.user as { role?: string })?.role : undefined;

  // Redirect if not authenticated or not admin
  useEffect(() => {
    if (!isPending && !session) {
      router.push("/sign-in?redirect=/admin/reports/hashavshevet");
      return;
    }
    if (!isPending && session?.user && userRole !== "super_user" && userRole !== "admin") {
      router.push("/dashboard");
    }
  }, [isPending, session, userRole, router]);

  // Fetch filter options (brands and suppliers)
  const fetchFilterOptions = useCallback(async () => {
    try {
      const [brandsRes, suppliersRes] = await Promise.all([
        fetch("/api/brands?filter=active"),
        fetch("/api/suppliers?filter=active&hasHashavshevet=true"),
      ]);

      if (brandsRes.ok) {
        const brandsData = await brandsRes.json();
        setBrands(brandsData.brands || []);
      }

      if (suppliersRes.ok) {
        const suppliersData = await suppliersRes.json();
        // Filter to only show suppliers with hashavshevet code
        const suppliersWithCode = (suppliersData.suppliers || []).filter(
          (s: SupplierOption) => s.hashavshevetCode
        );
        setSuppliers(suppliersWithCode);
      }
    } catch (err) {
      console.error("Error fetching filter options:", err);
    }
  }, []);

  // Build query string
  const buildQueryString = useCallback(() => {
    const params = new URLSearchParams();
    if (startDate) params.set("startDate", startDate);
    if (endDate) params.set("endDate", endDate);
    if (selectedBrandIds.length > 0) params.set("brandIds", selectedBrandIds.join(","));
    if (selectedSupplierIds.length > 0) params.set("supplierIds", selectedSupplierIds.join(","));
    return params.toString();
  }, [startDate, endDate, selectedBrandIds, selectedSupplierIds]);

  // Fetch report data
  const fetchReport = useCallback(async () => {
    if (!startDate || !endDate) {
      toast.error("יש לבחור תקופה");
      return;
    }

    setIsLoading(true);
    setError(null);
    setDuplicateWarning(null);

    try {
      const queryString = buildQueryString();
      const response = await fetch(`/api/reports/hashavshevet?${queryString}`);

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to fetch report");
      }

      const data = await response.json();
      setReport(data.report);

      // Check for duplicate export
      const duplicate = checkForDuplicateExport(
        startDate,
        endDate,
        selectedBrandIds,
        selectedSupplierIds
      );
      if (duplicate) {
        setDuplicateWarning(duplicate);
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Failed to fetch report";
      setError(errorMessage);
      toast.error("שגיאה בטעינת הנתונים");
    } finally {
      setIsLoading(false);
    }
  }, [buildQueryString, startDate, endDate, selectedBrandIds, selectedSupplierIds]);

  // Handle export
  const handleExport = async () => {
    if (!report || report.entries.length === 0) {
      toast.error("אין נתונים לייצוא");
      return;
    }

    setIsExporting(true);
    try {
      const queryString = buildQueryString();
      const response = await fetch(`/api/reports/hashavshevet/export?${queryString}`);

      if (!response.ok) {
        throw new Error("Failed to export");
      }

      // Get filename from Content-Disposition header
      const contentDisposition = response.headers.get("Content-Disposition");
      let filename = "hashavshevet_export.xlsx";
      if (contentDisposition) {
        const match = contentDisposition.match(/filename="?([^"]+)"?/);
        if (match) filename = match[1];
      }

      // Download file
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);

      // Save to history
      saveExportToHistory({
        exportedAt: new Date().toISOString(),
        startDate,
        endDate,
        brandIds: selectedBrandIds,
        supplierIds: selectedSupplierIds,
        entryCount: report.entries.length,
        totalAmount: report.summary.totalCommission,
      });

      toast.success("הקובץ הורד בהצלחה");
      setDuplicateWarning(null);
    } catch (err) {
      toast.error("שגיאה בייצוא הקובץ");
    } finally {
      setIsExporting(false);
    }
  };

  // Initial load
  const hasInitiallyLoaded = useRef(false);
  useEffect(() => {
    const isAuthenticated = !!session && (userRole === "super_user" || userRole === "admin");

    if (isAuthenticated && !hasInitiallyLoaded.current) {
      hasInitiallyLoaded.current = true;
      fetchFilterOptions();
    }
  }, [session, userRole, fetchFilterOptions]);

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

  // Handle brand toggle
  const handleBrandToggle = (brandId: string) => {
    setSelectedBrandIds((prev) =>
      prev.includes(brandId)
        ? prev.filter((id) => id !== brandId)
        : [...prev, brandId]
    );
  };

  // Handle supplier toggle
  const handleSupplierToggle = (supplierId: string) => {
    setSelectedSupplierIds((prev) =>
      prev.includes(supplierId)
        ? prev.filter((id) => id !== supplierId)
        : [...prev, supplierId]
    );
  };

  // Handle select all brands
  const handleSelectAllBrands = () => {
    if (selectedBrandIds.length === brands.length) {
      setSelectedBrandIds([]);
    } else {
      setSelectedBrandIds(brands.map((b) => b.id));
    }
  };

  // Handle select all suppliers
  const handleSelectAllSuppliers = () => {
    if (selectedSupplierIds.length === suppliers.length) {
      setSelectedSupplierIds([]);
    } else {
      setSelectedSupplierIds(suppliers.map((s) => s.id));
    }
  };

  // Handle filter reset
  const handleResetFilters = () => {
    setStartDate("");
    setEndDate("");
    setPeriodType("");
    setPeriodKey("");
    setUseCustomDateRange(true);
    setSelectedBrandIds([]);
    setSelectedSupplierIds([]);
    setReport(null);
    setDuplicateWarning(null);
  };

  // Summary cards
  const summaryCards: SummaryCardData[] = report
    ? [
        {
          title: "סה״כ שורות",
          value: formatNumber(report.summary.totalEntries),
          subtitle: "שורות לייצוא",
          icon: FileSpreadsheet,
        },
        {
          title: "סה״כ עמלות",
          value: formatCurrency(report.summary.totalCommission),
          subtitle: "סכום כולל",
          icon: Coins,
          variant: "success",
        },
        {
          title: "ספקים",
          value: formatNumber(report.summary.supplierCount),
          subtitle: "ספקים עם קוד חשבשבת",
          icon: Store,
        },
        {
          title: "זכיינים",
          value: formatNumber(report.summary.franchiseeCount),
          subtitle: "זכיינים בייצוא",
          icon: Users,
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
      title="ייצוא לחשבשבת"
      description="ייצוא קובץ Excel בפורמט חשבשבת לייבוא עמלות"
      breadcrumbs={[
        { label: "ניהול", href: "/admin" },
        { label: "דוחות", href: "/admin/reports" },
        { label: "ייצוא לחשבשבת" },
      ]}
      isLoading={isLoading}
    >
      {/* Filters Card */}
      <Card>
        <CardHeader className="pb-3 pt-4 px-4">
          <CardTitle className="text-base">בחירת נתונים לייצוא</CardTitle>
          <CardDescription>
            בחר תקופה, רשתות וספקים לייצוא. רק ספקים עם קוד חשבשבת מוגדר יוצגו.
          </CardDescription>
        </CardHeader>
        <CardContent className="px-4 pb-4 space-y-4">
          {/* Period Selection */}
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex-shrink-0">
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

            {/* Date inputs - only show when using custom range */}
            {useCustomDateRange && (
              <>
                <div className="w-[144px]">
                  <Label htmlFor="startDate" className="text-xs mb-1 block">מתאריך</Label>
                  <Input
                    id="startDate"
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="h-9"
                  />
                </div>

                <div className="w-[144px]">
                  <Label htmlFor="endDate" className="text-xs mb-1 block">עד תאריך</Label>
                  <Input
                    id="endDate"
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    className="h-9"
                  />
                </div>
              </>
            )}
          </div>

          {/* Brand Selection */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-medium">רשתות</Label>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleSelectAllBrands}
                className="h-7 text-xs"
              >
                {selectedBrandIds.length === brands.length ? "בטל הכל" : "בחר הכל"}
              </Button>
            </div>
            <div className="flex flex-wrap gap-3">
              {brands.map((brand) => (
                <div key={brand.id} className="flex items-center space-x-2 space-x-reverse">
                  <Checkbox
                    id={`brand-${brand.id}`}
                    checked={selectedBrandIds.includes(brand.id)}
                    onCheckedChange={() => handleBrandToggle(brand.id)}
                  />
                  <Label htmlFor={`brand-${brand.id}`} className="cursor-pointer text-sm">
                    {brand.nameHe}
                  </Label>
                </div>
              ))}
            </div>
          </div>

          {/* Supplier Selection */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-medium">
                ספקים עם קוד חשבשבת ({suppliers.length})
              </Label>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleSelectAllSuppliers}
                className="h-7 text-xs"
              >
                {selectedSupplierIds.length === suppliers.length ? "בטל הכל" : "בחר הכל"}
              </Button>
            </div>
            {suppliers.length === 0 ? (
              <Alert>
                <Info className="h-4 w-4" />
                <AlertDescription>
                  אין ספקים עם קוד חשבשבת מוגדר. יש להגדיר קוד חשבשבת בעמוד עריכת הספק.
                </AlertDescription>
              </Alert>
            ) : (
              <div className="flex flex-wrap gap-3 max-h-40 overflow-y-auto p-2 border rounded-md">
                {suppliers.map((supplier) => (
                  <div key={supplier.id} className="flex items-center space-x-2 space-x-reverse">
                    <Checkbox
                      id={`supplier-${supplier.id}`}
                      checked={selectedSupplierIds.includes(supplier.id)}
                      onCheckedChange={() => handleSupplierToggle(supplier.id)}
                    />
                    <Label
                      htmlFor={`supplier-${supplier.id}`}
                      className="cursor-pointer text-sm flex items-center gap-1"
                    >
                      {supplier.name}
                      <span className="text-xs text-muted-foreground font-mono">
                        ({supplier.hashavshevetCode})
                      </span>
                    </Label>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Action Buttons */}
          <div className="flex gap-2 pt-2">
            <Button
              onClick={fetchReport}
              disabled={isLoading || !startDate || !endDate}
              className="flex-1 sm:flex-none"
            >
              {isLoading && <Loader2 className="h-4 w-4 me-2 animate-spin" />}
              <Calendar className="h-4 w-4 me-2" />
              הצג נתונים
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
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>שגיאה</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Duplicate Warning */}
      {duplicateWarning && (
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>אזהרה: ייצוא כפול אפשרי</AlertTitle>
          <AlertDescription>
            תקופה זו יוצאה בעבר בתאריך{" "}
            {new Date(duplicateWarning.exportedAt).toLocaleDateString("he-IL")}{" "}
            ({duplicateWarning.entryCount} שורות, {formatCurrency(duplicateWarning.totalAmount)}).
            ייתכן שמדובר בייצוא כפול.
          </AlertDescription>
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

          {/* Export Button */}
          {report.entries.length > 0 && (
            <Card>
              <CardContent className="py-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <CheckCircle2 className="h-5 w-5 text-green-500" />
                    <div>
                      <p className="font-medium">
                        {report.entries.length} שורות מוכנות לייצוא
                      </p>
                      <p className="text-sm text-muted-foreground">
                        סה״כ עמלות: {formatCurrency(report.summary.totalCommission)}
                      </p>
                    </div>
                  </div>
                  <Button onClick={handleExport} disabled={isExporting} size="lg">
                    {isExporting ? (
                      <Loader2 className="h-4 w-4 me-2 animate-spin" />
                    ) : (
                      <Download className="h-4 w-4 me-2" />
                    )}
                    ייצא לחשבשבת
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Data Table */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Building2 className="h-5 w-5" />
                תצוגה מקדימה
              </CardTitle>
              <CardDescription>
                הנתונים שייוצאו לקובץ Excel בפורמט חשבשבת
              </CardDescription>
            </CardHeader>
            <CardContent>
              {report.entries.length === 0 ? (
                <div className="text-center py-8">
                  <FileSpreadsheet className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                  <h3 className="text-lg font-medium mb-2">אין נתונים</h3>
                  <p className="text-muted-foreground">
                    לא נמצאו נתוני עמלות לתקופה והספקים שנבחרו.
                    <br />
                    ודא שלספקים הנבחרים יש קוד חשבשבת ונתוני עמלות בתקופה.
                  </p>
                </div>
              ) : (
                <ReportDataTable
                  data={report.entries}
                  columns={entryColumns}
                  rowKey={(row) => `${row.supplierId}-${row.franchiseeId}`}
                  searchPlaceholder="חיפוש ספק או זכיין..."
                  emptyMessage="אין נתונים להצגה"
                />
              )}
            </CardContent>
          </Card>

          {/* Format Info */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Info className="h-4 w-4" />
                פורמט הקובץ
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-sm text-muted-foreground space-y-1">
                <p>הקובץ מכיל 8 עמודות בפורמט הנדרש לייבוא לחשבשבת:</p>
                <ul className="list-disc list-inside ps-2 space-y-0.5">
                  <li><strong>מפתח חשבון</strong> - קוד הספק בחשבשבת</li>
                  <li><strong>שם</strong> - ריק</li>
                  <li><strong>מפתח פריט</strong> - "עמלות " + שם הזכיין</li>
                  <li><strong>שם פריט</strong> - ריק</li>
                  <li><strong>כמות</strong> - 1</li>
                  <li><strong>מחיר</strong> - סכום העמלה</li>
                  <li><strong>סוג המסמך</strong> - 11</li>
                  <li><strong>מספר מסמך</strong> - ריק (נקבע בחשבשבת)</li>
                </ul>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </ReportLayout>
  );
}
