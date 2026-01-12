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
import { Checkbox } from "@/components/ui/checkbox";
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
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import {
  LogOut,
  RefreshCw,
  ChevronLeft,
  Check,
  X,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  Clock,
  ArrowRightLeft,
  FileSearch,
  Calendar,
  Search,
  CheckCheck,
} from "lucide-react";
import Link from "next/link";
import { he, formatCurrency } from "@/lib/translations";

// Types matching the API response
interface ReconciliationEntry {
  supplierId: string;
  supplierName: string;
  franchiseeId: string;
  franchiseeName: string;
  periodStartDate: string;
  periodEndDate: string;
  supplierReportedAmount: number;
  franchiseeReportedAmount: number;
  difference: number;
  matchStatus: "matched" | "discrepancy" | "pending";
  crossReferenceId?: string;
  commissionId?: string;
}

interface ReconciliationReport {
  periodStartDate: string;
  periodEndDate: string;
  totalPairs: number;
  matchedCount: number;
  discrepancyCount: number;
  pendingCount: number;
  totalSupplierAmount: number;
  totalFranchiseeAmount: number;
  totalDifference: number;
  entries: ReconciliationEntry[];
  generatedAt: string;
}

interface ReconciliationStats {
  total: number;
  matched: number;
  discrepancies: number;
  pending: number;
  bySupplier: Record<string, { matched: number; discrepancy: number }>;
}

interface Supplier {
  id: string;
  name: string;
  code: string;
}

interface Franchisee {
  id: string;
  name: string;
  code: string;
}

// Get translations
const t = he.admin.reconciliation;

// Get match status badge
const getStatusBadge = (status: string) => {
  switch (status) {
    case "matched":
      return (
        <Badge variant="success" className="flex items-center gap-1">
          <CheckCircle2 className="h-3 w-3" />
          {t.statuses.matched}
        </Badge>
      );
    case "discrepancy":
      return (
        <Badge variant="destructive" className="flex items-center gap-1">
          <AlertTriangle className="h-3 w-3" />
          {t.statuses.discrepancy}
        </Badge>
      );
    case "pending":
      return (
        <Badge variant="secondary" className="flex items-center gap-1">
          <Clock className="h-3 w-3" />
          {t.statuses.pending}
        </Badge>
      );
    default:
      return <Badge variant="outline">{status}</Badge>;
  }
};

export default function ReconciliationPage() {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const [report, setReport] = useState<ReconciliationReport | null>(null);
  const [stats, setStats] = useState<ReconciliationStats | null>(null);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [franchisees, setFranchisees] = useState<Franchisee[]>([]);

  // Filters
  const [periodStartDate, setPeriodStartDate] = useState<string>("");
  const [periodEndDate, setPeriodEndDate] = useState<string>("");
  const [selectedSupplier, setSelectedSupplier] = useState<string>("all");
  const [selectedFranchisee, setSelectedFranchisee] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  // Manual comparison form
  const [showCompareForm, setShowCompareForm] = useState(false);
  const [compareForm, setCompareForm] = useState({
    supplierId: "",
    franchiseeId: "",
    supplierAmount: "",
    franchiseeAmount: "",
    periodStartDate: "",
    periodEndDate: "",
    threshold: "10",
  });
  const [isComparing, setIsComparing] = useState(false);

  // Review dialog
  const [showReviewDialog, setShowReviewDialog] = useState(false);
  const [selectedEntry, setSelectedEntry] = useState<ReconciliationEntry | null>(null);
  const [reviewNotes, setReviewNotes] = useState("");
  const [isUpdating, setIsUpdating] = useState(false);

  // Selection state for bulk operations
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isBulkApproving, setIsBulkApproving] = useState(false);
  const [showBulkApproveDialog, setShowBulkApproveDialog] = useState(false);
  const [bulkApproveNotes, setBulkApproveNotes] = useState("");

  const { data: session, isPending } = authClient.useSession();
  const userRole = session ? (session.user as { role?: string })?.role : undefined;

  useEffect(() => {
    if (!isPending && !session) {
      router.push("/sign-in?redirect=/admin/reconciliation");
      return;
    }

    if (!isPending && session?.user && userRole !== "super_user" && userRole !== "admin") {
      router.push("/dashboard");
      return;
    }

    if (!isPending && session) {
      fetchStats();
      fetchSuppliers();
      fetchFranchisees();
      // Set default dates to current month
      const now = new Date();
      const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
      const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      setPeriodStartDate(firstDay.toISOString().split("T")[0]);
      setPeriodEndDate(lastDay.toISOString().split("T")[0]);
    }
  }, [session, isPending, router, userRole]);

  const fetchStats = async () => {
    try {
      const response = await fetch("/api/reconciliation?stats=true");
      if (!response.ok) throw new Error("Failed to fetch stats");
      const data = await response.json();
      setStats(data.stats);
    } catch (error) {
      console.error("Error fetching stats:", error);
    }
  };

  const fetchSuppliers = async () => {
    try {
      const response = await fetch("/api/suppliers?filter=active");
      if (!response.ok) throw new Error("Failed to fetch suppliers");
      const data = await response.json();
      setSuppliers(data.suppliers || []);
    } catch (error) {
      console.error("Error fetching suppliers:", error);
    }
  };

  const fetchFranchisees = async () => {
    try {
      const response = await fetch("/api/franchisees?filter=active");
      if (!response.ok) throw new Error("Failed to fetch franchisees");
      const data = await response.json();
      setFranchisees(data.franchisees || []);
    } catch (error) {
      console.error("Error fetching franchisees:", error);
    }
  };

  const fetchReport = async () => {
    if (!periodStartDate || !periodEndDate) {
      alert(t.filters.selectDateRange);
      return;
    }

    try {
      setIsLoading(true);
      const params = new URLSearchParams({
        periodStartDate,
        periodEndDate,
      });
      if (selectedSupplier && selectedSupplier !== "all") params.append("supplierId", selectedSupplier);
      if (selectedFranchisee && selectedFranchisee !== "all") params.append("franchiseeId", selectedFranchisee);

      const response = await fetch(`/api/reconciliation?${params}`);
      if (!response.ok) throw new Error("Failed to fetch report");
      const data = await response.json();
      setReport(data.report);
    } catch (error) {
      console.error("Error fetching report:", error);
      alert(t.messages.failedToFetchReport);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCompare = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setIsComparing(true);
      const response = await fetch("/api/reconciliation/compare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          supplierId: compareForm.supplierId,
          franchiseeId: compareForm.franchiseeId,
          supplierAmount: parseFloat(compareForm.supplierAmount),
          franchiseeAmount: parseFloat(compareForm.franchiseeAmount),
          periodStartDate: compareForm.periodStartDate,
          periodEndDate: compareForm.periodEndDate,
          threshold: parseFloat(compareForm.threshold),
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || t.messages.failedToCompare);
      }

      const result = await response.json();
      const statusText = result.comparison.matchStatus === "matched" ? t.statuses.matched : t.statuses.discrepancy;
      alert(
        t.messages.compareResult
          .replace("{status}", statusText.toUpperCase())
          .replace("{difference}", formatCurrency(result.comparison.difference))
          .replace("{threshold}", formatCurrency(result.comparison.threshold))
      );

      setShowCompareForm(false);
      setCompareForm({
        supplierId: "",
        franchiseeId: "",
        supplierAmount: "",
        franchiseeAmount: "",
        periodStartDate: "",
        periodEndDate: "",
        threshold: "10",
      });
      fetchStats();
      fetchReport();
    } catch (error) {
      console.error("Error comparing amounts:", error);
      alert(error instanceof Error ? error.message : t.messages.failedToCompare);
    } finally {
      setIsComparing(false);
    }
  };

  const handleUpdateStatus = async (newStatus: "matched" | "discrepancy") => {
    if (!selectedEntry?.crossReferenceId) return;

    try {
      setIsUpdating(true);
      const response = await fetch(`/api/reconciliation/${selectedEntry.crossReferenceId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          matchStatus: newStatus,
          reviewNotes,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || t.messages.failedToUpdateStatus);
      }

      setShowReviewDialog(false);
      setSelectedEntry(null);
      setReviewNotes("");
      fetchStats();
      fetchReport();
    } catch (error) {
      console.error("Error updating status:", error);
      alert(error instanceof Error ? error.message : t.messages.failedToUpdateStatus);
    } finally {
      setIsUpdating(false);
    }
  };

  const handleSignOut = async () => {
    await authClient.signOut();
    router.push("/sign-in");
  };

  // Filter entries based on status filter
  const filteredEntries = report?.entries.filter((entry) => {
    if (statusFilter === "all") return true;
    return entry.matchStatus === statusFilter;
  }) || [];

  // Selection handlers
  const handleSelectEntry = useCallback((crossRefId: string, checked: boolean) => {
    setSelectedIds((prev) => {
      const newSet = new Set(prev);
      if (checked) {
        newSet.add(crossRefId);
      } else {
        newSet.delete(crossRefId);
      }
      return newSet;
    });
  }, []);

  const handleSelectAll = useCallback((entries: ReconciliationEntry[], checked: boolean) => {
    if (checked) {
      // Only select entries that can be bulk approved (matched or pending, not discrepancy)
      const selectableIds = entries
        .filter((entry) => entry.crossReferenceId && entry.matchStatus !== "discrepancy")
        .map((entry) => entry.crossReferenceId as string);
      setSelectedIds(new Set(selectableIds));
    } else {
      setSelectedIds(new Set());
    }
  }, []);

  const handleBulkApprove = async () => {
    if (selectedIds.size === 0) return;

    try {
      setIsBulkApproving(true);
      const response = await fetch("/api/reconciliation/bulk-approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          crossReferenceIds: Array.from(selectedIds),
          reviewNotes: bulkApproveNotes || "אישור קבוצתי",
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || t.messages.failedToBulkApprove);
      }

      const result = await response.json();
      alert(
        t.messages.bulkApproveResult
          .replace("{approved}", result.approved)
          .replace("{skipped}", result.skipped)
          .replace("{failed}", result.failed)
      );

      // Reset selection and refresh data
      setSelectedIds(new Set());
      setShowBulkApproveDialog(false);
      setBulkApproveNotes("");
      fetchStats();
      fetchReport();
    } catch (error) {
      console.error("Error bulk approving:", error);
      alert(error instanceof Error ? error.message : t.messages.failedToBulkApprove);
    } finally {
      setIsBulkApproving(false);
    }
  };

  // Get selected entries that can be approved (matched or pending)
  const selectableMatchedEntries = filteredEntries.filter(
    (entry) => entry.crossReferenceId && entry.matchStatus !== "discrepancy"
  );

  // Check if all selectable entries are selected
  const allSelectableSelected = selectableMatchedEntries.length > 0 &&
    selectableMatchedEntries.every((entry) => selectedIds.has(entry.crossReferenceId!));

  // Count selected entries by status
  const selectedMatchedCount = filteredEntries.filter(
    (entry) => selectedIds.has(entry.crossReferenceId!) && entry.matchStatus === "matched"
  ).length;
  const selectedPendingCount = filteredEntries.filter(
    (entry) => selectedIds.has(entry.crossReferenceId!) && entry.matchStatus === "pending"
  ).length;

  if (isPending) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6">
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-4">
          <Link href="/dashboard">
            <Button variant="ghost" size="sm">
              <ChevronLeft className="h-4 w-4 ms-1 rtl-flip" />
              {he.common.dashboard}
            </Button>
          </Link>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <ArrowRightLeft className="h-8 w-8" />
            {t.pageTitle}
          </h1>
        </div>
        <Button variant="outline" onClick={handleSignOut}>
          <LogOut className="ms-2 h-4 w-4" />
          {he.common.signOut}
        </Button>
      </div>

      {/* Stats Cards */}
      {stats && (
        <div className="grid gap-4 md:grid-cols-4 mb-8">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">{t.stats.totalComparisons}</CardTitle>
              <FileSearch className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.total}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">{t.stats.matched}</CardTitle>
              <CheckCircle2 className="h-4 w-4 text-green-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-green-600">{stats.matched}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">{t.stats.discrepancies}</CardTitle>
              <AlertTriangle className="h-4 w-4 text-red-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-red-600">{stats.discrepancies}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">{t.stats.pendingReview}</CardTitle>
              <Clock className="h-4 w-4 text-yellow-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-yellow-600">{stats.pending}</div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Filters and Actions */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Search className="h-5 w-5" />
            {t.filters.title}
          </CardTitle>
          <CardDescription>
            {t.filters.description}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-2">
              <Label htmlFor="periodStartDate">{t.filters.periodStartDate}</Label>
              <Input
                id="periodStartDate"
                type="date"
                value={periodStartDate}
                onChange={(e) => setPeriodStartDate(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="periodEndDate">{t.filters.periodEndDate}</Label>
              <Input
                id="periodEndDate"
                type="date"
                value={periodEndDate}
                onChange={(e) => setPeriodEndDate(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="supplier">{t.filters.supplier}</Label>
              <Select value={selectedSupplier} onValueChange={setSelectedSupplier}>
                <SelectTrigger>
                  <SelectValue placeholder={t.filters.allSuppliers} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t.filters.allSuppliers}</SelectItem>
                  {suppliers.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="franchisee">{t.filters.franchisee}</Label>
              <Select value={selectedFranchisee} onValueChange={setSelectedFranchisee}>
                <SelectTrigger>
                  <SelectValue placeholder={t.filters.allFranchisees} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t.filters.allFranchisees}</SelectItem>
                  {franchisees.map((f) => (
                    <SelectItem key={f.id} value={f.id}>
                      {f.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex items-center gap-4 mt-4">
            <Button onClick={fetchReport} disabled={isLoading}>
              {isLoading ? (
                <>
                  <Loader2 className="ml-2 h-4 w-4 animate-spin" />
                  {t.actions.loading}
                </>
              ) : (
                <>
                  <Search className="ml-2 h-4 w-4" />
                  {t.actions.search}
                </>
              )}
            </Button>
            <Button variant="outline" onClick={fetchStats}>
              <RefreshCw className="ml-2 h-4 w-4" />
              {t.actions.refreshStats}
            </Button>
            <Button variant="secondary" onClick={() => setShowCompareForm(true)}>
              <ArrowRightLeft className="ml-2 h-4 w-4" />
              {t.actions.manualCompare}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Manual Compare Form */}
      {showCompareForm && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>{t.manualCompare.title}</CardTitle>
            <CardDescription>
              {t.manualCompare.description.replace("{threshold}", formatCurrency(10))}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleCompare} className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="compareSupplierId">{t.manualCompare.supplier}</Label>
                  <Select
                    value={compareForm.supplierId}
                    onValueChange={(v) => setCompareForm({ ...compareForm, supplierId: v })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder={t.manualCompare.supplierPlaceholder} />
                    </SelectTrigger>
                    <SelectContent>
                      {suppliers.map((s) => (
                        <SelectItem key={s.id} value={s.id}>
                          {s.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="compareFranchiseeId">{t.manualCompare.franchisee}</Label>
                  <Select
                    value={compareForm.franchiseeId}
                    onValueChange={(v) => setCompareForm({ ...compareForm, franchiseeId: v })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder={t.manualCompare.franchiseePlaceholder} />
                    </SelectTrigger>
                    <SelectContent>
                      {franchisees.map((f) => (
                        <SelectItem key={f.id} value={f.id}>
                          {f.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="supplierAmount">{t.manualCompare.supplierAmount}</Label>
                  <Input
                    id="supplierAmount"
                    type="number"
                    step="0.01"
                    value={compareForm.supplierAmount}
                    onChange={(e) => setCompareForm({ ...compareForm, supplierAmount: e.target.value })}
                    placeholder={t.manualCompare.supplierAmountPlaceholder}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="franchiseeAmount">{t.manualCompare.franchiseeAmount}</Label>
                  <Input
                    id="franchiseeAmount"
                    type="number"
                    step="0.01"
                    value={compareForm.franchiseeAmount}
                    onChange={(e) => setCompareForm({ ...compareForm, franchiseeAmount: e.target.value })}
                    placeholder={t.manualCompare.franchiseeAmountPlaceholder}
                    required
                  />
                </div>
              </div>
              <div className="grid gap-4 md:grid-cols-3">
                <div className="space-y-2">
                  <Label htmlFor="comparePeriodStart">{t.manualCompare.periodStartDate}</Label>
                  <Input
                    id="comparePeriodStart"
                    type="date"
                    value={compareForm.periodStartDate}
                    onChange={(e) => setCompareForm({ ...compareForm, periodStartDate: e.target.value })}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="comparePeriodEnd">{t.manualCompare.periodEndDate}</Label>
                  <Input
                    id="comparePeriodEnd"
                    type="date"
                    value={compareForm.periodEndDate}
                    onChange={(e) => setCompareForm({ ...compareForm, periodEndDate: e.target.value })}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="threshold">{t.manualCompare.threshold}</Label>
                  <Input
                    id="threshold"
                    type="number"
                    step="0.01"
                    value={compareForm.threshold}
                    onChange={(e) => setCompareForm({ ...compareForm, threshold: e.target.value })}
                    placeholder="10.00"
                  />
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => setShowCompareForm(false)}>
                  {t.manualCompare.cancel}
                </Button>
                <Button type="submit" disabled={isComparing}>
                  {isComparing ? (
                    <>
                      <Loader2 className="ml-2 h-4 w-4 animate-spin" />
                      {t.manualCompare.comparing}
                    </>
                  ) : (
                    <>
                      <ArrowRightLeft className="ml-2 h-4 w-4" />
                      {t.manualCompare.compare}
                    </>
                  )}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {/* Report Results */}
      {report && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <span className="flex items-center gap-2">
                <Calendar className="h-5 w-5" />
                {t.report.title}
              </span>
              <div className="flex items-center gap-2">
                <Label htmlFor="statusFilter" className="text-sm font-normal">
                  {t.filters.filterByStatus}
                </Label>
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="w-[150px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{t.filters.all}</SelectItem>
                    <SelectItem value="matched">{t.statuses.matched}</SelectItem>
                    <SelectItem value="discrepancy">{t.statuses.discrepancy}</SelectItem>
                    <SelectItem value="pending">{t.statuses.pending}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardTitle>
            <CardDescription>
              {t.report.period} {new Date(report.periodStartDate).toLocaleDateString("he-IL")} -{" "}
              {new Date(report.periodEndDate).toLocaleDateString("he-IL")}
              {" | "}
              {t.report.generated} {new Date(report.generatedAt).toLocaleString("he-IL")}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {/* Summary */}
            <div className="grid gap-4 md:grid-cols-4 mb-6">
              <div className="p-4 border rounded-lg">
                <div className="text-sm text-muted-foreground">{t.summary.totalPairs}</div>
                <div className="text-2xl font-bold">{report.totalPairs}</div>
              </div>
              <div className="p-4 border rounded-lg">
                <div className="text-sm text-muted-foreground">{t.summary.totalSupplierAmount}</div>
                <div className="text-2xl font-bold">{formatCurrency(report.totalSupplierAmount)}</div>
              </div>
              <div className="p-4 border rounded-lg">
                <div className="text-sm text-muted-foreground">{t.summary.totalFranchiseeAmount}</div>
                <div className="text-2xl font-bold">{formatCurrency(report.totalFranchiseeAmount)}</div>
              </div>
              <div className="p-4 border rounded-lg">
                <div className="text-sm text-muted-foreground">{t.summary.totalDifference}</div>
                <div className="text-2xl font-bold text-amber-600">
                  {formatCurrency(report.totalDifference)}
                </div>
              </div>
            </div>

            {/* Status Summary and Bulk Actions */}
            <div className="flex items-center justify-between mb-6">
              <div className="flex gap-4">
                <div className="flex items-center gap-2">
                  <Badge variant="success">{report.matchedCount}</Badge>
                  <span className="text-sm">{t.summary.matched}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="destructive">{report.discrepancyCount}</Badge>
                  <span className="text-sm">{t.summary.discrepancies}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="secondary">{report.pendingCount}</Badge>
                  <span className="text-sm">{t.summary.pending}</span>
                </div>
              </div>

              {/* Bulk Actions */}
              <div className="flex items-center gap-2">
                {selectedIds.size > 0 && (
                  <span className="text-sm text-muted-foreground">
                    {selectedIds.size} {t.summary.selected}
                    {selectedMatchedCount > 0 && ` (${selectedMatchedCount} ${t.statuses.matched})`}
                    {selectedPendingCount > 0 && ` (${selectedPendingCount} ${t.statuses.pending})`}
                  </span>
                )}
                <Button
                  variant="default"
                  size="sm"
                  disabled={selectedIds.size === 0}
                  onClick={() => setShowBulkApproveDialog(true)}
                  className="bg-green-600 hover:bg-green-700"
                >
                  <CheckCheck className="h-4 w-4 mr-1" />
                  {t.bulkActions.bulkApprove.replace("{count}", String(selectedIds.size))}
                </Button>
              </div>
            </div>

            {/* Entries Table */}
            {filteredEntries.length > 0 ? (
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[50px]">
                        <Checkbox
                          checked={allSelectableSelected}
                          onCheckedChange={(checked) => handleSelectAll(filteredEntries, checked as boolean)}
                          aria-label={t.table.selectAll}
                          disabled={selectableMatchedEntries.length === 0}
                        />
                      </TableHead>
                      <TableHead>{t.table.supplier}</TableHead>
                      <TableHead>{t.table.franchisee}</TableHead>
                      <TableHead>{t.table.supplierAmount}</TableHead>
                      <TableHead>{t.table.franchiseeAmount}</TableHead>
                      <TableHead>{t.table.difference}</TableHead>
                      <TableHead>{t.table.status}</TableHead>
                      <TableHead>{t.table.actions}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredEntries.map((entry, index) => {
                      const canSelect = entry.crossReferenceId && entry.matchStatus !== "discrepancy";
                      const isSelected = entry.crossReferenceId ? selectedIds.has(entry.crossReferenceId) : false;

                      // Row background color based on status
                      const rowClassName = entry.matchStatus === "matched"
                        ? "bg-green-50 hover:bg-green-100"
                        : entry.matchStatus === "discrepancy"
                        ? "bg-red-50 hover:bg-red-100"
                        : entry.matchStatus === "pending"
                        ? "bg-yellow-50 hover:bg-yellow-100"
                        : "";

                      return (
                        <TableRow
                          key={entry.crossReferenceId || index}
                          className={rowClassName}
                        >
                          <TableCell>
                            {entry.crossReferenceId && (
                              <Checkbox
                                checked={isSelected}
                                onCheckedChange={(checked) =>
                                  handleSelectEntry(entry.crossReferenceId!, checked as boolean)
                                }
                                aria-label={`Select ${entry.supplierName} - ${entry.franchiseeName}`}
                                disabled={!canSelect}
                              />
                            )}
                          </TableCell>
                          <TableCell className="font-medium">{entry.supplierName}</TableCell>
                          <TableCell>{entry.franchiseeName}</TableCell>
                          <TableCell className="ltr-content">
                            {formatCurrency(entry.supplierReportedAmount)}
                          </TableCell>
                          <TableCell className="ltr-content">
                            {formatCurrency(entry.franchiseeReportedAmount)}
                          </TableCell>
                          <TableCell className={`ltr-content ${Math.abs(entry.difference) > 10 ? "text-red-600 font-medium" : ""}`}>
                            {formatCurrency(entry.difference)}
                          </TableCell>
                          <TableCell>{getStatusBadge(entry.matchStatus)}</TableCell>
                          <TableCell>
                            {entry.matchStatus === "discrepancy" && entry.crossReferenceId && (
                              <div className="flex gap-2 justify-start">
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => {
                                    setSelectedEntry(entry);
                                    setShowReviewDialog(true);
                                  }}
                                >
                                  {t.entryActions.quickReview}
                                </Button>
                                <Link href={`/admin/reconciliation/discrepancy/${entry.crossReferenceId}`}>
                                  <Button size="sm" variant="default">
                                    {t.entryActions.resolve}
                                  </Button>
                                </Link>
                              </div>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                {t.table.noEntries}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Review Dialog */}
      <Dialog open={showReviewDialog} onOpenChange={setShowReviewDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t.reviewDialog.title}</DialogTitle>
            <DialogDescription>
              {t.reviewDialog.description}
            </DialogDescription>
          </DialogHeader>
          {selectedEntry && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="font-medium">{t.reviewDialog.supplier}</span> {selectedEntry.supplierName}
                </div>
                <div>
                  <span className="font-medium">{t.reviewDialog.franchisee}</span> {selectedEntry.franchiseeName}
                </div>
                <div>
                  <span className="font-medium">{t.reviewDialog.supplierAmount}</span>{" "}
                  {formatCurrency(selectedEntry.supplierReportedAmount)}
                </div>
                <div>
                  <span className="font-medium">{t.reviewDialog.franchiseeAmount}</span>{" "}
                  {formatCurrency(selectedEntry.franchiseeReportedAmount)}
                </div>
                <div className="col-span-2">
                  <span className="font-medium">{t.reviewDialog.difference}</span>{" "}
                  <span className="text-red-600 font-bold">
                    {formatCurrency(selectedEntry.difference)}
                  </span>
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="reviewNotes">{t.reviewDialog.reviewNotes}</Label>
                <Textarea
                  id="reviewNotes"
                  value={reviewNotes}
                  onChange={(e) => setReviewNotes(e.target.value)}
                  placeholder={t.reviewDialog.reviewNotesPlaceholder}
                  rows={3}
                />
              </div>
            </div>
          )}
          <DialogFooter className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => setShowReviewDialog(false)}
              disabled={isUpdating}
            >
              {t.reviewDialog.cancel}
            </Button>
            <Button
              variant="destructive"
              onClick={() => handleUpdateStatus("discrepancy")}
              disabled={isUpdating}
            >
              {isUpdating ? <Loader2 className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4 mr-1" />}
              {t.reviewDialog.confirmDiscrepancy}
            </Button>
            <Button
              variant="default"
              onClick={() => handleUpdateStatus("matched")}
              disabled={isUpdating}
            >
              {isUpdating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4 mr-1" />}
              {t.reviewDialog.markAsMatched}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk Approve Dialog */}
      <Dialog open={showBulkApproveDialog} onOpenChange={setShowBulkApproveDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CheckCheck className="h-5 w-5 text-green-600" />
              {t.bulkApproveDialog.title}
            </DialogTitle>
            <DialogDescription>
              {t.bulkApproveDialog.description.replace("{count}", String(selectedIds.size))}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
              <div className="text-sm space-y-1">
                <div className="flex justify-between">
                  <span>{t.bulkApproveDialog.totalSelected}</span>
                  <span className="font-medium">{selectedIds.size}</span>
                </div>
                {selectedMatchedCount > 0 && (
                  <div className="flex justify-between text-green-700">
                    <span>{t.bulkApproveDialog.alreadyMatched}</span>
                    <span className="font-medium">{selectedMatchedCount}</span>
                  </div>
                )}
                {selectedPendingCount > 0 && (
                  <div className="flex justify-between text-yellow-700">
                    <span>{t.bulkApproveDialog.pending}</span>
                    <span className="font-medium">{selectedPendingCount}</span>
                  </div>
                )}
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="bulkApproveNotes">{t.bulkApproveDialog.approvalNotes}</Label>
              <Textarea
                id="bulkApproveNotes"
                value={bulkApproveNotes}
                onChange={(e) => setBulkApproveNotes(e.target.value)}
                placeholder={t.bulkApproveDialog.approvalNotesPlaceholder}
                rows={2}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setShowBulkApproveDialog(false);
                setBulkApproveNotes("");
              }}
              disabled={isBulkApproving}
            >
              {t.bulkApproveDialog.cancel}
            </Button>
            <Button
              onClick={handleBulkApprove}
              disabled={isBulkApproving || selectedIds.size === 0}
              className="bg-green-600 hover:bg-green-700"
            >
              {isBulkApproving ? (
                <>
                  <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                  {t.bulkApproveDialog.approving}
                </>
              ) : (
                <>
                  <CheckCheck className="h-4 w-4 mr-1" />
                  {t.bulkApproveDialog.approve.replace("{count}", String(selectedIds.size))}
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
