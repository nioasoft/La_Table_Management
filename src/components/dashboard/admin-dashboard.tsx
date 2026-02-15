"use client";

import type { UserRole } from "@/db/schema";
import { DashboardPeriodProvider } from "./dashboard-period-context";

import { PeriodStatusHeader } from "./sections/period-status-header";
import { QuickMetricsRow } from "./sections/quick-metrics-row";
import { MissingSupplierFiles } from "./sections/missing-supplier-files";
import { MissingFranchiseeFiles } from "./sections/missing-franchisee-files";
import { ReconciliationIssues } from "./sections/reconciliation-issues";
import { PendingApprovals } from "./sections/pending-approvals";
import { UpcomingReminders } from "./sections/upcoming-reminders";

interface AdminDashboardProps {
  userRole?: UserRole | null;
}

export function AdminDashboard({ userRole }: AdminDashboardProps) {
  const isSuperUser = userRole === "super_user";

  return (
    <DashboardPeriodProvider>
      <div className="space-y-3">
        {/* Period Status Header */}
        <PeriodStatusHeader />

        {/* Quick Metrics Row */}
        <QuickMetricsRow />

        {/* Action Sections - each loads independently */}
        <div className="space-y-2">
          <MissingSupplierFiles />
          <MissingFranchiseeFiles />
          <ReconciliationIssues />
          {isSuperUser && <PendingApprovals />}
          <UpcomingReminders />
        </div>
      </div>
    </DashboardPeriodProvider>
  );
}
