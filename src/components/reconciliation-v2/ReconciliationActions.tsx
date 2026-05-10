"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { CheckCheck, Download, Mail, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import {
  useMatchAllSession,
  useDeleteReconciliationSession,
  useCreateReconciliationSession,
} from "@/queries/reconciliation-v2";
import { EmailComposerDialog } from "./EmailComposerDialog";
import type { ReconciliationComparisonWithDetails } from "@/types/reconciliation-v2";

const RECONCILIATION_THRESHOLD = 30;

interface ReconciliationActionsProps {
  sessionId: string;
  supplierId: string;
  supplierName: string;
  supplierFileId: string | null;
  /** Needed to recreate the session when admin chooses "delete and restart". */
  periodStartDate: string;
  periodEndDate: string;
  comparisons: ReconciliationComparisonWithDetails[];
  isArchived: boolean;
}

/**
 * Action toolbar shown above the comparison table:
 * - Match-All ≤ ₪30 (clones session into a new run)
 * - Download supplier file
 * - Compose free-form email to supplier
 *
 * All three are admin-only and disabled when viewing an archived run.
 */
export function ReconciliationActions({
  sessionId,
  supplierId,
  supplierName,
  supplierFileId,
  periodStartDate,
  periodEndDate,
  comparisons,
  isArchived,
}: ReconciliationActionsProps) {
  const router = useRouter();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [emailOpen, setEmailOpen] = useState(false);
  const [restartOpen, setRestartOpen] = useState(false);

  const matchAll = useMatchAllSession();
  const deleteSession = useDeleteReconciliationSession();
  const createSession = useCreateReconciliationSession();
  const isRestartPending = deleteSession.isPending || createSession.isPending;

  const eligibleCount = comparisons.filter(
    (c) =>
      c.status === "needs_review" &&
      c.absoluteDifference !== null &&
      Number(c.absoluteDifference) <= RECONCILIATION_THRESHOLD
  ).length;

  const handleMatchAll = async () => {
    try {
      const result = await matchAll.mutateAsync(sessionId);
      toast.success(
        `${result.matchedCount} שורות הותאמו אוטומטית. סשן קודם נארכב.`
      );
      setConfirmOpen(false);
      // Navigate to the new run so the user sees the post-match state.
      const params = new URLSearchParams(window.location.search);
      params.set("sessionId", result.newSessionId);
      router.replace(`${window.location.pathname}?${params.toString()}`);
      router.refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : "שגיאה בביצוע התאם הכל";
      toast.error(message);
    }
  };

  const downloadHref = supplierFileId
    ? `/api/reports/files/${supplierFileId}/download?source=supplier`
    : null;

  const handleRestart = async () => {
    if (!supplierFileId) {
      toast.error("חסר קובץ ספק לסשן זה — לא ניתן לאתחל מחדש");
      return;
    }
    try {
      await deleteSession.mutateAsync(sessionId);
      const newSession = await createSession.mutateAsync({
        supplierId,
        supplierFileId,
        supplierFileIds: [supplierFileId],
        periodStartDate,
        periodEndDate,
      });
      toast.success("סשן חדש נוצר");
      setRestartOpen(false);
      // Replace the URL so the page re-mounts on the new session id.
      const params = new URLSearchParams(window.location.search);
      params.set("sessionId", newSession.id);
      router.replace(`${window.location.pathname}?${params.toString()}`);
      router.refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : "שגיאה באיתחול הסשן";
      toast.error(message);
    }
  };

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/20 p-3">
        <Button
          variant="default"
          size="sm"
          onClick={() => setConfirmOpen(true)}
          disabled={isArchived || eligibleCount === 0 || matchAll.isPending}
        >
          {matchAll.isPending ? (
            <Loader2 className="ms-2 h-4 w-4 animate-spin" />
          ) : (
            <CheckCheck className="ms-2 h-4 w-4" />
          )}
          התאם הכל ≤ ₪{RECONCILIATION_THRESHOLD}
          {eligibleCount > 0 && (
            <Badge variant="secondary" className="ms-2">
              {eligibleCount}
            </Badge>
          )}
        </Button>

        <Button variant="outline" size="sm" asChild disabled={!downloadHref}>
          {downloadHref ? (
            <a href={downloadHref} target="_blank" rel="noopener noreferrer">
              <Download className="ms-2 h-4 w-4" />
              הורד קובץ ספק
            </a>
          ) : (
            <span>
              <Download className="ms-2 h-4 w-4" />
              הורד קובץ ספק
            </span>
          )}
        </Button>

        <Button
          variant="outline"
          size="sm"
          onClick={() => setEmailOpen(true)}
          disabled={isArchived}
        >
          <Mail className="ms-2 h-4 w-4" />
          שלח מייל לספק
        </Button>

        <Button
          variant="outline"
          size="sm"
          onClick={() => setRestartOpen(true)}
          disabled={isArchived || isRestartPending || !supplierFileId}
          className="text-destructive hover:text-destructive"
        >
          {isRestartPending ? (
            <Loader2 className="ms-2 h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="ms-2 h-4 w-4" />
          )}
          התחל סשן חדש
        </Button>

        {isArchived && (
          <span className="text-xs text-muted-foreground">
            הסשן הנוכחי מאורכב — פעולות זמינות רק בסשן הפעיל.
          </span>
        )}
      </div>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>אישור התאם הכל</AlertDialogTitle>
            <AlertDialogDescription>
              {eligibleCount > 0 ? (
                <>
                  הפעולה תאשר {eligibleCount} שורות בסטטוס &quot;לבדיקה&quot; שהפרשן{" "}
                  ≤ ₪{RECONCILIATION_THRESHOLD}, ותיצור סשן חדש (Run חדש). הסשן הנוכחי יישמר
                  כארכיון לצרכי תיעוד.
                </>
              ) : (
                "אין שורות לבדיקה תחת הסף — אין מה להתאים."
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={matchAll.isPending}>ביטול</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                handleMatchAll();
              }}
              disabled={matchAll.isPending || eligibleCount === 0}
            >
              {matchAll.isPending ? (
                <Loader2 className="ms-2 h-4 w-4 animate-spin" />
              ) : null}
              אישור והרץ
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={restartOpen} onOpenChange={setRestartOpen}>
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>התחלת סשן חדש</AlertDialogTitle>
            <AlertDialogDescription>
              הסשן הנוכחי יימחק לצמיתות, כולל כל ההערות, הסטטוסים הידניים ופריטי
              תור הבדיקה. סשן חדש ייווצר בהרצה נקייה על אותו קובץ ספק ותקופה.
              להמשיך?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isRestartPending}>ביטול</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                handleRestart();
              }}
              disabled={isRestartPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isRestartPending ? (
                <Loader2 className="ms-2 h-4 w-4 animate-spin" />
              ) : null}
              מחק והתחל מחדש
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <EmailComposerDialog
        open={emailOpen}
        onOpenChange={setEmailOpen}
        sessionId={sessionId}
        supplierId={supplierId}
        supplierName={supplierName}
      />
    </>
  );
}
