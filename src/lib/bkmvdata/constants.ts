import type { AccountCategory, CategoryTab, FieldDef } from './types';

export const CATEGORY_LABELS: Record<AccountCategory, string> = {
  supplier: 'ספקים',
  revenue: 'הכנסות',
  employee: 'עובדים',
  expense: 'הוצאות',
  uncategorized: 'לא מסווג',
};

export const CATEGORY_ORDER: AccountCategory[] = [
  'uncategorized',
  'supplier',
  'revenue',
  'employee',
  'expense',
];

export const CATEGORY_TAB_ORDER: CategoryTab[] = [
  'all',
  'uncategorized',
  'supplier',
  'revenue',
  'employee',
  'expense',
  'blacklisted',
];

export const CATEGORY_TAB_LABELS: Record<CategoryTab, string> = {
  all: 'הכל',
  ...CATEGORY_LABELS,
  blacklisted: 'לא רלוונטי',
};

export const B100_FIELDS: Record<string, FieldDef> = {
  RECORD_TYPE: { start: 0, length: 3 },
  LINE_NUMBER: { start: 3, length: 10 },
  COMPANY_ID: { start: 13, length: 9 },
  ACCOUNT_CODE: { start: 27, length: 5 },
  DOC_LINE: { start: 32, length: 5 },
  DOC_NUMBER: { start: 37, length: 8 },
  REFERENCE: { start: 100, length: 6 },
  DESCRIPTION: { start: 106, length: 44 },
  DOC_DATE: { start: 156, length: 8 },
  VALUE_DATE: { start: 164, length: 8 },
  COUNTERPARTY: { start: 172, length: 27 },
  SIDE: { start: 202, length: 1 },
  CURRENCY: { start: 203, length: 3 },
  AMOUNT_SIGN: { start: 206, length: 1 },
  AMOUNT: { start: 207, length: 14 },
};

export const B110_FIELDS: Record<string, FieldDef> = {
  RECORD_TYPE: { start: 0, length: 3 },
  LINE_NUMBER: { start: 3, length: 10 },
  COMPANY_ID: { start: 13, length: 9 },
  ACCOUNT_KEY: { start: 22, length: 15 },
  ACCOUNT_NAME: { start: 37, length: 30 },
  ACCOUNT_DESC: { start: 67, length: 50 },
  ACCOUNT_TYPE: { start: 200, length: 30 },
  OPENING_BALANCE: { start: 277, length: 15 },
  DEBIT_TURNOVER: { start: 292, length: 15 },
  CREDIT_TURNOVER: { start: 307, length: 15 },
};

// Patterns to skip in supplier summary (internal accounts)
export const SUPPLIER_SKIP_PATTERNS = [
  'מעמתש',
  'ניכוי',
  'קופה',
  'דיינרס',
  'ויזה',
  'מזרחי',
  'לאומי',
  'פועלים',
  'אשראי',
];
