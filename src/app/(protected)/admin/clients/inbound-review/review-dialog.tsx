"use client";

/**
 * Review dialog — Layer 2b admin action surface for failed/needs_review
 * inbound rows. Lets the admin pick a franchisee + doc-type and either
 * confirm (creates client_document) or reject (marks resolved without
 * commit).
 *
 * Pre-populates the franchisee dropdown with the resolver's alternatives
 * (the candidates the matcher considered but couldn't pick confidently
 * enough), so the admin doesn't have to scroll the full franchisee list
 * for the common case.
 */

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ExternalLink } from "lucide-react";

interface FranchiseeOption {
  id: string;
  name: string;
  isActive: boolean;
}

interface ReviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entry: {
    id: string;
    emailSubject: string | null;
    fileUrl: string | null;
    fileName: string | null;
    proposedFranchiseeId: string | null;
    proposedDocumentType: string | null;
    franchiseeAlternatives:
      | Array<{ id: string; name: string; confidence: number }>
      | null;
    failureReason: string | null;
    /**
     * Distinguishes the two review modes:
     *   "failed"        – no document yet; confirm CREATES a client_document
     *   "needs_review"  – document already exists; confirm VERIFIES (or
     *                      updates franchisee/doc-type on an existing row)
     */
    status: "failed" | "needs_review";
    franchiseeConfidence: string | null;
  };
}

export function ReviewDialog({
  open,
  onOpenChange,
  entry,
}: ReviewDialogProps) {
  const queryClient = useQueryClient();
  const [franchiseeId, setFranchiseeId] = useState<string>("");
  const [documentType, setDocumentType] = useState<
    "client_report" | "commission_invoice"
  >("client_report");
  const [reviewNotes, setReviewNotes] = useState<string>("");

  // Reset state whenever the dialog opens for a different entry.
  useEffect(() => {
    if (!open) return;
    setFranchiseeId(entry.proposedFranchiseeId ?? "");
    setDocumentType(
      entry.proposedDocumentType === "commission_invoice"
        ? "commission_invoice"
        : "client_report",
    );
    setReviewNotes("");
  }, [open, entry.id, entry.proposedFranchiseeId, entry.proposedDocumentType]);

  const { data: franchiseesData } = useQuery<{
    franchisees: FranchiseeOption[];
  }>({
    queryKey: ["franchisees", "all"],
    queryFn: async () => {
      const res = await fetch("/api/franchisees");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
    enabled: open,
    staleTime: 5 * 60 * 1000,
  });

  // Build dropdown: alternatives first (with confidence), then all active
  // franchisees, dedup by id.
  const dropdownItems = useMemo(() => {
    const all = franchiseesData?.franchisees ?? [];
    const activeById = new Map<string, FranchiseeOption>();
    for (const f of all) if (f.isActive) activeById.set(f.id, f);
    const seen = new Set<string>();
    const out: Array<{ id: string; name: string; subtitle?: string }> = [];
    for (const alt of entry.franchiseeAlternatives ?? []) {
      if (seen.has(alt.id)) continue;
      seen.add(alt.id);
      const f = activeById.get(alt.id);
      out.push({
        id: alt.id,
        name: f?.name ?? alt.name,
        subtitle: `מועמד @${alt.confidence.toFixed(2)}`,
      });
    }
    for (const f of all) {
      if (!f.isActive || seen.has(f.id)) continue;
      seen.add(f.id);
      out.push({ id: f.id, name: f.name });
    }
    return out;
  }, [franchiseesData?.franchisees, entry.franchiseeAlternatives]);

  const confirmMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(
        `/api/admin/inbound-review/${entry.id}/confirm`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            franchiseeId,
            documentType,
            reviewNotes: reviewNotes || undefined,
          }),
        },
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      return body as { ok: true; clientDocumentId: string };
    },
    onSuccess: () => {
      toast.success("המסמך נוצר בהצלחה");
      queryClient.invalidateQueries({ queryKey: ["inbound-review"] });
      onOpenChange(false);
    },
    onError: (err: Error) => {
      toast.error(`כשל באישור: ${err.message}`);
    },
  });

  const rejectMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(
        `/api/admin/inbound-review/${entry.id}/reject`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            reviewNotes: reviewNotes || undefined,
          }),
        },
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      return body;
    },
    onSuccess: () => {
      toast.success("הרשומה נדחתה");
      queryClient.invalidateQueries({ queryKey: ["inbound-review"] });
      onOpenChange(false);
    },
    onError: (err: Error) => {
      toast.error(`כשל בדחייה: ${err.message}`);
    },
  });

  // Failed rows need a stored file for recovery; needs_review rows already
  // have a committed client_document so file presence isn't required.
  const requiresFile = entry.status === "failed";
  const canConfirm =
    !!franchiseeId &&
    (!requiresFile || !!entry.fileUrl) &&
    !confirmMutation.isPending &&
    !rejectMutation.isPending;
  const canReject =
    entry.status === "failed" &&
    !confirmMutation.isPending &&
    !rejectMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl" dir="rtl">
        <DialogHeader>
          <DialogTitle>
            {entry.status === "needs_review"
              ? "אימות שיוך אוטומטי"
              : "שחזור מייל נכשל"}
          </DialogTitle>
          <DialogDescription className="text-sm">
            {entry.emailSubject ?? "—"}
          </DialogDescription>
        </DialogHeader>

        {entry.status === "needs_review" && (
          <div className="rounded-md border border-yellow-200 bg-yellow-50 p-2 text-sm text-yellow-900">
            המסמך נוצר אוטומטית עם רמת ביטחון גבולית
            {entry.franchiseeConfidence
              ? ` (${parseFloat(entry.franchiseeConfidence).toFixed(2)})`
              : ""}
            . אם השיוך נכון — אשר. אחרת, בחר זכיין/סוג חלופי לפני האישור.
          </div>
        )}

        {entry.failureReason && entry.status === "failed" && (
          <div className="rounded-md border border-red-200 bg-red-50 p-2 text-sm text-red-800">
            <span className="font-medium">סיבת כשל:</span> {entry.failureReason}
          </div>
        )}

        <div className="space-y-3">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">קובץ מצורף</span>
            {entry.fileUrl ? (
              <a
                href={entry.fileUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-primary hover:underline"
              >
                {entry.fileName ?? "פתיחה בלשונית חדשה"}
                <ExternalLink className="h-3 w-3" />
              </a>
            ) : (
              <span className="text-red-700">אין קובץ — לא ניתן לאשר</span>
            )}
          </div>

          <div className="space-y-1">
            <Label htmlFor="franchisee" className="text-xs">
              זכיין
            </Label>
            <Select value={franchiseeId} onValueChange={setFranchiseeId} dir="rtl">
              <SelectTrigger id="franchisee">
                <SelectValue placeholder="בחר זכיין" />
              </SelectTrigger>
              <SelectContent className="max-h-[400px]">
                {dropdownItems.map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    <span>
                      {item.name}
                      {item.subtitle && (
                        <span className="ms-2 text-xs text-muted-foreground">
                          {item.subtitle}
                        </span>
                      )}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <Label className="text-xs">סוג מסמך</Label>
            <Select
              value={documentType}
              onValueChange={(v) =>
                setDocumentType(v as "client_report" | "commission_invoice")
              }
              dir="rtl"
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="client_report">
                  דוח (client_report)
                </SelectItem>
                <SelectItem value="commission_invoice">
                  חשבונית עמלה (commission_invoice)
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <Label htmlFor="reviewNotes" className="text-xs">
              הערות סקירה (אופציונלי)
            </Label>
            <Textarea
              id="reviewNotes"
              value={reviewNotes}
              onChange={(e) => setReviewNotes(e.target.value)}
              rows={2}
              dir="rtl"
              placeholder="למשל: 'מסמך וולט שהגיע לאיברה ולא זוהה — שיוך ידני לויני עזריאלי'"
            />
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={confirmMutation.isPending || rejectMutation.isPending}
          >
            ביטול
          </Button>
          {canReject && (
            <Button
              variant="destructive"
              onClick={() => rejectMutation.mutate()}
              disabled={rejectMutation.isPending || confirmMutation.isPending}
            >
              {rejectMutation.isPending ? "דוחה..." : "דחה"}
            </Button>
          )}
          <Button
            onClick={() => confirmMutation.mutate()}
            disabled={!canConfirm}
          >
            {confirmMutation.isPending
              ? "מאשר..."
              : entry.status === "needs_review"
                ? "אשר שיוך"
                : "אשר ויצור מסמך"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
