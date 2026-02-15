"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Clock, RefreshCw } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { dashboardKeys } from "@/queries/dashboard";
import { useDashboardPeriod } from "../dashboard-period-context";
import { ReportPeriodSelector } from "@/components/reports/report-period-selector";
import type { SettlementPeriodType } from "@/db/schema";
import { formatPeriodRange } from "@/lib/settlement-periods";

export function PeriodStatusHeader() {
  const queryClient = useQueryClient();
  const { periodType, periodKey, periodInfo, setPeriod } =
    useDashboardPeriod();

  const onRefresh = () => {
    queryClient.invalidateQueries({ queryKey: dashboardKeys.all });
  };

  const daysRemaining = periodInfo
    ? Math.max(
        0,
        Math.ceil(
          (periodInfo.endDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24)
        )
      )
    : null;

  return (
    <div className="rounded-lg border bg-muted/30 px-4 py-2.5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 flex-wrap">
          <ReportPeriodSelector
            periodType={periodType}
            periodKey={periodKey}
            onChange={(type, key) => {
              if (type) setPeriod(type as SettlementPeriodType, key);
            }}
            layout="horizontal"
            showLabels={false}
            showCustomRange={false}
            periodsCount={8}
            includeCurrent
          />
          {periodInfo && (
            <>
              <span className="text-xs text-muted-foreground hidden sm:inline">
                {formatPeriodRange(periodInfo)}
              </span>
              {daysRemaining !== null && daysRemaining > 0 && (
                <Badge
                  variant="outline"
                  className="flex items-center gap-1 text-xs h-5"
                >
                  <Clock className="h-2.5 w-2.5" />
                  {daysRemaining} ימים נותרו
                </Badge>
              )}
            </>
          )}
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={onRefresh}
          className="h-7 w-7 p-0 shrink-0"
          title="רענן"
        >
          <RefreshCw className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}
