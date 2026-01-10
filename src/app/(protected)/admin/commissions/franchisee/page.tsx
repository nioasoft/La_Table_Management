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
  RefreshCw,
  FileSpreadsheet,
  Loader2,
  Calendar,
  DollarSign,
  Percent,
  TrendingUp,
  Store,
  Users,
  ChevronRight,
  Building2,
  ShoppingCart,
} from "lucide-react";
import Link from "next/link";

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

interface FranchiseeSupplierPurchase {
  supplierId: string;
  supplierName: string;
  supplierCode: string;
  purchaseCount: number;
  totalGrossAmount: number;
  totalNetAmount: number;
  totalCommissionAmount: number;
  avgCommissionRate: number;
}

interface FranchiseePurchasePeriod {
  periodStartDate: string;
  periodEndDate: string;
  purchaseCount: number;
  totalGrossAmount: number;
  totalNetAmount: number;
  totalCommissionAmount: number;
}

interface FranchiseeReport {
  franchisee: {
    id: string;
    name: string;
    code: string;
    brandId: string;
    brandNameHe: string;
    brandNameEn: string | null;
    primaryContactName: string | null;
    primaryContactEmail: string | null;
    primaryContactPhone: string | null;
  };
  summary: {
    totalSuppliers: number;
    totalPurchases: number;
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
  bySupplier: FranchiseeSupplierPurchase[];
  byPeriod: FranchiseePurchasePeriod[];
  details: CommissionWithDetails[];
}

interface FilterOption {
  id: string;
  name?: string;
  code?: string;
  brandNameHe?: string;
}

interface SupplierOption {
  id: string;
  name: string;
  code: string;
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

export default function FranchiseePurchaseReportPage() {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingFranchisees, setIsLoadingFranchisees] = useState(true);
  const [isExporting, setIsExporting] = useState(false);
  const [report, setReport] = useState<FranchiseeReport | null>(null);
  const [franchisees, setFranchisees] = useState<FilterOption[]>([]);
  const [suppliers, setSuppliers] = useState<SupplierOption[]>([]);

  // Filters
  const [selectedFranchisee, setSelectedFranchisee] = useState<string>("");
  const [startDate, setStartDate] = useState<string>("");
  const [endDate, setEndDate] = useState<string>("");
  const [selectedSupplier, setSelectedSupplier] = useState<string>("");
  const [selectedStatus, setSelectedStatus] = useState<string>("");

  const { data: session, isPending } = authClient.useSession();
  const userRole = session
    ? (session.user as { role?: string })?.role
    : undefined;

  // Redirect if not authenticated or not admin
  useEffect(() => {
    if (!isPending && !session) {
      router.push("/sign-in?redirect=/admin/commissions/franchisee");
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

  // Fetch franchisees list on mount
  useEffect(() => {
    async function fetchFranchisees() {
      try {
        const response = await fetch("/api/franchisees");
        if (response.ok) {
          const data = await response.json();
          setFranchisees(
            data.map((f: { id: string; name: string; code: string; brand?: { nameHe: string } }) => ({
              id: f.id,
              name: f.name,
              code: f.code,
              brandNameHe: f.brand?.nameHe || "",
            }))
          );
        }
      } catch (error) {
        console.error("Error fetching franchisees:", error);
      } finally {
        setIsLoadingFranchisees(false);
      }
    }

    if (session && (userRole === "super_user" || userRole === "admin")) {
      fetchFranchisees();
    }
  }, [session, userRole]);

  // Build query string from filters
  const buildQueryString = useCallback(() => {
    const params = new URLSearchParams();
    if (startDate) params.set("startDate", startDate);
    if (endDate) params.set("endDate", endDate);
    if (selectedSupplier && selectedSupplier !== "all") params.set("supplierId", selectedSupplier);
    if (selectedStatus && selectedStatus !== "all") params.set("status", selectedStatus);
    return params.toString();
  }, [startDate, endDate, selectedSupplier, selectedStatus]);

  // Fetch report data
  const fetchReport = useCallback(async () => {
    if (!selectedFranchisee) return;

    setIsLoading(true);
    try {
      const queryString = buildQueryString();
      const response = await fetch(
        `/api/commissions/franchisee/${selectedFranchisee}${queryString ? `?${queryString}` : ""}`
      );

      if (!response.ok) {
        throw new Error("Failed to fetch report");
      }

      const data = await response.json();
      setReport(data.report);
      setSuppliers(data.filters.suppliers);
    } catch (error) {
      console.error("Error fetching report:", error);
    } finally {
      setIsLoading(false);
    }
  }, [selectedFranchisee, buildQueryString]);

  // Handle export to Excel
  const handleExport = async () => {
    if (!selectedFranchisee) return;

    setIsExporting(true);
    try {
      const queryString = buildQueryString();
      const response = await fetch(
        `/api/commissions/franchisee/${selectedFranchisee}/export${queryString ? `?${queryString}` : ""}`
      );

      if (!response.ok) {
        throw new Error("Failed to export report");
      }

      // Download the file
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `franchisee_purchase_report_${report?.franchisee.code || "unknown"}_${new Date().toISOString().split("T")[0]}.xlsx`;
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

  // Handle filter apply
  const handleApplyFilters = () => {
    fetchReport();
  };

  // Handle filter reset
  const handleResetFilters = () => {
    setStartDate("");
    setEndDate("");
    setSelectedSupplier("");
    setSelectedStatus("");
  };

  // Handle franchisee selection
  const handleFranchiseeChange = (value: string) => {
    setSelectedFranchisee(value);
    setReport(null);
    // Reset other filters when franchisee changes
    handleResetFilters();
  };

  if (isPending || isLoadingFranchisees) {
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
            <span className="text-foreground">דוח רכישות זכיין</span>
          </nav>
          <h1 className="text-3xl font-bold tracking-tight">דוח רכישות לפי זכיין</h1>
          <p className="text-muted-foreground mt-1">
            צפייה בכל הספקים שהזכיין רכש מהם, סכומים ופירוט מלא
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={() => fetchReport()}
            disabled={isLoading || !selectedFranchisee}
          >
            <RefreshCw
              className={`h-4 w-4 ml-2 ${isLoading ? "animate-spin" : ""}`}
            />
            רענון
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
            ייצוא לאקסל
          </Button>
        </div>
      </div>

      {/* Franchisee Selection Card */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">בחירת זכיין</CardTitle>
          <CardDescription>בחר זכיין להצגת דוח הרכישות שלו</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-2 max-w-md">
            <Label htmlFor="franchisee">זכיין</Label>
            <Select value={selectedFranchisee} onValueChange={handleFranchiseeChange}>
              <SelectTrigger id="franchisee">
                <SelectValue placeholder="בחר זכיין..." />
              </SelectTrigger>
              <SelectContent>
                {franchisees.map((f) => (
                  <SelectItem key={f.id} value={f.id}>
                    {f.name} ({f.code}) - {f.brandNameHe}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {selectedFranchisee && (
            <Button onClick={fetchReport} className="mt-4" disabled={isLoading}>
              {isLoading && <Loader2 className="h-4 w-4 ml-2 animate-spin" />}
              טען דוח
            </Button>
          )}
        </CardContent>
      </Card>

      {/* Filters Card - Only show when franchisee is selected */}
      {selectedFranchisee && report && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">סינון</CardTitle>
            <CardDescription>סנן את הדוח לפי תאריכים, ספק או סטטוס</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
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
                <Label htmlFor="supplier">ספק</Label>
                <Select value={selectedSupplier} onValueChange={setSelectedSupplier}>
                  <SelectTrigger id="supplier" dir="rtl" className="[&>span]:text-right">
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
                {isLoading && <Loader2 className="h-4 w-4 ml-2 animate-spin" />}
                החל סינון
              </Button>
              <Button variant="outline" onClick={handleResetFilters}>
                איפוס
              </Button>
            </div>
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
      {!isLoading && report && (
        <>
          {/* Franchisee Info Card */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Building2 className="h-5 w-5" />
                פרטי זכיין
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <p className="text-sm text-muted-foreground">שם זכיין</p>
                  <p className="font-medium">{report.franchisee.name}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">קוד</p>
                  <p className="font-medium">{report.franchisee.code}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">מותג</p>
                  <p className="font-medium">{report.franchisee.brandNameHe}</p>
                </div>
                {report.franchisee.primaryContactName && (
                  <div>
                    <p className="text-sm text-muted-foreground">איש קשר</p>
                    <p className="font-medium">{report.franchisee.primaryContactName}</p>
                  </div>
                )}
                {report.franchisee.primaryContactEmail && (
                  <div>
                    <p className="text-sm text-muted-foreground">אימייל</p>
                    <p className="font-medium">{report.franchisee.primaryContactEmail}</p>
                  </div>
                )}
                {report.franchisee.primaryContactPhone && (
                  <div>
                    <p className="text-sm text-muted-foreground">טלפון</p>
                    <p className="font-medium">{report.franchisee.primaryContactPhone}</p>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Summary Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">
                  סה״כ רכישות
                </CardTitle>
                <ShoppingCart className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {formatCurrency(report.summary.totalGrossAmount)}
                </div>
                <p className="text-xs text-muted-foreground">
                  {report.summary.totalPurchases} רשומות
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">
                  סכום נטו
                </CardTitle>
                <TrendingUp className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {formatCurrency(report.summary.totalNetAmount)}
                </div>
                <p className="text-xs text-muted-foreground">
                  עמלה: {formatCurrency(report.summary.totalCommissionAmount)}
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">
                  מספר ספקים
                </CardTitle>
                <Users className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {report.summary.totalSuppliers}
                </div>
                <p className="text-xs text-muted-foreground">
                  ספקים פעילים
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
          <Tabs defaultValue="bySupplier" className="w-full">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="bySupplier" className="flex items-center gap-2">
                <Users className="h-4 w-4" />
                לפי ספק
              </TabsTrigger>
              <TabsTrigger value="byPeriod" className="flex items-center gap-2">
                <Calendar className="h-4 w-4" />
                לפי תקופה
              </TabsTrigger>
              <TabsTrigger value="details" className="flex items-center gap-2">
                <Store className="h-4 w-4" />
                פירוט מלא
              </TabsTrigger>
            </TabsList>

            {/* By Supplier Tab */}
            <TabsContent value="bySupplier">
              <Card>
                <CardHeader>
                  <CardTitle>סיכום לפי ספק</CardTitle>
                  <CardDescription>
                    פירוט רכישות מקובץ לפי ספק
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
                          <TableHead>מספר רכישות</TableHead>
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
                            <TableCell>{supplier.purchaseCount}</TableCell>
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

            {/* By Period Tab */}
            <TabsContent value="byPeriod">
              <Card>
                <CardHeader>
                  <CardTitle>סיכום לפי תקופה</CardTitle>
                  <CardDescription>
                    פירוט רכישות מקובץ לפי תקופת התחשבנות
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
                          <TableHead>מספר רכישות</TableHead>
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
                            <TableCell>{period.purchaseCount}</TableCell>
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

            {/* Details Tab */}
            <TabsContent value="details">
              <Card>
                <CardHeader>
                  <CardTitle>פירוט מלא</CardTitle>
                  <CardDescription>
                    כל רשומות הרכישות בפירוט מלא
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
                            <TableHead>תקופה</TableHead>
                            <TableHead>ברוטו</TableHead>
                            <TableHead>נטו</TableHead>
                            <TableHead>עמלה</TableHead>
                            <TableHead>שיעור</TableHead>
                            <TableHead>סטטוס</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {report.details.slice(0, 100).map((purchase) => (
                            <TableRow key={purchase.id}>
                              <TableCell className="font-medium">
                                {purchase.supplierName}
                              </TableCell>
                              <TableCell className="text-sm">
                                {formatDate(purchase.periodStartDate)} -{" "}
                                {formatDate(purchase.periodEndDate)}
                              </TableCell>
                              <TableCell>
                                {formatCurrency(Number(purchase.grossAmount))}
                              </TableCell>
                              <TableCell>
                                {formatCurrency(Number(purchase.netAmount || 0))}
                              </TableCell>
                              <TableCell className="font-medium">
                                {formatCurrency(Number(purchase.commissionAmount))}
                              </TableCell>
                              <TableCell>
                                {formatPercent(Number(purchase.commissionRate))}
                              </TableCell>
                              <TableCell>
                                {getStatusBadge(purchase.status)}
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

      {/* Empty State - when no franchisee selected */}
      {!isLoading && !report && !selectedFranchisee && (
        <Card>
          <CardContent className="py-12 text-center">
            <Building2 className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium mb-2">בחר זכיין</h3>
            <p className="text-muted-foreground">
              בחר זכיין מהרשימה למעלה כדי להציג את דוח הרכישות שלו
            </p>
          </CardContent>
        </Card>
      )}

      {/* Empty State - when franchisee selected but no data loaded */}
      {!isLoading && !report && selectedFranchisee && (
        <Card>
          <CardContent className="py-12 text-center">
            <FileSpreadsheet className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium mb-2">טען דוח</h3>
            <p className="text-muted-foreground">
              לחץ על כפתור &quot;טען דוח&quot; להצגת נתוני הרכישות של הזכיין
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
