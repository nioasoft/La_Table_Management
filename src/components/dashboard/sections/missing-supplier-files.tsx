"use client";

import { FileX } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ActionSection } from "../shared/action-section";
import { ActionItemRow } from "../shared/action-item-row";
import { CollapsibleContent } from "@/components/ui/collapsible";
import { useSupplierCompleteness } from "@/queries/dashboard";
import type { SupplierCompletenessResponse } from "@/app/api/dashboard/supplier-completeness/route";
import { useDashboardPeriod } from "../dashboard-period-context";

const MAX_PREVIEW = 5;

function SupplierRow({
  supplier,
}: {
  supplier: SupplierCompletenessResponse["suppliers"][number];
}) {
  return (
    <ActionItemRow
      icon={<FileX className="h-3.5 w-3.5 text-red-600 dark:text-red-400" />}
      iconBgClass="bg-red-100 dark:bg-red-900/50"
      title={supplier.supplier.name}
      subtitle={supplier.brands.map((b) => b.nameHe).join(", ")}
      badge={
        <Badge
          variant="outline"
          className="text-[10px] h-4 px-1.5 text-red-600 dark:text-red-400 border-red-200 dark:border-red-800"
        >
          {supplier.stats.missing} חסרים
        </Badge>
      }
      href={`/admin/suppliers/${supplier.supplier.id}`}
    />
  );
}

export function MissingSupplierFiles() {
  const { year } = useDashboardPeriod();
  const { data, isLoading } = useSupplierCompleteness(year);
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
      {previewItems.map((s) => (
        <SupplierRow key={s.supplier.id} supplier={s} />
      ))}
      <CollapsibleContent>
        {expandedItems.map((s) => (
          <SupplierRow key={s.supplier.id} supplier={s} />
        ))}
      </CollapsibleContent>
    </ActionSection>
  );
}
