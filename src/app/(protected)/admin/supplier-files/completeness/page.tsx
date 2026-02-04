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
import { Input } from "@/components/ui/input";
import {
  Loader2,
  CheckCircle2,
  XCircle,
  Clock,
  FileText,
  RefreshCw,
  ArrowLeft,
  Search,
} from "lucide-react";
import Link from "next/link";
import type { SupplierCompletenessResponse, SupplierCompleteness, PeriodStatus, SupplierWithoutParser } from "@/app/api/dashboard/supplier-completeness/route";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, Settings } from "lucide-react";

// Compact status icons in different sizes
const StatusIcon = ({ status, size = "normal" }: { status: PeriodStatus["status"]; size?: "small" | "normal" }) => {
  const sizeClass = size === "small" ? "h-2.5 w-2.5" : "h-3.5 w-3.5";
  switch (status) {
    case "approved":
      return <CheckCircle2 className={`${sizeClass} text-green-600`} />;
    case "pending":
      return <Clock className={`${sizeClass} text-amber-500`} />;
    case "missing":
      return <XCircle className={`${sizeClass} text-red-500`} />;
    default:
      return null;
  }
};

// Define the 4 quarters for the year
const QUARTERS = ["Q1", "Q2", "Q3", "Q4"];

// Map months to quarters
const monthToQuarter: Record<string, string> = {
  "01": "Q1", "02": "Q1", "03": "Q1",
  "04": "Q2", "05": "Q2", "06": "Q2",
  "07": "Q3", "08": "Q3", "09": "Q3",
  "10": "Q4", "11": "Q4", "12": "Q4",
};

// Map H1/H2 to quarters
const halfToQuarters: Record<string, string[]> = {
  "H1": ["Q1", "Q2"],
  "H2": ["Q3", "Q4"],
};

export default function SupplierCompletenessPage() {
  const router = useRouter();
  const now = new Date();
  const currentYear = now.getFullYear();
  const defaultYear = now.getMonth() < 3 ? currentYear - 1 : currentYear;

  const [year, setYear] = useState(defaultYear);
  const [brandId, setBrandId] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");

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
    queryKey: ["supplier-completeness", year, brandId],
    queryFn: async () => {
      const params = new URLSearchParams({ year: year.toString() });
      if (brandId && brandId !== "all") params.append("brandId", brandId);
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
  const allSuppliers = completenessData?.suppliers || [];
  const allSuppliersWithoutParser = completenessData?.suppliersWithoutParser || [];

  // Filter suppliers by search query
  const suppliers = searchQuery.trim()
    ? allSuppliers.filter((s) =>
        s.supplier.name.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : allSuppliers;

  // Filter suppliers without parser by search query
  const suppliersWithoutParser = searchQuery.trim()
    ? allSuppliersWithoutParser.filter((s) =>
        s.name.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : allSuppliersWithoutParser;

  const years = [currentYear, currentYear - 1, currentYear - 2];

  if (isSessionPending || isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="container mx-auto py-4 space-y-4 max-w-5xl" dir="rtl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">שלמות דוחות ספקים</h1>
          <p className="text-sm text-muted-foreground">
            מעקב קבצים לפי ספק ורבעון - {year}
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

      {/* Filters Row */}
      <div className="flex flex-wrap items-center gap-4 p-3 bg-muted/50 rounded-lg">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            type="text"
            placeholder="חיפוש ספק..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-48 h-8 ps-8 pe-3"
          />
        </div>

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

        <span className="text-sm text-muted-foreground">
          {suppliers.length} ספקים
          {suppliersWithoutParser.length > 0 && (
            <span className="text-amber-600 ms-2">
              + {suppliersWithoutParser.length} ללא פרסר
            </span>
          )}
        </span>
      </div>

      {/* Table */}
      <Card>
        <CardHeader className="py-3 px-4">
          <CardTitle className="text-base">מצב דוחות לפי ספק ורבעון</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {suppliers.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              לא נמצאו ספקים עם הגדרות קובץ
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table className="text-sm">
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="sticky right-0 bg-background z-10 w-48 py-2">
                      ספק
                    </TableHead>
                    <TableHead className="w-16 py-2 text-center text-xs">תדירות</TableHead>
                    {QUARTERS.map((q) => (
                      <TableHead key={q} className="text-center w-20 py-2">
                        <span className="text-xs font-medium">{q}</span>
                      </TableHead>
                    ))}
                    <TableHead className="w-8 py-2"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {suppliers.map((supplier) => (
                    <SupplierRow
                      key={supplier.supplier.id}
                      supplier={supplier}
                      year={year}
                    />
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Suppliers without parser */}
      {suppliersWithoutParser.length > 0 && (
        <Card className="border-amber-200 bg-amber-50/50">
          <CardHeader className="py-3 px-4">
            <CardTitle className="text-base flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-600" />
              <span>ספקים ללא פרסר מוגדר</span>
              <Badge variant="outline" className="text-amber-600 border-amber-300">
                {suppliersWithoutParser.length}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table className="text-sm">
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="py-2 w-48">ספק</TableHead>
                    <TableHead className="py-2">מותגים</TableHead>
                    <TableHead className="py-2 w-64">סטטוס</TableHead>
                    <TableHead className="py-2 w-24"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {suppliersWithoutParser.map((supplier) => (
                    <TableRow key={supplier.id} className="hover:bg-amber-100/50">
                      <TableCell className="py-1.5 font-medium">
                        {supplier.name}
                      </TableCell>
                      <TableCell className="py-1.5">
                        <div className="flex flex-wrap gap-1">
                          {supplier.brands.map((brand) => (
                            <Badge key={brand.id} variant="secondary" className="text-xs">
                              {brand.nameHe}
                            </Badge>
                          ))}
                        </div>
                      </TableCell>
                      <TableCell className="py-1.5">
                        <TooltipProvider delayDuration={200}>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <div className="flex items-center gap-1.5 text-amber-700">
                                <AlertTriangle className="h-3.5 w-3.5" />
                                <span className="text-xs">לא ניתן לעקוב אחר דוחות</span>
                              </div>
                            </TooltipTrigger>
                            <TooltipContent side="top" className="text-xs max-w-[250px]">
                              <p>יש להגדיר פרסר (מיפוי קובץ) כדי לעקוב אחר דוחות הספק</p>
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      </TableCell>
                      <TableCell className="py-1.5">
                        <Link href={`/admin/suppliers/${supplier.id}`}>
                          <Button variant="outline" size="sm" className="h-7 text-xs gap-1">
                            <Settings className="h-3 w-3" />
                            הגדרות
                          </Button>
                        </Link>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Legend */}
      <div className="flex items-center gap-6 text-xs text-muted-foreground justify-center">
        <span className="flex items-center gap-1">
          <CheckCircle2 className="h-3 w-3 text-green-600" /> אושר
        </span>
        <span className="flex items-center gap-1">
          <Clock className="h-3 w-3 text-amber-500" /> ממתין
        </span>
        <span className="flex items-center gap-1">
          <XCircle className="h-3 w-3 text-red-500" /> חסר
        </span>
        <span className="text-muted-foreground/70">
          חודשי = 3 אייקונים לרבעון | חצי שנתי = 2 רבעונים
        </span>
      </div>
    </div>
  );
}

function SupplierRow({
  supplier,
  year,
}: {
  supplier: SupplierCompleteness;
  year: number;
}) {
  const frequencyLabels: Record<string, string> = {
    monthly: "חודשי",
    quarterly: "רבעוני",
    semi_annual: "חצי שנתי",
    annual: "שנתי",
  };

  // Build a map of period key -> status
  const periodStatusMap = new Map(
    supplier.periods.map((p) => [p.key, p])
  );

  // Render quarter cell based on supplier frequency
  const renderQuarterCell = (quarter: string) => {
    const quarterNum = parseInt(quarter.replace("Q", ""));

    if (supplier.frequency === "quarterly") {
      // Quarterly: single icon for the quarter
      const periodKey = `${year}-${quarter}`;
      const period = periodStatusMap.get(periodKey);

      if (!period) {
        return <span className="text-muted-foreground/30">-</span>;
      }

      return (
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
              <p className="font-medium">רבעון {quarterNum} {year}</p>
              <p className="text-muted-foreground">{period.startDate} - {period.endDate}</p>
              {period.fileName && (
                <p className="text-muted-foreground truncate max-w-[200px]">{period.fileName}</p>
              )}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      );
    }

    if (supplier.frequency === "monthly") {
      // Monthly: 3 small icons for each month in the quarter
      const months = getMonthsInQuarter(quarterNum);

      return (
        <div className="flex justify-center gap-0.5">
          {months.map((month) => {
            const periodKey = `${year}-${month}`;
            const period = periodStatusMap.get(periodKey);

            if (!period) {
              return (
                <span key={month} className="text-muted-foreground/30 text-[10px]">·</span>
              );
            }

            return (
              <TooltipProvider key={month} delayDuration={200}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div>
                      {period.fileId ? (
                        <Link href={`/admin/supplier-files/review/${period.fileId}`}>
                          <StatusIcon status={period.status} size="small" />
                        </Link>
                      ) : (
                        <StatusIcon status={period.status} size="small" />
                      )}
                    </div>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="text-xs">
                    <p className="font-medium">{period.nameHe}</p>
                    <p className="text-muted-foreground">{period.startDate} - {period.endDate}</p>
                    {period.fileName && (
                      <p className="text-muted-foreground truncate max-w-[200px]">{period.fileName}</p>
                    )}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            );
          })}
        </div>
      );
    }

    if (supplier.frequency === "semi_annual") {
      // Semi-annual: show icon only in Q2 (H1) or Q4 (H2)
      const half = quarterNum <= 2 ? "H1" : "H2";
      const isDisplayQuarter = quarterNum === 2 || quarterNum === 4;

      if (!isDisplayQuarter) {
        return <span className="text-muted-foreground/30">↓</span>; // Arrow indicating it's part of the half
      }

      const periodKey = `${year}-${half}`;
      const period = periodStatusMap.get(periodKey);

      if (!period) {
        return <span className="text-muted-foreground/30">-</span>;
      }

      return (
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
              <p className="font-medium">{period.nameHe} {year}</p>
              <p className="text-muted-foreground">{period.startDate} - {period.endDate}</p>
              {period.fileName && (
                <p className="text-muted-foreground truncate max-w-[200px]">{period.fileName}</p>
              )}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      );
    }

    if (supplier.frequency === "annual") {
      // Annual: show icon only in Q4
      if (quarter !== "Q4") {
        return <span className="text-muted-foreground/30">↓</span>;
      }

      const periodKey = `${year}`;
      const period = periodStatusMap.get(periodKey);

      if (!period) {
        return <span className="text-muted-foreground/30">-</span>;
      }

      return (
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
              <p className="font-medium">שנת {year}</p>
              <p className="text-muted-foreground">{period.startDate} - {period.endDate}</p>
              {period.fileName && (
                <p className="text-muted-foreground truncate max-w-[200px]">{period.fileName}</p>
              )}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      );
    }

    return <span className="text-muted-foreground/30">-</span>;
  };

  return (
    <TableRow className="hover:bg-muted/50">
      <TableCell className="sticky right-0 bg-background z-10 py-1.5">
        <Link
          href={`/admin/supplier-files?supplierId=${supplier.supplier.id}`}
          className="font-medium truncate max-w-[160px] hover:underline hover:text-primary"
          title={supplier.supplier.name}
        >
          {supplier.supplier.name}
        </Link>
      </TableCell>
      <TableCell className="text-center py-1.5">
        <span className="text-xs text-muted-foreground">
          {frequencyLabels[supplier.frequency] || supplier.frequency}
        </span>
      </TableCell>
      {QUARTERS.map((q) => (
        <TableCell key={q} className="text-center py-1.5 px-2">
          {renderQuarterCell(q)}
        </TableCell>
      ))}
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

// Helper: get months (01-12) for a quarter
function getMonthsInQuarter(quarter: number): string[] {
  const startMonth = (quarter - 1) * 3 + 1;
  return [
    String(startMonth).padStart(2, "0"),
    String(startMonth + 1).padStart(2, "0"),
    String(startMonth + 2).padStart(2, "0"),
  ];
}
