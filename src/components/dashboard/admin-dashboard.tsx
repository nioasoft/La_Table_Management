"use client";

import { Card, CardContent } from "@/components/ui/card";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { RefreshCw } from "lucide-react";
import type { UserRole } from "@/db/schema";
import {
  usePeriodStatus,
  useCommissionSettlementStatus,
} from "@/queries/dashboard";

import { PeriodStatusHeader } from "./sections/period-status-header";
import { QuickMetricsRow } from "./sections/quick-metrics-row";
import { MissingSupplierFiles } from "./sections/missing-supplier-files";
import { MissingFranchiseeFiles } from "./sections/missing-franchisee-files";
import { ReconciliationIssues } from "./sections/reconciliation-issues";
import { PendingApprovals } from "./sections/pending-approvals";
import { UpcomingReminders } from "./sections/upcoming-reminders";
import type { PeriodStatusResponse } from "@/app/api/dashboard/period-status/route";

interface AdminDashboardProps {
  userRole?: UserRole | null;
}

export function AdminDashboard({ userRole }: AdminDashboardProps) {
  const {
    data: periodStatusData,
    isLoading: isPeriodLoading,
    error: periodError,
    refetch: refetchPeriod,
  } = usePeriodStatus();

  const {
    data: commissionStatusData,
    error: commissionError,
    refetch: refetchCommission,
  } = useCommissionSettlementStatus();

  const periodStatus = (periodStatusData?.data as PeriodStatusResponse) ?? null;
  const commissionStatus = commissionStatusData?.data ?? null;

  const isSuperUser = userRole === "super_user";

  const fetchAllData = () => {
    refetchPeriod();
    refetchCommission();
  };

  // Show error only if the primary query fails
  if (periodError || commissionError) {
    return (
      <Card>
        <CardContent className="py-8">
          <div className="flex flex-col items-center gap-4">
            <AlertTriangle className="h-12 w-12 text-destructive" />
            <p className="text-muted-foreground">לא ניתן לטעון את הנתונים</p>
            <Button variant="outline" onClick={fetchAllData}>
              <RefreshCw className="ms-2 h-4 w-4" />
              נסה שוב
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Period Status Header */}
      <PeriodStatusHeader
        periodStatus={periodStatus}
        isLoading={isPeriodLoading}
        onRefresh={fetchAllData}
      />

      {/* Quick Metrics Row */}
      <QuickMetricsRow
        periodStatus={periodStatus}
        commissionStatus={commissionStatus}
      />

      {/* Action Sections - each loads independently */}
      <div className="space-y-4">
        <MissingSupplierFiles />
        <MissingFranchiseeFiles />
        <ReconciliationIssues />
        {isSuperUser && <PendingApprovals />}
        <UpcomingReminders />
      </div>
    </div>
  );
}
