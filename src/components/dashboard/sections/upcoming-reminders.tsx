"use client";

import { Bell, CalendarClock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ActionSection } from "../shared/action-section";
import { ActionItemRow } from "../shared/action-item-row";
import { CollapsibleContent } from "@/components/ui/collapsible";
import { useUpcomingReminders } from "@/queries/dashboard";

const MAX_PREVIEW = 5;

const reminderTypeLabels: Record<string, string> = {
  lease_option: "אופציית שכירות",
  franchise_agreement: "הסכם זכיינות",
  custom: "מותאם אישית",
};

function getDaysUntil(dateStr: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(dateStr);
  target.setHours(0, 0, 0, 0);
  return Math.ceil((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

function getUrgencyStyle(daysUntil: number) {
  if (daysUntil < 0)
    return {
      text: "באיחור",
      className:
        "text-red-600 dark:text-red-400 border-red-200 dark:border-red-800",
      iconBg: "bg-red-100 dark:bg-red-900/50",
      iconColor: "text-red-600 dark:text-red-400",
    };
  if (daysUntil <= 7)
    return {
      text: `${daysUntil} ימים`,
      className:
        "text-amber-600 dark:text-amber-400 border-amber-200 dark:border-amber-800",
      iconBg: "bg-amber-100 dark:bg-amber-900/50",
      iconColor: "text-amber-600 dark:text-amber-400",
    };
  return {
    text: `${daysUntil} ימים`,
    className: "text-muted-foreground",
    iconBg: "bg-blue-100 dark:bg-blue-900/50",
    iconColor: "text-blue-600 dark:text-blue-400",
  };
}

export function UpcomingReminders() {
  const { data, isLoading } = useUpcomingReminders(30, 10);

  const reminders = data?.reminders || [];
  const totalCount = reminders.length;

  const previewItems = reminders.slice(0, MAX_PREVIEW);
  const expandedItems = reminders.slice(MAX_PREVIEW);

  return (
    <ActionSection
      title="תזכורות קרובות"
      icon={<Bell className="h-4 w-4 text-orange-600 dark:text-orange-400" />}
      count={totalCount}
      linkHref="/admin/franchisee-reminders"
      linkText="צפה בהכל"
      emptyMessage="אין תזכורות קרובות!"
      maxPreviewItems={MAX_PREVIEW}
      priority="low"
      isLoading={isLoading}
      totalItems={totalCount}
    >
      {previewItems.map((reminder) => {
        const daysUntil = getDaysUntil(reminder.reminderDate);
        const urgency = getUrgencyStyle(daysUntil);
        const typeLabel =
          reminderTypeLabels[reminder.reminderType] || reminder.reminderType;

        return (
          <ActionItemRow
            key={reminder.id}
            icon={
              <CalendarClock
                className={`h-4 w-4 ${urgency.iconColor}`}
              />
            }
            iconBgClass={urgency.iconBg}
            title={reminder.franchisee?.name || "לא ידוע"}
            subtitle={`${typeLabel} - ${new Date(reminder.reminderDate).toLocaleDateString("he-IL")}`}
            badge={
              <Badge
                variant="outline"
                className={`text-xs ${urgency.className}`}
              >
                {urgency.text}
              </Badge>
            }
            href="/admin/franchisee-reminders"
          />
        );
      })}
      <CollapsibleContent>
        {expandedItems.map((reminder) => {
          const daysUntil = getDaysUntil(reminder.reminderDate);
          const urgency = getUrgencyStyle(daysUntil);
          const typeLabel =
            reminderTypeLabels[reminder.reminderType] || reminder.reminderType;

          return (
            <ActionItemRow
              key={reminder.id}
              icon={
                <CalendarClock
                  className={`h-4 w-4 ${urgency.iconColor}`}
                />
              }
              iconBgClass={urgency.iconBg}
              title={reminder.franchisee?.name || "לא ידוע"}
              subtitle={`${typeLabel} - ${new Date(reminder.reminderDate).toLocaleDateString("he-IL")}`}
              badge={
                <Badge
                  variant="outline"
                  className={`text-xs ${urgency.className}`}
                >
                  {urgency.text}
                </Badge>
              }
              href="/admin/franchisee-reminders"
            />
          );
        })}
      </CollapsibleContent>
    </ActionSection>
  );
}
