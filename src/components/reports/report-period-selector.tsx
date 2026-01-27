"use client";

import { useMemo } from "react";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Calendar } from "lucide-react";
import type { SettlementPeriodType } from "@/db/schema";
import {
  getPeriodsForFrequency,
  getPeriodTypeLabel,
  formatPeriodRange,
  type SettlementPeriodInfo,
} from "@/lib/settlement-periods";

// ============================================================================
// TYPES
// ============================================================================

export interface ReportPeriodSelectorProps {
  /** Current period type */
  periodType: SettlementPeriodType | "";
  /** Current period key */
  periodKey: string;
  /** Callback when period changes */
  onChange: (periodType: SettlementPeriodType | "", periodKey: string) => void;
  /** Whether to show custom range option */
  showCustomRange?: boolean;
  /** Callback when custom range is selected */
  onCustomRangeSelect?: () => void;
  /** Number of historical periods to show per type */
  periodsCount?: number;
  /** Disabled state */
  disabled?: boolean;
  /** Layout direction - horizontal or vertical */
  layout?: "horizontal" | "vertical";
  /** Show labels */
  showLabels?: boolean;
}

// Period type options
const PERIOD_TYPES: { value: SettlementPeriodType; label: string }[] = [
  { value: "quarterly", label: "רבעוני" },
  { value: "monthly", label: "חודשי" },
  { value: "semi_annual", label: "חצי שנתי" },
  { value: "annual", label: "שנתי" },
];

// ============================================================================
// COMPONENT
// ============================================================================

export function ReportPeriodSelector({
  periodType,
  periodKey,
  onChange,
  showCustomRange = true,
  onCustomRangeSelect,
  periodsCount = 8,
  disabled = false,
  layout = "horizontal",
  showLabels = true,
}: ReportPeriodSelectorProps) {
  // Get available periods based on selected type
  const availablePeriods = useMemo((): SettlementPeriodInfo[] => {
    if (!periodType) return [];
    return getPeriodsForFrequency(periodType, new Date(), periodsCount);
  }, [periodType, periodsCount]);

  // Handle period type change
  const handleTypeChange = (newType: string) => {
    if (newType === "custom") {
      // Clear period selection and trigger custom range callback
      onChange("", "");
      onCustomRangeSelect?.();
      return;
    }

    const type = newType as SettlementPeriodType;
    // Get the most recent period for this type
    const periods = getPeriodsForFrequency(type, new Date(), 1);
    const defaultPeriod = periods[0];

    onChange(type, defaultPeriod?.key || "");
  };

  // Handle period key change
  const handlePeriodChange = (newKey: string) => {
    onChange(periodType as SettlementPeriodType, newKey);
  };

  // Find selected period info for display
  const selectedPeriod = useMemo(() => {
    return availablePeriods.find((p) => p.key === periodKey);
  }, [availablePeriods, periodKey]);

  const isHorizontal = layout === "horizontal";

  return (
    <div className={isHorizontal ? "flex items-end gap-4" : "space-y-4"}>
      {/* Period Type Selector */}
      <div className={isHorizontal ? "space-y-2 min-w-[140px]" : "space-y-2"}>
        {showLabels && <Label htmlFor="periodType">סוג תקופה</Label>}
        <Select
          value={periodType || "custom"}
          onValueChange={handleTypeChange}
          disabled={disabled}
        >
          <SelectTrigger id="periodType" dir="rtl" className="[&>span]:text-end" aria-label="בחר סוג תקופה">
            <SelectValue placeholder="בחר סוג תקופה">
              {periodType ? getPeriodTypeLabel(periodType) : "טווח מותאם"}
            </SelectValue>
          </SelectTrigger>
          <SelectContent dir="rtl">
            {PERIOD_TYPES.map((type) => (
              <SelectItem key={type.value} value={type.value} className="text-end">
                {type.label}
              </SelectItem>
            ))}
            {showCustomRange && (
              <SelectItem value="custom" className="text-end border-t mt-1 pt-1">
                טווח מותאם אישית
              </SelectItem>
            )}
          </SelectContent>
        </Select>
      </div>

      {/* Period Selector (only shown when a type is selected) */}
      {periodType && (
        <div className={isHorizontal ? "space-y-2 min-w-[200px]" : "space-y-2"}>
          {showLabels && <Label htmlFor="periodKey">תקופה</Label>}
          <Select
            value={periodKey}
            onValueChange={handlePeriodChange}
            disabled={disabled || !periodType}
          >
            <SelectTrigger id="periodKey" dir="rtl" className="[&>span]:text-end" aria-label="בחר תקופה">
              <SelectValue placeholder="בחר תקופה">
                {selectedPeriod && (
                  <span className="flex items-center gap-2">
                    <Calendar className="h-4 w-4 text-muted-foreground" />
                    {selectedPeriod.nameHe}
                  </span>
                )}
              </SelectValue>
            </SelectTrigger>
            <SelectContent dir="rtl">
              {availablePeriods.map((period) => (
                <SelectItem key={period.key} value={period.key} className="text-end">
                  <div className="flex flex-col">
                    <span className="font-medium">{period.nameHe}</span>
                    <span className="text-xs text-muted-foreground">
                      {formatPeriodRange(period)}
                    </span>
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Date Range Display */}
      {selectedPeriod && (
        <div className={isHorizontal ? "text-sm text-muted-foreground pb-2" : "text-sm text-muted-foreground"}>
          <span className="flex items-center gap-1">
            <Calendar className="h-3 w-3" />
            {formatPeriodRange(selectedPeriod)}
          </span>
        </div>
      )}
    </div>
  );
}
