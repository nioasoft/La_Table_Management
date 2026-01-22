"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
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
  ArrowRight,
  Calendar,
  Building2,
  TrendingUp,
} from "lucide-react";
import Link from "next/link";
import type { SupplierCompletenessResponse, SupplierCompleteness, PeriodStatus } from "@/app/api/dashboard/supplier-completeness/route";
import { getPeriodTypeLabel } from "@/lib/settlement-periods";

// Status icons
const StatusIcon = ({ status }: { status: PeriodStatus["status"] }) => {
  switch (status) {
    case "approved":
      return <CheckCircle2 className="h-4 w-4 text-green-600" />;
    case "pending":
      return <Clock className="h-4 w-4 text-amber-500" />;
    case "missing":
      return <XCircle className="h-4 w-4 text-red-500" />;
    default:
      return null;
  }
};

// Status badge
const StatusBadge = ({ status }: { status: PeriodStatus["status"] }) => {
  switch (status) {
    case "approved":
      return (
        <Badge variant="success" className="gap-1">
          <CheckCircle2 className="h-3 w-3" />
          אושר
        </Badge>
      );
    case "pending":
      return (
        <Badge variant="warning" className="gap-1">
          <Clock className="h-3 w-3" />
          ממתין
        </Badge>
      );
    case "missing":
      return (
        <Badge variant="destructive" className="gap-1">
          <XCircle className="h-3 w-3" />
          חסר
        </Badge>
      );
    default:
      return null;
  }
};

export default function SupplierCompletenessPage() {
  const router = useRouter();
  const currentYear = new Date().getFullYear();

  // Filters
  const [year, setYear] = useState(currentYear);
  const [brandId, setBrandId] = useState<string>("all");
  const [frequency, setFrequency] = useState<string>("all");

  const { data: session, isPending: isSessionPending } = authClient.useSession();
  const userRole = session ? (session.user as { role?: string })?.role : undefined;

  // Redirect if not authenticated or authorized
  if (!isSessionPending && !session) {
    router.push("/sign-in?redirect=/admin/supplier-files/completeness");
  }
  if (!isSessionPending && session?.user && userRole !== "super_user" && userRole !== "admin") {
    router.push("/dashboard");
  }

  // Fetch completeness data
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

  // Fetch brands for filter
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

  // Get unique period names from all suppliers for table headers
  const allPeriodKeys = new Set<string>();
  suppliers.forEach(s => s.periods.forEach(p => allPeriodKeys.add(p.key)));
  const periodKeys = Array.from(allPeriodKeys).sort();

  // Build period info map for display
  const periodInfoMap = new Map<string, { nameHe: string }>();
  suppliers.forEach(s => {
    s.periods.forEach(p => {
      if (!periodInfoMap.has(p.key)) {
        periodInfoMap.set(p.key, { nameHe: p.nameHe });
      }
    });
  });

  // Generate years for dropdown
  const years = [currentYear, currentYear - 1, currentYear - 2];

  if (isSessionPending || isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="container mx-auto py-6 space-y-6" dir="rtl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">מצב דוחות ספקים</h1>
          <p className="text-muted-foreground mt-1">
            מעקב אחר דוחות שהתקבלו וחסרים לפי תקופה
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/admin/supplier-files">
            <Button variant="outline">
              <FileText className="h-4 w-4 me-2" />
              העלאת קבצים
            </Button>
          </Link>
          <Button variant="outline" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 me-2" />
            רענון
          </Button>
        </div>
      </div>

      {/* Summary Cards */}
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center gap-2">
                <Building2 className="h-5 w-5 text-muted-foreground" />
                <div>
                  <p className="text-2xl font-bold">{summary.totalSuppliers}</p>
                  <p className="text-xs text-muted-foreground">ספקים</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center gap-2">
                <Calendar className="h-5 w-5 text-muted-foreground" />
                <div>
                  <p className="text-2xl font-bold">{summary.totalExpectedFiles}</p>
                  <p className="text-xs text-muted-foreground">קבצים צפויים</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-green-600" />
                <div>
                  <p className="text-2xl font-bold text-green-600">{summary.approved}</p>
                  <p className="text-xs text-muted-foreground">אושרו</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center gap-2">
                <Clock className="h-5 w-5 text-amber-500" />
                <div>
                  <p className="text-2xl font-bold text-amber-600">{summary.pending}</p>
                  <p className="text-xs text-muted-foreground">ממתינים</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center gap-2">
                <XCircle className="h-5 w-5 text-red-500" />
                <div>
                  <p className="text-2xl font-bold text-red-600">{summary.missing}</p>
                  <p className="text-xs text-muted-foreground">חסרים</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center gap-2">
                <TrendingUp className="h-5 w-5 text-blue-500" />
                <div>
                  <p className="text-2xl font-bold text-blue-600">{summary.completionPercentage}%</p>
                  <p className="text-xs text-muted-foreground">השלמה</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Filters */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">סינון</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-4">
            <div className="w-40">
              <label className="text-sm font-medium mb-1.5 block">שנה</label>
              <Select value={year.toString()} onValueChange={(v) => setYear(parseInt(v))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {years.map((y) => (
                    <SelectItem key={y} value={y.toString()}>
                      {y}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="w-48">
              <label className="text-sm font-medium mb-1.5 block">מותג</label>
              <Select value={brandId} onValueChange={setBrandId}>
                <SelectTrigger>
                  <SelectValue placeholder="כל המותגים" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">כל המותגים</SelectItem>
                  {brands.map((b: { id: string; nameHe: string }) => (
                    <SelectItem key={b.id} value={b.id}>
                      {b.nameHe}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="w-48">
              <label className="text-sm font-medium mb-1.5 block">תדירות דיווח</label>
              <Select value={frequency} onValueChange={setFrequency}>
                <SelectTrigger>
                  <SelectValue placeholder="כל התדירויות" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">כל התדירויות</SelectItem>
                  <SelectItem value="monthly">חודשי</SelectItem>
                  <SelectItem value="quarterly">רבעוני</SelectItem>
                  <SelectItem value="semi_annual">חצי שנתי</SelectItem>
                  <SelectItem value="annual">שנתי</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Completeness Table */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">מצב דוחות לפי ספק</CardTitle>
          <CardDescription>
            {suppliers.length} ספקים | {periodKeys.length} תקופות
          </CardDescription>
        </CardHeader>
        <CardContent>
          {suppliers.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              לא נמצאו ספקים עם הגדרות קובץ
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="sticky right-0 bg-background z-10 min-w-[200px]">
                      ספק
                    </TableHead>
                    <TableHead className="w-24">תדירות</TableHead>
                    <TableHead className="w-24 text-center">סה&quot;כ</TableHead>
                    {periodKeys.map((key) => (
                      <TableHead key={key} className="text-center min-w-[100px]">
                        {periodInfoMap.get(key)?.nameHe || key}
                      </TableHead>
                    ))}
                    <TableHead className="w-16"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {suppliers.map((supplier) => (
                    <SupplierRow
                      key={supplier.supplier.id}
                      supplier={supplier}
                      periodKeys={periodKeys}
                    />
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// Supplier row component
function SupplierRow({
  supplier,
  periodKeys,
}: {
  supplier: SupplierCompleteness;
  periodKeys: string[];
}) {
  // Create a map of period key to status for quick lookup
  const periodStatusMap = new Map(
    supplier.periods.map((p) => [p.key, p])
  );

  // Calculate completion percentage
  const completionPct = supplier.stats.total > 0
    ? Math.round(((supplier.stats.approved + supplier.stats.pending) / supplier.stats.total) * 100)
    : 0;

  return (
    <TableRow>
      <TableCell className="sticky right-0 bg-background z-10">
        <div className="flex flex-col">
          <span className="font-medium">{supplier.supplier.name}</span>
          <span className="text-xs text-muted-foreground">{supplier.supplier.code}</span>
          {supplier.brands.length > 0 && (
            <div className="flex gap-1 mt-1">
              {supplier.brands.map((b) => (
                <Badge key={b.id} variant="outline" className="text-xs">
                  {b.nameHe}
                </Badge>
              ))}
            </div>
          )}
        </div>
      </TableCell>
      <TableCell>
        <Badge variant="secondary" className="text-xs">
          {getPeriodTypeLabel(supplier.frequency as "monthly" | "quarterly" | "semi_annual" | "annual")}
        </Badge>
      </TableCell>
      <TableCell className="text-center">
        <div className="flex flex-col items-center gap-1">
          <span className="font-medium">{completionPct}%</span>
          <div className="flex gap-1 text-xs">
            <span className="text-green-600">{supplier.stats.approved}</span>
            <span>/</span>
            <span className="text-amber-600">{supplier.stats.pending}</span>
            <span>/</span>
            <span className="text-red-600">{supplier.stats.missing}</span>
          </div>
        </div>
      </TableCell>
      {periodKeys.map((key) => {
        const period = periodStatusMap.get(key);
        // If this supplier doesn't have this period (different frequency), show empty
        if (!period) {
          return (
            <TableCell key={key} className="text-center">
              <span className="text-muted-foreground">-</span>
            </TableCell>
          );
        }

        return (
          <TableCell key={key} className="text-center">
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="flex justify-center cursor-pointer">
                    {period.fileId ? (
                      <Link href={`/admin/supplier-files/review/${period.fileId}`}>
                        <StatusIcon status={period.status} />
                      </Link>
                    ) : (
                      <StatusIcon status={period.status} />
                    )}
                  </div>
                </TooltipTrigger>
                <TooltipContent>
                  <div className="text-sm">
                    <p className="font-medium">{period.nameHe}</p>
                    <p>{period.startDate} - {period.endDate}</p>
                    <div className="mt-1">
                      <StatusBadge status={period.status} />
                    </div>
                    {period.fileName && (
                      <p className="text-xs text-muted-foreground mt-1">
                        {period.fileName}
                      </p>
                    )}
                  </div>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </TableCell>
        );
      })}
      <TableCell>
        <Link href={`/admin/supplier-files?supplierId=${supplier.supplier.id}`}>
          <Button variant="ghost" size="sm" className="h-7 w-7 p-0">
            <ArrowRight className="h-4 w-4" />
          </Button>
        </Link>
      </TableCell>
    </TableRow>
  );
}
