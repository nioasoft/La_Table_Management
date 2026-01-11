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
  Calendar,
  CheckCircle2,
  Clock,
  FileText,
  RefreshCw,
  ChevronLeft,
  TrendingUp,
  AlertCircle,
  FileQuestion,
  Link2,
  ArrowLeft,
} from "lucide-react";
import type { PeriodStatusResponse } from "@/app/api/dashboard/period-status/route";
import { he } from "@/lib/translations";

const t = he.dashboard.periodStatus;

export function PeriodStatusWidget() {
  const [data, setData] = useState<PeriodStatusResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = async () => {
    try {
      setIsLoading(true);
      setError(null);
      const response = await fetch("/api/dashboard/period-status");

      if (!response.ok) {
        if (response.status === 403) {
          setError("insufficient_permissions");
          return;
        }
        throw new Error("Failed to fetch period status");
      }

      const result = await response.json();
      setData(result.data);
    } catch (err) {
      console.error("Error fetching period status:", err);
      setError("failed_to_load");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  // Don't show widget if user doesn't have permission
  if (error === "insufficient_permissions") {
    return null;
  }

  if (isLoading) {
    return (
      <Card data-testid="period-status-widget-loading" className="col-span-1 lg:col-span-3">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <RefreshCw className="h-5 w-5 animate-spin" />
            {t.loadingStatus}
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
      <Card data-testid="period-status-widget-error" className="col-span-1 lg:col-span-3">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="h-5 w-5" />
            {t.errorLoadingStatus}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground mb-4">{t.unableToLoad}</p>
          <Button variant="outline" onClick={fetchData}>
            <RefreshCw className="ms-2 h-4 w-4" />
            {he.common.retry}
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (!data) {
    return null;
  }

  const getPriorityColor = (priority: "high" | "medium" | "low") => {
    switch (priority) {
      case "high":
        return "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-100";
      case "medium":
        return "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-100";
      case "low":
        return "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-100";
    }
  };

  const getActionIcon = (type: string) => {
    switch (type) {
      case "discrepancy":
        return <AlertCircle className="h-4 w-4" />;
      case "approval":
        return <FileText className="h-4 w-4" />;
      case "missing_report":
        return <FileQuestion className="h-4 w-4" />;
      case "expiring_link":
        return <Link2 className="h-4 w-4" />;
      default:
        return <AlertTriangle className="h-4 w-4" />;
    }
  };

  const getActionLabel = (type: string) => {
    switch (type) {
      case "discrepancy":
        return t.actions.discrepancy;
      case "approval":
        return t.actions.approval;
      case "missing_report":
        return t.actions.missingReport;
      case "expiring_link":
        return t.actions.expiringLink;
      default:
        return type;
    }
  };

  const getStepStatusColor = (status: "completed" | "current" | "pending") => {
    switch (status) {
      case "completed":
        return "bg-green-500";
      case "current":
        return "bg-blue-500";
      case "pending":
        return "bg-gray-300 dark:bg-gray-600";
    }
  };

  const getStepLabel = (name: string) => {
    switch (name) {
      case "open":
        return t.workflow.open;
      case "processing":
        return t.workflow.processing;
      case "pending_approval":
        return t.workflow.pendingApproval;
      case "approved":
        return t.workflow.approved;
      case "invoiced":
        return t.workflow.invoiced;
      default:
        return name;
    }
  };

  return (
    <Card data-testid="period-status-widget" className="col-span-1 lg:col-span-3">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5" />
              {t.title}
            </CardTitle>
            <CardDescription>{t.description}</CardDescription>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={fetchData}
            className="h-8 w-8 p-0"
            title={he.common.refresh}
          >
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Top Row - Period Info and Progress */}
        <div className="grid gap-4 md:grid-cols-2">
          {/* Current Period */}
          <div
            className="p-4 rounded-lg border bg-muted/50"
            data-testid="period-info"
          >
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold flex items-center gap-2">
                <Calendar className="h-4 w-4" />
                {t.currentPeriod.title}
              </h3>
              {data.currentPeriod && (
                <Badge
                  className={
                    data.currentPeriod.status === "open"
                      ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-100"
                      : "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-100"
                  }
                >
                  {data.currentPeriod.status === "open"
                    ? t.currentPeriod.statusOpen
                    : t.currentPeriod.statusProcessing}
                </Badge>
              )}
            </div>
            {data.currentPeriod ? (
              <div className="space-y-3">
                <p className="text-lg font-medium">{data.currentPeriod.name}</p>
                <div className="text-sm text-muted-foreground">
                  {new Date(data.currentPeriod.startDate).toLocaleDateString(
                    "he-IL"
                  )}{" "}
                  -{" "}
                  {new Date(data.currentPeriod.endDate).toLocaleDateString(
                    "he-IL"
                  )}
                </div>
                {/* Progress Bar */}
                <div className="space-y-1">
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>
                      {data.currentPeriod.daysElapsed} {t.currentPeriod.daysElapsed}
                    </span>
                    <span>
                      {data.currentPeriod.daysRemaining} {t.currentPeriod.daysRemaining}
                    </span>
                  </div>
                  <div className="h-2 rounded-full overflow-hidden bg-gray-200 dark:bg-gray-700">
                    <div
                      className="h-full bg-blue-500 transition-all duration-500"
                      style={{
                        width: `${data.currentPeriod.progressPercentage}%`,
                      }}
                    />
                  </div>
                </div>
              </div>
            ) : (
              <p className="text-muted-foreground">
                {t.currentPeriod.noActivePeriod}
              </p>
            )}
          </div>

          {/* Pending Actions */}
          <div
            className="p-4 rounded-lg border bg-muted/50"
            data-testid="pending-actions"
          >
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold flex items-center gap-2">
                <AlertTriangle className="h-4 w-4" />
                {t.pendingActions.title}
              </h3>
              <Badge
                variant={data.pendingActions.total > 0 ? "destructive" : "secondary"}
              >
                {data.pendingActions.total}
              </Badge>
            </div>
            {data.pendingActions.items.length > 0 ? (
              <div className="space-y-2">
                {data.pendingActions.items.map((item, index) => (
                  <div
                    key={index}
                    className="flex items-center justify-between text-sm"
                  >
                    <div className="flex items-center gap-2">
                      {getActionIcon(item.type)}
                      <span>{getActionLabel(item.type)}</span>
                    </div>
                    <Badge className={getPriorityColor(item.priority)}>
                      {item.count}
                    </Badge>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex items-center gap-2 text-green-600 dark:text-green-400">
                <CheckCircle2 className="h-5 w-5" />
                <span>{t.pendingActions.allClear}</span>
              </div>
            )}
          </div>
        </div>

        {/* Middle Row - Report Status and Cross-Reference Status */}
        <div className="grid gap-4 md:grid-cols-2">
          {/* Report Status */}
          <div
            className="p-4 rounded-lg border bg-muted/50"
            data-testid="report-status"
          >
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold flex items-center gap-2">
                <FileText className="h-4 w-4" />
                {t.reportStatus.title}
              </h3>
              <Link href="/admin/reports">
                <Button variant="ghost" size="sm" className="h-7 px-2">
                  {he.common.viewAll}{" "}
                  <ChevronLeft className="h-4 w-4 me-1 rtl-flip" />
                </Button>
              </Link>
            </div>
            <div className="space-y-4">
              {/* Overall Progress */}
              <div className="text-center p-3 rounded-lg bg-background">
                <p className="text-3xl font-bold text-primary">
                  {data.reportStatus.overallPercentage}%
                </p>
                <p className="text-xs text-muted-foreground">
                  {t.reportStatus.overallReceived}
                </p>
              </div>
              {/* Supplier/Franchisee Breakdown */}
              <div className="grid grid-cols-2 gap-3">
                <div className="text-center p-2 rounded bg-background">
                  <div className="flex items-center justify-center gap-1 mb-1">
                    <span className="text-lg font-semibold text-green-600 dark:text-green-400">
                      {data.reportStatus.suppliersReceived}
                    </span>
                    <span className="text-muted-foreground">/</span>
                    <span className="text-sm text-muted-foreground">
                      {data.reportStatus.suppliersTotal}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {t.reportStatus.suppliers}
                  </p>
                </div>
                <div className="text-center p-2 rounded bg-background">
                  <div className="flex items-center justify-center gap-1 mb-1">
                    <span className="text-lg font-semibold text-green-600 dark:text-green-400">
                      {data.reportStatus.franchiseesReceived}
                    </span>
                    <span className="text-muted-foreground">/</span>
                    <span className="text-sm text-muted-foreground">
                      {data.reportStatus.franchiseesTotal}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {t.reportStatus.franchisees}
                  </p>
                </div>
              </div>
              {/* Missing Reports Warning */}
              {(data.reportStatus.suppliersMissing > 0 ||
                data.reportStatus.franchiseesMissing > 0) && (
                <div className="flex items-center gap-2 text-sm text-amber-600 dark:text-amber-400">
                  <AlertTriangle className="h-4 w-4" />
                  <span>
                    {data.reportStatus.suppliersMissing +
                      data.reportStatus.franchiseesMissing}{" "}
                    {t.reportStatus.missing}
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Cross-Reference Status */}
          <div
            className="p-4 rounded-lg border bg-muted/50"
            data-testid="cross-reference-status"
          >
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4" />
                {t.crossReference.title}
              </h3>
              <Link href="/admin/reconciliation">
                <Button variant="ghost" size="sm" className="h-7 px-2">
                  {he.common.viewAll}{" "}
                  <ChevronLeft className="h-4 w-4 me-1 rtl-flip" />
                </Button>
              </Link>
            </div>
            <div className="space-y-4">
              {/* Match Percentage */}
              <div className="text-center p-3 rounded-lg bg-background">
                <p
                  className={`text-3xl font-bold ${
                    data.crossReferenceStatus.matchedPercentage >= 90
                      ? "text-green-600 dark:text-green-400"
                      : data.crossReferenceStatus.matchedPercentage >= 70
                        ? "text-amber-600 dark:text-amber-400"
                        : "text-red-600 dark:text-red-400"
                  }`}
                >
                  {data.crossReferenceStatus.matchedPercentage}%
                </p>
                <p className="text-xs text-muted-foreground">
                  {t.crossReference.matchRate}
                </p>
              </div>
              {/* Status Breakdown */}
              <div className="grid grid-cols-3 gap-2">
                <div className="text-center p-2 rounded bg-background">
                  <p className="text-lg font-semibold text-green-600 dark:text-green-400">
                    {data.crossReferenceStatus.matched}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {t.crossReference.matched}
                  </p>
                </div>
                <div className="text-center p-2 rounded bg-background">
                  <p className="text-lg font-semibold text-red-600 dark:text-red-400">
                    {data.crossReferenceStatus.discrepancies}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {t.crossReference.discrepancies}
                  </p>
                </div>
                <div className="text-center p-2 rounded bg-background">
                  <p className="text-lg font-semibold text-amber-600 dark:text-amber-400">
                    {data.crossReferenceStatus.pending}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {t.crossReference.pending}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Bottom Row - Workflow Progress */}
        <div
          className="p-4 rounded-lg border bg-muted/50"
          data-testid="workflow-progress"
        >
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold flex items-center gap-2">
              <Clock className="h-4 w-4" />
              {t.workflow.title}
            </h3>
            <Link href="/admin/settlements">
              <Button variant="ghost" size="sm" className="h-7 px-2">
                {he.common.viewAll}{" "}
                <ChevronLeft className="h-4 w-4 me-1 rtl-flip" />
              </Button>
            </Link>
          </div>

          {/* Workflow Steps */}
          <div className="flex items-center justify-between">
            {data.workflowProgress.steps.map((step, index) => (
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
                        className={`font-bold ${
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
                    {getStepLabel(step.name)}
                  </span>
                </div>
                {index < data.workflowProgress.steps.length - 1 && (
                  <div className="flex-1 mx-2">
                    <ArrowLeft
                      className={`h-4 w-4 rtl-flip ${
                        step.status === "completed"
                          ? "text-green-500"
                          : "text-muted-foreground"
                      }`}
                    />
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Progress Bar */}
          <div className="mt-4">
            <div className="h-2 rounded-full overflow-hidden bg-gray-200 dark:bg-gray-700 flex">
              {data.workflowProgress.steps.map((step, index) => (
                <div
                  key={step.name}
                  className={`h-full flex-1 ${getStepStatusColor(step.status)} ${
                    index < data.workflowProgress.steps.length - 1
                      ? "border-e border-white dark:border-gray-800"
                      : ""
                  }`}
                />
              ))}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
