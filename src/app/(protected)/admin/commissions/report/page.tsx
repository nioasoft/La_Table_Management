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
  LogOut,
  RefreshCw,
  Download,
  FileSpreadsheet,
  FileText,
  Loader2,
  Calendar,
  DollarSign,
  Percent,
  TrendingUp,
  Building2,
  Store,
  Users,
  ChevronRight,
} from "lucide-react";
import Link from "next/link";
import { formatCurrency } from "@/lib/translations";

// Types matching the API response
interface CommissionWithDetails {
  id: string;
  supplierId: string;
  supplierName: string;
  supplierCode: string;
  franchiseeId: string;
  franchiseeName: string;
  franchiseeCode: string;
  brandId: string;
  brandNameHe: string;
  brandNameEn: string | null;
  periodStartDate: string;
  periodEndDate: string;
  status: string;
  grossAmount: string;
  netAmount: string | null;
  commissionRate: string;
  commissionAmount: string;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  notes: string | null;
  createdAt: string;
}

interface CommissionSummaryByBrand {
  brandId: string;
  brandNameHe: string;
  brandNameEn: string | null;
  commissionCount: number;
  totalGrossAmount: number;
  totalNetAmount: number;
  totalCommissionAmount: number;
  avgCommissionRate: number;
}

interface CommissionSummaryByPeriod {
  periodStartDate: string;
  periodEndDate: string;
  commissionCount: number;
  totalGrossAmount: number;
  totalNetAmount: number;
  totalCommissionAmount: number;
}

interface CommissionSummaryBySupplier {
  supplierId: string;
  supplierName: string;
  supplierCode: string;
  commissionCount: number;
  totalGrossAmount: number;
  totalNetAmount: number;
  totalCommissionAmount: number;
  avgCommissionRate: number;
}

interface CommissionReport {
  summary: {
    totalCommissions: number;
    totalGrossAmount: number;
    totalNetAmount: number;
    totalCommissionAmount: number;
    avgCommissionRate: number;
    periodRange: {
      startDate: string | null;
      endDate: string | null;
    };
    generatedAt: string;
  };
  byBrand: CommissionSummaryByBrand[];
  byPeriod: CommissionSummaryByPeriod[];
  bySupplier: CommissionSummaryBySupplier[];
  details: CommissionWithDetails[];
}

interface FilterOption {
  id: string;
  nameHe?: string;
  nameEn?: string | null;
  name?: string;
  code?: string;
}

// Format percentage
const formatPercent = (rate: number): string => {
  return `${rate.toFixed(2)}%`;
};

// Format date for display
const formatDate = (dateStr: string): string => {
  if (!dateStr) return "";
  return new Date(dateStr).toLocaleDateString("he-IL");
};

// Get status badge
const getStatusBadge = (status: string) => {
  const statusConfig: Record<
    string,
    { label: string; variant: "default" | "secondary" | "destructive" | "outline" | "success" }
  > = {
    pending: { label: "ממתין", variant: "secondary" },
    calculated: { label: "חושב", variant: "outline" },
    approved: { label: "מאושר", variant: "success" },
    paid: { label: "שולם", variant: "default" },
    cancelled: { label: "בוטל", variant: "destructive" },
  };

  const config = statusConfig[status] || { label: status, variant: "outline" as const };
  return <Badge variant={config.variant}>{config.label}</Badge>;
};

export default function CommissionReportPage() {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isExportingPDF, setIsExportingPDF] = useState(false);
  const [report, setReport] = useState<CommissionReport | null>(null);
  const [brands, setBrands] = useState<FilterOption[]>([]);
  const [suppliers, setSuppliers] = useState<FilterOption[]>([]);

  // Filters
  const [startDate, setStartDate] = useState<string>("");
  const [endDate, setEndDate] = useState<string>("");
  const [selectedBrand, setSelectedBrand] = useState<string>("");
  const [selectedSupplier, setSelectedSupplier] = useState<string>("");
  const [selectedStatus, setSelectedStatus] = useState<string>("");

  const { data: session, isPending } = authClient.useSession();
  const userRole = session
    ? (session.user as { role?: string })?.role
    : undefined;

  // Redirect if not authenticated or not admin
  useEffect(() => {
    if (!isPending && !session) {
      router.push("/sign-in?redirect=/admin/commissions/report");
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
    if (startDate) params.set("startDate", startDate);
    if (endDate) params.set("endDate", endDate);
    if (selectedBrand && selectedBrand !== "all") params.set("brandId", selectedBrand);
    if (selectedSupplier && selectedSupplier !== "all") params.set("supplierId", selectedSupplier);
    if (selectedStatus && selectedStatus !== "all") params.set("status", selectedStatus);
    return params.toString();
  }, [startDate, endDate, selectedBrand, selectedSupplier, selectedStatus]);

  // Fetch report data
  const fetchReport = useCallback(async () => {
    setIsLoading(true);
    try {
      const queryString = buildQueryString();
      const response = await fetch(
        `/api/commissions/report${queryString ? `?${queryString}` : ""}`
      );

      if (!response.ok) {
        throw new Error("Failed to fetch report");
      }

      const data = await response.json();
      setReport(data.report);
      setBrands(data.filters.brands);
      setSuppliers(data.filters.suppliers);
    } catch (error) {
      console.error("Error fetching report:", error);
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
        `/api/commissions/report/export${queryString ? `?${queryString}` : ""}`
      );

      if (!response.ok) {
        throw new Error("Failed to export report");
      }

      // Download the file
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `commission_report_${new Date().toISOString().split("T")[0]}.xlsx`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (error) {
      console.error("Error exporting report:", error);
    } finally {
      setIsExporting(false);
    }
  };

  // Handle export to PDF
  const handleExportPDF = async () => {
    setIsExportingPDF(true);
    try {
      const queryString = buildQueryString();
      const response = await fetch(
        `/api/commissions/report/export-pdf${queryString ? `?${queryString}` : ""}`
      );

      if (!response.ok) {
        throw new Error("Failed to export report to PDF");
      }

      // Download the file
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `commission_report_${new Date().toISOString().split("T")[0]}.pdf`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (error) {
      console.error("Error exporting report to PDF:", error);
    } finally {
      setIsExportingPDF(false);
    }
  };

  // Handle filter apply
  const handleApplyFilters = () => {
    fetchReport();
  };

  // Handle filter reset
  const handleResetFilters = () => {
    setStartDate("");
    setEndDate("");
    setSelectedBrand("");
    setSelectedSupplier("");
    setSelectedStatus("");
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
              ניהול
            </Link>
            <ChevronRight className="h-4 w-4 rotate-180" />
            <span className="text-foreground">דוח עמלות</span>
          </nav>
          <h1 className="text-3xl font-bold tracking-tight">דוח עמלות רשת</h1>
          <p className="text-muted-foreground mt-1">
            סיכום עמלות כולל עם פירוט לפי מותג ותקופה
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={() => fetchReport()}
            disabled={isLoading}
          >
            <RefreshCw
              className={`h-4 w-4 me-2 ${isLoading ? "animate-spin" : ""}`}
            />
            רענון
          </Button>
          <Button
            onClick={handleExport}
            disabled={isExporting || !report}
            className="bg-green-600 hover:bg-green-700"
          >
            {isExporting ? (
              <Loader2 className="h-4 w-4 me-2 animate-spin" />
            ) : (
              <FileSpreadsheet className="h-4 w-4 me-2" />
            )}
            ייצוא לאקסל
          </Button>
          <Button
            onClick={handleExportPDF}
            disabled={isExportingPDF || !report}
            className="bg-red-600 hover:bg-red-700"
          >
            {isExportingPDF ? (
              <Loader2 className="h-4 w-4 me-2 animate-spin" />
            ) : (
              <FileText className="h-4 w-4 me-2" />
            )}
            ייצוא ל-PDF
          </Button>
        </div>
      </div>

      {/* Filters Card */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">סינון</CardTitle>
          <CardDescription>סנן את הדוח לפי תאריכים, מותג, ספק או סטטוס</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
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
              <Label htmlFor="supplier">ספק</Label>
              <Select value={selectedSupplier} onValueChange={setSelectedSupplier}>
                <SelectTrigger id="supplier" dir="rtl" className="[&>span]:text-end">
                  <SelectValue placeholder="כל הספקים" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">כל הספקים</SelectItem>
                  {suppliers.map((supplier) => (
                    <SelectItem key={supplier.id} value={supplier.id}>
                      {supplier.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="status">סטטוס</Label>
              <Select value={selectedStatus} onValueChange={setSelectedStatus}>
                <SelectTrigger id="status">
                  <SelectValue placeholder="כל הסטטוסים" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">כל הסטטוסים</SelectItem>
                  <SelectItem value="pending">ממתין</SelectItem>
                  <SelectItem value="calculated">חושב</SelectItem>
                  <SelectItem value="approved">מאושר</SelectItem>
                  <SelectItem value="paid">שולם</SelectItem>
                  <SelectItem value="cancelled">בוטל</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex gap-2 mt-4">
            <Button onClick={handleApplyFilters} disabled={isLoading}>
              {isLoading && <Loader2 className="h-4 w-4 me-2 animate-spin" />}
              החל סינון
            </Button>
            <Button variant="outline" onClick={handleResetFilters}>
              איפוס
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

      {/* Report Content */}
      {!isLoading && report && (
        <>
          {/* Summary Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">
                  סה״כ עמלות
                </CardTitle>
                <DollarSign className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {formatCurrency(report.summary.totalCommissionAmount)}
                </div>
                <p className="text-xs text-muted-foreground">
                  {report.summary.totalCommissions} רשומות
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">
                  סה״כ ברוטו
                </CardTitle>
                <TrendingUp className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {formatCurrency(report.summary.totalGrossAmount)}
                </div>
                <p className="text-xs text-muted-foreground">
                  נטו: {formatCurrency(report.summary.totalNetAmount)}
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">
                  שיעור עמלה ממוצע
                </CardTitle>
                <Percent className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {formatPercent(report.summary.avgCommissionRate)}
                </div>
                <p className="text-xs text-muted-foreground">
                  ממוצע כל העמלות
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">
                  טווח תקופה
                </CardTitle>
                <Calendar className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-lg font-medium">
                  {report.summary.periodRange.startDate &&
                  report.summary.periodRange.endDate
                    ? `${formatDate(report.summary.periodRange.startDate)} - ${formatDate(report.summary.periodRange.endDate)}`
                    : "לא זמין"}
                </div>
                <p className="text-xs text-muted-foreground">
                  הופק: {formatDate(report.summary.generatedAt)}
                </p>
              </CardContent>
            </Card>
          </div>

          {/* Tabs for different views */}
          <Tabs defaultValue="byBrand" className="w-full" dir="rtl">
            <TabsList className="flex w-full gap-1">
              <TabsTrigger value="byBrand" className="flex items-center gap-2">
                לפי מותג
                <Building2 className="h-4 w-4" />
              </TabsTrigger>
              <TabsTrigger value="byPeriod" className="flex items-center gap-2">
                לפי תקופה
                <Calendar className="h-4 w-4" />
              </TabsTrigger>
              <TabsTrigger value="bySupplier" className="flex items-center gap-2">
                לפי ספק
                <Users className="h-4 w-4" />
              </TabsTrigger>
              <TabsTrigger value="details" className="flex items-center gap-2">
                פירוט מלא
                <Store className="h-4 w-4" />
              </TabsTrigger>
            </TabsList>

            {/* By Brand Tab */}
            <TabsContent value="byBrand">
              <Card>
                <CardHeader className="text-end">
                  <CardTitle>סיכום לפי מותג</CardTitle>
                  <CardDescription>
                    פירוט עמלות מקובץ לפי מותג
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {report.byBrand.length === 0 ? (
                    <p className="text-center text-muted-foreground py-8">
                      אין נתונים להצגה
                    </p>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>מותג</TableHead>
                          <TableHead>מספר עמלות</TableHead>
                          <TableHead>סכום ברוטו</TableHead>
                          <TableHead>סכום נטו</TableHead>
                          <TableHead>סכום עמלה</TableHead>
                          <TableHead>עמלה ממוצעת</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {report.byBrand.map((brand) => (
                          <TableRow key={brand.brandId}>
                            <TableCell className="font-medium">
                              {brand.brandNameHe}
                            </TableCell>
                            <TableCell>{brand.commissionCount}</TableCell>
                            <TableCell>
                              {formatCurrency(brand.totalGrossAmount)}
                            </TableCell>
                            <TableCell>
                              {formatCurrency(brand.totalNetAmount)}
                            </TableCell>
                            <TableCell className="font-medium">
                              {formatCurrency(brand.totalCommissionAmount)}
                            </TableCell>
                            <TableCell>
                              {formatPercent(brand.avgCommissionRate)}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            {/* By Period Tab */}
            <TabsContent value="byPeriod">
              <Card>
                <CardHeader className="text-end">
                  <CardTitle>סיכום לפי תקופה</CardTitle>
                  <CardDescription>
                    פירוט עמלות מקובץ לפי תקופת התחשבנות
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {report.byPeriod.length === 0 ? (
                    <p className="text-center text-muted-foreground py-8">
                      אין נתונים להצגה
                    </p>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>תאריך התחלה</TableHead>
                          <TableHead>תאריך סיום</TableHead>
                          <TableHead>מספר עמלות</TableHead>
                          <TableHead>סכום ברוטו</TableHead>
                          <TableHead>סכום נטו</TableHead>
                          <TableHead>סכום עמלה</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {report.byPeriod.map((period, index) => (
                          <TableRow key={index}>
                            <TableCell>
                              {formatDate(period.periodStartDate)}
                            </TableCell>
                            <TableCell>
                              {formatDate(period.periodEndDate)}
                            </TableCell>
                            <TableCell>{period.commissionCount}</TableCell>
                            <TableCell>
                              {formatCurrency(period.totalGrossAmount)}
                            </TableCell>
                            <TableCell>
                              {formatCurrency(period.totalNetAmount)}
                            </TableCell>
                            <TableCell className="font-medium">
                              {formatCurrency(period.totalCommissionAmount)}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            {/* By Supplier Tab */}
            <TabsContent value="bySupplier">
              <Card>
                <CardHeader className="text-end">
                  <CardTitle>סיכום לפי ספק</CardTitle>
                  <CardDescription>
                    פירוט עמלות מקובץ לפי ספק
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {report.bySupplier.length === 0 ? (
                    <p className="text-center text-muted-foreground py-8">
                      אין נתונים להצגה
                    </p>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>ספק</TableHead>
                          <TableHead>קוד</TableHead>
                          <TableHead>מספר עמלות</TableHead>
                          <TableHead>סכום ברוטו</TableHead>
                          <TableHead>סכום נטו</TableHead>
                          <TableHead>סכום עמלה</TableHead>
                          <TableHead>עמלה ממוצעת</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {report.bySupplier.map((supplier) => (
                          <TableRow key={supplier.supplierId}>
                            <TableCell className="font-medium">
                              {supplier.supplierName}
                            </TableCell>
                            <TableCell>{supplier.supplierCode}</TableCell>
                            <TableCell>{supplier.commissionCount}</TableCell>
                            <TableCell>
                              {formatCurrency(supplier.totalGrossAmount)}
                            </TableCell>
                            <TableCell>
                              {formatCurrency(supplier.totalNetAmount)}
                            </TableCell>
                            <TableCell className="font-medium">
                              {formatCurrency(supplier.totalCommissionAmount)}
                            </TableCell>
                            <TableCell>
                              {formatPercent(supplier.avgCommissionRate)}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            {/* Details Tab */}
            <TabsContent value="details">
              <Card>
                <CardHeader className="text-end">
                  <CardTitle>פירוט מלא</CardTitle>
                  <CardDescription>
                    כל רשומות העמלות בפירוט מלא
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {report.details.length === 0 ? (
                    <p className="text-center text-muted-foreground py-8">
                      אין נתונים להצגה
                    </p>
                  ) : (
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>ספק</TableHead>
                            <TableHead>זכיין</TableHead>
                            <TableHead>מותג</TableHead>
                            <TableHead>תקופה</TableHead>
                            <TableHead>ברוטו</TableHead>
                            <TableHead>עמלה</TableHead>
                            <TableHead>שיעור</TableHead>
                            <TableHead>סטטוס</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {report.details.slice(0, 100).map((commission) => (
                            <TableRow key={commission.id}>
                              <TableCell className="font-medium">
                                {commission.supplierName}
                              </TableCell>
                              <TableCell>{commission.franchiseeName}</TableCell>
                              <TableCell>{commission.brandNameHe}</TableCell>
                              <TableCell className="text-sm">
                                {formatDate(commission.periodStartDate)} -{" "}
                                {formatDate(commission.periodEndDate)}
                              </TableCell>
                              <TableCell>
                                {formatCurrency(Number(commission.grossAmount))}
                              </TableCell>
                              <TableCell className="font-medium">
                                {formatCurrency(Number(commission.commissionAmount))}
                              </TableCell>
                              <TableCell>
                                {formatPercent(Number(commission.commissionRate))}
                              </TableCell>
                              <TableCell>
                                {getStatusBadge(commission.status)}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                      {report.details.length > 100 && (
                        <p className="text-center text-muted-foreground py-4">
                          מציג 100 מתוך {report.details.length} רשומות. ייצא
                          לאקסל לצפייה בכל הרשומות.
                        </p>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </>
      )}

      {/* Empty State */}
      {!isLoading && !report && (
        <Card>
          <CardContent className="py-12 text-center">
            <FileSpreadsheet className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium mb-2">אין נתוני דוח</h3>
            <p className="text-muted-foreground">
              לא נמצאו נתוני עמלות להצגה. נסה לשנות את הסינון או להוסיף עמלות.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
