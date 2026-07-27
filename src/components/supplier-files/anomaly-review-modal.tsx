"use client";

import { useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AlertCircle,
  AlertTriangle,
  Info,
  ChevronDown,
  ChevronLeft,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import type {
  Anomaly,
  AnomalyAction,
  AnomalySeverity,
} from "@/types/file-anomalies";

interface AnomalyReviewModalProps {
  open: boolean;
  /**
   * The anomalies to display. Acknowledged anomalies are shown with a
   * checkmark; unacknowledged warnings/blocking are highlighted.
   */
  anomalies: Anomaly[];
  /**
   * Optional id of the supplier_file_upload row this review concerns. When
   * present, action handlers can persist acknowledgement state to the DB.
   */
  fileId?: string | null;
  /**
   * Called when the admin confirms the review (only enabled when there are
   * no blocking anomalies and every warning has been acknowledged).
   * Receives the (possibly updated) anomaly list so callers can persist.
   */
  onConfirm: (anomalies: Anomaly[]) => void | Promise<void>;
  /** Called when the admin cancels (closes / rejects the file). */
  onCancel: () => void;
  /**
   * If present, the modal will call this to refresh state after a 1-click
   * action that mutates the underlying file (e.g., update_franchisee_company_id
   * → re-run match → fresh anomaly list). The handler should perform the
   * mutation and return the new anomaly list, or null if no refresh occurred.
   */
  onAfterAction?: (
    anomaly: Anomaly,
    action: AnomalyAction
  ) => Promise<Anomaly[] | null>;
}

const SEVERITY_LABEL: Record<AnomalySeverity, string> = {
  blocking: "חוסם",
  warning: "אזהרה",
  info: "מידע",
};

const SEVERITY_BADGE_CLASS: Record<AnomalySeverity, string> = {
  blocking: "bg-red-100 text-red-800 border-red-300",
  warning: "bg-amber-100 text-amber-800 border-amber-300",
  info: "bg-blue-100 text-blue-800 border-blue-300",
};

const SEVERITY_ICON: Record<AnomalySeverity, typeof AlertCircle> = {
  blocking: AlertCircle,
  warning: AlertTriangle,
  info: Info,
};

const SEVERITY_ORDER: Record<AnomalySeverity, number> = {
  blocking: 0,
  warning: 1,
  info: 2,
};

export function AnomalyReviewModal({
  open,
  anomalies: initialAnomalies,
  fileId: _fileId,
  onConfirm,
  onCancel,
  onAfterAction,
}: AnomalyReviewModalProps) {
  const [anomalies, setAnomalies] = useState<Anomaly[]>(initialAnomalies);
  const [busyAnomalyIndex, setBusyAnomalyIndex] = useState<number | null>(null);
  const [isConfirming, setIsConfirming] = useState(false);
  const [expandedIndices, setExpandedIndices] = useState<Set<number>>(
    new Set()
  );

  // When the parent passes a different anomaly array (re-open / refresh),
  // sync our local state. Important after onAfterAction returns a new list.
  // Must NOT be a useMemo: React may discard a memo cache and re-run it,
  // which would wipe the acknowledgements the admin just clicked.
  const [syncedFrom, setSyncedFrom] = useState(initialAnomalies);
  if (syncedFrom !== initialAnomalies) {
    setSyncedFrom(initialAnomalies);
    setAnomalies(initialAnomalies);
    setExpandedIndices(new Set());
  }

  const sorted = useMemo(() => {
    return [...anomalies]
      .map((a, i) => ({ a, i }))
      .sort((x, y) => SEVERITY_ORDER[x.a.severity] - SEVERITY_ORDER[y.a.severity]);
  }, [anomalies]);

  const blockingCount = anomalies.filter(
    (a) => a.severity === "blocking"
  ).length;
  const unacknowledgedWarnings = anomalies.filter(
    (a) => a.severity === "warning" && !a.acknowledged
  ).length;

  const canConfirm =
    blockingCount === 0 && unacknowledgedWarnings === 0 && !isConfirming;

  const toggleExpand = (i: number): void => {
    setExpandedIndices((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  };

  const handleAcknowledge = (index: number): void => {
    setAnomalies((prev) =>
      prev.map((a, i) =>
        i === index
          ? {
              ...a,
              acknowledged: true,
              acknowledgedAt: new Date().toISOString(),
            }
          : a
      )
    );
  };

  const handleAction = async (
    anomaly: Anomaly,
    action: AnomalyAction,
    index: number
  ): Promise<void> => {
    if (action.type === "acknowledge_only") {
      handleAcknowledge(index);
      return;
    }
    if (action.type === "reject_file") {
      onCancel();
      return;
    }
    if (action.type === "manual_match_required") {
      // The page-level UI handles manual matching outside this modal; close
      // and let the user use the existing per-row match controls.
      handleAcknowledge(index);
      toast.info("ניתן להתאים ידנית בטבלה אחרי הסגירה");
      return;
    }
    if (action.type === "update_franchisee_company_id" && onAfterAction) {
      setBusyAnomalyIndex(index);
      try {
        const fresh = await onAfterAction(anomaly, action);
        if (fresh) setAnomalies(fresh);
        else handleAcknowledge(index);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "שגיאה לא ידועה";
        toast.error(`עדכון ה-ח.פ. נכשל: ${msg}`);
      } finally {
        setBusyAnomalyIndex(null);
      }
    }
  };

  const handleConfirm = async (): Promise<void> => {
    setIsConfirming(true);
    try {
      await onConfirm(anomalies);
    } finally {
      setIsConfirming(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent
        dir="rtl"
        className="max-w-3xl max-h-[85vh] overflow-y-auto"
      >
        <DialogHeader>
          <DialogTitle>התראות לבדיקה לפני שמירה</DialogTitle>
          <DialogDescription>
            לפני ששומרים את הקובץ — נמצאו {anomalies.length} התראות שדורשות התייחסות.
            {blockingCount > 0 && (
              <>
                {" "}<span className="font-semibold text-red-700">
                  {blockingCount} חוסמות שמירה.
                </span>
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {sorted.length === 0 && (
            <p className="text-sm text-muted-foreground py-6 text-center">
              אין התראות.
            </p>
          )}

          {sorted.map(({ a, i }) => {
            const Icon = SEVERITY_ICON[a.severity];
            const expanded = expandedIndices.has(i);
            const isBusy = busyAnomalyIndex === i;
            return (
              <div
                key={`${a.code}-${i}`}
                className={cn(
                  "border rounded-lg p-4 space-y-3 transition-colors",
                  a.severity === "blocking" && "border-red-300 bg-red-50",
                  a.severity === "warning" && !a.acknowledged && "border-amber-300 bg-amber-50",
                  a.severity === "warning" && a.acknowledged && "border-emerald-300 bg-emerald-50/40",
                  a.severity === "info" && "border-blue-200 bg-blue-50/50"
                )}
              >
                <div className="flex items-start gap-3">
                  <Icon
                    className={cn(
                      "h-5 w-5 mt-0.5 flex-shrink-0",
                      a.severity === "blocking" && "text-red-600",
                      a.severity === "warning" && "text-amber-600",
                      a.severity === "info" && "text-blue-600"
                    )}
                  />
                  <div className="flex-1 min-w-0 space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge
                        variant="outline"
                        className={cn(
                          "text-xs border",
                          SEVERITY_BADGE_CLASS[a.severity]
                        )}
                      >
                        {SEVERITY_LABEL[a.severity]}
                      </Badge>
                      <code className="text-[10px] font-mono text-muted-foreground">
                        {a.code}
                      </code>
                      {a.acknowledged && (
                        <Badge
                          variant="outline"
                          className="text-xs bg-emerald-100 text-emerald-700 border-emerald-300"
                        >
                          אושר
                        </Badge>
                      )}
                    </div>
                    <p className="text-sm font-medium leading-relaxed">
                      {a.messageHe}
                    </p>
                    {a.affectedRowNumbers &&
                      a.affectedRowNumbers.length > 0 && (
                        <p className="text-xs text-muted-foreground">
                          שורות בקובץ: {a.affectedRowNumbers.slice(0, 6).join(", ")}
                          {a.affectedRowNumbers.length > 6 && "…"}
                        </p>
                      )}
                  </div>
                </div>

                {a.details && (
                  <button
                    type="button"
                    onClick={() => toggleExpand(i)}
                    className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
                  >
                    {expanded ? (
                      <ChevronDown className="h-3 w-3" />
                    ) : (
                      <ChevronLeft className="h-3 w-3" />
                    )}
                    {expanded ? "הסתר פרטים" : "הצג פרטים נוספים"}
                  </button>
                )}

                {expanded && a.details && <AnomalyDetails details={a.details} />}

                {a.suggestedActions && a.suggestedActions.length > 0 && (
                  <div className="flex flex-wrap gap-2 pt-1">
                    {a.suggestedActions.map((action, ai) => (
                      <Button
                        key={ai}
                        type="button"
                        size="sm"
                        variant={
                          action.type === "reject_file"
                            ? "destructive"
                            : action.type === "acknowledge_only" && a.acknowledged
                              ? "outline"
                              : "default"
                        }
                        disabled={isBusy || (a.acknowledged && action.type === "acknowledge_only")}
                        onClick={() => handleAction(a, action, i)}
                      >
                        {isBusy && action.type === "update_franchisee_company_id" && (
                          <Loader2 className="h-4 w-4 animate-spin ms-2" />
                        )}
                        {action.labelHe}
                      </Button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <DialogFooter className="gap-2 sm:gap-2 pt-4 items-center">
          {/* Spelled out, not just a title tooltip — admins hit the grey
              button and had no idea what was blocking it. */}
          {!canConfirm && !isConfirming && (
            <p className="me-auto text-xs font-medium text-amber-700">
              {blockingCount > 0
                ? `יש לפתור ${blockingCount} התראות חוסמות לפני שמירה`
                : `כדי להמשיך — לחצי על כפתור האישור בתוך כל אזהרה (${unacknowledgedWarnings} ממתינות)`}
            </p>
          )}
          <Button
            type="button"
            variant="ghost"
            onClick={onCancel}
            disabled={isConfirming}
          >
            ביטול
          </Button>
          <Button
            type="button"
            onClick={handleConfirm}
            disabled={!canConfirm}
            title={
              blockingCount > 0
                ? "יש לפתור את ההתראות החוסמות לפני שמירה"
                : unacknowledgedWarnings > 0
                  ? `יש לאשר את כל האזהרות (${unacknowledgedWarnings} לא אושרו)`
                  : undefined
            }
          >
            {isConfirming && <Loader2 className="h-4 w-4 animate-spin ms-2" />}
            הבנתי — שמור לבדיקה ידנית
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface AnomalyDetailsProps {
  details: Record<string, unknown>;
}

function AnomalyDetails({ details }: AnomalyDetailsProps) {
  // Pretty-print known fields; fallback to raw JSON for the rest.
  const explanation = typeof details.explanationHe === "string"
    ? details.explanationHe
    : null;
  const breakdown = Array.isArray(details.breakdown)
    ? (details.breakdown as Array<{ label: string; count: number; amount: number }>)
    : null;
  const suggestions = Array.isArray(details.suggestions)
    ? (details.suggestions as Array<{
        id: string;
        name: string;
        companyId: string | null;
        score: number;
      }>)
    : null;

  return (
    <div className="text-xs space-y-2 bg-white/60 rounded p-3 border border-current/10">
      {explanation && (
        <p className="leading-relaxed text-muted-foreground">{explanation}</p>
      )}

      {breakdown && breakdown.length > 0 && (
        <div>
          <p className="font-medium mb-1">פירוט לפי סוג מסמך:</p>
          <ul className="space-y-1">
            {breakdown.map((b, i) => (
              <li key={i} className="flex justify-between gap-3">
                <span>{b.label}</span>
                <span className="text-muted-foreground tabular-nums">
                  {b.count} שורות / ₪{b.amount.toLocaleString("he-IL")}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {suggestions && suggestions.length > 0 && (
        <div>
          <p className="font-medium mb-1">הצעות התאמה לפי שם:</p>
          <ul className="space-y-1">
            {suggestions.map((s) => (
              <li key={s.id} className="flex justify-between gap-3">
                <span className="truncate">{s.name}</span>
                <span className="text-muted-foreground tabular-nums">
                  ח.פ. {s.companyId ?? "-"} · {Math.round(s.score * 100)}%
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
