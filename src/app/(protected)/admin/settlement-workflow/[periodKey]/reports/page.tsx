"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { useRouter, useParams } from "next/navigation";
import Link from "next/link";
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
  ChevronRight,
  RefreshCw,
  Download,
  FileText,
  Building2,
  Users,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import type { UserRole } from "@/db/schema";
import { getPeriodByKey } from "@/lib/settlement-periods";
import { formatCurrency } from "@/lib/translations";

// Types
interface ReportSummary {
  totalCommissions: number;
  totalGrossAmount: number;
  totalNetAmount: number;
  totalCommissionAmount: number;
  avgCommissionRate: number;
  totalAdjustments: number;
  grandTotal: number;
}

interface BrandSummary {
  brandId: string;
  brandNameHe: string;
  brandNameEn: string | null;
  commissionCount: number;
  totalGrossAmount: number;
  totalNetAmount: number;
  totalCommissionAmount: number;
  avgCommissionRate: number;
}

interface SupplierSummary {
  supplierId: string;
  supplierName: string;
  supplierCode: string;
  commissionCount: number;
  totalGrossAmount: number;
  totalNetAmount: number;
  totalCommissionAmount: number;
  avgCommissionRate: number;
}

interface AdjustmentSummary {
  id: string;
  type: string;
  amount: number;
  reason: string;
  description: string | null;
  approved: boolean;
}

interface ReportData {
  periodKey: string;
  periodInfo: {
    nameHe: string;
    name: string;
    type: string;
    startDate: string;
    endDate: string;
  };
  settlementStatus: string;
  approvedAt: string | null;
  generatedAt: string;
  summary: ReportSummary;
  byBrand: BrandSummary[];
  bySupplier: SupplierSummary[];
  adjustments: AdjustmentSummary[];
}

// Adjustment type labels
const adjustmentTypeLabels: Record<string, string> = {
  credit: "זיכוי",
  debit: "חיוב",
  refund: "החזר",
  penalty: "קנס",
  bonus: "בונוס",
  deposit: "פיקדון",
  supplier_error: "טעות ספק",
  timing: "הפרשי עיתוי",
  other: "אחר",
};

export default function ReportsPage() {
  const router = useRouter();
  const params = useParams();
  const periodKey = decodeURIComponent(params.periodKey as string);

  const [isLoading, setIsLoading] = useState(true);
  const [isExporting, setIsExporting] = useState(false);
  const [reportData, setReportData] = useState<ReportData | null>(null);

  const { data: session, isPending } = authClient.useSession();
  const userRole = session
    ? (session.user as { role?: UserRole })?.role
    : undefined;

  // Parse period info from key (memoized to prevent infinite loop)
  const periodInfo = useMemo(() => getPeriodByKey(periodKey), [periodKey]);

  const fetchReportData = useCallback(async () => {
    try {
      setIsLoading(true);
      const response = await fetch(`/api/settlement-workflow/${encodeURIComponent(periodKey)}/reports`);
      if (!response.ok) {
        throw new Error("Failed to fetch report data");
      }
      const data = await response.json();
      setReportData(data);
    } catch (error) {
      console.error("Error fetching report data:", error);
      toast.error("שגיאה בטעינת הדוח");
    } finally {
      setIsLoading(false);
    }
  }, [periodKey]);

  useEffect(() => {
    if (!isPending && !session) {
      router.push(`/sign-in?redirect=/admin/settlement-workflow/${encodeURIComponent(periodKey)}/reports`);
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

    if (!isPending && session && periodInfo) {
      fetchReportData();
    }
  }, [session, isPending, router, userRole, periodKey, periodInfo, fetchReportData]);

  const handleExportExcel = async (includeDetails: boolean = false) => {
    setIsExporting(true);
    try {
      const response = await fetch(
        `/api/settlement-workflow/${encodeURIComponent(periodKey)}/reports?format=excel&includeDetails=${includeDetails}`
      );

      if (!response.ok) {
        throw new Error("Failed to export report");
      }

      // Get the blob and download it
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `report-${periodKey}.csv`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      toast.success("הדוח יוצא בהצלחה");
    } catch (error) {
      console.error("Error exporting report:", error);
      toast.error("שגיאה בייצוא הדוח");
    } finally {
      setIsExporting(false);
    }
  };

  if (!periodInfo) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center">
          <h2 className="text-xl font-semibold mb-2">תקופה לא נמצאה</h2>
          <p className="text-muted-foreground mb-4">מפתח תקופה: {periodKey}</p>
          <Button onClick={() => router.push("/admin/settlements")}>
            חזרה לרשימת התקופות
          </Button>
        </div>
      </div>
    );
  }

  if (isLoading || isPending) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          <Link href={`/admin/settlement-workflow/${encodeURIComponent(periodKey)}`}>
            <Button variant="ghost" size="sm">
              <ChevronRight className="h-4 w-4 ms-1" />
              חזרה לתקופה
            </Button>
          </Link>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold">דוחות</h1>
              <Badge variant="outline">{periodInfo.nameHe}</Badge>
            </div>
            <p className="text-muted-foreground text-sm">
              {periodInfo.startDate?.toLocaleDateString("he-IL", { day: "numeric", month: "short", year: "numeric" })} - {periodInfo.endDate?.toLocaleDateString("he-IL", { day: "numeric", month: "short", year: "numeric" })}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={fetchReportData}>
            <RefreshCw className="me-2 h-4 w-4" />
            רענון
          </Button>
          <Button onClick={() => handleExportExcel(false)} disabled={isExporting}>
            {isExporting ? (
              <Loader2 className="me-2 h-4 w-4 animate-spin" />
            ) : (
              <Download className="me-2 h-4 w-4" />
            )}
            ייצוא Excel
          </Button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid gap-4 md:grid-cols-4 mb-6">
        <Card>
          <CardContent className="pt-6">
            <div className="text-2xl font-bold">{formatCurrency(reportData?.summary.totalGrossAmount || 0)}</div>
            <p className="text-muted-foreground text-sm">סה"כ כולל מע״מ</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-2xl font-bold">{formatCurrency(reportData?.summary.totalNetAmount || 0)}</div>
            <p className="text-muted-foreground text-sm">סה"כ לפני מע״מ</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-2xl font-bold text-green-600">{formatCurrency(reportData?.summary.totalCommissionAmount || 0)}</div>
            <p className="text-muted-foreground text-sm">סה"כ עמלות</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-2xl font-bold text-primary">{formatCurrency(reportData?.summary.grandTotal || 0)}</div>
            <p className="text-muted-foreground text-sm">סה"כ סופי (כולל התאמות)</p>
          </CardContent>
        </Card>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="byBrand" className="space-y-4">
        <TabsList>
          <TabsTrigger value="byBrand" className="flex items-center gap-2">
            <Building2 className="h-4 w-4" />
            לפי מותג
          </TabsTrigger>
          <TabsTrigger value="bySupplier" className="flex items-center gap-2">
            <Users className="h-4 w-4" />
            לפי ספק
          </TabsTrigger>
          <TabsTrigger value="adjustments" className="flex items-center gap-2">
            <FileText className="h-4 w-4" />
            התאמות
          </TabsTrigger>
        </TabsList>

        {/* By Brand Tab */}
        <TabsContent value="byBrand">
          <Card>
            <CardHeader>
              <CardTitle>סיכום לפי מותג</CardTitle>
              <CardDescription>פירוט עמלות לפי מותג</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-right">מותג</TableHead>
                    <TableHead className="text-right">מס' עמלות</TableHead>
                    <TableHead className="text-right">כולל מע״מ</TableHead>
                    <TableHead className="text-right">לפני מע״מ</TableHead>
                    <TableHead className="text-right">עמלות</TableHead>
                    <TableHead className="text-right">% ממוצע</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {reportData?.byBrand.map((brand) => (
                    <TableRow key={brand.brandId}>
                      <TableCell className="font-medium">{brand.brandNameHe}</TableCell>
                      <TableCell>{brand.commissionCount}</TableCell>
                      <TableCell dir="ltr" className="text-start">
                        {formatCurrency(brand.totalGrossAmount)}
                      </TableCell>
                      <TableCell dir="ltr" className="text-start">
                        {formatCurrency(brand.totalNetAmount)}
                      </TableCell>
                      <TableCell dir="ltr" className="text-start font-medium text-green-600">
                        {formatCurrency(brand.totalCommissionAmount)}
                      </TableCell>
                      <TableCell dir="ltr" className="text-start">
                        {brand.avgCommissionRate.toFixed(2)}%
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {(!reportData?.byBrand || reportData.byBrand.length === 0) && (
                <div className="text-center py-8 text-muted-foreground">
                  אין נתונים להצגה
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* By Supplier Tab */}
        <TabsContent value="bySupplier">
          <Card>
            <CardHeader>
              <CardTitle>סיכום לפי ספק</CardTitle>
              <CardDescription>פירוט עמלות לפי ספק</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-right">ספק</TableHead>
                    <TableHead className="text-right">קוד</TableHead>
                    <TableHead className="text-right">מס' עמלות</TableHead>
                    <TableHead className="text-right">כולל מע״מ</TableHead>
                    <TableHead className="text-right">לפני מע״מ</TableHead>
                    <TableHead className="text-right">עמלות</TableHead>
                    <TableHead className="text-right">% ממוצע</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {reportData?.bySupplier.map((supplier) => (
                    <TableRow key={supplier.supplierId}>
                      <TableCell className="font-medium">{supplier.supplierName}</TableCell>
                      <TableCell>{supplier.supplierCode}</TableCell>
                      <TableCell>{supplier.commissionCount}</TableCell>
                      <TableCell dir="ltr" className="text-start">
                        {formatCurrency(supplier.totalGrossAmount)}
                      </TableCell>
                      <TableCell dir="ltr" className="text-start">
                        {formatCurrency(supplier.totalNetAmount)}
                      </TableCell>
                      <TableCell dir="ltr" className="text-start font-medium text-green-600">
                        {formatCurrency(supplier.totalCommissionAmount)}
                      </TableCell>
                      <TableCell dir="ltr" className="text-start">
                        {supplier.avgCommissionRate.toFixed(2)}%
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {(!reportData?.bySupplier || reportData.bySupplier.length === 0) && (
                <div className="text-center py-8 text-muted-foreground">
                  אין נתונים להצגה
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Adjustments Tab */}
        <TabsContent value="adjustments">
          <Card>
            <CardHeader>
              <CardTitle>התאמות</CardTitle>
              <CardDescription>
                סה"כ התאמות: {formatCurrency(reportData?.summary.totalAdjustments || 0)}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-right">סוג</TableHead>
                    <TableHead className="text-right">סכום</TableHead>
                    <TableHead className="text-right">סיבה</TableHead>
                    <TableHead className="text-right">תיאור</TableHead>
                    <TableHead className="text-right">סטטוס</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {reportData?.adjustments.map((adj) => (
                    <TableRow key={adj.id}>
                      <TableCell>
                        <Badge variant="secondary">
                          {adjustmentTypeLabels[adj.type] || adj.type}
                        </Badge>
                      </TableCell>
                      <TableCell
                        dir="ltr"
                        className={`text-start font-medium ${
                          adj.amount >= 0 ? "text-green-600" : "text-red-600"
                        }`}
                      >
                        {formatCurrency(adj.amount)}
                      </TableCell>
                      <TableCell>{adj.reason}</TableCell>
                      <TableCell className="max-w-[200px] truncate" title={adj.description || ""}>
                        {adj.description || "-"}
                      </TableCell>
                      <TableCell>
                        <Badge variant={adj.approved ? "default" : "outline"}>
                          {adj.approved ? "מאושר" : "ממתין"}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {(!reportData?.adjustments || reportData.adjustments.length === 0) && (
                <div className="text-center py-8 text-muted-foreground">
                  אין התאמות בתקופה זו
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
