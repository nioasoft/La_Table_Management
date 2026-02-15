"use client";

import { FileCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ActionSection } from "../shared/action-section";
import { ActionItemRow } from "../shared/action-item-row";
import { usePeriodStatus } from "@/queries/dashboard";
import type { PeriodStatusResponse } from "@/app/api/dashboard/period-status/route";

export function PendingApprovals() {
  const { data, isLoading } = usePeriodStatus();
  const periodStatus = (data?.data as PeriodStatusResponse) ?? null;

  const approvalAction = periodStatus?.pendingActions?.items?.find(
    (i) => i.type === "approval"
  );
  const approvalCount = approvalAction?.count || 0;

  return (
    <ActionSection
      title="ממתינים לאישור"
      icon={
        <FileCheck className="h-4 w-4 text-purple-600 dark:text-purple-400" />
      }
      count={approvalCount}
      linkHref="/admin/settlements"
      linkText="צפה בהכל"
      emptyMessage="אין התחשבנויות ממתינות לאישור"
      priority="high"
      isLoading={isLoading}
    >
      {approvalCount > 0 && (
        <ActionItemRow
          icon={
            <FileCheck className="h-4 w-4 text-purple-600 dark:text-purple-400" />
          }
          iconBgClass="bg-purple-100 dark:bg-purple-900/50"
          title={`${approvalCount} התחשבנויות ממתינות לאישור`}
          subtitle="יש לבדוק ולאשר"
          badge={
            <Badge className="bg-purple-600 text-xs">{approvalCount}</Badge>
          }
          href="/admin/settlements"
        />
      )}
    </ActionSection>
  );
}
