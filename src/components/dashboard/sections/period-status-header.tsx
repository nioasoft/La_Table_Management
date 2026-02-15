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
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-3 flex-wrap">
        {period ? (
          <>
            <div className="flex items-center gap-2">
              <Calendar className="h-5 w-5 text-muted-foreground" />
              <span className="font-semibold text-lg">{period.name}</span>
            </div>
            <span className="text-sm text-muted-foreground">
              {new Date(period.startDate).toLocaleDateString("he-IL")} -{" "}
              {new Date(period.endDate).toLocaleDateString("he-IL")}
            </span>
            <Badge variant="outline" className="flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {period.daysRemaining} ימים נותרו
            </Badge>
            <Badge
              className={
                period.status === "open"
                  ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-100"
                  : "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-100"
              }
            >
              {period.status === "open" ? "פתוח" : "בעיבוד"}
            </Badge>
          </>
        ) : (
          <div className="flex items-center gap-2 text-muted-foreground">
            <Calendar className="h-5 w-5" />
            <span>אין תקופה פעילה</span>
          </div>
        )}
      </div>
      <Button
        variant="ghost"
        size="sm"
        onClick={onRefresh}
        disabled={isLoading}
        className="h-8 w-8 p-0"
        title="רענן"
      >
        <RefreshCw
          className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`}
        />
      </Button>
    </div>
  );
}
