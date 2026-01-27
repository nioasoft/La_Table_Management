/**
 * Report utilities - formatters, status badges, and shared functions
 */

import { formatCurrency } from "@/lib/translations";
import { formatDateAsLocal } from "@/lib/date-utils";

// ============================================================================
// FORMATTERS
// ============================================================================

/**
 * Format a number as percentage
 */
export function formatPercent(rate: number | undefined | null): string {
  if (rate == null) return "0.00%";
  return `${rate.toFixed(2)}%`;
}

/**
 * Format date for Hebrew display
 */
export function formatDateHe(dateStr: string | null | undefined): string {
  if (!dateStr) return "-";
  return new Date(dateStr).toLocaleDateString("he-IL");
}

/**
 * Format date range for display
 */
export function formatDateRange(startDate: string, endDate: string): string {
  return `${formatDateHe(startDate)} - ${formatDateHe(endDate)}`;
}

/**
 * Format number with thousands separator
 */
export function formatNumber(num: number | string | null | undefined): string {
  if (num == null) return "0";
  const n = typeof num === "string" ? parseFloat(num) : num;
  return n.toLocaleString("he-IL");
}

// ============================================================================
// STATUS CONFIGURATIONS
// ============================================================================

export type BadgeVariant = "default" | "secondary" | "destructive" | "outline" | "success";

export interface StatusConfig {
  label: string;
  variant: BadgeVariant;
}

// Commission statuses
export const commissionStatusConfig: Record<string, StatusConfig> = {
  pending: { label: "ממתין", variant: "secondary" },
  calculated: { label: "חושב", variant: "outline" },
  approved: { label: "מאושר", variant: "success" },
  paid: { label: "שולם", variant: "default" },
  cancelled: { label: "בוטל", variant: "destructive" },
};

// Settlement statuses
export const settlementStatusConfig: Record<string, StatusConfig> = {
  draft: { label: "טיוטה", variant: "outline" },
  open: { label: "פתוח", variant: "secondary" },
  processing: { label: "בעיבוד", variant: "outline" },
  pending_approval: { label: "ממתין לאישור", variant: "secondary" },
  approved: { label: "מאושר", variant: "success" },
  completed: { label: "הושלם", variant: "success" },
  invoiced: { label: "הופק חשבון", variant: "default" },
};

// Franchisee statuses
export const franchiseeStatusConfig: Record<string, StatusConfig> = {
  active: { label: "פעיל", variant: "success" },
  inactive: { label: "לא פעיל", variant: "secondary" },
  pending: { label: "ממתין", variant: "outline" },
  suspended: { label: "מושעה", variant: "destructive" },
  terminated: { label: "סיום חוזה", variant: "destructive" },
};

// Generic active/inactive status
export const activeStatusConfig: Record<string, StatusConfig> = {
  active: { label: "פעיל", variant: "success" },
  inactive: { label: "לא פעיל", variant: "secondary" },
};

/**
 * Get status configuration based on type
 */
export function getStatusConfig(
  status: string,
  type: "commission" | "settlement" | "franchisee" | "active"
): StatusConfig {
  let config: Record<string, StatusConfig>;

  switch (type) {
    case "commission":
      config = commissionStatusConfig;
      break;
    case "settlement":
      config = settlementStatusConfig;
      break;
    case "franchisee":
      config = franchiseeStatusConfig;
      break;
    case "active":
      config = activeStatusConfig;
      break;
    default:
      config = commissionStatusConfig;
  }

  return config[status] || { label: status, variant: "outline" as BadgeVariant };
}

// ============================================================================
// STATUS OPTIONS FOR FILTERS
// ============================================================================

export const commissionStatusOptions = [
  { value: "pending", label: "ממתין" },
  { value: "calculated", label: "חושב" },
  { value: "approved", label: "מאושר" },
  { value: "paid", label: "שולם" },
  { value: "cancelled", label: "בוטל" },
];

export const settlementStatusOptions = [
  { value: "draft", label: "טיוטה" },
  { value: "open", label: "פתוח" },
  { value: "processing", label: "בעיבוד" },
  { value: "pending_approval", label: "ממתין לאישור" },
  { value: "approved", label: "מאושר" },
  { value: "completed", label: "הושלם" },
  { value: "invoiced", label: "הופק חשבון" },
];

export const franchiseeStatusOptions = [
  { value: "active", label: "פעיל" },
  { value: "inactive", label: "לא פעיל" },
  { value: "pending", label: "ממתין" },
  { value: "suspended", label: "מושעה" },
  { value: "terminated", label: "סיום חוזה" },
];

export const activeStatusOptions = [
  { value: "active", label: "פעיל" },
  { value: "inactive", label: "לא פעיל" },
];

// ============================================================================
// SORTING UTILITIES
// ============================================================================

export type SortDirection = "asc" | "desc" | null;

export interface SortConfig {
  column: string;
  direction: SortDirection;
}

/**
 * Compare function for sorting
 */
export function sortCompare<T>(
  a: T,
  b: T,
  column: keyof T,
  direction: SortDirection
): number {
  if (direction === null) return 0;

  const aVal = a[column];
  const bVal = b[column];

  // Handle null/undefined
  if (aVal == null && bVal == null) return 0;
  if (aVal == null) return direction === "asc" ? 1 : -1;
  if (bVal == null) return direction === "asc" ? -1 : 1;

  // Handle numbers
  if (typeof aVal === "number" && typeof bVal === "number") {
    return direction === "asc" ? aVal - bVal : bVal - aVal;
  }

  // Handle strings (including numeric strings)
  const aStr = String(aVal);
  const bStr = String(bVal);

  // Try to parse as numbers
  const aNum = parseFloat(aStr);
  const bNum = parseFloat(bStr);

  if (!isNaN(aNum) && !isNaN(bNum)) {
    return direction === "asc" ? aNum - bNum : bNum - aNum;
  }

  // String comparison for Hebrew
  const comparison = aStr.localeCompare(bStr, "he");
  return direction === "asc" ? comparison : -comparison;
}

/**
 * Sort data array by column
 */
export function sortData<T>(
  data: T[],
  sortConfig: SortConfig | null
): T[] {
  if (!sortConfig || !sortConfig.direction) return data;

  return [...data].sort((a, b) =>
    sortCompare(a, b, sortConfig.column as keyof T, sortConfig.direction)
  );
}

// ============================================================================
// PAGINATION UTILITIES
// ============================================================================

export interface PaginationConfig {
  page: number;
  pageSize: number;
  total: number;
}

/**
 * Calculate pagination values
 */
export function calculatePagination(config: PaginationConfig) {
  const { page, pageSize, total } = config;
  const totalPages = Math.ceil(total / pageSize);
  const startIndex = (page - 1) * pageSize;
  const endIndex = Math.min(startIndex + pageSize, total);

  return {
    totalPages,
    startIndex,
    endIndex,
    hasNextPage: page < totalPages,
    hasPrevPage: page > 1,
    showingFrom: total > 0 ? startIndex + 1 : 0,
    showingTo: endIndex,
  };
}

/**
 * Paginate data array
 */
export function paginateData<T>(
  data: T[],
  page: number,
  pageSize: number
): T[] {
  const startIndex = (page - 1) * pageSize;
  return data.slice(startIndex, startIndex + pageSize);
}

// ============================================================================
// SEARCH/FILTER UTILITIES
// ============================================================================

/**
 * Filter data by search term across specified columns
 */
export function filterBySearch<T>(
  data: T[],
  searchTerm: string,
  columns: (keyof T)[]
): T[] {
  if (!searchTerm.trim()) return data;

  const term = searchTerm.toLowerCase().trim();

  return data.filter((item) =>
    columns.some((col) => {
      const value = item[col];
      if (value == null) return false;
      return String(value).toLowerCase().includes(term);
    })
  );
}

// ============================================================================
// EXPORT UTILITIES
// ============================================================================

/**
 * Download a blob as file
 */
export function downloadBlob(blob: Blob, filename: string) {
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  window.URL.revokeObjectURL(url);
  document.body.removeChild(a);
}

/**
 * Generate report filename with date
 */
export function generateReportFilename(
  reportType: string,
  extension: "xlsx" | "pdf" = "xlsx"
): string {
  const date = formatDateAsLocal(new Date());
  return `${reportType}_report_${date}.${extension}`;
}

// Re-export formatCurrency from translations
export { formatCurrency };
