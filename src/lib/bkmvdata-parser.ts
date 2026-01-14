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
 * File encoding: ISO-8859-8 (Hebrew)
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
  rawLine: string;           // Original line for debugging
}

/**
 * Parsed B110 account master record
 */
export interface BkmvAccount {
  companyId: string;
  accountKey: string;
  accountName: string;
  accountDescription: string;
  accountType: string;       // e.g., "ספקים" for suppliers
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
 * Complete parse result
 */
export interface BkmvParseResult {
  companyId: string;
  fileVersion: string;
  totalRecords: number;
  transactions: BkmvTransaction[];
  accounts: BkmvAccount[];
  supplierSummary: Map<string, SupplierPurchaseSummary>;
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
      rawLine: line,
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

    return {
      companyId: extractField(line, B110_FIELDS.COMPANY_ID),
      accountKey: extractField(line, B110_FIELDS.ACCOUNT_KEY),
      accountName: extractField(line, B110_FIELDS.ACCOUNT_NAME),
      accountDescription: extractField(line, B110_FIELDS.ACCOUNT_DESC),
      accountType: extractField(line, B110_FIELDS.ACCOUNT_TYPE),
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
 * Decode buffer from ISO-8859-8 to UTF-8
 */
export function decodeBuffer(buffer: Buffer): string {
  // Try iconv-lite if available, otherwise use built-in decoder
  try {
    return iconv.decode(buffer, 'ISO-8859-8');
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

      default: {
        // Unknown record type
        if (line.trim()) {
          result.warnings.push(`Unknown record type at line ${i + 1}: ${recordType}`);
        }
      }
    }
  }

  // Build supplier summary from credit transactions
  // Credit transactions to supplier accounts represent purchases
  buildSupplierSummary(result);

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
    // Also skip zero or negative amounts
    if (tx.side !== 'credit' || tx.amount <= 0) {
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
    if (tx.side !== 'credit' || tx.amount <= 0) continue;

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
