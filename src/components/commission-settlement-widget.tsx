"use client";

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
  Coins,
  RefreshCw,
  ChevronLeft,
  CheckCircle2,
  Clock,
  FileText,
  ArrowLeft,
} from "lucide-react";
import { he } from "@/lib/translations";
import { useCommissionSettlementStatus } from "@/queries/dashboard";

const t = he.dashboard.commissionSettlement;

export function CommissionSettlementWidget() {
  const { data: response, isLoading, error, refetch } = useCommissionSettlementStatus();

  const data = response?.data ?? null;

  // Don't show widget if user doesn't have permission (403 error)
  if (error && (error as any)?.message?.includes("403")) {
    return null;
  }

  if (isLoading) {
    return (
      <Card data-testid="commission-settlement-widget-loading">
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

  if (error) {
    return (
      <Card data-testid="commission-settlement-widget-error">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="h-5 w-5" />
            {t.errorLoadingStatus}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground mb-4">
            {t.unableToLoad}
          </p>
          <Button variant="outline" onClick={() => refetch()}>
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

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat("he-IL", {
      style: "currency",
      currency: "ILS",
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "open":
        return "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-100";
      case "processing":
        return "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-100";
      case "pending_approval":
        return "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-100";
      case "approved":
        return "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-100";
      case "invoiced":
        return "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-100";
      default:
        return "";
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case "open":
        return t.workflow.open;
      case "processing":
        return t.workflow.processing;
      case "pending_approval":
        return t.workflow.pendingApproval;
      case "approved":
        return t.workflow.approved;
      case "invoiced":
        return t.workflow.done;
      default:
        return status;
    }
  };

  const totalWorkflowItems =
    data.settlementWorkflow.open +
    data.settlementWorkflow.processing +
    data.settlementWorkflow.pendingApproval +
    data.settlementWorkflow.approved +
    data.settlementWorkflow.invoiced;

  return (
    <Card data-testid="commission-settlement-widget" className="col-span-1 lg:col-span-2">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Coins className="h-5 w-5" />
              {t.title}
            </CardTitle>
            <CardDescription>
              {t.description}
            </CardDescription>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => refetch()}
            className="h-8 w-8 p-0"
            title={he.common.refresh}
          >
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Current Period Status */}
        <div
          className="p-4 rounded-lg border bg-muted/50"
          data-testid="current-period-status"
        >
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold flex items-center gap-2">
              <Calendar className="h-4 w-4" />
              {t.currentPeriod.title}
            </h3>
            {data.currentPeriod && (
              <Badge className={getStatusColor(data.currentPeriod.status)}>
                {getStatusLabel(data.currentPeriod.status)}
              </Badge>
            )}
          </div>
          {data.currentPeriod ? (
            <div className="space-y-2">
              <p className="text-lg font-medium">{data.currentPeriod.name}</p>
              <div className="flex items-center gap-4 text-sm text-muted-foreground">
                <span>
                  {new Date(data.currentPeriod.startDate).toLocaleDateString("he-IL")} - {new Date(data.currentPeriod.endDate).toLocaleDateString("he-IL")}
                </span>
                <Badge variant="outline" className="flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  {data.currentPeriod.daysRemaining} {t.currentPeriod.daysRemaining}
                </Badge>
              </div>
            </div>
          ) : (
            <p className="text-muted-foreground">{t.currentPeriod.noActivePeriod}</p>
          )}
        </div>

        {/* Commission Summary */}
        <div
          className="p-4 rounded-lg border bg-muted/50"
          data-testid="commission-summary"
        >
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold flex items-center gap-2">
              <Coins className="h-4 w-4" />
              {t.commissionSummary.title}
            </h3>
            <Link href="/admin/commissions">
              <Button variant="ghost" size="sm" className="h-7 px-2">
                {he.common.viewAll} <ChevronLeft className="h-4 w-4 me-1 rtl-flip" />
              </Button>
            </Link>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="text-center p-3 rounded-lg bg-background">
              <p className="text-2xl font-bold text-green-600 dark:text-green-400">
                {formatCurrency(data.commissionSummary.totalAmount)}
              </p>
              <p className="text-xs text-muted-foreground">{t.commissionSummary.totalAmount}</p>
            </div>
            <div className="text-center p-3 rounded-lg bg-background">
              <p className="text-2xl font-bold text-amber-600 dark:text-amber-400">
                {data.commissionSummary.pendingCount}
              </p>
              <p className="text-xs text-muted-foreground">{t.commissionSummary.pending}</p>
            </div>
            <div className="text-center p-3 rounded-lg bg-background">
              <p className="text-2xl font-bold text-purple-600 dark:text-purple-400">
                {data.commissionSummary.approvedCount}
              </p>
              <p className="text-xs text-muted-foreground">{t.commissionSummary.approved}</p>
            </div>
            <div className="text-center p-3 rounded-lg bg-background">
              <p className="text-2xl font-bold text-blue-600 dark:text-blue-400">
                {data.commissionSummary.paidCount}
              </p>
              <p className="text-xs text-muted-foreground">{t.commissionSummary.paid}</p>
            </div>
          </div>
        </div>

        {/* Settlement Workflow Progress */}
        <div
          className="p-4 rounded-lg border bg-muted/50"
          data-testid="settlement-workflow"
        >
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold flex items-center gap-2">
              <FileText className="h-4 w-4" />
              {t.workflow.title}
            </h3>
            <Link href="/admin/settlements">
              <Button variant="ghost" size="sm" className="h-7 px-2">
                {he.common.viewAll} <ChevronLeft className="h-4 w-4 me-1 rtl-flip" />
              </Button>
            </Link>
          </div>

          {/* Workflow Progress Bar */}
          <div className="mb-4">
            <div className="flex items-center gap-1 h-3 rounded-full overflow-hidden bg-gray-200 dark:bg-gray-700">
              {totalWorkflowItems > 0 ? (
                <>
                  {data.settlementWorkflow.open > 0 && (
                    <div
                      className="h-full bg-green-500"
                      style={{
                        width: `${(data.settlementWorkflow.open / totalWorkflowItems) * 100}%`,
                      }}
                      title={`${t.workflow.open}: ${data.settlementWorkflow.open}`}
                    />
                  )}
                  {data.settlementWorkflow.processing > 0 && (
                    <div
                      className="h-full bg-blue-500"
                      style={{
                        width: `${(data.settlementWorkflow.processing / totalWorkflowItems) * 100}%`,
                      }}
                      title={`${t.workflow.processing}: ${data.settlementWorkflow.processing}`}
                    />
                  )}
                  {data.settlementWorkflow.pendingApproval > 0 && (
                    <div
                      className="h-full bg-amber-500"
                      style={{
                        width: `${(data.settlementWorkflow.pendingApproval / totalWorkflowItems) * 100}%`,
                      }}
                      title={`${t.workflow.pendingApproval}: ${data.settlementWorkflow.pendingApproval}`}
                    />
                  )}
                  {data.settlementWorkflow.approved > 0 && (
                    <div
                      className="h-full bg-purple-500"
                      style={{
                        width: `${(data.settlementWorkflow.approved / totalWorkflowItems) * 100}%`,
                      }}
                      title={`${t.workflow.approved}: ${data.settlementWorkflow.approved}`}
                    />
                  )}
                  {data.settlementWorkflow.invoiced > 0 && (
                    <div
                      className="h-full bg-gray-500"
                      style={{
                        width: `${(data.settlementWorkflow.invoiced / totalWorkflowItems) * 100}%`,
                      }}
                      title={`${t.workflow.done}: ${data.settlementWorkflow.invoiced}`}
                    />
                  )}
                </>
              ) : (
                <div className="h-full w-full bg-gray-300 dark:bg-gray-600" />
              )}
            </div>
          </div>

          {/* Workflow Steps */}
          <div className="flex items-center justify-between text-xs">
            <div className="flex flex-col items-center">
              <div className="h-8 w-8 rounded-full bg-green-100 dark:bg-green-900 flex items-center justify-center mb-1">
                <span className="font-bold text-green-600 dark:text-green-400">
                  {data.settlementWorkflow.open}
                </span>
              </div>
              <span className="text-muted-foreground">{t.workflow.open}</span>
            </div>
            <ArrowLeft className="h-4 w-4 text-muted-foreground rtl-flip" />
            <div className="flex flex-col items-center">
              <div className="h-8 w-8 rounded-full bg-blue-100 dark:bg-blue-900 flex items-center justify-center mb-1">
                <span className="font-bold text-blue-600 dark:text-blue-400">
                  {data.settlementWorkflow.processing}
                </span>
              </div>
              <span className="text-muted-foreground">{t.workflow.processing}</span>
            </div>
            <ArrowLeft className="h-4 w-4 text-muted-foreground rtl-flip" />
            <div className="flex flex-col items-center">
              <div className="h-8 w-8 rounded-full bg-amber-100 dark:bg-amber-900 flex items-center justify-center mb-1">
                <span className="font-bold text-amber-600 dark:text-amber-400">
                  {data.settlementWorkflow.pendingApproval}
                </span>
              </div>
              <span className="text-muted-foreground">{t.workflow.pendingApproval}</span>
            </div>
            <ArrowLeft className="h-4 w-4 text-muted-foreground rtl-flip" />
            <div className="flex flex-col items-center">
              <div className="h-8 w-8 rounded-full bg-purple-100 dark:bg-purple-900 flex items-center justify-center mb-1">
                <span className="font-bold text-purple-600 dark:text-purple-400">
                  {data.settlementWorkflow.approved}
                </span>
              </div>
              <span className="text-muted-foreground">{t.workflow.approved}</span>
            </div>
            <ArrowLeft className="h-4 w-4 text-muted-foreground rtl-flip" />
            <div className="flex flex-col items-center">
              <div className="h-8 w-8 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center mb-1">
                <CheckCircle2 className="h-4 w-4 text-gray-600 dark:text-gray-400" />
              </div>
              <span className="text-muted-foreground">{data.settlementWorkflow.invoiced} {t.workflow.done}</span>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
