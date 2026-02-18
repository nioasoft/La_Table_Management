"use client";

import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ActionSection } from "../shared/action-section";
import { CollapsibleContent } from "@/components/ui/collapsible";
import { useOverdueSuppliers } from "@/queries/dashboard";
import type {
  OverdueSupplierGroup,
  OverdueSuppliersResponse,
} from "@/app/api/dashboard/overdue-suppliers/route";

const MAX_PREVIEW = 24; // 6 rows × 4 cols

function SupplierChip({ supplier }: { supplier: OverdueSupplierGroup }) {
  return (
    <Link href={`/admin/suppliers/${supplier.supplierId}`}>
      <div className="flex items-center gap-2 py-1.5 px-2 rounded-md hover:bg-muted/60 transition-colors group cursor-pointer">
        <div
          className={`h-6 w-6 rounded-md flex items-center justify-center shrink-0 ${
            supplier.escalated
              ? "bg-red-100 dark:bg-red-900/50"
              : "bg-amber-100 dark:bg-amber-900/50"
          }`}
        >
          <AlertTriangle
            className={`h-3 w-3 ${
              supplier.escalated
                ? "text-red-600 dark:text-red-400"
                : "text-amber-600 dark:text-amber-400"
            }`}
          />
        </div>
        <span className="text-sm leading-tight truncate">
          {supplier.supplierName}
        </span>
        <Badge
          variant="outline"
          className={`text-[10px] h-4 px-1.5 shrink-0 ${
            supplier.escalated
              ? "text-red-600 dark:text-red-400 border-red-200 dark:border-red-800"
              : "text-amber-600 dark:text-amber-400 border-amber-200 dark:border-amber-800"
          }`}
        >
          {supplier.pendingPeriods}
        </Badge>
      </div>
    </Link>
  );
}

export function OverdueSupplierRequests() {
  const { data, isLoading } = useOverdueSuppliers();
  const response = data as OverdueSuppliersResponse | undefined;

  const suppliers = response?.suppliers || [];
  const totalCount = suppliers.length;

  const previewItems = suppliers.slice(0, MAX_PREVIEW);
  const expandedItems = suppliers.slice(MAX_PREVIEW);

  return (
    <ActionSection
      title="ספקים שלא הגישו דוחות"
      icon={<AlertTriangle className="h-4 w-4" />}
      count={totalCount}
      linkHref="/admin/supplier-files"
      linkText="צפה בהכל"
      emptyMessage="כל הספקים הגישו דוחות!"
      maxPreviewItems={MAX_PREVIEW}
      priority="high"
      isLoading={isLoading}
      totalItems={totalCount}
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-x-2">
        {previewItems.map((supplier) => (
          <SupplierChip key={supplier.supplierId} supplier={supplier} />
        ))}
      </div>
      <CollapsibleContent>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-x-2">
          {expandedItems.map((supplier) => (
            <SupplierChip key={supplier.supplierId} supplier={supplier} />
          ))}
        </div>
      </CollapsibleContent>
    </ActionSection>
  );
}
