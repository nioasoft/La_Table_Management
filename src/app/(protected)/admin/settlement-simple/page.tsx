"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { toast } from "sonner";
import Link from "next/link";

// UI Components
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
  RefreshCw,
  FileSpreadsheet,
  ChevronRight,
  History,
} from "lucide-react";

// Custom Components
import { SettlementSummaryCards } from "@/components/settlement-simple/settlement-summary-cards";
import { SettlementTable } from "@/components/settlement-simple/settlement-table";
import { AdjustmentDialog } from "@/components/settlement-simple/adjustment-dialog";

// Queries
import {
  useSettlementSimpleReport,
  useSaveSettlementAdjustment,
  useExportSettlementSimple,
  type SettlementSimpleFilters,
} from "@/queries/settlement-simple";

// Types
import type { SettlementLineItem } from "@/data-access/settlement-simple";
import type { AdjustmentType } from "@/db/schema";

// Get default period (current quarter)
function getDefaultPeriod(): { start: string; end: string } {
  const now = new Date();
  const quarter = Math.floor(now.getMonth() / 3);
  const year = now.getFullYear();

  // If we're in Q1, default to previous quarter (Q4 of last year)
  const startMonth = quarter === 0 ? 9 : (quarter - 1) * 3;
  const startYear = quarter === 0 ? year - 1 : year;

  const start = new Date(startYear, startMonth, 1);
  const end = new Date(startYear, startMonth + 3, 0);

  return {
    start: start.toISOString().split("T")[0],
    end: end.toISOString().split("T")[0],
  };
}

export default function SettlementSimplePage() {
  const router = useRouter();
  const { data: session, isPending: isSessionPending } = authClient.useSession();
  const userRole = session
    ? (session.user as { role?: string })?.role
    : undefined;

  // Default period
  const defaultPeriod = getDefaultPeriod();

  // Filter state
  const [periodStartDate, setPeriodStartDate] = useState(defaultPeriod.start);
  const [periodEndDate, setPeriodEndDate] = useState(defaultPeriod.end);
  const [selectedSupplier, setSelectedSupplier] = useState("");
  const [selectedFranchisee, setSelectedFranchisee] = useState("");
  const [selectedBrand, setSelectedBrand] = useState("");

  // Applied filters (triggers data fetch)
  const [appliedFilters, setAppliedFilters] = useState<SettlementSimpleFilters>({
    periodStartDate: defaultPeriod.start,
    periodEndDate: defaultPeriod.end,
  });

  // Dialog state
  const [adjustmentItem, setAdjustmentItem] = useState<SettlementLineItem | null>(null);
  const [isAdjustmentDialogOpen, setIsAdjustmentDialogOpen] = useState(false);

  // Queries
  const {
    data,
    isLoading,
    refetch,
  } = useSettlementSimpleReport(appliedFilters);

  const saveAdjustmentMutation = useSaveSettlementAdjustment();
  const exportMutation = useExportSettlementSimple();

  // Redirect if not authenticated or not admin
  useEffect(() => {
    if (!isSessionPending && !session) {
      router.push("/sign-in?redirect=/admin/settlement-simple");
      return;
    }

    if (
      !isSessionPending &&
      session?.user &&
      userRole !== "super_user" &&
      userRole !== "admin"
    ) {
      router.push("/dashboard");
    }
  }, [isSessionPending, session, userRole, router]);

  // Apply filters
  const handleApplyFilters = useCallback(() => {
    const filters: SettlementSimpleFilters = {
      periodStartDate,
      periodEndDate,
      supplierId: selectedSupplier && selectedSupplier !== "all" ? selectedSupplier : undefined,
      franchiseeId: selectedFranchisee && selectedFranchisee !== "all" ? selectedFranchisee : undefined,
      brandId: selectedBrand && selectedBrand !== "all" ? selectedBrand : undefined,
    };
    setAppliedFilters(filters);
  }, [periodStartDate, periodEndDate, selectedSupplier, selectedFranchisee, selectedBrand]);

  // Reset filters
  const handleResetFilters = useCallback(() => {
    const defaultPeriod = getDefaultPeriod();
    setPeriodStartDate(defaultPeriod.start);
    setPeriodEndDate(defaultPeriod.end);
    setSelectedSupplier("");
    setSelectedFranchisee("");
    setSelectedBrand("");
    setAppliedFilters({
      periodStartDate: defaultPeriod.start,
      periodEndDate: defaultPeriod.end,
    });
  }, []);

  // Handle adjustment
  const handleOpenAdjustment = useCallback((item: SettlementLineItem) => {
    setAdjustmentItem(item);
    setIsAdjustmentDialogOpen(true);
  }, []);

  const handleSubmitAdjustment = useCallback(
    async (adjustmentData: {
      commissionId: string;
      adjustmentAmount: number;
      reason: AdjustmentType;
      notes?: string;
    }) => {
      try {
        await saveAdjustmentMutation.mutateAsync(adjustmentData);
        toast.success("התיקון נשמר בהצלחה");
        setIsAdjustmentDialogOpen(false);
        setAdjustmentItem(null);
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "שגיאה בשמירת התיקון"
        );
      }
    },
    [saveAdjustmentMutation]
  );

  // Handle export
  const handleExport = useCallback(async () => {
    try {
      await exportMutation.mutateAsync(appliedFilters);
      toast.success("הקובץ הורד בהצלחה");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "שגיאה בייצוא הקובץ"
      );
    }
  }, [appliedFilters, exportMutation]);

  // Loading state
  if (isSessionPending) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!session) {
    return null;
  }

  const report = data?.report;
  const filterOptions = data?.filterOptions;

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
            <span className="text-foreground">התחשבנות</span>
          </nav>
          <h1 className="text-3xl font-bold tracking-tight">התחשבנות</h1>
          <p className="text-muted-foreground mt-1">
            השוואת סכומים בין ספקים לזכיינים ותיקון פערים
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={() => refetch()}
            disabled={isLoading}
          >
            <RefreshCw
              className={`h-4 w-4 me-2 ${isLoading ? "animate-spin" : ""}`}
            />
            רענון
          </Button>
          <Button
            variant="outline"
            disabled={!report}
          >
            <History className="h-4 w-4 me-2" />
            היסטוריה
          </Button>
          <Button
            onClick={handleExport}
            disabled={exportMutation.isPending || !report}
            className="bg-green-600 hover:bg-green-700"
          >
            {exportMutation.isPending ? (
              <Loader2 className="h-4 w-4 me-2 animate-spin" />
            ) : (
              <FileSpreadsheet className="h-4 w-4 me-2" />
            )}
            ייצוא לאקסל
          </Button>
        </div>
      </div>

      {/* Filters Card */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">בחירת תקופה</CardTitle>
          <CardDescription>
            בחר תקופה וסנן לפי ספק, זכיין או מותג
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
            <div className="space-y-2">
              <Label htmlFor="startDate">מתאריך</Label>
              <Input
                id="startDate"
                type="date"
                value={periodStartDate}
                onChange={(e) => setPeriodStartDate(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="endDate">עד תאריך</Label>
              <Input
                id="endDate"
                type="date"
                value={periodEndDate}
                onChange={(e) => setPeriodEndDate(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="supplier">ספק</Label>
              <Select value={selectedSupplier} onValueChange={setSelectedSupplier}>
                <SelectTrigger id="supplier" dir="rtl" className="[&>span]:text-end">
                  <SelectValue placeholder="כל הספקים" />
                </SelectTrigger>
                <SelectContent dir="rtl">
                  <SelectItem value="all" className="text-end">
                    כל הספקים
                  </SelectItem>
                  {filterOptions?.suppliers.map((s) => (
                    <SelectItem key={s.id} value={s.id} className="text-end">
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="franchisee">זכיין</Label>
              <Select value={selectedFranchisee} onValueChange={setSelectedFranchisee}>
                <SelectTrigger id="franchisee" dir="rtl" className="[&>span]:text-end">
                  <SelectValue placeholder="כל הזכיינים" />
                </SelectTrigger>
                <SelectContent dir="rtl">
                  <SelectItem value="all" className="text-end">
                    כל הזכיינים
                  </SelectItem>
                  {filterOptions?.franchisees.map((f) => (
                    <SelectItem key={f.id} value={f.id} className="text-end">
                      {f.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="brand">מותג</Label>
              <Select value={selectedBrand} onValueChange={setSelectedBrand}>
                <SelectTrigger id="brand" dir="rtl" className="[&>span]:text-end">
                  <SelectValue placeholder="כל המותגים" />
                </SelectTrigger>
                <SelectContent dir="rtl">
                  <SelectItem value="all" className="text-end">
                    כל המותגים
                  </SelectItem>
                  {filterOptions?.brands.map((b) => (
                    <SelectItem key={b.id} value={b.id} className="text-end">
                      {b.nameHe || b.name}
                    </SelectItem>
                  ))}
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
          <SettlementSummaryCards summary={report.summary} />

          {/* Settlement Table */}
          <Card>
            <CardHeader>
              <CardTitle>פירוט התחשבנות</CardTitle>
              <CardDescription>
                השוואה בין סכומים מדוחות ספקים לנתוני זכיינים מ-BKMVDATA
              </CardDescription>
            </CardHeader>
            <CardContent>
              <SettlementTable
                items={report.items}
                onAdjust={handleOpenAdjustment}
              />
            </CardContent>
          </Card>
        </>
      )}

      {/* Empty State */}
      {!isLoading && !report && (
        <Card>
          <CardContent className="py-12 text-center">
            <FileSpreadsheet className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium mb-2">אין נתוני התחשבנות</h3>
            <p className="text-muted-foreground">
              בחר תקופה ולחץ &quot;החל סינון&quot; כדי לטעון את הדוח
            </p>
          </CardContent>
        </Card>
      )}

      {/* Adjustment Dialog */}
      <AdjustmentDialog
        open={isAdjustmentDialogOpen}
        onOpenChange={setIsAdjustmentDialogOpen}
        item={adjustmentItem}
        onSubmit={handleSubmitAdjustment}
        isSubmitting={saveAdjustmentMutation.isPending}
      />
    </div>
  );
}
