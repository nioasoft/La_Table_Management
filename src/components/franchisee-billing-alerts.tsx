"use client";

import { useState, type ReactNode } from "react";
import { Loader2 } from "lucide-react";

import { BillingNumber } from "@/components/franchisee-billing-number";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import type { FranchiseeBillingScreenPayload } from "@/schemas/franchisee-billing-screen";

type ApprovedDifference =
  FranchiseeBillingScreenPayload["approvedDifferences"][number];

interface FranchiseeBillingAlertsProps {
  readonly anomalies: FranchiseeBillingScreenPayload["anomalies"];
  readonly warnings: readonly string[];
  readonly staleRows: FranchiseeBillingScreenPayload["rows"];
  readonly approvedDifferences:
    FranchiseeBillingScreenPayload["approvedDifferences"];
  readonly onResolveDifference: (
    difference: ApprovedDifference,
    resolution: "reopen" | "keep",
  ) => Promise<void>;
}

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
  tiersSnapshot: "סולם מדרגות",
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

export function FranchiseeBillingAlerts({
  anomalies,
  warnings,
  staleRows,
  approvedDifferences,
  onResolveDifference,
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
            <ul className="mt-2 list-disc space-y-1 ps-5">
              {anomalies.map((finding, index) => (
                // Row indexes repeat across source files, so they cannot key alone.
                <li key={`${finding.code}-${finding.rowIndex}-${index}`}>
                  <span className="font-medium">
                    {finding.franchiseeName || finding.branchName || "שורה ללא שם"}
                    :
                  </span>{" "}
                  {finding.message}
                </li>
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
