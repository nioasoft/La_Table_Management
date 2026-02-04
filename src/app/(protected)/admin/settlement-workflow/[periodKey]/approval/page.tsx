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
  CardFooter,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert";
import {
  ChevronRight,
  RefreshCw,
  Check,
  AlertTriangle,
  FileText,
  GitCompare,
  ArrowUpDown,
  Shield,
  Loader2,
  CheckCircle2,
  XCircle,
  Clock,
} from "lucide-react";
import { toast } from "sonner";
import type { UserRole } from "@/db/schema";
import { getPeriodByKey } from "@/lib/settlement-periods";
import { formatCurrency } from "@/lib/translations";

// Types
interface ApprovalSummary {
  periodKey: string;
  periodInfo: {
    nameHe: string;
    name: string;
    type: string;
    startDate: string;
    endDate: string;
  };
  settlementPeriod: {
    id: string;
    status: string;
    approvedAt: string | null;
    approvedBy: string | null;
  } | null;
  reconciliation: {
    totalPairs: number;
    matchedCount: number;
    discrepancyCount: number;
    pendingCount: number;
  };
  adjustments: {
    total: number;
    approved: number;
    pending: number;
    totalAmount: number;
  };
  commissionSummary: {
    totalSupplierAmount: number;
    totalAdjustments: number;
    netAmount: number;
  };
  approval: {
    canApprove: boolean;
    blockers: string[];
    isApproved: boolean;
  };
}

export default function ApprovalPage() {
  const router = useRouter();
  const params = useParams();
  const periodKey = decodeURIComponent(params.periodKey as string);

  const [isLoading, setIsLoading] = useState(true);
  const [isApproving, setIsApproving] = useState(false);
  const [summary, setSummary] = useState<ApprovalSummary | null>(null);

  const { data: session, isPending } = authClient.useSession();
  const userRole = session
    ? (session.user as { role?: UserRole })?.role
    : undefined;

  // Parse period info from key (memoized to prevent infinite loop)
  const periodInfo = useMemo(() => getPeriodByKey(periodKey), [periodKey]);

  const fetchApprovalSummary = useCallback(async () => {
    try {
      setIsLoading(true);
      const response = await fetch(`/api/settlement-workflow/${encodeURIComponent(periodKey)}/approve`);
      if (!response.ok) {
        throw new Error("Failed to fetch approval summary");
      }
      const data = await response.json();
      setSummary(data);
    } catch (error) {
      console.error("Error fetching approval summary:", error);
      toast.error("שגיאה בטעינת סיכום האישור");
    } finally {
      setIsLoading(false);
    }
  }, [periodKey]);

  useEffect(() => {
    if (!isPending && !session) {
      router.push(`/sign-in?redirect=/admin/settlement-workflow/${encodeURIComponent(periodKey)}/approval`);
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
      fetchApprovalSummary();
    }
  }, [session, isPending, router, userRole, periodKey, periodInfo, fetchApprovalSummary]);

  const handleApprove = async () => {
    if (!confirm("האם לאשר את תקופת ההתחשבנות? פעולה זו אינה ניתנת לביטול.")) {
      return;
    }

    setIsApproving(true);
    try {
      const response = await fetch(`/api/settlement-workflow/${encodeURIComponent(periodKey)}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "שגיאה באישור התקופה");
      }

      toast.success("התקופה אושרה בהצלחה!");
      fetchApprovalSummary();
    } catch (error) {
      console.error("Error approving period:", error);
      toast.error(error instanceof Error ? error.message : "שגיאה באישור התקופה");
    } finally {
      setIsApproving(false);
    }
  };

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

  const matchProgress = summary?.reconciliation.totalPairs
    ? Math.round((summary.reconciliation.matchedCount / summary.reconciliation.totalPairs) * 100)
    : 0;

  const adjustmentProgress = summary?.adjustments.total
    ? Math.round((summary.adjustments.approved / summary.adjustments.total) * 100)
    : 100;

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
              <h1 className="text-2xl font-bold">אישור תקופה</h1>
              <Badge variant="outline">{periodInfo.nameHe}</Badge>
              {summary?.approval.isApproved && (
                <Badge variant="default" className="bg-green-600">
                  <CheckCircle2 className="h-3 w-3 me-1" />
                  מאושר
                </Badge>
              )}
            </div>
            <p className="text-muted-foreground text-sm">
              {periodInfo.startDate?.toLocaleDateString("he-IL", { day: "numeric", month: "short", year: "numeric" })} - {periodInfo.endDate?.toLocaleDateString("he-IL", { day: "numeric", month: "short", year: "numeric" })}
            </p>
          </div>
        </div>
        <Button variant="outline" onClick={fetchApprovalSummary}>
          <RefreshCw className="me-2 h-4 w-4" />
          רענון
        </Button>
      </div>

      {/* Approval Status Alert */}
      {summary?.approval.isApproved ? (
        <Alert className="mb-6 border-green-600 bg-green-50 dark:bg-green-950">
          <CheckCircle2 className="h-4 w-4 text-green-600" />
          <AlertTitle className="text-green-600">התקופה אושרה</AlertTitle>
          <AlertDescription>
            אושר בתאריך:{" "}
            {summary.settlementPeriod?.approvedAt
              ? new Date(summary.settlementPeriod.approvedAt).toLocaleDateString("he-IL", {
                  day: "numeric",
                  month: "long",
                  year: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })
              : "-"}
          </AlertDescription>
        </Alert>
      ) : summary?.approval.blockers.length ? (
        <Alert variant="destructive" className="mb-6">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>לא ניתן לאשר</AlertTitle>
          <AlertDescription>
            <ul className="list-disc list-inside mt-2">
              {summary.approval.blockers.map((blocker, i) => (
                <li key={i}>{blocker}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      ) : (
        <Alert className="mb-6 border-green-600 bg-green-50 dark:bg-green-950">
          <Check className="h-4 w-4 text-green-600" />
          <AlertTitle className="text-green-600">מוכן לאישור</AlertTitle>
          <AlertDescription>
            כל הבדיקות עברו בהצלחה. ניתן לאשר את התקופה.
          </AlertDescription>
        </Alert>
      )}

      {/* Summary Cards */}
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3 mb-6">
        {/* Reconciliation Card */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-lg">
              <GitCompare className="h-5 w-5" />
              הצלבת נתונים
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="flex justify-between text-sm">
                <span>התקדמות</span>
                <span className="font-medium">{matchProgress}%</span>
              </div>
              <Progress value={matchProgress} className="h-2" />
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-green-600" />
                  <span>תואמים: {summary?.reconciliation.matchedCount || 0}</span>
                </div>
                <div className="flex items-center gap-2">
                  <XCircle className="h-4 w-4 text-red-600" />
                  <span>פערים: {summary?.reconciliation.discrepancyCount || 0}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Clock className="h-4 w-4 text-amber-600" />
                  <span>ממתינים: {summary?.reconciliation.pendingCount || 0}</span>
                </div>
                <div className="flex items-center gap-2">
                  <FileText className="h-4 w-4 text-muted-foreground" />
                  <span>{`סה"כ:`} {summary?.reconciliation.totalPairs || 0}</span>
                </div>
              </div>
            </div>
          </CardContent>
          <CardFooter>
            <Link href={`/admin/settlement-workflow/${encodeURIComponent(periodKey)}/reconciliation`} className="w-full">
              <Button variant="outline" size="sm" className="w-full">
                צפה בהצלבות
              </Button>
            </Link>
          </CardFooter>
        </Card>

        {/* Adjustments Card */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-lg">
              <ArrowUpDown className="h-5 w-5" />
              התאמות
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="flex justify-between text-sm">
                <span>מאושרות</span>
                <span className="font-medium">{adjustmentProgress}%</span>
              </div>
              <Progress value={adjustmentProgress} className="h-2" />
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-green-600" />
                  <span>מאושרות: {summary?.adjustments.approved || 0}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Clock className="h-4 w-4 text-amber-600" />
                  <span>ממתינות: {summary?.adjustments.pending || 0}</span>
                </div>
              </div>
              <div className="pt-2 border-t">
                <div className="flex justify-between">
                  <span className="text-sm text-muted-foreground">{`סה"כ סכום`}</span>
                  <span className="font-medium" dir="ltr">
                    {formatCurrency(summary?.adjustments.totalAmount || 0)}
                  </span>
                </div>
              </div>
            </div>
          </CardContent>
          <CardFooter>
            <Link href={`/admin/settlement-workflow/${encodeURIComponent(periodKey)}/adjustments`} className="w-full">
              <Button variant="outline" size="sm" className="w-full">
                צפה בהתאמות
              </Button>
            </Link>
          </CardFooter>
        </Card>

        {/* Commission Summary Card */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-lg">
              <Shield className="h-5 w-5" />
              סיכום כספי
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <div className="flex justify-between">
                <span className="text-sm text-muted-foreground">{`סה"כ מספקים`}</span>
                <span className="font-medium" dir="ltr">
                  {formatCurrency(summary?.commissionSummary.totalSupplierAmount || 0)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm text-muted-foreground">התאמות</span>
                <span
                  className={`font-medium ${
                    (summary?.commissionSummary.totalAdjustments || 0) >= 0
                      ? "text-green-600"
                      : "text-red-600"
                  }`}
                  dir="ltr"
                >
                  {formatCurrency(summary?.commissionSummary.totalAdjustments || 0)}
                </span>
              </div>
              <div className="pt-2 border-t">
                <div className="flex justify-between">
                  <span className="font-medium">{`סה"כ לפני מע״מ`}</span>
                  <span className="text-lg font-bold" dir="ltr">
                    {formatCurrency(summary?.commissionSummary.netAmount || 0)}
                  </span>
                </div>
              </div>
            </div>
          </CardContent>
          <CardFooter>
            <Link href={`/admin/settlement-workflow/${encodeURIComponent(periodKey)}/reports`} className="w-full">
              <Button variant="outline" size="sm" className="w-full">
                צפה בדוחות
              </Button>
            </Link>
          </CardFooter>
        </Card>
      </div>

      {/* Approval Action */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5" />
            אישור סופי
          </CardTitle>
          <CardDescription>
            אישור התקופה יקבע את הנתונים הסופיים ויאפשר הפקת דוחות וחשבוניות
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {/* Checklist */}
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                {summary?.reconciliation.discrepancyCount === 0 ? (
                  <CheckCircle2 className="h-5 w-5 text-green-600" />
                ) : (
                  <XCircle className="h-5 w-5 text-red-600" />
                )}
                <span>אין פערים פתוחים בהצלבה</span>
              </div>
              <div className="flex items-center gap-2">
                {summary?.adjustments.pending === 0 ? (
                  <CheckCircle2 className="h-5 w-5 text-green-600" />
                ) : (
                  <XCircle className="h-5 w-5 text-red-600" />
                )}
                <span>כל ההתאמות אושרו</span>
              </div>
            </div>
          </div>
        </CardContent>
        <CardFooter className="flex justify-end">
          <Button
            size="lg"
            onClick={handleApprove}
            disabled={!summary?.approval.canApprove || summary?.approval.isApproved || isApproving}
          >
            {isApproving ? (
              <>
                <Loader2 className="me-2 h-4 w-4 animate-spin" />
                מאשר...
              </>
            ) : summary?.approval.isApproved ? (
              <>
                <CheckCircle2 className="me-2 h-4 w-4" />
                מאושר
              </>
            ) : (
              <>
                <Check className="me-2 h-4 w-4" />
                אשר תקופה
              </>
            )}
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
