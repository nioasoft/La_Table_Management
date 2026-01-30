"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
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
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Loader2,
  RefreshCw,
  ChevronDown,
  ChevronRight,
  FileUp,
  BarChart3,
  Building2,
  Users,
  FileText,
} from "lucide-react";
import { formatCurrency } from "@/lib/translations";
import type { FranchiseeBreakdownReport, FranchiseeBreakdownEntry } from "@/data-access/supplier-file-reports";

export default function SupplierFilesByFranchiseePage() {
  const router = useRouter();
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentQuarter = Math.floor(now.getMonth() / 3) + 1;

  // Default to previous quarter
  const defaultYear = currentQuarter === 1 ? currentYear - 1 : currentYear;
  const defaultQuarter = currentQuarter === 1 ? 4 : currentQuarter - 1;

  const [year, setYear] = useState(defaultYear);
  const [quarter, setQuarter] = useState(defaultQuarter);
  const [brandId, setBrandId] = useState<string>("all");
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

  const { data: session, isPending: isSessionPending } = authClient.useSession();
  const userRole = session ? (session.user as { role?: string })?.role : undefined;

  if (!isSessionPending && !session) {
    router.push("/sign-in?redirect=/admin/supplier-files/by-franchisee");
  }
  if (!isSessionPending && session?.user && userRole !== "super_user" && userRole !== "admin") {
    router.push("/dashboard");
  }

  // Calculate date range from year and quarter
  const { startDate, endDate } = useMemo(() => {
    const startMonth = (quarter - 1) * 3;
    const start = new Date(year, startMonth, 1);
    const end = new Date(year, startMonth + 3, 0); // Last day of quarter

    // Format as local date (YYYY-MM-DD) without timezone conversion
    const formatLocalDate = (date: Date) => {
      const y = date.getFullYear();
      const m = String(date.getMonth() + 1).padStart(2, '0');
      const d = String(date.getDate()).padStart(2, '0');
      return `${y}-${m}-${d}`;
    };

    return {
      startDate: formatLocalDate(start),
      endDate: formatLocalDate(end),
    };
  }, [year, quarter]);

  const {
    data: reportData,
    isLoading,
    refetch,
  } = useQuery<FranchiseeBreakdownReport>({
    queryKey: ["supplier-files-by-franchisee", startDate, endDate, brandId],
    queryFn: async () => {
      const params = new URLSearchParams({
        startDate,
        endDate,
      });
      if (brandId && brandId !== "all") params.append("brandId", brandId);
      const response = await fetch(`/api/supplier-files/by-franchisee?${params}`);
      if (!response.ok) throw new Error("Failed to fetch franchisee breakdown");
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
  const franchisees = reportData?.franchisees || [];
  const summary = reportData?.summary;

  const years = [currentYear, currentYear - 1, currentYear - 2];
  const quarters = [
    { value: 1, label: "רבעון 1" },
    { value: 2, label: "רבעון 2" },
    { value: 3, label: "רבעון 3" },
    { value: 4, label: "רבעון 4" },
  ];

  const toggleRow = (franchiseeId: string) => {
    setExpandedRows((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(franchiseeId)) {
        newSet.delete(franchiseeId);
      } else {
        newSet.add(franchiseeId);
      }
      return newSet;
    });
  };

  if (isSessionPending || isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="container mx-auto py-4 space-y-4 max-w-6xl" dir="rtl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">פירוט לפי זכיין</h1>
          <p className="text-sm text-muted-foreground">
            נתוני קבצי ספקים מקובצים לפי זכיין
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/admin/supplier-files">
            <Button variant="outline" size="sm">
              <FileUp className="h-4 w-4 me-1" />
              העלאת קבצים
            </Button>
          </Link>
          <Link href="/admin/supplier-files/completeness">
            <Button variant="outline" size="sm">
              <BarChart3 className="h-4 w-4 me-1" />
              שלמות
            </Button>
          </Link>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Filters Row */}
      <div className="flex flex-wrap items-center gap-4 p-3 bg-muted/50 rounded-lg">
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

        <Select value={quarter.toString()} onValueChange={(v) => setQuarter(parseInt(v))}>
          <SelectTrigger className="w-28 h-8">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {quarters.map((q) => (
              <SelectItem key={q.value} value={q.value.toString()}>{q.label}</SelectItem>
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
      </div>

      {/* Summary Cards */}
      {summary && (
        <div className="grid gap-3 grid-cols-2 md:grid-cols-4">
          <Card className="py-2">
            <CardHeader className="pb-1 pt-2 px-4">
              <CardTitle className="text-xs font-medium flex items-center gap-1 text-muted-foreground">
                <Users className="h-3.5 w-3.5" />
                זכיינים
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-2">
              <div className="text-2xl font-bold">{summary.totalFranchisees}</div>
            </CardContent>
          </Card>
          <Card className="py-2">
            <CardHeader className="pb-1 pt-2 px-4">
              <CardTitle className="text-xs font-medium flex items-center gap-1 text-muted-foreground">
                <Building2 className="h-3.5 w-3.5" />
                כולל מע״מ
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-2">
              <div className="text-2xl font-bold">{formatCurrency(summary.totalGrossAmount)}</div>
            </CardContent>
          </Card>
          <Card className="py-2">
            <CardHeader className="pb-1 pt-2 px-4">
              <CardTitle className="text-xs font-medium flex items-center gap-1 text-muted-foreground">
                <Building2 className="h-3.5 w-3.5" />
                לפני מע״מ
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-2">
              <div className="text-2xl font-bold">{formatCurrency(summary.totalNetAmount)}</div>
            </CardContent>
          </Card>
          <Card className="py-2">
            <CardHeader className="pb-1 pt-2 px-4">
              <CardTitle className="text-xs font-medium flex items-center gap-1 text-muted-foreground">
                <FileText className="h-3.5 w-3.5" />
                קבצים
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-2">
              <div className="text-2xl font-bold">{summary.totalFiles}</div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Table */}
      <Card>
        <CardHeader className="py-3 px-4">
          <CardTitle className="text-base">פירוט לפי זכיין</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {franchisees.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              לא נמצאו נתונים לתקופה הנבחרת
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table className="text-sm">
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="w-8 py-2"></TableHead>
                    <TableHead className="py-2">זכיין</TableHead>
                    <TableHead className="py-2 text-center">מותג</TableHead>
                    <TableHead className="py-2 text-center">ספקים</TableHead>
                    <TableHead className="py-2 text-left">כולל מע״מ</TableHead>
                    <TableHead className="py-2 text-left">לפני מע״מ</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {franchisees.map((franchisee) => (
                    <FranchiseeRow
                      key={franchisee.franchiseeId}
                      franchisee={franchisee}
                      isExpanded={expandedRows.has(franchisee.franchiseeId)}
                      onToggle={() => toggleRow(franchisee.franchiseeId)}
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

function FranchiseeRow({
  franchisee,
  isExpanded,
  onToggle,
}: {
  franchisee: FranchiseeBreakdownEntry;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  return (
    <>
      <TableRow
        className="hover:bg-muted/50 cursor-pointer"
        onClick={onToggle}
      >
        <TableCell className="py-2 w-8">
          <Button variant="ghost" size="sm" className="h-6 w-6 p-0">
            {isExpanded ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
          </Button>
        </TableCell>
        <TableCell className="py-2 font-medium">{franchisee.franchiseeName}</TableCell>
        <TableCell className="py-2 text-center">
          <Badge variant="outline">{franchisee.brandName}</Badge>
        </TableCell>
        <TableCell className="py-2 text-center">
          <Badge variant="secondary">{franchisee.supplierCount}</Badge>
        </TableCell>
        <TableCell className="py-2 text-left font-medium">
          {formatCurrency(franchisee.totalGrossAmount)}
        </TableCell>
        <TableCell className="py-2 text-left font-medium">
          {formatCurrency(franchisee.totalNetAmount)}
        </TableCell>
      </TableRow>
      {isExpanded && (
        <TableRow className="bg-muted/30 hover:bg-muted/30">
          <TableCell colSpan={6} className="py-0">
            <div className="py-2 px-4">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent text-xs">
                    <TableHead className="py-1 h-7">ספק</TableHead>
                    <TableHead className="py-1 h-7">קובץ</TableHead>
                    <TableHead className="py-1 h-7">שם בקובץ</TableHead>
                    <TableHead className="py-1 h-7 text-left">כולל מע״מ</TableHead>
                    <TableHead className="py-1 h-7 text-left">לפני מע״מ</TableHead>
                    <TableHead className="py-1 h-7 w-16"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {franchisee.suppliers.map((supplier, idx) => (
                    <TableRow key={`${supplier.fileId}-${idx}`} className="text-xs">
                      <TableCell className="py-1.5">{supplier.supplierName}</TableCell>
                      <TableCell className="py-1.5 text-muted-foreground truncate max-w-[150px]">
                        {supplier.fileName}
                      </TableCell>
                      <TableCell className="py-1.5 text-muted-foreground">
                        {supplier.originalName}
                      </TableCell>
                      <TableCell className="py-1.5 text-left">
                        {formatCurrency(supplier.grossAmount)}
                      </TableCell>
                      <TableCell className="py-1.5 text-left">
                        {formatCurrency(supplier.netAmount)}
                      </TableCell>
                      <TableCell className="py-1.5">
                        <Link href={`/admin/supplier-files/review/${supplier.fileId}`}>
                          <Button variant="ghost" size="sm" className="h-6 px-2 text-xs">
                            צפה
                          </Button>
                        </Link>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </TableCell>
        </TableRow>
      )}
    </>
  );
}
