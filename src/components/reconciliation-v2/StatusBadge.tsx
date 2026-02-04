"use client";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { ReconciliationComparisonStatus, ReconciliationSessionStatus } from "@/db/schema";

interface StatusBadgeProps {
  status: ReconciliationComparisonStatus | ReconciliationSessionStatus | "pending" | "resolved";
  className?: string;
}

const statusConfig: Record<string, { label: string; variant: "default" | "success" | "warning" | "destructive" | "secondary" | "info" }> = {
  // Comparison statuses
  pending: { label: "ממתין", variant: "secondary" },
  auto_approved: { label: "אושר אוטומטית", variant: "success" },
  needs_review: { label: "לבדיקה", variant: "warning" },
  manually_approved: { label: "אושר ידנית", variant: "success" },
  sent_to_review_queue: { label: "בתור בדיקה", variant: "info" },
  // Session statuses
  in_progress: { label: "בתהליך", variant: "info" },
  completed: { label: "הושלם", variant: "success" },
  file_approved: { label: "קובץ אושר", variant: "success" },
  file_rejected: { label: "קובץ נדחה", variant: "destructive" },
  // Queue statuses
  resolved: { label: "נפתר", variant: "success" },
};

export function StatusBadge({ status, className }: StatusBadgeProps) {
  const config = statusConfig[status] || { label: status, variant: "secondary" as const };

  return (
    <Badge variant={config.variant} className={cn(className)}>
      {config.label}
    </Badge>
  );
}
