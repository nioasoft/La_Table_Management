"use client";

import { useState } from "react";
import { useSupplierUploadHistory } from "@/queries/supplier-file-uploads";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import {
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Loader2,
  FileSpreadsheet,
  Download,
  ChevronDown,
  CloudOff,
} from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { format } from "date-fns";
import { he } from "date-fns/locale";
import Link from "next/link";

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

const INITIAL_ITEMS = 5;

export function UploadHistoryPanel({
  supplierId,
  supplierName,
}: UploadHistoryPanelProps) {
  const [showAll, setShowAll] = useState(false);
  const { data, isLoading, error } = useSupplierUploadHistory(supplierId, {
    limit: 10,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <p className="text-sm text-destructive py-4">שגיאה בטעינת היסטוריה</p>
    );
  }

  const files = data?.files || [];

  if (files.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground text-sm">
        <FileSpreadsheet className="h-10 w-10 mx-auto mb-3 opacity-40" />
        <p>אין היסטוריית העלאות לספק זה</p>
      </div>
    );
  }

  const visibleFiles = showAll ? files : files.slice(0, INITIAL_ITEMS);
  const hasMore = files.length > INITIAL_ITEMS;

  return (
    <div className="space-y-3">
      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[40%]">שם קובץ</TableHead>
              <TableHead className="w-[25%]">תאריך העלאה</TableHead>
              <TableHead className="w-[20%]">סטטוס</TableHead>
              <TableHead className="w-[15%] text-center">הורדה</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visibleFiles.map((file) => {
              const config =
                statusConfig[
                  file.processingStatus as keyof typeof statusConfig
                ];
              const Icon = config?.icon || AlertTriangle;
              return (
                <TableRow key={file.id} className="text-sm">
                  <TableCell
                    className="truncate max-w-[200px]"
                    title={file.originalFileName}
                  >
                    {file.originalFileName}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {format(new Date(file.createdAt), "dd/MM/yyyy HH:mm", {
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
                  <TableCell className="text-center">
                    {file.fileUrl ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 w-8 p-0"
                        onClick={() =>
                          window.open(
                            `/api/reports/supplier-files/${file.id}/download`,
                            "_blank"
                          )
                        }
                        title="הורד קובץ"
                      >
                        <Download className="h-4 w-4" />
                      </Button>
                    ) : (
                      <TooltipProvider delayDuration={200}>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="inline-flex items-center justify-center h-8 w-8">
                              <CloudOff className="h-4 w-4 text-amber-500" />
                            </span>
                          </TooltipTrigger>
                          <TooltipContent>
                            <p>קובץ לא נשמר באחסון. יש להעלות מחדש.</p>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {/* Toggle show more / show less */}
      {hasMore && (
        <button
          onClick={() => setShowAll(!showAll)}
          className="flex items-center justify-center gap-2 w-full py-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <span>
            {showAll
              ? "הצג פחות"
              : `הצג עוד ${files.length - INITIAL_ITEMS} העלאות`}
          </span>
          <ChevronDown
            className={cn(
              "h-4 w-4 transition-transform",
              showAll && "rotate-180"
            )}
          />
        </button>
      )}

      {/* View all link */}
      <div className="text-center">
        <Link
          href={`/admin/supplier-files/review?supplierId=${supplierId}`}
          className="text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          צפייה בכל ההעלאות ({data?.total || 0})
        </Link>
      </div>
    </div>
  );
}
