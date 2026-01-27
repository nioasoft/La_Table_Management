"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Loader2,
  CheckCircle2,
  XCircle,
  Clock,
  FileText,
  RefreshCw,
  ArrowLeft,
} from "lucide-react";
import Link from "next/link";
import type { SupplierCompletenessResponse, SupplierCompleteness, PeriodStatus } from "@/app/api/dashboard/supplier-completeness/route";
import { getPeriodTypeLabel } from "@/lib/settlement-periods";

// Compact status icon
const StatusIcon = ({ status }: { status: PeriodStatus["status"] }) => {
  switch (status) {
    case "approved":
      return <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />;
    case "pending":
      return <Clock className="h-3.5 w-3.5 text-amber-500" />;
    case "missing":
      return <XCircle className="h-3.5 w-3.5 text-red-500" />;
    default:
      return null;
  }
};

export default function SupplierCompletenessPage() {
  const router = useRouter();
  const now = new Date();
  const currentYear = now.getFullYear();
  const defaultYear = now.getMonth() < 3 ? currentYear - 1 : currentYear;

  const [year, setYear] = useState(defaultYear);
  const [brandId, setBrandId] = useState<string>("all");
  const [frequency, setFrequency] = useState<string>("quarterly"); // Default to quarterly (most common)

  const { data: session, isPending: isSessionPending } = authClient.useSession();
  const userRole = session ? (session.user as { role?: string })?.role : undefined;

  if (!isSessionPending && !session) {
    router.push("/sign-in?redirect=/admin/supplier-files/completeness");
  }
  if (!isSessionPending && session?.user && userRole !== "super_user" && userRole !== "admin") {
    router.push("/dashboard");
  }

  const {
    data: completenessData,
    isLoading,
    refetch,
  } = useQuery<SupplierCompletenessResponse>({
    queryKey: ["supplier-completeness", year, brandId, frequency],
    queryFn: async () => {
      const params = new URLSearchParams({ year: year.toString() });
      if (brandId && brandId !== "all") params.append("brandId", brandId);
      if (frequency && frequency !== "all") params.append("frequency", frequency);
      const response = await fetch(`/api/dashboard/supplier-completeness?${params}`);
      if (!response.ok) throw new Error("Failed to fetch completeness data");
      return response.json();
    },
    enabled: !isSessionPending && !!session,
  });

  const { data: brandsData } = useQuery({
    queryKey: ["brands"],
    queryFn: async () => {
      const response = await fetch("/api/brands");
      if (!response.ok) throw new Error("Failed to fetch brands");
      return response.json();
    },
    enabled: !isSessionPending && !!session,
  });

  const brands = brandsData?.brands || [];
  const suppliers = completenessData?.suppliers || [];
  const summary = completenessData?.summary;

  // Build period info map for display
  const periodInfoMap = new Map<string, { nameHe: string; type: string }>();
  suppliers.forEach(s => {
    s.periods.forEach(p => {
      if (!periodInfoMap.has(p.key)) {
        periodInfoMap.set(p.key, { nameHe: p.nameHe, type: s.frequency });
      }
    });
  });

  // When a specific frequency is selected, only show periods for that frequency
  // When "all" is selected, only show quarterly periods (most common)
  const getRelevantPeriodKeys = () => {
    if (frequency !== "all") {
      // Show only periods for the selected frequency
      const keys = new Set<string>();
      suppliers.forEach(s => {
        if (s.frequency === frequency) {
          s.periods.forEach(p => keys.add(p.key));
        }
      });
      return Array.from(keys).sort();
    }

    // When showing all, default to quarterly view (most suppliers are quarterly)
    const quarterlyKeys = new Set<string>();
    suppliers.forEach(s => {
      if (s.frequency === "quarterly") {
        s.periods.forEach(p => quarterlyKeys.add(p.key));
      }
    });
    return Array.from(quarterlyKeys).sort();
  };

  const periodKeys = getRelevantPeriodKeys();

  // Filter suppliers to show based on frequency selection
  const displayedSuppliers = frequency === "all"
    ? suppliers // Show all but with quarterly columns
    : suppliers.filter(s => s.frequency === frequency);

  const years = [currentYear, currentYear - 1, currentYear - 2];

  if (isSessionPending || isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="container mx-auto py-4 space-y-4 max-w-7xl" dir="rtl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">שלמות דוחות ספקים</h1>
          <p className="text-sm text-muted-foreground">
            מעקב אחר קבצים שהתקבלו לפי ספק ותקופה
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/admin/supplier-files">
            <Button variant="outline" size="sm">
              <FileText className="h-4 w-4 me-1" />
              העלאת קבצים
            </Button>
          </Link>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Summary + Filters Row */}
      <div className="flex flex-wrap items-center gap-4 p-3 bg-muted/50 rounded-lg">
        {/* Filters */}
        <Select value={year.toString()} onValueChange={(v) => setYear(parseInt(v))}>
          <SelectTrigger className="w-24 h-8">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {years.map((y) => (
              <SelectItem key={y} value={y.toString()}>{y}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={brandId} onValueChange={setBrandId}>
          <SelectTrigger className="w-32 h-8">
            <SelectValue placeholder="מותג" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">כל המותגים</SelectItem>
            {brands.map((b: { id: string; nameHe: string }) => (
              <SelectItem key={b.id} value={b.id}>{b.nameHe}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={frequency} onValueChange={setFrequency}>
          <SelectTrigger className="w-28 h-8">
            <SelectValue placeholder="תדירות" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">הכל</SelectItem>
            <SelectItem value="monthly">חודשי</SelectItem>
            <SelectItem value="quarterly">רבעוני</SelectItem>
            <SelectItem value="semi_annual">חצי שנתי</SelectItem>
            <SelectItem value="annual">שנתי</SelectItem>
          </SelectContent>
        </Select>

        <div className="h-6 w-px bg-border mx-2" />

        {/* Summary Stats - calculated from displayed suppliers */}
        {displayedSuppliers.length > 0 && (
          <div className="flex items-center gap-4 text-sm">
            <span className="text-muted-foreground">
              {displayedSuppliers.length} ספקים
            </span>
            {(() => {
              const stats = displayedSuppliers.reduce(
                (acc, s) => ({
                  approved: acc.approved + s.stats.approved,
                  pending: acc.pending + s.stats.pending,
                  missing: acc.missing + s.stats.missing,
                  total: acc.total + s.stats.total,
                }),
                { approved: 0, pending: 0, missing: 0, total: 0 }
              );
              const completionPct = stats.total > 0
                ? Math.round(((stats.approved + stats.pending) / stats.total) * 100)
                : 0;
              return (
                <>
                  <span className="flex items-center gap-1">
                    <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />
                    <span className="text-green-600 font-medium">{stats.approved}</span>
                  </span>
                  <span className="flex items-center gap-1">
                    <Clock className="h-3.5 w-3.5 text-amber-500" />
                    <span className="text-amber-600 font-medium">{stats.pending}</span>
                  </span>
                  <span className="flex items-center gap-1">
                    <XCircle className="h-3.5 w-3.5 text-red-500" />
                    <span className="text-red-600 font-medium">{stats.missing}</span>
                  </span>
                  <Badge variant={completionPct >= 80 ? "success" : completionPct >= 50 ? "warning" : "destructive"}>
                    {completionPct}% השלמה
                  </Badge>
                </>
              );
            })()}
          </div>
        )}
      </div>

      {/* Table */}
      <Card>
        <CardHeader className="py-3 px-4">
          <CardTitle className="text-base flex items-center justify-between">
            <span>מצב דוחות לפי ספק</span>
            <span className="text-sm font-normal text-muted-foreground">
              {periodKeys.length} תקופות
              {frequency === "all" && " (תצוגה רבעונית)"}
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {displayedSuppliers.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              לא נמצאו ספקים {frequency !== "all" && `בתדירות ${frequency === "quarterly" ? "רבעונית" : frequency === "monthly" ? "חודשית" : frequency === "semi_annual" ? "חצי שנתית" : "שנתית"}`}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table className="text-sm">
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="sticky right-0 bg-background z-10 w-48 py-2">
                      ספק
                    </TableHead>
                    {frequency === "all" && (
                      <TableHead className="w-16 py-2 text-center">תדירות</TableHead>
                    )}
                    {periodKeys.map((key) => {
                      const nameHe = periodInfoMap.get(key)?.nameHe || key;
                      // Shorten period names based on type
                      const shortName = nameHe
                        .replace(/רבעון (\d).*/, "Q$1")
                        .replace(/מחצית ראשונה.*/, "H1")
                        .replace(/מחצית שנייה.*/, "H2")
                        .replace(/שנת.*/, "שנתי")
                        .replace(/(\S+) \d{4}/, "$1"); // Remove year from monthly
                      return (
                        <TableHead key={key} className="text-center w-14 py-2 px-1">
                          <span className="text-xs">{shortName}</span>
                        </TableHead>
                      );
                    })}
                    <TableHead className="w-10 py-2"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {displayedSuppliers.map((supplier) => (
                    <SupplierRow
                      key={supplier.supplier.id}
                      supplier={supplier}
                      periodKeys={periodKeys}
                      periodInfoMap={periodInfoMap}
                      showFrequency={frequency === "all"}
                    />
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Legend */}
      <div className="flex items-center gap-4 text-xs text-muted-foreground justify-center">
        <span className="flex items-center gap-1">
          <CheckCircle2 className="h-3 w-3 text-green-600" /> אושר
        </span>
        <span className="flex items-center gap-1">
          <Clock className="h-3 w-3 text-amber-500" /> ממתין לבדיקה
        </span>
        <span className="flex items-center gap-1">
          <XCircle className="h-3 w-3 text-red-500" /> חסר
        </span>
        <span className="flex items-center gap-1">
          <span className="text-muted-foreground">-</span> לא רלוונטי
        </span>
      </div>
    </div>
  );
}

function SupplierRow({
  supplier,
  periodKeys,
  periodInfoMap,
  showFrequency,
}: {
  supplier: SupplierCompleteness;
  periodKeys: string[];
  periodInfoMap: Map<string, { nameHe: string; type: string }>;
  showFrequency: boolean;
}) {
  const periodStatusMap = new Map(
    supplier.periods.map((p) => [p.key, p])
  );

  const frequencyShort: Record<string, string> = {
    monthly: "חודשי",
    quarterly: "רבעוני",
    semi_annual: "חצי",
    annual: "שנתי",
  };

  return (
    <TableRow className="hover:bg-muted/50">
      <TableCell className="sticky right-0 bg-background z-10 py-1.5">
        <div className="flex items-center gap-2">
          <span className="font-medium truncate max-w-[160px]" title={supplier.supplier.name}>
            {supplier.supplier.name}
          </span>
          {supplier.brands.length > 0 && (
            <span className="text-xs text-muted-foreground">
              ({supplier.brands.map(b => b.nameHe.charAt(0)).join("")})
            </span>
          )}
        </div>
      </TableCell>
      {showFrequency && (
        <TableCell className="text-center py-1.5">
          <span className="text-xs text-muted-foreground">
            {frequencyShort[supplier.frequency] || supplier.frequency}
          </span>
        </TableCell>
      )}
      {periodKeys.map((key) => {
        const period = periodStatusMap.get(key);
        if (!period) {
          return (
            <TableCell key={key} className="text-center py-1.5 px-1">
              <span className="text-muted-foreground/50">-</span>
            </TableCell>
          );
        }

        return (
          <TableCell key={key} className="text-center py-1.5 px-1">
            <TooltipProvider delayDuration={200}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="flex justify-center">
                    {period.fileId ? (
                      <Link href={`/admin/supplier-files/review/${period.fileId}`}>
                        <StatusIcon status={period.status} />
                      </Link>
                    ) : (
                      <StatusIcon status={period.status} />
                    )}
                  </div>
                </TooltipTrigger>
                <TooltipContent side="top" className="text-xs">
                  <p className="font-medium">{periodInfoMap.get(key)?.nameHe}</p>
                  <p className="text-muted-foreground">{period.startDate} - {period.endDate}</p>
                  {period.fileName && (
                    <p className="text-muted-foreground truncate max-w-[200px]">{period.fileName}</p>
                  )}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </TableCell>
        );
      })}
      <TableCell className="py-1.5">
        <Link href={`/admin/supplier-files?supplierId=${supplier.supplier.id}`}>
          <Button variant="ghost" size="sm" className="h-6 w-6 p-0">
            <ArrowLeft className="h-3 w-3" />
          </Button>
        </Link>
      </TableCell>
    </TableRow>
  );
}
