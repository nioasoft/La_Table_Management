"use client";

import Link from "next/link";
import { UserX } from "lucide-react";
import { ActionSection } from "../shared/action-section";
import { CollapsibleContent } from "@/components/ui/collapsible";
import { useUploadStatus } from "@/queries/dashboard";
import { useDashboardPeriod } from "../dashboard-period-context";
import type { FranchiseeBkmvStatus } from "@/app/api/dashboard/upload-status/route";

const MAX_PREVIEW = 24; // 6 rows of 4

function FranchiseeChip({ name }: { name: string }) {
  return (
    <Link href="/admin/bkmvdata">
      <div className="flex items-center gap-2 py-1.5 px-2 rounded-md hover:bg-muted/60 transition-colors group cursor-pointer">
        <div className="h-6 w-6 rounded-md flex items-center justify-center shrink-0 bg-amber-100 dark:bg-amber-900/50">
          <UserX className="h-3 w-3 text-amber-600 dark:text-amber-400" />
        </div>
        <span className="text-sm leading-tight truncate">{name}</span>
      </div>
    </Link>
  );
}

export function MissingFranchiseeFiles() {
  const { startDate, endDate } = useDashboardPeriod();
  const { data, isLoading } = useUploadStatus(startDate, endDate);
  const response = data as FranchiseeBkmvStatus | undefined;

  const missingFranchisees = (response?.franchisees ?? []).filter(
    (f) => !f.hasFile
  );

  const previewItems = missingFranchisees.slice(0, MAX_PREVIEW);
  const expandedItems = missingFranchisees.slice(MAX_PREVIEW);

  return (
    <ActionSection
      id="missing-franchisee-files"
      title="קבצי זכיינים חסרים"
      icon={<UserX className="h-4 w-4" />}
      count={missingFranchisees.length}
      linkHref="/admin/bkmvdata"
      linkText="צפה בהכל"
      emptyMessage="כל הזכיינים שלחו קבצים!"
      maxPreviewItems={MAX_PREVIEW}
      priority="medium"
      isLoading={isLoading}
      totalItems={missingFranchisees.length}
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-x-2">
        {previewItems.map((f) => (
          <FranchiseeChip key={f.id} name={f.name} />
        ))}
      </div>
      <CollapsibleContent>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-x-2">
          {expandedItems.map((f) => (
            <FranchiseeChip key={f.id} name={f.name} />
          ))}
        </div>
      </CollapsibleContent>
    </ActionSection>
  );
}
