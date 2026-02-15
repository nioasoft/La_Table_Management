"use client";

import { FileX } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ActionSection } from "../shared/action-section";
import { ActionItemRow } from "../shared/action-item-row";
import { CollapsibleContent } from "@/components/ui/collapsible";
import { useSupplierCompleteness } from "@/queries/dashboard";
import type { SupplierCompletenessResponse } from "@/app/api/dashboard/supplier-completeness/route";

const MAX_PREVIEW = 5;

export function MissingSupplierFiles() {
  const { data, isLoading } = useSupplierCompleteness();
  const response = data as SupplierCompletenessResponse | undefined;

  const missingSuppliers =
    response?.suppliers?.filter((s) => s.stats.missing > 0) || [];

  const previewItems = missingSuppliers.slice(0, MAX_PREVIEW);
  const expandedItems = missingSuppliers.slice(MAX_PREVIEW);

  return (
    <ActionSection
      title="קבצי ספקים חסרים"
      icon={<FileX className="h-4 w-4 text-red-600 dark:text-red-400" />}
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
        <ActionItemRow
          key={s.supplier.id}
          icon={
            <FileX className="h-4 w-4 text-red-600 dark:text-red-400" />
          }
          iconBgClass="bg-red-100 dark:bg-red-900/50"
          title={s.supplier.name}
          subtitle={s.brands.map((b) => b.nameHe).join(", ")}
          badge={
            <Badge
              variant="outline"
              className="text-xs text-red-600 dark:text-red-400 border-red-200 dark:border-red-800"
            >
              {s.stats.missing} חסרים
            </Badge>
          }
          href={`/admin/suppliers/${s.supplier.id}`}
        />
      ))}
      <CollapsibleContent>
        {expandedItems.map((s) => (
          <ActionItemRow
            key={s.supplier.id}
            icon={
              <FileX className="h-4 w-4 text-red-600 dark:text-red-400" />
            }
            iconBgClass="bg-red-100 dark:bg-red-900/50"
            title={s.supplier.name}
            subtitle={s.brands.map((b) => b.nameHe).join(", ")}
            badge={
              <Badge
                variant="outline"
                className="text-xs text-red-600 dark:text-red-400 border-red-200 dark:border-red-800"
              >
                {s.stats.missing} חסרים
              </Badge>
            }
            href={`/admin/suppliers/${s.supplier.id}`}
          />
        ))}
      </CollapsibleContent>
    </ActionSection>
  );
}
