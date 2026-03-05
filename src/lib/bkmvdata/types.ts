export interface BkmvTransaction {
  lineNumber: number;
  companyId: string;
  accountCode: string;
  documentNumber: string;
  description: string;
  documentDate: Date;
  valueDate: Date;
  counterpartyName: string;
  side: 'debit' | 'credit';
  currency: string;
  amount: number;
  reference: string;
  accountSort: string;
  rawLine: string;
  resolvedAccountKey: string;
}

export interface BkmvAccount {
  companyId: string;
  accountKey: string;
  accountCode: string;
  accountName: string;
  accountDescription: string;
  accountType: string;
  accountSort: string;
  openingBalance: number;
  debitTurnover: number;
  creditTurnover: number;
}

export interface SupplierPurchaseSummary {
  supplierName: string;
  totalAmount: number;
  transactionCount: number;
  transactions: BkmvTransaction[];
}

export interface RevenueAccountSummary {
  accountCode: string;
  accountName: string;
  totalAmount: number;
  transactionCount: number;
  monthlyBreakdown: Record<string, number>;
  b110CreditTurnover?: number;
}

export interface AllAccountSummary {
  accountCode: string;
  accountName: string;
  accountType: string;
  accountSort: string;
  totalAmount: number;
  transactionCount: number;
  monthlyBreakdown: Record<string, number>;
}

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

export interface AccountSortLabel {
  sort: string;
  label: string;
  count: number;
}

export interface MonthlyBreakdownEntry {
  supplierId: string | null;
  supplierName: string;
  amount: number;
  transactionCount: number;
}

export type MonthlyBreakdown = Record<string, MonthlyBreakdownEntry[]>;

export type AccountCategory = 'supplier' | 'revenue' | 'employee' | 'expense' | 'uncategorized';
export type CategoryTab = AccountCategory | 'all' | 'blacklisted';

export interface ClassifiedAccount extends AllAccountSummary {
  category: AccountCategory;
  classificationSource: 'saved' | 'auto' | 'default';
}

// Software type for the classifier
export type BkmvSoftwareType = 'hashavshevet' | 'ravachit' | 'nihul' | 'unknown-d';

// Field position definition
export interface FieldDef {
  start: number;
  length: number;
}
