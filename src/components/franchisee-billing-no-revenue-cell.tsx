"use client";

import { useState } from "react";
import { Loader2, Save } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { FranchiseeBillingScreenPayload } from "@/schemas/franchisee-billing-screen";

type BillingRow = FranchiseeBillingScreenPayload["rows"][number];

interface FranchiseeBillingNoRevenueCellProps {
  readonly row: BillingRow;
  readonly onSave: (
    billingId: string,
    noRevenueReason: string | null,
  ) => Promise<void>;
}

function storedZero(value: string): boolean {
  const amount = Number(value);
  return Number.isFinite(amount) && amount === 0;
}

export function canSetNoRevenueReason(
  row: Pick<BillingRow, "status" | "royalty" | "marketing" | "total">,
): boolean {
  return (
    row.status === "draft" &&
    [row.royalty, row.marketing, row.total].every(storedZero)
  );
}

function useNoRevenueSave(
  row: BillingRow,
  onSave: FranchiseeBillingNoRevenueCellProps["onSave"],
) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async (reason: string | null) => {
    setPending(true);
    setError(null);
    try {
      await onSave(row.id, reason);
    } catch (saveError: unknown) {
      console.error("Failed to save no-revenue reason:", saveError);
      setError(
        saveError instanceof Error
          ? saveError.message
          : "הסיבה לא נשמרה. נסי שוב.",
      );
    } finally {
      setPending(false);
    }
  };
  return { pending, error, save };
}

function NoRevenueReasonEditor({
  row,
  onSave,
}: FranchiseeBillingNoRevenueCellProps) {
  const [value, setValue] = useState(row.noRevenueReason ?? "");
  const { pending, error, save } = useNoRevenueSave(row, onSave);
  const normalized = value.trim();
  const stored = row.noRevenueReason?.trim() ?? "";

  return (
    <div className="space-y-2">
      <Textarea
        dir="rtl"
        value={value}
        maxLength={500}
        rows={2}
        aria-label={`סיבת אין מחזור עבור ${row.franchiseeName}`}
        placeholder="למשל: הסניף היה סגור כל החודש"
        disabled={pending}
        onChange={(event) => setValue(event.target.value)}
      />
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={pending || normalized === stored}
        onClick={() => void save(normalized || null)}
      >
        {pending ? (
          <Loader2 className="animate-spin" aria-hidden="true" />
        ) : (
          <Save aria-hidden="true" />
        )}
        שמירת סיבה
      </Button>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

function StaleNoRevenueReason({
  row,
  onSave,
}: FranchiseeBillingNoRevenueCellProps) {
  const { pending, error, save } = useNoRevenueSave(row, onSave);
  return (
    <div className="space-y-2">
      <p className="text-xs text-destructive">
        קיימים סכומים לחיוב. הסיבה הישנה אינה מכסה את השורה.
      </p>
      <p className="text-xs text-muted-foreground">{row.noRevenueReason}</p>
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={pending}
        onClick={() => void save(null)}
      >
        {pending && <Loader2 className="animate-spin" aria-hidden="true" />}
        הסרת הסיבה
      </Button>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

export function FranchiseeBillingNoRevenueCell(
  props: FranchiseeBillingNoRevenueCellProps,
) {
  const { row } = props;
  if (canSetNoRevenueReason(row)) {
    return <NoRevenueReasonEditor {...props} />;
  }
  if (row.status === "draft" && row.noRevenueReason?.trim()) {
    return <StaleNoRevenueReason {...props} />;
  }
  return (
    <span className="text-xs text-muted-foreground">
      {row.status === "approved"
        ? "השורה מאושרת"
        : "זמין רק כשכל הסכומים אפס"}
    </span>
  );
}
