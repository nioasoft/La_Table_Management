"use client";

import Link from "next/link";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AlertTriangle,
  Bell,
  Calendar,
  Clock,
  RefreshCw,
  ChevronRight,
  FileText,
  Home,
  Tag,
} from "lucide-react";
import type { FranchiseeReminderType } from "@/db/schema";
import { he, formatDate as formatHebrewDate } from "@/lib/translations";
import { useUpcomingReminders } from "@/queries/dashboard";

interface ReminderItem {
  id: string;
  title: string;
  reminderType: FranchiseeReminderType;
  reminderDate: string;
  notificationDate: string;
  franchisee?: {
    name: string;
  };
}

const t = he.dashboard.reminders;

const reminderTypeLabels: Record<FranchiseeReminderType, string> = {
  lease_option: t.types.leaseOption,
  franchise_agreement: t.types.franchiseAgreement,
  custom: t.types.custom,
};

const reminderTypeColors: Record<FranchiseeReminderType, "info" | "warning" | "secondary"> = {
  lease_option: "info",
  franchise_agreement: "warning",
  custom: "secondary",
};

const reminderTypeIcons: Record<FranchiseeReminderType, typeof Home> = {
  lease_option: Home,
  franchise_agreement: FileText,
  custom: Tag,
};

export function UpcomingRemindersWidget() {
  const { data, isLoading, error, refetch } = useUpcomingReminders();

  // Don't show widget if user doesn't have permission (403 error)
  if (error && (error as any)?.message?.includes("403")) {
    return null;
  }

  if (isLoading) {
    return (
      <Card data-testid="upcoming-reminders-loading">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <RefreshCw className="h-5 w-5 animate-spin" />
            {t.loadingReminders}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-8">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card data-testid="upcoming-reminders-error">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="h-5 w-5" />
            {t.errorLoadingReminders}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground mb-4">
            {t.unableToLoad}
          </p>
          <Button variant="outline" onClick={() => refetch()}>
            <RefreshCw className="ml-2 h-4 w-4" />
            {he.common.retry}
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (!data) {
    return null;
  }

  const hasReminders = data.reminders.length > 0;

  const formatDate = (dateString: string) => {
    return formatHebrewDate(dateString, {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  };

  const getDaysUntil = (dateString: string) => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const targetDate = new Date(dateString);
    targetDate.setHours(0, 0, 0, 0);
    const diffTime = targetDate.getTime() - today.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays;
  };

  const getUrgencyBadge = (notificationDate: string, reminderDate: string) => {
    const daysUntilNotification = getDaysUntil(notificationDate);
    const daysUntilReminder = getDaysUntil(reminderDate);

    if (daysUntilNotification <= 0) {
      return <Badge variant="destructive">{t.urgency.overdue}</Badge>;
    }
    if (daysUntilReminder <= 7) {
      return <Badge variant="destructive">{t.urgency.dueSoon}</Badge>;
    }
    if (daysUntilNotification <= 7) {
      return <Badge variant="warning">{t.urgency.thisWeek}</Badge>;
    }
    return <Badge variant="info">{t.urgency.upcoming}</Badge>;
  };

  return (
    <Card data-testid="upcoming-reminders-widget">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Bell className="h-5 w-5" />
              {t.title}
            </CardTitle>
            <CardDescription>
              {t.description}
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => refetch()}
              className="h-8 w-8 p-0"
              title={he.common.refresh}
            >
              <RefreshCw className="h-4 w-4" />
            </Button>
            <Link href="/admin/franchisee-reminders">
              <Button variant="ghost" size="sm" className="h-8 px-2">
                {he.common.viewAll}
                <ChevronRight className="h-4 w-4 ms-1" />
              </Button>
            </Link>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Stats Summary */}
        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="p-2 rounded-lg bg-muted/50">
            <p className="text-2xl font-bold" data-testid="pending-count">
              {data.stats.pending}
            </p>
            <p className="text-xs text-muted-foreground">{t.pending}</p>
          </div>
          <div className="p-2 rounded-lg bg-muted/50">
            <p className="text-2xl font-bold text-amber-600" data-testid="this-week-count">
              {data.stats.upcomingThisWeek}
            </p>
            <p className="text-xs text-muted-foreground">{t.thisWeek}</p>
          </div>
          <div className="p-2 rounded-lg bg-muted/50">
            <p className="text-2xl font-bold text-blue-600" data-testid="this-month-count">
              {data.stats.upcomingThisMonth}
            </p>
            <p className="text-xs text-muted-foreground">{t.thisMonth}</p>
          </div>
        </div>

        {/* Reminders List */}
        {!hasReminders ? (
          <div className="text-center py-4">
            <Calendar className="h-12 w-12 mx-auto text-green-500 mb-2" />
            <p className="text-muted-foreground">{t.noReminders}</p>
          </div>
        ) : (
          <div className="space-y-3">
            {data.reminders.map((reminder: ReminderItem) => {
              const TypeIcon = reminderTypeIcons[reminder.reminderType];
              return (
                <div
                  key={reminder.id}
                  className="flex items-start gap-3 p-3 rounded-lg border bg-muted/30"
                  data-testid={`reminder-item-${reminder.id}`}
                >
                  <div
                    className={`h-10 w-10 rounded-full flex items-center justify-center shrink-0 ${
                      reminder.reminderType === "lease_option"
                        ? "bg-blue-100 dark:bg-blue-900"
                        : reminder.reminderType === "franchise_agreement"
                        ? "bg-amber-100 dark:bg-amber-900"
                        : "bg-gray-100 dark:bg-gray-800"
                    }`}
                  >
                    <TypeIcon
                      className={`h-5 w-5 ${
                        reminder.reminderType === "lease_option"
                          ? "text-blue-600 dark:text-blue-400"
                          : reminder.reminderType === "franchise_agreement"
                          ? "text-amber-600 dark:text-amber-400"
                          : "text-gray-600 dark:text-gray-400"
                      }`}
                    />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-medium truncate">{reminder.title}</p>
                      {getUrgencyBadge(reminder.notificationDate, reminder.reminderDate)}
                    </div>
                    {reminder.franchisee && (
                      <p className="text-sm text-muted-foreground truncate">
                        {reminder.franchisee.name}
                      </p>
                    )}
                    <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground flex-wrap">
                      <span className="flex items-center gap-1">
                        <Calendar className="h-3 w-3" />
                        {formatDate(reminder.reminderDate)}
                      </span>
                      <Badge
                        variant={reminderTypeColors[reminder.reminderType]}
                        className="text-xs"
                      >
                        {reminderTypeLabels[reminder.reminderType]}
                      </Badge>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* View All Link */}
        {hasReminders && data.stats.pending > data.reminders.length && (
          <div className="text-center pt-2">
            <Link href="/admin/franchisee-reminders">
              <Button variant="outline" size="sm" className="w-full">
                <Clock className="me-2 h-4 w-4" />
                {t.viewAllReminders.replace("{count}", String(data.stats.pending))}
              </Button>
            </Link>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
