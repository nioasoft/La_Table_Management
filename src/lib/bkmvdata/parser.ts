/**
 * BKMVDATA Parser - core parsing logic
 *
 * This is the main parse function that processes fixed-width BKMVDATA lines
 * into structured BkmvParseResult. It handles all format variations through
 * the unified fallback chain in parseB110Record and resolveCounterparties.
 *
 * The classifier (classifier.ts) identifies the software type BEFORE parsing,
 * but the actual parsing logic remains unified because B100 parsing is identical
 * across all formats, and the B110 fallback chain correctly handles all variants.
 *
 * Future: per-software parsers can override parseB110Record for cleaner logic,
 * but the current unified approach produces correct results (verified by snapshots).
 */

import type {
  BkmvTransaction,
  BkmvAccount,
  BkmvParseResult,
  BkmvSoftwareType,
} from './types';
import { B100_FIELDS, B110_FIELDS } from './constants';

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
  const month = parseInt(dateStr.substring(4, 6), 10) - 1;
  const day = parseInt(dateStr.substring(6, 8), 10);
  return new Date(year, month, day);
}

/**
 * Parse amount from agorot to shekels
 */
function parseAmount(amountStr: string, signStr: string): number {
  const rawAmount = parseInt(amountStr, 10) || 0;
  const amount = rawAmount / 100;
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
      accountSort: '',
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
 * Handles all format variations via fallback chains
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

    // Handle names split across field boundary (pos 37-66 / pos 67-116)
    const combinedNameArea = line.substring(
      B110_FIELDS.ACCOUNT_NAME.start,
      B110_FIELDS.ACCOUNT_DESC.start + B110_FIELDS.ACCOUNT_DESC.length
    ).trim();
    const combinedNameMatch = combinedNameArea.match(/^(.+?)\s{3,}/);
    if (combinedNameMatch && combinedNameMatch[1].trim().length > (accountName?.length || 0)) {
      accountName = combinedNameMatch[1].trim();
    }

    // Strip accounting annotations like *כ.אשראי*
    accountName = accountName.replace(/\s*\*כ\.[^*]*\*/, '').trim();

    // Strip embedded accountKey from name (only for numeric keys)
    if (accountName && accountKey && /^\d+$/.test(accountKey)) {
      accountName = accountName.replace(accountKey, '').trim().replace(/\.+$/, '');
    }

    // Handle short names (1-4 Hebrew chars) caused by field boundary spill
    if (accountName && accountName.length <= 4 && /[א-ת]/.test(accountName)) {
      const withoutKey = combinedNameArea.replace(/0{6,}\d+/, '').trim().replace(/\.+$/, '');
      if (withoutKey.length > accountName.length && !/\s{3,}/.test(withoutKey)) {
        accountName = withoutKey;
      }
    }

    // Fallback: extract name from description when name field is empty/numeric
    if (!accountName || /^[\d\s\-\.]+$/.test(accountName)) {
      const descMatch = accountDescription.match(/^([א-תa-zA-Z][\s\S]*?)(?:\s{3,}|\d{2,}|$)/);
      if (descMatch && descMatch[1]) {
        accountName = descMatch[1].trim();
      }
    }

    // Extract account sort from description - multiple format strategies
    let accountSort = '';

    // Format 1: old format 000000000000XXX
    const match = accountDescription.match(/0{12}(\d{3})/);
    if (match && match[1]) {
      accountSort = match[1];
    }

    // Format 2: trailing sort code after spaces
    if (!accountSort) {
      const sortMatch = accountDescription.match(/\s{3,}(\d{1,4})\s*$/);
      if (sortMatch && sortMatch[1]) {
        accountSort = sortMatch[1];
      }
    }

    // Format 3: sort code between name and type text
    if (!accountSort) {
      const middleMatch = accountDescription.match(/\s+(\d{2,4})\s+[א-ת]/);
      if (middleMatch && middleMatch[1]) {
        accountSort = middleMatch[1];
      }
    }

    // Format 4: digit prefix before Hebrew text
    if (!accountSort) {
      const prefixMatch = accountDescription.match(/^(\d{1,2})([א-ת])/);
      if (prefixMatch) {
        accountSort = prefixMatch[1];
      }
    }

    // Extract account code from key
    const accountCode = accountKey.substring(5, 10).trim();

    // Extract account type - multiple format strategies
    let accountType = extractField(line, B110_FIELDS.ACCOUNT_TYPE);

    const isValidAccountType = accountType && /^[א-ת\s]+$/.test(accountType) && accountType.length >= 2;

    // Try old format: after zeros pattern
    if (!isValidAccountType) {
      const typeMatch = accountDescription.match(/0{12}\d{3}([א-ת\s]+)/);
      if (typeMatch && typeMatch[1]) {
        accountType = typeMatch[1].trim();
      }
    }

    // Try middle format: after sort code in wide text range
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

    // New format: position 117-147
    if (!isValidAccountType && (!accountType || !/^[א-ת\s]+$/.test(accountType))) {
      const newFormatType = line.substring(117, 147).trim();
      if (newFormatType && /^[א-ת\s]+$/.test(newFormatType) && newFormatType.length <= 20) {
        accountType = newFormatType;
      }
    }

    // Prefix format: digit+Hebrew in description
    if (!isValidAccountType && (!accountType || !/^[א-ת\s"']+$/.test(accountType))) {
      const prefixTypeMatch = accountDescription.match(/^\d{1,2}([א-ת].*)/);
      if (prefixTypeMatch && prefixTypeMatch[1].trim().length >= 2) {
        accountType = prefixTypeMatch[1].trim();
      }
    }

    // Final fallback: use cleaned name
    if (!isValidAccountType && (!accountType || accountType.length < 2)) {
      accountType = accountName;
    }

    // Parse balance fields
    let openingBalance = 0;
    let debitTurnover = 0;
    let creditTurnover = 0;
    if (line.length >= 322) {
      const obField = extractField(line, B110_FIELDS.OPENING_BALANCE);
      const dtField = extractField(line, B110_FIELDS.DEBIT_TURNOVER);
      const ctField = extractField(line, B110_FIELDS.CREDIT_TURNOVER);
      if (obField.length > 1) {
        openingBalance = parseAmount(obField.substring(1), obField.charAt(0));
      }
      if (dtField.length > 1) {
        debitTurnover = parseAmount(dtField.substring(1), dtField.charAt(0));
      }
      if (ctField.length > 1) {
        creditTurnover = parseAmount(ctField.substring(1), ctField.charAt(0));
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
      openingBalance,
      debitTurnover,
      creditTurnover,
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

    const companyId = line.substring(13, 22).trim();
    const versionMatch = line.match(/&OF(\d+\.\d+)&/);
    const version = versionMatch ? versionMatch[1] : 'unknown';

    return { companyId, version };
  } catch (error) {
    console.error('Error parsing A100 record:', error);
    return null;
  }
}

/**
 * Parse BKMVDATA text content into structured result.
 * This is the core parse function called by the router after decoding and classification.
 *
 * @param textContent - Decoded text content (already converted from Buffer)
 * @param _softwareType - Classified software type (reserved for future per-software optimizations)
 */
export function parseContent(textContent: string, _softwareType: BkmvSoftwareType): BkmvParseResult {
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
        break;
      }

      case 'C10':
      case 'D11':
      case 'D12': {
        break;
      }

      default: {
        if (line.trim()) {
          result.warnings.push(`Unknown record type at line ${i + 1}: ${recordType}`);
        }
      }
    }
  }

  // Build lookup maps from B110 records
  const accountKeyToSort = new Map<string, string>();
  const accountKeyToName = new Map<string, string>();
  const accountNameToSort = new Map<string, string>();
  const accountNameToKey = new Map<string, string>();
  for (const account of result.accounts) {
    const key = account.accountKey.trim();
    const name = account.accountName.trim();
    if (account.accountSort && key) {
      accountKeyToSort.set(key, account.accountSort);
    }
    if (name && key) {
      accountKeyToName.set(key, name);
    }
    if (name && account.accountSort) {
      accountNameToSort.set(name, account.accountSort);
    }
    if (name && key) {
      accountNameToKey.set(name, key);
    }
  }

  // Resolve counterparty names and account sorts from B110 records
  for (const tx of result.transactions) {
    const counterparty = tx.counterpartyName.trim();

    let accountKey = counterparty;

    // 27-char all-numeric composite key (nihul format)
    if (/^\d{27}$/.test(counterparty)) {
      accountKey = counterparty.substring(0, 15);
    } else {
      const numericMatch = counterparty.match(/^(\d+)/);
      if (numericMatch) {
        accountKey = numericMatch[1];
      }
    }

    tx.accountSort = accountKeyToSort.get(accountKey) || '';
    tx.resolvedAccountKey = accountKeyToName.has(accountKey) ? accountKey : '';

    const resolvedName = accountKeyToName.get(accountKey);
    if (resolvedName) {
      tx.counterpartyName = resolvedName;
    }

    if (!tx.accountSort) {
      tx.accountSort = accountNameToSort.get(counterparty) || '';
    }
    if (!tx.resolvedAccountKey) {
      tx.resolvedAccountKey = accountNameToKey.get(counterparty) || '';
    }
  }

  return result;
}
