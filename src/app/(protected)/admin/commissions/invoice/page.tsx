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
  ChevronLeft,
  RefreshCw,
  Loader2,
  Download,
  FileSpreadsheet,
  Receipt,
  Building2,
  DollarSign,
  ShoppingBag,
} from "lucide-react";
import Link from "next/link";
import { he, formatCurrency } from "@/lib/translations";
import { useSuppliers } from "@/queries/suppliers";
import { useInvoiceCommissions } from "@/queries/commissions";

// Types
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

// Format percentage
const formatPercent = (rate: number): string => {
  return `${rate.toFixed(2)}%`;
};

// Format date
const formatDate = (dateStr: string): string => {
  if (!dateStr) return "";
  return new Date(dateStr).toLocaleDateString("he-IL");
};

// Translation constants
const t = he.admin.commissions;

export default function InvoiceReportPage() {
  const router = useRouter();
  const [isExporting, setIsExporting] = useState(false);
  const [invoiceData, setInvoiceData] = useState<InvoiceData | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [selectedSupplierId, setSelectedSupplierId] = useState<string>("");
  const [periodStartDate, setPeriodStartDate] = useState<string>("");
  const [periodEndDate, setPeriodEndDate] = useState<string>("");
  const [status, setStatus] = useState<string>("approved");

  const { data: session, isPending } = authClient.useSession();
  const userRole = session ? (session.user as { role?: string })?.role : undefined;

  // Use TanStack Query hooks
  const { data: suppliersData = [], isLoading: isLoadingSuppliers } = useSuppliers();
  const suppliers: Supplier[] = suppliersData;

  useEffect(() => {
    if (!isPending && !session) {
      router.push("/sign-in?redirect=/admin/commissions/invoice");
      return;
    }

    // Only Super Users can access this page
    if (!isPending && session?.user && userRole !== "super_user") {
      router.push("/dashboard");
      return;
    }

    if (!isPending && session) {
      // Set default dates to current month
      const now = new Date();
      const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
      const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      setPeriodStartDate(firstDay.toISOString().split("T")[0]);
      setPeriodEndDate(lastDay.toISOString().split("T")[0]);
    }
  }, [session, isPending, router, userRole]);

  const fetchInvoiceData = async () => {
    if (!selectedSupplierId || !periodStartDate || !periodEndDate) return;

    try {
      setError(null);
      const params = new URLSearchParams({
        supplierId: selectedSupplierId,
        periodStartDate,
        periodEndDate,
      });
      if (status) params.append("status", status);

      const response = await fetch(`/api/commissions/invoice?${params.toString()}`);
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || t.invoice.errors.loadInvoiceData);
      }
      const data = await response.json();
      setInvoiceData(data.invoiceData);
    } catch (err) {
      console.error("Error fetching invoice data:", err);
      setError(err instanceof Error ? err.message : t.invoice.errors.loadInvoiceData);
      setInvoiceData(null);
    }
  };

  const handleExport = async () => {
    if (!selectedSupplierId || !periodStartDate || !periodEndDate) return;

    try {
      setIsExporting(true);
      setError(null);

      const params = new URLSearchParams({
        supplierId: selectedSupplierId,
        periodStartDate,
        periodEndDate,
      });
      if (status) params.append("status", status);

      const response = await fetch(`/api/commissions/invoice/export?${params.toString()}`);

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || t.invoice.errors.exportReport);
      }

      // Get the filename from the Content-Disposition header
      const contentDisposition = response.headers.get("Content-Disposition");
      let filename = "invoice_report.xlsx";
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
    } catch (err) {
      console.error("Error exporting report:", err);
      setError(err instanceof Error ? err.message : t.invoice.errors.exportReport);
    } finally {
      setIsExporting(false);
    }
  };

  const handleSignOut = async () => {
    await authClient.signOut();
    router.push("/sign-in");
  };

  if (isPending || isLoadingSuppliers) {
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
              <ChevronLeft className="h-4 w-4 ms-1 rtl-flip" />
              {t.invoice.backToDashboard}
            </Button>
          </Link>
          <h1 className="text-3xl font-bold">{t.invoice.pageTitle}</h1>
          <Badge variant="secondary">{t.invoice.superUserOnly}</Badge>
        </div>
        <Button variant="outline" onClick={handleSignOut}>
          <LogOut className="ms-2 h-4 w-4" />
          {he.common.signOut}
        </Button>
      </div>

      {/* Description Card */}
      <Card className="mb-6 bg-muted/50">
        <CardContent className="py-4">
          <div className="flex items-start gap-4">
            <Receipt className="h-8 w-8 text-primary mt-1" />
            <div>
              <h2 className="font-semibold text-lg">{t.invoice.description.title}</h2>
              <p className="text-muted-foreground">
                {t.invoice.description.content}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Error Message */}
      {error && (
        <Card className="mb-6 border-destructive bg-destructive/10">
          <CardContent className="py-4">
            <p className="text-destructive">{error}</p>
          </CardContent>
        </Card>
      )}

      {/* Filters */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Truck className="h-5 w-5" />
            {t.invoice.filters.title}
          </CardTitle>
          <CardDescription>
            {t.invoice.filters.description}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Supplier Selection */}
            <div className="space-y-2">
              <Label>{t.invoice.filters.supplierRequired}</Label>
              <Select
                value={selectedSupplierId}
                onValueChange={setSelectedSupplierId}
              >
                <SelectTrigger>
                  <SelectValue placeholder={t.invoice.filters.selectSupplier} />
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

            {/* Period Start Date */}
            <div className="space-y-2">
              <Label>{t.invoice.filters.fromDate}</Label>
              <Input
                type="date"
                value={periodStartDate}
                onChange={(e) => setPeriodStartDate(e.target.value)}
              />
            </div>

            {/* Period End Date */}
            <div className="space-y-2">
              <Label>{t.invoice.filters.toDate}</Label>
              <Input
                type="date"
                value={periodEndDate}
                onChange={(e) => setPeriodEndDate(e.target.value)}
              />
            </div>

            {/* Status Filter */}
            <div className="space-y-2">
              <Label>{t.invoice.filters.commissionStatus}</Label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger>
                  <SelectValue placeholder={t.invoice.filters.allStatuses} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">{t.invoice.filters.allStatuses}</SelectItem>
                  <SelectItem value="approved">{t.invoice.filters.statusApproved}</SelectItem>
                  <SelectItem value="calculated">{t.invoice.filters.statusCalculated}</SelectItem>
                  <SelectItem value="paid">{t.invoice.filters.statusPaid}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-2 mt-6 pt-4 border-t">
            <Button
              variant="outline"
              onClick={fetchInvoiceData}
              disabled={!selectedSupplierId || !periodStartDate || !periodEndDate}
            >
              <RefreshCw className="h-4 w-4 ml-2" />
              {t.invoice.actions.showData}
            </Button>
            <Button
              onClick={handleExport}
              disabled={!selectedSupplierId || !periodStartDate || !periodEndDate || isExporting}
            >
              {isExporting ? (
                <Loader2 className="h-4 w-4 animate-spin ml-2" />
              ) : (
                <Download className="h-4 w-4 ml-2" />
              )}
              {t.invoice.actions.exportToExcel}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Invoice Data Display */}
      {invoiceData && (
        <>
          {/* Summary Card */}
          <Card className="mb-6">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <Building2 className="h-5 w-5" />
                    {invoiceData.supplierName}
                  </CardTitle>
                  <CardDescription>
                    {t.invoice.supplierInfo.code} {invoiceData.supplierCode} |
                    {t.invoice.supplierInfo.period} {formatDate(invoiceData.periodStartDate)} - {formatDate(invoiceData.periodEndDate)}
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
          </Card>

          {/* Totals Cards */}
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4 mb-6">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">{t.invoice.summary.brands}</CardTitle>
                <ShoppingBag className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {invoiceData.totals.totalBrands}
                </div>
                <p className="text-xs text-muted-foreground">
                  {t.invoice.summary.separateInvoices}
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">{t.invoice.summary.totalCommissions}</CardTitle>
                <FileSpreadsheet className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {invoiceData.totals.totalCommissions}
                </div>
                <p className="text-xs text-muted-foreground">
                  {t.invoice.summary.commissionRecords}
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">{t.invoice.summary.netAmount}</CardTitle>
                <DollarSign className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {formatCurrency(invoiceData.totals.totalNetAmount)}
                </div>
                <p className="text-xs text-muted-foreground">
                  {t.invoice.summary.beforeVat}
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">{t.invoice.summary.commissionAmount}</CardTitle>
                <Receipt className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-primary">
                  {formatCurrency(invoiceData.totals.totalCommissionAmount)}
                </div>
                <p className="text-xs text-muted-foreground">
                  {t.invoice.summary.totalToPay}
                </p>
              </CardContent>
            </Card>
          </div>

          {/* By Brand Table */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Receipt className="h-5 w-5" />
                {t.invoice.table.title}
              </CardTitle>
              <CardDescription>
                {t.invoice.table.description}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {invoiceData.byBrand.length === 0 ? (
                <p className="text-center py-8 text-muted-foreground">
                  {t.invoice.table.noData}
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b">
                        <th className="text-right py-3 px-4">{t.invoice.table.brandCode}</th>
                        <th className="text-right py-3 px-4">{t.invoice.table.brandName}</th>
                        <th className="text-right py-3 px-4">{t.invoice.table.commissions}</th>
                        <th className="text-right py-3 px-4">{t.invoice.table.grossAmount}</th>
                        <th className="text-right py-3 px-4">{t.invoice.table.netAmount}</th>
                        <th className="text-right py-3 px-4">{t.invoice.table.avgRate}</th>
                        <th className="text-right py-3 px-4">{t.invoice.table.invoiceAmount}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {invoiceData.byBrand.map((brand) => (
                        <tr key={brand.brandId} className="border-b hover:bg-muted/50">
                          <td className="py-3 px-4 font-mono text-sm">{brand.brandCode}</td>
                          <td className="py-3 px-4">
                            <div>
                              <p className="font-medium">{brand.brandNameHe}</p>
                              {brand.brandNameEn && (
                                <p className="text-xs text-muted-foreground">{brand.brandNameEn}</p>
                              )}
                            </div>
                          </td>
                          <td className="py-3 px-4">{brand.summary.commissionCount}</td>
                          <td className="py-3 px-4">{formatCurrency(brand.summary.totalGrossAmount)}</td>
                          <td className="py-3 px-4">{formatCurrency(brand.summary.totalNetAmount)}</td>
                          <td className="py-3 px-4">{formatPercent(brand.summary.avgCommissionRate)}</td>
                          <td className="py-3 px-4">
                            <span className="font-bold text-lg text-primary">
                              {formatCurrency(brand.summary.totalCommissionAmount)}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="bg-muted/30 font-bold">
                        <td className="py-3 px-4" colSpan={2}>{t.invoice.table.total} ({invoiceData.totals.totalBrands} {t.invoice.table.invoices})</td>
                        <td className="py-3 px-4">{invoiceData.totals.totalCommissions}</td>
                        <td className="py-3 px-4">{formatCurrency(invoiceData.totals.totalGrossAmount)}</td>
                        <td className="py-3 px-4">{formatCurrency(invoiceData.totals.totalNetAmount)}</td>
                        <td className="py-3 px-4">-</td>
                        <td className="py-3 px-4 text-lg text-primary">
                          {formatCurrency(invoiceData.totals.totalCommissionAmount)}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Export Instructions */}
          <Card className="mt-6 bg-muted/30">
            <CardContent className="py-4">
              <div className="flex items-start gap-4">
                <FileSpreadsheet className="h-6 w-6 text-muted-foreground mt-1" />
                <div>
                  <h3 className="font-semibold">{t.invoice.export.title}</h3>
                  <p className="text-sm text-muted-foreground mb-2">
                    {t.invoice.export.description}
                  </p>
                  <ul className="text-sm text-muted-foreground list-disc list-inside space-y-1">
                    <li><strong>{t.invoice.export.sheets.summary.split(" - ")[0]}</strong> - {t.invoice.export.sheets.summary.split(" - ")[1]}</li>
                    <li><strong>{t.invoice.export.sheets.brandSummary.split(" - ")[0]}</strong> - {t.invoice.export.sheets.brandSummary.split(" - ")[1]}</li>
                    <li><strong>{t.invoice.export.sheets.invoicePerBrand.split(" - ")[0]}</strong> - {t.invoice.export.sheets.invoicePerBrand.split(" - ").slice(1).join(" - ")}</li>
                    <li><strong>{t.invoice.export.sheets.fullDetails.split(" - ")[0]}</strong> - {t.invoice.export.sheets.fullDetails.split(" - ")[1]}</li>
                    <li><strong>{t.invoice.export.sheets.hashavshevet.split(" - ")[0]}</strong> - {t.invoice.export.sheets.hashavshevet.split(" - ")[1]}</li>
                  </ul>
                </div>
              </div>
            </CardContent>
          </Card>
        </>
      )}

      {/* Empty State */}
      {!invoiceData && !error && (
        <Card className="py-12">
          <CardContent className="text-center">
            <Receipt className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">{t.invoice.emptyState.title}</h3>
            <p className="text-muted-foreground">
              {t.invoice.emptyState.description}
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
