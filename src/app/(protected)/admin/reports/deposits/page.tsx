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
  Wallet,
  Store,
  Building2,
  DollarSign,
  FileText,
  Calendar,
  CheckCircle2,
  Clock,
  AlertCircle,
  TrendingUp,
} from "lucide-react";
import {
  ReportLayout,
  ReportSummaryCards,
  ReportDataTable,
  type ColumnDef,
  type SummaryCardData,
} from "@/components/reports";
import { formatCurrency, formatDateHe, formatDateRange, formatNumber } from "@/lib/report-utils";

// ============================================================================
// TYPES
// ============================================================================

interface DepositEntry {
  id: string;
  franchiseeId: string;
  franchiseeName: string;
  brandId: string;
  brandNameHe: string;
  settlementPeriodId: string;
  settlementPeriodName: string;
  periodStartDate: string;
  periodEndDate: string;
  amount: number;
  reason: string;
  description: string | null;
  referenceNumber: string | null;
  effectiveDate: string | null;
  approvedAt: string | null;
  approvedByName: string | null;
  createdAt: string;
  createdByName: string | null;
  runningBalance: number;
  supplierId: string | null;
  supplierName: string | null;
}

interface DepositSummaryByFranchisee {
  franchiseeId: string;
  franchiseeName: string;
  brandId: string;
  brandNameHe: string;
  totalDeposits: number;
  depositCount: number;
  lastDepositDate: string | null;
  runningBalance: number;
}

interface DepositSummaryByBrand {
  brandId: string;
  brandNameHe: string;
  brandNameEn: string | null;
  totalDeposits: number;
  depositCount: number;
  franchiseeCount: number;
}

interface DepositsReport {
  summary: {
    totalDeposits: number;
    totalDepositAmount: number;
    affectedFranchisees: number;
    periodRange: {
      startDate: string | null;
      endDate: string | null;
    };
    generatedAt: string;
    hasSupplierDimension: boolean;
  };
  byFranchisee: DepositSummaryByFranchisee[];
  byBrand: DepositSummaryByBrand[];
  details: DepositEntry[];
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

const detailColumns: ColumnDef<DepositEntry>[] = [
  {
    id: "franchiseeName",
    header: "זכיין",
    accessorKey: "franchiseeName",
    className: "font-medium",
  },
  {
    id: "brandNameHe",
    header: "מותג",
    accessorKey: "brandNameHe",
  },
  {
    id: "amount",
    header: "סכום",
    accessor: (row) => formatCurrency(row.amount),
    accessorKey: "amount",
    className: "font-medium",
    cell: (row) => (
      <span className={row.amount >= 0 ? "text-green-600" : "text-red-600"}>
        {formatCurrency(row.amount)}
      </span>
    ),
  },
  {
    id: "runningBalance",
    header: "יתרה מצטברת",
    accessor: (row) => formatCurrency(row.runningBalance),
    accessorKey: "runningBalance",
    cell: (row) => (
      <Badge variant={row.runningBalance >= 0 ? "outline" : "destructive"}>
        {formatCurrency(row.runningBalance)}
      </Badge>
    ),
  },
  {
    id: "reason",
    header: "סיבה",
    accessorKey: "reason",
  },
  {
    id: "effectiveDate",
    header: "תאריך אפקטיבי",
    accessor: (row) => row.effectiveDate ? formatDateHe(row.effectiveDate) : "-",
    accessorKey: "effectiveDate",
  },
  {
    id: "status",
    header: "סטטוס",
    cell: (row) => (
      <Badge variant={row.approvedAt ? "default" : "secondary"}>
        {row.approvedAt ? (
          <span className="flex items-center gap-1">
            <CheckCircle2 className="h-3 w-3" />
            מאושר
          </span>
        ) : (
          <span className="flex items-center gap-1">
            <Clock className="h-3 w-3" />
            ממתין
          </span>
        )}
      </Badge>
    ),
    sortable: false,
  },
];

const franchiseeColumns: ColumnDef<DepositSummaryByFranchisee>[] = [
  {
    id: "franchiseeName",
    header: "זכיין",
    accessorKey: "franchiseeName",
    className: "font-medium",
  },
  {
    id: "brandNameHe",
    header: "מותג",
    accessorKey: "brandNameHe",
  },
  {
    id: "depositCount",
    header: "מספר פיקדונות",
    accessorKey: "depositCount",
  },
  {
    id: "totalDeposits",
    header: "סכום כולל",
    accessor: (row) => formatCurrency(row.totalDeposits),
    accessorKey: "totalDeposits",
    className: "font-medium",
    cell: (row) => (
      <span className={row.totalDeposits >= 0 ? "text-green-600" : "text-red-600"}>
        {formatCurrency(row.totalDeposits)}
      </span>
    ),
  },
  {
    id: "runningBalance",
    header: "יתרה",
    accessor: (row) => formatCurrency(row.runningBalance),
    accessorKey: "runningBalance",
    cell: (row) => (
      <Badge variant={row.runningBalance >= 0 ? "outline" : "destructive"}>
        {formatCurrency(row.runningBalance)}
      </Badge>
    ),
  },
  {
    id: "lastDepositDate",
    header: "תאריך אחרון",
    accessor: (row) => row.lastDepositDate ? formatDateHe(row.lastDepositDate) : "-",
    accessorKey: "lastDepositDate",
  },
];

const brandColumns: ColumnDef<DepositSummaryByBrand>[] = [
  {
    id: "brandNameHe",
    header: "מותג",
    accessorKey: "brandNameHe",
    className: "font-medium",
  },
  {
    id: "depositCount",
    header: "מספר פיקדונות",
    accessorKey: "depositCount",
  },
  {
    id: "franchiseeCount",
    header: "זכיינים",
    accessorKey: "franchiseeCount",
    cell: (row) => (
      <Badge variant="outline">{row.franchiseeCount} זכיינים</Badge>
    ),
  },
  {
    id: "totalDeposits",
    header: "סכום כולל",
    accessor: (row) => formatCurrency(row.totalDeposits),
    accessorKey: "totalDeposits",
    className: "font-medium",
    cell: (row) => (
      <span className={row.totalDeposits >= 0 ? "text-green-600" : "text-red-600"}>
        {formatCurrency(row.totalDeposits)}
      </span>
    ),
  },
];

// ============================================================================
// COMPONENT
// ============================================================================

export default function DepositsReportPage() {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const [report, setReport] = useState<DepositsReport | null>(null);
  const [brands, setBrands] = useState<FilterOption[]>([]);
  const [franchisees, setFranchisees] = useState<FilterOption[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [selectedBrand, setSelectedBrand] = useState("");
  const [selectedFranchisee, setSelectedFranchisee] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [minAmount, setMinAmount] = useState("");

  // Selected deposit for detail view
  const [selectedDeposit, setSelectedDeposit] = useState<DepositEntry | null>(null);

  const { data: session, isPending } = authClient.useSession();
  const userRole = session ? (session.user as { role?: string })?.role : undefined;

  // Redirect if not authenticated or not admin
  useEffect(() => {
    if (!isPending && !session) {
      router.push("/sign-in?redirect=/admin/reports/deposits");
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
      const response = await fetch(`/api/reports/deposits${queryString ? `?${queryString}` : ""}`);
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to fetch report");
      }
      const data = await response.json();
      setReport(data.report);
      setBrands(data.filters.brands || []);
      setFranchisees(data.filters.franchisees || []);
    } catch (err) {
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

  // Handle filter reset
  const handleResetFilters = () => {
    setSelectedBrand("");
    setSelectedFranchisee("");
    setStartDate("");
    setEndDate("");
    setMinAmount("");
  };

  // Filter franchisees by selected brand
  const filteredFranchisees = selectedBrand && selectedBrand !== "all"
    ? franchisees.filter((f) => f.brandId === selectedBrand)
    : franchisees;

  // Summary cards
  const summaryCards: SummaryCardData[] = report
    ? [
        {
          title: "סה״כ פיקדונות",
          value: formatNumber(report.summary.totalDeposits),
          subtitle: "רשומות פיקדון",
          icon: Wallet,
        },
        {
          title: "סכום כולל",
          value: formatCurrency(report.summary.totalDepositAmount),
          subtitle: report.summary.totalDepositAmount >= 0 ? "יתרה לזכות" : "יתרה לחובה",
          icon: DollarSign,
          variant: report.summary.totalDepositAmount >= 0 ? "success" : "danger",
        },
        {
          title: "זכיינים",
          value: formatNumber(report.summary.affectedFranchisees),
          subtitle: "זכיינים עם פיקדונות",
          icon: Store,
        },
        {
          title: "טווח תקופה",
          value:
            report.summary.periodRange.startDate && report.summary.periodRange.endDate
              ? `${formatDateHe(report.summary.periodRange.startDate)} - ${formatDateHe(report.summary.periodRange.endDate)}`
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

  if (!session) return null;

  return (
    <ReportLayout
      title="דוח פיקדונות"
      description="מעקב יתרות פיקדון לפי זכיין וספק"
      breadcrumbs={[
        { label: "ניהול", href: "/admin" },
        { label: "דוחות", href: "/admin/reports" },
        { label: "פיקדונות" },
      ]}
      isLoading={isLoading}
      onRefresh={fetchReport}
    >
      {/* Filters Card */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">סינון</CardTitle>
          <CardDescription>סנן לפי מותג, זכיין, תקופה או סכום מינימלי</CardDescription>
        </CardHeader>
        <CardContent>
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
          <Wallet className="h-4 w-4" />
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

          {/* Info Alert */}
          {report.summary.totalDeposits > 0 && (
            <Alert>
              <Wallet className="h-4 w-4" />
              <AlertTitle>מעקב פיקדונות</AlertTitle>
              <AlertDescription>
                נמצאו {report.summary.totalDeposits} רשומות פיקדון.
                סכום כולל: {formatCurrency(report.summary.totalDepositAmount)}.
                {report.summary.totalDepositAmount > 0
                  ? " יתרה לזכות הזכיינים."
                  : report.summary.totalDepositAmount < 0
                    ? " יתרה לחובת הזכיינים."
                    : " יתרה מאוזנת."}
              </AlertDescription>
            </Alert>
          )}

          {/* Supplier Dimension Notice */}
          {!report.summary.hasSupplierDimension && report.summary.totalDeposits > 0 && (
            <Alert variant="default">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>מידע על מימד ספק</AlertTitle>
              <AlertDescription>
                הנתונים הנוכחיים אינם כוללים מידע על ספקים. פיקדונות מוצגים לפי זכיין ומותג בלבד.
                כדי להוסיף מימד ספק, יש לכלול את פרטי הספק בעת יצירת רשומות פיקדון חדשות.
              </AlertDescription>
            </Alert>
          )}

          {/* Chronological Running Balance Notice */}
          {report.summary.totalDeposits > 0 && (
            <Alert variant="default">
              <TrendingUp className="h-4 w-4" />
              <AlertTitle>יתרה מצטברת כרונולוגית</AlertTitle>
              <AlertDescription>
                היתרה המצטברת בטבלת הפירוט מחושבת לפי סדר כרונולוגי של תאריכי הפיקדון.
                הערכים מייצגים את סכום כל הפיקדונות עד לנקודת זמן מסוימת.
              </AlertDescription>
            </Alert>
          )}

          {/* Tabs for different views */}
          <Tabs defaultValue="byFranchisee" className="w-full" dir="rtl">
            <TabsList className="flex w-full gap-1">
              <TabsTrigger value="byFranchisee" className="flex items-center gap-2">
                <Store className="h-4 w-4" />
                לפי זכיין
              </TabsTrigger>
              <TabsTrigger value="byBrand" className="flex items-center gap-2">
                <Building2 className="h-4 w-4" />
                לפי מותג
              </TabsTrigger>
              <TabsTrigger value="details" className="flex items-center gap-2">
                <FileText className="h-4 w-4" />
                פירוט מלא
              </TabsTrigger>
            </TabsList>

            {/* By Franchisee Tab */}
            <TabsContent value="byFranchisee">
              <Card>
                <CardHeader>
                  <CardTitle>יתרות פיקדון לפי זכיין</CardTitle>
                  <CardDescription>סיכום פיקדונות ויתרות מצטברות לכל זכיין</CardDescription>
                </CardHeader>
                <CardContent>
                  {report.byFranchisee.length === 0 ? (
                    <div className="text-center py-8">
                      <Wallet className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                      <h3 className="text-lg font-medium mb-2">אין פיקדונות</h3>
                      <p className="text-muted-foreground">
                        לא נמצאו רשומות פיקדון בתקופה הנבחרת
                      </p>
                    </div>
                  ) : (
                    <ReportDataTable
                      data={report.byFranchisee}
                      columns={franchiseeColumns}
                      rowKey="franchiseeId"
                      searchPlaceholder="חיפוש זכיין..."
                      emptyMessage="אין נתונים להצגה"
                    />
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            {/* By Brand Tab */}
            <TabsContent value="byBrand">
              <Card>
                <CardHeader>
                  <CardTitle>סיכום לפי מותג</CardTitle>
                  <CardDescription>פיקדונות מקובצים לפי מותג</CardDescription>
                </CardHeader>
                <CardContent>
                  {report.byBrand.length === 0 ? (
                    <div className="text-center py-8">
                      <Building2 className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                      <h3 className="text-lg font-medium mb-2">אין נתונים</h3>
                      <p className="text-muted-foreground">
                        לא נמצאו פיקדונות לפי מותג
                      </p>
                    </div>
                  ) : (
                    <ReportDataTable
                      data={report.byBrand}
                      columns={brandColumns}
                      rowKey="brandId"
                      enableSearch={false}
                      enablePagination={false}
                      emptyMessage="אין נתונים להצגה"
                    />
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            {/* Details Tab */}
            <TabsContent value="details">
              <Card>
                <CardHeader>
                  <CardTitle>פירוט מלא</CardTitle>
                  <CardDescription>כל רשומות הפיקדון בפירוט מלא</CardDescription>
                </CardHeader>
                <CardContent>
                  {report.details.length === 0 ? (
                    <div className="text-center py-8">
                      <FileText className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                      <h3 className="text-lg font-medium mb-2">אין רשומות</h3>
                      <p className="text-muted-foreground">
                        לא נמצאו רשומות פיקדון בתקופה הנבחרת
                      </p>
                    </div>
                  ) : (
                    <ReportDataTable
                      data={report.details}
                      columns={detailColumns}
                      rowKey="id"
                      searchPlaceholder="חיפוש..."
                      onRowClick={(row) => setSelectedDeposit(row)}
                      highlightOnHover
                      emptyMessage="אין נתונים להצגה"
                    />
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>

          {/* Deposit Detail Card */}
          {selectedDeposit && (
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle>פרטי פיקדון</CardTitle>
                    <CardDescription>
                      {selectedDeposit.franchiseeName} | {formatCurrency(selectedDeposit.amount)}
                    </CardDescription>
                  </div>
                  <Button variant="outline" onClick={() => setSelectedDeposit(null)}>
                    סגור
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <p className="text-sm text-muted-foreground">זכיין</p>
                    <p className="font-medium">{selectedDeposit.franchiseeName}</p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-sm text-muted-foreground">מותג</p>
                    <p className="font-medium">{selectedDeposit.brandNameHe}</p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-sm text-muted-foreground">סכום</p>
                    <p className={`font-medium ${selectedDeposit.amount >= 0 ? "text-green-600" : "text-red-600"}`}>
                      {formatCurrency(selectedDeposit.amount)}
                    </p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-sm text-muted-foreground">סיבה</p>
                    <p className="font-medium">{selectedDeposit.reason}</p>
                  </div>
                  {selectedDeposit.description && (
                    <div className="col-span-2 space-y-1">
                      <p className="text-sm text-muted-foreground">תיאור</p>
                      <p>{selectedDeposit.description}</p>
                    </div>
                  )}
                  <div className="space-y-1">
                    <p className="text-sm text-muted-foreground">תקופה</p>
                    <p>{formatDateRange(selectedDeposit.periodStartDate, selectedDeposit.periodEndDate)}</p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-sm text-muted-foreground">תאריך אפקטיבי</p>
                    <p>{selectedDeposit.effectiveDate ? formatDateHe(selectedDeposit.effectiveDate) : "-"}</p>
                  </div>
                  {selectedDeposit.referenceNumber && (
                    <div className="space-y-1">
                      <p className="text-sm text-muted-foreground">מספר אסמכתא</p>
                      <p>{selectedDeposit.referenceNumber}</p>
                    </div>
                  )}
                  <div className="space-y-1">
                    <p className="text-sm text-muted-foreground">סטטוס</p>
                    <Badge variant={selectedDeposit.approvedAt ? "default" : "secondary"}>
                      {selectedDeposit.approvedAt ? "מאושר" : "ממתין לאישור"}
                    </Badge>
                  </div>
                  {selectedDeposit.approvedByName && (
                    <div className="space-y-1">
                      <p className="text-sm text-muted-foreground">אושר ע״י</p>
                      <p>{selectedDeposit.approvedByName}</p>
                    </div>
                  )}
                  <div className="space-y-1">
                    <p className="text-sm text-muted-foreground">נוצר ע״י</p>
                    <p>{selectedDeposit.createdByName || "-"}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </ReportLayout>
  );
}
