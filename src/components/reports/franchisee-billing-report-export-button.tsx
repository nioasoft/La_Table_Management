"use client";

import { Download, Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { fetchWithTimeout } from "@/lib/fetch-with-timeout";
import { buildFranchiseeBillingReportUrl } from "@/lib/franchisee-billing-report-request";
import { downloadBlob } from "@/lib/report-utils";
import type { FranchiseeBillingReportType } from "@/schemas/franchisee-billing-reports";

interface FranchiseeBillingReportExportButtonProps {
  readonly reportType: FranchiseeBillingReportType;
  readonly year: number;
  readonly month: number;
  readonly brandId: string | null;
  readonly disabled: boolean;
}

function responseError(body: unknown): string {
  if (
    typeof body === "object" &&
    body !== null &&
    "error" in body &&
    typeof body.error === "string"
  ) {
    return body.error;
  }
  return "ייצוא הדוח נכשל. נסי שוב";
}

function exportFilename(
  reportType: FranchiseeBillingReportType,
  year: number,
  month: number,
): string {
  return `franchisee-billing-${reportType}-${year}-${String(month).padStart(2, "0")}.xlsx`;
}

export function FranchiseeBillingReportExportButton({
  reportType,
  year,
  month,
  brandId,
  disabled,
}: FranchiseeBillingReportExportButtonProps) {
  const [isExporting, setIsExporting] = useState(false);

  const handleExport = async (): Promise<void> => {
    setIsExporting(true);
    try {
      const response = await fetchWithTimeout(
        buildFranchiseeBillingReportUrl(
          { reportType, year, month, brandId },
          "export",
        ),
      );
      if (!response.ok) {
        const body: unknown = await response.json().catch(() => null);
        throw new Error(responseError(body));
      }
      downloadBlob(
        await response.blob(),
        exportFilename(reportType, year, month),
      );
      toast.success("קובץ האקסל הורד בהצלחה");
    } catch (error: unknown) {
      console.error("Franchisee billing report export failed", error);
      toast.error(
        error instanceof Error ? error.message : "ייצוא הדוח נכשל. נסי שוב",
      );
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <Button
      type="button"
      onClick={handleExport}
      disabled={disabled || isExporting}
      className="bg-emerald-600 hover:bg-emerald-700"
    >
      {isExporting ? (
        <Loader2 className="me-2 h-4 w-4 animate-spin" />
      ) : (
        <Download className="me-2 h-4 w-4" />
      )}
      {isExporting ? "מייצא…" : "ייצוא לאקסל"}
    </Button>
  );
}
