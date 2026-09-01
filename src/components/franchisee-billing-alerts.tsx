"use client";

import { useState, type ReactNode } from "react";
import { Loader2 } from "lucide-react";

import { BillingNumber } from "@/components/franchisee-billing-number";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { FranchiseeBillingScreenPayload } from "@/schemas/franchisee-billing-screen";

type ApprovedDifference =
  FranchiseeBillingScreenPayload["approvedDifferences"][number];
type Anomaly = FranchiseeBillingScreenPayload["anomalies"][number];
type Franchisee = FranchiseeBillingScreenPayload["franchisees"][number];

interface FranchiseeBillingAlertsProps {
  readonly anomalies: FranchiseeBillingScreenPayload["anomalies"];
  readonly warnings: readonly string[];
  readonly staleRows: FranchiseeBillingScreenPayload["rows"];
  readonly approvedDifferences:
    FranchiseeBillingScreenPayload["approvedDifferences"];
  readonly franchisees: readonly Franchisee[];
  readonly onResolveDifference: (
    difference: ApprovedDifference,
    resolution: "reopen" | "keep",
  ) => Promise<void>;
  readonly onResolveAnomaly: (
    anomaly: Anomaly,
    franchiseeId: string | null,
  ) => Promise<void>;
}

/**
 * Only a row whose owner is unknown can be settled from here. Everything else
 * — an unconfirmed scale, a missing marketing rate, an amount the file never
 * carried — is fixed where it actually lives, and dismissing it would drop a
 * franchisee's billing without anyone noticing.
 */
const ASSIGNABLE_CODES = new Set(["missing_branch_name", "unmatched_branch"]);

const fieldLabels: Readonly<Record<string, string>> = {
  receipts: "תקבולים",
  tips: "טיפים",
  includeTips: "הכללת טיפים",
  grossBase: "מחזור ברוטו",
  netBase: "מחזור נטו",
  tierRate: "תעריף מדרגה",
  discountRatePoints: "דחייה בנקודות אחוז",
  effectiveRate: "תעריף לאחר דחייה",
  royaltyFull: "תמלוגים מלאים",
  royalty: "תמלוגים",
  discountValue: "שווי הדחייה",
  marketing: "שיווק",
  subtotal: "סה״כ לפני מע״מ",
  total: "לתשלום כולל מע״מ",
  tiersSnapshot: "מדרגות תמלוגים",
  tierBasisSnapshot: "בסיס המדרגות",
  marketingRateSnapshot: "אחוז שיווק",
  vatRateSnapshot: "שיעור מע״מ",
};

const currencyFields = new Set([
  "receipts",
  "tips",
  "grossBase",
  "netBase",
  "royaltyFull",
  "royalty",
  "discountValue",
  "marketing",
  "subtotal",
  "total",
]);

const percentFields = new Set([
  "tierRate",
  "discountRatePoints",
  "effectiveRate",
  "marketingRateSnapshot",
]);

function differenceValue(field: string, value: unknown): ReactNode {
  if (typeof value === "boolean") return value ? "כן" : "לא";
  if (
    (typeof value === "string" || typeof value === "number") &&
    Number.isFinite(Number(value))
  ) {
    const kind = currencyFields.has(field)
      ? "currency"
      : percentFields.has(field)
        ? "percent"
        : "number";
    return <BillingNumber value={value} kind={kind} />;
  }
  if (field === "tierBasisSnapshot") {
    return value === "gross" ? "ברוטו" : value === "net" ? "נטו" : "לא זמין";
  }
  return (
    <span
      dir="ltr"
      className="inline-block max-w-72 overflow-hidden text-ellipsis whitespace-nowrap font-mono text-xs [font-variant-numeric:tabular-nums]"
    >
      <bdi>{JSON.stringify(value) ?? "לא זמין"}</bdi>
    </span>
  );
}

function ApprovedDifferenceItem({
  difference,
  onResolve,
}: {
  readonly difference: ApprovedDifference;
  readonly onResolve: (
    difference: ApprovedDifference,
    resolution: "reopen" | "keep",
  ) => Promise<void>;
}) {
  const [resolution, setResolution] = useState<"reopen" | "keep" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const resolve = async (choice: "reopen" | "keep") => {
    setResolution(choice);
    setError(null);
    try {
      await onResolve(difference, choice);
    } catch (resolutionError: unknown) {
      console.error(
        "Failed to resolve approved franchisee billing difference:",
        resolutionError,
      );
      setError(
        resolutionError instanceof Error
          ? resolutionError.message
          : "הבחירה לא נשמרה. נסי שוב.",
      );
      setResolution(null);
    }
  };

  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50/70 p-4 dark:border-amber-800 dark:bg-amber-950/20">
      <h3 className="font-semibold">{difference.franchiseeName}</h3>
      <p className="mt-1 text-sm text-muted-foreground">
        הקובץ החדש שונה מהשורה שכבר אושרה:
      </p>
      <ul className="mt-3 space-y-2 text-sm">
        {difference.differences.map((item) => (
          <li
            key={item.field}
            className="grid gap-1 rounded-md bg-background/80 px-3 py-2 sm:grid-cols-[minmax(8rem,1fr)_1fr_1fr]"
          >
            <span className="font-medium">
              {fieldLabels[item.field] ?? item.field}
            </span>
            <span>
              מאושר: {differenceValue(item.field, item.approvedValue)}
            </span>
            <span>
              בקובץ החדש: {differenceValue(item.field, item.uploadedValue)}
            </span>
          </li>
        ))}
      </ul>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          onClick={() => void resolve("reopen")}
          disabled={resolution !== null}
        >
          {resolution === "reopen" && (
            <Loader2 className="animate-spin" aria-hidden="true" />
          )}
          פתח מחדש וחשב מעודכן
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => void resolve("keep")}
          disabled={resolution !== null}
        >
          {resolution === "keep" && (
            <Loader2 className="animate-spin" aria-hidden="true" />
          )}
          השאר כמו שהוא
        </Button>
      </div>
      {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
    </div>
  );
}

function AnomalyItem({
  anomaly,
  franchisees,
  onResolve,
}: {
  readonly anomaly: Anomaly;
  readonly franchisees: readonly Franchisee[];
  readonly onResolve: (
    anomaly: Anomaly,
    franchiseeId: string | null,
  ) => Promise<void>;
}) {
  const [franchiseeId, setFranchiseeId] = useState<string>("");
  const [pending, setPending] = useState<"assign" | "ignore" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const assignable = ASSIGNABLE_CODES.has(anomaly.code);

  const resolve = async (choice: "assign" | "ignore") => {
    setPending(choice);
    setError(null);
    try {
      await onResolve(anomaly, choice === "assign" ? franchiseeId : null);
    } catch (resolveError: unknown) {
      console.error("Failed to resolve a billing row anomaly:", resolveError);
      setError(
        resolveError instanceof Error
          ? resolveError.message
          : "הבחירה לא נשמרה. נסי שוב.",
      );
      setPending(null);
    }
  };

  return (
    <li className="space-y-2">
      <div>
        <span className="font-medium">
          {anomaly.franchiseeName || anomaly.branchName || "שורה ללא שם"}:
        </span>{" "}
        {anomaly.message}
        <span className="text-muted-foreground">
          {" — "}
          <bdi>{anomaly.sourceFileName}</bdi>
          {typeof anomaly.receipts === "number" && (
            <>
              {", תקבולים "}
              <BillingNumber value={anomaly.receipts} kind="currency" />
            </>
          )}
          {typeof anomaly.tips === "number" && anomaly.tips !== 0 && (
            <>
              {", טיפ "}
              <BillingNumber value={anomaly.tips} kind="currency" />
            </>
          )}
        </span>
      </div>

      {assignable && (
        <div className="flex flex-wrap items-center gap-2">
          <Select
            dir="rtl"
            value={franchiseeId}
            onValueChange={setFranchiseeId}
            disabled={pending !== null}
          >
            <SelectTrigger
              dir="rtl"
              aria-label="שיוך השורה לזכיין"
              className="h-8 w-64 bg-background"
            >
              <SelectValue placeholder="בחרי זכיין לשיוך" />
            </SelectTrigger>
            <SelectContent dir="rtl">
              {franchisees.map((franchisee) => (
                <SelectItem
                  key={franchisee.id}
                  dir="rtl"
                  value={franchisee.id}
                  className="text-end"
                >
                  {franchisee.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            type="button"
            size="sm"
            disabled={pending !== null || franchiseeId === ""}
            onClick={() => void resolve("assign")}
          >
            {pending === "assign" && (
              <Loader2 className="animate-spin" aria-hidden="true" />
            )}
            שייכי את השורה
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={pending !== null}
            onClick={() => void resolve("ignore")}
          >
            {pending === "ignore" && (
              <Loader2 className="animate-spin" aria-hidden="true" />
            )}
            התעלמי מהשורה
          </Button>
        </div>
      )}
      {error && <p className="text-sm text-destructive">{error}</p>}
    </li>
  );
}

export function FranchiseeBillingAlerts({
  anomalies,
  warnings,
  staleRows,
  approvedDifferences,
  franchisees,
  onResolveDifference,
  onResolveAnomaly,
}: FranchiseeBillingAlertsProps) {
  return (
    <div className="space-y-4">
      {staleRows.length > 0 && (
        <Alert variant="destructive" className="bg-destructive/5">
          <AlertTitle>נמצאו שורות מקובץ קודם</AlertTitle>
          <AlertDescription>
            <p className="mt-1">
              השורות הבאות אינן שייכות לקובץ האחרון והן חסומות לאישור:
            </p>
            <ul className="mt-2 list-disc space-y-1 ps-5">
              {staleRows.map((row) => (
                <li key={row.id}>
                  <span className="font-medium">{row.franchiseeName}</span>
                  {" — מקור בפועל: "}
                  <bdi>{row.sourceFileName ?? "קובץ מקור לא זמין"}</bdi>
                </li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      {anomalies.length > 0 && (
        <Alert variant="destructive" className="bg-destructive/5">
          <AlertTitle>לא ניתן לאשר את החודש</AlertTitle>
          <AlertDescription>
            <ul className="mt-2 list-disc space-y-3 ps-5">
              {anomalies.map((finding, index) => (
                // Row indexes repeat across source files, so they cannot key alone.
                <AnomalyItem
                  key={`${finding.sourceFileId}-${finding.code}-${finding.rowIndex}-${index}`}
                  anomaly={finding}
                  franchisees={franchisees}
                  onResolve={onResolveAnomaly}
                />
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      {warnings.length > 0 && (
        <Alert variant="warning" className="bg-amber-50/60">
          <AlertTitle>הערות מהקובץ</AlertTitle>
          <AlertDescription>
            <ul className="mt-2 list-disc space-y-1 ps-5">
              {warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      {approvedDifferences.map((difference) => (
        <ApprovedDifferenceItem
          key={`${difference.sourceFileId}-${difference.franchiseeId}`}
          difference={difference}
          onResolve={onResolveDifference}
        />
      ))}
    </div>
  );
}
