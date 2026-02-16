"use client";

import Link from "next/link";
import { FileX } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ActionSection } from "../shared/action-section";
import { CollapsibleContent } from "@/components/ui/collapsible";
import { useSupplierCompleteness } from "@/queries/dashboard";
import type { SupplierCompletenessResponse } from "@/app/api/dashboard/supplier-completeness/route";
import { useDashboardPeriod } from "../dashboard-period-context";

const MAX_PREVIEW = 24; // 6 rows of 4

function SupplierChip({
  supplier,
}: {
  supplier: SupplierCompletenessResponse["suppliers"][number];
}) {
  return (
    <Link href={`/admin/suppliers/${supplier.supplier.id}`}>
      <div className="flex items-center gap-2 py-1.5 px-2 rounded-md hover:bg-muted/60 transition-colors group cursor-pointer">
        <div className="h-6 w-6 rounded-md flex items-center justify-center shrink-0 bg-red-100 dark:bg-red-900/50">
          <FileX className="h-3 w-3 text-red-600 dark:text-red-400" />
        </div>
        <span className="text-sm leading-tight truncate">{supplier.supplier.name}</span>
        <Badge
          variant="outline"
          className="text-[10px] h-4 px-1.5 text-red-600 dark:text-red-400 border-red-200 dark:border-red-800 shrink-0"
        >
          {supplier.stats.missing}
        </Badge>
      </div>
    </Link>
  );
}

export function MissingSupplierFiles() {
  const { year, startDate, endDate } = useDashboardPeriod();
  const { data, isLoading } = useSupplierCompleteness(year, startDate, endDate);
  const response = data as SupplierCompletenessResponse | undefined;

  const missingSuppliers =
    response?.suppliers?.filter((s) => s.stats.missing > 0) || [];

  const previewItems = missingSuppliers.slice(0, MAX_PREVIEW);
  const expandedItems = missingSuppliers.slice(MAX_PREVIEW);

  return (
    <ActionSection
      title="קבצי ספקים חסרים"
      icon={<FileX className="h-4 w-4" />}
      count={missingSuppliers.length}
      linkHref="/admin/supplier-files/completeness"
      linkText="צפה בהכל"
      emptyMessage="כל הספקים שלחו קבצים!"
      maxPreviewItems={MAX_PREVIEW}
      priority="high"
      isLoading={isLoading}
      totalItems={missingSuppliers.length}
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
