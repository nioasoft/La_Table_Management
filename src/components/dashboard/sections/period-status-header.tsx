"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Calendar, Clock, RefreshCw } from "lucide-react";
import type { PeriodStatusResponse } from "@/app/api/dashboard/period-status/route";

interface PeriodStatusHeaderProps {
  periodStatus: PeriodStatusResponse | null;
  isLoading: boolean;
  onRefresh: () => void;
}

export function PeriodStatusHeader({
  periodStatus,
  isLoading,
  onRefresh,
}: PeriodStatusHeaderProps) {
  const period = periodStatus?.currentPeriod;

  return (
    <div className="rounded-lg border bg-muted/30 px-4 py-2.5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3 flex-wrap">
          {period ? (
            <>
              <div className="flex items-center gap-2">
                <Calendar className="h-4 w-4 text-primary" />
                <span className="font-semibold">{period.name}</span>
              </div>
              <span className="text-xs text-muted-foreground">
                {new Date(period.startDate).toLocaleDateString("he-IL")} -{" "}
                {new Date(period.endDate).toLocaleDateString("he-IL")}
              </span>
              <Badge
                variant="outline"
                className="flex items-center gap-1 text-xs h-5"
              >
                <Clock className="h-2.5 w-2.5" />
                {period.daysRemaining} ימים נותרו
              </Badge>
              <Badge
                className={`text-xs h-5 ${
                  period.status === "open"
                    ? "bg-green-500/15 text-green-700 border border-green-200 dark:bg-green-900/40 dark:text-green-300 dark:border-green-800"
                    : "bg-blue-500/15 text-blue-700 border border-blue-200 dark:bg-blue-900/40 dark:text-blue-300 dark:border-blue-800"
                }`}
              >
                {period.status === "open" ? "פתוח" : "בעיבוד"}
              </Badge>
            </>
          ) : (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Calendar className="h-4 w-4" />
              <span className="text-sm">אין תקופה פעילה</span>
            </div>
          )}
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={onRefresh}
          disabled={isLoading}
          className="h-7 w-7 p-0"
          title="רענן"
        >
          <RefreshCw
            className={`h-3.5 w-3.5 ${isLoading ? "animate-spin" : ""}`}
          />
        </Button>
      </div>
    </div>
  );
}
