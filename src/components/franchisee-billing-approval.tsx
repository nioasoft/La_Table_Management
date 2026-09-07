"use client";

import { useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, Lock } from "lucide-react";

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
import {
  franchiseeBillingApprovalResponseSchema,
  type FranchiseeBillingApprovalInput,
  type FranchiseeBillingApprovalResponse,
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
  if (!response.ok) {
    throw new Error(parsed.data.error ?? "אישור החיובים נכשל");
  }
  return parsed.data;
}

function resultMessage(result: FranchiseeBillingApprovalResponse): string {
  if (result.data?.alreadyApproved) return "החודש כבר היה נעול";
  return "החודש ננעל. שורות החיוב מקובעות ומוכנות לייצוא";
}

/**
 * Decides what the approval panel shows. Extracted so the empty-month case is
 * testable: `some` over zero rows is false, which once made an untouched month
 * report itself as already approved.
 */
export function approvalPanelState(
  rows: readonly { readonly status: string }[],
): "hidden" | "already-approved" | "form" {
  if (rows.length === 0) return "hidden";
  return rows.some((row) => row.status === "draft") ? "form" : "already-approved";
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
  const [pending, setPending] = useState(false);
  const [result, setResult] =
    useState<FranchiseeBillingApprovalResponse | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const hasDrafts = data.rows.some((row) => row.status === "draft");
  const panelState = approvalPanelState(data.rows);

  if (isSessionPending || userRole !== "super_user") return null;
  if (panelState === "hidden") return null;
  if (panelState === "already-approved") {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50/60 p-3 text-sm dark:border-emerald-900 dark:bg-emerald-950/20">
        <Lock className="h-4 w-4 text-emerald-600" aria-hidden="true" />
        החודש נעול — שורות החיוב מקובעות ולא ניתן לערוך אותן או את ההנחות.
      </div>
    );
  }

  const approve = async () => {
    setPending(true);
    setLocalError(null);
    try {
      const response = await postApproval({
        action: "approve",
        periodYear: period.year,
        periodMonth: period.month,
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

  return (
    <div
      className="space-y-3 rounded-xl border border-dashed bg-muted/20 p-4"
      aria-live="polite"
    >
      <div>
        <h2 className="flex items-center gap-2 font-medium">
          <Lock className="h-4 w-4" aria-hidden="true" />
          סיום החודש
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {hasDrafts && (
            <>
              {data.rows.filter((row) => row.status === "draft").length} שורות
              טיוטה פתוחות לעריכה.{" "}
            </>
          )}
          נעילת החודש מקבעת את שורות החיוב — אחריה כבר לא ניתן לעדכן הנחות, לתקן
          שורות או להעלות קובץ מעודכן. נעלי רק כשסיימת את כל התיקונים.
        </p>
      </div>
      {hasDrafts && <Dialog>
        <DialogTrigger asChild>
          <Button
            type="button"
            disabled={data.hasBlockingIssues || pending}
          >
            <Lock aria-hidden="true" />
            נעילת החודש
          </Button>
        </DialogTrigger>
        <DialogContent dir="rtl">
          <DialogHeader dir="rtl">
            <DialogTitle>לנעול את החודש?</DialogTitle>
            <DialogDescription asChild>
              <div className="space-y-2 text-start">
                <p>
                  הנעילה מקבעת את נתוני החיוב וכותבת את הדחיות לליג׳ר. אחריה
                  לא ניתן לערוך הנחות או שורות, והעלאת קובץ חדש תדרוש אישור
                  מפורש להחלפת השורות הנעולות.
                </p>
                <p>
                  זה לא כפתור רענון — לרענון הנתונים יש כפתור &quot;רענון&quot;
                  בראש העמוד. לא נשלחת שום הודעה לזכיינים.
                </p>
              </div>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter dir="rtl">
            <Button type="button" onClick={() => void approve()} disabled={pending}>
              {pending ? (
                <Loader2 className="animate-spin" aria-hidden="true" />
              ) : (
                <Lock aria-hidden="true" />
              )}
              נעלי את החודש
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>}

      {data.hasBlockingIssues && (
        <p className="text-sm text-destructive">
          לא ניתן לנעול עד שכל החסימות והפערים יטופלו.
        </p>
      )}
      {(localError || result) && (
        <div
          role={localError ? "alert" : "status"}
          className="rounded-lg border p-3 text-sm"
        >
          <p className="flex items-center gap-2">
            {localError ? (
              <AlertTriangle className="h-4 w-4 text-destructive" aria-hidden="true" />
            ) : (
              <CheckCircle2 className="h-4 w-4 text-emerald-600" aria-hidden="true" />
            )}
            {localError ?? (result ? resultMessage(result) : "")}
          </p>
        </div>
      )}
    </div>
  );
}
