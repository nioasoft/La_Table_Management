"use client";

import { FileText, CheckCircle2, Clock, TrendingUp } from "lucide-react";
import { MetricCard } from "../shared/metric-card";
import {
  useSupplierCompleteness,
  usePeriodStatus,
  useCommissionSettlementStatus,
} from "@/queries/dashboard";
import type { PeriodStatusResponse } from "@/app/api/dashboard/period-status/route";
import type { SupplierCompletenessResponse } from "@/app/api/dashboard/supplier-completeness/route";
import { useDashboardPeriod } from "../dashboard-period-context";

export function QuickMetricsRow() {
  const { year, startDate, endDate } = useDashboardPeriod();
  const { data: supplierData } = useSupplierCompleteness(year);
  const { data: periodStatusData } = usePeriodStatus(startDate, endDate);
  const { data: commissionStatusData } = useCommissionSettlementStatus();

  const supplierCompleteness = supplierData as SupplierCompletenessResponse | undefined;
  const periodStatus = (periodStatusData?.data as PeriodStatusResponse) ?? null;
  const commissionStatus = commissionStatusData?.data ?? null;

  const reportPct = supplierCompleteness?.summary?.completionPercentage || 0;
  const received = supplierCompleteness?.summary?.received || 0;
  const totalExpected = supplierCompleteness?.summary?.totalExpectedFiles || 0;

  const matchPct = periodStatus?.crossReferenceStatus?.matchedPercentage || 0;
  const pendingApproval =
    periodStatus?.pendingActions?.items?.find((i) => i.type === "approval")
      ?.count || 0;
  const totalAmount = commissionStatus?.commissionSummary?.totalAmount || 0;

  const formatCurrency = (amount: number) =>
    new Intl.NumberFormat("he-IL", {
      style: "currency",
      currency: "ILS",
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);

  const reportColorClass =
    reportPct >= 80
      ? "text-green-600 dark:text-green-400"
      : reportPct >= 50
        ? "text-amber-600 dark:text-amber-400"
        : "text-muted-foreground";

  const reportAccent =
    reportPct >= 80 ? "green" : reportPct >= 50 ? "amber" : "neutral";

  const matchColorClass =
    matchPct >= 90
      ? "text-green-600 dark:text-green-400"
      : matchPct >= 70
        ? "text-amber-600 dark:text-amber-400"
        : "text-red-600 dark:text-red-400";

  const matchAccent =
    matchPct >= 90 ? "green" : matchPct >= 70 ? "amber" : "red";

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
      <MetricCard
        label="דוחות שהתקבלו"
        value={`${reportPct}%`}
        subtitle={`${received}/${totalExpected} ספקים שלחו קבצים`}
        icon={<FileText className="h-5 w-5" />}
        colorClass={reportColorClass}
        accentColor={reportAccent as "green" | "amber" | "neutral"}
      />
      <MetricCard
        label="אחוז התאמה"
        value={`${matchPct}%`}
        subtitle={`${periodStatus?.crossReferenceStatus?.matched || 0} תואמים · ${periodStatus?.crossReferenceStatus?.discrepancies || 0} פערים`}
        icon={<CheckCircle2 className="h-5 w-5" />}
        colorClass={matchColorClass}
        accentColor={matchAccent as "green" | "amber" | "red"}
      />
      <MetricCard
        label="ממתינים לאישור"
        value={pendingApproval}
        subtitle="פריטים דורשים אישור"
        icon={<Clock className="h-5 w-5" />}
        colorClass={
          pendingApproval > 0
            ? "text-amber-600 dark:text-amber-400"
            : "text-muted-foreground"
        }
        accentColor={pendingApproval > 0 ? "amber" : "neutral"}
      />
      <MetricCard
        label="סכום כולל"
        value={formatCurrency(totalAmount)}
        subtitle={`${commissionStatus?.commissionSummary?.pendingCount || 0} ממתין · ${commissionStatus?.commissionSummary?.approvedCount || 0} מאושר · ${commissionStatus?.commissionSummary?.paidCount || 0} שולם`}
        icon={<TrendingUp className="h-5 w-5" />}
        colorClass="text-green-600 dark:text-green-400"
        accentColor="green"
      />
    </div>
  );
}
