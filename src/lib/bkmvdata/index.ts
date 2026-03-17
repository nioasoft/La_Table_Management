/**
 * BKMVDATA Parser - barrel re-export
 *
 * All public API is re-exported from this file.
 * External code imports from '@/lib/bkmvdata-parser' which re-exports from here.
 */

// Types
export type {
  BkmvTransaction,
  BkmvAccount,
  SupplierPurchaseSummary,
  RevenueAccountSummary,
  AllAccountSummary,
  BkmvParseResult,
  AccountSortLabel,
  MonthlyBreakdownEntry,
  MonthlyBreakdown,
  AccountCategory,
  CategoryTab,
  ClassifiedAccount,
  BkmvSoftwareType,
} from './types';

// Constants
export {
  CATEGORY_LABELS,
  CATEGORY_ORDER,
  CATEGORY_TAB_ORDER,
  CATEGORY_TAB_LABELS,
} from './constants';

// Router (main entry point)
export { parseBkmvData } from './router';

// Encoding
export { decodeBuffer } from './encoding';

// Filters
export {
  filterTransactionsByPeriod,
  getUniqueSupplierNames,
  isBkmvDataFile,
  extractDateRange,
  getUniqueReferences,
  filterSuppliersByReference,
  filterSuppliersByAccountSort,
  getUniqueAccountSorts,
  getAccountSortLabels,
  findAccountSortByType,
  getSupplierSummaryForPeriod,
} from './filters';

// Summaries
export {
  buildAllAccountsSummary,
  convertRevenueSummaryToArray,
  convertAllAccountsSummaryToArray,
  buildRevenueMonthlyBreakdown,
  mergeRevenueSummaryIntoAllAccounts,
} from './summaries';

// Classification
export {
  autoClassifyAccount,
  classifyAccounts,
  filterSuppliersByClassification,
  getCategoryCounts,
  mergeRevenueSummaryIntoClassified,
} from './classification';

// Monthly breakdown
export {
  buildMonthlyBreakdown,
  getAmountForPeriod,
  mergeMonthlyBreakdown,
  groupMonthlyBreakdownByYear,
  aggregateSupplierMatchesFromBreakdown,
} from './monthly-breakdown';

// Formatters
export { formatAmount } from './formatters';

// Classifier (for advanced use)
export { classifyBkmvFile } from './classifier';
