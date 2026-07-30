import {
  franchiseeBillingReportTypeSchema,
  type FranchiseeBillingReportQuery,
  type FranchiseeBillingReportType,
} from "@/schemas/franchisee-billing-reports";

type ReportEndpoint = "data" | "export";

export function resolveFranchiseeBillingReportTab(
  value: string,
): FranchiseeBillingReportType | null {
  const result = franchiseeBillingReportTypeSchema.safeParse(value);
  return result.success ? result.data : null;
}

export function buildFranchiseeBillingReportUrl(
  query: FranchiseeBillingReportQuery,
  endpoint: ReportEndpoint = "data",
): string {
  const params = new URLSearchParams({
    reportType: query.reportType,
    year: String(query.year),
    month: String(query.month),
  });
  const suffix = endpoint === "export" ? "/export" : "";
  return `/api/reports/franchisee-billing${suffix}?${params.toString()}`;
}
