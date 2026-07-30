"use client";

import { useState } from "react";
import { Check, Loader2 } from "lucide-react";

import { BillingNumber } from "@/components/franchisee-billing-number";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { discountValueForPoints } from "@/lib/franchisee-billing-display";
import type { FranchiseeBillingScreenPayload } from "@/schemas/franchisee-billing-screen";

type BillingRow = FranchiseeBillingScreenPayload["rows"][number];

interface FranchiseeBillingDiscountCellProps {
  readonly row: BillingRow;
  readonly onPreview: (billingId: string, discountValue: number) => void;
  readonly onSave: (
    billingId: string,
    discountRatePoints: number,
  ) => Promise<void>;
}

const DISCOUNT_PATTERN = /^\d{0,3}(?:\.\d{0,2})?$/;

export function FranchiseeBillingDiscountCell({
  row,
  onPreview,
  onSave,
}: FranchiseeBillingDiscountCellProps) {
  const initialValue = String(Number(row.discountRatePoints));
  const [value, setValue] = useState(initialValue);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSaved, setIsSaved] = useState(false);
  const numericValue = value === "" ? 0 : Number(value);
  const previewValue = Number.isFinite(numericValue)
    ? discountValueForPoints(row.netBase, numericValue)
    : Number(row.discountValue);
  const isUnchanged = numericValue === Number(row.discountRatePoints);
  const errorId = `discount-error-${row.id}`;

  const updateValue = (nextValue: string) => {
    setIsSaved(false);
    if (!DISCOUNT_PATTERN.test(nextValue)) {
      setError("אפשר להזין עד שתי ספרות אחרי הנקודה");
      return;
    }
    const parsed = nextValue === "" ? 0 : Number(nextValue);
    if (parsed > Number(row.tierRate)) {
      setError(
        `הדחייה לא יכולה להיות גבוהה מתעריף המדרגה (${Number(row.tierRate)}%)`,
      );
      return;
    }
    setError(null);
    setValue(nextValue);
    onPreview(row.id, discountValueForPoints(row.netBase, parsed));
  };

  const save = async () => {
    if (value === "" || error) return;
    setIsSaving(true);
    setIsSaved(false);
    try {
      await onSave(row.id, numericValue);
      setIsSaved(true);
    } catch (saveError: unknown) {
      console.error("Failed to save franchisee billing discount:", saveError);
      setError(
        saveError instanceof Error
          ? saveError.message
          : "הדחייה לא נשמרה. נסי שוב.",
      );
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="min-w-36 space-y-2">
      <div className="flex items-center gap-2">
        <Input
          aria-label={`דחייה בנקודות אחוז עבור ${row.franchiseeName}`}
          aria-describedby={error ? errorId : undefined}
          aria-invalid={Boolean(error)}
          dir="ltr"
          type="number"
          inputMode="decimal"
          min={0}
          max={Number(row.tierRate)}
          step="0.01"
          value={value}
          onChange={(event) => updateValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") void save();
          }}
          disabled={isSaving}
          className="h-8 w-20 text-center [font-variant-numeric:tabular-nums]"
        />
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => void save()}
          disabled={isSaving || Boolean(error) || isUnchanged || value === ""}
          className="h-8 px-2"
        >
          {isSaving ? (
            <Loader2 className="animate-spin" aria-hidden="true" />
          ) : (
            "שמור"
          )}
        </Button>
      </div>
      <span className="sr-only">
        שווי הדחייה המעודכן:{" "}
        <BillingNumber value={previewValue} kind="currency" />
      </span>
      {error && (
        <p id={errorId} className="max-w-48 text-xs text-destructive">
          {error}
        </p>
      )}
      {isSaved && !error && (
        <p className="flex items-center gap-1 text-xs text-emerald-700">
          <Check className="h-3.5 w-3.5" aria-hidden="true" />
          הדחייה נשמרה
        </p>
      )}
    </div>
  );
}
