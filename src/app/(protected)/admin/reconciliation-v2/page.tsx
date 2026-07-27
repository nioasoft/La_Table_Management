"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Loader2, Scale, History, AlertCircle, List } from "lucide-react";
import { SupplierSelector, PeriodSelector } from "@/components/reconciliation-v2";
import { useCreateReconciliationSession, useReviewQueueCount, reconciliationV2Keys } from "@/queries/reconciliation-v2";
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
    supplierFileIds: string[];
    hasExistingSession: boolean;
    existingSessionId: string | null;
  } | null>(null);

  const queryClient = useQueryClient();
  const createSession = useCreateReconciliationSession();
  const { data: reviewQueueCount } = useReviewQueueCount();

  const handlePeriodChange = (
    key: string,
    data: {
      periodStartDate: string;
      periodEndDate: string;
      supplierFileId: string;
      supplierFileIds: string[];
      hasExistingSession: boolean;
      existingSessionId: string | null;
    }
  ) => {
    setPeriodKey(key);
    setPeriodData(data);
  };

  // Auto-navigate to an existing session as soon as it's known.
  // The user already chose the supplier+period; making them click "המשך"
  // is a wasted click. Restart-with-new-session lives inside the session view.
  useEffect(() => {
    if (
      supplierId &&
      periodKey &&
      periodData?.hasExistingSession &&
      periodData.existingSessionId
    ) {
      router.push(`/admin/reconciliation-v2/${supplierId}/${periodKey}`);
    }
  }, [supplierId, periodKey, periodData?.hasExistingSession, periodData?.existingSessionId, router]);

  const handleStartReconciliation = async () => {
    if (!supplierId || !periodData) return;
    if (periodData.hasExistingSession) return; // useEffect above handles redirect

    try {
      const session = await createSession.mutateAsync({
        supplierId,
        supplierFileId: periodData.supplierFileId,
        supplierFileIds: periodData.supplierFileIds,
        periodStartDate: periodData.periodStartDate,
        periodEndDate: periodData.periodEndDate,
      });

      toast.success("סשן התאמה נוצר בהצלחה");
      if (session?.brandMappingMissing) {
        toast.warning(
          "לספק לא מוגדרים מותגים — יופיעו רק סניפים שמופיעים בקובץ הספק. סניפים ללא פעילות לא ייווצרו כשורות 0. הגדר מותגים בכרטיס הספק ובנה מחדש.",
          { duration: 12000 }
        );
      }
      router.push(`/admin/reconciliation-v2/${supplierId}/${periodKey}`);
    } catch (error) {
      console.error("Failed to create session:", error);
      toast.error(error instanceof Error ? error.message : "שגיאה ביצירת סשן התאמה");
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
                // Force fresh fetch of periods (including session existence)
                queryClient.invalidateQueries({
                  queryKey: reconciliationV2Keys.supplierPeriods(value),
                });
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

          {/* Existing-session note: redirect happens automatically via useEffect.
              Show a brief loader so the page doesn't look frozen during the push. */}
          {periodData?.hasExistingSession && (
            <div className="flex items-center gap-2 p-3 bg-muted/50 rounded-lg text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
              <span>סשן קיים נמצא — מעביר אותך אליו...</span>
            </div>
          )}

          {/* Start button — only shown when no session exists yet */}
          {!periodData?.hasExistingSession && (
            <Button
              onClick={handleStartReconciliation}
              disabled={!supplierId || !periodData || createSession.isPending}
              className="w-full"
              size="lg"
            >
              {createSession.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 me-2 animate-spin" />
                  יוצר סשן...
                </>
              ) : (
                <>
                  <Scale className="h-4 w-4 me-2" />
                  התחל התאמה
                </>
              )}
            </Button>
          )}
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
