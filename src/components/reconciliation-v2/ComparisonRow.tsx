"use client";

import { Button } from "@/components/ui/button";
import { StatusBadge } from "./StatusBadge";
import { cn } from "@/lib/utils";
import { Check, AlertTriangle } from "lucide-react";
import type { ReconciliationComparisonWithDetails } from "@/types/reconciliation-v2";
import { RECONCILIATION_THRESHOLD } from "@/types/reconciliation-v2";

interface ComparisonRowProps {
  comparison: ReconciliationComparisonWithDetails;
  onApprove?: (comparisonId: string) => void;
  onSendToReview?: (comparisonId: string) => void;
  isUpdating?: boolean;
}

function formatCurrency(amount: string | number | null): string {
  if (amount === null) return "₪0";
  const num = typeof amount === "string" ? parseFloat(amount) : amount;
  return new Intl.NumberFormat("he-IL", {
    style: "currency",
    currency: "ILS",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(num);
}

export function ComparisonRow({
  comparison,
  onApprove,
  onSendToReview,
  isUpdating,
}: ComparisonRowProps) {
  const absoluteDiff = parseFloat(comparison.absoluteDifference || "0");
  const isWithinThreshold = absoluteDiff <= RECONCILIATION_THRESHOLD;
  const isApproved =
    comparison.status === "auto_approved" ||
    comparison.status === "manually_approved";
  const needsReview = comparison.status === "needs_review";
  const inQueue = comparison.status === "sent_to_review_queue";

  return (
    <tr
      className={cn(
        "border-b transition-colors",
        isApproved && "bg-green-50/50 dark:bg-green-950/20",
        needsReview && "bg-amber-50/50 dark:bg-amber-950/20",
        inQueue && "bg-blue-50/50 dark:bg-blue-950/20"
      )}
    >
      {/* Franchisee Name */}
      <td className="px-4 py-3">
        <div className="flex flex-col">
          <span className="font-medium">{comparison.franchiseeName}</span>
          <span className="text-xs text-muted-foreground">
            {comparison.brandName || "-"}
          </span>
        </div>
      </td>

      {/* Supplier Amount */}
      <td className="px-4 py-3 text-start font-mono">
        {formatCurrency(comparison.supplierAmount)}
      </td>

      {/* Franchisee Amount */}
      <td className="px-4 py-3 text-start font-mono">
        {formatCurrency(comparison.franchiseeAmount)}
      </td>

      {/* Difference */}
      <td
        className={cn(
          "px-4 py-3 text-start font-mono font-medium",
          isWithinThreshold ? "text-green-600" : "text-red-600"
        )}
      >
        {formatCurrency(comparison.difference)}
      </td>

      {/* Status */}
      <td className="px-4 py-3">
        <StatusBadge status={comparison.status} />
      </td>

      {/* Actions */}
      <td className="px-4 py-3">
        {needsReview && (
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => onApprove?.(comparison.id)}
              disabled={isUpdating}
              className="h-8"
            >
              <Check className="h-4 w-4 me-1" />
              אישור
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => onSendToReview?.(comparison.id)}
              disabled={isUpdating}
              className="h-8"
            >
              <AlertTriangle className="h-4 w-4 me-1" />
              לבדיקה
            </Button>
          </div>
        )}
        {isApproved && (
          <span className="text-sm text-green-600 flex items-center gap-1">
            <Check className="h-4 w-4" />
            מאושר
          </span>
        )}
        {inQueue && (
          <span className="text-sm text-blue-600">בתור בדיקה</span>
        )}
      </td>
    </tr>
  );
}
