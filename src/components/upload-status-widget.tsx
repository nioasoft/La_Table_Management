"use client";

import { useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AlertTriangle,
  Upload,
  Clock,
  RefreshCw,
  CheckCircle2,
  XCircle,
  Users,
  Building2,
  FileUp,
} from "lucide-react";
import type { UploadStatusResponse } from "@/app/api/dashboard/upload-status/route";
import { t, formatDate as formatDateHe } from "@/lib/translations";
import { useUploadStatus } from "@/queries/dashboard";

type EntityUploadStatus = UploadStatusResponse["suppliers"][0];
type PendingLink = EntityUploadStatus["pendingLinks"][0];

export function UploadStatusWidget() {
  const { data, isLoading, error, refetch } = useUploadStatus();
  const [activeTab, setActiveTab] = useState<"overview" | "suppliers" | "franchisees">("overview");

  // Don't show widget if user doesn't have permission (403 error)
  if (error && (error as any)?.message?.includes("403")) {
    return null;
  }

  if (isLoading) {
    return (
      <Card data-testid="upload-status-loading">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <RefreshCw className="h-5 w-5 animate-spin" />
            {t("dashboard.uploadStatus.loadingStatus")}
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
      <Card data-testid="upload-status-error">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="h-5 w-5" />
            {t("dashboard.uploadStatus.errorLoadingStatus")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground mb-4">
            {t("dashboard.uploadStatus.unableToLoad")}
          </p>
          <Button variant="outline" onClick={() => refetch()}>
            <RefreshCw className="ml-2 h-4 w-4" />
            {t("common.retry")}
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (!data) {
    return null;
  }

  const formatDate = (dateString: string | Date | null) => {
    if (!dateString) return t("dashboard.uploadStatus.expiry.noExpiry");
    const date = new Date(dateString);
    return formatDateHe(date, {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  };

  const getDaysUntil = (dateString: string | Date | null) => {
    if (!dateString) return Infinity;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const targetDate = new Date(dateString);
    targetDate.setHours(0, 0, 0, 0);
    const diffTime = targetDate.getTime() - today.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays;
  };

  const getExpiryBadge = (expiresAt: Date | null) => {
    if (!expiresAt) return <Badge variant="secondary">{t("dashboard.uploadStatus.expiry.noExpiry")}</Badge>;
    const daysUntil = getDaysUntil(expiresAt);
    if (daysUntil <= 0) {
      return <Badge variant="destructive">{t("dashboard.uploadStatus.expiry.expired")}</Badge>;
    }
    if (daysUntil <= 3) {
      return <Badge variant="destructive">{t("dashboard.uploadStatus.expiry.expiresIn", { days: daysUntil })}</Badge>;
    }
    if (daysUntil <= 7) {
      return <Badge variant="warning">{t("dashboard.uploadStatus.expiry.expiresIn", { days: daysUntil })}</Badge>;
    }
    return <Badge variant="info">{formatDate(expiresAt)}</Badge>;
  };

  // Get entities with pending uploads (sorted by number of pending links)
  const entitiesWithPending = [...data.suppliers, ...data.franchisees]
    .filter((e) => e.uploadStats.pending > 0)
    .sort((a, b) => b.uploadStats.pending - a.uploadStats.pending)
    .slice(0, 5);

  // Get entities without any uploads (never uploaded)
  const entitiesWithoutUploads = [...data.suppliers, ...data.franchisees]
    .filter((e) => !e.hasUploaded && e.uploadStats.total === 0)
    .slice(0, 5);

  // Get all pending links sorted by expiry date
  const allPendingLinks = [...data.suppliers, ...data.franchisees]
    .flatMap((e: EntityUploadStatus) =>
      e.pendingLinks.map((l: PendingLink) => ({
        ...l,
        entityName: e.name,
        entityType: e.entityType,
        entityId: e.id,
      }))
    )
    .sort((a, b) => {
      const aTime = a.expiresAt ? new Date(a.expiresAt).getTime() : Infinity;
      const bTime = b.expiresAt ? new Date(b.expiresAt).getTime() : Infinity;
      return aTime - bTime;
    })
    .slice(0, 5);

  return (
    <Card data-testid="upload-status-widget" className="col-span-1 lg:col-span-2">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Upload className="h-5 w-5" />
              {t("dashboard.uploadStatus.title")}
            </CardTitle>
            <CardDescription>
              {t("dashboard.uploadStatus.description")}
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => refetch()}
              className="h-8 w-8 p-0"
              title={t("common.refresh")}
            >
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Stats Summary */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-center">
          <div className="p-2 rounded-lg bg-muted/50">
            <p className="text-2xl font-bold" data-testid="total-entities-count">
              {data.summary.totalEntities}
            </p>
            <p className="text-xs text-muted-foreground">{t("dashboard.uploadStatus.stats.totalEntities")}</p>
          </div>
          <div className="p-2 rounded-lg bg-muted/50">
            <p className="text-2xl font-bold text-green-600" data-testid="with-uploads-count">
              {data.summary.entitiesWithUploads}
            </p>
            <p className="text-xs text-muted-foreground">{t("dashboard.uploadStatus.stats.withUploads")}</p>
          </div>
          <div className="p-2 rounded-lg bg-muted/50">
            <p className="text-2xl font-bold text-blue-600" data-testid="pending-links-count">
              {data.summary.totalPendingLinks}
            </p>
            <p className="text-xs text-muted-foreground">{t("dashboard.uploadStatus.stats.pendingLinks")}</p>
          </div>
          <div className="p-2 rounded-lg bg-muted/50">
            <p className="text-2xl font-bold text-amber-600" data-testid="expiring-soon-count">
              {data.summary.expiringSoon}
            </p>
            <p className="text-xs text-muted-foreground">{t("dashboard.uploadStatus.stats.expiringSoon")}</p>
          </div>
        </div>

        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as typeof activeTab)}>
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="overview">{t("dashboard.uploadStatus.tabs.overview")}</TabsTrigger>
            <TabsTrigger value="suppliers">{t("dashboard.uploadStatus.tabs.suppliers")}</TabsTrigger>
            <TabsTrigger value="franchisees">{t("dashboard.uploadStatus.tabs.franchisees")}</TabsTrigger>
          </TabsList>

          {/* Overview Tab */}
          <TabsContent value="overview" className="space-y-4 mt-4">
            {/* Pending Upload Links */}
            {allPendingLinks.length > 0 && (
              <div>
                <h4 className="text-sm font-medium mb-2 flex items-center gap-2">
                  <Clock className="h-4 w-4" />
                  {t("dashboard.uploadStatus.sections.pendingUploadLinks")}
                </h4>
                <div className="space-y-2">
                  {allPendingLinks.map((link) => (
                    <div
                      key={link.id}
                      className="flex items-center justify-between p-2 rounded-lg border bg-muted/30"
                      data-testid={`pending-link-${link.id}`}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <div className="h-8 w-8 rounded-full bg-blue-100 dark:bg-blue-900 flex items-center justify-center flex-shrink-0">
                          {link.entityType === "supplier" ? (
                            <Users className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                          ) : (
                            <Building2 className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                          )}
                        </div>
                        <div className="min-w-0">
                          <p className="font-medium text-sm truncate">{link.name}</p>
                          <p className="text-xs text-muted-foreground truncate">
                            {link.entityName}
                          </p>
                        </div>
                      </div>
                      {getExpiryBadge(link.expiresAt)}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Entities with Pending Uploads */}
            {entitiesWithPending.length > 0 && (
              <div>
                <h4 className="text-sm font-medium mb-2 flex items-center gap-2">
                  <FileUp className="h-4 w-4" />
                  {t("dashboard.uploadStatus.sections.awaitingUploads")}
                </h4>
                <div className="space-y-2">
                  {entitiesWithPending.map((entity) => (
                    <div
                      key={entity.id}
                      className="flex items-center justify-between p-2 rounded-lg border bg-muted/30"
                      data-testid={`awaiting-upload-${entity.id}`}
                    >
                      <div className="flex items-center gap-2">
                        <div className="h-8 w-8 rounded-full bg-amber-100 dark:bg-amber-900 flex items-center justify-center">
                          {entity.entityType === "supplier" ? (
                            <Users className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                          ) : (
                            <Building2 className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                          )}
                        </div>
                        <div>
                          <p className="font-medium text-sm">{entity.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {entity.entityType === "supplier" ? t("upload.entityTypes.supplier") : t("upload.entityTypes.franchisee")}
                          </p>
                        </div>
                      </div>
                      <Badge variant="warning">{entity.uploadStats.pending} {t("dashboard.uploadStatus.status.pending")}</Badge>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Entities without any uploads */}
            {entitiesWithoutUploads.length > 0 && (
              <div>
                <h4 className="text-sm font-medium mb-2 flex items-center gap-2">
                  <XCircle className="h-4 w-4" />
                  {t("dashboard.uploadStatus.sections.noUploadLinks")}
                </h4>
                <div className="space-y-2">
                  {entitiesWithoutUploads.map((entity) => (
                    <div
                      key={entity.id}
                      className="flex items-center justify-between p-2 rounded-lg border bg-muted/30"
                      data-testid={`no-uploads-${entity.id}`}
                    >
                      <div className="flex items-center gap-2">
                        <div className="h-8 w-8 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center">
                          {entity.entityType === "supplier" ? (
                            <Users className="h-4 w-4 text-gray-600 dark:text-gray-400" />
                          ) : (
                            <Building2 className="h-4 w-4 text-gray-600 dark:text-gray-400" />
                          )}
                        </div>
                        <div>
                          <p className="font-medium text-sm">{entity.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {entity.entityType === "supplier" ? t("upload.entityTypes.supplier") : t("upload.entityTypes.franchisee")}
                          </p>
                        </div>
                      </div>
                      <Badge variant="outline">{t("dashboard.uploadStatus.status.noLinks")}</Badge>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Empty State */}
            {allPendingLinks.length === 0 && entitiesWithPending.length === 0 && entitiesWithoutUploads.length === 0 && (
              <div className="text-center py-4">
                <CheckCircle2 className="h-12 w-12 mx-auto text-green-500 mb-2" />
                <p className="text-muted-foreground">{t("dashboard.uploadStatus.allComplete")}</p>
              </div>
            )}
          </TabsContent>

          {/* Suppliers Tab */}
          <TabsContent value="suppliers" className="space-y-3 mt-4">
            <EntityList
              entities={data.suppliers}
              entityType="supplier"
              formatDate={formatDate}
              getExpiryBadge={getExpiryBadge}
            />
          </TabsContent>

          {/* Franchisees Tab */}
          <TabsContent value="franchisees" className="space-y-3 mt-4">
            <EntityList
              entities={data.franchisees}
              entityType="franchisee"
              formatDate={formatDate}
              getExpiryBadge={getExpiryBadge}
            />
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}

// Entity List Component
function EntityList({
  entities,
  entityType,
  formatDate,
  getExpiryBadge,
}: {
  entities: EntityUploadStatus[];
  entityType: "supplier" | "franchisee";
  formatDate: (date: string | Date | null) => string;
  getExpiryBadge: (date: Date | null) => React.ReactNode;
}) {
  const Icon = entityType === "supplier" ? Users : Building2;

  // Separate entities into groups
  const withPending = entities.filter((e) => e.uploadStats.pending > 0);
  const withUploads = entities.filter((e) => e.hasUploaded && e.uploadStats.pending === 0);
  const withoutActivity = entities.filter((e) => !e.hasUploaded && e.uploadStats.total === 0);

  const entityTypeLabel = entityType === "supplier"
    ? t("dashboard.uploadStatus.tabs.suppliers")
    : t("dashboard.uploadStatus.tabs.franchisees");

  if (entities.length === 0) {
    return (
      <div className="text-center py-4">
        <Icon className="h-12 w-12 mx-auto text-muted-foreground mb-2" />
        <p className="text-muted-foreground">
          {t("dashboard.uploadStatus.noEntitiesFound", { entityType: entityTypeLabel })}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Pending Uploads Section */}
      {withPending.length > 0 && (
        <div>
          <h4 className="text-sm font-medium mb-2 text-amber-600 flex items-center gap-2">
            <Clock className="h-4 w-4" />
            {t("dashboard.uploadStatus.sections.awaitingUpload")} ({withPending.length})
          </h4>
          <div className="space-y-2">
            {withPending.map((entity) => (
              <EntityRow
                key={entity.id}
                entity={entity}
                Icon={Icon}
                colorClass="bg-amber-100 dark:bg-amber-900"
                iconColorClass="text-amber-600 dark:text-amber-400"
                getExpiryBadge={getExpiryBadge}
              />
            ))}
          </div>
        </div>
      )}

      {/* Completed Uploads Section */}
      {withUploads.length > 0 && (
        <div>
          <h4 className="text-sm font-medium mb-2 text-green-600 flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4" />
            {t("dashboard.uploadStatus.sections.uploaded")} ({withUploads.length})
          </h4>
          <div className="space-y-2">
            {withUploads.map((entity) => (
              <EntityRow
                key={entity.id}
                entity={entity}
                Icon={Icon}
                colorClass="bg-green-100 dark:bg-green-900"
                iconColorClass="text-green-600 dark:text-green-400"
                getExpiryBadge={getExpiryBadge}
              />
            ))}
          </div>
        </div>
      )}

      {/* No Activity Section */}
      {withoutActivity.length > 0 && (
        <div>
          <h4 className="text-sm font-medium mb-2 text-muted-foreground flex items-center gap-2">
            <XCircle className="h-4 w-4" />
            {t("dashboard.uploadStatus.sections.noUploadLinksShort")} ({withoutActivity.length})
          </h4>
          <div className="space-y-2">
            {withoutActivity.map((entity) => (
              <EntityRow
                key={entity.id}
                entity={entity}
                Icon={Icon}
                colorClass="bg-gray-100 dark:bg-gray-800"
                iconColorClass="text-gray-600 dark:text-gray-400"
                getExpiryBadge={getExpiryBadge}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// Entity Row Component
function EntityRow({
  entity,
  Icon,
  colorClass,
  iconColorClass,
  getExpiryBadge,
}: {
  entity: EntityUploadStatus;
  Icon: typeof Users | typeof Building2;
  colorClass: string;
  iconColorClass: string;
  getExpiryBadge: (date: Date | null) => React.ReactNode;
}) {
  return (
    <div
      className="flex items-center justify-between p-2 rounded-lg border bg-muted/30"
      data-testid={`entity-row-${entity.id}`}
    >
      <div className="flex items-center gap-2">
        <div className={`h-8 w-8 rounded-full ${colorClass} flex items-center justify-center`}>
          <Icon className={`h-4 w-4 ${iconColorClass}`} />
        </div>
        <div>
          <p className="font-medium text-sm">{entity.name}</p>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            {entity.uploadStats.uploaded > 0 && (
              <span className="text-green-600">{entity.uploadStats.uploaded} {t("dashboard.uploadStatus.status.uploaded")}</span>
            )}
            {entity.uploadStats.pending > 0 && (
              <span className="text-amber-600">{entity.uploadStats.pending} {t("dashboard.uploadStatus.status.pending")}</span>
            )}
            {entity.uploadStats.expired > 0 && (
              <span className="text-red-600">{entity.uploadStats.expired} {t("dashboard.uploadStatus.status.expired")}</span>
            )}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2">
        {entity.pendingLinks.length > 0 && entity.pendingLinks[0].expiresAt && (
          getExpiryBadge(entity.pendingLinks[0].expiresAt)
        )}
        {entity.hasUploaded && entity.uploadStats.pending === 0 && (
          <Badge variant="default" className="bg-green-600">{t("dashboard.uploadStatus.status.complete")}</Badge>
        )}
      </div>
    </div>
  );
}
