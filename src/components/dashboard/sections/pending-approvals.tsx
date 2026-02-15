"use client";

import { FileCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ActionSection } from "../shared/action-section";
import { ActionItemRow } from "../shared/action-item-row";
import { usePeriodStatus } from "@/queries/dashboard";
import type { PeriodStatusResponse } from "@/app/api/dashboard/period-status/route";
import { useDashboardPeriod } from "../dashboard-period-context";

export function PendingApprovals() {
  const { startDate, endDate } = useDashboardPeriod();
  const { data, isLoading } = usePeriodStatus(startDate, endDate);
  const periodStatus = (data?.data as PeriodStatusResponse) ?? null;

  const approvalAction = periodStatus?.pendingActions?.items?.find(
    (i) => i.type === "approval"
  );
  const approvalCount = approvalAction?.count || 0;

  return (
    <ActionSection
      title="ממתינים לאישור"
      icon={<FileCheck className="h-4 w-4" />}
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
            <FileCheck className="h-3.5 w-3.5 text-purple-600 dark:text-purple-400" />
          }
          iconBgClass="bg-purple-100 dark:bg-purple-900/50"
          title={`${approvalCount} התחשבנויות ממתינות לאישור`}
          subtitle="יש לבדוק ולאשר"
          badge={
            <Badge className="bg-purple-500 text-white text-[10px] h-4 px-1.5 hover:bg-purple-500">
              {approvalCount}
            </Badge>
          }
          href="/admin/settlements"
        />
      )}
    </ActionSection>
  );
}
