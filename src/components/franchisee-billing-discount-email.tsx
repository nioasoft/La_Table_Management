"use client";

import { useState } from "react";
import { Loader2, Mail } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { fetchWithTimeout } from "@/lib/fetch-with-timeout";
import type { FranchiseeBillingScreenPayload } from "@/schemas/franchisee-billing-screen";

type BillingRow = FranchiseeBillingScreenPayload["rows"][number];

interface FranchiseeBillingDiscountEmailProps {
  readonly row: BillingRow;
}

function apiErrorMessage(value: unknown): string | null {
  if (
    typeof value === "object" &&
    value !== null &&
    "error" in value &&
    typeof value.error === "string"
  ) {
    return value.error;
  }
  return null;
}

async function sendDiscountNotice(
  billingId: string,
  emails: readonly string[],
): Promise<void> {
  const response = await fetchWithTimeout(
    "/api/franchisee-billing/notify-discount",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ billingId, emails }),
      timeout: 60_000,
    },
  );
  const body: unknown = await response.json();
  if (!response.ok) {
    throw new Error(apiErrorMessage(body) ?? "שליחת המייל נכשלה. נסי שוב.");
  }
}

/**
 * The one email the royalty module sends: a hand-triggered discount notice for
 * a single approved row, to the owners chosen here. Shown only when the row is
 * approved and actually carries a discount.
 */
export function FranchiseeBillingDiscountEmail({
  row,
}: FranchiseeBillingDiscountEmailProps) {
  const owners = (row.owners ?? []).filter((owner) => owner.email.trim());
  const [selected, setSelected] = useState<readonly string[]>(
    owners.map((owner) => owner.email),
  );
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (row.status !== "approved" || !(Number(row.discountValue) > 0)) {
    return null;
  }

  const toggle = (email: string, checked: boolean) => {
    setSelected((current) =>
      checked
        ? [...current, email]
        : current.filter((value) => value !== email));
  };

  const send = async () => {
    setPending(true);
    setError(null);
    try {
      await sendDiscountNotice(row.id, selected);
      setResult("המייל נשלח");
      setOpen(false);
    } catch (sendError: unknown) {
      console.error("Failed to send the discount notice:", sendError);
      setError(
        sendError instanceof Error
          ? sendError.message
          : "שליחת המייל נכשלה. נסי שוב.",
      );
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="space-y-1">
      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (next) {
            setError(null);
            setResult(null);
          }
        }}
      >
        <DialogTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 px-2 text-xs"
            title="שולח לזכיין הזה בלבד הודעה על ההנחה שנקבעה לו"
          >
            <Mail className="h-3.5 w-3.5" aria-hidden="true" />
            מייל הנחה
          </Button>
        </DialogTrigger>
        <DialogContent dir="rtl">
          <DialogHeader dir="rtl">
            <DialogTitle>הודעת הנחה — {row.franchiseeName}</DialogTitle>
            <DialogDescription>
              נשלחת הודעה על חיוב החודש וההנחה שנקבעה, לנמענים המסומנים בלבד.
              אף זכיין אחר לא מקבל דבר.
            </DialogDescription>
          </DialogHeader>
          {owners.length === 0 ? (
            <p className="rounded-lg bg-muted p-3 text-sm">
              לא הוגדרו בעלים עם כתובת מייל לזכיין הזה.
            </p>
          ) : (
            <div className="space-y-2">
              {owners.map((owner) => {
                const id = `${row.id}-${owner.email}`;
                return (
                  <label
                    key={id}
                    htmlFor={id}
                    className="flex items-center gap-2 text-sm"
                  >
                    <Checkbox
                      id={id}
                      checked={selected.includes(owner.email)}
                      onCheckedChange={(checked) =>
                        toggle(owner.email, checked === true)}
                    />
                    <span>
                      {owner.name} · <bdi>{owner.email}</bdi>
                    </span>
                  </label>
                );
              })}
            </div>
          )}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter dir="rtl">
            <Button
              type="button"
              onClick={() => void send()}
              disabled={pending || selected.length === 0}
            >
              {pending ? (
                <Loader2 className="animate-spin" aria-hidden="true" />
              ) : (
                <Mail aria-hidden="true" />
              )}
              שליחה
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {result && (
        <p className="text-xs text-emerald-700" role="status">
          {result}
        </p>
      )}
    </div>
  );
}
