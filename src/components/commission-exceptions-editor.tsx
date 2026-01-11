"use client";

import * as React from "react";
import { X, Plus, Percent, HelpCircle, ChevronDown } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import type { CommissionException } from "@/db/schema";

// Hebrew translations for the component
const t = {
  title: "פריטים מוחרגים",
  description: "פריטים עם שיעור עמלה שונה מברירת המחדל",
  addButton: "הוסף חריגה",
  identifierLabel: "מזהה (מילת מפתח)",
  identifierPlaceholder: "לדוגמה: פיקדון",
  rateLabel: "אחוז",
  ratePlaceholder: "0",
  noExceptions: "אין פריטים מוחרגים",
  removeTooltip: "הסר חריגה",
  help: {
    toggle: "דוגמאות",
    title: "דוגמאות לשימוש:",
    deposit: "פיקדון - 0% (ללא עמלה על פיקדונות)",
    capsules: "קפסולות - 8% (עמלה שונה על קפסולות)",
    cups: "כוסות - 0% (להחריג פריטים שלא מקבלים עמלה)",
  },
};

export interface CommissionExceptionFormData {
  id: string;
  identifier: string;
  rate: string;
  matchType: "keyword" | "sku";
}

export interface CommissionExceptionsEditorProps {
  /**
   * Current list of commission exceptions
   */
  exceptions: CommissionExceptionFormData[];
  /**
   * Callback when exceptions change
   */
  onChange: (exceptions: CommissionExceptionFormData[]) => void;
  /**
   * Whether the component is disabled
   */
  disabled?: boolean;
  /**
   * Custom class name for the container
   */
  className?: string;
}

/**
 * CommissionExceptionsEditor component for managing supplier commission exceptions.
 * Allows defining item-specific commission rates different from the default rate.
 * Used for cases like:
 * - Deposits (פיקדון) at 0%
 * - Capsules at different rate than default
 * - Items to exclude from commission calculation
 */
export function CommissionExceptionsEditor({
  exceptions,
  onChange,
  disabled = false,
  className,
}: CommissionExceptionsEditorProps) {
  const handleAddException = () => {
    onChange([
      ...exceptions,
      {
        id: crypto.randomUUID(),
        identifier: "",
        rate: "0",
        matchType: "keyword",
      },
    ]);
  };

  const handleRemoveException = (id: string) => {
    if (disabled) return;
    onChange(exceptions.filter((e) => e.id !== id));
  };

  const handleUpdateException = (
    id: string,
    field: keyof CommissionExceptionFormData,
    value: string
  ) => {
    if (disabled) return;
    onChange(
      exceptions.map((e) => (e.id === id ? { ...e, [field]: value } : e))
    );
  };

  return (
    <div className={cn("space-y-3", className)}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <Label className="text-base font-medium flex items-center gap-2">
            <Percent className="h-4 w-4" />
            {t.title}
          </Label>
          <p className="text-sm text-muted-foreground mt-1">
            {t.description}
          </p>
        </div>
        {!disabled && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={handleAddException}
          >
            <Plus className="h-4 w-4 ml-1" />
            {t.addButton}
          </Button>
        )}
      </div>

      {/* Exceptions List */}
      {exceptions.length === 0 ? (
        <div className="text-sm text-muted-foreground italic py-4 text-center border border-dashed rounded-lg">
          {t.noExceptions}
        </div>
      ) : (
        <div className="space-y-3">
          {exceptions.map((exception) => (
            <div
              key={exception.id}
              className="flex items-center gap-3 p-3 bg-muted/50 rounded-lg border"
            >
              {/* Identifier Input */}
              <div className="flex-1 min-w-0">
                <Label className="text-xs text-muted-foreground mb-1 block">
                  {t.identifierLabel}
                </Label>
                <Input
                  value={exception.identifier}
                  onChange={(e) =>
                    handleUpdateException(exception.id, "identifier", e.target.value)
                  }
                  placeholder={t.identifierPlaceholder}
                  disabled={disabled}
                  dir="auto"
                  className="h-9"
                />
              </div>

              {/* Rate Input */}
              <div className="w-24">
                <Label className="text-xs text-muted-foreground mb-1 block">
                  {t.rateLabel}
                </Label>
                <div className="relative">
                  <Input
                    type="number"
                    value={exception.rate}
                    onChange={(e) =>
                      handleUpdateException(exception.id, "rate", e.target.value)
                    }
                    placeholder={t.ratePlaceholder}
                    disabled={disabled}
                    min="0"
                    max="100"
                    step="0.01"
                    className="h-9 pr-7"
                  />
                  <span className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">
                    %
                  </span>
                </div>
              </div>

              {/* Remove Button */}
              {!disabled && (
                <button
                  type="button"
                  onClick={() => handleRemoveException(exception.id)}
                  className="mt-5 p-1.5 rounded-full hover:bg-destructive/20 hover:text-destructive transition-colors"
                  aria-label={t.removeTooltip}
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Help Section - Collapsible */}
      <Collapsible>
        <CollapsibleTrigger className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors">
          <HelpCircle className="h-3.5 w-3.5" />
          <span>{t.help.toggle}</span>
          <ChevronDown className="h-3 w-3 transition-transform duration-200 [[data-state=open]>&]:rotate-180" />
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="text-xs text-muted-foreground space-y-1 bg-muted/50 rounded-md p-2 mt-2">
            <p className="font-medium">{t.help.title}</p>
            <ul className="list-disc list-inside mr-4 space-y-0.5">
              <li>{t.help.deposit}</li>
              <li>{t.help.capsules}</li>
              <li>{t.help.cups}</li>
            </ul>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}

/**
 * Convert form data to schema type for API submission
 */
export function formDataToCommissionExceptions(
  formData: CommissionExceptionFormData[]
): CommissionException[] {
  return formData
    .filter((e) => e.identifier.trim() !== "")
    .map((e) => ({
      identifier: e.identifier.trim(),
      rate: parseFloat(e.rate) || 0,
      matchType: e.matchType,
    }));
}

/**
 * Convert schema type to form data for editing
 */
export function commissionExceptionsToFormData(
  exceptions: CommissionException[] | null | undefined
): CommissionExceptionFormData[] {
  if (!exceptions || !Array.isArray(exceptions)) return [];
  return exceptions.map((e) => ({
    id: crypto.randomUUID(),
    identifier: e.identifier,
    rate: String(e.rate),
    matchType: e.matchType || "keyword",
  }));
}
