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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  RefreshCw,
  Download,
  FileSpreadsheet,
  Loader2,
  Calendar,
  DollarSign,
  Building2,
  Users,
  ChevronRight,
  Eye,
  FileText,
  Store,
  Truck,
} from "lucide-react";
import Link from "next/link";
import { formatCurrency } from "@/lib/translations";

// Report types
type ReportType = "commissions" | "settlements" | "franchisees" | "suppliers";

// Report type configuration
const reportTypeConfig: Record<
  ReportType,
  { label: string; icon: React.ReactNode; description: string }
> = {
  commissions: {
    label: "דוח עמלות",
    icon: <DollarSign className="h-4 w-4" />,
    description: "סיכום עמלות לפי ספק, זכיין ותקופה",
  },
  settlements: {
    label: "דוח התחשבנויות",
    icon: <FileText className="h-4 w-4" />,
    description: "סיכום התחשבנויות וחובות",
  },
  franchisees: {
    label: "דוח זכיינים",
    icon: <Store className="h-4 w-4" />,
    description: "רשימת זכיינים עם פרטי קשר וסטטוס",
  },
  suppliers: {
    label: "דוח ספקים",
    icon: <Truck className="h-4 w-4" />,
    description: "רשימת ספקים עם עמלות ופרטי קשר",
  },
};

// Filter option types
interface FilterOption {
  id: string;
  nameHe?: string;
  nameEn?: string | null;
  name?: string;
  code?: string;
}

// Report data types
interface ReportSummary {
  totalRecords: number;
  [key: string]: unknown;
}

interface ReportRow {
  id: string;
  [key: string]: unknown;
}

interface ReportData {
  rows: ReportRow[];
  summary: ReportSummary;
  filters: {
    brands: FilterOption[];
    suppliers: FilterOption[];
    franchisees: FilterOption[];
  };
  generatedAt: string;
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
const getStatusBadge = (status: string, type: ReportType) => {
  const statusConfig: Record<
    string,
    { label: string; variant: "default" | "secondary" | "destructive" | "outline" | "success" }
  > = {
    // Commission statuses
    pending: { label: "ממתין", variant: "secondary" },
    calculated: { label: "חושב", variant: "outline" },
    approved: { label: "מאושר", variant: "success" },
    paid: { label: "שולם", variant: "default" },
    cancelled: { label: "בוטל", variant: "destructive" },
    // Settlement statuses
    draft: { label: "טיוטה", variant: "outline" },
    open: { label: "פתוח", variant: "secondary" },
    processing: { label: "בעיבוד", variant: "outline" },
    pending_approval: { label: "ממתין לאישור", variant: "secondary" },
    completed: { label: "הושלם", variant: "success" },
    invoiced: { label: "הופק חשבון", variant: "default" },
    // Franchisee statuses
    active: { label: "פעיל", variant: "success" },
    inactive: { label: "לא פעיל", variant: "secondary" },
    suspended: { label: "מושעה", variant: "destructive" },
    terminated: { label: "סיום חוזה", variant: "destructive" },
  };

  const config = statusConfig[status] || { label: status, variant: "outline" as const };
  return <Badge variant={config.variant}>{config.label}</Badge>;
};

export default function ReportsPage() {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [reportData, setReportData] = useState<ReportData | null>(null);

  // Filters
  const [reportType, setReportType] = useState<ReportType>("commissions");
  const [startDate, setStartDate] = useState<string>("");
  const [endDate, setEndDate] = useState<string>("");
  const [selectedBrand, setSelectedBrand] = useState<string>("");
  const [selectedSupplier, setSelectedSupplier] = useState<string>("");
  const [selectedFranchisee, setSelectedFranchisee] = useState<string>("");
  const [selectedStatus, setSelectedStatus] = useState<string>("");

  // Filter options
  const [brands, setBrands] = useState<FilterOption[]>([]);
  const [suppliers, setSuppliers] = useState<FilterOption[]>([]);
  const [franchisees, setFranchisees] = useState<FilterOption[]>([]);

  // Preview dialog
  const [showPreview, setShowPreview] = useState(false);

  const { data: session, isPending } = authClient.useSession();
  const userRole = session
    ? (session.user as { role?: string })?.role
    : undefined;

  // Redirect if not authenticated or not admin
  useEffect(() => {
    if (!isPending && !session) {
      router.push("/sign-in?redirect=/admin/reports");
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
    params.set("reportType", reportType);
    if (startDate) params.set("startDate", startDate);
    if (endDate) params.set("endDate", endDate);
    if (selectedBrand && selectedBrand !== "all") params.set("brandId", selectedBrand);
    if (selectedSupplier && selectedSupplier !== "all") params.set("supplierId", selectedSupplier);
    if (selectedFranchisee && selectedFranchisee !== "all") params.set("franchiseeId", selectedFranchisee);
    if (selectedStatus && selectedStatus !== "all") params.set("status", selectedStatus);
    return params.toString();
  }, [reportType, startDate, endDate, selectedBrand, selectedSupplier, selectedFranchisee, selectedStatus]);

  // Fetch report data
  const fetchReport = useCallback(async () => {
    setIsLoading(true);
    try {
      const queryString = buildQueryString();
      const response = await fetch(`/api/reports?${queryString}`);

      if (!response.ok) {
        throw new Error("Failed to fetch report");
      }

      const data = await response.json();
      setReportData(data.data);
      setBrands(data.data.filters.brands);
      setSuppliers(data.data.filters.suppliers);
      setFranchisees(data.data.filters.franchisees);
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
      const response = await fetch(`/api/reports/export?${queryString}`);

      if (!response.ok) {
        throw new Error("Failed to export report");
      }

      // Download the file
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `report_${reportType}_${new Date().toISOString().split("T")[0]}.xlsx`;
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
    setSelectedBrand("");
    setSelectedSupplier("");
    setSelectedFranchisee("");
    setSelectedStatus("");
  };

  // Handle preview before export
  const handlePreview = () => {
    setShowPreview(true);
  };

  // Get status options based on report type
  const getStatusOptions = () => {
    switch (reportType) {
      case "commissions":
        return [
          { value: "pending", label: "ממתין" },
          { value: "calculated", label: "חושב" },
          { value: "approved", label: "מאושר" },
          { value: "paid", label: "שולם" },
          { value: "cancelled", label: "בוטל" },
        ];
      case "settlements":
        return [
          { value: "draft", label: "טיוטה" },
          { value: "pending", label: "ממתין" },
          { value: "open", label: "פתוח" },
          { value: "processing", label: "בעיבוד" },
          { value: "approved", label: "מאושר" },
          { value: "completed", label: "הושלם" },
        ];
      case "franchisees":
        return [
          { value: "active", label: "פעיל" },
          { value: "inactive", label: "לא פעיל" },
          { value: "pending", label: "ממתין" },
          { value: "suspended", label: "מושעה" },
          { value: "terminated", label: "סיום חוזה" },
        ];
      case "suppliers":
        return [
          { value: "active", label: "פעיל" },
          { value: "inactive", label: "לא פעיל" },
        ];
      default:
        return [];
    }
  };

  // Render preview table based on report type
  const renderPreviewTable = () => {
    if (!reportData || reportData.rows.length === 0) {
      return (
        <p className="text-center text-muted-foreground py-8">
          אין נתונים להצגה
        </p>
      );
    }

    const previewRows = reportData.rows.slice(0, 10);

    switch (reportType) {
      case "commissions":
        return (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>ספק</TableHead>
                <TableHead>זכיין</TableHead>
                <TableHead>מותג</TableHead>
                <TableHead>תקופה</TableHead>
                <TableHead>סכום עמלה</TableHead>
                <TableHead>סטטוס</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {previewRows.map((row: any) => (
                <TableRow key={row.id}>
                  <TableCell>{row.supplierName}</TableCell>
                  <TableCell>{row.franchiseeName}</TableCell>
                  <TableCell>{row.brandNameHe}</TableCell>
                  <TableCell className="text-sm">
                    {formatDate(row.periodStartDate)} - {formatDate(row.periodEndDate)}
                  </TableCell>
                  <TableCell>{formatCurrency(Number(row.commissionAmount))}</TableCell>
                  <TableCell>{getStatusBadge(row.status, reportType)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        );

      case "settlements":
        return (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>שם תקופה</TableHead>
                <TableHead>זכיין</TableHead>
                <TableHead>מותג</TableHead>
                <TableHead>תקופה</TableHead>
                <TableHead>לתשלום נטו</TableHead>
                <TableHead>סטטוס</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {previewRows.map((row: any) => (
                <TableRow key={row.id}>
                  <TableCell>{row.name}</TableCell>
                  <TableCell>{row.franchiseeName}</TableCell>
                  <TableCell>{row.brandNameHe}</TableCell>
                  <TableCell className="text-sm">
                    {formatDate(row.periodStartDate)} - {formatDate(row.periodEndDate)}
                  </TableCell>
                  <TableCell>{formatCurrency(Number(row.netPayable || 0))}</TableCell>
                  <TableCell>{getStatusBadge(row.status, reportType)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        );

      case "franchisees":
        return (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>שם</TableHead>
                <TableHead>קוד</TableHead>
                <TableHead>מותג</TableHead>
                <TableHead>עיר</TableHead>
                <TableHead>סטטוס</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {previewRows.map((row: any) => (
                <TableRow key={row.id}>
                  <TableCell>{row.name}</TableCell>
                  <TableCell>{row.code}</TableCell>
                  <TableCell>{row.brandNameHe}</TableCell>
                  <TableCell>{row.city || "-"}</TableCell>
                  <TableCell>{getStatusBadge(row.status, reportType)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        );

      case "suppliers":
        return (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>שם</TableHead>
                <TableHead>קוד</TableHead>
                <TableHead>איש קשר</TableHead>
                <TableHead>עמלות</TableHead>
                <TableHead>סה״כ עמלות</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {previewRows.map((row: any) => (
                <TableRow key={row.id}>
                  <TableCell>{row.name}</TableCell>
                  <TableCell>{row.code}</TableCell>
                  <TableCell>{row.contactName || "-"}</TableCell>
                  <TableCell>{row.totalCommissions}</TableCell>
                  <TableCell>{formatCurrency(row.totalCommissionAmount)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        );

      default:
        return null;
    }
  };

  // Render summary cards based on report type
  const renderSummaryCards = () => {
    if (!reportData) return null;

    const summary = reportData.summary as any;

    switch (reportType) {
      case "commissions":
        return (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">סה״כ רשומות</CardTitle>
                <FileText className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{summary.totalRecords}</div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">סה״כ ברוטו</CardTitle>
                <DollarSign className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {formatCurrency(summary.totalGrossAmount)}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">סה״כ עמלות</CardTitle>
                <DollarSign className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {formatCurrency(summary.totalCommissionAmount)}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">עמלה ממוצעת</CardTitle>
                <DollarSign className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {formatPercent(summary.avgCommissionRate)}
                </div>
              </CardContent>
            </Card>
          </div>
        );

      case "settlements":
        return (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">סה״כ רשומות</CardTitle>
                <FileText className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{summary.totalRecords}</div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">סה״כ מכירות ברוטו</CardTitle>
                <DollarSign className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {formatCurrency(summary.totalGrossSales)}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">סה״כ תמלוגים</CardTitle>
                <DollarSign className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {formatCurrency(summary.totalRoyaltyAmount)}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">סה״כ לתשלום נטו</CardTitle>
                <DollarSign className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {formatCurrency(summary.totalNetPayable)}
                </div>
              </CardContent>
            </Card>
          </div>
        );

      case "franchisees":
        return (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">סה״כ זכיינים</CardTitle>
                <Store className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{summary.totalRecords}</div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">פעילים</CardTitle>
                <Users className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-green-600">
                  {summary.activeCount}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">לא פעילים</CardTitle>
                <Users className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-muted-foreground">
                  {summary.inactiveCount}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">ממתינים</CardTitle>
                <Users className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-yellow-600">
                  {summary.pendingCount}
                </div>
              </CardContent>
            </Card>
          </div>
        );

      case "suppliers":
        return (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">סה״כ ספקים</CardTitle>
                <Truck className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{summary.totalRecords}</div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">ספקים פעילים</CardTitle>
                <Users className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-green-600">
                  {summary.activeCount}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">סה״כ עמלות</CardTitle>
                <DollarSign className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {formatCurrency(summary.totalCommissionAmount)}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">עמלה ממוצעת</CardTitle>
                <DollarSign className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {formatPercent(summary.avgCommissionRate)}
                </div>
              </CardContent>
            </Card>
          </div>
        );

      default:
        return null;
    }
  };

  // Render data table based on report type
  const renderDataTable = () => {
    if (!reportData || reportData.rows.length === 0) {
      return (
        <Card>
          <CardContent className="py-12 text-center">
            <FileSpreadsheet className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium mb-2">אין נתונים להצגה</h3>
            <p className="text-muted-foreground">
              לא נמצאו נתונים להצגה. נסה לשנות את הסינון.
            </p>
          </CardContent>
        </Card>
      );
    }

    const displayRows = reportData.rows.slice(0, 50);

    switch (reportType) {
      case "commissions":
        return (
          <Card>
            <CardHeader>
              <CardTitle>פירוט עמלות</CardTitle>
              <CardDescription>
                מציג {displayRows.length} מתוך {reportData.rows.length} רשומות
              </CardDescription>
            </CardHeader>
            <CardContent>
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
                    {displayRows.map((row: any) => (
                      <TableRow key={row.id}>
                        <TableCell className="font-medium">{row.supplierName}</TableCell>
                        <TableCell>{row.franchiseeName}</TableCell>
                        <TableCell>{row.brandNameHe}</TableCell>
                        <TableCell className="text-sm">
                          {formatDate(row.periodStartDate)} - {formatDate(row.periodEndDate)}
                        </TableCell>
                        <TableCell>{formatCurrency(Number(row.grossAmount))}</TableCell>
                        <TableCell className="font-medium">
                          {formatCurrency(Number(row.commissionAmount))}
                        </TableCell>
                        <TableCell>{formatPercent(Number(row.commissionRate))}</TableCell>
                        <TableCell>{getStatusBadge(row.status, reportType)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        );

      case "settlements":
        return (
          <Card>
            <CardHeader>
              <CardTitle>פירוט התחשבנויות</CardTitle>
              <CardDescription>
                מציג {displayRows.length} מתוך {reportData.rows.length} רשומות
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>שם תקופה</TableHead>
                      <TableHead>זכיין</TableHead>
                      <TableHead>מותג</TableHead>
                      <TableHead>תקופה</TableHead>
                      <TableHead>מכירות ברוטו</TableHead>
                      <TableHead>תמלוגים</TableHead>
                      <TableHead>לתשלום נטו</TableHead>
                      <TableHead>סטטוס</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {displayRows.map((row: any) => (
                      <TableRow key={row.id}>
                        <TableCell className="font-medium">{row.name}</TableCell>
                        <TableCell>{row.franchiseeName}</TableCell>
                        <TableCell>{row.brandNameHe}</TableCell>
                        <TableCell className="text-sm">
                          {formatDate(row.periodStartDate)} - {formatDate(row.periodEndDate)}
                        </TableCell>
                        <TableCell>{formatCurrency(Number(row.grossSales || 0))}</TableCell>
                        <TableCell>{formatCurrency(Number(row.royaltyAmount || 0))}</TableCell>
                        <TableCell className="font-medium">
                          {formatCurrency(Number(row.netPayable || 0))}
                        </TableCell>
                        <TableCell>{getStatusBadge(row.status, reportType)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        );

      case "franchisees":
        return (
          <Card>
            <CardHeader>
              <CardTitle>פירוט זכיינים</CardTitle>
              <CardDescription>
                מציג {displayRows.length} מתוך {reportData.rows.length} רשומות
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>שם</TableHead>
                      <TableHead>קוד</TableHead>
                      <TableHead>מותג</TableHead>
                      <TableHead>עיר</TableHead>
                      <TableHead>אימייל</TableHead>
                      <TableHead>טלפון</TableHead>
                      <TableHead>תאריך פתיחה</TableHead>
                      <TableHead>סטטוס</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {displayRows.map((row: any) => (
                      <TableRow key={row.id}>
                        <TableCell className="font-medium">{row.name}</TableCell>
                        <TableCell>{row.code}</TableCell>
                        <TableCell>{row.brandNameHe}</TableCell>
                        <TableCell>{row.city || "-"}</TableCell>
                        <TableCell>{row.contactEmail || "-"}</TableCell>
                        <TableCell>{row.contactPhone || "-"}</TableCell>
                        <TableCell>{row.openingDate ? formatDate(row.openingDate) : "-"}</TableCell>
                        <TableCell>{getStatusBadge(row.status, reportType)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        );

      case "suppliers":
        return (
          <Card>
            <CardHeader>
              <CardTitle>פירוט ספקים</CardTitle>
              <CardDescription>
                מציג {displayRows.length} מתוך {reportData.rows.length} רשומות
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>שם</TableHead>
                      <TableHead>קוד</TableHead>
                      <TableHead>איש קשר</TableHead>
                      <TableHead>אימייל</TableHead>
                      <TableHead>טלפון</TableHead>
                      <TableHead>שיעור עמלה</TableHead>
                      <TableHead>עמלות</TableHead>
                      <TableHead>סה״כ עמלות</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {displayRows.map((row: any) => (
                      <TableRow key={row.id}>
                        <TableCell className="font-medium">{row.name}</TableCell>
                        <TableCell>{row.code}</TableCell>
                        <TableCell>{row.contactName || "-"}</TableCell>
                        <TableCell>{row.contactEmail || "-"}</TableCell>
                        <TableCell>{row.contactPhone || "-"}</TableCell>
                        <TableCell>
                          {row.defaultCommissionRate != null
                            ? formatPercent(Number(row.defaultCommissionRate))
                            : "-"}
                        </TableCell>
                        <TableCell>{row.totalCommissions ?? 0}</TableCell>
                        <TableCell className="font-medium">
                          {formatCurrency(row.totalCommissionAmount ?? 0)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        );

      default:
        return null;
    }
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
            <span className="text-foreground">דוחות</span>
          </nav>
          <h1 className="text-3xl font-bold tracking-tight">מרכז דוחות</h1>
          <p className="text-muted-foreground mt-1">
            הפקת דוחות מותאמים אישית עם תצוגה מקדימה וייצוא לאקסל
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={() => fetchReport()}
            disabled={isLoading}
          >
            <RefreshCw
              className={`h-4 w-4 ml-2 ${isLoading ? "animate-spin" : ""}`}
            />
            רענון
          </Button>
          <Button
            variant="outline"
            onClick={handlePreview}
            disabled={isLoading || !reportData || reportData.rows.length === 0}
          >
            <Eye className="h-4 w-4 ml-2" />
            תצוגה מקדימה
          </Button>
          <Button
            onClick={handleExport}
            disabled={isExporting || !reportData || reportData.rows.length === 0}
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

      {/* Report Type Selector */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">סוג דוח</CardTitle>
          <CardDescription>בחר את סוג הדוח שברצונך להפיק</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {(Object.keys(reportTypeConfig) as ReportType[]).map((type) => (
              <button
                key={type}
                onClick={() => {
                  setReportType(type);
                  // Reset filters when changing report type
                  handleResetFilters();
                }}
                className={`p-4 rounded-lg border-2 text-start transition-colors ${
                  reportType === type
                    ? "border-primary bg-primary/5"
                    : "border-border hover:border-primary/50"
                }`}
              >
                <div className="flex items-center gap-2 mb-2">
                  {reportTypeConfig[type].icon}
                  <span className="font-medium">{reportTypeConfig[type].label}</span>
                </div>
                <p className="text-sm text-muted-foreground">
                  {reportTypeConfig[type].description}
                </p>
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Filters Card */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">סינון</CardTitle>
          <CardDescription>סנן את הדוח לפי תאריכים, מותג, ספק או סטטוס</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-4">
            {/* Date Range - Show for commissions and settlements */}
            {(reportType === "commissions" || reportType === "settlements") && (
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

            {/* Brand Filter */}
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

            {/* Supplier Filter - Show for commissions */}
            {reportType === "commissions" && (
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
            )}

            {/* Franchisee Filter - Show for commissions and settlements */}
            {(reportType === "commissions" || reportType === "settlements") && (
              <div className="space-y-2">
                <Label htmlFor="franchisee">זכיין</Label>
                <Select value={selectedFranchisee} onValueChange={setSelectedFranchisee}>
                  <SelectTrigger id="franchisee">
                    <SelectValue placeholder="כל הזכיינים" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">כל הזכיינים</SelectItem>
                    {franchisees.map((franchisee) => (
                      <SelectItem key={franchisee.id} value={franchisee.id}>
                        {franchisee.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Status Filter */}
            <div className="space-y-2">
              <Label htmlFor="status">סטטוס</Label>
              <Select value={selectedStatus} onValueChange={setSelectedStatus}>
                <SelectTrigger id="status">
                  <SelectValue placeholder="כל הסטטוסים" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">כל הסטטוסים</SelectItem>
                  {getStatusOptions().map((status) => (
                    <SelectItem key={status.value} value={status.value}>
                      {status.label}
                    </SelectItem>
                  ))}
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

      {/* Loading State */}
      {isLoading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      )}

      {/* Report Content */}
      {!isLoading && reportData && (
        <>
          {/* Summary Cards */}
          {renderSummaryCards()}

          {/* Data Table */}
          {renderDataTable()}
        </>
      )}

      {/* Preview Dialog */}
      <Dialog open={showPreview} onOpenChange={setShowPreview}>
        <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>תצוגה מקדימה - {reportTypeConfig[reportType].label}</DialogTitle>
            <DialogDescription>
              מציג את 10 הרשומות הראשונות. לצפייה בכל הנתונים, ייצא לאקסל.
            </DialogDescription>
          </DialogHeader>
          <div className="overflow-x-auto">
            {renderPreviewTable()}
          </div>
          {reportData && reportData.rows.length > 10 && (
            <p className="text-center text-muted-foreground py-2">
              מציג 10 מתוך {reportData.rows.length} רשומות
            </p>
          )}
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setShowPreview(false)}>
              סגור
            </Button>
            <Button
              onClick={() => {
                setShowPreview(false);
                handleExport();
              }}
              className="bg-green-600 hover:bg-green-700"
            >
              <FileSpreadsheet className="h-4 w-4 ml-2" />
              ייצוא לאקסל
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
