"use client";

import { useEffect, useState } from "react";
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
  Clock,
  FileCheck,
  RefreshCw,
  ChevronRight,
} from "lucide-react";
import type { DashboardStatsResponse } from "@/app/api/dashboard/stats/route";
import { he } from "@/lib/translations";

type DashboardStats = DashboardStatsResponse;

export function DashboardWidgets() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchStats = async () => {
    try {
      setIsLoading(true);
      setError(null);
      const response = await fetch("/api/dashboard/stats");

      if (!response.ok) {
        if (response.status === 403) {
          setError("insufficient_permissions");
          return;
        }
        throw new Error("Failed to fetch dashboard stats");
      }

      const data = await response.json();
      setStats(data.stats);
    } catch (err) {
      console.error("Error fetching dashboard stats:", err);
      setError("failed_to_load");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchStats();
  }, []);

  // Don't show widgets if user doesn't have permission
  if (error === "insufficient_permissions") {
    return null;
  }

  // Translations
  const widgets = he.dashboard.widgets;

  if (isLoading) {
    return (
      <Card data-testid="dashboard-widgets-loading">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <RefreshCw className="h-5 w-5 animate-spin" />
            {widgets.loadingStats}
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

  if (error === "failed_to_load") {
    return (
      <Card data-testid="dashboard-widgets-error">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="h-5 w-5" />
            {widgets.errorLoadingStats}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground mb-4">
            {widgets.unableToLoad}
          </p>
          <Button variant="outline" onClick={fetchStats}>
            <RefreshCw className="ms-2 h-4 w-4" />
            {he.common.retry}
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (!stats) {
    return null;
  }

  const hasActionItems =
    stats.pendingCrossReferences > 0 ||
    stats.discrepanciesRequiringAttention > 0 ||
    stats.itemsAwaitingApproval > 0;

  return (
    <Card data-testid="dashboard-widgets">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Clock className="h-5 w-5" />
              {widgets.actionItems.title}
            </CardTitle>
            <CardDescription>
              {widgets.actionItems.description}
            </CardDescription>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={fetchStats}
            className="h-8 w-8 p-0"
            title={he.common.refresh}
          >
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {!hasActionItems ? (
          <div className="text-center py-4">
            <FileCheck className="h-12 w-12 mx-auto text-green-500 mb-2" />
            <p className="text-muted-foreground">{widgets.actionItems.allCaughtUp}</p>
          </div>
        ) : (
          <>
            {/* Pending Cross-References */}
            <div
              className="flex items-center justify-between p-3 rounded-lg border bg-muted/50"
              data-testid="pending-cross-references"
            >
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-full bg-blue-100 dark:bg-blue-900 flex items-center justify-center">
                  <Clock className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                </div>
                <div>
                  <p className="font-medium">{widgets.actionItems.pendingCrossReferences}</p>
                  <p className="text-sm text-muted-foreground">
                    {widgets.actionItems.pendingCrossReferencesDesc}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Badge
                  variant={stats.pendingCrossReferences > 0 ? "default" : "secondary"}
                  className={stats.pendingCrossReferences > 0 ? "bg-blue-600" : ""}
                  data-testid="pending-cross-references-count"
                >
                  {stats.pendingCrossReferences}
                </Badge>
                {stats.pendingCrossReferences > 0 && (
                  <Link href="/admin/reconciliation">
                    <Button variant="ghost" size="sm" className="h-8 px-2">
                      <ChevronRight className="h-4 w-4 rtl-flip" />
                    </Button>
                  </Link>
                )}
              </div>
            </div>

            {/* Discrepancies Requiring Attention */}
            <div
              className="flex items-center justify-between p-3 rounded-lg border bg-muted/50"
              data-testid="discrepancies-requiring-attention"
            >
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-full bg-amber-100 dark:bg-amber-900 flex items-center justify-center">
                  <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400" />
                </div>
                <div>
                  <p className="font-medium">{widgets.actionItems.discrepancies}</p>
                  <p className="text-sm text-muted-foreground">
                    {widgets.actionItems.discrepanciesDesc}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Badge
                  variant={stats.discrepanciesRequiringAttention > 0 ? "destructive" : "secondary"}
                  data-testid="discrepancies-count"
                >
                  {stats.discrepanciesRequiringAttention}
                </Badge>
                {stats.discrepanciesRequiringAttention > 0 && (
                  <Link href="/admin/reconciliation">
                    <Button variant="ghost" size="sm" className="h-8 px-2">
                      <ChevronRight className="h-4 w-4 rtl-flip" />
                    </Button>
                  </Link>
                )}
              </div>
            </div>

            {/* Items Awaiting Approval */}
            <div
              className="flex items-center justify-between p-3 rounded-lg border bg-muted/50"
              data-testid="items-awaiting-approval"
            >
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-full bg-purple-100 dark:bg-purple-900 flex items-center justify-center">
                  <FileCheck className="h-5 w-5 text-purple-600 dark:text-purple-400" />
                </div>
                <div>
                  <p className="font-medium">{widgets.actionItems.awaitingApproval}</p>
                  <p className="text-sm text-muted-foreground">
                    {widgets.actionItems.awaitingApprovalDesc}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Badge
                  variant={stats.itemsAwaitingApproval > 0 ? "default" : "secondary"}
                  className={stats.itemsAwaitingApproval > 0 ? "bg-purple-600" : ""}
                  data-testid="awaiting-approval-count"
                >
                  {stats.itemsAwaitingApproval}
                </Badge>
                {stats.itemsAwaitingApproval > 0 && (
                  <Link href="/admin/settlements">
                    <Button variant="ghost" size="sm" className="h-8 px-2">
                      <ChevronRight className="h-4 w-4 rtl-flip" />
                    </Button>
                  </Link>
                )}
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
