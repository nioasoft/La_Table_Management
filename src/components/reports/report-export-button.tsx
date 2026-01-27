"use client";

import { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Loader2, Download, FileSpreadsheet, FileText, ChevronDown } from "lucide-react";
import { downloadBlob, generateReportFilename } from "@/lib/report-utils";
import { toast } from "sonner";

// ============================================================================
// TYPES
// ============================================================================

export type ExportFormat = "xlsx" | "pdf";

export interface ExportEndpoints {
  /** Endpoint for Excel export */
  excel?: string;
  /** Endpoint for PDF export */
  pdf?: string;
}

export interface ReportExportButtonProps {
  /** Export API endpoints */
  endpoints: ExportEndpoints;
  /** Query string to append to endpoints */
  queryString?: string;
  /** Report type for filename */
  reportType?: string;
  /** Disabled state */
  disabled?: boolean;
  /** Show as dropdown (when multiple formats) or single button */
  variant?: "dropdown" | "single";
  /** Which format to use for single button variant */
  singleFormat?: ExportFormat;
  /** Button size */
  size?: "default" | "sm" | "lg" | "icon";
  /** Additional class name */
  className?: string;
}

// ============================================================================
// COMPONENT
// ============================================================================

export function ReportExportButton({
  endpoints,
  queryString = "",
  reportType = "report",
  disabled = false,
  variant = "dropdown",
  singleFormat = "xlsx",
  size = "default",
  className,
}: ReportExportButtonProps) {
  const [isExporting, setIsExporting] = useState<ExportFormat | null>(null);

  const handleExport = useCallback(
    async (format: ExportFormat) => {
      const endpoint = format === "xlsx" ? endpoints.excel : endpoints.pdf;
      if (!endpoint) return;

      setIsExporting(format);
      try {
        const url = queryString ? `${endpoint}?${queryString}` : endpoint;
        const response = await fetch(url);

        if (!response.ok) {
          throw new Error(`Export failed: ${response.statusText}`);
        }

        const blob = await response.blob();
        const filename = generateReportFilename(reportType, format);
        downloadBlob(blob, filename);
      } catch (error) {
        console.error(`Error exporting ${format}:`, error);
        toast.error("שגיאה בייצוא הדוח. נסה שוב.");
      } finally {
        setIsExporting(null);
      }
    },
    [endpoints, queryString, reportType]
  );

  const isLoading = isExporting !== null;
  const hasExcel = !!endpoints.excel;
  const hasPdf = !!endpoints.pdf;
  const hasMultipleFormats = hasExcel && hasPdf;

  // Single button mode
  if (variant === "single" || !hasMultipleFormats) {
    const format = hasExcel ? "xlsx" : "pdf";
    const isExcel = format === "xlsx";

    return (
      <Button
        onClick={() => handleExport(format)}
        disabled={disabled || isLoading}
        className={isExcel ? "bg-emerald-600 hover:bg-emerald-700 dark:bg-emerald-500 dark:hover:bg-emerald-400" : "bg-rose-600 hover:bg-rose-700 dark:bg-rose-500 dark:hover:bg-rose-400"}
        size={size}
        aria-label={isExcel ? "ייצוא לאקסל" : "ייצוא ל-PDF"}
      >
        {isExporting === format ? (
          <Loader2 className="h-4 w-4 me-2 animate-spin" />
        ) : isExcel ? (
          <FileSpreadsheet className="h-4 w-4 me-2" />
        ) : (
          <FileText className="h-4 w-4 me-2" />
        )}
        {isExcel ? "ייצוא לאקסל" : "ייצוא ל-PDF"}
      </Button>
    );
  }

  // Dropdown mode
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          disabled={disabled || isLoading}
          className="bg-emerald-600 hover:bg-emerald-700 dark:bg-emerald-500 dark:hover:bg-emerald-400"
          size={size}
          aria-label="ייצוא דוח"
        >
          {isLoading ? (
            <Loader2 className="h-4 w-4 me-2 animate-spin" />
          ) : (
            <Download className="h-4 w-4 me-2" />
          )}
          ייצוא
          <ChevronDown className="h-4 w-4 ms-2" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {hasExcel && (
          <DropdownMenuItem
            onClick={() => handleExport("xlsx")}
            disabled={isExporting === "xlsx"}
          >
            <FileSpreadsheet className="h-4 w-4 me-2" />
            ייצוא לאקסל
            {isExporting === "xlsx" && (
              <Loader2 className="h-4 w-4 ms-2 animate-spin" />
            )}
          </DropdownMenuItem>
        )}
        {hasPdf && (
          <DropdownMenuItem
            onClick={() => handleExport("pdf")}
            disabled={isExporting === "pdf"}
          >
            <FileText className="h-4 w-4 me-2" />
            ייצוא ל-PDF
            {isExporting === "pdf" && (
              <Loader2 className="h-4 w-4 ms-2 animate-spin" />
            )}
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ============================================================================
// CONVENIENCE COMPONENTS
// ============================================================================

export interface ExcelExportButtonProps {
  /** Export API endpoint */
  endpoint: string;
  /** Query string to append */
  queryString?: string;
  /** Report type for filename */
  reportType?: string;
  /** Disabled state */
  disabled?: boolean;
  /** Button size */
  size?: "default" | "sm" | "lg" | "icon";
  /** Additional class name */
  className?: string;
}

export function ExcelExportButton({
  endpoint,
  queryString,
  reportType,
  disabled,
  size,
  className,
}: ExcelExportButtonProps) {
  return (
    <ReportExportButton
      endpoints={{ excel: endpoint }}
      queryString={queryString}
      reportType={reportType}
      disabled={disabled}
      variant="single"
      singleFormat="xlsx"
      size={size}
      className={className}
    />
  );
}

export interface PdfExportButtonProps {
  /** Export API endpoint */
  endpoint: string;
  /** Query string to append */
  queryString?: string;
  /** Report type for filename */
  reportType?: string;
  /** Disabled state */
  disabled?: boolean;
  /** Button size */
  size?: "default" | "sm" | "lg" | "icon";
  /** Additional class name */
  className?: string;
}

export function PdfExportButton({
  endpoint,
  queryString,
  reportType,
  disabled,
  size,
  className,
}: PdfExportButtonProps) {
  return (
    <ReportExportButton
      endpoints={{ pdf: endpoint }}
      queryString={queryString}
      reportType={reportType}
      disabled={disabled}
      variant="single"
      singleFormat="pdf"
      size={size}
      className={className}
    />
  );
}
