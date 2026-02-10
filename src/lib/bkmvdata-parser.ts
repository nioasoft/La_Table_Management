/**
 * BKMVDATA Parser - Parser for Israeli Tax Authority unified format files (מבנה אחיד)
 *
 * BKMVDATA files contain accounting transactions in a fixed-width format.
 * This parser extracts supplier purchases from franchisee reports for cross-referencing.
 *
 * Record Types:
 * - A100: Header record
 * - B100: Transaction records (accounting journal entries)
 * - B110: Account master records
 * - Z900: Footer record
 *
 * File encoding: ISO-8859-8 (Hebrew), CP862 (DOS Hebrew), or Windows-1255
 */

import * as iconv from 'iconv-lite';

// ============================================================================
// TYPES
// ============================================================================

/**
 * Parsed B100 transaction record
 */
export interface BkmvTransaction {
  lineNumber: number;
  companyId: string;
  accountCode: string;
  documentNumber: string;
  description: string;
  documentDate: Date;
  valueDate: Date;
  counterpartyName: string;  // שם הכרטיס הנגדי - this is where supplier name appears
  side: 'debit' | 'credit';  // 1=debit, 2=credit
  currency: string;
  amount: number;            // Amount in shekels (converted from agorot)
  reference: string;         // Reference code (positions 100-106)
  accountSort: string;       // Account sort/classification from B110
  rawLine: string;           // Original line for debugging
  resolvedAccountKey: string; // B110 accountKey that matched this transaction's counterparty
}

/**
 * Parsed B110 account master record
 */
export interface BkmvAccount {
  companyId: string;
  accountKey: string;
  accountCode: string;       // 5-digit account code (matches B100 accountCode)
  accountName: string;
  accountDescription: string;
  accountType: string;       // e.g., "ספקים" for suppliers
  accountSort: string;       // Account sort/classification (e.g., "200" for suppliers)
}

/**
 * Aggregated supplier purchases summary
 */
export interface SupplierPurchaseSummary {
  supplierName: string;
  totalAmount: number;       // Total purchases from this supplier
  transactionCount: number;  // Number of transactions
  transactions: BkmvTransaction[];
}

/**
 * Revenue account summary - aggregated by account code
 */
export interface RevenueAccountSummary {
  accountCode: string;
  accountName: string;
  totalAmount: number;
  transactionCount: number;
  monthlyBreakdown: Record<string, number>; // YYYY-MM -> amount
}

/**
 * All-account summary - aggregated by account code from B110 records
 * Extends RevenueAccountSummary with account classification fields
 */
export interface AllAccountSummary {
  accountCode: string;
  accountName: string;
  accountType: string;
  accountSort: string;
  totalAmount: number;
  transactionCount: number;
  monthlyBreakdown: Record<string, number>; // YYYY-MM -> amount
}

/**
 * Complete parse result
 */
export interface BkmvParseResult {
  companyId: string;
  fileVersion: string;
  totalRecords: number;
  transactions: BkmvTransaction[];
  accounts: BkmvAccount[];
  supplierSummary: Map<string, SupplierPurchaseSummary>;
  revenueSummary: Map<string, RevenueAccountSummary>;
  errors: string[];
  warnings: string[];
}

// ============================================================================
// FIELD POSITIONS (0-indexed)
// Based on analysis of BKMVDATA format v1.31
// ============================================================================

const B100_FIELDS = {
  RECORD_TYPE: { start: 0, length: 3 },        // "B10"
  LINE_NUMBER: { start: 3, length: 10 },       // Running line number
  COMPANY_ID: { start: 13, length: 9 },        // ח.פ
  ACCOUNT_CODE: { start: 27, length: 5 },      // Account number
  DOC_LINE: { start: 32, length: 5 },          // Line within document
  DOC_NUMBER: { start: 37, length: 8 },        // Document number
  // Skip some fields
  REFERENCE: { start: 100, length: 6 },        // Reference code
  DESCRIPTION: { start: 106, length: 44 },     // Transaction description
  DOC_DATE: { start: 156, length: 8 },         // Document date YYYYMMDD
  VALUE_DATE: { start: 164, length: 8 },       // Value date YYYYMMDD
  COUNTERPARTY: { start: 172, length: 27 },    // Counterparty account name
  SIDE: { start: 202, length: 1 },             // 1=debit, 2=credit
  CURRENCY: { start: 203, length: 3 },         // Currency code (e.g., USD, ILS)
  AMOUNT_SIGN: { start: 206, length: 1 },      // + or -
  AMOUNT: { start: 207, length: 14 },          // Amount in agorot (100th of shekel)
};

const B110_FIELDS = {
  RECORD_TYPE: { start: 0, length: 3 },        // "B11"
  LINE_NUMBER: { start: 3, length: 10 },
  COMPANY_ID: { start: 13, length: 9 },
  ACCOUNT_KEY: { start: 22, length: 15 },      // Account identifier
  ACCOUNT_NAME: { start: 37, length: 30 },     // Account name
  ACCOUNT_DESC: { start: 67, length: 50 },     // Account description
  ACCOUNT_TYPE: { start: 200, length: 30 },    // Account type (e.g., "ספקים")
};

// ============================================================================
// PARSER FUNCTIONS
// ============================================================================

/**
 * Extract a field from a fixed-width line
 */
function extractField(line: string, field: { start: number; length: number }): string {
  return line.substring(field.start, field.start + field.length).trim();
}

/**
 * Parse a date in YYYYMMDD format
 */
function parseDate(dateStr: string): Date {
  if (!dateStr || dateStr.length !== 8) {
    return new Date(0);
  }
  const year = parseInt(dateStr.substring(0, 4), 10);
  const month = parseInt(dateStr.substring(4, 6), 10) - 1; // 0-indexed
  const day = parseInt(dateStr.substring(6, 8), 10);
  return new Date(year, month, day);
}

/**
 * Parse amount from agorot to shekels
 */
function parseAmount(amountStr: string, signStr: string): number {
  const rawAmount = parseInt(amountStr, 10) || 0;
  const amount = rawAmount / 100; // Convert from agorot to shekels
  return signStr === '-' ? -amount : amount;
}

/**
 * Parse a B100 transaction record
 */
function parseB100Record(line: string, lineNum: number): BkmvTransaction | null {
  try {
    const recordType = extractField(line, B100_FIELDS.RECORD_TYPE);
    if (recordType !== 'B10') {
      return null;
    }

    const sideValue = extractField(line, B100_FIELDS.SIDE);

    return {
      lineNumber: parseInt(extractField(line, B100_FIELDS.LINE_NUMBER), 10) || lineNum,
      companyId: extractField(line, B100_FIELDS.COMPANY_ID),
      accountCode: extractField(line, B100_FIELDS.ACCOUNT_CODE),
      accountSort: '', // Will be populated later from B110 account master
      documentNumber: extractField(line, B100_FIELDS.DOC_NUMBER),
      description: extractField(line, B100_FIELDS.DESCRIPTION),
      documentDate: parseDate(extractField(line, B100_FIELDS.DOC_DATE)),
      valueDate: parseDate(extractField(line, B100_FIELDS.VALUE_DATE)),
      counterpartyName: extractField(line, B100_FIELDS.COUNTERPARTY),
      side: sideValue === '2' ? 'credit' : 'debit',
      currency: extractField(line, B100_FIELDS.CURRENCY),
      amount: parseAmount(
        extractField(line, B100_FIELDS.AMOUNT),
        extractField(line, B100_FIELDS.AMOUNT_SIGN)
      ),
      reference: extractField(line, B100_FIELDS.REFERENCE),
      rawLine: line,
      resolvedAccountKey: '',
    };
  } catch (error) {
    console.error(`Error parsing B100 record at line ${lineNum}:`, error);
    return null;
  }
}

/**
 * Parse a B110 account master record
 */
function parseB110Record(line: string): BkmvAccount | null {
  try {
    const recordType = extractField(line, B110_FIELDS.RECORD_TYPE);
    if (recordType !== 'B11') {
      return null;
    }

    const accountKey = extractField(line, B110_FIELDS.ACCOUNT_KEY);
    const accountDescription = extractField(line, B110_FIELDS.ACCOUNT_DESC);
    let accountName = extractField(line, B110_FIELDS.ACCOUNT_NAME);

    // Some accounting systems (like the newer format) put the account name in the
    // description field instead of the name field. If accountName is empty or
    // only contains numbers/symbols, try to extract a meaningful name from description.
    if (!accountName || /^[\d\s\-\.]+$/.test(accountName)) {
      // Extract the first Hebrew/English word sequence from description
      // Format may be: "מליסרון בע"מ             30" - name followed by sort code
      const descMatch = accountDescription.match(/^([א-תa-zA-Z][\s\S]*?)(?:\s{3,}|\d{2,}|$)/);
      if (descMatch && descMatch[1]) {
        accountName = descMatch[1].trim();
      }
    }

    // Extract account sort from description (format: 000000000000XXX[optional Hebrew text])
    // The sort code is the last 3 digits from the leading 15-digit number
    let accountSort = '';
    const match = accountDescription.match(/0{12}(\d{3})/);
    if (match && match[1]) {
      accountSort = match[1]; // The 3-digit sort code
    }

    // If accountSort not found in old format, try to find it in new format
    // New format: name followed by 2-4 digit sort code (e.g., "מליסרון בע"מ             30")
    if (!accountSort) {
      const sortMatch = accountDescription.match(/\s{3,}(\d{1,4})\s*$/);
      if (sortMatch && sortMatch[1]) {
        accountSort = sortMatch[1];
      }
    }

    // Format 3: sort code between name and type text (e.g., "מע"מ עיסקאות  9490  זכאים אח")
    // The sort code appears as a 2-4 digit number flanked by spaces, followed by Hebrew type text
    if (!accountSort) {
      const middleMatch = accountDescription.match(/\s+(\d{2,4})\s+[א-ת]/);
      if (middleMatch && middleMatch[1]) {
        accountSort = middleMatch[1];
      }
    }

    // Extract the 5-digit account code from accountKey
    // B100 accountCode is at positions 27-31, which is within B110 accountKey at offset 5
    // accountKey is 15 chars (positions 22-36), accountCode is 5 chars (positions 27-31)
    // So accountCode = accountKey.substring(5, 10)
    const accountCode = accountKey.substring(5, 10).trim();

    // Extract account type (e.g., "ספקים") from multiple possible locations
    // Old format: position 200 (B110_FIELDS.ACCOUNT_TYPE)
    let accountType = extractField(line, B110_FIELDS.ACCOUNT_TYPE);

    // Check if accountType is valid Hebrew (not just numeric or empty)
    // Some file formats put "0" or addresses in this field
    const isValidAccountType = accountType && /^[א-ת\s]+$/.test(accountType) && accountType.length >= 2;

    // Try to extract from description in old format:
    // Pattern: 12 zeros + 3-digit sort + Hebrew account type (e.g., "000000000000200ספקים")
    if (!isValidAccountType) {
      const typeMatch = accountDescription.match(/0{12}\d{3}([א-ת\s]+)/);
      if (typeMatch && typeMatch[1]) {
        accountType = typeMatch[1].trim();
      }
    }

    // Try middle format: extract type text AFTER the sort code in the description
    // Read a wider range (positions 67-160) to avoid truncation at field boundaries
    // Example: "מע"מ עיסקאות  9490  זכאים אחרים ויתרות זכות"
    if (!isValidAccountType && (!accountType || !/^[א-ת\s"']+$/.test(accountType) || accountType.length < 2)) {
      if (accountSort && line.length > 117) {
        const wideText = line.substring(67, Math.min(line.length, 160)).trim();
        const sortIdx = wideText.indexOf(accountSort);
        if (sortIdx >= 0) {
          const afterSort = wideText.substring(sortIdx + accountSort.length).trim();
          const hebrewMatch = afterSort.match(/^([א-ת][א-ת\s"'׳]{1,40})/);
          if (hebrewMatch && hebrewMatch[1].trim().length >= 2) {
            accountType = hebrewMatch[1].trim();
          }
        }
      }
    }

    // New format: accountType is at position 117-147
    if (!isValidAccountType && (!accountType || !/^[א-ת\s]+$/.test(accountType))) {
      const newFormatType = line.substring(117, 147).trim();
      // Filter out addresses (contain numbers) - only keep pure Hebrew type names
      // Account types are short Hebrew words like "ספקים", "עובדים", "בנק"
      if (newFormatType && /^[א-ת\s]+$/.test(newFormatType) && newFormatType.length <= 20) {
        accountType = newFormatType;
      }
    }

    return {
      companyId: extractField(line, B110_FIELDS.COMPANY_ID),
      accountKey,
      accountCode,
      accountName,
      accountDescription: accountDescription,
      accountType,
      accountSort,
    };
  } catch (error) {
    console.error('Error parsing B110 record:', error);
    return null;
  }
}

/**
 * Parse A100 header record
 */
function parseA100Record(line: string): { companyId: string; version: string } | null {
  try {
    if (!line.startsWith('A10')) {
      return null;
    }

    // A100 format: A10 + line number + company ID + additional info
    const companyId = line.substring(13, 22).trim();

    // Extract version from &OF1.31& pattern
    const versionMatch = line.match(/&OF(\d+\.\d+)&/);
    const version = versionMatch ? versionMatch[1] : 'unknown';

    return { companyId, version };
  } catch (error) {
    console.error('Error parsing A100 record:', error);
    return null;
  }
}

/**
 * Count Hebrew characters (Unicode range) in a string.
 * Used for encoding detection.
 */
function countHebrew(text: string): number {
  let count = 0;
  const limit = Math.min(text.length, 10000);
  for (let i = 0; i < limit; i++) {
    const code = text.charCodeAt(i);
    if (code >= 0x05D0 && code <= 0x05EA) count++;
  }
  return count;
}

/**
 * Decode buffer from Hebrew encoding to UTF-8.
 * Auto-detects between ISO-8859-8, CP862 (DOS Hebrew), and Windows-1255.
 */
export function decodeBuffer(buffer: Buffer): string {
  try {
    // Try ISO-8859-8 first (most common for BKMV files)
    const iso = iconv.decode(buffer, 'ISO-8859-8');
    const isoCount = countHebrew(iso);
    if (isoCount > 50) {
      return iso; // Clearly correct encoding
    }

    // Try CP862 (DOS Hebrew) - used by some older accounting software
    const cp862 = iconv.decode(buffer, 'CP862');
    const cp862Count = countHebrew(cp862);

    // Try Windows-1255
    const win1255 = iconv.decode(buffer, 'windows-1255');
    const win1255Count = countHebrew(win1255);

    // Pick the encoding that produced the most Hebrew characters
    if (cp862Count > isoCount && cp862Count >= win1255Count) {
      return cp862;
    }
    if (win1255Count > isoCount) {
      return win1255;
    }

    return iso; // Default to ISO-8859-8
  } catch {
    // Fallback: try to decode as UTF-8 or Latin-1
    const decoder = new TextDecoder('iso-8859-8');
    return decoder.decode(buffer);
  }
}

/**
 * Main parser function
 */
export function parseBkmvData(content: string | Buffer): BkmvParseResult {
  const result: BkmvParseResult = {
    companyId: '',
    fileVersion: '',
    totalRecords: 0,
    transactions: [],
    accounts: [],
    supplierSummary: new Map(),
    revenueSummary: new Map(),
    errors: [],
    warnings: [],
  };

  // Decode buffer if needed
  const textContent = Buffer.isBuffer(content) ? decodeBuffer(content) : content;

  // Split into lines (handle both Windows and Unix line endings)
  const lines = textContent.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line || line.length < 3) continue;

    const recordType = line.substring(0, 3);
    result.totalRecords++;

    switch (recordType) {
      case 'A10': {
        const header = parseA100Record(line);
        if (header) {
          result.companyId = header.companyId;
          result.fileVersion = header.version;
        }
        break;
      }

      case 'B10': {
        const transaction = parseB100Record(line, i + 1);
        if (transaction) {
          result.transactions.push(transaction);
        }
        break;
      }

      case 'B11': {
        const account = parseB110Record(line);
        if (account) {
          result.accounts.push(account);
        }
        break;
      }

      case 'Z90': {
        // Footer record - skip
        break;
      }

      case 'C10':
      case 'D11':
      case 'D12': {
        // Document detail / additional account data records - skip silently
        break;
      }

      default: {
        // Unknown record type
        if (line.trim()) {
          result.warnings.push(`Unknown record type at line ${i + 1}: ${recordType}`);
        }
      }
    }
  }

  // Build mappings from B110 records:
  // 1. accountKey → accountSort (for filtering by account type)
  // 2. accountKey → accountName (for resolving numeric counterparty references)
  const accountKeyToSort = new Map<string, string>();
  const accountKeyToName = new Map<string, string>();
  for (const account of result.accounts) {
    const key = account.accountKey.trim();
    if (account.accountSort && key) {
      accountKeyToSort.set(key, account.accountSort);
    }
    if (account.accountName && key) {
      accountKeyToName.set(key, account.accountName.trim());
    }
  }

  // Populate account sort and resolve counterparty names from B110 records
  // B110 contains the full account name, while B100 counterparty may contain:
  // - A short code (old format: "דגי" -> full name "כ.נ. דגי הקיבוצים בע"מ")
  // - A numeric key (new format: "65" -> full name "מליסרון בע"מ")
  // - A numeric key with suffix (new format: "40           1" -> account 40)
  for (const tx of result.transactions) {
    const counterparty = tx.counterpartyName.trim();

    // Try to find the account key - could be the full counterparty value or just the first number
    let accountKey = counterparty;
    const numericMatch = counterparty.match(/^(\d+)/);
    if (numericMatch) {
      // For numeric counterparties (like "65" or "40           1"), use the first number
      accountKey = numericMatch[1];
    }

    // Get account sort from B110
    tx.accountSort = accountKeyToSort.get(accountKey) || '';

    // Store the resolved accountKey for later use in buildAllAccountsSummary
    tx.resolvedAccountKey = accountKeyToName.has(accountKey) ? accountKey : '';

    // Always try to resolve the counterparty name from B110 for the full name
    const resolvedName = accountKeyToName.get(accountKey);
    if (resolvedName) {
      tx.counterpartyName = resolvedName;
    }
  }

  // Build supplier summary from credit transactions
  // Credit transactions to supplier accounts represent purchases
  buildSupplierSummary(result);

  // Build revenue summary from transactions to revenue accounts
  buildRevenueSummary(result);

  return result;
}

/**
 * Build supplier purchase summary from transactions
 *
 * Purchase transactions appear as CREDIT (side=2) to supplier accounts
 * We aggregate by counterparty name which contains the supplier
 */
function buildSupplierSummary(result: BkmvParseResult): void {
  const summary = new Map<string, SupplierPurchaseSummary>();

  for (const tx of result.transactions) {
    // Skip debit transactions (we want credits to suppliers)
    // Credit transactions include:
    // - Positive amounts: regular invoices (חשבוניות)
    // - Negative amounts: credit notes (חשבוניות זיכוי) - these reduce the total
    if (tx.side !== 'credit' || tx.amount === 0) {
      continue;
    }

    // Skip internal accounts (often start with special prefixes)
    // Common patterns to skip: מעמתש (VAT), ניכוי, בנק, קופה
    const skipPatterns = [
      'מעמתש',     // VAT
      'ניכוי',     // Deductions
      'קופה',      // Cash
      'דיינרס',    // Credit card
      'ויזה',      // Visa
      'מזרחי',     // Bank
      'לאומי',     // Bank
      'פועלים',    // Bank
      'אשראי',     // Credit
    ];

    const counterparty = tx.counterpartyName.toLowerCase();
    const shouldSkip = skipPatterns.some(pattern => counterparty.includes(pattern.toLowerCase()));

    if (shouldSkip) {
      continue;
    }

    // Use counterparty name as the supplier identifier
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
 *
 * Revenue accounts are identified by accountType containing "הכנסות" in B110 records.
 * In BKMVDATA format:
 * - B110 records define accounts with accountKey (identifier) and accountType
 * - B100 transactions have accountCode field that references the account
 *
 * We match B100 transactions where accountCode matches B110 accountKey
 * (with leading zeros stripped for comparison).
 *
 * Some older formats may use counterpartyName to reference accounts - we support both.
 */
function buildRevenueSummary(result: BkmvParseResult): void {
  const summary = new Map<string, RevenueAccountSummary>();

  // Build a map of revenue account codes -> account info
  // B110 accountKey is the account identifier (e.g., "5", "732", or "הכנסות")
  const revenueAccountCodes = new Set<string>();
  const accountCodeToInfo = new Map<string, { accountKey: string; accountName: string }>();

  for (const account of result.accounts) {
    // Check if this is a revenue account
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

  // If no revenue accounts found, return empty
  if (revenueAccountCodes.size === 0) {
    result.revenueSummary = summary;
    return;
  }

  // Aggregate transactions where accountCode matches a revenue account
  for (const tx of result.transactions) {
    // Normalize accountCode by removing leading zeros (e.g., "00005" -> "5")
    const normalizedCode = tx.accountCode.replace(/^0+/, '') || tx.accountCode;

    // Check if this transaction is for a revenue account
    let accountInfo = accountCodeToInfo.get(normalizedCode);

    // Fallback: some formats use counterpartyName to reference the account
    if (!accountInfo) {
      const counterparty = tx.counterpartyName.trim();
      if (revenueAccountCodes.has(counterparty)) {
        accountInfo = accountCodeToInfo.get(counterparty);
      }
    }

    if (!accountInfo) {
      continue;
    }

    // Skip zero amounts
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

  result.revenueSummary = summary;
}

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
    // Include both positive (invoices) and negative (credit notes) amounts
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

/**
 * Format amount for display (with ₪ symbol and thousands separator)
 */
export function formatAmount(amount: number): string {
  return new Intl.NumberFormat('he-IL', {
    style: 'currency',
    currency: 'ILS',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

/**
 * Get all unique supplier names from parsed data
 */
export function getUniqueSupplierNames(parseResult: BkmvParseResult): string[] {
  return Array.from(parseResult.supplierSummary.keys()).sort();
}

/**
 * Check if a file is a BKMVDATA file by examining its content
 * Returns true if the file starts with A10 record (BKMVDATA header)
 */
export function isBkmvDataFile(content: string | Buffer): boolean {
  try {
    // Decode buffer if needed
    const textContent = Buffer.isBuffer(content) ? decodeBuffer(content) : content;

    // Check if file is empty or too short
    if (!textContent || textContent.length < 10) {
      return false;
    }

    // Get the first line
    const firstLine = textContent.split(/\r?\n/)[0];
    if (!firstLine) {
      return false;
    }

    // BKMVDATA files start with A10 record (header)
    return firstLine.startsWith('A10');
  } catch {
    return false;
  }
}

/**
 * Extract date range from BKMVDATA transactions
 * Returns the min and max document dates from all transactions
 */
export function extractDateRange(parseResult: BkmvParseResult): { startDate: Date; endDate: Date } | null {
  if (parseResult.transactions.length === 0) {
    return null;
  }

  let minDate = new Date(8640000000000000); // Max date
  let maxDate = new Date(-8640000000000000); // Min date

  for (const tx of parseResult.transactions) {
    if (tx.documentDate && tx.documentDate.getTime() > 0) {
      if (tx.documentDate < minDate) minDate = tx.documentDate;
      if (tx.documentDate > maxDate) maxDate = tx.documentDate;
    }
  }

  // Check if we found valid dates
  if (minDate.getTime() === 8640000000000000 || maxDate.getTime() === -8640000000000000) {
    return null;
  }

  return { startDate: minDate, endDate: maxDate };
}

/**
 * Get unique reference codes from supplier summary
 * Returns sorted array of reference codes
 */
export function getUniqueReferences(supplierSummary: Map<string, SupplierPurchaseSummary>): string[] {
  const references = new Set<string>();

  for (const summary of supplierSummary.values()) {
    for (const tx of summary.transactions) {
      if (tx.reference) {
        references.add(tx.reference);
        break; // Only need one transaction per supplier to get its reference
      }
    }
  }

  return Array.from(references).sort();
}

/**
 * Filter supplier summaries by reference code
 * If reference is "all", returns all summaries
 * Otherwise returns only summaries with matching reference
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
 * Filter supplier summaries by account sort (מיון חשבון)
 * If accountSort is "all", returns all summaries
 * Otherwise returns only summaries with matching account sort
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
    // Check if any transaction has this account sort
    const hasMatchingSort = summary.transactions.some(tx => tx.accountSort === accountSort);
    if (hasMatchingSort) {
      filtered.set(key, summary);
    }
  }

  return filtered;
}

/**
 * Get unique account sorts from supplier summary
 * Returns sorted array of account sort codes
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
 * Account sort label with count information
 */
export interface AccountSortLabel {
  sort: string;
  label: string;
  count: number;
}

/**
 * Get account sort codes with their labels (account types) and transaction counts
 * Returns array of objects with sort code, label (account type name), and count
 * Useful for UI dropdowns that need to show meaningful names instead of just codes
 *
 * @example
 * // Returns: [{ sort: "200", label: "ספקים", count: 45 }, { sort: "330", label: "עובדים", count: 12 }]
 */
export function getAccountSortLabels(parseResult: BkmvParseResult): AccountSortLabel[] {
  // Build mapping from account sort to account type (e.g., "200" → "ספקים")
  const sortToType = new Map<string, string>();
  for (const account of parseResult.accounts) {
    if (account.accountSort && account.accountType) {
      // Only store the first mapping we find for each sort code
      if (!sortToType.has(account.accountSort)) {
        sortToType.set(account.accountSort, account.accountType);
      }
    }
  }

  // Count transactions for each account sort
  const sortCounts = new Map<string, number>();
  for (const summary of parseResult.supplierSummary.values()) {
    for (const tx of summary.transactions) {
      if (tx.accountSort) {
        sortCounts.set(tx.accountSort, (sortCounts.get(tx.accountSort) || 0) + 1);
      }
    }
  }

  // Get unique sorts from supplier summary
  const sorts = getUniqueAccountSorts(parseResult.supplierSummary);

  return sorts.map(sort => ({
    sort,
    label: sortToType.get(sort) || sort, // Use sort code as fallback label
    count: sortCounts.get(sort) || 0,
  }));
}

/**
 * Find the account sort code for a given account type label (e.g., "ספקים" → "200" or "30")
 * Useful for setting smart defaults when "200" doesn't exist in a new format file
 */
export function findAccountSortByType(parseResult: BkmvParseResult, accountType: string): string | undefined {
  const labels = getAccountSortLabels(parseResult);
  const match = labels.find(l => l.label === accountType);
  return match?.sort;
}

// ============================================================================
// MONTHLY BREAKDOWN FUNCTIONS
// ============================================================================

/**
 * Entry in the monthly breakdown
 */
export interface MonthlyBreakdownEntry {
  supplierId: string | null;
  supplierName: string;
  amount: number;
  transactionCount: number;
}

/**
 * Monthly breakdown type - maps month key (YYYY-MM) to supplier entries
 */
export type MonthlyBreakdown = Record<string, MonthlyBreakdownEntry[]>;

/**
 * Format a Date to YYYY-MM string
 */
function formatYearMonth(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

/**
 * Build monthly breakdown from transactions
 * Groups credit transactions by month and supplier name
 */
export function buildMonthlyBreakdown(
  transactions: BkmvTransaction[],
  supplierIdMap?: Map<string, string | null>
): MonthlyBreakdown {
  const breakdown: Record<string, Map<string, { amount: number; count: number }>> = {};

  for (const tx of transactions) {
    // Skip non-credit transactions (same logic as buildSupplierSummary)
    if (tx.side !== 'credit' || tx.amount === 0) {
      continue;
    }

    // Skip internal accounts
    const skipPatterns = [
      'מעמתש', 'ניכוי', 'קופה', 'דיינרס', 'ויזה',
      'מזרחי', 'לאומי', 'פועלים', 'אשראי',
    ];
    const counterparty = tx.counterpartyName.toLowerCase();
    if (skipPatterns.some(pattern => counterparty.includes(pattern.toLowerCase()))) {
      continue;
    }

    const supplierKey = tx.counterpartyName.trim();
    if (!supplierKey) continue;

    // Get month key from document date
    const monthKey = formatYearMonth(tx.documentDate);

    if (!breakdown[monthKey]) {
      breakdown[monthKey] = new Map();
    }

    const current = breakdown[monthKey].get(supplierKey);
    if (current) {
      current.amount += tx.amount;
      current.count++;
    } else {
      breakdown[monthKey].set(supplierKey, { amount: tx.amount, count: 1 });
    }
  }

  // Convert to final format
  const result: MonthlyBreakdown = {};

  for (const [month, suppliers] of Object.entries(breakdown)) {
    result[month] = [];
    for (const [supplierName, data] of suppliers.entries()) {
      result[month].push({
        supplierId: supplierIdMap?.get(supplierName) ?? null,
        supplierName,
        amount: data.amount,
        transactionCount: data.count,
      });
    }
    // Sort by amount descending
    result[month].sort((a, b) => b.amount - a.amount);
  }

  return result;
}

/**
 * Get amount for a specific supplier in a specific period from monthly breakdown
 *
 * @param monthlyBreakdown - The monthly breakdown data
 * @param supplierId - The supplier ID to look for
 * @param periodStart - Period start date string (YYYY-MM-DD)
 * @param periodEnd - Period end date string (YYYY-MM-DD)
 * @returns The total amount for the supplier in that period, or null if no data
 */
export function getAmountForPeriod(
  monthlyBreakdown: MonthlyBreakdown | undefined,
  supplierId: string,
  periodStart: string,
  periodEnd: string
): number | null {
  if (!monthlyBreakdown) return null;

  let total = 0;
  let hasData = false;

  // Extract month portion from dates
  const startMonth = periodStart.slice(0, 7); // "2025-12-01" -> "2025-12"
  const endMonth = periodEnd.slice(0, 7);

  for (const [month, suppliers] of Object.entries(monthlyBreakdown)) {
    if (month >= startMonth && month <= endMonth) {
      const matches = suppliers.filter(s => s.supplierId === supplierId);
      for (const match of matches) {
        total += match.amount;
        hasData = true;
      }
    }
  }

  return hasData ? total : null;
}

/**
 * Merge monthly breakdown from a new file into existing breakdown
 * New data overwrites existing data for the same months (last write wins)
 *
 * @param existing - Existing monthly breakdown (or undefined)
 * @param newData - New monthly breakdown to merge
 * @param sourceFileId - ID of the source file (for tracking)
 * @returns Merged monthly breakdown
 */
export function mergeMonthlyBreakdown(
  existing: MonthlyBreakdown | undefined,
  newData: MonthlyBreakdown
): MonthlyBreakdown {
  if (!existing) {
    return { ...newData };
  }

  const result = { ...existing };

  // New data overwrites existing data for the same months
  for (const [month, suppliers] of Object.entries(newData)) {
    result[month] = suppliers;
  }

  return result;
}

/**
 * Split a MonthlyBreakdown by year.
 * E.g., input with keys "2025-11", "2025-12", "2026-01" →
 * Map { 2025 → {"2025-11":..., "2025-12":...}, 2026 → {"2026-01":...} }
 */
export function groupMonthlyBreakdownByYear(
  breakdown: MonthlyBreakdown
): Map<number, MonthlyBreakdown> {
  const byYear = new Map<number, MonthlyBreakdown>();

  for (const [monthKey, entries] of Object.entries(breakdown)) {
    const year = parseInt(monthKey.slice(0, 4), 10);
    if (isNaN(year)) continue;

    if (!byYear.has(year)) {
      byYear.set(year, {});
    }
    byYear.get(year)![monthKey] = entries;
  }

  return byYear;
}

/**
 * Aggregate supplier matches from a MonthlyBreakdown.
 * Builds cumulative supplier totals (same shape as BkmvProcessingResult.supplierMatches).
 */
export function aggregateSupplierMatchesFromBreakdown(
  breakdown: MonthlyBreakdown
): Array<{
  bkmvName: string;
  amount: number;
  transactionCount: number;
  matchedSupplierId: string | null;
  matchedSupplierName: string | null;
}> {
  const supplierMap = new Map<
    string,
    {
      amount: number;
      transactionCount: number;
      supplierId: string | null;
    }
  >();

  for (const entries of Object.values(breakdown)) {
    for (const entry of entries) {
      const existing = supplierMap.get(entry.supplierName);
      if (existing) {
        existing.amount += entry.amount;
        existing.transactionCount += entry.transactionCount;
        // Keep the non-null supplierId if available
        if (!existing.supplierId && entry.supplierId) {
          existing.supplierId = entry.supplierId;
        }
      } else {
        supplierMap.set(entry.supplierName, {
          amount: entry.amount,
          transactionCount: entry.transactionCount,
          supplierId: entry.supplierId,
        });
      }
    }
  }

  return Array.from(supplierMap.entries())
    .map(([bkmvName, data]) => ({
      bkmvName,
      amount: data.amount,
      transactionCount: data.transactionCount,
      matchedSupplierId: data.supplierId,
      matchedSupplierName: null, // Name not stored in breakdown
    }))
    .sort((a, b) => b.amount - a.amount);
}

// ============================================================================
// ACCOUNT CLASSIFICATION FUNCTIONS
// ============================================================================

/**
 * Account category for B110 accounts
 */
export type AccountCategory = 'supplier' | 'revenue' | 'employee' | 'expense' | 'uncategorized';

/**
 * Hebrew labels for account categories
 */
export const CATEGORY_LABELS: Record<AccountCategory, string> = {
  supplier: 'ספקים',
  revenue: 'הכנסות',
  employee: 'עובדים',
  expense: 'הוצאות',
  uncategorized: 'לא מסווג',
};

/**
 * All category values in display order
 */
export const CATEGORY_ORDER: AccountCategory[] = [
  'uncategorized',
  'supplier',
  'revenue',
  'employee',
  'expense',
];

/**
 * Classified account - extends AllAccountSummary with classification info
 */
export interface ClassifiedAccount extends AllAccountSummary {
  category: AccountCategory;
  classificationSource: 'saved' | 'auto' | 'default';
}

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
    t.includes('ספק') ||           // ספקים, ספקים בישראל
    t.includes('נותני שרות') ||     // נותני שרות אחרים
    t.includes('נותני שירות') ||    // נותני שירותים
    t.includes('שירותים') ||        // שירותים מקצועיים, י שירותים אחרים (truncated)
    t.includes('ירותים')            // truncated שירותים
  ) {
    return 'supplier';
  }

  // COGS (cost of goods sold) - must come BEFORE revenue since "עלות מכירות" contains "מכירות"
  if (t.includes('עלות מכירות')) {
    return 'expense';
  }

  // Revenue patterns
  if (
    t.includes('הכנסות') ||         // הכנסות, הכנסות אחרות, הכנסות מסעדה
    t.includes('מכירות')            // מכירות סחורה
  ) {
    return 'revenue';
  }

  // Employee patterns (BEFORE expense - "הוצאות שכר" should match employee, not expense)
  if (
    t.includes('עובד') ||           // עובדים, עובדים חייבים, בגין עובדים
    t.includes('שכר עבודה') ||      // שכר עבודה, שכר עבודה הנהלה
    t.includes('הוצאות שכר') ||     // הוצאות שכר
    t.includes('שכע') ||            // שכע בעלים, שכע ברמן, שכע מלצר, שכע מטבח, שכע פקידה
    t.includes('לשכר') ||           // ונלוות לשכר (truncated עבודה ונלוות לשכר)
    t.includes('עתודה לפיצוי') ||   // עתודה לפיצויים
    t.includes('עתודות בגין') ||    // עתודות בגין עובדים
    t.includes('דות בגין')          // truncated עתודות בגין
  ) {
    return 'employee';
  }

  // Expense patterns - includes generic "הוצאות" catch-all
  if (
    t.includes('קניות') ||          // קניות, קניות כלים
    t.includes('הוצאות') ||         // הוצאות הנהלה, הוצאות אחזקה, הוצאות מימון, הוצאות הפעלה, הוצאות משרד, הוצאות פרסום
    t.includes('וצאות מימון') ||    // truncated הוצאות מימון
    t.includes('ת הנהלה') ||        // truncated הוצאות הנהלה וכלליות
    t.includes('שכ"ד') ||           // שכ"ד (rent)
    t.includes('שכ\'ד') ||
    t.includes('שכר דירה') ||       // שכר דירה
    t.includes('ביטוח') ||          // ביטוחים, ביטוח עסק
    t.includes('משרדיות') ||        // משרדיות ואחרות (truncated)
    t.includes('תקשורת') ||         // תקשורת ומחשוב
    t.includes('פרסום') ||          // ות פרסום ושיווק (truncated)
    t.includes('מיסים ואגרות') ||   // מיסים ואגרות
    t.includes('ליחויות והובלות')   // ליחויות והובלות (truncated שליחויות)
  ) {
    return 'expense';
  }

  return 'uncategorized';
}

/**
 * Classify all accounts from a BKMV parse result.
 * Merges saved DB classifications (highest priority) with auto-classifications.
 *
 * @param allAccountsSummary - The full accounts summary from buildAllAccountsSummary()
 * @param savedClassifications - Optional saved classifications from DB (Map<accountKey, category>)
 * @returns Map of accountKey → ClassifiedAccount
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
    const autoCategory = autoClassifyAccount(account.accountType);
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
 * Collects all accountSort codes belonging to the target category from classifiedAccounts,
 * then filters supplierSummary entries whose transactions have those sort codes.
 *
 * This is functionally equivalent to filterSuppliersByAccountSort but uses a set of
 * sort codes derived from the classification instead of a single sort code.
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

  // If no sort codes found for this category, return empty
  if (targetSortCodes.size === 0) {
    return new Map();
  }

  // Filter supplier summary by those sort codes
  const filtered = new Map<string, SupplierPurchaseSummary>();
  for (const [key, summary] of supplierSummary.entries()) {
    const hasMatchingSort = summary.transactions.some(
      tx => targetSortCodes.has(tx.accountSort)
    );
    if (hasMatchingSort) {
      filtered.set(key, summary);
    }
  }

  return filtered;
}

/**
 * Get category counts from classified accounts.
 * Returns a Record mapping each category to its account count.
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

// ============================================================================
// REVENUE ACCOUNT FUNCTIONS
// ============================================================================

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
}> {
  return Array.from(revenueSummary.values())
    .map(account => ({
      accountCode: account.accountCode,
      accountName: account.accountName,
      totalAmount: account.totalAmount,
      transactionCount: account.transactionCount,
      isConfirmed: false,
      monthlyBreakdown: account.monthlyBreakdown,
    }))
    .sort((a, b) => Math.abs(b.totalAmount) - Math.abs(a.totalAmount));
}

/**
 * Build summary for ALL B110 accounts (not just revenue-tagged ones).
 * Each account includes: accountCode, accountName, accountType, accountSort,
 * totalAmount (from B100 transactions), transactionCount, monthlyBreakdown.
 *
 * Matches B100 transactions to B110 accounts via two strategies:
 * 1. B100 accountCode (normalized) → B110 accountKey (for numeric-key files)
 * 2. B100 counterpartyName → B110 accountKey (fallback for text-key files)
 *
 * This mirrors the dual-matching approach used by buildRevenueSummary().
 */
export function buildAllAccountsSummary(
  result: BkmvParseResult
): Map<string, AllAccountSummary> {
  const summary = new Map<string, AllAccountSummary>();

  // Build lookup map from B110 accountKey (trimmed) → account info
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

  // Helper to add a transaction to the summary
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

  // Match each B100 transaction to a B110 account
  for (const tx of result.transactions) {
    if (tx.amount === 0) continue;

    // Strategy 1: match B100 accountCode (normalized) → B110 accountKey
    const normalizedCode = tx.accountCode.replace(/^0+/, '') || tx.accountCode;
    let info = accountKeyToInfo.get(normalizedCode);
    if (info) {
      addToSummary(info.accountKey, info, tx);
      continue;
    }

    // Strategy 2: match B100 counterpartyName → B110 accountKey
    const counterparty = tx.counterpartyName.trim();
    info = accountKeyToInfo.get(counterparty);
    if (info) {
      addToSummary(info.accountKey, info, tx);
      continue;
    }

    // Strategy 3: use resolvedAccountKey from parseBkmvData
    // This handles old-format files where counterpartyName was resolved to full name
    // but the original short key (e.g., "NST") is preserved in resolvedAccountKey
    if (tx.resolvedAccountKey) {
      info = accountKeyToInfo.get(tx.resolvedAccountKey);
      if (info) {
        addToSummary(info.accountKey, info, tx);
        continue;
      }
    }

    // Strategy 4: match B100 accountCode WITH leading zeros → B110 accountKey
    // Some files have accountKeys like "00213" that match accountCode exactly
    if (tx.accountCode !== normalizedCode) {
      info = accountKeyToInfo.get(tx.accountCode);
      if (info) {
        addToSummary(info.accountKey, info, tx);
      }
    }
  }

  return summary;
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
 * @param confirmedAccountCodes - Array of account codes to include (or single code for backward compatibility)
 */
export function buildRevenueMonthlyBreakdown(
  revenueSummary: Map<string, RevenueAccountSummary>,
  confirmedAccountCodes?: string[] | string | null
): Record<string, number> {
  const breakdown: Record<string, number> = {};

  // Normalize to Set for efficient lookups
  const confirmedCodes: Set<string> | null = confirmedAccountCodes
    ? new Set(Array.isArray(confirmedAccountCodes) ? confirmedAccountCodes : [confirmedAccountCodes])
    : null;

  for (const [accountCode, account] of revenueSummary) {
    // If confirmed accounts are specified, only use those accounts
    if (confirmedCodes && !confirmedCodes.has(accountCode)) {
      continue;
    }

    for (const [month, amount] of Object.entries(account.monthlyBreakdown)) {
      breakdown[month] = (breakdown[month] || 0) + amount;
    }
  }

  return breakdown;
}
