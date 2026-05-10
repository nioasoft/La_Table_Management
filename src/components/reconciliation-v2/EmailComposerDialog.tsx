"use client";

import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Send, X } from "lucide-react";
import { EmailEditor } from "@/components/editor/EmailEditor";
import { toast } from "sonner";
import { useSendSupplierEmail } from "@/queries/reconciliation-v2";
import { fetchWithTimeout } from "@/lib/fetch-with-timeout";

interface EmailComposerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sessionId: string;
  supplierId: string;
  supplierName: string;
}

interface SupplierContact {
  contactName: string | null;
  contactEmail: string | null;
  secondaryContactEmail: string | null;
}

export function EmailComposerDialog({
  open,
  onOpenChange,
  sessionId,
  supplierId,
  supplierName,
}: EmailComposerDialogProps) {
  const [contact, setContact] = useState<SupplierContact | null>(null);
  const [loadingContact, setLoadingContact] = useState(false);
  const [to, setTo] = useState("");
  const [subject, setSubject] = useState("");
  const [bodyHtml, setBodyHtml] = useState("");

  const sendEmail = useSendSupplierEmail(sessionId);

  // Load supplier contact when the dialog opens.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoadingContact(true);
    (async () => {
      try {
        const res = await fetchWithTimeout(`/api/suppliers/${supplierId}`);
        if (!res.ok) throw new Error("failed to fetch supplier");
        const payload = await res.json();
        if (cancelled) return;
        // GET /api/suppliers/[id] wraps the supplier under `supplier`. Older shapes
        // are also tolerated so we don't break if the endpoint normalizes later.
        const supplierData = payload?.supplier ?? payload ?? {};
        const primaryEmail: string =
          supplierData.contactEmail ?? supplierData.secondaryContactEmail ?? "";
        setContact({
          contactName: supplierData.contactName ?? null,
          contactEmail: supplierData.contactEmail ?? null,
          secondaryContactEmail: supplierData.secondaryContactEmail ?? null,
        });
        if (primaryEmail) setTo(primaryEmail);
      } catch (err) {
        console.error("[EmailComposerDialog] supplier fetch failed:", err);
        if (!cancelled) setContact({ contactName: null, contactEmail: null, secondaryContactEmail: null });
      } finally {
        if (!cancelled) setLoadingContact(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, supplierId]);

  // Reset on close so a stale draft doesn't show next time.
  useEffect(() => {
    if (!open) {
      setSubject("");
      setBodyHtml("");
      setTo("");
      setContact(null);
    }
  }, [open]);

  const handleSend = async () => {
    if (!to || !subject.trim() || !bodyHtml.trim()) {
      toast.error("יש למלא את כל השדות");
      return;
    }
    try {
      await sendEmail.mutateAsync({ to, subject: subject.trim(), bodyHtml });
      toast.success(`המייל נשלח אל ${to}`);
      onOpenChange(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : "שגיאה בשליחת המייל";
      toast.error(message);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-3xl h-[85vh] flex flex-col p-0 gap-0"
        dir="rtl"
      >
        <DialogHeader className="px-6 pt-6 pb-4 border-b">
          <DialogTitle>שליחת מייל ל{supplierName}</DialogTitle>
          <DialogDescription>
            נושא + גוף חופשי. המייל יישלח עם חתימת רעות והוא יירשם ביומן המיילים.
          </DialogDescription>
        </DialogHeader>

        <div className="px-6 py-4 space-y-3 border-b shrink-0">
          <div className="grid gap-1.5">
            <Label htmlFor="email-to">אל</Label>
            <Input
              id="email-to"
              type="email"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              placeholder={loadingContact ? "טוען איש קשר..." : "אימייל הספק"}
              disabled={loadingContact || sendEmail.isPending}
              dir="ltr"
              className="text-left"
            />
            {contact?.secondaryContactEmail && contact.secondaryContactEmail !== to && (
              <p className="text-xs text-muted-foreground flex items-center gap-2">
                <span>איש קשר משני: {contact.secondaryContactEmail}</span>
                <Button
                  type="button"
                  variant="link"
                  size="sm"
                  className="h-auto p-0 text-xs"
                  onClick={() => setTo(contact.secondaryContactEmail!)}
                  disabled={sendEmail.isPending || loadingContact}
                >
                  שלח לכתובת זו
                </Button>
              </p>
            )}
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="email-subject">נושא</Label>
            <Input
              id="email-subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              maxLength={200}
              placeholder="נושא המייל"
              disabled={sendEmail.isPending}
            />
          </div>
        </div>

        <div className="flex-1 min-h-0 flex flex-col">
          <EmailEditor
            value={bodyHtml}
            onChange={setBodyHtml}
            disabled={sendEmail.isPending}
          />
        </div>

        <DialogFooter className="px-6 py-4 border-t shrink-0 sm:flex-row sm:justify-end gap-2">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={sendEmail.isPending}
          >
            <X className="ms-2 h-4 w-4" />
            ביטול
          </Button>
          <Button onClick={handleSend} disabled={sendEmail.isPending || loadingContact}>
            {sendEmail.isPending ? (
              <Loader2 className="ms-2 h-4 w-4 animate-spin" />
            ) : (
              <Send className="ms-2 h-4 w-4" />
            )}
            שלח מייל
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
