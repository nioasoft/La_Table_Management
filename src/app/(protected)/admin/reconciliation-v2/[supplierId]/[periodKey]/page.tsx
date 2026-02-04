"use client";

import { use, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, ArrowRight, Check, AlertTriangle, Scale } from "lucide-react";
import {
  ComparisonTable,
  FileApprovalSection,
  StatusBadge,
} from "@/components/reconciliation-v2";
import {
  useReconciliationSessionWithComparisons,
  useUpdateComparisonStatus,
  useAddToReviewQueue,
  useApproveSessionFile,
  useRejectSessionFile,
  reconciliationV2Keys,
} from "@/queries/reconciliation-v2";

// Threshold for auto-approval (duplicated from data-access to avoid server-only import)
const RECONCILIATION_THRESHOLD = 30;
import { toast } from "sonner";
import { format } from "date-fns";
import { he } from "date-fns/locale";
import { useQueryClient } from "@tanstack/react-query";

interface PageProps {
  params: Promise<{
    supplierId: string;
    periodKey: string;
  }>;
}

function formatCurrency(amount: string | number | null): string {
  if (amount === null) return "₪0";
  const num = typeof amount === "string" ? parseFloat(amount) : amount;
  return new Intl.NumberFormat("he-IL", {
    style: "currency",
    currency: "ILS",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(num);
}

function formatPeriodDate(dateString: string): string {
  try {
    const date = new Date(dateString);
    return format(date, "MMMM yyyy", { locale: he });
  } catch {
    return dateString;
  }
}

export default function ReconciliationComparisonPage({ params }: PageProps) {
  const { supplierId, periodKey } = use(params);
  const router = useRouter();
  const queryClient = useQueryClient();

  // Parse period key to get dates
  const [periodStartDate, periodEndDate] = periodKey.split("_");

  // Fetch session data - find by supplier and period
  const { data, isLoading, error, refetch } = useReconciliationSessionWithComparisons(null, {
    enabled: false,
  });

  // We need to first get the session ID based on supplier and period
  const [sessionId, setSessionId] = useState<string | null>(null);
  const sessionQuery = useReconciliationSessionWithComparisons(sessionId, {
    enabled: !!sessionId,
  });

  // On mount, try to find or create the session
  useMemo(() => {
    // We'll use the period as the session ID lookup
    const fetchSession = async () => {
      try {
        const res = await fetch(
          `/api/reconciliation-v2/sessions?supplierId=${supplierId}&periodStart=${periodStartDate}&periodEnd=${periodEndDate}`
        );
        if (res.ok) {
          const sessions = await res.json();
          if (sessions.length > 0) {
            setSessionId(sessions[0].id);
          }
        }
      } catch (err) {
        console.error("Error fetching session:", err);
      }
    };

    // For now, we'll try to get the session from the period data
    // The session should have been created when user clicked "Start Reconciliation"
    // We need to query by supplier + period dates
    const findSession = async () => {
      try {
        // Get supplier periods to find the session ID
        const periodsRes = await fetch(
          `/api/reconciliation-v2/suppliers/${supplierId}/periods`
        );
        if (periodsRes.ok) {
          const periods = await periodsRes.json();
          const matchingPeriod = periods.find(
            (p: { periodKey: string }) => p.periodKey === periodKey
          );
          if (matchingPeriod?.existingSessionId) {
            setSessionId(matchingPeriod.existingSessionId);
          }
        }
      } catch (err) {
        console.error("Error finding session:", err);
      }
    };

    findSession();
  }, [supplierId, periodKey, periodStartDate, periodEndDate]);

  const updateStatus = useUpdateComparisonStatus();
  const addToQueue = useAddToReviewQueue();
  const approveFile = useApproveSessionFile();
  const rejectFile = useRejectSessionFile();

  const handleApprove = async (comparisonId: string) => {
    try {
      await updateStatus.mutateAsync({
        comparisonId,
        status: "manually_approved",
      });
      queryClient.invalidateQueries({
        queryKey: reconciliationV2Keys.sessionWithComparisons(sessionId || ""),
      });
      toast.success("השוואה אושרה");
    } catch (error) {
      toast.error("שגיאה באישור השוואה");
    }
  };

  const handleSendToReview = async (comparisonId: string) => {
    if (!sessionId) return;
    try {
      await addToQueue.mutateAsync({
        comparisonId,
        sessionId,
      });
      queryClient.invalidateQueries({
        queryKey: reconciliationV2Keys.sessionWithComparisons(sessionId),
      });
      toast.success("נוסף לתור בדיקה");
    } catch (error) {
      toast.error("שגיאה בהוספה לתור בדיקה");
    }
  };

  const handleApproveFile = async () => {
    if (!sessionId) return;
    try {
      await approveFile.mutateAsync(sessionId);
      queryClient.invalidateQueries({
        queryKey: reconciliationV2Keys.sessionWithComparisons(sessionId),
      });
      toast.success("קובץ אושר בהצלחה");
    } catch (error) {
      toast.error("שגיאה באישור הקובץ");
    }
  };

  const handleRejectFile = async (reason: string, sendEmail: boolean) => {
    if (!sessionId) return;
    try {
      await rejectFile.mutateAsync({
        sessionId,
        reason,
        sendEmail,
      });
      queryClient.invalidateQueries({
        queryKey: reconciliationV2Keys.sessionWithComparisons(sessionId),
      });
      toast.success("קובץ נדחה");
    } catch (error) {
      toast.error("שגיאה בדחיית הקובץ");
    }
  };

  if (!sessionId && !isLoading) {
    return (
      <div className="container max-w-6xl py-8">
        <div className="text-center py-12">
          <Loader2 className="h-8 w-8 mx-auto mb-4 animate-spin text-muted-foreground" />
          <p className="text-muted-foreground">טוען סשן התאמה...</p>
        </div>
      </div>
    );
  }

  if (sessionQuery.isLoading) {
    return (
      <div className="container max-w-6xl py-8">
        <div className="text-center py-12">
          <Loader2 className="h-8 w-8 mx-auto mb-4 animate-spin text-muted-foreground" />
          <p className="text-muted-foreground">טוען נתוני השוואה...</p>
        </div>
      </div>
    );
  }

  if (sessionQuery.error || !sessionQuery.data) {
    return (
      <div className="container max-w-6xl py-8">
        <div className="text-center py-12">
          <AlertTriangle className="h-8 w-8 mx-auto mb-4 text-destructive" />
          <p className="text-destructive">שגיאה בטעינת נתוני ההשוואה</p>
          <Link href="/admin/reconciliation-v2">
            <Button variant="outline" className="mt-4">
              חזרה לבחירת ספק
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  const { session, comparisons } = sessionQuery.data;
  const canApproveFile = session.needsReviewCount === 0 && session.toReviewQueueCount === 0;

  return (
    <div className="container max-w-6xl py-8 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/admin/reconciliation-v2">
            <Button variant="ghost" size="icon">
              <ArrowRight className="h-5 w-5" />
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Scale className="h-6 w-6 text-primary" />
              התאמת ספק: {session.supplierName}
            </h1>
            <p className="text-muted-foreground">
              {formatPeriodDate(session.periodStartDate)} - {formatPeriodDate(session.periodEndDate)}
            </p>
          </div>
        </div>
        <StatusBadge status={session.status} />
      </div>

      {/* Statistics Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="text-sm text-muted-foreground">סה״כ זכיינים</div>
            <div className="text-2xl font-bold">{session.totalFranchisees}</div>
          </CardContent>
        </Card>
        <Card className="bg-green-50 dark:bg-green-950/20">
          <CardContent className="p-4">
            <div className="text-sm text-green-600">מאושרים</div>
            <div className="text-2xl font-bold text-green-600">{session.approvedCount}</div>
          </CardContent>
        </Card>
        <Card className="bg-amber-50 dark:bg-amber-950/20">
          <CardContent className="p-4">
            <div className="text-sm text-amber-600">לבדיקה</div>
            <div className="text-2xl font-bold text-amber-600">{session.needsReviewCount}</div>
          </CardContent>
        </Card>
        <Card className="bg-blue-50 dark:bg-blue-950/20">
          <CardContent className="p-4">
            <div className="text-sm text-blue-600">בתור</div>
            <div className="text-2xl font-bold text-blue-600">{session.toReviewQueueCount}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-sm text-muted-foreground">סה״כ הפרש</div>
            <div className="text-2xl font-bold">
              {formatCurrency(session.totalDifference)}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Summary Card */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-lg">סיכום סכומים</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 gap-8 text-center">
            <div>
              <div className="text-sm text-muted-foreground mb-1">סכום ספק</div>
              <div className="text-xl font-bold">
                {formatCurrency(session.totalSupplierAmount)}
              </div>
            </div>
            <div>
              <div className="text-sm text-muted-foreground mb-1">סכום זכיינים</div>
              <div className="text-xl font-bold">
                {formatCurrency(session.totalFranchiseeAmount)}
              </div>
            </div>
            <div>
              <div className="text-sm text-muted-foreground mb-1">הפרש כולל</div>
              <div className="text-xl font-bold">
                {formatCurrency(session.totalDifference)}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Threshold Info */}
      <div className="flex items-center gap-2 p-3 bg-muted/50 rounded-lg text-sm">
        <Check className="h-4 w-4 text-green-600" />
        <span>
          הפרשים עד <strong>₪{RECONCILIATION_THRESHOLD}</strong> מאושרים אוטומטית
        </span>
      </div>

      {/* Comparisons Table */}
      <Card>
        <CardHeader>
          <CardTitle>השוואות</CardTitle>
          <CardDescription>
            רשימת כל ההשוואות בין סכומי הספק לסכומי הזכיינים
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ComparisonTable
            comparisons={comparisons}
            onApprove={handleApprove}
            onSendToReview={handleSendToReview}
            isUpdating={updateStatus.isPending || addToQueue.isPending}
          />
        </CardContent>
      </Card>

      {/* File Approval Section */}
      <Card>
        <CardHeader>
          <CardTitle>אישור/דחיית קובץ</CardTitle>
          <CardDescription>
            {canApproveFile
              ? "כל הפערים טופלו. ניתן לאשר את הקובץ."
              : "יש פערים שממתינים לטיפול. יש לאשר או לשלוח לבדיקה את כל הפריטים לפני אישור הקובץ."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <FileApprovalSection
            session={session}
            onApprove={handleApproveFile}
            onReject={handleRejectFile}
            isApproving={approveFile.isPending}
            isRejecting={rejectFile.isPending}
            canApprove={canApproveFile}
          />
        </CardContent>
      </Card>
    </div>
  );
}
