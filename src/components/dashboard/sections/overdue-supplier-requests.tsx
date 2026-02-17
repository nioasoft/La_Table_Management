"use client";

import { useState } from "react";
import { AlertTriangle, Send } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ActionSection } from "../shared/action-section";
import { ActionItemRow } from "../shared/action-item-row";
import { CollapsibleContent } from "@/components/ui/collapsible";
import { useOverdueSuppliers, dashboardKeys } from "@/queries/dashboard";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { OverdueSuppliersResponse } from "@/app/api/dashboard/overdue-suppliers/route";

const MAX_PREVIEW = 5;

function daysSince(dateStr: string | null): number {
  if (!dateStr) return 0;
  const sent = new Date(dateStr);
  const now = new Date();
  return Math.floor((now.getTime() - sent.getTime()) / (1000 * 60 * 60 * 24));
}

function OverdueSupplierRow({
  request,
}: {
  request: OverdueSuppliersResponse["requests"][number];
}) {
  const [isSending, setIsSending] = useState(false);
  const queryClient = useQueryClient();
  const days = daysSince(request.sentAt);

  async function handleSendReminder(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    setIsSending(true);
    try {
      const res = await fetch(`/api/file-requests/${request.id}/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isReminder: true }),
      });
      if (!res.ok) throw new Error("Failed to send reminder");
      toast.success(`תזכורת נשלחה ל-${request.supplierName}`);
      queryClient.invalidateQueries({ queryKey: dashboardKeys.overdueSuppliers() });
    } catch {
      toast.error("שגיאה בשליחת תזכורת");
    } finally {
      setIsSending(false);
    }
  }

  return (
    <div className="flex items-center gap-1">
      <div className="flex-1 min-w-0">
        <ActionItemRow
          icon={
            <AlertTriangle
              className={`h-3.5 w-3.5 ${
                request.escalated
                  ? "text-red-600 dark:text-red-400"
                  : "text-amber-600 dark:text-amber-400"
              }`}
            />
          }
          iconBgClass={
            request.escalated
              ? "bg-red-100 dark:bg-red-900/50"
              : "bg-amber-100 dark:bg-amber-900/50"
          }
          title={request.supplierName}
          subtitle={`${request.periodDescription} · ${request.reminderCount} תזכורות · ${days} ימים`}
          badge={
            request.escalated ? (
              <Badge
                variant="outline"
                className="text-[10px] h-4 px-1.5 text-red-600 dark:text-red-400 border-red-200 dark:border-red-800"
              >
                הועבר לטיפול
              </Badge>
            ) : undefined
          }
          href={`/admin/suppliers/${request.supplierId}`}
        />
      </div>
      {!request.escalated && (
        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-1.5 text-[10px] text-muted-foreground hover:text-blue-600 shrink-0"
          onClick={handleSendReminder}
          disabled={isSending}
          title="שלח תזכורת"
        >
          <Send className="h-3.5 w-3.5" />
        </Button>
      )}
    </div>
  );
}

export function OverdueSupplierRequests() {
  const { data, isLoading } = useOverdueSuppliers();
  const response = data as OverdueSuppliersResponse | undefined;

  const requests = response?.requests || [];
  const totalCount = requests.length;

  const previewItems = requests.slice(0, MAX_PREVIEW);
  const expandedItems = requests.slice(MAX_PREVIEW);

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
      {previewItems.map((request) => (
        <OverdueSupplierRow key={request.id} request={request} />
      ))}
      <CollapsibleContent>
        {expandedItems.map((request) => (
          <OverdueSupplierRow key={request.id} request={request} />
        ))}
      </CollapsibleContent>
    </ActionSection>
  );
}
