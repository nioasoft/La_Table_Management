"use client";

import { useState } from "react";
import { Loader2, LockKeyholeOpen } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { authClient } from "@/lib/auth-client";
import { fetchWithTimeout } from "@/lib/fetch-with-timeout";

interface FranchiseeBillingReopenRowProps {
  readonly billingId: string;
  readonly franchiseeName: string;
  readonly onReopened: () => Promise<unknown>;
}

/**
 * "פתח לעריכה" on one approved row — for a discount forgotten before the
 * month was locked. Super user only, like the lock itself.
 */
export function FranchiseeBillingReopenRow({
  billingId,
  franchiseeName,
  onReopened,
}: FranchiseeBillingReopenRowProps) {
  const { data: session } = authClient.useSession();
  const role = (session?.user as { readonly role?: string } | undefined)?.role;
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (role !== "super_user") return null;

  const reopen = async () => {
    setPending(true);
    setError(null);
    try {
      const response = await fetchWithTimeout(
        "/api/franchisee-billing/reopen-row",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ billingId }),
        },
      );
      const body = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "פתיחת השורה נכשלה");
      await onReopened();
      setOpen(false);
    } catch (caught: unknown) {
      console.error("Reopening franchisee billing row failed:", caught);
      setError(caught instanceof Error ? caught.message : "פתיחת השורה נכשלה");
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs">
          <LockKeyholeOpen aria-hidden="true" />
          פתח לעריכה
        </Button>
      </DialogTrigger>
      <DialogContent dir="rtl">
        <DialogHeader dir="rtl">
          <DialogTitle>לפתוח את {franchiseeName} לעריכה?</DialogTitle>
          <DialogDescription asChild>
            <div className="space-y-2 text-start">
              <p>
                השורה תחזור לטיוטה ותוכלי לעדכן את ההנחה. רשומת הדחייה שנכתבה
                בנעילה תימחק, ותיכתב מחדש כשתנעלי שוב.
              </p>
              <p>אחרי התיקון צריך ללחוץ שוב על &quot;נעילת החודש&quot;.</p>
            </div>
          </DialogDescription>
        </DialogHeader>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <DialogFooter dir="rtl">
          <Button type="button" onClick={() => void reopen()} disabled={pending}>
            {pending ? (
              <Loader2 className="animate-spin" aria-hidden="true" />
            ) : (
              <LockKeyholeOpen aria-hidden="true" />
            )}
            פתחי לעריכה
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
