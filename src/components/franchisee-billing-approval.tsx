"use client";

import { useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";

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
  if (result.data?.alreadyApproved) return "החודש כבר אושר קודם לכן";
  return "החיובים אושרו";
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
      <div className="flex items-center gap-2 rounded-lg border bg-muted/30 p-3 text-sm">
        <CheckCircle2 className="h-4 w-4 text-emerald-600" aria-hidden="true" />
        החודש כבר אושר
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
    <div className="space-y-3" aria-live="polite">
      {hasDrafts && <Dialog>
        <DialogTrigger asChild>
          <Button
            type="button"
            disabled={data.hasBlockingIssues || pending}
          >
            <CheckCircle2 aria-hidden="true" />
            אישור החודש
          </Button>
        </DialogTrigger>
        <DialogContent dir="rtl">
          <DialogHeader dir="rtl">
            <DialogTitle>אישור חיובי החודש</DialogTitle>
            <DialogDescription>
              האישור מקבע את נתוני החיוב וכותב את הדחיות לליג׳ר. לא נשלחת שום
              הודעה לזכיינים.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter dir="rtl">
            <Button type="button" onClick={() => void approve()} disabled={pending}>
              {pending ? (
                <Loader2 className="animate-spin" aria-hidden="true" />
              ) : (
                <CheckCircle2 aria-hidden="true" />
              )}
              אישור החודש
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
