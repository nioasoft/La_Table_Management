"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, Send } from "lucide-react";

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
import { authClient } from "@/lib/auth-client";
import { fetchWithTimeout } from "@/lib/fetch-with-timeout";
import {
  franchiseeBillingApprovalResponseSchema,
  type FranchiseeBillingApprovalInput,
  type FranchiseeBillingApprovalResponse,
  type FranchiseeBillingEmailFailure,
} from "@/schemas/franchisee-billing-approval";
import type {
  FranchiseeBillingPeriod,
  FranchiseeBillingScreenPayload,
} from "@/schemas/franchisee-billing-screen";

interface FranchiseeBillingApprovalProps {
  readonly data: FranchiseeBillingScreenPayload;
  readonly period: FranchiseeBillingPeriod;
  readonly onApproved: () => Promise<unknown>;
}

type RecipientSelection = Readonly<Record<string, readonly string[]>>;

async function postApproval(
  input: FranchiseeBillingApprovalInput,
): Promise<FranchiseeBillingApprovalResponse> {
  const response = await fetchWithTimeout(
    "/api/franchisee-billing/approve",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    },
  );
  const body: unknown = await response.json();
  const parsed = franchiseeBillingApprovalResponseSchema.safeParse(body);
  if (!parsed.success) {
    console.error("Invalid franchisee billing approval response:", {
      issues: parsed.error.issues,
      status: response.status,
    });
    throw new Error("תשובת האישור אינה תקינה. רענני את העמוד.");
  }
  if (!response.ok && response.status !== 207) {
    throw new Error(parsed.data.error ?? "אישור החיובים נכשל");
  }
  return parsed.data;
}

function recipientGroups(
  data: FranchiseeBillingScreenPayload,
) {
  return data.rows
    .filter((row) => row.status === "draft" && Number(row.discountValue) > 0)
    .map((row) => ({
      franchiseeId: row.franchiseeId,
      franchiseeName: row.franchiseeName,
      owners: row.owners ?? [],
    }));
}

function resultMessage(result: FranchiseeBillingApprovalResponse): string {
  if (result.data?.emailFailures.length) {
    return result.error ?? "חלק מהודעות המייל לא נשלחו";
  }
  if (result.data?.alreadyApproved) return "החודש כבר אושר קודם לכן";
  return "החיובים אושרו והמיילים נשלחו בהצלחה";
}

/**
 * Decides what the approval panel shows. Extracted so the empty-month case is
 * testable: `some` over zero rows is false, which once made an untouched month
 * report itself as already approved.
 */
/**
 * Which owner addresses an approval will send to. Absence of an entry means the
 * franchisee was never touched, which must resolve to every owner — see the
 * regression note in the test.
 */
export function recipientsFor(
  selection: Readonly<Record<string, readonly string[]>>,
  franchiseeId: string,
  owners: readonly { readonly email: string }[],
): readonly string[] {
  return (
    selection[franchiseeId] ??
    owners.map((owner) => owner.email.trim()).filter(Boolean)
  );
}

export function approvalPanelState(
  rows: readonly { readonly status: string }[],
  emailFailureCount: number,
): "hidden" | "already-approved" | "form" {
  if (rows.length === 0 && emailFailureCount === 0) return "hidden";
  if (rows.some((row) => row.status === "draft")) return "form";
  return emailFailureCount > 0 ? "form" : "already-approved";
}

export function FranchiseeBillingApproval({
  data,
  period,
  onApproved,
}: FranchiseeBillingApprovalProps) {
  const { data: session, isPending: isSessionPending } = authClient.useSession();
  const userRole = session?.user
    ? (session.user as { readonly role?: string }).role
    : undefined;
  const groups = useMemo(() => recipientGroups(data), [data]);
  // Absence of an entry means the user has not touched this franchisee yet, so
  // it resolves to every owner. Initialising the map once left the recipients
  // empty whenever the deferral was entered after the screen had loaded, and
  // the month was approved without sending anything.
  const [selection, setSelection] = useState<RecipientSelection>({});
  const selectedFor = (
    franchiseeId: string,
    owners: readonly { email: string }[],
  ) => recipientsFor(selection, franchiseeId, owners);
  const [pending, setPending] = useState(false);
  const [result, setResult] =
    useState<FranchiseeBillingApprovalResponse | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const failures = result?.data?.emailFailures ?? [];
  const hasDrafts = data.rows.some((row) => row.status === "draft");
  const panelState = approvalPanelState(data.rows, failures.length);

  if (isSessionPending || userRole !== "super_user") return null;
  if (panelState === "hidden") return null;
  if (panelState === "already-approved") {
    return (
      <div className="flex items-center gap-2 rounded-lg border bg-muted/30 p-3 text-sm">
        <CheckCircle2 className="h-4 w-4 text-emerald-600" aria-hidden="true" />
        החודש כבר אושר
      </div>
    );
  }

  const toggleRecipient = (
    franchiseeId: string,
    email: string,
    checked: boolean,
  ) => {
    setSelection((current) => {
      const selected = current[franchiseeId] ?? [];
      return {
        ...current,
        [franchiseeId]: checked
          ? [...selected, email]
          : selected.filter((value) => value !== email),
      };
    });
  };

  const approve = async () => {
    setPending(true);
    setLocalError(null);
    try {
      const response = await postApproval({
        action: "approve",
        periodYear: period.year,
        periodMonth: period.month,
        // Built from the groups on screen, not from `selection`: an untouched
        // franchisee has no entry there and would silently receive nothing.
        recipients: groups.map((group) => ({
          franchiseeId: group.franchiseeId,
          emails: [...selectedFor(group.franchiseeId, group.owners)],
        })),
      });
      setResult(response);
      if (response.data?.approvalCommitted || response.data?.alreadyApproved) {
        await onApproved();
      }
    } catch (error: unknown) {
      console.error("Failed to approve franchisee billing:", error);
      setLocalError(
        error instanceof Error ? error.message : "אישור החיובים נכשל",
      );
    } finally {
      setPending(false);
    }
  };

  const retry = async (failures: readonly FranchiseeBillingEmailFailure[]) => {
    setPending(true);
    setLocalError(null);
    try {
      const response = await postApproval({
        action: "retry_failed",
        periodYear: period.year,
        periodMonth: period.month,
        failures: failures.map(({ billingId, franchiseeId, email }) => ({
          billingId,
          franchiseeId,
          email,
        })),
      });
      setResult(response);
    } catch (error: unknown) {
      console.error("Failed to retry franchisee billing emails:", error);
      setLocalError(
        error instanceof Error ? error.message : "השליחה החוזרת נכשלה",
      );
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="space-y-3" aria-live="polite">
      {hasDrafts && <Dialog>
        <DialogTrigger asChild>
          <Button
            type="button"
            disabled={data.hasBlockingIssues || pending}
          >
            <CheckCircle2 aria-hidden="true" />
            אישור החודש ושליחת מיילים
          </Button>
        </DialogTrigger>
        <DialogContent dir="rtl" className="max-h-[85vh] overflow-y-auto">
          <DialogHeader dir="rtl">
            <DialogTitle>אישור חיובי החודש</DialogTitle>
            <DialogDescription>
              האישור מקבע את נתוני החיוב וכותב את הדחיות לליג׳ר. ניתן להסיר
              נמענים לפני השליחה.
            </DialogDescription>
          </DialogHeader>
          {groups.length === 0 ? (
            <p className="rounded-lg bg-muted p-3 text-sm">
              אין זכיינים עם דחיית חיוב, ולכן לא יישלחו מיילים.
            </p>
          ) : (
            <div className="space-y-4">
              {groups.map((group) => (
                <fieldset key={group.franchiseeId} className="space-y-2 rounded-lg border p-3">
                  <legend className="px-1 font-medium">
                    {group.franchiseeName}
                  </legend>
                  {group.owners.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      לא הוגדרו בעלים עם כתובת מייל
                    </p>
                  ) : group.owners.map((owner) => {
                    const id = `${group.franchiseeId}-${owner.email}`;
                    return (
                      <label key={id} htmlFor={id} className="flex items-center gap-2 text-sm">
                        <Checkbox
                          id={id}
                          checked={selectedFor(group.franchiseeId, group.owners).includes(owner.email)}
                          onCheckedChange={(checked) =>
                            toggleRecipient(
                              group.franchiseeId,
                              owner.email,
                              checked === true,
                            )}
                        />
                        <span>{owner.name} · <bdi>{owner.email}</bdi></span>
                      </label>
                    );
                  })}
                </fieldset>
              ))}
            </div>
          )}
          <DialogFooter dir="rtl">
            <Button type="button" onClick={() => void approve()} disabled={pending}>
              {pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Send aria-hidden="true" />}
              אישור ושליחה
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>}

      {data.hasBlockingIssues && (
        <p className="text-sm text-destructive">
          לא ניתן לאשר עד שכל החסימות והפערים יטופלו.
        </p>
      )}
      {(localError || result) && (
        <div
          role={localError || failures.length ? "alert" : "status"}
          className="rounded-lg border p-3 text-sm"
        >
          <p className="flex items-center gap-2">
            {localError || failures.length ? (
              <AlertTriangle className="h-4 w-4 text-destructive" aria-hidden="true" />
            ) : (
              <CheckCircle2 className="h-4 w-4 text-emerald-600" aria-hidden="true" />
            )}
            {localError ?? (result ? resultMessage(result) : "")}
          </p>
          {failures.length > 0 && (
            <>
              <ul className="mt-2 list-inside list-disc">
                {failures.map((failure) => (
                  <li key={`${failure.billingId}-${failure.email}`}>
                    <bdi>{failure.email}</bdi>: {failure.error}
                  </li>
                ))}
              </ul>
              <Button
                type="button"
                variant="outline"
                className="mt-3"
                disabled={pending}
                onClick={() => void retry(failures)}
              >
                {pending && <Loader2 className="animate-spin" aria-hidden="true" />}
                שליחה חוזרת לנמענים שנכשלו
              </Button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
