"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Loader2, Mail } from "lucide-react";

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
import {
  franchiseeBillingDiscountPreviewResponseSchema,
  type FranchiseeBillingDiscountPreview,
} from "@/schemas/franchisee-billing-approval";
import type { FranchiseeBillingScreenPayload } from "@/schemas/franchisee-billing-screen";

type BillingRow = FranchiseeBillingScreenPayload["rows"][number];

interface FranchiseeBillingDiscountEmailProps {
  readonly row: BillingRow;
  readonly onSent: () => Promise<unknown>;
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

async function postDiscountNotice(
  billingId: string,
  emails: readonly string[],
  preview: boolean,
): Promise<unknown> {
  const response = await fetchWithTimeout(
    "/api/franchisee-billing/notify-discount",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ billingId, emails, preview }),
      timeout: 60_000,
    },
  );
  const body: unknown = await response.json();
  if (!response.ok) {
    throw new Error(
      apiErrorMessage(body) ??
        (preview
          ? "טעינת התצוגה המקדימה נכשלה."
          : "שליחת המייל נכשלה. נסי שוב."),
    );
  }
  return body;
}

/** "7 בספטמבר 2026, 12:16" — when the owners were last told. */
export function formatNoticeSentAt(value: string): string {
  const sentAt = new Date(value);
  if (Number.isNaN(sentAt.getTime())) return value;
  return new Intl.DateTimeFormat("he-IL", {
    dateStyle: "long",
    timeStyle: "short",
  }).format(sentAt);
}

/**
 * The one email the royalty module sends: a hand-triggered discount notice for
 * a single approved row, to the owners chosen here. It is rendered on screen
 * before it goes anywhere — this is the only irreversible, outward-facing
 * action in the module, and it used to be taken blind.
 */
export function FranchiseeBillingDiscountEmail({
  row,
  onSent,
}: FranchiseeBillingDiscountEmailProps) {
  const owners = (row.owners ?? []).filter((owner) => owner.email.trim());
  const [selected, setSelected] = useState<readonly string[]>(
    owners.map((owner) => owner.email),
  );
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [preview, setPreview] =
    useState<FranchiseeBillingDiscountPreview | null>(null);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const billingId = row.id;
  const selectedKey = [...selected].sort().join(",");
  const loadPreview = useCallback(async () => {
    if (selectedKey === "") {
      setPreview(null);
      return;
    }
    setIsPreviewing(true);
    setError(null);
    try {
      const body = await postDiscountNotice(
        billingId,
        selectedKey.split(","),
        true,
      );
      const parsed =
        franchiseeBillingDiscountPreviewResponseSchema.safeParse(body);
      if (!parsed.success) {
        throw new Error("תצוגת המייל שהתקבלה אינה תקינה.");
      }
      setPreview(parsed.data.data.preview);
    } catch (previewError: unknown) {
      console.error("Failed to preview the discount notice:", previewError);
      setPreview(null);
      setError(
        previewError instanceof Error
          ? previewError.message
          : "טעינת התצוגה המקדימה נכשלה.",
      );
    } finally {
      setIsPreviewing(false);
    }
  }, [billingId, selectedKey]);

  // Reloads whenever the chosen recipients change, so what is on screen is
  // always the mail the send button would actually produce.
  useEffect(() => {
    if (!open) return;
    void loadPreview();
  }, [open, loadPreview]);

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
      await postDiscountNotice(row.id, selected, false);
      setOpen(false);
      await onSent();
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
          if (next) setError(null);
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
        <DialogContent
          dir="rtl"
          className="max-h-[90vh] max-w-2xl overflow-y-auto"
        >
          <DialogHeader dir="rtl">
            <DialogTitle>הודעת הנחה — {row.franchiseeName}</DialogTitle>
            <DialogDescription>
              נשלחת הודעה על חיוב התמלוגים וההנחה שנקבעה, לנמענים המסומנים
              בלבד. אף זכיין אחר לא מקבל דבר.
            </DialogDescription>
          </DialogHeader>

          {row.discountNoticeSentAt && (
            <p className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50/60 p-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/20 dark:text-amber-300">
              <AlertTriangle
                className="mt-0.5 h-4 w-4 shrink-0"
                aria-hidden="true"
              />
              <span>
                כבר נשלחה הודעה לשורה הזו ב-
                {formatNoticeSentAt(row.discountNoticeSentAt)}. שליחה נוספת
                תישלח שוב.
              </span>
            </p>
          )}

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

          <div className="space-y-2">
            <p className="text-sm font-medium">תצוגה מקדימה</p>
            {isPreviewing && (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                מרנדרת את המייל…
              </p>
            )}
            {!isPreviewing && preview && (
              <>
                <p className="text-xs text-muted-foreground">
                  נושא: <bdi>{preview.subject}</bdi>
                </p>
                {/* An iframe, so the email's own CSS cannot reach the app. */}
                <iframe
                  title={`תצוגה מקדימה של הודעת ההנחה ל${row.franchiseeName}`}
                  srcDoc={preview.html}
                  sandbox=""
                  className="h-80 w-full rounded-lg border bg-white"
                />
                {preview.recipients.length > 1 && (
                  <p className="text-xs text-muted-foreground">
                    מוצג העותק של <bdi>{preview.shownFor}</bdi>. שאר{" "}
                    {preview.recipients.length - 1} הנמענים מקבלים את אותו נוסח
                    בדיוק, עם שמם בשורת הפתיחה.
                  </p>
                )}
              </>
            )}
            {!isPreviewing && !preview && selected.length === 0 && (
              <p className="text-sm text-muted-foreground">
                סמני נמען כדי לראות את המייל.
              </p>
            )}
          </div>

          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter dir="rtl">
            <Button
              type="button"
              onClick={() => void send()}
              disabled={
                pending || isPreviewing || preview === null ||
                selected.length === 0
              }
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
      {row.discountNoticeSentAt && (
        <p className="text-xs text-muted-foreground">
          נשלח ב-{formatNoticeSentAt(row.discountNoticeSentAt)}
        </p>
      )}
    </div>
  );
}
