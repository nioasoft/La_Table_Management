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
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Loader2,
  AlertTriangle,
  Store,
  Building2,
  DollarSign,
  FileText,
  Users,
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
import { formatCurrency, formatDateHe, formatNumber } from "@/lib/report-utils";
import { toast } from "sonner";

// ============================================================================
// TYPES
// ============================================================================

interface UnauthorizedSupplierEntry {
  bkmvName: string;
  totalAmount: number;
  transactionCount: number;
  franchisees: Array<{
    id: string;
    name: string;
    brandNameHe: string;
    amount: number;
    fileCount: number;
  }>;
  firstSeen: string;
  lastSeen: string;
  fileCount: number;
}

interface UnauthorizedSuppliersReport {
  summary: {
    totalUnauthorizedSuppliers: number;
    totalAmount: number;
    totalTransactions: number;
    affectedFranchisees: number;
    periodRange: {
      startDate: string | null;
      endDate: string | null;
    };
    generatedAt: string;
  };
  suppliers: UnauthorizedSupplierEntry[];
}

interface FilterOption {
  id: string;
  name?: string;
  nameHe?: string;
  brandId?: string;
}

// ============================================================================
// COLUMN DEFINITIONS
// ============================================================================

const supplierColumns: ColumnDef<UnauthorizedSupplierEntry>[] = [
  {
    id: "bkmvName",
    header: "שם ספק (BKMV)",
    accessorKey: "bkmvName",
    className: "font-medium",
  },
  {
    id: "totalAmount",
    header: "סכום כולל",
    accessor: (row) => formatCurrency(row.totalAmount),
    accessorKey: "totalAmount",
    className: "font-medium",
  },
  {
    id: "transactionCount",
    header: "עסקאות",
    accessor: (row) => formatNumber(row.transactionCount),
    accessorKey: "transactionCount",
  },
  {
    id: "franchiseeCount",
    header: "זכיינים",
    accessor: (row) => row.franchisees.length,
    cell: (row) => (
      <Badge variant="outline">
        {row.franchisees.length} זכיינים
      </Badge>
    ),
  },
  {
    id: "fileCount",
    header: "קבצים",
    accessorKey: "fileCount",
  },
  {
    id: "lastSeen",
    header: "נראה לאחרונה",
    accessor: (row) => formatDateHe(row.lastSeen),
    accessorKey: "lastSeen",
  },
];

// ============================================================================
// COMPONENT
// ============================================================================

export default function UnauthorizedSuppliersReportPage() {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const [report, setReport] = useState<UnauthorizedSuppliersReport | null>(null);
  const [brands, setBrands] = useState<FilterOption[]>([]);
  const [franchisees, setFranchisees] = useState<FilterOption[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [selectedBrand, setSelectedBrand] = useState("");
  const [selectedFranchisee, setSelectedFranchisee] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [minAmount, setMinAmount] = useState("");
  const [periodType, setPeriodType] = useState<SettlementPeriodType | "">("");
  const [periodKey, setPeriodKey] = useState("");
  const [useCustomDateRange, setUseCustomDateRange] = useState(true);

  // Selected supplier for detail view
  const [selectedSupplier, setSelectedSupplier] = useState<UnauthorizedSupplierEntry | null>(null);

  const { data: session, isPending } = authClient.useSession();
  const userRole = session ? (session.user as { role?: string })?.role : undefined;

  // Redirect if not authenticated or not admin
  useEffect(() => {
    if (!isPending && !session) {
      router.push("/sign-in?redirect=/admin/reports/unauthorized");
      return;
    }
    if (!isPending && session?.user && userRole !== "super_user" && userRole !== "admin") {
      router.push("/dashboard");
    }
  }, [isPending, session, userRole, router]);

  // Build query string
  const buildQueryString = useCallback(() => {
    const params = new URLSearchParams();
    if (selectedBrand && selectedBrand !== "all") params.set("brandId", selectedBrand);
    if (selectedFranchisee && selectedFranchisee !== "all") params.set("franchiseeId", selectedFranchisee);
    if (startDate) params.set("startDate", startDate);
    if (endDate) params.set("endDate", endDate);
    if (minAmount) params.set("minAmount", minAmount);
    return params.toString();
  }, [selectedBrand, selectedFranchisee, startDate, endDate, minAmount]);

  // Fetch report
  const fetchReport = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const queryString = buildQueryString();
      const response = await fetch(`/api/reports/unauthorized${queryString ? `?${queryString}` : ""}`);
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to fetch report");
      }
      const data = await response.json();
      setReport(data.report);
      setBrands(data.filters.brands || []);
      setFranchisees(data.filters.franchisees || []);
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
        setStartDate(period.startDate.toISOString().split("T")[0]);
        setEndDate(period.endDate.toISOString().split("T")[0]);
      }
    }
  };

  // Handle filter reset
  const handleResetFilters = () => {
    setSelectedBrand("");
    setSelectedFranchisee("");
    setStartDate("");
    setEndDate("");
    setMinAmount("");
    setPeriodType("");
    setPeriodKey("");
    setUseCustomDateRange(true);
  };

  // Filter franchisees by selected brand
  const filteredFranchisees = selectedBrand && selectedBrand !== "all"
    ? franchisees.filter((f) => f.brandId === selectedBrand)
    : franchisees;

  // Summary cards
  const summaryCards: SummaryCardData[] = report
    ? [
        {
          title: "ספקים לא מורשים",
          value: formatNumber(report.summary.totalUnauthorizedSuppliers),
          subtitle: "ספקים ללא הסכם",
          icon: AlertTriangle,
          variant: report.summary.totalUnauthorizedSuppliers > 0 ? "danger" : "default",
        },
        {
          title: "סכום כולל",
          value: formatCurrency(report.summary.totalAmount),
          subtitle: `${formatNumber(report.summary.totalTransactions)} עסקאות`,
          icon: DollarSign,
        },
        {
          title: "זכיינים מושפעים",
          value: formatNumber(report.summary.affectedFranchisees),
          subtitle: "זכיינים עם ספקים לא מורשים",
          icon: Store,
        },
        {
          title: "טווח תקופה",
          value:
            report.summary.periodRange.startDate && report.summary.periodRange.endDate
              ? `${formatDateHe(report.summary.periodRange.startDate)} - ${formatDateHe(report.summary.periodRange.endDate)}`
              : "לא זמין",
          subtitle: `הופק: ${formatDateHe(report.summary.generatedAt)}`,
          icon: FileText,
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
      title="דוח ספקים לא מורשים"
      description="זיהוי ספקים שמופיעים בקבצי BKMV אך אינם רשומים במערכת עם הסכם עמלות"
      breadcrumbs={[
        { label: "ניהול", href: "/admin" },
        { label: "דוחות", href: "/admin/reports" },
        { label: "ספקים לא מורשים" },
      ]}
      isLoading={isLoading}
      onRefresh={fetchReport}
      actions={
        <ReportExportButton
          endpoints={{
            excel: "/api/reports/unauthorized/export",
          }}
          queryString={buildQueryString()}
          reportType="unauthorized-suppliers"
          disabled={!report || report.suppliers.length === 0}
        />
      }
    >
      {/* Filters Card */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">סינון</CardTitle>
          <CardDescription>סנן לפי מותג, זכיין, תקופה או סכום מינימלי</CardDescription>
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
              <Label htmlFor="franchisee">זכיין</Label>
              <Select value={selectedFranchisee} onValueChange={setSelectedFranchisee}>
                <SelectTrigger id="franchisee">
                  <SelectValue placeholder="כל הזכיינים" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">כל הזכיינים</SelectItem>
                  {filteredFranchisees.map((f) => (
                    <SelectItem key={f.id} value={f.id}>
                      {f.name}
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

            <div className="space-y-2">
              <Label htmlFor="minAmount">סכום מינימלי</Label>
              <Input
                id="minAmount"
                type="number"
                placeholder="0"
                value={minAmount}
                onChange={(e) => setMinAmount(e.target.value)}
              />
            </div>
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

          {/* Alert for unauthorized suppliers */}
          {report.summary.totalUnauthorizedSuppliers > 0 && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>זוהו ספקים לא מורשים</AlertTitle>
              <AlertDescription>
                נמצאו {report.summary.totalUnauthorizedSuppliers} ספקים שמופיעים בקבצי BKMV אך אינם
                רשומים במערכת. יש לבדוק אם יש צורך להוסיף אותם או להוסיפם לרשימה השחורה.
              </AlertDescription>
            </Alert>
          )}

          {/* Main Table */}
          <Card>
            <CardHeader>
              <CardTitle>רשימת ספקים לא מורשים</CardTitle>
              <CardDescription>
                ספקים שמופיעים בקבצי BKMV ללא התאמה לספקים רשומים במערכת
              </CardDescription>
            </CardHeader>
            <CardContent>
              {report.suppliers.length === 0 ? (
                <div className="text-center py-8">
                  <AlertTriangle className="h-12 w-12 mx-auto text-emerald-500 dark:text-emerald-400 mb-4" />
                  <h3 className="text-lg font-medium mb-2">לא נמצאו ספקים לא מורשים</h3>
                  <p className="text-muted-foreground">
                    כל הספקים בקבצי ה-BKMV מותאמים לספקים במערכת
                  </p>
                </div>
              ) : (
                <ReportDataTable
                  data={report.suppliers}
                  columns={supplierColumns}
                  rowKey="bkmvName"
                  searchPlaceholder="חיפוש שם ספק..."
                  onRowClick={(row) => setSelectedSupplier(row)}
                  highlightOnHover
                />
              )}
            </CardContent>
          </Card>

          {/* Supplier Detail Card */}
          {selectedSupplier && (
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle>פירוט ספק: {selectedSupplier.bkmvName}</CardTitle>
                    <CardDescription>
                      סכום כולל: {formatCurrency(selectedSupplier.totalAmount)} |{" "}
                      {selectedSupplier.transactionCount} עסקאות
                    </CardDescription>
                  </div>
                  <Button variant="outline" onClick={() => setSelectedSupplier(null)}>
                    סגור
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <h4 className="font-medium mb-3 flex items-center gap-2">
                  <Building2 className="h-4 w-4" />
                  זכיינים עם רכישות מספק זה
                </h4>
                <div className="space-y-2">
                  {selectedSupplier.franchisees.map((f) => (
                    <div
                      key={f.id}
                      className="flex items-center justify-between p-3 rounded-lg bg-muted"
                    >
                      <div>
                        <span className="font-medium">{f.name}</span>
                        <Badge variant="outline" className="ms-2">
                          {f.brandNameHe}
                        </Badge>
                      </div>
                      <div className="text-end">
                        <div className="font-medium">{formatCurrency(f.amount)}</div>
                        <div className="text-sm text-muted-foreground">
                          {f.fileCount} קבצים
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </ReportLayout>
  );
}
