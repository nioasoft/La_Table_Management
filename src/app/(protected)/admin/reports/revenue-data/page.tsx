"use client";

import { fetchWithTimeout } from "@/lib/fetch-with-timeout";
import { useEffect, useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { authClient } from "@/lib/auth-client";
import { useQuery } from "@tanstack/react-query";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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
import { Badge } from "@/components/ui/badge";
import {
  Loader2,
  ChevronLeft,
  TrendingUp,
  Download,
  Filter,
  Search,
  Calendar,
  Building2,
} from "lucide-react";
import { formatAmount } from "@/lib/bkmvdata-parser";

interface RevenueDataItem {
  franchiseeId: string;
  franchiseeName: string;
  brandName: string;
  month: string;
  amount: number;
  accountCodes: string[];
  fileId: string;
  fileName: string;
  processedAt: string;
}

interface FranchiseeOption {
  id: string;
  name: string;
  code: string;
  brand: {
    id: string;
    nameHe: string;
  } | null;
}

export default function RevenueDataReportPage() {
  const router = useRouter();
  const { data: session, isPending } = authClient.useSession();
  const userRole = session
    ? (session.user as { role?: string })?.role
    : undefined;

  // Filter state
  const [filterFranchisee, setFilterFranchisee] = useState<string>("all");
  const [filterYear, setFilterYear] = useState<string>(
    new Date().getFullYear().toString()
  );
  const [searchQuery, setSearchQuery] = useState("");

  // Redirect if not authenticated or not admin
  useEffect(() => {
    if (!isPending && !session) {
      router.push("/sign-in?redirect=/admin/reports/revenue-data");
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

  // Fetch franchisees for filter dropdown
  const { data: franchiseesData } = useQuery({
    queryKey: ["franchisees", "list"],
    queryFn: async () => {
      const response = await fetchWithTimeout("/api/franchisees");
      if (!response.ok) throw new Error("Failed to fetch franchisees");
      return response.json();
    },
    enabled: !isPending && !!session,
  });

  const franchisees: FranchiseeOption[] = franchiseesData?.franchisees || [];

  // Sorted franchisees for dropdown
  const sortedFranchisees = useMemo(() => {
    return [...franchisees].sort((a, b) => a.name.localeCompare(b.name, "he"));
  }, [franchisees]);

  // Fetch revenue data
  const {
    data: revenueData,
    isLoading,
    error,
  } = useQuery({
    queryKey: ["reports", "revenue-data", filterFranchisee, filterYear],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (filterFranchisee && filterFranchisee !== "all") {
        params.set("franchiseeId", filterFranchisee);
      }
      if (filterYear) {
        params.set("year", filterYear);
      }
      const response = await fetchWithTimeout(
        `/api/reports/revenue-data?${params.toString()}`
      );
      if (!response.ok) throw new Error("Failed to fetch revenue data");
      return response.json();
    },
    enabled: !isPending && !!session,
  });

  const items: RevenueDataItem[] = revenueData?.items || [];

  // Filter by search query
  const filteredItems = useMemo(() => {
    if (!searchQuery) return items;
    const query = searchQuery.toLowerCase();
    return items.filter(
      (item) =>
        item.franchiseeName.toLowerCase().includes(query) ||
        item.brandName.toLowerCase().includes(query)
    );
  }, [items, searchQuery]);

  // Calculate totals
  const totals = useMemo(() => {
    const monthlyTotals: Record<string, number> = {};
    let grandTotal = 0;

    for (const item of filteredItems) {
      monthlyTotals[item.month] =
        (monthlyTotals[item.month] || 0) + item.amount;
      grandTotal += item.amount;
    }

    return { monthlyTotals, grandTotal };
  }, [filteredItems]);

  // Generate year options
  const yearOptions = useMemo(() => {
    const currentYear = new Date().getFullYear();
    const years: string[] = [];
    for (let y = currentYear; y >= currentYear - 3; y--) {
      years.push(y.toString());
    }
    return years;
  }, []);

  // Export to Excel
  const handleExport = async () => {
    const params = new URLSearchParams();
    if (filterFranchisee && filterFranchisee !== "all") {
      params.set("franchiseeId", filterFranchisee);
    }
    if (filterYear) {
      params.set("year", filterYear);
    }
    params.set("format", "xlsx");

    window.location.href = `/api/reports/revenue-data?${params.toString()}`;
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
      <div>
        <nav className="flex items-center space-x-1 space-x-reverse text-sm text-muted-foreground mb-2">
          <Link href="/admin" className="hover:text-foreground">
            ניהול
          </Link>
          <ChevronLeft className="h-4 w-4 rotate-180" />
          <Link href="/admin/reports" className="hover:text-foreground">
            דוחות
          </Link>
          <ChevronLeft className="h-4 w-4 rotate-180" />
          <span className="text-foreground">נתוני הכנסות</span>
        </nav>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">
              נתוני הכנסות זכיינים
            </h1>
            <p className="text-muted-foreground mt-1">
              סיכום הכנסות מקבצי BKMVDATA לפי זכיין ותקופה
            </p>
          </div>
          <Button onClick={handleExport} disabled={items.length === 0}>
            <Download className="h-4 w-4 me-2" />
            ייצוא לאקסל
          </Button>
        </div>
      </div>

      {/* Filters */}
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-lg flex items-center gap-2">
            <Filter className="h-5 w-5" />
            סינון
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            {/* Year Filter */}
            <div className="space-y-2">
              <Label className="flex items-center gap-2">
                <Calendar className="h-4 w-4" />
                שנה
              </Label>
              <Select value={filterYear} onValueChange={setFilterYear}>
                <SelectTrigger>
                  <SelectValue placeholder="בחר שנה" />
                </SelectTrigger>
                <SelectContent>
                  {yearOptions.map((year) => (
                    <SelectItem key={year} value={year}>
                      {year}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Franchisee Filter */}
            <div className="space-y-2">
              <Label className="flex items-center gap-2">
                <Building2 className="h-4 w-4" />
                זכיין
              </Label>
              <Select
                value={filterFranchisee}
                onValueChange={setFilterFranchisee}
              >
                <SelectTrigger>
                  <SelectValue placeholder="כל הזכיינים" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">כל הזכיינים</SelectItem>
                  {sortedFranchisees.map((f) => (
                    <SelectItem key={f.id} value={f.id}>
                      {f.name} ({f.code})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Search */}
            <div className="space-y-2 md:col-span-2">
              <Label className="flex items-center gap-2">
                <Search className="h-4 w-4" />
                חיפוש
              </Label>
              <Input
                placeholder="חיפוש לפי שם זכיין או מותג..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Summary */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>סה״כ הכנסות</CardDescription>
            <CardTitle className="text-2xl font-mono">
              {formatAmount(totals.grandTotal)}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>זכיינים עם נתונים</CardDescription>
            <CardTitle className="text-2xl">
              {new Set(filteredItems.map((i) => i.franchiseeId)).size}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>חודשים עם נתונים</CardDescription>
            <CardTitle className="text-2xl">
              {Object.keys(totals.monthlyTotals).length}
            </CardTitle>
          </CardHeader>
        </Card>
      </div>

      {/* Data Table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <TrendingUp className="h-5 w-5" />
            נתוני הכנסות
          </CardTitle>
          <CardDescription>
            {filteredItems.length} רשומות נמצאו
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : error ? (
            <div className="text-center text-destructive py-8">
              שגיאה בטעינת הנתונים
            </div>
          ) : filteredItems.length === 0 ? (
            <div className="text-center text-muted-foreground py-8">
              לא נמצאו נתוני הכנסות לתקופה הנבחרת
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>זכיין</TableHead>
                    <TableHead>מותג</TableHead>
                    <TableHead>חודש</TableHead>
                    <TableHead className="text-left">סכום הכנסות</TableHead>
                    <TableHead>חשבונות</TableHead>
                    <TableHead>קובץ מקור</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredItems.map((item, idx) => {
                    const [year, monthNum] = item.month.split("-");
                    const monthName = new Date(
                      parseInt(year),
                      parseInt(monthNum) - 1
                    ).toLocaleDateString("he-IL", {
                      month: "long",
                      year: "numeric",
                    });

                    return (
                      <TableRow key={`${item.franchiseeId}-${item.month}-${idx}`}>
                        <TableCell className="font-medium">
                          {item.franchiseeName}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">{item.brandName}</Badge>
                        </TableCell>
                        <TableCell>{monthName}</TableCell>
                        <TableCell className="text-left font-mono">
                          {formatAmount(item.amount)}
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-1">
                            {item.accountCodes.map((code) => (
                              <Badge
                                key={code}
                                variant="secondary"
                                className="text-xs"
                              >
                                {code}
                              </Badge>
                            ))}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Link
                            href={`/admin/bkmvdata/review/${item.fileId}`}
                            className="text-primary hover:underline text-sm"
                          >
                            {item.fileName}
                          </Link>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
