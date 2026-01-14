"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { useRouter, useParams } from "next/navigation";
import Link from "next/link";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ChevronRight,
  RefreshCw,
  GitCompare,
  Check,
  AlertTriangle,
  Clock,
  Play,
  Search,
  Filter,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import type { UserRole } from "@/db/schema";
import { getPeriodByKey, getPeriodTypeLabel } from "@/lib/settlement-periods";
import { formatCurrency } from "@/lib/translations";

// Types
interface CrossReferenceItem {
  id: string;
  supplierId: string;
  supplierName: string;
  supplierCode?: string;
  franchiseeId: string;
  franchiseeName: string;
  franchiseeCode?: string;
  supplierAmount: number;
  franchiseeAmount: number;
  difference: number;
  differencePercentage: number;
  matchStatus: "matched" | "discrepancy" | "pending";
  autoMatched?: boolean;
  manualReview?: boolean;
  reviewedBy?: string;
  reviewedAt?: string;
  reviewNotes?: string;
  createdAt: string;
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
}

type FilterStatus = "all" | "matched" | "discrepancy" | "pending";

// Status config
const statusConfig: Record<
  CrossReferenceItem["matchStatus"],
  { label: string; variant: "default" | "secondary" | "destructive" | "outline"; icon: React.ReactNode }
> = {
  matched: { label: "תואם", variant: "default", icon: <Check className="h-3 w-3" /> },
  discrepancy: { label: "פער", variant: "destructive", icon: <AlertTriangle className="h-3 w-3" /> },
  pending: { label: "ממתין", variant: "outline", icon: <Clock className="h-3 w-3" /> },
};

export default function ReconciliationPage() {
  const router = useRouter();
  const params = useParams();
  const periodKey = decodeURIComponent(params.periodKey as string);

  const [isLoading, setIsLoading] = useState(true);
  const [isRunning, setIsRunning] = useState(false);
  const [crossReferences, setCrossReferences] = useState<CrossReferenceItem[]>([]);
  const [report, setReport] = useState<ReconciliationReport | null>(null);
  const [filterStatus, setFilterStatus] = useState<FilterStatus>("all");
  const [searchQuery, setSearchQuery] = useState("");

  const { data: session, isPending } = authClient.useSession();
  const userRole = session
    ? (session.user as { role?: UserRole })?.role
    : undefined;

  // Parse period info from key (memoized to prevent infinite loop)
  const periodInfo = useMemo(() => getPeriodByKey(periodKey), [periodKey]);

  const fetchReconciliationData = useCallback(async () => {
    try {
      setIsLoading(true);
      const response = await fetch(`/api/settlement-workflow/${encodeURIComponent(periodKey)}/reconcile`);
      if (!response.ok) {
        throw new Error("Failed to fetch reconciliation data");
      }
      const data = await response.json();
      setCrossReferences(data.crossReferences || []);
      setReport(data.report || null);
    } catch (error) {
      console.error("Error fetching reconciliation data:", error);
      toast.error("שגיאה בטעינת נתוני ההצלבה");
    } finally {
      setIsLoading(false);
    }
  }, [periodKey]);

  useEffect(() => {
    if (!isPending && !session) {
      router.push(`/sign-in?redirect=/admin/settlement-workflow/${encodeURIComponent(periodKey)}/reconciliation`);
      return;
    }

    if (
      !isPending &&
      session?.user &&
      userRole !== "super_user" &&
      userRole !== "admin"
    ) {
      router.push("/dashboard");
      return;
    }

    if (!isPending && session && periodInfo) {
      fetchReconciliationData();
    }
  }, [session, isPending, router, userRole, periodKey, periodInfo, fetchReconciliationData]);

  const handleRunReconciliation = async () => {
    setIsRunning(true);
    try {
      const response = await fetch(`/api/settlement-workflow/${encodeURIComponent(periodKey)}/reconcile`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ threshold: 10 }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to run reconciliation");
      }

      const data = await response.json();
      toast.success(data.message || "ההצלבה הושלמה בהצלחה");
      fetchReconciliationData();
    } catch (error) {
      console.error("Error running reconciliation:", error);
      toast.error(error instanceof Error ? error.message : "שגיאה בהרצת ההצלבה");
    } finally {
      setIsRunning(false);
    }
  };

  // Filter and search cross-references
  const filteredCrossReferences = crossReferences.filter((cr) => {
    // Status filter
    if (filterStatus !== "all" && cr.matchStatus !== filterStatus) {
      return false;
    }

    // Search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      return (
        cr.supplierName?.toLowerCase().includes(query) ||
        cr.franchiseeName?.toLowerCase().includes(query) ||
        cr.supplierCode?.toLowerCase().includes(query) ||
        cr.franchiseeCode?.toLowerCase().includes(query)
      );
    }

    return true;
  });

  if (!periodInfo) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center">
          <h2 className="text-xl font-semibold mb-2">תקופה לא נמצאה</h2>
          <p className="text-muted-foreground mb-4">מפתח תקופה: {periodKey}</p>
          <Button onClick={() => router.push("/admin/settlements")}>
            חזרה לרשימת התקופות
          </Button>
        </div>
      </div>
    );
  }

  if (isLoading || isPending) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          <Link href={`/admin/settlement-workflow/${encodeURIComponent(periodKey)}`}>
            <Button variant="ghost" size="sm">
              <ChevronRight className="h-4 w-4 ms-1" />
              חזרה לתקופה
            </Button>
          </Link>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold">הצלבת נתונים</h1>
              <Badge variant="outline">{periodInfo.nameHe}</Badge>
            </div>
            <p className="text-muted-foreground text-sm">
              {periodInfo.startDate?.toLocaleDateString("he-IL", { day: "numeric", month: "short", year: "numeric" })} - {periodInfo.endDate?.toLocaleDateString("he-IL", { day: "numeric", month: "short", year: "numeric" })}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={fetchReconciliationData}>
            <RefreshCw className="me-2 h-4 w-4" />
            רענון
          </Button>
          <Button onClick={handleRunReconciliation} disabled={isRunning}>
            {isRunning ? (
              <>
                <Loader2 className="me-2 h-4 w-4 animate-spin" />
                מריץ...
              </>
            ) : (
              <>
                <Play className="me-2 h-4 w-4" />
                הרץ הצלבה
              </>
            )}
          </Button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid gap-4 md:grid-cols-5 mb-6">
        <Card>
          <CardContent className="pt-6">
            <div className="text-2xl font-bold">{report?.totalPairs || 0}</div>
            <p className="text-muted-foreground text-sm">סה״כ השוואות</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-2xl font-bold text-green-600">{report?.matchedCount || 0}</div>
            <p className="text-muted-foreground text-sm">תואמים</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-2xl font-bold text-red-600">{report?.discrepancyCount || 0}</div>
            <p className="text-muted-foreground text-sm">פערים</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-2xl font-bold text-amber-600">{report?.pendingCount || 0}</div>
            <p className="text-muted-foreground text-sm">ממתינים</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-2xl font-bold">{formatCurrency(report?.totalDifference || 0)}</div>
            <p className="text-muted-foreground text-sm">סה״כ פערים</p>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card className="mb-6">
        <CardContent className="pt-6">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 flex-1">
              <Search className="h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="חיפוש לפי שם ספק או זכיין..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="max-w-sm"
              />
            </div>
            <div className="flex items-center gap-2">
              <Filter className="h-4 w-4 text-muted-foreground" />
              <Select value={filterStatus} onValueChange={(v) => setFilterStatus(v as FilterStatus)}>
                <SelectTrigger className="w-40">
                  <SelectValue placeholder="סינון לפי סטטוס" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">הכל</SelectItem>
                  <SelectItem value="matched">תואמים</SelectItem>
                  <SelectItem value="discrepancy">פערים</SelectItem>
                  <SelectItem value="pending">ממתינים</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Cross-References Table */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <GitCompare className="h-5 w-5" />
            טבלת הצלבה
          </CardTitle>
          <CardDescription>
            {filteredCrossReferences.length} תוצאות{" "}
            {filterStatus !== "all" && `(מסונן: ${statusConfig[filterStatus as keyof typeof statusConfig]?.label})`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-right">ספק</TableHead>
                <TableHead className="text-right">זכיין</TableHead>
                <TableHead className="text-right">סכום ספק</TableHead>
                <TableHead className="text-right">סכום זכיין</TableHead>
                <TableHead className="text-right">פער</TableHead>
                <TableHead className="text-right">%</TableHead>
                <TableHead className="text-right">סטטוס</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredCrossReferences.map((cr) => {
                const config = statusConfig[cr.matchStatus];
                return (
                  <TableRow key={cr.id}>
                    <TableCell className="font-medium">{cr.supplierName}</TableCell>
                    <TableCell>{cr.franchiseeName}</TableCell>
                    <TableCell className="text-start" dir="ltr">
                      {formatCurrency(cr.supplierAmount)}
                    </TableCell>
                    <TableCell className="text-start" dir="ltr">
                      {formatCurrency(cr.franchiseeAmount)}
                    </TableCell>
                    <TableCell
                      className={`text-start font-medium ${
                        cr.difference > 0
                          ? "text-red-600"
                          : cr.difference < 0
                          ? "text-amber-600"
                          : ""
                      }`}
                      dir="ltr"
                    >
                      {formatCurrency(cr.difference)}
                    </TableCell>
                    <TableCell className="text-start" dir="ltr">
                      {cr.differencePercentage.toFixed(1)}%
                    </TableCell>
                    <TableCell>
                      <Badge variant={config.variant} className="flex items-center gap-1 w-fit">
                        {config.icon}
                        {config.label}
                      </Badge>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>

          {filteredCrossReferences.length === 0 && (
            <div className="text-center py-8 text-muted-foreground">
              {crossReferences.length === 0
                ? "אין נתוני הצלבה. לחץ על \"הרץ הצלבה\" כדי להתחיל."
                : "אין תוצאות תואמות לסינון"}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
