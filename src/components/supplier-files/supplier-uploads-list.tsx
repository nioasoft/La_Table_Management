"use client";

import { useState } from "react";
import Link from "next/link";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { he } from "date-fns/locale";
import {
  AlertTriangle,
  ArrowRight,
  CloudOff,
  Download,
  FileSpreadsheet,
  Loader2,
} from "lucide-react";
import { fetchWithTimeout } from "@/lib/fetch-with-timeout";
import { cn } from "@/lib/utils";
import { supplierFileUploadKeys } from "@/queries/supplier-file-uploads";
import { statusConfig } from "@/components/suppliers/supplier-files-tab";
import type { SupplierFileUploadWithSupplier } from "@/data-access/supplier-file-uploads";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const PAGE_SIZE = 50;

interface SupplierUploadsResponse {
  files: SupplierFileUploadWithSupplier[];
  total: number;
}

interface SupplierUploadsListProps {
  supplierId: string;
}

function formatPeriod(start: string | null, end: string | null) {
  if (!start || !end) return "לא זמין";
  return `${new Date(start).toLocaleDateString("he-IL")} - ${new Date(end).toLocaleDateString("he-IL")}`;
}

/**
 * Every upload of one supplier — all statuses, rejected included, newest
 * first. Target of the upload-history panel's "צפייה בכל ההעלאות (N)" link,
 * so `total` here is the same count the link shows.
 */
export function SupplierUploadsList({ supplierId }: SupplierUploadsListProps) {
  const [offset, setOffset] = useState(0);
  const { data, isLoading, isFetching, error } = useQuery({
    queryKey: supplierFileUploadKeys.list({ supplierId, limit: PAGE_SIZE, offset }),
    queryFn: async (): Promise<SupplierUploadsResponse> => {
      const params = new URLSearchParams({
        supplierId,
        limit: String(PAGE_SIZE),
        offset: String(offset),
      });
      const res = await fetchWithTimeout(`/api/supplier-files?${params}`);
      if (!res.ok) {
        console.error("Supplier uploads fetch failed:", res.status);
        throw new Error("Failed to fetch supplier uploads");
      }
      return res.json();
    },
    placeholderData: keepPreviousData,
  });

  const files = data?.files ?? [];
  const total = data?.total ?? 0;
  const supplierName = files[0]?.supplierName;

  return (
    <div className="container mx-auto p-6">
      <div className="mb-8 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">
            כל ההעלאות{supplierName && ` — ${supplierName}`}
          </h1>
          <p className="text-muted-foreground mt-2">
            כל הקבצים שהועלו לספק, בכל הסטטוסים, מהחדש לישן
          </p>
        </div>
        <Button variant="outline" asChild>
          <Link href={`/admin/supplier-files?supplierId=${supplierId}`}>
            <ArrowRight className="h-4 w-4 ms-2" />
            חזרה לעיבוד קבצים
          </Link>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5" />
            העלאות
          </CardTitle>
          {data && <CardDescription>{total} קבצים</CardDescription>}
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : error ? (
            <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-center">
              <p className="text-destructive">שגיאה בטעינת ההעלאות</p>
            </div>
          ) : files.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground">
              <FileSpreadsheet className="h-12 w-12 mx-auto mb-4 opacity-40" />
              <p>אין היסטוריית העלאות לספק זה</p>
            </div>
          ) : (
            <>
              <div className={cn("rounded-md border", isFetching && "opacity-60")}>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>שם קובץ</TableHead>
                      <TableHead>תקופה</TableHead>
                      <TableHead>תאריך העלאה</TableHead>
                      <TableHead>סטטוס</TableHead>
                      <TableHead className="text-center">הורדה</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {files.map((file) => {
                      const config =
                        statusConfig[file.processingStatus as keyof typeof statusConfig];
                      const Icon = config?.icon ?? AlertTriangle;
                      return (
                        <TableRow key={file.id} className="text-sm">
                          <TableCell
                            className="max-w-[320px] truncate font-medium"
                            title={file.originalFileName}
                          >
                            {file.originalFileName}
                          </TableCell>
                          <TableCell>
                            {formatPeriod(file.periodStartDate, file.periodEndDate)}
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {format(new Date(file.createdAt), "dd/MM/yyyy HH:mm", {
                              locale: he,
                            })}
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant={config?.variant ?? "outline"}
                              className={cn(
                                "text-xs gap-1",
                                config && "className" in config ? config.className : undefined
                              )}
                            >
                              <Icon className="h-3 w-3" />
                              {config?.label ?? file.processingStatus}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-center">
                            {file.fileUrl ? (
                              <Button variant="ghost" size="sm" className="h-8 w-8 p-0" asChild>
                                <a
                                  href={`/api/reports/supplier-files/${file.id}/download`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  title="הורד קובץ"
                                >
                                  <Download className="h-4 w-4" />
                                </a>
                              </Button>
                            ) : (
                              <span
                                className="inline-flex h-8 w-8 items-center justify-center"
                                title="קובץ לא נשמר באחסון. יש להעלות מחדש."
                              >
                                <CloudOff className="h-4 w-4 text-amber-500" />
                              </span>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>

              {total > PAGE_SIZE && (
                <div className="flex items-center justify-between pt-4 text-sm text-muted-foreground">
                  <span>
                    {offset + 1}–{Math.min(offset + PAGE_SIZE, total)} מתוך {total}
                  </span>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={offset === 0 || isFetching}
                      onClick={() => setOffset(offset - PAGE_SIZE)}
                    >
                      הקודם
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={offset + PAGE_SIZE >= total || isFetching}
                      onClick={() => setOffset(offset + PAGE_SIZE)}
                    >
                      הבא
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
