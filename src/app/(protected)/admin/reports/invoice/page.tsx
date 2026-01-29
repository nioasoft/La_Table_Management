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
  Loader2,
  DollarSign,
  Building2,
  FileSpreadsheet,
  Receipt,
  ShoppingBag,
  RefreshCw,
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
import { formatCurrency, formatDateHe } from "@/lib/report-utils";
import { toast } from "sonner";

// ============================================================================
// TYPES
// ============================================================================

interface Supplier {
  id: string;
  name: string;
  code: string;
}

interface BrandGroup {
  brandId: string;
  brandNameHe: string;
  brandNameEn: string | null;
  brandCode: string;
  summary: {
    commissionCount: number;
    totalGrossAmount: number;
    totalNetAmount: number;
    totalCommissionAmount: number;
    avgCommissionRate: number;
  };
}

interface InvoiceData {
  supplierId: string;
  supplierName: string;
  supplierCode: string;
  periodStartDate: string;
  periodEndDate: string;
  byBrand: BrandGroup[];
  totals: {
    totalBrands: number;
    totalCommissions: number;
    totalGrossAmount: number;
    totalNetAmount: number;
    totalCommissionAmount: number;
  };
  generatedAt: string;
}

// ============================================================================
// COLUMN DEFINITIONS
// ============================================================================

const brandColumns: ColumnDef<BrandGroup>[] = [
  {
    id: "brandCode",
    header: "קוד מותג",
    accessorKey: "brandCode",
    className: "font-mono text-sm",
  },
  {
    id: "brandNameHe",
    header: "שם מותג",
    accessor: (row) => (
      <div>
        <p className="font-medium">{row.brandNameHe}</p>
        {row.brandNameEn && (
          <p className="text-xs text-muted-foreground">{row.brandNameEn}</p>
        )}
      </div>
    ),
    accessorKey: "brandNameHe",
  },
  {
    id: "commissionCount",
    header: "מספר עמלות",
    accessor: (row) => row.summary.commissionCount,
    sortable: false,
  },
  {
    id: "totalGrossAmount",
    header: "סכום כולל מע״מ",
    accessor: (row) => formatCurrency(row.summary.totalGrossAmount),
    sortable: false,
  },
  {
    id: "totalNetAmount",
    header: "סכום לפני מע״מ",
    accessor: (row) => formatCurrency(row.summary.totalNetAmount),
    sortable: false,
  },
  {
    id: "avgCommissionRate",
    header: "שיעור עמלה ממוצע",
    accessor: (row) => `${row.summary.avgCommissionRate.toFixed(2)}%`,
    sortable: false,
  },
  {
    id: "totalCommissionAmount",
    header: "סכום חשבונית",
    accessor: (row) => formatCurrency(row.summary.totalCommissionAmount),
    className: "font-bold text-primary",
    sortable: false,
  },
];

// ============================================================================
// COMPONENT
// ============================================================================

export default function InvoiceReportPage() {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const [invoiceData, setInvoiceData] = useState<InvoiceData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);

  // Filter state
  const [selectedSupplierId, setSelectedSupplierId] = useState<string>("");
  const [periodStartDate, setPeriodStartDate] = useState<string>("");
  const [periodEndDate, setPeriodEndDate] = useState<string>("");
  const [status, setStatus] = useState<string>("all");
  const [periodType, setPeriodType] = useState<SettlementPeriodType | "">("");
  const [periodKey, setPeriodKey] = useState("");
  const [useCustomDateRange, setUseCustomDateRange] = useState(true);

  const { data: session, isPending } = authClient.useSession();
  const userRole = session
    ? (session.user as { role?: string })?.role
    : undefined;

  // Redirect if not authenticated or not super user
  useEffect(() => {
    if (!isPending && !session) {
      router.push("/sign-in?redirect=/admin/reports/invoice");
      return;
    }
    if (!isPending && session?.user && userRole !== "super_user") {
      router.push("/dashboard");
      return;
    }

    // Set default dates to current month
    if (!isPending && session) {
      const now = new Date();
      const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
      const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      setPeriodStartDate(formatDateAsLocal(firstDay));
      setPeriodEndDate(formatDateAsLocal(lastDay));
    }
  }, [isPending, session, userRole, router]);

  // Fetch suppliers for dropdown
  const fetchSuppliers = useCallback(async () => {
    try {
      const response = await fetch("/api/suppliers?filter=active");
      if (!response.ok) throw new Error("Failed to fetch suppliers");
      const data = await response.json();
      setSuppliers(data.suppliers || []);
    } catch (err) {
      console.error("Error fetching suppliers:", err);
      toast.error("שגיאה בטעינת רשימת הספקים. נסה שוב.");
    }
  }, []);

  // Initial load - fetch suppliers
  useEffect(() => {
    if (session && userRole === "super_user") {
      fetchSuppliers();
    }
  }, [session, userRole, fetchSuppliers]);

  // Handle period change
  const handlePeriodChange = (newPeriodType: SettlementPeriodType | "", newPeriodKey: string) => {
    setPeriodType(newPeriodType);
    setPeriodKey(newPeriodKey);
    setUseCustomDateRange(!newPeriodType);

    if (newPeriodKey) {
      const period = getPeriodByKey(newPeriodKey);
      if (period) {
        setPeriodStartDate(formatDateAsLocal(period.startDate));
        setPeriodEndDate(formatDateAsLocal(period.endDate));
      }
    }
  };

  // Fetch invoice data
  const fetchInvoiceData = useCallback(async () => {
    if (!selectedSupplierId || !periodStartDate || !periodEndDate) return;

    setIsLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        supplierId: selectedSupplierId,
        periodStartDate,
        periodEndDate,
      });
      if (status && status !== "all") params.append("status", status);

      const response = await fetch(`/api/reports/invoice?${params.toString()}`);
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "שגיאה בטעינת נתוני החשבונית");
      }
      const data = await response.json();
      setInvoiceData(data.invoiceData);
    } catch (err) {
      console.error("Error fetching invoice data:", err);
      const errorMessage = err instanceof Error ? err.message : "שגיאה בטעינת נתוני החשבונית";
      setError(errorMessage);
      setInvoiceData(null);
      toast.error("שגיאה בטעינת הנתונים. נסה שוב.");
    } finally {
      setIsLoading(false);
    }
  }, [selectedSupplierId, periodStartDate, periodEndDate, status]);

  // Build query string for export
  const buildQueryString = useCallback((): string => {
    const params = new URLSearchParams();
    if (selectedSupplierId) params.set("supplierId", selectedSupplierId);
    if (periodStartDate) params.set("periodStartDate", periodStartDate);
    if (periodEndDate) params.set("periodEndDate", periodEndDate);
    if (status && status !== "all") params.set("status", status);
    return params.toString();
  }, [selectedSupplierId, periodStartDate, periodEndDate, status]);

  // Build summary cards
  const summaryCards: SummaryCardData[] = invoiceData
    ? [
        {
          title: "מספר מותגים",
          value: invoiceData.totals.totalBrands.toString(),
          subtitle: "חשבוניות נפרדות",
          icon: ShoppingBag,
        },
        {
          title: "מספר עמלות",
          value: invoiceData.totals.totalCommissions.toString(),
          subtitle: "רשומות עמלה בסה״כ",
          icon: FileSpreadsheet,
        },
        {
          title: "סכום לפני מע״מ",
          value: formatCurrency(invoiceData.totals.totalNetAmount),
          subtitle: "לפני מע״מ",
          icon: DollarSign,
        },
        {
          title: "סכום חשבונית",
          value: formatCurrency(invoiceData.totals.totalCommissionAmount),
          subtitle: "סה״כ לתשלום",
          icon: Receipt,
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

  const canSearch = selectedSupplierId && periodStartDate && periodEndDate;

  return (
    <ReportLayout
      title="דוח חשבוניות"
      description="הפקת חשבוניות לספקים לפי מותג ותקופה"
      breadcrumbs={[
        { label: "ניהול", href: "/admin" },
        { label: "דוחות", href: "/admin/reports" },
        { label: "חשבוניות" },
      ]}
      isLoading={isLoading}
      onRefresh={canSearch ? fetchInvoiceData : undefined}
      actions={
        <div className="flex items-center gap-2">
          <Badge variant="secondary" className="gap-1">
            <Receipt className="h-3 w-3" />
            משתמש על בלבד
          </Badge>
          <ReportExportButton
            endpoints={{
              excel: "/api/commissions/invoice/export",
              pdf: "/api/reports/invoice/pdf",
            }}
            queryString={buildQueryString()}
            reportType="invoice"
            disabled={!invoiceData}
          />
        </div>
      }
    >
      {/* Filters Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Building2 className="h-5 w-5" />
            בחירת ספק ותקופה
          </CardTitle>
          <CardDescription>
            בחר ספק ותקופת התחשבנות להצגת נתוני החשבונית
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Supplier Selection */}
          <div className="space-y-2">
            <Label>ספק *</Label>
            <Select
              value={selectedSupplierId}
              onValueChange={setSelectedSupplierId}
            >
              <SelectTrigger className="max-w-md">
                <SelectValue placeholder="בחר ספק" />
              </SelectTrigger>
              <SelectContent>
                {suppliers.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name} ({s.code})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

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

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Date inputs - only show when using custom range */}
            {useCustomDateRange && (
              <>
                {/* Period Start Date */}
                <div className="space-y-2">
                  <Label>מתאריך *</Label>
                  <Input
                    type="date"
                    value={periodStartDate}
                    onChange={(e) => setPeriodStartDate(e.target.value)}
                  />
                </div>

                {/* Period End Date */}
                <div className="space-y-2">
                  <Label>עד תאריך *</Label>
                  <Input
                    type="date"
                    value={periodEndDate}
                    onChange={(e) => setPeriodEndDate(e.target.value)}
                  />
                </div>
              </>
            )}

            {/* Status Filter */}
            <div className="space-y-2">
              <Label>סטטוס עמלות</Label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger>
                  <SelectValue placeholder="כל הסטטוסים" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">כל הסטטוסים</SelectItem>
                  <SelectItem value="approved">מאושר</SelectItem>
                  <SelectItem value="calculated">מחושב</SelectItem>
                  <SelectItem value="paid">שולם</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Actions */}
          <div className="flex justify-end mt-6 pt-4 border-t">
            <Button
              onClick={fetchInvoiceData}
              disabled={!canSearch || isLoading}
            >
              {isLoading ? (
                <Loader2 className="h-4 w-4 animate-spin me-2" />
              ) : (
                <RefreshCw className="h-4 w-4 me-2" />
              )}
              הצג נתונים
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Error Message */}
      {error && (
        <Card className="border-destructive bg-destructive/10">
          <CardContent className="py-4">
            <p className="text-destructive">{error}</p>
          </CardContent>
        </Card>
      )}

      {/* Loading State */}
      {isLoading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      )}

      {/* Report Content */}
      {!isLoading && invoiceData && (
        <>
          {/* Supplier Info Card */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <Building2 className="h-5 w-5" />
                    {invoiceData.supplierName}
                  </CardTitle>
                  <CardDescription>
                    קוד ספק: {invoiceData.supplierCode} | תקופה:{" "}
                    {formatDateHe(invoiceData.periodStartDate)} -{" "}
                    {formatDateHe(invoiceData.periodEndDate)}
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
          </Card>

          {/* Summary Cards */}
          <ReportSummaryCards cards={summaryCards} columns={4} />

          {/* By Brand Table */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Receipt className="h-5 w-5" />
                פירוט לפי מותג
              </CardTitle>
              <CardDescription>
                כל מותג יקבל חשבונית נפרדת עם הסכום המתאים
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ReportDataTable
                data={invoiceData.byBrand}
                columns={brandColumns}
                rowKey="brandId"
                enableSearch={false}
                enablePagination={false}
                enableSorting={false}
                emptyMessage="לא נמצאו נתונים לתקופה והספק שנבחרו"
              />
              {/* Totals Row */}
              {invoiceData.byBrand.length > 0 && (
                <div className="border-t bg-muted/30 p-4 mt-2 rounded-b-md">
                  <div className="flex justify-between items-center font-bold">
                    <span>
                      סה״כ ({invoiceData.totals.totalBrands} חשבוניות)
                    </span>
                    <div className="flex gap-8">
                      <span>{invoiceData.totals.totalCommissions} עמלות</span>
                      <span>
                        כולל מע״מ: {formatCurrency(invoiceData.totals.totalGrossAmount)}
                      </span>
                      <span>
                        לפני מע״מ: {formatCurrency(invoiceData.totals.totalNetAmount)}
                      </span>
                      <span className="text-lg text-primary">
                        {formatCurrency(invoiceData.totals.totalCommissionAmount)}
                      </span>
                    </div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Export Instructions */}
          <Card className="bg-muted/30">
            <CardContent className="py-4">
              <div className="flex items-start gap-4">
                <FileSpreadsheet className="h-6 w-6 text-muted-foreground mt-1" />
                <div>
                  <h3 className="font-semibold">ייצוא לאקסל</h3>
                  <p className="text-sm text-muted-foreground mb-2">
                    הקובץ המיוצא מכיל מספר גליונות:
                  </p>
                  <ul className="text-sm text-muted-foreground list-disc list-inside space-y-1">
                    <li>
                      <strong>סיכום</strong> - פרטי ספק ותקופה עם סיכומים כלליים
                    </li>
                    <li>
                      <strong>סיכום לפי מותג</strong> - סכומים מצטברים לכל מותג
                    </li>
                    <li>
                      <strong>חשבונית - [שם מותג]</strong> - גליון נפרד לכל מותג
                      עם פירוט מלא
                    </li>
                    <li>
                      <strong>פירוט מלא</strong> - כל העמלות הבודדות ברשימה אחת
                    </li>
                    <li>
                      <strong>הכנה לחשבשבת</strong> - נתונים מובנים לייבוא עתידי
                      לחשבשבת
                    </li>
                  </ul>
                </div>
              </div>
            </CardContent>
          </Card>
        </>
      )}

      {/* Empty State */}
      {!isLoading && !invoiceData && !error && (
        <Card className="py-12">
          <CardContent className="text-center">
            <Receipt className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">בחר ספק ותקופה</h3>
            <p className="text-muted-foreground">
              בחר ספק ותקופת התחשבנות כדי להציג את נתוני החשבונית
            </p>
          </CardContent>
        </Card>
      )}
    </ReportLayout>
  );
}
