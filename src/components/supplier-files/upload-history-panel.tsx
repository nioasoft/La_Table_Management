"use client";

import { useState } from "react";
import { useSupplierUploadHistory } from "@/queries/supplier-file-uploads";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Clock,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Eye,
  Loader2,
  FileSpreadsheet,
  History,
  ChevronDown,
} from "lucide-react";
import { formatDistanceToNow, format } from "date-fns";
import { he } from "date-fns/locale";
import Link from "next/link";
import { Button } from "@/components/ui/button";

interface UploadHistoryPanelProps {
  supplierId: string;
  supplierName: string;
}

const statusConfig = {
  auto_approved: {
    label: "אושר אוטומטית",
    icon: CheckCircle2,
    variant: "success" as const,
  },
  approved: {
    label: "אושר",
    icon: CheckCircle2,
    variant: "success" as const,
  },
  needs_review: {
    label: "ממתין",
    icon: AlertTriangle,
    variant: "outline" as const,
    className: "bg-yellow-50 text-yellow-700 border-yellow-300",
  },
  rejected: {
    label: "נדחה",
    icon: XCircle,
    variant: "destructive" as const,
  },
};

const INITIAL_ITEMS_TO_SHOW = 3;

export function UploadHistoryPanel({
  supplierId,
  supplierName,
}: UploadHistoryPanelProps) {
  const [expanded, setExpanded] = useState(false);
  const { data, isLoading, error } = useSupplierUploadHistory(supplierId, {
    limit: 10,
  });

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <History className="h-5 w-5" />
            היסטוריית העלאות
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <History className="h-5 w-5" />
            היסטוריית העלאות
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-destructive">שגיאה בטעינת היסטוריה</p>
        </CardContent>
      </Card>
    );
  }

  const files = data?.files || [];
  const latestFile = files[0];

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <History className="h-5 w-5" />
          היסטוריית העלאות - {supplierName}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Latest Upload Highlight */}
        {latestFile && (
          <div className="rounded-lg border bg-muted/50 p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">העלאה אחרונה</span>
              {(() => {
                const config =
                  statusConfig[
                    latestFile.processingStatus as keyof typeof statusConfig
                  ];
                if (!config) return null;
                const Icon = config.icon;
                return (
                  <Badge
                    variant={config.variant}
                    className={
                      "className" in config ? config.className : undefined
                    }
                  >
                    <Icon className="h-3 w-3 me-1" />
                    {config.label}
                  </Badge>
                );
              })()}
            </div>
            <div className="flex items-center justify-between text-sm">
              <div className="flex items-center gap-2 text-muted-foreground">
                <Clock className="h-3.5 w-3.5" />
                <span>
                  {format(new Date(latestFile.createdAt), "dd/MM/yyyy HH:mm", {
                    locale: he,
                  })}
                </span>
              </div>
              <span className="text-muted-foreground">
                {formatDistanceToNow(new Date(latestFile.createdAt), {
                  locale: he,
                  addSuffix: true,
                })}
              </span>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <FileSpreadsheet className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="truncate">{latestFile.originalFileName}</span>
            </div>
            {latestFile.processingStatus === "needs_review" && (
              <Link href={`/admin/supplier-files/review/${latestFile.id}`}>
                <Button variant="outline" size="sm" className="w-full mt-2">
                  <Eye className="h-4 w-4 me-2" />
                  בדיקה ואישור
                </Button>
              </Link>
            )}
          </div>
        )}

        {/* History Table */}
        {files.length > 0 ? (
          <div className="space-y-2">
            <div className="rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[40%]">קובץ</TableHead>
                    <TableHead className="w-[30%]">תאריך</TableHead>
                    <TableHead className="w-[30%]">סטטוס</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {files.slice(0, INITIAL_ITEMS_TO_SHOW).map((file) => {
                    const config =
                      statusConfig[
                        file.processingStatus as keyof typeof statusConfig
                      ];
                    const Icon = config?.icon || AlertTriangle;
                    return (
                      <TableRow key={file.id} className="text-xs">
                        <TableCell className="truncate max-w-[150px]" title={file.originalFileName}>
                          {file.originalFileName}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {format(new Date(file.createdAt), "dd/MM/yy", {
                            locale: he,
                          })}
                        </TableCell>
                        <TableCell>
                          {config ? (
                            <Badge
                              variant={config.variant}
                              className={cn(
                                "text-xs gap-1",
                                "className" in config ? config.className : undefined
                              )}
                            >
                              <Icon className="h-3 w-3" />
                              {config.label}
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="text-xs">
                              {file.processingStatus}
                            </Badge>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>

            {/* Expandable section for more items */}
            {files.length > INITIAL_ITEMS_TO_SHOW && (
              <Collapsible open={expanded} onOpenChange={setExpanded}>
                <CollapsibleTrigger asChild>
                  <button className="flex items-center justify-center gap-2 w-full py-2 text-sm text-muted-foreground hover:text-foreground transition-colors">
                    <span>
                      {expanded
                        ? "הסתר"
                        : `הצג עוד ${files.length - INITIAL_ITEMS_TO_SHOW} העלאות`}
                    </span>
                    <ChevronDown className={cn(
                      "h-4 w-4 transition-transform",
                      expanded && "rotate-180"
                    )} />
                  </button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="rounded-lg border">
                    <Table>
                      <TableBody>
                        {files.slice(INITIAL_ITEMS_TO_SHOW).map((file) => {
                          const config =
                            statusConfig[
                              file.processingStatus as keyof typeof statusConfig
                            ];
                          const Icon = config?.icon || AlertTriangle;
                          return (
                            <TableRow key={file.id} className="text-xs">
                              <TableCell className="truncate max-w-[150px] w-[40%]" title={file.originalFileName}>
                                {file.originalFileName}
                              </TableCell>
                              <TableCell className="text-muted-foreground w-[30%]">
                                {format(new Date(file.createdAt), "dd/MM/yy", {
                                  locale: he,
                                })}
                              </TableCell>
                              <TableCell className="w-[30%]">
                                {config ? (
                                  <Badge
                                    variant={config.variant}
                                    className={cn(
                                      "text-xs gap-1",
                                      "className" in config ? config.className : undefined
                                    )}
                                  >
                                    <Icon className="h-3 w-3" />
                                    {config.label}
                                  </Badge>
                                ) : (
                                  <Badge variant="outline" className="text-xs">
                                    {file.processingStatus}
                                  </Badge>
                                )}
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                </CollapsibleContent>
              </Collapsible>
            )}
          </div>
        ) : (
          <div className="text-center py-6 text-muted-foreground text-sm">
            <FileSpreadsheet className="h-8 w-8 mx-auto mb-2 opacity-50" />
            <p>אין היסטוריית העלאות לספק זה</p>
          </div>
        )}

        {/* View All Link */}
        {files.length > 0 && (
          <div className="text-center">
            <Link
              href={`/admin/supplier-files/review?supplierId=${supplierId}`}
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              צפייה בכל ההעלאות ({data?.total || 0})
            </Link>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

