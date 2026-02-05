"use client";

import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useBkmvYears, useBkmvYearData } from "@/queries/bkmv-year";
import { formatAmount } from "@/lib/bkmvdata-parser";
import type { MonthlyBreakdown, MonthlyBreakdownEntry } from "@/lib/bkmvdata-parser";
import type { Franchisee } from "@/db/schema";
import { Badge } from "@/components/ui/badge";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Search,
  Loader2,
  CalendarDays,
  BarChart3,
  Lock,
  Unlock,
  FileSpreadsheet,
} from "lucide-react";

interface FranchiseeWithBrand extends Franchisee {
  brand: {
    id: string;
    code: string;
    nameHe: string;
    nameEn: string | null;
  } | null;
}

const HEBREW_MONTHS: Record<number, string> = {
  1: "ינו",
  2: "פבר",
  3: "מרץ",
  4: "אפר",
  5: "מאי",
  6: "יונ",
  7: "יול",
  8: "אוג",
  9: "ספט",
  10: "אוק",
  11: "נוב",
  12: "דצמ",
};

const FULL_HEBREW_MONTHS: Record<number, string> = {
  1: "ינואר",
  2: "פברואר",
  3: "מרץ",
  4: "אפריל",
  5: "מאי",
  6: "יוני",
  7: "יולי",
  8: "אוגוסט",
  9: "ספטמבר",
  10: "אוקטובר",
  11: "נובמבר",
  12: "דצמבר",
};

interface SupplierRow {
  supplierName: string;
  monthAmounts: Record<number, number>;
  monthCounts: Record<number, number>;
  totalAmount: number;
  totalCount: number;
}

function buildPivotData(
  breakdown: MonthlyBreakdown,
  year: number,
  searchQuery: string,
  monthFilter: { start: number; end: number } | null
): { rows: SupplierRow[]; monthsInRange: number[]; grandTotal: number; grandCount: number } {
  const supplierMap = new Map<string, SupplierRow>();

  for (const [monthKey, entries] of Object.entries(breakdown)) {
    const [y, m] = monthKey.split("-").map(Number);
    if (y !== year) continue;

    if (monthFilter && (m < monthFilter.start || m > monthFilter.end)) continue;

    for (const entry of entries) {
      const existing = supplierMap.get(entry.supplierName);
      if (existing) {
        existing.monthAmounts[m] = (existing.monthAmounts[m] || 0) + entry.amount;
        existing.monthCounts[m] = (existing.monthCounts[m] || 0) + entry.transactionCount;
        existing.totalAmount += entry.amount;
        existing.totalCount += entry.transactionCount;
      } else {
        supplierMap.set(entry.supplierName, {
          supplierName: entry.supplierName,
          monthAmounts: { [m]: entry.amount },
          monthCounts: { [m]: entry.transactionCount },
          totalAmount: entry.amount,
          totalCount: entry.transactionCount,
        });
      }
    }
  }

  let rows = Array.from(supplierMap.values());

  // Apply search filter
  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    rows = rows.filter((r) => r.supplierName.toLowerCase().includes(q));
  }

  // Sort by total amount descending
  rows.sort((a, b) => b.totalAmount - a.totalAmount);

  // Determine months in range
  const monthsInRange: number[] = [];
  for (let m = monthFilter?.start ?? 1; m <= (monthFilter?.end ?? 12); m++) {
    monthsInRange.push(m);
  }

  const grandTotal = rows.reduce((s, r) => s + r.totalAmount, 0);
  const grandCount = rows.reduce((s, r) => s + r.totalCount, 0);

  return { rows, monthsInRange, grandTotal, grandCount };
}

function formatCompactAmount(amount: number): string {
  if (amount >= 1_000_000) {
    return `${(amount / 1_000_000).toFixed(1)}M`;
  }
  if (amount >= 1_000) {
    return `${(amount / 1_000).toFixed(0)}K`;
  }
  return amount.toFixed(0);
}

export function BkmvDataExplorer() {
  const [selectedFranchiseeId, setSelectedFranchiseeId] = useState<string | null>(null);
  const [selectedYear, setSelectedYear] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [monthStart, setMonthStart] = useState<number>(1);
  const [monthEnd, setMonthEnd] = useState<number>(12);

  // Fetch franchisees
  const { data: franchiseesData, isLoading: isLoadingFranchisees } = useQuery({
    queryKey: ["franchisees", "list"],
    queryFn: async () => {
      const res = await fetch("/api/franchisees");
      if (!res.ok) throw new Error("Failed to fetch franchisees");
      return res.json();
    },
  });

  const franchisees: FranchiseeWithBrand[] = useMemo(
    () =>
      (franchiseesData?.franchisees || [])
        .slice()
        .sort((a: FranchiseeWithBrand, b: FranchiseeWithBrand) => a.name.localeCompare(b.name, "he")),
    [franchiseesData]
  );

  // Fetch years for selected franchisee
  const { data: yearsData, isLoading: isLoadingYears } = useBkmvYears(selectedFranchiseeId);

  // Auto-select latest year when years load
  const availableYears = useMemo(() => {
    if (!yearsData) return [];
    return yearsData.sort((a, b) => b.year - a.year);
  }, [yearsData]);

  // Fetch year data
  const { data: yearData, isLoading: isLoadingYearData } = useBkmvYearData(
    selectedFranchiseeId,
    selectedYear
  );

  // Build pivot table data
  const pivotData = useMemo(() => {
    if (!yearData || !selectedYear) return null;
    const breakdown = yearData.monthlyBreakdown as MonthlyBreakdown;
    const monthFilter = monthStart !== 1 || monthEnd !== 12
      ? { start: monthStart, end: monthEnd }
      : null;
    return buildPivotData(breakdown, selectedYear, searchQuery, monthFilter);
  }, [yearData, selectedYear, searchQuery, monthStart, monthEnd]);

  // Column totals
  const columnTotals = useMemo(() => {
    if (!pivotData) return {};
    const totals: Record<number, number> = {};
    for (const m of pivotData.monthsInRange) {
      totals[m] = pivotData.rows.reduce((s, r) => s + (r.monthAmounts[m] || 0), 0);
    }
    return totals;
  }, [pivotData]);

  // Current year info
  const currentYearInfo = useMemo(
    () => availableYears.find((y) => y.year === selectedYear),
    [availableYears, selectedYear]
  );

  return (
    <div className="space-y-6">
      {/* Selectors */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center gap-2">
            <BarChart3 className="h-5 w-5" />
            סייר נתוני BKMV
          </CardTitle>
          <CardDescription>
            בחר זכיין ושנה כדי לצפות בנתונים חודשיים לפי ספק
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-end gap-4">
            {/* Franchisee selector */}
            <div className="space-y-2">
              <Label>זכיין</Label>
              <Select
                value={selectedFranchiseeId ?? ""}
                onValueChange={(v) => {
                  setSelectedFranchiseeId(v);
                  setSelectedYear(null);
                }}
              >
                <SelectTrigger className="w-[220px]">
                  <SelectValue placeholder="בחר זכיין..." />
                </SelectTrigger>
                <SelectContent className="max-h-[300px]">
                  {franchisees.map((f) => (
                    <SelectItem key={f.id} value={f.id}>
                      {f.name} ({f.code})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Year selector */}
            <div className="space-y-2">
              <Label>שנה</Label>
              <Select
                value={selectedYear?.toString() ?? ""}
                onValueChange={(v) => {
                  setSelectedYear(parseInt(v, 10));
                  setMonthStart(1);
                  setMonthEnd(12);
                }}
                disabled={!selectedFranchiseeId || isLoadingYears}
              >
                <SelectTrigger className="w-[140px]">
                  <SelectValue
                    placeholder={isLoadingYears ? "טוען..." : "בחר שנה..."}
                  />
                </SelectTrigger>
                <SelectContent>
                  {availableYears.map((y) => (
                    <SelectItem key={y.year} value={y.year.toString()}>
                      {y.year} ({y.monthCount}/12)
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Supplier search */}
            <div className="space-y-2">
              <Label>חיפוש ספק</Label>
              <div className="relative">
                <Search className="absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="שם ספק..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="ps-9 w-[200px]"
                />
              </div>
            </div>

            {/* Month range filter */}
            {selectedYear && (
              <>
                <div className="w-px h-8 bg-border mx-1" />
                <div className="space-y-2">
                  <Label>מחודש</Label>
                  <Select
                    value={monthStart.toString()}
                    onValueChange={(v) => setMonthStart(parseInt(v, 10))}
                  >
                    <SelectTrigger className="w-[100px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                        <SelectItem key={m} value={m.toString()}>
                          {FULL_HEBREW_MONTHS[m]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>עד חודש</Label>
                  <Select
                    value={monthEnd.toString()}
                    onValueChange={(v) => setMonthEnd(parseInt(v, 10))}
                  >
                    <SelectTrigger className="w-[100px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                        <SelectItem key={m} value={m.toString()}>
                          {FULL_HEBREW_MONTHS[m]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Status bar */}
      {currentYearInfo && (
        <div className="flex items-center gap-4 px-1">
          <Badge
            variant={currentYearInfo.isComplete ? "success" : "secondary"}
            className="gap-1"
          >
            {currentYearInfo.isComplete ? (
              <Lock className="h-3 w-3" />
            ) : (
              <Unlock className="h-3 w-3" />
            )}
            {currentYearInfo.isComplete
              ? `שנה מלאה (${currentYearInfo.monthCount}/12)`
              : `${currentYearInfo.monthCount}/12 חודשים`}
          </Badge>
          {currentYearInfo.monthsCovered && (
            <div className="flex items-center gap-1 text-sm text-muted-foreground">
              <CalendarDays className="h-4 w-4" />
              <span>
                {(currentYearInfo.monthsCovered as number[])
                  .map((m) => HEBREW_MONTHS[m])
                  .join(", ")}
              </span>
            </div>
          )}
        </div>
      )}

      {/* Loading state */}
      {isLoadingYearData && selectedYear && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      )}

      {/* Empty states */}
      {!selectedFranchiseeId && (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-12 text-muted-foreground">
            <FileSpreadsheet className="h-12 w-12 mb-4 opacity-50" />
            <p>בחר זכיין כדי להתחיל</p>
          </CardContent>
        </Card>
      )}

      {selectedFranchiseeId && !isLoadingYears && availableYears.length === 0 && (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-12 text-muted-foreground">
            <FileSpreadsheet className="h-12 w-12 mb-4 opacity-50" />
            <p>לא נמצאו נתוני BKMV לזכיין זה</p>
          </CardContent>
        </Card>
      )}

      {/* Pivot table */}
      {pivotData && !isLoadingYearData && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg">
                {pivotData.rows.length} ספקים
              </CardTitle>
              <div className="flex items-center gap-4 text-sm text-muted-foreground">
                <span>סה״כ: {formatAmount(pivotData.grandTotal)}</span>
                <span>{pivotData.grandCount} עסקאות</span>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {pivotData.rows.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                {searchQuery ? "לא נמצאו ספקים מתאימים לחיפוש" : "אין נתונים לתקופה זו"}
              </div>
            ) : (
              <div className="rounded-md border overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-right sticky start-0 bg-background z-10 min-w-[160px]">
                        ספק
                      </TableHead>
                      {pivotData.monthsInRange.map((m) => (
                        <TableHead
                          key={m}
                          className="text-center min-w-[75px]"
                        >
                          {HEBREW_MONTHS[m]}
                        </TableHead>
                      ))}
                      <TableHead className="text-center min-w-[90px] font-bold">
                        סה״כ
                      </TableHead>
                      <TableHead className="text-center min-w-[50px]">
                        #
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pivotData.rows.map((row) => (
                      <TableRow key={row.supplierName}>
                        <TableCell className="font-medium sticky start-0 bg-background z-10">
                          {row.supplierName}
                        </TableCell>
                        {pivotData.monthsInRange.map((m) => (
                          <TableCell
                            key={m}
                            className="text-center font-mono text-sm"
                          >
                            {row.monthAmounts[m]
                              ? formatCompactAmount(row.monthAmounts[m])
                              : (
                                <span className="text-muted-foreground/30">
                                  -
                                </span>
                              )}
                          </TableCell>
                        ))}
                        <TableCell className="text-center font-mono font-bold">
                          {formatCompactAmount(row.totalAmount)}
                        </TableCell>
                        <TableCell className="text-center text-muted-foreground">
                          {row.totalCount}
                        </TableCell>
                      </TableRow>
                    ))}
                    {/* Column totals row */}
                    <TableRow className="bg-muted/50 font-bold border-t-2">
                      <TableCell className="sticky start-0 bg-muted/50 z-10">
                        סה״כ
                      </TableCell>
                      {pivotData.monthsInRange.map((m) => (
                        <TableCell
                          key={m}
                          className="text-center font-mono"
                        >
                          {columnTotals[m]
                            ? formatCompactAmount(columnTotals[m])
                            : "-"}
                        </TableCell>
                      ))}
                      <TableCell className="text-center font-mono">
                        {formatCompactAmount(pivotData.grandTotal)}
                      </TableCell>
                      <TableCell className="text-center">
                        {pivotData.grandCount}
                      </TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
