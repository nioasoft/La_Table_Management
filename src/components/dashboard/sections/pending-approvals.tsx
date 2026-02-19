"use client";

import Link from "next/link";
import { FileCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ActionSection } from "../shared/action-section";
import { CollapsibleContent } from "@/components/ui/collapsible";
import { usePeriodStatus } from "@/queries/dashboard";
import type { PeriodStatusResponse } from "@/app/api/dashboard/period-status/route";
import { useDashboardPeriod } from "../dashboard-period-context";

const MAX_PREVIEW = 24; // 6 rows of 4

type ApprovalDetail = PeriodStatusResponse["pendingApprovalDetails"][number];

function ApprovalChip({ detail }: { detail: ApprovalDetail }) {
  return (
    <Link href={`/admin/reconciliation-v2?sessionId=${detail.sessionId}`}>
      <div className="flex items-center gap-2 py-1.5 px-2 rounded-md hover:bg-muted/60 transition-colors group cursor-pointer">
        <div className="h-6 w-6 rounded-md flex items-center justify-center shrink-0 bg-purple-100 dark:bg-purple-900/50">
          <FileCheck className="h-3 w-3 text-purple-600 dark:text-purple-400" />
        </div>
        <span className="text-sm leading-tight truncate">
          {detail.supplierName}
        </span>
        <Badge
          variant="outline"
          className="text-[10px] h-4 px-1.5 shrink-0 ms-auto text-purple-600 dark:text-purple-400 border-purple-200 dark:border-purple-800"
        >
          ממתין
        </Badge>
      </div>
    </Link>
  );
}

export function PendingApprovals() {
  const { startDate, endDate } = useDashboardPeriod();
  const { data, isLoading } = usePeriodStatus(startDate, endDate);
  const periodStatus = (data?.data as PeriodStatusResponse) ?? null;

  const details = periodStatus?.pendingApprovalDetails ?? [];
  const previewItems = details.slice(0, MAX_PREVIEW);
  const expandedItems = details.slice(MAX_PREVIEW);

  return (
    <ActionSection
      id="pending-approvals"
      title="ממתינים לאישור"
      icon={<FileCheck className="h-4 w-4" />}
      count={details.length}
      linkHref="/admin/reconciliation-v2"
      linkText="צפה בהכל"
      emptyMessage="אין קבצים ממתינים לאישור"
      maxPreviewItems={MAX_PREVIEW}
      priority="high"
      isLoading={isLoading}
      totalItems={details.length}
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-x-2">
        {previewItems.map((d) => (
          <ApprovalChip key={d.sessionId} detail={d} />
        ))}
      </div>
      <CollapsibleContent>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-x-2">
          {expandedItems.map((d) => (
            <ApprovalChip key={d.sessionId} detail={d} />
          ))}
        </div>
      </CollapsibleContent>
    </ActionSection>
  );
}
