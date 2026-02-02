"use client";

import { useEffect, useState } from "react";
import { formatCurrency } from "@/lib/translations";
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
  LogOut,
  Building2,
  ChevronRight,
  RefreshCw,
  Loader2,
  Download,
  Users,
  FileSpreadsheet,
  Calendar,
  Coins,
  Percent,
  Truck,
  Receipt,
} from "lucide-react";
import Link from "next/link";
import { useBrands } from "@/queries/brands";

// Types
interface Brand {
  id: string;
  nameHe: string;
  nameEn: string | null;
  code: string;
}

interface Supplier {
  id: string;
  name: string;
  code: string;
}

interface BrandFranchiseeCommission {
  franchiseeId: string;
  franchiseeName: string;
  franchiseeCode: string;
  commissionCount: number;
  totalGrossAmount: number;
  totalNetAmount: number;
  totalCommissionAmount: number;
  avgCommissionRate: number;
}

interface BrandSupplierCommission {
  supplierId: string;
  supplierName: string;
  supplierCode: string;
  commissionCount: number;
  totalGrossAmount: number;
  totalNetAmount: number;
  totalCommissionAmount: number;
  avgCommissionRate: number;
}

interface BrandCommissionPeriod {
  periodStartDate: string;
  periodEndDate: string;
  commissionCount: number;
  totalGrossAmount: number;
  totalNetAmount: number;
  totalCommissionAmount: number;
}

interface CommissionDetail {
  id: string;
  supplierName: string;
  supplierCode: string;
  franchiseeName: string;
  franchiseeCode: string;
  periodStartDate: string;
  periodEndDate: string;
  grossAmount: string;
  netAmount: string;
  commissionRate: string;
  commissionAmount: string;
  status: string;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  notes: string | null;
  createdAt: Date;
}

interface PerBrandReportData {
  brand: {
    id: string;
    nameHe: string;
    nameEn: string | null;
    code: string;
    contactEmail: string | null;
    contactPhone: string | null;
  };
  summary: {
    totalFranchisees: number;
    totalSuppliers: number;
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
  byFranchisee: BrandFranchiseeCommission[];
  bySupplier: BrandSupplierCommission[];
  byPeriod: BrandCommissionPeriod[];
  details: CommissionDetail[];
}

// Format percentage
const formatPercent = (rate: number): string => {
  return `${rate.toFixed(2)}%`;
};

// Format date
const formatDate = (dateStr: string): string => {
  if (!dateStr) return "";
  return new Date(dateStr).toLocaleDateString("he-IL");
};

// Status badge colors
const statusColors: Record<string, "default" | "secondary" | "success" | "warning" | "destructive"> = {
  pending: "secondary",
  calculated: "default",
  approved: "success",
  paid: "success",
  cancelled: "destructive",
};

const statusLabels: Record<string, string> = {
  pending: "ממתין",
  calculated: "חושב",
  approved: "מאושר",
  paid: "שולם",
  cancelled: "בוטל",
};

export default function BrandCommissionReportPage() {
  const router = useRouter();
  const [isExporting, setIsExporting] = useState(false);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [reportData, setReportData] = useState<PerBrandReportData | null>(null);

  // Filters
  const [selectedBrandId, setSelectedBrandId] = useState<string>("");
  const [startDate, setStartDate] = useState<string>("");
  const [endDate, setEndDate] = useState<string>("");
  const [supplierId, setSupplierId] = useState<string>("");
  const [status, setStatus] = useState<string>("");

  // View controls
  const [activeTab, setActiveTab] = useState<"franchisees" | "suppliers" | "periods" | "details">("franchisees");
  const [expandedDetails, setExpandedDetails] = useState(false);

  const { data: session, isPending } = authClient.useSession();
  const userRole = session ? (session.user as { role?: string })?.role : undefined;

  // Use TanStack Query hook
  const { data: brandsData = [], isLoading: isLoadingBrands } = useBrands();
  const brands: Brand[] = brandsData;

  useEffect(() => {
    if (!isPending && !session) {
      router.push("/sign-in?redirect=/admin/commissions/brand");
      return;
    }

    if (!isPending && session?.user && userRole !== "super_user" && userRole !== "admin") {
      router.push("/dashboard");
      return;
    }
  }, [session, isPending, router, userRole]);

  const fetchReport = async () => {
    if (!selectedBrandId) return;

    try {
      const params = new URLSearchParams();
      if (startDate) params.append("startDate", startDate);
      if (endDate) params.append("endDate", endDate);
      if (supplierId) params.append("supplierId", supplierId);
      if (status) params.append("status", status);

      const response = await fetch(
        `/api/commissions/brand/${selectedBrandId}?${params.toString()}`
      );
      if (!response.ok) throw new Error("Failed to fetch report");
      const data = await response.json();
      setReportData(data.report);
      setSuppliers(data.filters.suppliers || []);
    } catch (error) {
      console.error("Error fetching report:", error);
    }
  };

  const handleExport = async () => {
    if (!selectedBrandId) return;

    try {
      setIsExporting(true);
      const params = new URLSearchParams();
      if (startDate) params.append("startDate", startDate);
      if (endDate) params.append("endDate", endDate);
      if (supplierId) params.append("supplierId", supplierId);
      if (status) params.append("status", status);

      const response = await fetch(
        `/api/commissions/brand/${selectedBrandId}/export?${params.toString()}`
      );

      if (!response.ok) throw new Error("Failed to export report");

      // Get the filename from the Content-Disposition header
      const contentDisposition = response.headers.get("Content-Disposition");
      let filename = "brand_commission_report.xlsx";
      if (contentDisposition) {
        const match = contentDisposition.match(/filename="(.+)"/);
        if (match) filename = match[1];
      }

      // Download the file
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (error) {
      console.error("Error exporting report:", error);
      alert("שגיאה בייצוא הדוח");
    } finally {
      setIsExporting(false);
    }
  };

  const handleSignOut = async () => {
    await authClient.signOut();
    router.push("/sign-in");
  };

  if (isPending || isLoadingBrands) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6" dir="rtl">
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-4">
          <Link href="/dashboard">
            <Button variant="ghost" size="sm">
              <ChevronRight className="h-4 w-4 me-1" />
              לוח בקרה
            </Button>
          </Link>
          <h1 className="text-3xl font-bold">דוח עמלות לפי מותג</h1>
          <Badge variant="outline" className="gap-1">
            <Receipt className="h-3 w-3" />
            מוכן להפקת חשבונית
          </Badge>
        </div>
        <Button variant="outline" onClick={handleSignOut}>
          <LogOut className="me-2 h-4 w-4" />
          התנתקות
        </Button>
      </div>

      {/* Filters */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Building2 className="h-5 w-5" />
            בחירת מותג ומסננים
          </CardTitle>
          <CardDescription>
            בחר מותג וסנן את הנתונים לפי תאריכים, ספק וסטטוס. הדוח מוכן להפקת חשבונית.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-4">
            {/* Brand Selection */}
            <div className="space-y-2 md:col-span-2 lg:col-span-1">
              <Label>מותג *</Label>
              <Select
                value={selectedBrandId}
                onValueChange={setSelectedBrandId}
              >
                <SelectTrigger>
                  <SelectValue placeholder="בחר מותג" />
                </SelectTrigger>
                <SelectContent>
                  {brands.map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      {b.nameHe} ({b.code})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Date Range */}
            <div className="space-y-2">
              <Label>מתאריך</Label>
              <Input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>עד תאריך</Label>
              <Input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </div>

            {/* Supplier Filter */}
            <div className="space-y-2">
              <Label>ספק</Label>
              <Select value={supplierId} onValueChange={setSupplierId}>
                <SelectTrigger dir="rtl" className="[&>span]:text-end">
                  <SelectValue placeholder="כל הספקים" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">כל הספקים</SelectItem>
                  {suppliers.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Status Filter */}
            <div className="space-y-2">
              <Label>סטטוס</Label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger>
                  <SelectValue placeholder="כל הסטטוסים" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">כל הסטטוסים</SelectItem>
                  <SelectItem value="pending">ממתין</SelectItem>
                  <SelectItem value="calculated">חושב</SelectItem>
                  <SelectItem value="approved">מאושר</SelectItem>
                  <SelectItem value="paid">שולם</SelectItem>
                  <SelectItem value="cancelled">בוטל</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-2 mt-4 pt-4 border-t">
            <Button
              variant="outline"
              onClick={fetchReport}
              disabled={!selectedBrandId}
            >
              <RefreshCw className="h-4 w-4 me-2" />
              הצג דוח
            </Button>
            <Button
              onClick={handleExport}
              disabled={!reportData || isExporting}
            >
              {isExporting ? (
                <Loader2 className="h-4 w-4 animate-spin me-2" />
              ) : (
                <Download className="h-4 w-4 me-2" />
              )}
              ייצוא ל-Excel
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Report Content */}
      {reportData && (
        <>
          {/* Brand Info Card */}
          <Card className="mb-6">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <Building2 className="h-5 w-5" />
                    {reportData.brand.nameHe}
                    {reportData.brand.nameEn && (
                      <span className="text-muted-foreground font-normal">
                        ({reportData.brand.nameEn})
                      </span>
                    )}
                  </CardTitle>
                  <CardDescription>קוד: {reportData.brand.code}</CardDescription>
                </div>
                <div className="flex gap-2 flex-wrap">
                  {reportData.brand.contactEmail && (
                    <Badge variant="outline">
                      {reportData.brand.contactEmail}
                    </Badge>
                  )}
                  {reportData.brand.contactPhone && (
                    <Badge variant="secondary">
                      {reportData.brand.contactPhone}
                    </Badge>
                  )}
                </div>
              </div>
            </CardHeader>
          </Card>

          {/* Summary Cards */}
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4 mb-6">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">זכיינים וספקים</CardTitle>
                <Users className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {reportData.summary.totalFranchisees} זכיינים
                </div>
                <p className="text-xs text-muted-foreground">
                  {reportData.summary.totalSuppliers} ספקים | {reportData.summary.totalCommissions} עמלות
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">סכום כולל מע״מ</CardTitle>
                <Coins className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {formatCurrency(reportData.summary.totalGrossAmount)}
                </div>
                <p className="text-xs text-muted-foreground">
                  סה״כ רכישות מותג
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">סכום לפני מע״מ</CardTitle>
                <Coins className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {formatCurrency(reportData.summary.totalNetAmount)}
                </div>
                <p className="text-xs text-muted-foreground">
                  לפני מע״מ
                </p>
              </CardContent>
            </Card>

            <Card className="border-primary">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">סכום עמלה לתשלום</CardTitle>
                <FileSpreadsheet className="h-4 w-4 text-primary" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-primary">
                  {formatCurrency(reportData.summary.totalCommissionAmount)}
                </div>
                <p className="text-xs text-muted-foreground">
                  שיעור ממוצע: {formatPercent(reportData.summary.avgCommissionRate)}
                </p>
              </CardContent>
            </Card>
          </div>

          {/* Period Info */}
          {reportData.summary.periodRange.startDate && reportData.summary.periodRange.endDate && (
            <Card className="mb-6 bg-muted/30">
              <CardContent className="py-4">
                <div className="flex items-center gap-4">
                  <Calendar className="h-5 w-5 text-muted-foreground" />
                  <span className="text-muted-foreground">תקופת הדוח:</span>
                  <span className="font-medium">
                    {formatDate(reportData.summary.periodRange.startDate)} - {formatDate(reportData.summary.periodRange.endDate)}
                  </span>
                  <span className="text-muted-foreground ms-auto">
                    הופק: {formatDate(reportData.summary.generatedAt)}
                  </span>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Tab Navigation */}
          <div className="flex gap-2 mb-4 flex-wrap">
            <Button
              variant={activeTab === "franchisees" ? "default" : "outline"}
              onClick={() => setActiveTab("franchisees")}
            >
              <Users className="h-4 w-4 me-2" />
              לפי זכיין ({reportData.byFranchisee.length})
            </Button>
            <Button
              variant={activeTab === "suppliers" ? "default" : "outline"}
              onClick={() => setActiveTab("suppliers")}
            >
              <Truck className="h-4 w-4 me-2" />
              לפי ספק ({reportData.bySupplier.length})
            </Button>
            <Button
              variant={activeTab === "periods" ? "default" : "outline"}
              onClick={() => setActiveTab("periods")}
            >
              <Calendar className="h-4 w-4 me-2" />
              לפי תקופה ({reportData.byPeriod.length})
            </Button>
            <Button
              variant={activeTab === "details" ? "default" : "outline"}
              onClick={() => setActiveTab("details")}
            >
              <FileSpreadsheet className="h-4 w-4 me-2" />
              פירוט מלא ({reportData.details.length})
            </Button>
          </div>

          {/* By Franchisee Table */}
          {activeTab === "franchisees" && (
            <Card>
              <CardHeader>
                <CardTitle>עמלות לפי זכיין</CardTitle>
                <CardDescription>
                  פירוט סכומים מצטברים עבור כל זכיין במותג
                </CardDescription>
              </CardHeader>
              <CardContent>
                {reportData.byFranchisee.length === 0 ? (
                  <p className="text-center py-8 text-muted-foreground">
                    לא נמצאו נתונים
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead>
                        <tr className="border-b">
                          <th className="text-end py-3 px-4">זכיין</th>
                          <th className="text-end py-3 px-4">קוד</th>
                          <th className="text-end py-3 px-4">עמלות</th>
                          <th className="text-end py-3 px-4">סכום כולל מע״מ</th>
                          <th className="text-end py-3 px-4">סכום לפני מע״מ</th>
                          <th className="text-end py-3 px-4">סכום עמלה</th>
                          <th className="text-end py-3 px-4">שיעור ממוצע</th>
                        </tr>
                      </thead>
                      <tbody>
                        {reportData.byFranchisee.map((f) => (
                          <tr key={f.franchiseeId} className="border-b hover:bg-muted/50">
                            <td className="py-3 px-4 font-medium">{f.franchiseeName}</td>
                            <td className="py-3 px-4 font-mono text-sm">{f.franchiseeCode}</td>
                            <td className="py-3 px-4">{f.commissionCount}</td>
                            <td className="py-3 px-4">{formatCurrency(f.totalGrossAmount)}</td>
                            <td className="py-3 px-4">{formatCurrency(f.totalNetAmount)}</td>
                            <td className="py-3 px-4 font-semibold">
                              {formatCurrency(f.totalCommissionAmount)}
                            </td>
                            <td className="py-3 px-4">{formatPercent(f.avgCommissionRate)}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr className="bg-muted/30 font-bold">
                          <td className="py-3 px-4" colSpan={2}>סה״כ</td>
                          <td className="py-3 px-4">{reportData.summary.totalCommissions}</td>
                          <td className="py-3 px-4">{formatCurrency(reportData.summary.totalGrossAmount)}</td>
                          <td className="py-3 px-4">{formatCurrency(reportData.summary.totalNetAmount)}</td>
                          <td className="py-3 px-4">{formatCurrency(reportData.summary.totalCommissionAmount)}</td>
                          <td className="py-3 px-4">{formatPercent(reportData.summary.avgCommissionRate)}</td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* By Supplier Table */}
          {activeTab === "suppliers" && (
            <Card>
              <CardHeader>
                <CardTitle>עמלות לפי ספק</CardTitle>
                <CardDescription>
                  פירוט סכומים מצטברים לכל ספק במותג
                </CardDescription>
              </CardHeader>
              <CardContent>
                {reportData.bySupplier.length === 0 ? (
                  <p className="text-center py-8 text-muted-foreground">
                    לא נמצאו נתונים
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead>
                        <tr className="border-b">
                          <th className="text-end py-3 px-4">ספק</th>
                          <th className="text-end py-3 px-4">קוד</th>
                          <th className="text-end py-3 px-4">עמלות</th>
                          <th className="text-end py-3 px-4">סכום כולל מע״מ</th>
                          <th className="text-end py-3 px-4">סכום לפני מע״מ</th>
                          <th className="text-end py-3 px-4">סכום עמלה</th>
                          <th className="text-end py-3 px-4">שיעור ממוצע</th>
                        </tr>
                      </thead>
                      <tbody>
                        {reportData.bySupplier.map((s) => (
                          <tr key={s.supplierId} className="border-b hover:bg-muted/50">
                            <td className="py-3 px-4 font-medium">{s.supplierName}</td>
                            <td className="py-3 px-4 font-mono text-sm">{s.supplierCode}</td>
                            <td className="py-3 px-4">{s.commissionCount}</td>
                            <td className="py-3 px-4">{formatCurrency(s.totalGrossAmount)}</td>
                            <td className="py-3 px-4">{formatCurrency(s.totalNetAmount)}</td>
                            <td className="py-3 px-4 font-semibold">
                              {formatCurrency(s.totalCommissionAmount)}
                            </td>
                            <td className="py-3 px-4">{formatPercent(s.avgCommissionRate)}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr className="bg-muted/30 font-bold">
                          <td className="py-3 px-4" colSpan={2}>סה״כ</td>
                          <td className="py-3 px-4">{reportData.summary.totalCommissions}</td>
                          <td className="py-3 px-4">{formatCurrency(reportData.summary.totalGrossAmount)}</td>
                          <td className="py-3 px-4">{formatCurrency(reportData.summary.totalNetAmount)}</td>
                          <td className="py-3 px-4">{formatCurrency(reportData.summary.totalCommissionAmount)}</td>
                          <td className="py-3 px-4">{formatPercent(reportData.summary.avgCommissionRate)}</td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* By Period Table */}
          {activeTab === "periods" && (
            <Card>
              <CardHeader>
                <CardTitle>עמלות לפי תקופה</CardTitle>
                <CardDescription>
                  פירוט סכומים מצטברים לכל תקופת התחשבנות
                </CardDescription>
              </CardHeader>
              <CardContent>
                {reportData.byPeriod.length === 0 ? (
                  <p className="text-center py-8 text-muted-foreground">
                    לא נמצאו נתונים
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead>
                        <tr className="border-b">
                          <th className="text-end py-3 px-4">תאריך התחלה</th>
                          <th className="text-end py-3 px-4">תאריך סיום</th>
                          <th className="text-end py-3 px-4">עמלות</th>
                          <th className="text-end py-3 px-4">סכום כולל מע״מ</th>
                          <th className="text-end py-3 px-4">סכום לפני מע״מ</th>
                          <th className="text-end py-3 px-4">סכום עמלה</th>
                        </tr>
                      </thead>
                      <tbody>
                        {reportData.byPeriod.map((p, idx) => (
                          <tr key={idx} className="border-b hover:bg-muted/50">
                            <td className="py-3 px-4">{formatDate(p.periodStartDate)}</td>
                            <td className="py-3 px-4">{formatDate(p.periodEndDate)}</td>
                            <td className="py-3 px-4">{p.commissionCount}</td>
                            <td className="py-3 px-4">{formatCurrency(p.totalGrossAmount)}</td>
                            <td className="py-3 px-4">{formatCurrency(p.totalNetAmount)}</td>
                            <td className="py-3 px-4 font-semibold">
                              {formatCurrency(p.totalCommissionAmount)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr className="bg-muted/30 font-bold">
                          <td className="py-3 px-4" colSpan={2}>סה״כ</td>
                          <td className="py-3 px-4">{reportData.summary.totalCommissions}</td>
                          <td className="py-3 px-4">{formatCurrency(reportData.summary.totalGrossAmount)}</td>
                          <td className="py-3 px-4">{formatCurrency(reportData.summary.totalNetAmount)}</td>
                          <td className="py-3 px-4">{formatCurrency(reportData.summary.totalCommissionAmount)}</td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Details Table */}
          {activeTab === "details" && (
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle>פירוט מלא</CardTitle>
                    <CardDescription>
                      כל העמלות הבודדות עם פרטים מלאים
                    </CardDescription>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setExpandedDetails(!expandedDetails)}
                  >
                    {expandedDetails ? "הצג פחות" : "הצג הכל"}
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {reportData.details.length === 0 ? (
                  <p className="text-center py-8 text-muted-foreground">
                    לא נמצאו נתונים
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead>
                        <tr className="border-b">
                          <th className="text-end py-3 px-4">ספק</th>
                          <th className="text-end py-3 px-4">זכיין</th>
                          <th className="text-end py-3 px-4">תקופה</th>
                          <th className="text-end py-3 px-4">כולל מע״מ</th>
                          <th className="text-end py-3 px-4">לפני מע״מ</th>
                          <th className="text-end py-3 px-4">שיעור</th>
                          <th className="text-end py-3 px-4">עמלה</th>
                          <th className="text-end py-3 px-4">סטטוס</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(expandedDetails ? reportData.details : reportData.details.slice(0, 20)).map((d) => (
                          <tr key={d.id} className="border-b hover:bg-muted/50">
                            <td className="py-3 px-4">
                              <div>
                                <p className="font-medium">{d.supplierName}</p>
                                <p className="text-xs text-muted-foreground">{d.supplierCode}</p>
                              </div>
                            </td>
                            <td className="py-3 px-4">
                              <div>
                                <p className="font-medium">{d.franchiseeName}</p>
                                <p className="text-xs text-muted-foreground">{d.franchiseeCode}</p>
                              </div>
                            </td>
                            <td className="py-3 px-4 text-sm">
                              {formatDate(d.periodStartDate)} - {formatDate(d.periodEndDate)}
                            </td>
                            <td className="py-3 px-4">{formatCurrency(Number(d.grossAmount))}</td>
                            <td className="py-3 px-4">{formatCurrency(Number(d.netAmount || 0))}</td>
                            <td className="py-3 px-4">{formatPercent(Number(d.commissionRate))}</td>
                            <td className="py-3 px-4 font-semibold">
                              {formatCurrency(Number(d.commissionAmount))}
                            </td>
                            <td className="py-3 px-4">
                              <Badge variant={statusColors[d.status] || "secondary"}>
                                {statusLabels[d.status] || d.status}
                              </Badge>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {!expandedDetails && reportData.details.length > 20 && (
                      <p className="text-center py-4 text-muted-foreground">
                        מוצגות 20 רשומות מתוך {reportData.details.length}
                      </p>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </>
      )}

      {/* Empty State */}
      {!reportData && (
        <Card className="py-12">
          <CardContent className="text-center">
            <Building2 className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">בחר מותג להצגת הדוח</h3>
            <p className="text-muted-foreground">
              בחר מותג מהרשימה לעיל ולחץ על &quot;הצג דוח&quot; לצפייה בכל העמלות של המותג
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
