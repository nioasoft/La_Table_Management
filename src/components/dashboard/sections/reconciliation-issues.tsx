"use client";

import Link from "next/link";
import { AlertTriangle, Clock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ActionSection } from "../shared/action-section";
import { CollapsibleContent } from "@/components/ui/collapsible";
import { usePeriodStatus } from "@/queries/dashboard";
import type { PeriodStatusResponse } from "@/app/api/dashboard/period-status/route";
import { useDashboardPeriod } from "../dashboard-period-context";

const MAX_PREVIEW = 24; // 6 rows of 4

type DiscrepancyItem = {
  key: string;
  type: "discrepancy" | "pending";
  title: string;
  subtitle: string;
  difference?: number;
  href: string;
};

const formatCurrency = (amount: number) =>
  new Intl.NumberFormat("he-IL", {
    style: "currency",
    currency: "ILS",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);

function IssueChip({ item }: { item: DiscrepancyItem }) {
  const isDiscrepancy = item.type === "discrepancy";
  const colorClasses = isDiscrepancy
    ? {
        iconBg: "bg-red-100 dark:bg-red-900/50",
        iconText: "text-red-600 dark:text-red-400",
        badgeText:
          "text-red-600 dark:text-red-400 border-red-200 dark:border-red-800",
      }
    : {
        iconBg: "bg-blue-100 dark:bg-blue-900/50",
        iconText: "text-blue-600 dark:text-blue-400",
        badgeText:
          "text-blue-600 dark:text-blue-400 border-blue-200 dark:border-blue-800",
      };

  const Icon = isDiscrepancy ? AlertTriangle : Clock;

  return (
    <Link href={item.href}>
      <div className="flex items-center gap-2 py-1.5 px-2 rounded-md hover:bg-muted/60 transition-colors group cursor-pointer">
        <div
          className={`h-6 w-6 rounded-md flex items-center justify-center shrink-0 ${colorClasses.iconBg}`}
        >
          <Icon className={`h-3 w-3 ${colorClasses.iconText}`} />
        </div>
        <div className="flex flex-col min-w-0">
          <span className="text-sm leading-tight truncate">{item.title}</span>
          <span className="text-[10px] leading-tight text-muted-foreground truncate">
            {item.subtitle}
          </span>
        </div>
        {item.difference != null && (
          <Badge
            variant="outline"
            className={`text-[10px] h-4 px-1.5 shrink-0 ms-auto ${colorClasses.badgeText}`}
          >
            {formatCurrency(Math.abs(item.difference))}
          </Badge>
        )}
      </div>
    </Link>
  );
}

export function ReconciliationIssues() {
  const { startDate, endDate } = useDashboardPeriod();
  const { data, isLoading } = usePeriodStatus(startDate, endDate);
  const periodStatus = (data?.data as PeriodStatusResponse) ?? null;

  const discrepancyDetails =
    periodStatus?.crossReferenceStatus?.discrepancyDetails || [];
  const pendingCount = periodStatus?.crossReferenceStatus?.pending || 0;
  const discrepancyCount =
    periodStatus?.crossReferenceStatus?.discrepancies || 0;
  const totalIssues = discrepancyCount + pendingCount;
  // No sessions at all for this period != everything reconciled cleanly
  const hasNoSessions = (periodStatus?.crossReferenceStatus?.total ?? 0) === 0;

  const allItems: DiscrepancyItem[] = [];

  for (const d of discrepancyDetails) {
    allItems.push({
      key: d.crossRefId,
      type: "discrepancy",
      title: `${d.supplierName} ↔ ${d.franchiseeName}`,
      subtitle: `ספק: ${formatCurrency(d.supplierAmount)} · זכיין: ${formatCurrency(d.franchiseeAmount)}`,
      difference: d.difference,
      href: "/admin/reconciliation-v2",
    });
  }

  if (pendingCount > 0) {
    allItems.push({
      key: "pending-summary",
      type: "pending",
      title: `${pendingCount} הצלבות ממתינות`,
      subtitle: "טרם בוצעה השוואה",
      href: "/admin/reconciliation-v2",
    });
  }

  const previewItems = allItems.slice(0, MAX_PREVIEW);
  const expandedItems = allItems.slice(MAX_PREVIEW);

  return (
    <ActionSection
      id="reconciliation-issues"
      title="בעיות התאמה"
      icon={<AlertTriangle className="h-4 w-4" />}
      count={totalIssues}
      linkHref="/admin/reconciliation-v2"
      linkText="צפה בהכל"
      emptyMessage={
        hasNoSessions
          ? "טרם בוצעה הצלבה לתקופה זו"
          : "אין בעיות התאמה - הכל תקין!"
      }
      emptyTone={hasNoSessions ? "neutral" : "success"}
      maxPreviewItems={MAX_PREVIEW}
      priority="high"
      isLoading={isLoading}
      totalItems={allItems.length}
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-x-2">
        {previewItems.map((item) => (
          <IssueChip key={item.key} item={item} />
        ))}
      </div>
      <CollapsibleContent>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-x-2">
          {expandedItems.map((item) => (
            <IssueChip key={item.key} item={item} />
          ))}
        </div>
      </CollapsibleContent>
    </ActionSection>
  );
}
