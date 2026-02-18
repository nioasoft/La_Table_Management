"use client";

import {
  FileText,
  Users,
  CheckCircle2,
  AlertTriangle,
  Clock,
  TrendingUp,
} from "lucide-react";
import { MetricCard } from "../shared/metric-card";
import {
  useSupplierCompleteness,
  usePeriodStatus,
  useUploadStatus,
  useCommissionSettlementStatus,
} from "@/queries/dashboard";
import type { PeriodStatusResponse } from "@/app/api/dashboard/period-status/route";
import type { SupplierCompletenessResponse } from "@/app/api/dashboard/supplier-completeness/route";
import type { FranchiseeBkmvStatus } from "@/app/api/dashboard/upload-status/route";
import { useDashboardPeriod } from "../dashboard-period-context";

export function QuickMetricsRow() {
  const { year, startDate, endDate } = useDashboardPeriod();
  const { data: supplierData } = useSupplierCompleteness(year, startDate, endDate);
  const { data: periodStatusData } = usePeriodStatus(startDate, endDate);
  const { data: uploadStatusData } = useUploadStatus(startDate, endDate);
  const { data: commissionStatusData } = useCommissionSettlementStatus(startDate, endDate);

  const supplierCompleteness = supplierData as SupplierCompletenessResponse | undefined;
  const periodStatus = (periodStatusData?.data as PeriodStatusResponse) ?? null;
  const uploadStatus = uploadStatusData as FranchiseeBkmvStatus | undefined;
  const commissionStatus = commissionStatusData?.data ?? null;

  // --- Card 1: Supplier files (count suppliers, not individual files) ---
  const allSuppliers = supplierCompleteness?.suppliers ?? [];
  const totalSuppliers = allSuppliers.length;
  const completeSuppliers = allSuppliers.filter((s) => s.stats.missing === 0).length;
  const reportPct = totalSuppliers > 0
    ? Math.round((completeSuppliers / totalSuppliers) * 100)
    : 0;

  const reportColorClass =
    reportPct >= 80
      ? "text-green-600 dark:text-green-400"
      : reportPct >= 50
        ? "text-amber-600 dark:text-amber-400"
        : "text-muted-foreground";
  const reportAccent: "green" | "amber" | "neutral" =
    reportPct >= 80 ? "green" : reportPct >= 50 ? "amber" : "neutral";

  // --- Card 2: Franchisee files ---
  const allFranchisees = uploadStatus?.franchisees ?? [];
  const franchiseesWithFile = allFranchisees.filter((f) => f.hasFile).length;
  const totalFranchisees = allFranchisees.length;
  const franchiseePct = totalFranchisees > 0
    ? Math.round((franchiseesWithFile / totalFranchisees) * 100)
    : 0;

  const franchiseeColorClass =
    franchiseePct >= 80
      ? "text-green-600 dark:text-green-400"
      : franchiseePct >= 50
        ? "text-amber-600 dark:text-amber-400"
        : "text-muted-foreground";
  const franchiseeAccent: "green" | "amber" | "neutral" =
    franchiseePct >= 80 ? "green" : franchiseePct >= 50 ? "amber" : "neutral";

  // --- Card 3: Match percentage ---
  const matchPct = periodStatus?.crossReferenceStatus?.matchedPercentage || 0;
  const matched = periodStatus?.crossReferenceStatus?.matched || 0;
  const discrepancies = periodStatus?.crossReferenceStatus?.discrepancies || 0;

  const matchColorClass =
    matchPct >= 90
      ? "text-green-600 dark:text-green-400"
      : matchPct >= 70
        ? "text-amber-600 dark:text-amber-400"
        : "text-red-600 dark:text-red-400";
  const matchAccent: "green" | "amber" | "red" =
    matchPct >= 90 ? "green" : matchPct >= 70 ? "amber" : "red";

  // --- Card 4: Discrepancies ---
  const discrepancyColorClass =
    discrepancies === 0
      ? "text-green-600 dark:text-green-400"
      : discrepancies <= 5
        ? "text-amber-600 dark:text-amber-400"
        : "text-red-600 dark:text-red-400";
  const discrepancyAccent: "green" | "amber" | "red" =
    discrepancies === 0 ? "green" : discrepancies <= 5 ? "amber" : "red";

  // --- Card 5: Pending approvals ---
  const pendingApproval =
    periodStatus?.pendingActions?.items?.find((i) => i.type === "approval")
      ?.count || 0;

  // --- Card 6: Commission total ---
  const totalAmount = commissionStatus?.commissionSummary?.totalAmount || 0;

  const formatCurrency = (amount: number) =>
    new Intl.NumberFormat("he-IL", {
      style: "currency",
      currency: "ILS",
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2.5">
      {/* 1 - Supplier files */}
      <MetricCard
        label="קבצי ספקים"
        value={`${reportPct}%`}
        subtitle={`${completeSuppliers}/${totalSuppliers} ספקים`}
        icon={<FileText className="h-5 w-5" />}
        colorClass={reportColorClass}
        accentColor={reportAccent}
        scrollToId="missing-supplier-files"
      />

      {/* 2 - Franchisee files */}
      <MetricCard
        label="קבצי זכיינים"
        value={`${franchiseesWithFile}/${totalFranchisees}`}
        subtitle={`${franchiseesWithFile} מתוך ${totalFranchisees} שלחו`}
        icon={<Users className="h-5 w-5" />}
        colorClass={franchiseeColorClass}
        accentColor={franchiseeAccent}
        scrollToId="missing-franchisee-files"
      />

      {/* 3 - Match percentage */}
      <MetricCard
        label="אחוז התאמה"
        value={`${matchPct}%`}
        subtitle={`${matched} תואמים · ${discrepancies} פערים`}
        icon={<CheckCircle2 className="h-5 w-5" />}
        colorClass={matchColorClass}
        accentColor={matchAccent}
        scrollToId="reconciliation-issues"
      />

      {/* 4 - Discrepancies */}
      <MetricCard
        label="פערים"
        value={discrepancies}
        subtitle="פערים דורשים בדיקה"
        icon={<AlertTriangle className="h-5 w-5" />}
        colorClass={discrepancyColorClass}
        accentColor={discrepancyAccent}
        scrollToId="reconciliation-issues"
      />

      {/* 5 - Pending approvals */}
      <MetricCard
        label="ממתינים לאישור"
        value={pendingApproval}
        subtitle="קבצים ממתינים לבדיקה"
        icon={<Clock className="h-5 w-5" />}
        colorClass={
          pendingApproval > 0
            ? "text-amber-600 dark:text-amber-400"
            : "text-muted-foreground"
        }
        accentColor={pendingApproval > 0 ? "amber" : "neutral"}
        scrollToId="pending-approvals"
      />

      {/* 6 - Commission total */}
      <MetricCard
        label="סכום עמלות"
        value={formatCurrency(totalAmount)}
        subtitle={`${commissionStatus?.commissionSummary?.pendingCount || 0} ממתין · ${commissionStatus?.commissionSummary?.approvedCount || 0} מאושר · ${commissionStatus?.commissionSummary?.paidCount || 0} שולם`}
        icon={<TrendingUp className="h-5 w-5" />}
        colorClass="text-green-600 dark:text-green-400"
        accentColor="green"
        href="/admin/commissions"
      />
    </div>
  );
}
