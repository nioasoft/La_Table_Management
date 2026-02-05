"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Loader2, Scale, ArrowLeft, History, AlertCircle, Trash2, RefreshCw, List } from "lucide-react";
import { SupplierSelector, PeriodSelector } from "@/components/reconciliation-v2";
import { useCreateReconciliationSession, useReviewQueueCount, useDeleteReconciliationSession } from "@/queries/reconciliation-v2";
import { Badge } from "@/components/ui/badge";
import Link from "next/link";
import { toast } from "sonner";

export default function ReconciliationV2Page() {
  const router = useRouter();
  const [supplierId, setSupplierId] = useState<string | null>(null);
  const [periodKey, setPeriodKey] = useState<string | null>(null);
  const [periodData, setPeriodData] = useState<{
    periodStartDate: string;
    periodEndDate: string;
    supplierFileId: string;
    hasExistingSession: boolean;
    existingSessionId: string | null;
  } | null>(null);

  const createSession = useCreateReconciliationSession();
  const deleteSession = useDeleteReconciliationSession();
  const { data: reviewQueueCount } = useReviewQueueCount();

  const handlePeriodChange = (
    key: string,
    data: {
      periodStartDate: string;
      periodEndDate: string;
      supplierFileId: string;
      hasExistingSession: boolean;
      existingSessionId: string | null;
    }
  ) => {
    setPeriodKey(key);
    setPeriodData(data);
  };

  const handleStartReconciliation = async () => {
    if (!supplierId || !periodData) return;

    // If session exists, navigate to it
    if (periodData.hasExistingSession && periodData.existingSessionId) {
      router.push(`/admin/reconciliation-v2/${supplierId}/${periodKey}`);
      return;
    }

    // Create new session
    try {
      const session = await createSession.mutateAsync({
        supplierId,
        supplierFileId: periodData.supplierFileId,
        periodStartDate: periodData.periodStartDate,
        periodEndDate: periodData.periodEndDate,
      });

      toast.success("סשן התאמה נוצר בהצלחה");
      router.push(`/admin/reconciliation-v2/${supplierId}/${periodKey}`);
    } catch (error) {
      console.error("Failed to create session:", error);
      toast.error(error instanceof Error ? error.message : "שגיאה ביצירת סשן התאמה");
    }
  };

  const handleDeleteAndRestart = async () => {
    if (!supplierId || !periodData?.existingSessionId) return;

    try {
      // Delete the existing session
      await deleteSession.mutateAsync(periodData.existingSessionId);
      toast.success("הסשן הקיים נמחק");

      // Create new session
      const session = await createSession.mutateAsync({
        supplierId,
        supplierFileId: periodData.supplierFileId,
        periodStartDate: periodData.periodStartDate,
        periodEndDate: periodData.periodEndDate,
      });

      toast.success("סשן התאמה חדש נוצר בהצלחה");
      router.push(`/admin/reconciliation-v2/${supplierId}/${periodKey}`);
    } catch (error) {
      console.error("Failed to delete and restart session:", error);
      toast.error(error instanceof Error ? error.message : "שגיאה באיפוס הסשן");
    }
  };

  return (
    <div className="container max-w-4xl py-8 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Scale className="h-8 w-8 text-primary" />
          <div>
            <h1 className="text-2xl font-bold">התאמות ספקים</h1>
            <p className="text-muted-foreground">
              השוואה בין קבצי ספקים לקבצי BKMVDATA של זכיינים
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/admin/reconciliation-v2/sessions">
            <Button variant="outline">
              <List className="h-4 w-4 me-2" />
              סשנים פעילים
            </Button>
          </Link>
          <Link href="/admin/reconciliation-v2/review-queue">
            <Button variant="outline" className="relative">
              <AlertCircle className="h-4 w-4 me-2" />
              תור בדיקה
              {(reviewQueueCount ?? 0) > 0 && (
                <Badge variant="destructive" className="absolute -top-2 -start-2 h-5 min-w-5 px-1.5">
                  {reviewQueueCount}
                </Badge>
              )}
            </Button>
          </Link>
          <Link href="/admin/reconciliation-v2/history">
            <Button variant="outline">
              <History className="h-4 w-4 me-2" />
              היסטוריה
            </Button>
          </Link>
        </div>
      </div>

      {/* Selection Card */}
      <Card>
        <CardHeader>
          <CardTitle>בחירת ספק ותקופה</CardTitle>
          <CardDescription>
            בחר ספק ותקופה להשוואה. ניתן לבחור רק תקופות שיש להן קבצים מעובדים.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Supplier Selection */}
          <div className="space-y-2">
            <Label>ספק</Label>
            <SupplierSelector
              value={supplierId}
              onValueChange={(value) => {
                setSupplierId(value);
                setPeriodKey(null);
                setPeriodData(null);
              }}
            />
          </div>

          {/* Period Selection */}
          <div className="space-y-2">
            <Label>תקופה</Label>
            <PeriodSelector
              supplierId={supplierId}
              value={periodKey}
              onValueChange={handlePeriodChange}
            />
          </div>

          {/* Existing Session Warning */}
          {periodData?.hasExistingSession && (
            <div className="flex items-center gap-2 p-3 bg-amber-50 dark:bg-amber-950/20 rounded-lg text-amber-800 dark:text-amber-200">
              <AlertCircle className="h-5 w-5 shrink-0" />
              <span>קיים כבר סשן התאמה לתקופה זו. ניתן להמשיך לעבוד עליו או למחוק ולהתחיל מחדש.</span>
            </div>
          )}

          {/* Buttons */}
          <div className="flex gap-3">
            {/* Start/Continue Button */}
            <Button
              onClick={handleStartReconciliation}
              disabled={!supplierId || !periodData || createSession.isPending || deleteSession.isPending}
              className="flex-1"
              size="lg"
            >
              {createSession.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 me-2 animate-spin" />
                  יוצר סשן...
                </>
              ) : periodData?.hasExistingSession ? (
                <>
                  <ArrowLeft className="h-4 w-4 me-2" />
                  המשך עבודה על סשן קיים
                </>
              ) : (
                <>
                  <Scale className="h-4 w-4 me-2" />
                  התחל התאמה
                </>
              )}
            </Button>

            {/* Delete and Restart Button (only shows when session exists) */}
            {periodData?.hasExistingSession && (
              <Button
                onClick={handleDeleteAndRestart}
                disabled={!supplierId || !periodData || createSession.isPending || deleteSession.isPending}
                variant="outline"
                size="lg"
                className="text-destructive hover:text-destructive"
              >
                {deleteSession.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 me-2 animate-spin" />
                    מוחק...
                  </>
                ) : (
                  <>
                    <RefreshCw className="h-4 w-4 me-2" />
                    מחק והתחל מחדש
                  </>
                )}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Info Card */}
      <Card>
        <CardHeader>
          <CardTitle>איך זה עובד?</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm text-muted-foreground">
          <div className="flex items-start gap-3">
            <div className="flex items-center justify-center h-6 w-6 rounded-full bg-primary/10 text-primary font-medium text-xs">
              1
            </div>
            <div>
              <strong className="text-foreground">בחירת ספק ותקופה</strong>
              <p>בחר ספק שיש לו קבצים מעובדים ותקופה להשוואה</p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <div className="flex items-center justify-center h-6 w-6 rounded-full bg-primary/10 text-primary font-medium text-xs">
              2
            </div>
            <div>
              <strong className="text-foreground">השוואת סכומים</strong>
              <p>המערכת משווה את סכומי הספק לסכומים מקבצי BKMVDATA של הזכיינים</p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <div className="flex items-center justify-center h-6 w-6 rounded-full bg-primary/10 text-primary font-medium text-xs">
              3
            </div>
            <div>
              <strong className="text-foreground">סף ₪30</strong>
              <p>הפרשים עד ₪30 מאושרים אוטומטית. הפרשים גדולים יותר דורשים אישור ידני</p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <div className="flex items-center justify-center h-6 w-6 rounded-full bg-primary/10 text-primary font-medium text-xs">
              4
            </div>
            <div>
              <strong className="text-foreground">אישור או דחיית הקובץ</strong>
              <p>לאחר בדיקת כל הפערים, ניתן לאשר או לדחות את קובץ הספק</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
