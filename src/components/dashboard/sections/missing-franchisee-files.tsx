"use client";

import { UserX } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ActionSection } from "../shared/action-section";
import { ActionItemRow } from "../shared/action-item-row";
import { CollapsibleContent } from "@/components/ui/collapsible";
import { usePeriodStatus } from "@/queries/dashboard";
import type { PeriodStatusResponse } from "@/app/api/dashboard/period-status/route";

const MAX_PREVIEW = 5;

export function MissingFranchiseeFiles() {
  const { data, isLoading } = usePeriodStatus();
  const periodStatus = (data?.data as PeriodStatusResponse) ?? null;

  const missingFranchisees =
    periodStatus?.reportStatus?.missingFranchiseeDetails || [];

  const previewItems = missingFranchisees.slice(0, MAX_PREVIEW);
  const expandedItems = missingFranchisees.slice(MAX_PREVIEW);

  return (
    <ActionSection
      title="קבצי זכיינים חסרים"
      icon={<UserX className="h-4 w-4 text-amber-600 dark:text-amber-400" />}
      count={missingFranchisees.length}
      linkHref="/admin/franchisees"
      linkText="צפה בהכל"
      emptyMessage="כל הזכיינים שלחו קבצים!"
      maxPreviewItems={MAX_PREVIEW}
      priority="medium"
      isLoading={isLoading}
      totalItems={missingFranchisees.length}
    >
      {previewItems.map((f) => (
        <ActionItemRow
          key={f.id}
          icon={
            <UserX className="h-4 w-4 text-amber-600 dark:text-amber-400" />
          }
          iconBgClass="bg-amber-100 dark:bg-amber-900/50"
          title={f.name}
          subtitle="לא שלח דוח לתקופה הנוכחית"
          href={`/admin/franchisees/${f.id}`}
        />
      ))}
      <CollapsibleContent>
        {expandedItems.map((f) => (
          <ActionItemRow
            key={f.id}
            icon={
              <UserX className="h-4 w-4 text-amber-600 dark:text-amber-400" />
            }
            iconBgClass="bg-amber-100 dark:bg-amber-900/50"
            title={f.name}
            subtitle="לא שלח דוח לתקופה הנוכחית"
            href={`/admin/franchisees/${f.id}`}
          />
        ))}
      </CollapsibleContent>
    </ActionSection>
  );
}
