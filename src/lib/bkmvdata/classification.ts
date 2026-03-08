import type {
  AccountCategory,
  AllAccountSummary,
  ClassifiedAccount,
  SupplierPurchaseSummary,
} from './types';

/**
 * Auto-classify an account based on its accountType text from B110 records.
 * Uses contains-based pattern matching on the Hebrew accountType string.
 */
export function autoClassifyAccount(accountType: string): AccountCategory {
  if (!accountType) return 'uncategorized';

  const t = accountType.trim();
  if (t.length === 0) return 'uncategorized';

  // Supplier patterns
  if (
    t.includes('ספק') ||
    t.includes('נותני שרות') ||
    t.includes('נותני שירות') ||
    t.includes('שירותים') ||
    t.includes('ירותים')
  ) {
    return 'supplier';
  }

  // COGS (cost of goods sold) - must come BEFORE revenue since "עלות מכירות" contains "מכירות"
  if (t.includes('עלות מכירות')) {
    return 'expense';
  }

  // Revenue patterns
  if (
    t.includes('הכנסות') ||
    t.includes('מכירות')
  ) {
    return 'revenue';
  }

  // Employee patterns (BEFORE expense - "הוצאות שכר" should match employee, not expense)
  if (
    t.includes('עובד') ||
    t.includes('שכר עבודה') ||
    t.includes('הוצאות שכר') ||
    t.includes('שכע') ||
    t.includes('לשכר') ||
    t.includes('עתודה לפיצוי') ||
    t.includes('עתודות בגין') ||
    t.includes('דות בגין')
  ) {
    return 'employee';
  }

  // Short Hebrew utility/expense type keywords (common in Ravachit format
  // where accountType is abbreviated, e.g. "גז" instead of "הוצאות גז")
  if (t === 'גז' || t === 'חשמל' || t === 'מים') {
    return 'expense';
  }

  // Expense patterns - includes generic "הוצאות" catch-all
  if (
    t.includes('קניות') ||
    t.includes('הוצאות') ||
    t.includes('וצאות מימון') ||
    t.includes('ת הנהלה') ||
    t.includes('שכ"ד') ||
    t.includes("שכ'ד") ||
    t.includes('שכר דירה') ||
    t.includes('ביטוח') ||
    t.includes('משרדיות') ||
    t.includes('תקשורת') ||
    t.includes('פרסום') ||
    t.includes('מיסים ואגרות') ||
    t.includes('ליחויות והובלות')
  ) {
    return 'expense';
  }

  return 'uncategorized';
}

/**
 * Fallback classification based on accountKey numeric prefix.
 * Used when autoClassifyAccount returns 'uncategorized' — common in extended format
 * BKMVDATA files where accountType field is empty and the fallback accountName
 * is a proper name (e.g., "יוניקו טקסטיל") rather than a classification keyword.
 *
 * Israeli chart of accounts standard ranges:
 * 21x = Revenue, 23x/28x = Expenses, 71x-72x = Suppliers/Creditors
 */
export function classifyByAccountKeyPrefix(accountKey: string): AccountCategory {
  if (!accountKey) return 'uncategorized';

  const stripped = accountKey.replace(/^0+/, '');
  if (!stripped) return 'uncategorized';

  const prefix = parseInt(stripped.substring(0, 2), 10);
  if (isNaN(prefix)) return 'uncategorized';

  if (prefix === 21) return 'revenue';
  if (prefix === 23 || prefix === 28) return 'expense';
  if (prefix >= 71 && prefix <= 72) return 'supplier';

  return 'uncategorized';
}

/**
 * Classify all accounts from a BKMV parse result.
 * Merges saved DB classifications (highest priority) with auto-classifications.
 */
export function classifyAccounts(
  allAccountsSummary: Map<string, AllAccountSummary>,
  savedClassifications?: Map<string, AccountCategory>
): Map<string, ClassifiedAccount> {
  const result = new Map<string, ClassifiedAccount>();

  for (const [key, account] of allAccountsSummary) {
    // Check saved classification first (highest priority)
    const savedCategory = savedClassifications?.get(key);
    if (savedCategory) {
      result.set(key, {
        ...account,
        category: savedCategory,
        classificationSource: 'saved',
      });
      continue;
    }

    // Auto-classify from accountType
    let autoCategory = autoClassifyAccount(account.accountType);

    // Fallback 1: detect revenue by account name (e.g. "הכנסות תן ביס" typed as "וחברות חיצוניות")
    if (autoCategory === 'uncategorized' && account.accountName) {
      if (
        account.accountName.startsWith('הכנסות') &&
        !account.accountName.includes('זקופות')
      ) {
        autoCategory = 'revenue';
      }
    }

    // Fallback 2: when text-based classification fails, try classifying by accountKey prefix.
    // Only use prefix fallback when accountType is genuinely empty/missing or equals
    // accountName (parser fallback for extended format files where no real type exists).
    // When accountType has a real but unrecognized value (e.g. "גז"), skip prefix fallback
    // to avoid misclassifying expense accounts whose key happens to start with 21 (revenue range).
    if (autoCategory === 'uncategorized') {
      const hasRealAccountType = account.accountType &&
        account.accountType.trim().length > 0 &&
        account.accountType !== account.accountName;

      if (!hasRealAccountType) {
        const prefixCategory = classifyByAccountKeyPrefix(key);
        if (prefixCategory !== 'uncategorized') {
          autoCategory = prefixCategory;
        }
      }
    }

    result.set(key, {
      ...account,
      category: autoCategory,
      classificationSource: autoCategory === 'uncategorized' ? 'default' : 'auto',
    });
  }

  return result;
}

/**
 * Filter supplier summary by account classification category.
 */
export function filterSuppliersByClassification(
  supplierSummary: Map<string, SupplierPurchaseSummary>,
  classifiedAccounts: Map<string, ClassifiedAccount>,
  category: AccountCategory
): Map<string, SupplierPurchaseSummary> {
  // Collect all accountSort codes for the target category
  const targetSortCodes = new Set<string>();
  for (const account of classifiedAccounts.values()) {
    if (account.category === category && account.accountSort) {
      targetSortCodes.add(account.accountSort);
    }
  }

  // Collect accountKeys (accountCode) for target category — used as fallback
  // when accountSort is empty (common in extended format BKMVDATA files)
  const targetAccountKeys = new Set<string>();
  for (const account of classifiedAccounts.values()) {
    if (account.category === category) {
      targetAccountKeys.add(account.accountCode);
    }
  }

  // Filter supplier summary by sort codes OR resolvedAccountKey
  const filtered = new Map<string, SupplierPurchaseSummary>();
  for (const [key, summary] of supplierSummary.entries()) {
    const hasMatch = summary.transactions.some(
      tx =>
        (tx.accountSort && targetSortCodes.has(tx.accountSort)) ||
        (tx.resolvedAccountKey && targetAccountKeys.has(tx.resolvedAccountKey))
    );
    if (hasMatch) {
      filtered.set(key, summary);
    }
  }

  // Ensure ALL accounts classified as this category appear in results.
  for (const [, account] of classifiedAccounts.entries()) {
    if (account.category !== category) continue;

    const accountName = account.accountName;
    if (!accountName) continue;

    // Skip if already represented in filtered results
    if (filtered.has(accountName)) continue;

    filtered.set(accountName, {
      supplierName: accountName,
      totalAmount: account.totalAmount,
      transactionCount: account.transactionCount,
      transactions: [],
    });
  }

  return filtered;
}

/**
 * Get category counts from classified accounts.
 */
export function getCategoryCounts(
  classifiedAccounts: Map<string, ClassifiedAccount>
): Record<AccountCategory, number> {
  const counts: Record<AccountCategory, number> = {
    supplier: 0,
    revenue: 0,
    employee: 0,
    expense: 0,
    uncategorized: 0,
  };

  for (const account of classifiedAccounts.values()) {
    counts[account.category]++;
  }

  return counts;
}
