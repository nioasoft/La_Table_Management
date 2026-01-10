"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AlertTriangle,
  Calendar,
  CheckCircle2,
  Clock,
  FileText,
  RefreshCw,
  TrendingUp,
  AlertCircle,
  Bell,
  ArrowLeft,
  ChevronLeft,
  Users,
  Building2,
  Settings,
  ChevronRight,
} from "lucide-react";
import type { PeriodStatusResponse } from "@/app/api/dashboard/period-status/route";
import type { DashboardStatsResponse } from "@/app/api/dashboard/stats/route";
import type { CommissionSettlementStatusResponse } from "@/app/api/dashboard/commission-settlement-status/route";
import type { UpcomingRemindersResponse } from "@/app/api/dashboard/upcoming-reminders/route";
import { he, formatDate as formatHebrewDate } from "@/lib/translations";
import type { UserRole } from "@/db/schema";

const t = he.dashboard;

interface MinimalDashboardProps {
  userRole?: UserRole | null;
}

interface DashboardData {
  periodStatus: PeriodStatusResponse | null;
  stats: DashboardStatsResponse | null;
  commissionStatus: CommissionSettlementStatusResponse | null;
  reminders: UpcomingRemindersResponse | null;
}

export function MinimalDashboard({ userRole }: MinimalDashboardProps) {
  const [data, setData] = useState<DashboardData>({
    periodStatus: null,
    stats: null,
    commissionStatus: null,
    reminders: null,
  });
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAllData = async () => {
    try {
      setIsLoading(true);
      setError(null);

      const [periodRes, statsRes, commissionRes, remindersRes] = await Promise.all([
        fetch("/api/dashboard/period-status"),
        fetch("/api/dashboard/stats"),
        fetch("/api/dashboard/commission-settlement-status"),
        fetch("/api/dashboard/upcoming-reminders?daysAhead=30&limit=3"),
      ]);

      const periodData = periodRes.ok ? (await periodRes.json()).data : null;
      const statsData = statsRes.ok ? (await statsRes.json()).stats : null;
      const commissionData = commissionRes.ok ? (await commissionRes.json()).data : null;
      const remindersData = remindersRes.ok ? await remindersRes.json() : null;

      setData({
        periodStatus: periodData,
        stats: statsData,
        commissionStatus: commissionData,
        reminders: remindersData,
      });
    } catch (err) {
      console.error("Error fetching dashboard data:", err);
      setError("failed_to_load");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchAllData();
  }, []);

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat("he-IL", {
      style: "currency",
      currency: "ILS",
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  };

  const isSuperUser = userRole === "super_user";

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-center py-12">
          <div className="flex flex-col items-center gap-3">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
            <p className="text-sm text-muted-foreground">טוען נתונים...</p>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
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

  const { periodStatus, stats, commissionStatus, reminders } = data;

  // Calculate action items count
  const actionItemsCount =
    (stats?.pendingCrossReferences || 0) +
    (stats?.discrepanciesRequiringAttention || 0) +
    (stats?.itemsAwaitingApproval || 0);

  const hasActionItems = actionItemsCount > 0;
  const hasReminders = (reminders?.reminders?.length || 0) > 0;

  return (
    <div className="space-y-6">
      {/* Section A: Status Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          {periodStatus?.currentPeriod ? (
            <>
              <div className="flex items-center gap-2">
                <Calendar className="h-5 w-5 text-muted-foreground" />
                <span className="font-semibold text-lg">
                  {periodStatus.currentPeriod.name}
                </span>
              </div>
              <span className="text-sm text-muted-foreground">
                {new Date(periodStatus.currentPeriod.startDate).toLocaleDateString("he-IL")} -{" "}
                {new Date(periodStatus.currentPeriod.endDate).toLocaleDateString("he-IL")}
              </span>
              <Badge
                variant="outline"
                className="flex items-center gap-1"
              >
                <Clock className="h-3 w-3" />
                {periodStatus.currentPeriod.daysRemaining} ימים נותרו
              </Badge>
              <Badge
                className={
                  periodStatus.currentPeriod.status === "open"
                    ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-100"
                    : "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-100"
                }
              >
                {periodStatus.currentPeriod.status === "open" ? "פתוח" : "בעיבוד"}
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
          onClick={fetchAllData}
          className="h-8 w-8 p-0"
          title="רענן"
        >
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>

      {/* Section B: Key Metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {/* Reports Received */}
        <Card className="overflow-hidden">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">דוחות שהתקבלו</p>
                <p className={`text-3xl font-bold ${
                  (periodStatus?.reportStatus?.overallPercentage || 0) >= 80
                    ? "text-green-600 dark:text-green-400"
                    : (periodStatus?.reportStatus?.overallPercentage || 0) >= 50
                      ? "text-amber-600 dark:text-amber-400"
                      : "text-muted-foreground"
                }`}>
                  {periodStatus?.reportStatus?.overallPercentage || 0}%
                </p>
              </div>
              <FileText className="h-8 w-8 text-muted-foreground/30" />
            </div>
            <div className="mt-2 text-xs text-muted-foreground">
              {periodStatus?.reportStatus?.suppliersReceived || 0}/{periodStatus?.reportStatus?.suppliersTotal || 0} ספקים
              {" | "}
              {periodStatus?.reportStatus?.franchiseesReceived || 0}/{periodStatus?.reportStatus?.franchiseesTotal || 0} זכיינים
            </div>
          </CardContent>
        </Card>

        {/* Match Rate */}
        <Card className="overflow-hidden">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">אחוז התאמה</p>
                <p className={`text-3xl font-bold ${
                  (periodStatus?.crossReferenceStatus?.matchedPercentage || 0) >= 90
                    ? "text-green-600 dark:text-green-400"
                    : (periodStatus?.crossReferenceStatus?.matchedPercentage || 0) >= 70
                      ? "text-amber-600 dark:text-amber-400"
                      : "text-red-600 dark:text-red-400"
                }`}>
                  {periodStatus?.crossReferenceStatus?.matchedPercentage || 0}%
                </p>
              </div>
              <CheckCircle2 className="h-8 w-8 text-muted-foreground/30" />
            </div>
            <div className="mt-2 text-xs text-muted-foreground">
              {periodStatus?.crossReferenceStatus?.matched || 0} תואמים
              {" | "}
              {periodStatus?.crossReferenceStatus?.discrepancies || 0} פערים
            </div>
          </CardContent>
        </Card>

        {/* Pending Approval */}
        <Card className="overflow-hidden">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">ממתינים לאישור</p>
                <p className={`text-3xl font-bold ${
                  (stats?.itemsAwaitingApproval || 0) > 0
                    ? "text-amber-600 dark:text-amber-400"
                    : "text-muted-foreground"
                }`}>
                  {stats?.itemsAwaitingApproval || 0}
                </p>
              </div>
              <Clock className="h-8 w-8 text-muted-foreground/30" />
            </div>
            <div className="mt-2 text-xs text-muted-foreground">
              פריטים דורשים אישור
            </div>
          </CardContent>
        </Card>

        {/* Total Commissions */}
        <Card className="overflow-hidden">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">סכום כולל</p>
                <p className="text-3xl font-bold text-green-600 dark:text-green-400">
                  {formatCurrency(commissionStatus?.commissionSummary?.totalAmount || 0)}
                </p>
              </div>
            </div>
            <div className="mt-2 text-xs text-muted-foreground">
              {commissionStatus?.commissionSummary?.pendingCount || 0} ממתין
              {" | "}
              {commissionStatus?.commissionSummary?.approvedCount || 0} מאושר
              {" | "}
              {commissionStatus?.commissionSummary?.paidCount || 0} שולם
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Section C & D: Workflow + Action Items */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Workflow Progress */}
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold flex items-center gap-2">
                <TrendingUp className="h-5 w-5" />
                התקדמות תהליך
              </h3>
              <Link href="/admin/settlements">
                <Button variant="ghost" size="sm" className="h-7 px-2">
                  צפה בהכל
                  <ChevronLeft className="h-4 w-4 me-1 rtl-flip" />
                </Button>
              </Link>
            </div>

            {/* Progress Steps */}
            <div className="flex items-center justify-between mb-4">
              {periodStatus?.workflowProgress?.steps?.map((step, index) => (
                <div key={step.name} className="flex items-center">
                  <div className="flex flex-col items-center">
                    <div
                      className={`h-10 w-10 rounded-full flex items-center justify-center mb-2 ${
                        step.status === "completed"
                          ? "bg-green-100 dark:bg-green-900"
                          : step.status === "current"
                            ? "bg-blue-100 dark:bg-blue-900"
                            : "bg-gray-100 dark:bg-gray-800"
                      }`}
                    >
                      {step.status === "completed" ? (
                        <CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-400" />
                      ) : (
                        <span
                          className={`font-bold text-sm ${
                            step.status === "current"
                              ? "text-blue-600 dark:text-blue-400"
                              : "text-gray-400 dark:text-gray-500"
                          }`}
                        >
                          {step.count}
                        </span>
                      )}
                    </div>
                    <span
                      className={`text-xs ${
                        step.status === "current"
                          ? "font-semibold text-blue-600 dark:text-blue-400"
                          : "text-muted-foreground"
                      }`}
                    >
                      {step.name === "open" ? "פתוח" :
                       step.name === "processing" ? "בעיבוד" :
                       step.name === "pending_approval" ? "ממתין" :
                       step.name === "approved" ? "מאושר" :
                       step.name === "invoiced" ? "הושלם" : step.name}
                    </span>
                  </div>
                  {index < (periodStatus?.workflowProgress?.steps?.length || 0) - 1 && (
                    <div className="flex-1 mx-2">
                      <ArrowLeft
                        className={`h-4 w-4 rtl-flip ${
                          step.status === "completed"
                            ? "text-green-500"
                            : "text-muted-foreground/30"
                        }`}
                      />
                    </div>
                  )}
                </div>
              )) || (
                <div className="text-center w-full text-muted-foreground py-4">
                  אין נתוני תהליך
                </div>
              )}
            </div>

            {/* Progress Bar */}
            {periodStatus?.workflowProgress?.steps && (
              <div className="h-2 rounded-full overflow-hidden bg-gray-200 dark:bg-gray-700 flex">
                {periodStatus.workflowProgress.steps.map((step, index) => (
                  <div
                    key={step.name}
                    className={`h-full flex-1 ${
                      step.status === "completed"
                        ? "bg-green-500"
                        : step.status === "current"
                          ? "bg-blue-500"
                          : "bg-gray-300 dark:bg-gray-600"
                    } ${
                      index < periodStatus.workflowProgress.steps.length - 1
                        ? "border-e border-white dark:border-gray-800"
                        : ""
                    }`}
                  />
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Action Items */}
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold flex items-center gap-2">
                <AlertCircle className="h-5 w-5" />
                פריטים לטיפול
                {hasActionItems && (
                  <Badge variant="destructive" className="ms-2">
                    {actionItemsCount}
                  </Badge>
                )}
              </h3>
            </div>

            {!hasActionItems && !hasReminders ? (
              <div className="flex flex-col items-center justify-center py-6 text-center">
                <CheckCircle2 className="h-12 w-12 text-green-500 mb-2" />
                <p className="text-muted-foreground">הכל מעודכן! אין פריטים ממתינים.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {/* Pending Cross References */}
                {(stats?.pendingCrossReferences || 0) > 0 && (
                  <Link href="/admin/reconciliation" className="block">
                    <div className="flex items-center justify-between p-3 rounded-lg border bg-muted/50 hover:bg-muted transition-colors">
                      <div className="flex items-center gap-3">
                        <div className="h-8 w-8 rounded-full bg-blue-100 dark:bg-blue-900 flex items-center justify-center">
                          <Clock className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                        </div>
                        <span className="text-sm">הצלבות ממתינות</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant="default" className="bg-blue-600">
                          {stats?.pendingCrossReferences}
                        </Badge>
                        <ChevronRight className="h-4 w-4 text-muted-foreground rtl-flip" />
                      </div>
                    </div>
                  </Link>
                )}

                {/* Discrepancies */}
                {(stats?.discrepanciesRequiringAttention || 0) > 0 && (
                  <Link href="/admin/reconciliation" className="block">
                    <div className="flex items-center justify-between p-3 rounded-lg border bg-muted/50 hover:bg-muted transition-colors">
                      <div className="flex items-center gap-3">
                        <div className="h-8 w-8 rounded-full bg-amber-100 dark:bg-amber-900 flex items-center justify-center">
                          <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                        </div>
                        <span className="text-sm">פערים לטיפול</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant="destructive">
                          {stats?.discrepanciesRequiringAttention}
                        </Badge>
                        <ChevronRight className="h-4 w-4 text-muted-foreground rtl-flip" />
                      </div>
                    </div>
                  </Link>
                )}

                {/* Awaiting Approval */}
                {(stats?.itemsAwaitingApproval || 0) > 0 && (
                  <Link href="/admin/settlements" className="block">
                    <div className="flex items-center justify-between p-3 rounded-lg border bg-muted/50 hover:bg-muted transition-colors">
                      <div className="flex items-center gap-3">
                        <div className="h-8 w-8 rounded-full bg-purple-100 dark:bg-purple-900 flex items-center justify-center">
                          <FileText className="h-4 w-4 text-purple-600 dark:text-purple-400" />
                        </div>
                        <span className="text-sm">ממתינים לאישור</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge className="bg-purple-600">
                          {stats?.itemsAwaitingApproval}
                        </Badge>
                        <ChevronRight className="h-4 w-4 text-muted-foreground rtl-flip" />
                      </div>
                    </div>
                  </Link>
                )}

                {/* Upcoming Reminders */}
                {hasReminders && (
                  <Link href="/admin/franchisee-reminders" className="block">
                    <div className="flex items-center justify-between p-3 rounded-lg border bg-muted/50 hover:bg-muted transition-colors">
                      <div className="flex items-center gap-3">
                        <div className="h-8 w-8 rounded-full bg-orange-100 dark:bg-orange-900 flex items-center justify-center">
                          <Bell className="h-4 w-4 text-orange-600 dark:text-orange-400" />
                        </div>
                        <span className="text-sm">תזכורות קרובות</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant="outline">
                          {reminders?.stats?.pending || 0}
                        </Badge>
                        <ChevronRight className="h-4 w-4 text-muted-foreground rtl-flip" />
                      </div>
                    </div>
                  </Link>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Admin Quick Actions - Compact */}
      {(userRole === "super_user" || userRole === "admin") && (
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-4 flex-wrap">
              <span className="text-sm text-muted-foreground flex items-center gap-2">
                <Settings className="h-4 w-4" />
                פעולות מהירות:
              </span>
              <Link href="/admin/users">
                <Button variant="outline" size="sm">
                  <Users className="me-2 h-4 w-4" />
                  ניהול משתמשים
                </Button>
              </Link>
              <Link href="/admin/franchisees">
                <Button variant="outline" size="sm">
                  <Building2 className="me-2 h-4 w-4" />
                  ניהול זכיינים
                </Button>
              </Link>
              {isSuperUser && (
                <Link href="/admin/settlements">
                  <Button variant="outline" size="sm">
                    <FileText className="me-2 h-4 w-4" />
                    אישורי התחשבנות
                  </Button>
                </Link>
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
