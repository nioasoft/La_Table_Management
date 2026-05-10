"use client";

import {
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ComparisonRow } from "./ComparisonRow";
import type { ReconciliationComparisonWithDetails } from "@/types/reconciliation-v2";

interface ComparisonTableProps {
  comparisons: ReconciliationComparisonWithDetails[];
  onApprove?: (comparisonId: string) => void;
  onSendToReview?: (comparisonId: string) => void;
  onRefresh?: (comparisonId: string) => void;
  isUpdating?: boolean;
  /** Comparison id currently being refreshed, so only that row spins. */
  refreshingComparisonId?: string | null;
}

export function ComparisonTable({
  comparisons,
  onApprove,
  onSendToReview,
  onRefresh,
  isUpdating,
  refreshingComparisonId,
}: ComparisonTableProps) {
  if (comparisons.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        אין השוואות לתצוגה
      </div>
    );
  }

  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-[200px]">זכיין</TableHead>
            <TableHead className="w-[120px]">סכום ספק</TableHead>
            <TableHead className="w-[120px]">סכום זכיין</TableHead>
            <TableHead className="w-[120px]">הפרש</TableHead>
            <TableHead className="w-[120px]">סטטוס</TableHead>
            <TableHead className="w-[180px]">פעולות</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {comparisons.map((comparison) => (
            <ComparisonRow
              key={comparison.id}
              comparison={comparison}
              onApprove={onApprove}
              onSendToReview={onSendToReview}
              onRefresh={onRefresh}
              isUpdating={isUpdating}
              isRefreshing={refreshingComparisonId === comparison.id}
            />
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
