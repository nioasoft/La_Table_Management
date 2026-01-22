"use client";

import { useState } from "react";
import { useSupplierUploadHistory } from "@/queries/supplier-file-uploads";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
  ChevronDown,
  Calendar,
  Check,
  Ban,
} from "lucide-react";
import { format } from "date-fns";
import { he as dateFnsHe } from "date-fns/locale";
import Link from "next/link";
import { he } from "@/lib/translations/he";

interface SupplierFilesTabProps {
  supplierId: string;
  supplierName: string;
}

interface FranchiseeMatch {
  originalName: string;
  rowNumber: number;
  grossAmount: number;
  netAmount: number;
  matchedFranchiseeId: string | null;
  matchedFranchiseeName: string | null;
  matchedFranchiseeCode?: string | null;
  confidence: number;
  matchType: string;
  requiresReview: boolean;
}

interface ProcessingResult {
  totalRows: number;
  processedRows: number;
  skippedRows: number;
  totalGrossAmount: number;
  totalNetAmount: number;
  vatAdjusted: boolean;
  matchStats: {
    total: number;
    exactMatches: number;
    fuzzyMatches: number;
    unmatched: number;
  };
  processedAt: string;
  franchiseeMatches: FranchiseeMatch[];
}

interface SupplierFile {
  id: string;
  originalFileName: string;
  processingStatus: string;
  processingResult: ProcessingResult | null;
  periodStartDate: string | null;
  periodEndDate: string | null;
  createdAt: Date | string;
  reviewedAt: Date | string | null;
  reviewNotes: string | null;
}

const t = he.admin.suppliers.detail.processedFiles;

const statusConfig = {
  auto_approved: {
    label: t.statuses.auto_approved,
    icon: CheckCircle2,
    variant: "success" as const,
  },
  approved: {
    label: t.statuses.approved,
    icon: CheckCircle2,
    variant: "success" as const,
  },
  needs_review: {
    label: t.statuses.needs_review,
    icon: AlertTriangle,
    variant: "outline" as const,
    className: "bg-yellow-50 text-yellow-700 border-yellow-300",
  },
  rejected: {
    label: t.statuses.rejected,
    icon: XCircle,
    variant: "destructive" as const,
  },
  pending: {
    label: t.statuses.pending,
    icon: Clock,
    variant: "secondary" as const,
  },
};

function formatAmount(amount: number) {
  return new Intl.NumberFormat("he-IL", {
    style: "currency",
    currency: "ILS",
  }).format(amount);
}

function getMatchTypeBadge(match: FranchiseeMatch) {
  if (match.matchType === "blacklisted") {
    return (
      <Badge variant="secondary" className="gap-1 bg-gray-200 text-xs">
        <Ban className="h-3 w-3" />
        לא רלוונטי
      </Badge>
    );
  }
  if (!match.matchedFranchiseeId) {
    return <Badge variant="destructive" className="text-xs">לא מותאם</Badge>;
  }
  if (match.matchType === "manual") {
    return (
      <Badge variant="success" className="gap-1 text-xs">
        <Check className="h-3 w-3" />
        ידני
      </Badge>
    );
  }
  if (match.matchType === "exact" || match.confidence === 1) {
    return <Badge variant="success" className="text-xs">מדויק</Badge>;
  }
  return <Badge variant="warning" className="text-xs">{Math.round(match.confidence * 100)}%</Badge>;
}

export function SupplierFilesTab({ supplierId, supplierName }: SupplierFilesTabProps) {
  const [expandedFileId, setExpandedFileId] = useState<string | null>(null);

  const { data, isLoading, error } = useSupplierUploadHistory(supplierId, {
    limit: 50,
  });

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5" />
            {t.title}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5" />
            {t.title}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-destructive">
            {t.loadError}
          </p>
        </CardContent>
      </Card>
    );
  }

  const files = (data?.files || []) as SupplierFile[];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileSpreadsheet className="h-5 w-5" />
          {t.title}
        </CardTitle>
        <CardDescription>
          {t.description}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {files.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <FileSpreadsheet className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p>{t.noFiles}</p>
          </div>
        ) : (
          <div className="space-y-2">
            {files.map((file) => {
              const config = statusConfig[file.processingStatus as keyof typeof statusConfig];
              const Icon = config?.icon || AlertTriangle;
              const isExpanded = expandedFileId === file.id;
              const result = file.processingResult;

              return (
                <Collapsible
                  key={file.id}
                  open={isExpanded}
                  onOpenChange={(open) => setExpandedFileId(open ? file.id : null)}
                >
                  <div className="rounded-lg border bg-card">
                    {/* File Header */}
                    <div className="p-4">
                      <div className="flex items-start justify-between">
                        <div className="space-y-2 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <FileSpreadsheet className="h-4 w-4 text-muted-foreground shrink-0" />
                            <span className="font-medium truncate max-w-[300px]" title={file.originalFileName}>
                              {file.originalFileName}
                            </span>
                            {config && (
                              <Badge
                                variant={config.variant}
                                className={cn(
                                  "gap-1",
                                  "className" in config ? config.className : undefined
                                )}
                              >
                                <Icon className="h-3 w-3" />
                                {config.label}
                              </Badge>
                            )}
                          </div>

                          {/* File Meta Info */}
                          <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
                            <span className="flex items-center gap-1">
                              <Clock className="h-3.5 w-3.5" />
                              {format(new Date(file.createdAt), "dd/MM/yyyy HH:mm", { locale: dateFnsHe })}
                            </span>
                            {file.periodStartDate && file.periodEndDate && (
                              <span className="flex items-center gap-1">
                                <Calendar className="h-3.5 w-3.5" />
                                {new Date(file.periodStartDate).toLocaleDateString("he-IL")} - {new Date(file.periodEndDate).toLocaleDateString("he-IL")}
                              </span>
                            )}
                          </div>

                          {/* Match Stats */}
                          {result?.matchStats && (
                            <div className="flex flex-wrap gap-2 mt-2">
                              <Badge variant="outline" className="text-xs">
                                {result.matchStats.total} {t.stats.totalFranchisees}
                              </Badge>
                              <Badge variant="success" className="text-xs bg-green-50 text-green-700 border-green-300">
                                {result.matchStats.exactMatches} {t.stats.exactMatches}
                              </Badge>
                              {result.matchStats.fuzzyMatches > 0 && (
                                <Badge variant="warning" className="text-xs bg-amber-50 text-amber-700 border-amber-300">
                                  {result.matchStats.fuzzyMatches} {t.stats.fuzzyMatches}
                                </Badge>
                              )}
                              {result.matchStats.unmatched > 0 && (
                                <Badge variant="destructive" className="text-xs bg-red-50 text-red-700 border-red-300">
                                  {result.matchStats.unmatched} {t.stats.unmatched}
                                </Badge>
                              )}
                            </div>
                          )}
                        </div>

                        {/* Actions */}
                        <div className="flex items-center gap-2 shrink-0">
                          {file.processingStatus === "needs_review" && (
                            <Link href={`/admin/supplier-files/review/${file.id}`}>
                              <Button variant="outline" size="sm">
                                <Eye className="h-4 w-4 me-1" />
                                {t.actions.review}
                              </Button>
                            </Link>
                          )}
                          {(file.processingStatus === "approved" || file.processingStatus === "auto_approved") && (
                            <Link href={`/admin/supplier-files/review/${file.id}`}>
                              <Button variant="ghost" size="sm">
                                <Eye className="h-4 w-4 me-1" />
                                {t.actions.view}
                              </Button>
                            </Link>
                          )}
                          {result?.franchiseeMatches && result.franchiseeMatches.length > 0 && (
                            <CollapsibleTrigger asChild>
                              <Button variant="ghost" size="sm">
                                <ChevronDown className={cn(
                                  "h-4 w-4 transition-transform",
                                  isExpanded && "rotate-180"
                                )} />
                              </Button>
                            </CollapsibleTrigger>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Expanded Content - Franchisee Matches Table */}
                    <CollapsibleContent>
                      {result?.franchiseeMatches && result.franchiseeMatches.length > 0 && (
                        <div className="border-t px-4 pb-4">
                          {/* Totals Summary */}
                          <div className="flex flex-wrap gap-4 py-3 text-sm border-b mb-3">
                            <div>
                              <span className="text-muted-foreground me-1">
                                {t.summary.totalGross}
                              </span>
                              <span className="font-medium">{formatAmount(result.totalGrossAmount)}</span>
                            </div>
                            <div>
                              <span className="text-muted-foreground me-1">
                                {t.summary.totalNet}
                              </span>
                              <span className="font-medium">{formatAmount(result.totalNetAmount)}</span>
                            </div>
                            <div>
                              <span className="text-muted-foreground me-1">
                                {t.summary.rowsProcessed}
                              </span>
                              <span className="font-medium">{result.processedRows} / {result.totalRows}</span>
                            </div>
                          </div>

                          {/* Matches Table */}
                          <div className="rounded-md border max-h-[400px] overflow-auto">
                            <Table>
                              <TableHeader>
                                <TableRow>
                                  <TableHead className="w-[40px] text-end">#</TableHead>
                                  <TableHead className="text-end">
                                    {t.table.originalName}
                                  </TableHead>
                                  <TableHead className="text-end">
                                    {t.table.matchedFranchisee}
                                  </TableHead>
                                  <TableHead className="text-end">
                                    {t.table.grossAmount}
                                  </TableHead>
                                  <TableHead className="text-end">
                                    {t.table.netAmount}
                                  </TableHead>
                                  <TableHead className="text-end">
                                    {t.table.matchStatus}
                                  </TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {result.franchiseeMatches.map((match, idx) => (
                                  <TableRow
                                    key={idx}
                                    className={cn(
                                      match.matchType === "blacklisted"
                                        ? "bg-gray-50/50"
                                        : !match.matchedFranchiseeId
                                        ? "bg-red-50/50"
                                        : match.confidence < 1 && match.matchType !== "manual" && match.matchType !== "exact"
                                        ? "bg-amber-50/50"
                                        : ""
                                    )}
                                  >
                                    <TableCell className="font-mono text-muted-foreground text-xs">
                                      {match.rowNumber}
                                    </TableCell>
                                    <TableCell className="font-medium text-sm">
                                      {match.originalName}
                                    </TableCell>
                                    <TableCell className="text-sm">
                                      {match.matchedFranchiseeId ? (
                                        <div>
                                          <p className="font-medium">{match.matchedFranchiseeName}</p>
                                          {match.matchedFranchiseeCode && (
                                            <p className="text-xs text-muted-foreground">{match.matchedFranchiseeCode}</p>
                                          )}
                                        </div>
                                      ) : (
                                        <span className="text-muted-foreground">
                                          {match.matchType === "blacklisted" ? "לא רלוונטי" : "לא מותאם"}
                                        </span>
                                      )}
                                    </TableCell>
                                    <TableCell className="font-mono text-sm">
                                      {formatAmount(match.grossAmount)}
                                    </TableCell>
                                    <TableCell className="font-mono text-sm">
                                      {formatAmount(match.netAmount)}
                                    </TableCell>
                                    <TableCell>
                                      {getMatchTypeBadge(match)}
                                    </TableCell>
                                  </TableRow>
                                ))}
                              </TableBody>
                            </Table>
                          </div>
                        </div>
                      )}
                    </CollapsibleContent>
                  </div>
                </Collapsible>
              );
            })}
          </div>
        )}

        {/* Link to full supplier files page */}
        {files.length > 0 && (
          <div className="text-center mt-4 pt-4 border-t">
            <Link
              href={`/admin/supplier-files?supplierId=${supplierId}`}
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              {t.viewAll} ({data?.total || 0})
            </Link>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
