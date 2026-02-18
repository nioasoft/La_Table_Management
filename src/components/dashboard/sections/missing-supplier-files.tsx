"use client";

import Link from "next/link";
import { FileX, Clock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ActionSection } from "../shared/action-section";
import { CollapsibleContent } from "@/components/ui/collapsible";
import { useSupplierCompleteness } from "@/queries/dashboard";
import type { SupplierCompletenessResponse } from "@/app/api/dashboard/supplier-completeness/route";
import { useDashboardPeriod } from "../dashboard-period-context";

const MAX_PREVIEW = 24; // 6 rows of 4

type SupplierEntry = SupplierCompletenessResponse["suppliers"][number];

function SupplierChip({ supplier }: { supplier: SupplierEntry }) {
  const hasMissing = supplier.stats.missing > 0;
  const isPendingOnly = !hasMissing && supplier.stats.pending > 0;
  const incompleteCount = supplier.stats.missing + supplier.stats.pending;

  const colorClasses = hasMissing
    ? {
        iconBg: "bg-red-100 dark:bg-red-900/50",
        iconText: "text-red-600 dark:text-red-400",
        badgeText:
          "text-red-600 dark:text-red-400 border-red-200 dark:border-red-800",
      }
    : {
        iconBg: "bg-amber-100 dark:bg-amber-900/50",
        iconText: "text-amber-600 dark:text-amber-400",
        badgeText:
          "text-amber-600 dark:text-amber-400 border-amber-200 dark:border-amber-800",
      };

  const Icon = hasMissing ? FileX : Clock;

  return (
    <Link href={`/admin/suppliers/${supplier.supplier.id}`}>
      <div className="flex items-center gap-2 py-1.5 px-2 rounded-md hover:bg-muted/60 transition-colors group cursor-pointer">
        <div
          className={`h-6 w-6 rounded-md flex items-center justify-center shrink-0 ${colorClasses.iconBg}`}
        >
          <Icon className={`h-3 w-3 ${colorClasses.iconText}`} />
        </div>
        <div className="flex flex-col min-w-0">
          <span className="text-sm leading-tight truncate">
            {supplier.supplier.name}
          </span>
          {isPendingOnly && (
            <span className="text-[10px] leading-tight text-amber-600 dark:text-amber-400">
              ממתין לאישור
            </span>
          )}
        </div>
        <Badge
          variant="outline"
          className={`text-[10px] h-4 px-1.5 shrink-0 ms-auto ${colorClasses.badgeText}`}
        >
          {incompleteCount}
        </Badge>
      </div>
    </Link>
  );
}

export function MissingSupplierFiles() {
  const { year, startDate, endDate } = useDashboardPeriod();
  const { data, isLoading } = useSupplierCompleteness(year, startDate, endDate);
  const response = data as SupplierCompletenessResponse | undefined;

  const incompleteSuppliers = (
    response?.suppliers?.filter(
      (s) => s.stats.missing > 0 || s.stats.pending > 0
    ) || []
  ).sort((a, b) => {
    // Missing-first (red), then pending-only (amber)
    const aMissing = a.stats.missing > 0 ? 1 : 0;
    const bMissing = b.stats.missing > 0 ? 1 : 0;
    if (aMissing !== bMissing) return bMissing - aMissing;
    // Within same group, sort by total incomplete count descending
    const aCount = a.stats.missing + a.stats.pending;
    const bCount = b.stats.missing + b.stats.pending;
    return bCount - aCount;
  });

  const previewItems = incompleteSuppliers.slice(0, MAX_PREVIEW);
  const expandedItems = incompleteSuppliers.slice(MAX_PREVIEW);

  return (
    <ActionSection
      title="קבצי ספקים חסרים"
      icon={<FileX className="h-4 w-4" />}
      count={incompleteSuppliers.length}
      linkHref="/admin/supplier-files/completeness"
      linkText="צפה בהכל"
      emptyMessage="כל הספקים שלחו קבצים!"
      maxPreviewItems={MAX_PREVIEW}
      priority="high"
      isLoading={isLoading}
      totalItems={incompleteSuppliers.length}
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-x-2">
        {previewItems.map((s) => (
          <SupplierChip key={s.supplier.id} supplier={s} />
        ))}
      </div>
      <CollapsibleContent>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-x-2">
          {expandedItems.map((s) => (
            <SupplierChip key={s.supplier.id} supplier={s} />
          ))}
        </div>
      </CollapsibleContent>
    </ActionSection>
  );
}
