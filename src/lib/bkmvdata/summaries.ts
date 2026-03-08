import type {
  BkmvParseResult,
  BkmvTransaction,
  SupplierPurchaseSummary,
  RevenueAccountSummary,
  AllAccountSummary,
} from './types';
import { SUPPLIER_SKIP_PATTERNS } from './constants';
import { formatYearMonth } from './formatters';
import { filterTransactionsByPeriod } from './filters';

/**
 * Get unique months from transactions, filtered to the dominant year.
 * Prevents outlier months (e.g. 2005-05, 2023-03) from corrupting even-distribution.
 */
function getDominantYearMonths(transactions: BkmvTransaction[]): Set<string> {
  const allMonths = new Set<string>();
  for (const tx of transactions) {
    allMonths.add(formatYearMonth(tx.documentDate));
  }
  const yearCounts = new Map<number, number>();
  for (const m of allMonths) {
    const y = parseInt(m.slice(0, 4));
    yearCounts.set(y, (yearCounts.get(y) || 0) + 1);
  }
  const dominantYear = [...yearCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  return dominantYear
    ? new Set([...allMonths].filter(m => m.startsWith(String(dominantYear))))
    : allMonths;
}

/**
 * Build supplier purchase summary from transactions
 *
 * Purchase transactions appear as CREDIT (side=2) to supplier accounts
 * We aggregate by counterparty name which contains the supplier
 */
export function buildSupplierSummary(result: BkmvParseResult): void {
  const summary = new Map<string, SupplierPurchaseSummary>();

  for (const tx of result.transactions) {
    if (tx.side !== 'credit' || tx.amount === 0) {
      continue;
    }

    const counterparty = tx.counterpartyName.toLowerCase();
    const shouldSkip = SUPPLIER_SKIP_PATTERNS.some(pattern => counterparty.includes(pattern.toLowerCase()));

    if (shouldSkip) {
      continue;
    }

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

  result.supplierSummary = summary;
}

/**
 * Build revenue summary from transactions
 */
export function buildRevenueSummary(result: BkmvParseResult): void {
  const summary = new Map<string, RevenueAccountSummary>();

  const revenueAccountCodes = new Set<string>();
  const accountCodeToInfo = new Map<string, { accountKey: string; accountName: string }>();

  // Primary: detect revenue accounts by accountType
  let detectedByName = false;
  for (const account of result.accounts) {
    if (account.accountType && (account.accountType.includes('הכנסות') || (account.accountType.includes('מכירות') && !account.accountType.includes('עלות מכירות')))) {
      const key = account.accountKey.trim();
      if (key) {
        revenueAccountCodes.add(key);
        accountCodeToInfo.set(key, {
          accountKey: key,
          accountName: account.accountName || key,
        });
      }
    }
  }

  // Fallback: if no revenue accounts found by type, detect by account name
  // (e.g. unknown-d files where accountType is "צאות" but name is "הכנסות")
  if (revenueAccountCodes.size === 0) {
    for (const account of result.accounts) {
      if (
        account.accountName &&
        account.accountName.startsWith('הכנסות') &&
        !account.accountName.includes('זקופות')
      ) {
        const key = account.accountKey.trim();
        if (key) {
          revenueAccountCodes.add(key);
          accountCodeToInfo.set(key, {
            accountKey: key,
            accountName: account.accountName || key,
          });
          detectedByName = true;
        }
      }
    }
  }

  if (revenueAccountCodes.size === 0) {
    result.revenueSummary = summary;
    return;
  }

  // Build reverse lookup: accountName → accountInfo
  // Only used when revenue was detected by name (unknown-d files use account
  // name as counterpartyName in B100 transactions instead of account code)
  const accountNameToInfo = detectedByName
    ? new Map(Array.from(accountCodeToInfo.values())
        .filter(info => info.accountName && info.accountName !== info.accountKey)
        .map(info => [info.accountName, info] as const))
    : null;

  for (const tx of result.transactions) {
    const normalizedCode = tx.accountCode.replace(/^0+/, '') || tx.accountCode;

    let accountInfo = accountCodeToInfo.get(normalizedCode);

    if (!accountInfo) {
      const counterparty = tx.counterpartyName.trim();
      if (revenueAccountCodes.has(counterparty)) {
        accountInfo = accountCodeToInfo.get(counterparty);
      }
      // Fallback: match counterpartyName against revenue account names
      if (!accountInfo && accountNameToInfo) {
        accountInfo = accountNameToInfo.get(counterparty);
      }
    }

    if (!accountInfo) {
      continue;
    }

    if (tx.amount === 0) {
      continue;
    }

    const monthKey = formatYearMonth(tx.documentDate);
    const accountKey = accountInfo.accountKey;
    const accountName = accountInfo.accountName;

    const existing = summary.get(accountKey);
    if (existing) {
      existing.totalAmount += tx.amount;
      existing.transactionCount++;
      existing.monthlyBreakdown[monthKey] = (existing.monthlyBreakdown[monthKey] || 0) + tx.amount;
    } else {
      summary.set(accountKey, {
        accountCode: accountKey,
        accountName: accountName,
        totalAmount: tx.amount,
        transactionCount: 1,
        monthlyBreakdown: { [monthKey]: tx.amount },
      });
    }
  }

  // B110 fallback — use dominant-year months to avoid outlier month corruption
  const relevantMonths = getDominantYearMonths(result.transactions);

  for (const account of result.accounts) {
    const key = account.accountKey.trim();
    if (!revenueAccountCodes.has(key)) continue;
    if (account.creditTurnover <= 0) continue;

    const existing = summary.get(key);
    const b100Sum = existing ? Math.abs(existing.totalAmount) : 0;
    const b110Credit = Math.abs(account.creditTurnover);

    if (b110Credit > b100Sum * 2) {
      // B100 by code matched < 50% of B110 — try matching by account name
      // (some software puts account name in counterpartyName instead of code)
      const accountName = account.accountName?.trim();
      if (accountName) {
        const nameBreakdown: Record<string, number> = {};
        let nameSum = 0;
        let nameCount = 0;
        for (const tx of result.transactions) {
          if (tx.amount === 0) continue;
          if (tx.counterpartyName.trim() === accountName) {
            const monthKey = formatYearMonth(tx.documentDate);
            nameBreakdown[monthKey] = (nameBreakdown[monthKey] || 0) + tx.amount;
            nameSum += tx.amount;
            nameCount++;
          }
        }

        // If name-matched sum is close to B110 (within 20%), use real monthly data
        if (nameCount > 0 && Math.abs(nameSum) >= b110Credit * 0.8) {
          if (existing) {
            existing.monthlyBreakdown = nameBreakdown;
            existing.totalAmount = nameSum;
            existing.transactionCount = nameCount;
          } else {
            const info = accountCodeToInfo.get(key);
            summary.set(key, {
              accountCode: key,
              accountName: info?.accountName || key,
              totalAmount: nameSum,
              transactionCount: nameCount,
              monthlyBreakdown: nameBreakdown,
            });
          }
          continue; // skip even distribution
        }
      }

      // Fallback: distribute B110 total evenly across dominant-year months only
      const monthCount = relevantMonths.size || 1;
      const perMonth = b110Credit / monthCount;
      const evenBreakdown: Record<string, number> = {};
      for (const month of relevantMonths) {
        evenBreakdown[month] = perMonth;
      }

      if (existing) {
        existing.monthlyBreakdown = evenBreakdown;
        existing.totalAmount = b110Credit;
        existing.b110CreditTurnover = b110Credit;
      } else {
        const info = accountCodeToInfo.get(key);
        summary.set(key, {
          accountCode: key,
          accountName: info?.accountName || key,
          totalAmount: b110Credit,
          transactionCount: 0,
          monthlyBreakdown: evenBreakdown,
          b110CreditTurnover: b110Credit,
        });
      }
    }
  }

  result.revenueSummary = summary;
}

/**
 * Build summary for ALL B110 accounts
 */
export function buildAllAccountsSummary(
  result: BkmvParseResult,
  startDate?: Date,
  endDate?: Date,
): Map<string, AllAccountSummary> {
  const summary = new Map<string, AllAccountSummary>();
  const isFiltered = startDate !== undefined && endDate !== undefined;

  const transactions = result.transactions;

  type AccountInfo = { accountKey: string; accountName: string; accountType: string; accountSort: string };
  const accountKeyToInfo = new Map<string, AccountInfo>();

  for (const account of result.accounts) {
    const key = account.accountKey.trim();
    if (!key) continue;

    accountKeyToInfo.set(key, {
      accountKey: key,
      accountName: account.accountName || key,
      accountType: account.accountType || '',
      accountSort: account.accountSort || '',
    });
  }

  function addToSummary(groupKey: string, info: AccountInfo, tx: BkmvTransaction) {
    const monthKey = formatYearMonth(tx.documentDate);
    const existing = summary.get(groupKey);
    if (existing) {
      existing.totalAmount += tx.amount;
      existing.transactionCount++;
      existing.monthlyBreakdown[monthKey] =
        (existing.monthlyBreakdown[monthKey] || 0) + tx.amount;
    } else {
      summary.set(groupKey, {
        accountCode: groupKey,
        accountName: info.accountName,
        accountType: info.accountType,
        accountSort: info.accountSort,
        totalAmount: tx.amount,
        transactionCount: 1,
        monthlyBreakdown: { [monthKey]: tx.amount },
      });
    }
  }

  for (const tx of transactions) {
    if (tx.amount === 0) continue;

    const normalizedCode = tx.accountCode.replace(/^0+/, '') || tx.accountCode;
    let info = accountKeyToInfo.get(normalizedCode);
    if (info) {
      addToSummary(info.accountKey, info, tx);
      continue;
    }

    const counterparty = tx.counterpartyName.trim();
    info = accountKeyToInfo.get(counterparty);
    if (info) {
      addToSummary(info.accountKey, info, tx);
      continue;
    }

    if (tx.resolvedAccountKey) {
      info = accountKeyToInfo.get(tx.resolvedAccountKey);
      if (info) {
        addToSummary(info.accountKey, info, tx);
        continue;
      }
    }

    if (tx.accountCode !== normalizedCode) {
      info = accountKeyToInfo.get(tx.accountCode);
      if (info) {
        addToSummary(info.accountKey, info, tx);
      }
    }
  }

  // B110 fallback — use dominant-year months to avoid outlier month corruption
  const relevantMonths2 = getDominantYearMonths(transactions);

  for (const account of result.accounts) {
    const key = account.accountKey.trim();
    if (!key || account.creditTurnover <= 0) continue;

    const existing = summary.get(key);
    const b100Sum = existing ? Math.abs(existing.totalAmount) : 0;
    const b110Credit = Math.abs(account.creditTurnover);

    if (b110Credit > b100Sum * 2) {
      // B100 entries are unreliable (< 50% of B110 total) — distribute evenly across dominant-year months
      const monthCount = relevantMonths2.size || 1;
      const perMonth = b110Credit / monthCount;
      const evenBreakdown: Record<string, number> = {};
      for (const month of relevantMonths2) {
        evenBreakdown[month] = perMonth;
      }

      if (existing) {
        existing.monthlyBreakdown = evenBreakdown;
        existing.totalAmount = b110Credit;
      } else {
        const info = accountKeyToInfo.get(key);
        if (info) {
          summary.set(key, {
            accountCode: key,
            accountName: info.accountName,
            accountType: info.accountType,
            accountSort: info.accountSort,
            totalAmount: b110Credit,
            transactionCount: 0,
            monthlyBreakdown: evenBreakdown,
          });
        }
      }
    }
  }

  // Post-process: if date filter is active, trim each account to only the filtered months.
  if (isFiltered) {
    const filteredMonths = new Set<string>();
    for (const tx of filterTransactionsByPeriod(result.transactions, startDate!, endDate!)) {
      filteredMonths.add(formatYearMonth(tx.documentDate));
    }

    for (const account of summary.values()) {
      const trimmed: Record<string, number> = {};
      for (const [month, amount] of Object.entries(account.monthlyBreakdown)) {
        if (filteredMonths.has(month)) {
          trimmed[month] = amount;
        }
      }
      account.monthlyBreakdown = trimmed;
      account.totalAmount = Object.values(trimmed).reduce((sum, val) => sum + val, 0);
    }

    for (const [key, account] of summary) {
      if (account.totalAmount === 0) {
        summary.delete(key);
      }
    }
  }

  return summary;
}

/**
 * Convert revenue summary Map to array format for storage
 */
export function convertRevenueSummaryToArray(
  revenueSummary: Map<string, RevenueAccountSummary>
): Array<{
  accountCode: string;
  accountName: string;
  totalAmount: number;
  transactionCount: number;
  isConfirmed: boolean;
  monthlyBreakdown: Record<string, number>;
  b110CreditTurnover?: number;
}> {
  return Array.from(revenueSummary.values())
    .map(account => ({
      accountCode: account.accountCode,
      accountName: account.accountName,
      totalAmount: account.totalAmount,
      transactionCount: account.transactionCount,
      isConfirmed: false,
      monthlyBreakdown: account.monthlyBreakdown,
      ...(account.b110CreditTurnover != null ? { b110CreditTurnover: account.b110CreditTurnover } : {}),
    }))
    .sort((a, b) => Math.abs(b.totalAmount) - Math.abs(a.totalAmount));
}

/**
 * Convert all-accounts summary Map to sorted array for UI display
 */
export function convertAllAccountsSummaryToArray(
  allAccountsSummary: Map<string, AllAccountSummary>
): Array<{
  accountCode: string;
  accountName: string;
  accountType: string;
  accountSort: string;
  totalAmount: number;
  transactionCount: number;
  isConfirmed: boolean;
  monthlyBreakdown: Record<string, number>;
}> {
  return Array.from(allAccountsSummary.values())
    .map((account) => ({
      accountCode: account.accountCode,
      accountName: account.accountName,
      accountType: account.accountType,
      accountSort: account.accountSort,
      totalAmount: account.totalAmount,
      transactionCount: account.transactionCount,
      isConfirmed: false,
      monthlyBreakdown: account.monthlyBreakdown,
    }))
    .sort((a, b) => Math.abs(b.totalAmount) - Math.abs(a.totalAmount));
}

/**
 * Build aggregated monthly revenue breakdown from revenue accounts
 */
export function buildRevenueMonthlyBreakdown(
  revenueSummary: Map<string, RevenueAccountSummary>,
  confirmedAccountCodes?: string[] | string | null
): Record<string, number> {
  const breakdown: Record<string, number> = {};

  const confirmedCodes: Set<string> | null = confirmedAccountCodes
    ? new Set(Array.isArray(confirmedAccountCodes) ? confirmedAccountCodes : [confirmedAccountCodes])
    : null;

  for (const [accountCode, account] of revenueSummary) {
    if (confirmedCodes && !confirmedCodes.has(accountCode)) {
      continue;
    }

    for (const [month, amount] of Object.entries(account.monthlyBreakdown)) {
      breakdown[month] = (breakdown[month] || 0) + amount;
    }
  }

  return breakdown;
}
