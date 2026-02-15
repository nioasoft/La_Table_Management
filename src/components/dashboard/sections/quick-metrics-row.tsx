"use client";

import { FileText, CheckCircle2, Clock } from "lucide-react";
import { MetricCard } from "../shared/metric-card";
import type { PeriodStatusResponse } from "@/app/api/dashboard/period-status/route";

interface QuickMetricsRowProps {
  periodStatus: PeriodStatusResponse | null;
  commissionStatus: {
    commissionSummary?: {
      totalAmount?: number;
      pendingCount?: number;
      approvedCount?: number;
      paidCount?: number;
    };
  } | null;
}

export function QuickMetricsRow({
  periodStatus,
  commissionStatus,
}: QuickMetricsRowProps) {
  const reportPct = periodStatus?.reportStatus?.overallPercentage || 0;
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

  const matchColorClass =
    matchPct >= 90
      ? "text-green-600 dark:text-green-400"
      : matchPct >= 70
        ? "text-amber-600 dark:text-amber-400"
        : "text-red-600 dark:text-red-400";

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      <MetricCard
        label="דוחות שהתקבלו"
        value={`${reportPct}%`}
        subtitle={`${periodStatus?.reportStatus?.suppliersReceived || 0}/${periodStatus?.reportStatus?.suppliersTotal || 0} ספקים | ${periodStatus?.reportStatus?.franchiseesReceived || 0}/${periodStatus?.reportStatus?.franchiseesTotal || 0} זכיינים`}
        icon={<FileText className="h-6 w-6" />}
        colorClass={reportColorClass}
      />
      <MetricCard
        label="אחוז התאמה"
        value={`${matchPct}%`}
        subtitle={`${periodStatus?.crossReferenceStatus?.matched || 0} תואמים | ${periodStatus?.crossReferenceStatus?.discrepancies || 0} פערים`}
        icon={<CheckCircle2 className="h-6 w-6" />}
        colorClass={matchColorClass}
      />
      <MetricCard
        label="ממתינים לאישור"
        value={pendingApproval}
        subtitle="פריטים דורשים אישור"
        icon={<Clock className="h-6 w-6" />}
        colorClass={
          pendingApproval > 0
            ? "text-amber-600 dark:text-amber-400"
            : "text-muted-foreground"
        }
      />
      <MetricCard
        label="סכום כולל"
        value={formatCurrency(totalAmount)}
        subtitle={`${commissionStatus?.commissionSummary?.pendingCount || 0} ממתין | ${commissionStatus?.commissionSummary?.approvedCount || 0} מאושר | ${commissionStatus?.commissionSummary?.paidCount || 0} שולם`}
        colorClass="text-green-600 dark:text-green-400"
      />
    </div>
  );
}
