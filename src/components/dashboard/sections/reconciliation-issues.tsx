"use client";

import { AlertTriangle, Clock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ActionSection } from "../shared/action-section";
import { ActionItemRow } from "../shared/action-item-row";
import { CollapsibleContent } from "@/components/ui/collapsible";
import { usePeriodStatus } from "@/queries/dashboard";
import type { PeriodStatusResponse } from "@/app/api/dashboard/period-status/route";

const MAX_PREVIEW = 5;

export function ReconciliationIssues() {
  const { data, isLoading } = usePeriodStatus();
  const periodStatus = (data?.data as PeriodStatusResponse) ?? null;

  const discrepancyDetails =
    periodStatus?.crossReferenceStatus?.discrepancyDetails || [];
  const pendingCount = periodStatus?.crossReferenceStatus?.pending || 0;
  const discrepancyCount =
    periodStatus?.crossReferenceStatus?.discrepancies || 0;
  const totalIssues = discrepancyCount + pendingCount;

  const formatCurrency = (amount: number) =>
    new Intl.NumberFormat("he-IL", {
      style: "currency",
      currency: "ILS",
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);

  const allItems: Array<{
    key: string;
    type: "discrepancy" | "pending";
    title: string;
    subtitle: string;
    badge?: React.ReactNode;
  }> = [];

  for (const d of discrepancyDetails) {
    allItems.push({
      key: d.crossRefId,
      type: "discrepancy",
      title: `${d.supplierName} ↔ ${d.franchiseeName}`,
      subtitle: `ספק: ${formatCurrency(d.supplierAmount)} · זכיין: ${formatCurrency(d.franchiseeAmount)}`,
      badge: (
        <Badge
          variant="outline"
          className="text-[10px] h-4 px-1.5 text-red-600 dark:text-red-400 border-red-200 dark:border-red-800"
        >
          {formatCurrency(Math.abs(d.difference))}
        </Badge>
      ),
    });
  }

  if (pendingCount > 0) {
    allItems.push({
      key: "pending-summary",
      type: "pending",
      title: `${pendingCount} הצלבות ממתינות`,
      subtitle: "טרם בוצעה השוואה",
    });
  }

  const previewItems = allItems.slice(0, MAX_PREVIEW);
  const expandedItems = allItems.slice(MAX_PREVIEW);

  return (
    <ActionSection
      title="בעיות התאמה"
      icon={<AlertTriangle className="h-4 w-4" />}
      count={totalIssues}
      linkHref="/admin/reconciliation-v2"
      linkText="צפה בהכל"
      emptyMessage="אין בעיות התאמה - הכל תקין!"
      maxPreviewItems={MAX_PREVIEW}
      priority="high"
      isLoading={isLoading}
      totalItems={allItems.length}
    >
      {previewItems.map((item) => (
        <ActionItemRow
          key={item.key}
          icon={
            item.type === "discrepancy" ? (
              <AlertTriangle className="h-3.5 w-3.5 text-red-600 dark:text-red-400" />
            ) : (
              <Clock className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
            )
          }
          iconBgClass={
            item.type === "discrepancy"
              ? "bg-red-100 dark:bg-red-900/50"
              : "bg-blue-100 dark:bg-blue-900/50"
          }
          title={item.title}
          subtitle={item.subtitle}
          badge={item.badge}
          href="/admin/reconciliation-v2"
        />
      ))}
      <CollapsibleContent>
        {expandedItems.map((item) => (
          <ActionItemRow
            key={item.key}
            icon={
              item.type === "discrepancy" ? (
                <AlertTriangle className="h-3.5 w-3.5 text-red-600 dark:text-red-400" />
              ) : (
                <Clock className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
              )
            }
            iconBgClass={
              item.type === "discrepancy"
                ? "bg-red-100 dark:bg-red-900/50"
                : "bg-blue-100 dark:bg-blue-900/50"
            }
            title={item.title}
            subtitle={item.subtitle}
            badge={item.badge}
            href="/admin/reconciliation-v2"
          />
        ))}
      </CollapsibleContent>
    </ActionSection>
  );
}
