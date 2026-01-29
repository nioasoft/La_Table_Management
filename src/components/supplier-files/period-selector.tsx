"use client";

import * as React from "react";
import { Calendar, Check, FileText, AlertCircle, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import type { PeriodWithStatus } from "@/app/api/supplier-files/periods/[supplierId]/route";
import { formatPeriodRange } from "@/lib/settlement-periods";

interface PeriodSelectorProps {
  supplierId: string;
  supplierName?: string;
  selectedPeriodKey: string;
  onSelect: (periodKey: string) => void;
  onPeriodWithExistingFile?: (period: PeriodWithStatus) => void;
  disabled?: boolean;
}

// Helper to get status badge
function getStatusBadge(status: string) {
  switch (status) {
    case "approved":
    case "auto_approved":
      return (
        <Badge variant="success" className="text-xs gap-1">
          <Check className="h-3 w-3" />
          אושר
        </Badge>
      );
    case "needs_review":
      return (
        <Badge variant="warning" className="text-xs gap-1">
          <Clock className="h-3 w-3" />
          ממתין
        </Badge>
      );
    default:
      return null;
  }
}

export function PeriodSelector({
  supplierId,
  supplierName,
  selectedPeriodKey,
  onSelect,
  onPeriodWithExistingFile,
  disabled = false,
}: PeriodSelectorProps) {
  const [periods, setPeriods] = React.useState<PeriodWithStatus[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Fetch periods when supplier changes
  React.useEffect(() => {
    if (!supplierId) {
      setPeriods([]);
      return;
    }

    const fetchPeriods = async () => {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch(`/api/supplier-files/periods/${supplierId}`);
        if (!response.ok) {
          throw new Error("Failed to fetch periods");
        }
        const data = await response.json();
        setPeriods(data.periods || []);
      } catch (err) {
        console.error("Error fetching periods:", err);
        setError("שגיאה בטעינת תקופות");
        setPeriods([]);
      } finally {
        setLoading(false);
      }
    };

    fetchPeriods();
  }, [supplierId]);

  // Auto-select the latest period when periods are loaded and no selection exists
  React.useEffect(() => {
    if (periods.length > 0 && !selectedPeriodKey) {
      // periods[0] is the latest period (sorted by endDate descending)
      onSelect(periods[0].key);
    }
  }, [periods, selectedPeriodKey, onSelect]);

  // Handle selection
  const handleSelect = (periodKey: string) => {
    const selectedPeriod = periods.find((p) => p.key === periodKey);

    // If the period has an existing file, notify the parent
    if (selectedPeriod?.hasFile && selectedPeriod?.existingFile && onPeriodWithExistingFile) {
      onPeriodWithExistingFile(selectedPeriod);
    }

    onSelect(periodKey);
  };

  const selectedPeriod = periods.find((p) => p.key === selectedPeriodKey);

  if (loading) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-10 w-full" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center gap-2 text-destructive p-3 bg-destructive/10 rounded-md">
        <AlertCircle className="h-4 w-4" />
        <span className="text-sm">{error}</span>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <Select
        value={selectedPeriodKey}
        onValueChange={handleSelect}
        disabled={disabled || periods.length === 0}
      >
        <SelectTrigger className="w-full">
          <SelectValue placeholder="בחר תקופה...">
            {selectedPeriod && (
              <div className="flex items-center gap-2">
                <Calendar className="h-4 w-4 text-muted-foreground" />
                <span>{selectedPeriod.nameHe}</span>
                {selectedPeriod.hasFile && getStatusBadge(selectedPeriod.existingFile?.status || "")}
              </div>
            )}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {periods.map((period) => (
            <SelectItem key={period.key} value={period.key}>
              <div className="flex items-center justify-between w-full gap-4">
                <div className="flex items-center gap-2">
                  <Calendar className="h-4 w-4 text-muted-foreground" />
                  <span>{period.nameHe}</span>
                </div>
                <div className="flex items-center gap-2">
                  {period.hasFile ? (
                    <>
                      <FileText className="h-4 w-4 text-muted-foreground" />
                      {getStatusBadge(period.existingFile?.status || "")}
                    </>
                  ) : (
                    <Badge variant="outline" className="text-xs text-muted-foreground">
                      חסר
                    </Badge>
                  )}
                </div>
              </div>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Selected Period Info */}
      {selectedPeriod && (
        <div className="text-sm text-muted-foreground px-1 space-y-1">
          <div className="flex items-center gap-2">
            <span>טווח תאריכים:</span>
            <span className="font-medium">{formatPeriodRange(selectedPeriod)}</span>
          </div>
          {selectedPeriod.hasFile && selectedPeriod.existingFile && (
            <div className="flex items-center gap-2 text-amber-600 dark:text-amber-500">
              <AlertCircle className="h-4 w-4" />
              <span>
                קיים קובץ לתקופה זו: {selectedPeriod.existingFile.fileName}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Export the period data type for use in other components
export type { PeriodWithStatus };
