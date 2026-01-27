/**
 * Report Components - Shared components for the reports system
 */

// Data Table
export { ReportDataTable, type ColumnDef, type ReportDataTableProps } from "./report-data-table";

// Filters
export { ReportFilters, type ReportFiltersProps, type StatusOption } from "./report-filters";

// Period Selector
export { ReportPeriodSelector, type ReportPeriodSelectorProps } from "./report-period-selector";

// Summary Cards
export {
  ReportSummaryCards,
  type SummaryCardData,
  type ReportSummaryCardsProps,
  createCurrencyCard,
  createNumberCard,
  createPercentCard,
} from "./report-summary-cards";

// Export Buttons
export {
  ReportExportButton,
  ExcelExportButton,
  PdfExportButton,
  type ExportFormat,
  type ExportEndpoints,
  type ReportExportButtonProps,
} from "./report-export-button";

// Layout
export {
  ReportLayout,
  ReportSection,
  ReportLoadingOverlay,
  ReportEmptyState,
  type ReportLayoutProps,
  type ReportSectionProps,
  type ReportLoadingOverlayProps,
  type ReportEmptyStateProps,
  type BreadcrumbItem,
} from "./report-layout";

// PDF Reports
export { CommissionReportPDF, type CommissionReportData } from "./CommissionReportPDF";
export { InvoiceReportPDF, type InvoiceData, type BrandGroup } from "./InvoiceReportPDF";
