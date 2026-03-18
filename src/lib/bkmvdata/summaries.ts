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
  const detectedByType = new Set<string>();
  for (const account of result.accounts) {
    if (account.accountType && (account.accountType.includes('הכנסות') || (account.accountType.includes('מכירות') && !account.accountType.includes('עלות מכירות')))) {
      const key = account.accountKey.trim();
      if (key) {
        revenueAccountCodes.add(key);
        detectedByType.add(key);
        accountCodeToInfo.set(key, {
          accountKey: key,
          accountName: account.accountName || key,
        });
      }
    }
  }

  // Cumulative: also detect revenue accounts by account name
  // Catches accounts like "הכנסות תן ביס" typed as "וחברות חיצוניות" in Ravachit,
  // and unknown-d files where accountType is "צאות" but name is "הכנסות"
  for (const account of result.accounts) {
    const key = account.accountKey.trim();
    if (!key || revenueAccountCodes.has(key)) continue;

    if (
      account.accountName &&
      account.accountName.startsWith('הכנסות') &&
      !account.accountName.includes('זקופות')
    ) {
      revenueAccountCodes.add(key);
      accountCodeToInfo.set(key, {
        accountKey: key,
        accountName: account.accountName || key,
      });
    }
  }

  // Name-based transaction matching is only used when NO accounts were found by type
  // (unknown-d files where accountCode doesn't match accountKey).
  // When type-based detection found accounts, transactions already match by code correctly.
  const detectedByName = detectedByType.size === 0;

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

  // Track gross B100 volume per account for B110 fallback heuristic
  const revenueGrossVolume = new Map<string, number>();

  for (const tx of result.transactions) {
    const normalizedCode = tx.accountCode.replace(/^0+/, '') || tx.accountCode;

    let accountInfo = accountCodeToInfo.get(normalizedCode);
    if (accountInfo) {
      // Skip direct entries — revenue is fully captured via indirect entries
      // (resolvedAccountKey/counterpartyName path). Direct entries to revenue
      // accounts are adjustments/offsets, not actual revenue.
      continue;
    }

    {
      const counterparty = tx.counterpartyName.trim();
      if (revenueAccountCodes.has(counterparty)) {
        accountInfo = accountCodeToInfo.get(counterparty);
        // isDirect stays false — counterparty IS the revenue account,
        // meaning this tx is on another account (indirect)
      }
      // Fallback: match counterpartyName against revenue account names
      if (!accountInfo && accountNameToInfo) {
        accountInfo = accountNameToInfo.get(counterparty);
      }
    }

    // Fallback: resolvedAccountKey (e.g. credit-side transactions where
    // accountCode is the counterparty but resolvedAccountKey is the revenue account)
    if (!accountInfo && tx.resolvedAccountKey) {
      accountInfo = accountCodeToInfo.get(tx.resolvedAccountKey);
      // isDirect stays false — this is an indirect match
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

    revenueGrossVolume.set(accountKey, (revenueGrossVolume.get(accountKey) || 0) + Math.abs(tx.amount));

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
    // Use gross volume (sum of absolute amounts) to avoid false positives on two-sided accounts
    const b100Sum = revenueGrossVolume.get(key) || (existing ? Math.abs(existing.totalAmount) : 0);
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
      // Preserve sign from B100 data — if transactions sum to negative (e.g. offset accounts
      // like "קיזוז חבר"), keep the negative sign even when using B110 magnitude
      const isNegative = existing && existing.totalAmount < 0;
      const signedTotal = isNegative ? -b110Credit : b110Credit;
      const monthCount = relevantMonths.size || 1;
      const perMonth = signedTotal / monthCount;
      const evenBreakdown: Record<string, number> = {};
      for (const month of relevantMonths) {
        evenBreakdown[month] = perMonth;
      }

      if (existing) {
        existing.monthlyBreakdown = evenBreakdown;
        existing.totalAmount = signedTotal;
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

  // Handle negative credit turnover accounts (contra-revenue like "הכנסות מקיזוז חבר").
  // These accounts have B100 entries where direct debit+credit amounts are both positive
  // (cancel out in reality, but sum incorrectly). The indirect (resolvedAccountKey) entries
  // from other accounts carry the correctly-signed revenue amounts.
  for (const account of result.accounts) {
    const key = account.accountKey.trim();
    if (!revenueAccountCodes.has(key)) continue;
    if (account.creditTurnover >= 0) continue; // positive handled above

    // Collect only indirect transactions (resolvedAccountKey points to this revenue account)
    const indirectBreakdown: Record<string, number> = {};
    let indirectSum = 0;
    let indirectCount = 0;
    for (const tx of result.transactions) {
      if (tx.amount === 0) continue;
      const code = tx.accountCode.replace(/^0+/, '') || tx.accountCode;
      if (code === key) continue; // skip direct — debit+credit cancel out
      if (tx.resolvedAccountKey === key) {
        const monthKey = formatYearMonth(tx.documentDate);
        indirectBreakdown[monthKey] = (indirectBreakdown[monthKey] || 0) + tx.amount;
        indirectSum += tx.amount;
        indirectCount++;
      }
    }

    if (indirectCount > 0) {
      const existing = summary.get(key);
      if (existing) {
        existing.monthlyBreakdown = indirectBreakdown;
        existing.totalAmount = indirectSum;
        existing.transactionCount = indirectCount;
        existing.b110CreditTurnover = account.creditTurnover;
      } else {
        const info = accountCodeToInfo.get(key);
        summary.set(key, {
          accountCode: key,
          accountName: info?.accountName || key,
          totalAmount: indirectSum,
          transactionCount: indirectCount,
          monthlyBreakdown: indirectBreakdown,
          b110CreditTurnover: account.creditTurnover,
        });
      }
    } else {
      // No indirect transactions — distribute B110 creditTurnover evenly
      const total = account.creditTurnover;
      const monthCount = relevantMonths.size || 1;
      const perMonth = total / monthCount;
      const evenBreakdown: Record<string, number> = {};
      for (const month of relevantMonths) {
        evenBreakdown[month] = perMonth;
      }
      const existing = summary.get(key);
      if (existing) {
        existing.monthlyBreakdown = evenBreakdown;
        existing.totalAmount = total;
        existing.b110CreditTurnover = account.creditTurnover;
      } else {
        const info = accountCodeToInfo.get(key);
        summary.set(key, {
          accountCode: key,
          accountName: info?.accountName || key,
          totalAmount: total,
          transactionCount: 0,
          monthlyBreakdown: evenBreakdown,
          b110CreditTurnover: account.creditTurnover,
        });
      }
    }
  }

  // Handle debit-only revenue accounts (creditTurnover = 0, debitTurnover > 0).
  // Debit entries to a revenue account are contra-revenue (reductions/offsets).
  // B100 transactions sum to a positive amount but should be negative in revenue context.
  // Example: "הכנסות עמלת חבר" — member commission deductions.
  for (const account of result.accounts) {
    const key = account.accountKey.trim();
    if (!revenueAccountCodes.has(key)) continue;
    if (account.creditTurnover !== 0) continue; // already handled above
    if (account.debitTurnover <= 0) continue;

    const existing = summary.get(key);
    if (!existing || existing.totalAmount <= 0) continue; // already negative or missing

    // Negate — debit entries to revenue are contra-revenue
    existing.totalAmount = -existing.totalAmount;
    for (const month of Object.keys(existing.monthlyBreakdown)) {
      existing.monthlyBreakdown[month] = -existing.monthlyBreakdown[month];
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

  // Track gross B100 volume per account (sum of absolute amounts) for B110 fallback heuristic
  const grossVolume = new Map<string, number>();

  function addToSummary(groupKey: string, info: AccountInfo, tx: BkmvTransaction) {
    const monthKey = formatYearMonth(tx.documentDate);
    grossVolume.set(groupKey, (grossVolume.get(groupKey) || 0) + Math.abs(tx.amount));
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
    // Use gross volume (sum of absolute amounts) to avoid false positives on two-sided accounts
    // where debit and credit nearly cancel out (e.g. offset/contra accounts like "הכנסות מקיזוז חבר")
    const b100Sum = grossVolume.get(key) || (existing ? Math.abs(existing.totalAmount) : 0);
    const b110Credit = Math.abs(account.creditTurnover);

    if (b110Credit > b100Sum * 2) {
      // B100 entries are unreliable (< 50% of B110 total) — distribute evenly across dominant-year months
      // Preserve sign from B100 data — if transactions sum to negative, keep negative sign
      const isNegative = existing && existing.totalAmount < 0;
      const signedTotal = isNegative ? -b110Credit : b110Credit;
      const monthCount = relevantMonths2.size || 1;
      const perMonth = signedTotal / monthCount;
      const evenBreakdown: Record<string, number> = {};
      for (const month of relevantMonths2) {
        evenBreakdown[month] = perMonth;
      }

      if (existing) {
        existing.monthlyBreakdown = evenBreakdown;
        existing.totalAmount = signedTotal;
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

  // Handle negative credit turnover accounts (contra-revenue like "הכנסות מקיזוז חבר").
  // These have B100 entries where direct debit+credit amounts both positive (cancel out),
  // but the indirect (resolvedAccountKey) entries carry the correct signed amounts.
  for (const account of result.accounts) {
    const key = account.accountKey.trim();
    if (!key || account.creditTurnover >= 0) continue; // positive handled above

    const indirectBreakdown: Record<string, number> = {};
    let indirectSum = 0;
    let indirectCount = 0;
    for (const tx of transactions) {
      if (tx.amount === 0) continue;
      const code = tx.accountCode.replace(/^0+/, '') || tx.accountCode;
      if (code === key) continue; // skip direct — debit+credit cancel out
      if (tx.resolvedAccountKey === key) {
        const monthKey = formatYearMonth(tx.documentDate);
        indirectBreakdown[monthKey] = (indirectBreakdown[monthKey] || 0) + tx.amount;
        indirectSum += tx.amount;
        indirectCount++;
      }
    }

    const info = accountKeyToInfo.get(key);
    if (indirectCount > 0) {
      const existing = summary.get(key);
      if (existing) {
        existing.monthlyBreakdown = indirectBreakdown;
        existing.totalAmount = indirectSum;
        existing.transactionCount = indirectCount;
      } else if (info) {
        summary.set(key, {
          accountCode: key,
          accountName: info.accountName,
          accountType: info.accountType,
          accountSort: info.accountSort,
          totalAmount: indirectSum,
          transactionCount: indirectCount,
          monthlyBreakdown: indirectBreakdown,
        });
      }
    } else {
      // No indirect transactions — distribute B110 creditTurnover evenly
      const total = account.creditTurnover; // already negative
      const monthCount = relevantMonths2.size || 1;
      const perMonth = total / monthCount;
      const evenBreakdown: Record<string, number> = {};
      for (const month of relevantMonths2) {
        evenBreakdown[month] = perMonth;
      }
      const existing = summary.get(key);
      if (existing) {
        existing.monthlyBreakdown = evenBreakdown;
        existing.totalAmount = total;
      } else if (info) {
        summary.set(key, {
          accountCode: key,
          accountName: info.accountName,
          accountType: info.accountType,
          accountSort: info.accountSort,
          totalAmount: total,
          transactionCount: 0,
          monthlyBreakdown: evenBreakdown,
        });
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

/**
 * Merge revenue summary amounts into all-accounts summary.
 *
 * buildAllAccountsSummary groups transactions by accountCode priority, missing
 * indirect transactions (resolvedAccountKey → revenue account). buildRevenueSummary
 * captures both direct and indirect, producing more accurate revenue totals.
 * This function overrides matching accounts in allAccounts with revenueSummary data.
 */
export function mergeRevenueSummaryIntoAllAccounts(
  allAccounts: Map<string, AllAccountSummary>,
  revenueSummary: Map<string, RevenueAccountSummary> | undefined
): void {
  if (!revenueSummary) return;

  for (const [key, revenueData] of revenueSummary) {
    const existing = allAccounts.get(key);
    if (!existing) continue;

    // Guard: don't override negative B100 amounts with positive B110-derived amounts
    if (existing.totalAmount < 0 && revenueData.totalAmount > 0) continue;

    existing.totalAmount = revenueData.totalAmount;
    existing.transactionCount = revenueData.transactionCount;
    existing.monthlyBreakdown = revenueData.monthlyBreakdown;
  }
}
