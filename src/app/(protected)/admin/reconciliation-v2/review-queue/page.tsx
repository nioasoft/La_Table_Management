"use client";

import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, ArrowRight, AlertCircle, Scale } from "lucide-react";
import { ReviewQueueTable } from "@/components/reconciliation-v2";
import { useReviewQueueItems, useResolveReviewQueueItem } from "@/queries/reconciliation-v2";
import { toast } from "sonner";

export default function ReviewQueuePage() {
  const { data: items, isLoading, error } = useReviewQueueItems();
  const resolveItem = useResolveReviewQueueItem();

  const handleResolve = async (queueItemId: string, notes?: string) => {
    try {
      await resolveItem.mutateAsync({ queueItemId, notes });
      toast.success("פריט נפתר בהצלחה");
    } catch (error) {
      toast.error("שגיאה בפתרון פריט");
    }
  };

  return (
    <div className="container max-w-6xl py-8 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link href="/admin/reconciliation-v2">
          <Button variant="ghost" size="icon">
            <ArrowRight className="h-5 w-5" />
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <AlertCircle className="h-6 w-6 text-amber-500" />
            תור בדיקת פערים
          </h1>
          <p className="text-muted-foreground">
            פריטים שנשלחו לבדיקה ידנית מסשנים שונים
          </p>
        </div>
      </div>

      {/* Queue Table Card */}
      <Card>
        <CardHeader>
          <CardTitle>פריטים ממתינים</CardTitle>
          <CardDescription>
            רשימת כל הפריטים שממתינים לבדיקה ופתרון
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-center py-12">
              <Loader2 className="h-8 w-8 mx-auto mb-4 animate-spin text-muted-foreground" />
              <p className="text-muted-foreground">טוען תור בדיקה...</p>
            </div>
          ) : error ? (
            <div className="text-center py-12 text-destructive">
              שגיאה בטעינת תור הבדיקה
            </div>
          ) : (
            <ReviewQueueTable
              items={items || []}
              onResolve={handleResolve}
              isResolving={resolveItem.isPending}
            />
          )}
        </CardContent>
      </Card>

      {/* Help Card */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">איך לפתור פערים?</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>
            פריטים בתור הבדיקה הם הפרשים שהיו גדולים מ-₪30 ונשלחו לבדיקה ידנית.
          </p>
          <p>
            <strong>לפני פתרון פריט:</strong>
          </p>
          <ul className="list-disc list-inside space-y-1 ps-4">
            <li>בדוק את הסכומים בקובץ הספק המקורי</li>
            <li>בדוק את קובץ ה-BKMVDATA של הזכיין</li>
            <li>ודא שאין טעויות בשמות או בסכומים</li>
            <li>הוסף הערה מפורטת לתיעוד</li>
          </ul>
          <p>
            לאחר פתרון, הפריט יועבר לסטטוס &quot;מאושר ידנית&quot; והסשן יתעדכן בהתאם.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
