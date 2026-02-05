"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useSupplierPeriods } from "@/queries/reconciliation-v2";
import { Loader2 } from "lucide-react";
import { format } from "date-fns";
import { he } from "date-fns/locale";

interface PeriodSelectorProps {
  supplierId: string | null;
  value: string | null;
  onValueChange: (value: string, periodData: {
    periodStartDate: string;
    periodEndDate: string;
    supplierFileId: string;
    hasExistingSession: boolean;
    existingSessionId: string | null;
  }) => void;
  disabled?: boolean;
}

function formatPeriodDate(dateString: string): string {
  try {
    const date = new Date(dateString);
    return format(date, "MMM yyyy", { locale: he });
  } catch {
    return dateString;
  }
}

export function PeriodSelector({
  supplierId,
  value,
  onValueChange,
  disabled,
}: PeriodSelectorProps) {
  const { data: periods, isLoading, error } = useSupplierPeriods(supplierId, {
    enabled: !!supplierId,
  });

  if (!supplierId) {
    return (
      <Select disabled>
        <SelectTrigger className="w-full">
          <SelectValue placeholder="בחר ספק תחילה" />
        </SelectTrigger>
        <SelectContent />
      </Select>
    );
  }

  if (error) {
    return (
      <div className="text-sm text-destructive">שגיאה בטעינת תקופות</div>
    );
  }

  return (
    <Select
      value={value ?? ""}
      onValueChange={(periodKey) => {
        const period = periods?.find((p) => p.periodKey === periodKey);
        if (period) {
          onValueChange(periodKey, {
            periodStartDate: period.periodStartDate,
            periodEndDate: period.periodEndDate,
            supplierFileId: period.supplierFileId,
            hasExistingSession: period.hasExistingSession,
            existingSessionId: period.existingSessionId,
          });
        }
      }}
      disabled={disabled || isLoading}
    >
      <SelectTrigger className="w-full">
        {isLoading ? (
          <div className="flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>טוען תקופות...</span>
          </div>
        ) : (
          <SelectValue placeholder="בחר תקופה" />
        )}
      </SelectTrigger>
      <SelectContent>
        {periods?.map((period) => (
          <SelectItem key={period.periodKey} value={period.periodKey}>
            <div className="flex items-center justify-between w-full gap-4">
              <span>
                {formatPeriodDate(period.periodStartDate)} -{" "}
                {formatPeriodDate(period.periodEndDate)}
              </span>
              {period.hasExistingSession && (
                <Badge variant="secondary" className="text-xs">
                  יש סשן קיים
                </Badge>
              )}
            </div>
          </SelectItem>
        ))}
        {periods?.length === 0 && (
          <div className="p-2 text-sm text-muted-foreground text-center">
            לא נמצאו תקופות עם קבצים
          </div>
        )}
      </SelectContent>
    </Select>
  );
}
