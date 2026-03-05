import type {
  BkmvTransaction,
  BkmvParseResult,
  SupplierPurchaseSummary,
  AccountSortLabel,
} from './types';
import { decodeBuffer } from './encoding';

/**
 * Filter transactions by date range
 */
export function filterTransactionsByPeriod(
  transactions: BkmvTransaction[],
  startDate: Date,
  endDate: Date
): BkmvTransaction[] {
  return transactions.filter(tx => {
    const txDate = tx.documentDate;
    return txDate >= startDate && txDate <= endDate;
  });
}

/**
 * Get all unique supplier names from parsed data
 */
export function getUniqueSupplierNames(parseResult: BkmvParseResult): string[] {
  return Array.from(parseResult.supplierSummary.keys()).sort();
}

/**
 * Check if a file is a BKMVDATA file by examining its content
 */
export function isBkmvDataFile(content: string | Buffer): boolean {
  try {
    const textContent = Buffer.isBuffer(content) ? decodeBuffer(content) : content;

    if (!textContent || textContent.length < 10) {
      return false;
    }

    const firstLine = textContent.split(/\r?\n/)[0];
    if (!firstLine) {
      return false;
    }

    return firstLine.startsWith('A10');
  } catch {
    return false;
  }
}

/**
 * Extract date range from BKMVDATA transactions
 */
export function extractDateRange(parseResult: BkmvParseResult): { startDate: Date; endDate: Date } | null {
  if (parseResult.transactions.length === 0) {
    return null;
  }

  let minDate = new Date(8640000000000000);
  let maxDate = new Date(-8640000000000000);

  for (const tx of parseResult.transactions) {
    if (tx.documentDate && tx.documentDate.getTime() > 0) {
      if (tx.documentDate < minDate) minDate = tx.documentDate;
      if (tx.documentDate > maxDate) maxDate = tx.documentDate;
    }
  }

  if (minDate.getTime() === 8640000000000000 || maxDate.getTime() === -8640000000000000) {
    return null;
  }

  return { startDate: minDate, endDate: maxDate };
}

/**
 * Get unique reference codes from supplier summary
 */
export function getUniqueReferences(supplierSummary: Map<string, SupplierPurchaseSummary>): string[] {
  const references = new Set<string>();

  for (const summary of supplierSummary.values()) {
    for (const tx of summary.transactions) {
      if (tx.reference) {
        references.add(tx.reference);
        break;
      }
    }
  }

  return Array.from(references).sort();
}

/**
 * Filter supplier summaries by reference code
 */
export function filterSuppliersByReference(
  supplierSummary: Map<string, SupplierPurchaseSummary>,
  reference: string
): Map<string, SupplierPurchaseSummary> {
  if (reference === 'all') {
    return supplierSummary;
  }

  const filtered = new Map<string, SupplierPurchaseSummary>();

  for (const [key, summary] of supplierSummary.entries()) {
    const summaryReference = summary.transactions[0]?.reference;
    if (summaryReference === reference) {
      filtered.set(key, summary);
    }
  }

  return filtered;
}

/**
 * Filter supplier summaries by account sort
 */
export function filterSuppliersByAccountSort(
  supplierSummary: Map<string, SupplierPurchaseSummary>,
  accountSort: string
): Map<string, SupplierPurchaseSummary> {
  if (accountSort === 'all') {
    return supplierSummary;
  }

  const filtered = new Map<string, SupplierPurchaseSummary>();

  for (const [key, summary] of supplierSummary.entries()) {
    const hasMatchingSort = summary.transactions.some(tx => tx.accountSort === accountSort);
    if (hasMatchingSort) {
      filtered.set(key, summary);
    }
  }

  return filtered;
}

/**
 * Get unique account sorts from supplier summary
 */
export function getUniqueAccountSorts(supplierSummary: Map<string, SupplierPurchaseSummary>): string[] {
  const sorts = new Set<string>();

  for (const summary of supplierSummary.values()) {
    for (const tx of summary.transactions) {
      if (tx.accountSort) {
        sorts.add(tx.accountSort);
      }
    }
  }

  return Array.from(sorts).sort();
}

/**
 * Get account sort codes with their labels and transaction counts
 */
export function getAccountSortLabels(parseResult: BkmvParseResult): AccountSortLabel[] {
  const sortToType = new Map<string, string>();
  for (const account of parseResult.accounts) {
    if (account.accountSort && account.accountType) {
      if (!sortToType.has(account.accountSort)) {
        sortToType.set(account.accountSort, account.accountType);
      }
    }
  }

  const sortCounts = new Map<string, number>();
  for (const summary of parseResult.supplierSummary.values()) {
    for (const tx of summary.transactions) {
      if (tx.accountSort) {
        sortCounts.set(tx.accountSort, (sortCounts.get(tx.accountSort) || 0) + 1);
      }
    }
  }

  const sorts = getUniqueAccountSorts(parseResult.supplierSummary);

  return sorts.map(sort => ({
    sort,
    label: sortToType.get(sort) || sort,
    count: sortCounts.get(sort) || 0,
  }));
}

/**
 * Find the account sort code for a given account type label
 */
export function findAccountSortByType(parseResult: BkmvParseResult, accountType: string): string | undefined {
  const labels = getAccountSortLabels(parseResult);
  const match = labels.find(l => l.label === accountType);
  return match?.sort;
}

/**
 * Get supplier summary for a specific period
 */
export function getSupplierSummaryForPeriod(
  parseResult: BkmvParseResult,
  startDate: Date,
  endDate: Date
): Map<string, SupplierPurchaseSummary> {
  const filteredTransactions = filterTransactionsByPeriod(
    parseResult.transactions,
    startDate,
    endDate
  );

  const summary = new Map<string, SupplierPurchaseSummary>();

  for (const tx of filteredTransactions) {
    if (tx.side !== 'credit' || tx.amount === 0) continue;

    const supplierKey = tx.counterpartyName.trim();
    if (!supplierKey) continue;

    const existing = summary.get(supplierKey);
    if (existing) {
      existing.totalAmount += tx.amount;
      existing.transactionCount++;
      existing.transactions.push(tx);
    } else {
      summary.set(supplierKey, {
        supplierName: supplierKey,
        totalAmount: tx.amount,
        transactionCount: 1,
        transactions: [tx],
      });
    }
  }

  return summary;
}
