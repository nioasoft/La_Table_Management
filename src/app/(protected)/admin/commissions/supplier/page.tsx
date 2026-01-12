"use client";

import { useEffect, useState } from "react";
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
  Truck,
  ChevronRight,
  RefreshCw,
  Loader2,
  Download,
  Users,
  FileSpreadsheet,
  TrendingUp,
  TrendingDown,
  Minus,
  Calendar,
  DollarSign,
  Percent,
  Building2,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import Link from "next/link";
import { formatCurrency } from "@/lib/translations";

// Types
interface Brand {
  id: string;
  nameHe: string;
  nameEn: string | null;
}

interface Supplier {
  id: string;
  name: string;
  code: string;
}

interface SupplierFranchiseeCommission {
  franchiseeId: string;
  franchiseeName: string;
  franchiseeCode: string;
  brandId: string;
  brandNameHe: string;
  brandNameEn: string | null;
  commissionCount: number;
  totalGrossAmount: number;
  totalNetAmount: number;
  totalCommissionAmount: number;
  avgCommissionRate: number;
}

interface SupplierCommissionPeriod {
  periodStartDate: string;
  periodEndDate: string;
  commissionCount: number;
  totalGrossAmount: number;
  totalNetAmount: number;
  totalCommissionAmount: number;
}

interface CommissionDetail {
  id: string;
  franchiseeName: string;
  franchiseeCode: string;
  brandNameHe: string;
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

interface PerSupplierReportData {
  supplier: {
    id: string;
    name: string;
    code: string;
    defaultCommissionRate: string | null;
    commissionType: string | null;
    settlementFrequency: string | null;
    vatIncluded: boolean | null;
  };
  summary: {
    totalFranchisees: number;
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
  byFranchisee: SupplierFranchiseeCommission[];
  byPeriod: SupplierCommissionPeriod[];
  details: CommissionDetail[];
  comparison?: {
    previousPeriod: {
      totalGrossAmount: number;
      totalNetAmount: number;
      totalCommissionAmount: number;
      commissionCount: number;
    };
    changes: {
      grossAmountChange: number;
      grossAmountChangePercent: number;
      netAmountChange: number;
      netAmountChangePercent: number;
      commissionAmountChange: number;
      commissionAmountChangePercent: number;
    };
  };
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

export default function SupplierCommissionReportPage() {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(true);
  const [isExporting, setIsExporting] = useState(false);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [reportData, setReportData] = useState<PerSupplierReportData | null>(null);

  // Filters
  const [selectedSupplierId, setSelectedSupplierId] = useState<string>("");
  const [startDate, setStartDate] = useState<string>("");
  const [endDate, setEndDate] = useState<string>("");
  const [brandId, setBrandId] = useState<string>("");
  const [status, setStatus] = useState<string>("");
  const [compareStartDate, setCompareStartDate] = useState<string>("");
  const [compareEndDate, setCompareEndDate] = useState<string>("");
  const [showComparison, setShowComparison] = useState(false);

  // View controls
  const [activeTab, setActiveTab] = useState<"franchisees" | "periods" | "details">("franchisees");
  const [expandedDetails, setExpandedDetails] = useState(false);

  const { data: session, isPending } = authClient.useSession();
  const userRole = session ? (session.user as { role?: string })?.role : undefined;

  useEffect(() => {
    if (!isPending && !session) {
      router.push("/sign-in?redirect=/admin/commissions/supplier");
      return;
    }

    if (!isPending && session?.user && userRole !== "super_user" && userRole !== "admin") {
      router.push("/dashboard");
      return;
    }

    if (!isPending && session) {
      fetchSuppliers();
    }
  }, [session, isPending, router, userRole]);

  const fetchSuppliers = async () => {
    try {
      const response = await fetch("/api/suppliers?filter=active");
      if (!response.ok) throw new Error("Failed to fetch suppliers");
      const data = await response.json();
      setSuppliers(data.suppliers || []);
    } catch (error) {
      console.error("Error fetching suppliers:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const fetchReport = async () => {
    if (!selectedSupplierId) return;

    try {
      setIsLoading(true);
      const params = new URLSearchParams();
      if (startDate) params.append("startDate", startDate);
      if (endDate) params.append("endDate", endDate);
      if (brandId) params.append("brandId", brandId);
      if (status) params.append("status", status);
      if (showComparison && compareStartDate) params.append("compareStartDate", compareStartDate);
      if (showComparison && compareEndDate) params.append("compareEndDate", compareEndDate);

      const response = await fetch(
        `/api/commissions/supplier/${selectedSupplierId}?${params.toString()}`
      );
      if (!response.ok) throw new Error("Failed to fetch report");
      const data = await response.json();
      setReportData(data.report);
      setBrands(data.filters.brands || []);
    } catch (error) {
      console.error("Error fetching report:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleExport = async () => {
    if (!selectedSupplierId) return;

    try {
      setIsExporting(true);
      const params = new URLSearchParams();
      if (startDate) params.append("startDate", startDate);
      if (endDate) params.append("endDate", endDate);
      if (brandId) params.append("brandId", brandId);
      if (status) params.append("status", status);
      if (showComparison && compareStartDate) params.append("compareStartDate", compareStartDate);
      if (showComparison && compareEndDate) params.append("compareEndDate", compareEndDate);

      const response = await fetch(
        `/api/commissions/supplier/${selectedSupplierId}/export?${params.toString()}`
      );

      if (!response.ok) throw new Error("Failed to export report");

      // Get the filename from the Content-Disposition header
      const contentDisposition = response.headers.get("Content-Disposition");
      let filename = "supplier_commission_report.xlsx";
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

  // Change indicator component
  const ChangeIndicator = ({ value, percent }: { value: number; percent: number }) => {
    if (value === 0) {
      return <Minus className="h-4 w-4 text-muted-foreground" />;
    }
    if (value > 0) {
      return (
        <span className="flex items-center gap-1 text-green-600">
          <TrendingUp className="h-4 w-4" />
          <span className="text-sm">+{formatPercent(percent)}</span>
        </span>
      );
    }
    return (
      <span className="flex items-center gap-1 text-red-600">
        <TrendingDown className="h-4 w-4" />
        <span className="text-sm">{formatPercent(percent)}</span>
      </span>
    );
  };

  if (isPending || (isLoading && !reportData)) {
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
              <ChevronRight className="h-4 w-4 ml-1" />
              לוח בקרה
            </Button>
          </Link>
          <h1 className="text-3xl font-bold">דוח עמלות לפי ספק</h1>
        </div>
        <Button variant="outline" onClick={handleSignOut}>
          <LogOut className="mr-2 h-4 w-4" />
          התנתקות
        </Button>
      </div>

      {/* Filters */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Truck className="h-5 w-5" />
            בחירת ספק ומסננים
          </CardTitle>
          <CardDescription>
            בחר ספק וסנן את הנתונים לפי תאריכים, מותג וסטטוס
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {/* Supplier Selection */}
            <div className="space-y-2 md:col-span-2 lg:col-span-1">
              <Label>ספק *</Label>
              <Select
                value={selectedSupplierId}
                onValueChange={setSelectedSupplierId}
              >
                <SelectTrigger>
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

            {/* Brand Filter */}
            <div className="space-y-2">
              <Label>מותג</Label>
              <Select value={brandId} onValueChange={setBrandId}>
                <SelectTrigger>
                  <SelectValue placeholder="כל המותגים" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">כל המותגים</SelectItem>
                  {brands.map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      {b.nameHe}
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

          {/* Historical Comparison */}
          <div className="mt-4 pt-4 border-t">
            <div className="flex items-center gap-4 mb-4">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowComparison(!showComparison)}
              >
                {showComparison ? (
                  <ChevronUp className="h-4 w-4 ml-2" />
                ) : (
                  <ChevronDown className="h-4 w-4 ml-2" />
                )}
                השוואה היסטורית
              </Button>
            </div>

            {showComparison && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 bg-muted/50 p-4 rounded-lg">
                <div className="space-y-2">
                  <Label>תקופה קודמת - מתאריך</Label>
                  <Input
                    type="date"
                    value={compareStartDate}
                    onChange={(e) => setCompareStartDate(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>תקופה קודמת - עד תאריך</Label>
                  <Input
                    type="date"
                    value={compareEndDate}
                    onChange={(e) => setCompareEndDate(e.target.value)}
                  />
                </div>
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-2 mt-4 pt-4 border-t">
            <Button
              variant="outline"
              onClick={fetchReport}
              disabled={!selectedSupplierId || isLoading}
            >
              {isLoading ? (
                <Loader2 className="h-4 w-4 animate-spin ml-2" />
              ) : (
                <RefreshCw className="h-4 w-4 ml-2" />
              )}
              הצג דוח
            </Button>
            <Button
              onClick={handleExport}
              disabled={!reportData || isExporting}
            >
              {isExporting ? (
                <Loader2 className="h-4 w-4 animate-spin ml-2" />
              ) : (
                <Download className="h-4 w-4 ml-2" />
              )}
              ייצוא ל-Excel
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Report Content */}
      {reportData && (
        <>
          {/* Supplier Info Card */}
          <Card className="mb-6">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <Building2 className="h-5 w-5" />
                    {reportData.supplier.name}
                  </CardTitle>
                  <CardDescription>קוד: {reportData.supplier.code}</CardDescription>
                </div>
                <div className="flex gap-2 flex-wrap">
                  {reportData.supplier.defaultCommissionRate && (
                    <Badge variant="outline">
                      <Percent className="h-3 w-3 ml-1" />
                      {reportData.supplier.defaultCommissionRate}%
                    </Badge>
                  )}
                  <Badge variant="secondary">
                    {reportData.supplier.settlementFrequency === "monthly"
                      ? "חודשי"
                      : reportData.supplier.settlementFrequency === "quarterly"
                      ? "רבעוני"
                      : reportData.supplier.settlementFrequency === "weekly"
                      ? "שבועי"
                      : reportData.supplier.settlementFrequency || "לא הוגדר"}
                  </Badge>
                  <Badge variant={reportData.supplier.vatIncluded ? "success" : "secondary"}>
                    מע״מ {reportData.supplier.vatIncluded ? "כלול" : "לא כלול"}
                  </Badge>
                </div>
              </div>
            </CardHeader>
          </Card>

          {/* Summary Cards */}
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4 mb-6">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">סה״כ זכיינים</CardTitle>
                <Users className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {reportData.summary.totalFranchisees}
                </div>
                <p className="text-xs text-muted-foreground">
                  {reportData.summary.totalCommissions} עמלות
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">סכום ברוטו</CardTitle>
                <DollarSign className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {formatCurrency(reportData.summary.totalGrossAmount)}
                </div>
                {reportData.comparison && (
                  <div className="mt-1">
                    <ChangeIndicator
                      value={reportData.comparison.changes.grossAmountChange}
                      percent={reportData.comparison.changes.grossAmountChangePercent}
                    />
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">סכום נטו</CardTitle>
                <DollarSign className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {formatCurrency(reportData.summary.totalNetAmount)}
                </div>
                {reportData.comparison && (
                  <div className="mt-1">
                    <ChangeIndicator
                      value={reportData.comparison.changes.netAmountChange}
                      percent={reportData.comparison.changes.netAmountChangePercent}
                    />
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">סכום עמלה</CardTitle>
                <FileSpreadsheet className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {formatCurrency(reportData.summary.totalCommissionAmount)}
                </div>
                {reportData.comparison && (
                  <div className="mt-1">
                    <ChangeIndicator
                      value={reportData.comparison.changes.commissionAmountChange}
                      percent={reportData.comparison.changes.commissionAmountChangePercent}
                    />
                  </div>
                )}
                <p className="text-xs text-muted-foreground mt-1">
                  שיעור ממוצע: {formatPercent(reportData.summary.avgCommissionRate)}
                </p>
              </CardContent>
            </Card>
          </div>

          {/* Historical Comparison Card */}
          {reportData.comparison && (
            <Card className="mb-6">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <TrendingUp className="h-5 w-5" />
                  השוואה לתקופה קודמת
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="p-4 bg-muted/50 rounded-lg">
                    <p className="text-sm text-muted-foreground">סכום ברוטו קודם</p>
                    <p className="text-lg font-bold">
                      {formatCurrency(reportData.comparison.previousPeriod.totalGrossAmount)}
                    </p>
                    <div className="flex items-center gap-2 mt-1">
                      <span className={reportData.comparison.changes.grossAmountChange >= 0 ? "text-green-600" : "text-red-600"}>
                        {reportData.comparison.changes.grossAmountChange >= 0 ? "+" : ""}
                        {formatCurrency(reportData.comparison.changes.grossAmountChange)}
                      </span>
                      <ChangeIndicator
                        value={reportData.comparison.changes.grossAmountChange}
                        percent={reportData.comparison.changes.grossAmountChangePercent}
                      />
                    </div>
                  </div>
                  <div className="p-4 bg-muted/50 rounded-lg">
                    <p className="text-sm text-muted-foreground">סכום נטו קודם</p>
                    <p className="text-lg font-bold">
                      {formatCurrency(reportData.comparison.previousPeriod.totalNetAmount)}
                    </p>
                    <div className="flex items-center gap-2 mt-1">
                      <span className={reportData.comparison.changes.netAmountChange >= 0 ? "text-green-600" : "text-red-600"}>
                        {reportData.comparison.changes.netAmountChange >= 0 ? "+" : ""}
                        {formatCurrency(reportData.comparison.changes.netAmountChange)}
                      </span>
                      <ChangeIndicator
                        value={reportData.comparison.changes.netAmountChange}
                        percent={reportData.comparison.changes.netAmountChangePercent}
                      />
                    </div>
                  </div>
                  <div className="p-4 bg-muted/50 rounded-lg">
                    <p className="text-sm text-muted-foreground">סכום עמלה קודם</p>
                    <p className="text-lg font-bold">
                      {formatCurrency(reportData.comparison.previousPeriod.totalCommissionAmount)}
                    </p>
                    <div className="flex items-center gap-2 mt-1">
                      <span className={reportData.comparison.changes.commissionAmountChange >= 0 ? "text-green-600" : "text-red-600"}>
                        {reportData.comparison.changes.commissionAmountChange >= 0 ? "+" : ""}
                        {formatCurrency(reportData.comparison.changes.commissionAmountChange)}
                      </span>
                      <ChangeIndicator
                        value={reportData.comparison.changes.commissionAmountChange}
                        percent={reportData.comparison.changes.commissionAmountChangePercent}
                      />
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Tab Navigation */}
          <div className="flex gap-2 mb-4">
            <Button
              variant={activeTab === "franchisees" ? "default" : "outline"}
              onClick={() => setActiveTab("franchisees")}
            >
              <Users className="h-4 w-4 ml-2" />
              לפי זכיין ({reportData.byFranchisee.length})
            </Button>
            <Button
              variant={activeTab === "periods" ? "default" : "outline"}
              onClick={() => setActiveTab("periods")}
            >
              <Calendar className="h-4 w-4 ml-2" />
              לפי תקופה ({reportData.byPeriod.length})
            </Button>
            <Button
              variant={activeTab === "details" ? "default" : "outline"}
              onClick={() => setActiveTab("details")}
            >
              <FileSpreadsheet className="h-4 w-4 ml-2" />
              פירוט מלא ({reportData.details.length})
            </Button>
          </div>

          {/* By Franchisee Table */}
          {activeTab === "franchisees" && (
            <Card>
              <CardHeader>
                <CardTitle>עמלות לפי זכיין</CardTitle>
                <CardDescription>
                  פירוט סכומים מצטברים עבור כל זכיין
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
                          <th className="text-right py-3 px-4">זכיין</th>
                          <th className="text-right py-3 px-4">קוד</th>
                          <th className="text-right py-3 px-4">מותג</th>
                          <th className="text-right py-3 px-4">עמלות</th>
                          <th className="text-right py-3 px-4">סכום ברוטו</th>
                          <th className="text-right py-3 px-4">סכום נטו</th>
                          <th className="text-right py-3 px-4">סכום עמלה</th>
                          <th className="text-right py-3 px-4">שיעור ממוצע</th>
                        </tr>
                      </thead>
                      <tbody>
                        {reportData.byFranchisee.map((f) => (
                          <tr key={f.franchiseeId} className="border-b hover:bg-muted/50">
                            <td className="py-3 px-4 font-medium">{f.franchiseeName}</td>
                            <td className="py-3 px-4 font-mono text-sm">{f.franchiseeCode}</td>
                            <td className="py-3 px-4">
                              <Badge variant="outline">{f.brandNameHe}</Badge>
                            </td>
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
                          <td className="py-3 px-4" colSpan={3}>סה״כ</td>
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
                          <th className="text-right py-3 px-4">תאריך התחלה</th>
                          <th className="text-right py-3 px-4">תאריך סיום</th>
                          <th className="text-right py-3 px-4">עמלות</th>
                          <th className="text-right py-3 px-4">סכום ברוטו</th>
                          <th className="text-right py-3 px-4">סכום נטו</th>
                          <th className="text-right py-3 px-4">סכום עמלה</th>
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
                          <th className="text-right py-3 px-4">זכיין</th>
                          <th className="text-right py-3 px-4">מותג</th>
                          <th className="text-right py-3 px-4">תקופה</th>
                          <th className="text-right py-3 px-4">ברוטו</th>
                          <th className="text-right py-3 px-4">נטו</th>
                          <th className="text-right py-3 px-4">שיעור</th>
                          <th className="text-right py-3 px-4">עמלה</th>
                          <th className="text-right py-3 px-4">סטטוס</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(expandedDetails ? reportData.details : reportData.details.slice(0, 20)).map((d) => (
                          <tr key={d.id} className="border-b hover:bg-muted/50">
                            <td className="py-3 px-4">
                              <div>
                                <p className="font-medium">{d.franchiseeName}</p>
                                <p className="text-xs text-muted-foreground">{d.franchiseeCode}</p>
                              </div>
                            </td>
                            <td className="py-3 px-4">
                              <Badge variant="outline">{d.brandNameHe}</Badge>
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
      {!reportData && !isLoading && (
        <Card className="py-12">
          <CardContent className="text-center">
            <Truck className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">בחר ספק להצגת הדוח</h3>
            <p className="text-muted-foreground">
              בחר ספק מהרשימה לעיל ולחץ על &quot;הצג דוח&quot;
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
