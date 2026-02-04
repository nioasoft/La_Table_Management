import {
  pgTable,
  text,
  timestamp,
  boolean,
  index,
  integer,
  decimal,
  pgEnum,
  date,
  jsonb,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

// ============================================================================
// ENUMS
// ============================================================================

export const franchiseeStatusEnum = pgEnum("franchisee_status", [
  "active",
  "inactive",
  "pending",
  "suspended",
  "terminated",
]);

// Franchisee category enum - distinguishes regular franchisees from other income sources
export const franchiseeCategoryEnum = pgEnum("franchisee_category", [
  "regular", // Regular franchisees
  "other", // Other income sources (e.g., Don Pedro)
]);

export const documentStatusEnum = pgEnum("document_status", [
  "draft",
  "active",
  "expired",
  "archived",
]);

export const reminderStatusEnum = pgEnum("reminder_status", [
  "pending",
  "sent",
  "acknowledged",
  "dismissed",
]);

export const reminderTypeEnum = pgEnum("reminder_type", [
  "document_expiry",
  "settlement",
  "commission",
  "custom",
]);

// Franchisee-specific reminder types
export const franchiseeReminderTypeEnum = pgEnum("franchisee_reminder_type", [
  "lease_option",
  "franchise_agreement",
  "custom",
]);

// Important date type enum for franchisee important dates
export const importantDateTypeEnum = pgEnum("important_date_type", [
  "franchise_agreement",
  "rental_contract",
  "lease_option",
  "custom",
]);

// Duration unit enum for important dates
export const durationUnitEnum = pgEnum("duration_unit", ["months", "years"]);

export const uploadLinkStatusEnum = pgEnum("upload_link_status", [
  "active",
  "expired",
  "used",
  "cancelled",
]);

export const settlementStatusEnum = pgEnum("settlement_status", [
  "draft",
  "pending",
  "approved",
  "completed",
  "cancelled",
  // New enhanced statuses for lifecycle management
  "open",
  "processing",
  "pending_approval",
  "invoiced",
]);

// Settlement period type enum for period duration types
export const settlementPeriodTypeEnum = pgEnum("settlement_period_type", [
  "monthly",
  "quarterly",
  "semi_annual",
  "annual",
]);

export const adjustmentTypeEnum = pgEnum("adjustment_type", [
  "credit",
  "debit",
  "refund",
  "penalty",
  "bonus",
  // Manual discrepancy adjustment types (Hebrew names in comments)
  "deposit", // פיקדון
  "supplier_error", // טעות ספק
  "timing", // הפרשי עיתוי
  "other", // אחר - requires description
]);

export const commissionStatusEnum = pgEnum("commission_status", [
  "pending",
  "calculated",
  "approved",
  "paid",
  "cancelled",
]);

export const emailStatusEnum = pgEnum("email_status", [
  "pending",
  "sent",
  "delivered",
  "failed",
  "bounced",
]);

export const fileRequestStatusEnum = pgEnum("file_request_status", [
  "pending", // Created but not sent
  "sent", // Email has been sent
  "in_progress", // Recipient has started uploading
  "submitted", // File(s) have been uploaded
  "expired", // Request has expired
  "cancelled", // Request was cancelled
]);

export const userStatusEnum = pgEnum("user_status", [
  "pending",
  "active",
  "suspended",
]);

export const userRoleEnum = pgEnum("user_role", [
  "super_user",
  "admin",
  "franchisee_owner",
]);

export const contactRoleEnum = pgEnum("contact_role", [
  "owner", // בעלים
  "manager", // מנהל
  "accountant", // מנהל/ת חשבונות
  "chef", // שף
  "staff", // עובד מטה
  "operations", // תפעול
  "marketing", // שיווק
  "other", // אחר
]);

// Uploaded file review status for BKMVDATA automatic processing workflow
export const uploadedFileReviewStatusEnum = pgEnum("uploaded_file_review_status", [
  "pending", // Initial state, not processed yet
  "processing", // Currently being processed
  "auto_approved", // Automatically approved (100% match)
  "needs_review", // Has unmatched or fuzzy matches, requires manual review
  "approved", // Manually approved after review
  "rejected", // Rejected during review
]);

// User role type (defined early for use in permissions)
export type UserRole = (typeof userRoleEnum.enumValues)[number];

// ============================================================================
// MODULE PERMISSIONS TYPES (defined early for use in user table JSONB)
// ============================================================================

// Available permission actions
export type PermissionAction = "view" | "edit" | "create" | "delete" | "approve";

// Available system modules
export type SystemModule =
  | "brands"
  | "suppliers"
  | "franchisees"
  | "documents"
  | "settlements"
  | "commissions"
  | "reminders"
  | "users"
  | "email_templates"
  | "management_companies";

// Permission for a single module
export type ModulePermission = {
  view: boolean;
  edit: boolean;
  create: boolean;
  delete: boolean;
  approve: boolean;
};

// User permissions object (stored as JSONB)
export type UserPermissions = {
  [K in SystemModule]?: ModulePermission;
};

// Default permissions by role
export const DEFAULT_PERMISSIONS: Record<UserRole, UserPermissions> = {
  super_user: {
    brands: { view: true, edit: true, create: true, delete: true, approve: true },
    suppliers: { view: true, edit: true, create: true, delete: true, approve: true },
    franchisees: { view: true, edit: true, create: true, delete: true, approve: true },
    documents: { view: true, edit: true, create: true, delete: true, approve: true },
    settlements: { view: true, edit: true, create: true, delete: true, approve: true },
    commissions: { view: true, edit: true, create: true, delete: true, approve: true },
    reminders: { view: true, edit: true, create: true, delete: true, approve: true },
    users: { view: true, edit: true, create: true, delete: true, approve: true },
    email_templates: { view: true, edit: true, create: true, delete: true, approve: true },
    management_companies: { view: true, edit: true, create: true, delete: true, approve: true },
  },
  admin: {
    brands: { view: true, edit: true, create: true, delete: false, approve: false },
    suppliers: { view: true, edit: true, create: true, delete: false, approve: false },
    franchisees: { view: true, edit: true, create: true, delete: false, approve: false },
    documents: { view: true, edit: true, create: true, delete: false, approve: true },
    settlements: { view: true, edit: true, create: false, delete: false, approve: false },
    commissions: { view: true, edit: true, create: false, delete: false, approve: false },
    reminders: { view: true, edit: true, create: true, delete: true, approve: false },
    users: { view: true, edit: false, create: false, delete: false, approve: false },
    email_templates: { view: true, edit: true, create: true, delete: false, approve: false },
    management_companies: { view: true, edit: true, create: false, delete: false, approve: false },
  },
  franchisee_owner: {
    brands: { view: true, edit: false, create: false, delete: false, approve: false },
    suppliers: { view: true, edit: false, create: false, delete: false, approve: false },
    franchisees: { view: true, edit: false, create: false, delete: false, approve: false },
    documents: { view: true, edit: false, create: false, delete: false, approve: false },
    settlements: { view: true, edit: false, create: false, delete: false, approve: false },
    commissions: { view: true, edit: false, create: false, delete: false, approve: false },
    reminders: { view: true, edit: false, create: true, delete: false, approve: false },
    users: { view: false, edit: false, create: false, delete: false, approve: false },
    email_templates: { view: false, edit: false, create: false, delete: false, approve: false },
    management_companies: { view: true, edit: false, create: false, delete: false, approve: false },
  },
};

// List of all system modules (for iteration)
export const SYSTEM_MODULES: SystemModule[] = [
  "brands",
  "suppliers",
  "franchisees",
  "documents",
  "settlements",
  "commissions",
  "reminders",
  "users",
  "email_templates",
  "management_companies",
];

// List of all permission actions (for iteration)
export const PERMISSION_ACTIONS: PermissionAction[] = [
  "view",
  "edit",
  "create",
  "delete",
  "approve",
];

// User table - Core user information for authentication
export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  // Optional email for notifications (uses email if null)
  notificationEmail: text("notification_email"),
  emailVerified: boolean("email_verified")
    .$defaultFn(() => false)
    .notNull(),
  image: text("image"),
  isAdmin: boolean("is_admin")
    .$default(() => false)
    .notNull(),
  // User role (super_user, admin, franchisee_owner)
  role: userRoleEnum("role"),
  // User account status (pending, active, suspended)
  status: userStatusEnum("status")
    .$default(() => "pending")
    .notNull(),
  // Who approved this user and when
  approvedBy: text("approved_by"),
  approvedAt: timestamp("approved_at"),
  // Module-level granular permissions stored as JSONB
  permissions: jsonb("permissions").$type<UserPermissions>(),
  // Subscription fields
  stripeCustomerId: text("stripe_customer_id"),
  subscriptionId: text("subscription_id"),
  plan: text("plan")
    .$default(() => "free")
    .notNull(),
  subscriptionStatus: text("subscription_status"),
  subscriptionExpiresAt: timestamp("subscription_expires_at"),
  createdAt: timestamp("created_at")
    .$defaultFn(() => /* @__PURE__ */ new Date())
    .notNull(),
  updatedAt: timestamp("updated_at")
    .$defaultFn(() => /* @__PURE__ */ new Date())
    .notNull(),
});

// Session table - Better Auth session management
export const session = pgTable("session", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expires_at").notNull(),
  token: text("token").notNull().unique(),
  createdAt: timestamp("created_at").notNull(),
  updatedAt: timestamp("updated_at").notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
});

// Account table - Better Auth OAuth provider accounts
export const account = pgTable("account", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at"),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("created_at").notNull(),
  updatedAt: timestamp("updated_at").notNull(),
});

// Verification table - Better Auth email verification
export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").$defaultFn(
    () => /* @__PURE__ */ new Date()
  ),
  updatedAt: timestamp("updated_at").$defaultFn(
    () => /* @__PURE__ */ new Date()
  ),
});

// User Profile - Extended profile information
export const userProfile = pgTable(
  "user_profile",
  {
    id: text("id")
      .primaryKey()
      .references(() => user.id, { onDelete: "cascade" }),
    bio: text("bio"),
    updatedAt: timestamp("updated_at")
      .$defaultFn(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [index("idx_user_profile_id").on(table.id)]
);

// Relations
export const userRelations = relations(user, ({ one }) => ({
  profile: one(userProfile, {
    fields: [user.id],
    references: [userProfile.id],
  }),
}));

export const userProfileRelations = relations(userProfile, ({ one }) => ({
  user: one(user, {
    fields: [userProfile.id],
    references: [user.id],
  }),
}));

// Type exports
export type User = typeof user.$inferSelect;
export type CreateUserData = typeof user.$inferInsert;
export type UpdateUserData = Partial<Omit<CreateUserData, "id" | "createdAt">>;

export type UserProfile = typeof userProfile.$inferSelect;
export type CreateUserProfileData = typeof userProfile.$inferInsert;
export type UpdateUserProfileData = Partial<Omit<CreateUserProfileData, "id">>;

// User status type
export type UserStatus = (typeof userStatusEnum.enumValues)[number];

// Subscription types
export type SubscriptionPlan = "free" | "basic" | "pro";
export type SubscriptionStatus =
  | "active"
  | "canceled"
  | "past_due"
  | "unpaid"
  | "incomplete"
  | "incomplete_expired"
  | "trialing"
  | null;

// ============================================================================
// CORE BUSINESS TABLES
// ============================================================================

// ============================================================================
// MANAGEMENT COMPANIES TABLE
// ============================================================================

// Management Companies table - Tracks invoice-issuing companies
// Companies: פנקון (Panikon), פדווילי (Pedvili), ונתמי (Ventami)
export const managementCompany = pgTable(
  "management_company",
  {
    id: text("id").primaryKey(),
    code: text("code").notNull().unique(), // Short code (e.g., PANIKON, PEDVILI, VENTAMI)
    nameHe: text("name_he").notNull(), // Hebrew name (פנקון, פדווילי, ונתמי)
    nameEn: text("name_en"), // English name (optional)
    description: text("description"),
    // Contact information
    contactName: text("contact_name"),
    contactEmail: text("contact_email"),
    contactPhone: text("contact_phone"),
    // Company registration
    companyId: text("company_id"), // Registration/Tax ID (ח.פ.)
    address: text("address"),
    taxId: text("tax_id"), // מספר עוסק מורשה
    // Invoice settings
    invoicePrefix: text("invoice_prefix"), // Prefix for invoice numbers (e.g., "PNK-", "PDV-")
    nextInvoiceNumber: integer("next_invoice_number")
      .$default(() => 1)
      .notNull(),
    // Bank details for payments
    bankName: text("bank_name"),
    bankBranch: text("bank_branch"),
    bankAccountNumber: text("bank_account_number"),
    // Status
    isActive: boolean("is_active")
      .$default(() => true)
      .notNull(),
    // Audit fields
    createdAt: timestamp("created_at")
      .$defaultFn(() => new Date())
      .notNull(),
    updatedAt: timestamp("updated_at")
      .$defaultFn(() => new Date())
      .notNull(),
    createdBy: text("created_by").references(() => user.id, {
      onDelete: "set null",
    }),
  },
  (table) => [
    index("idx_management_company_code").on(table.code),
    index("idx_management_company_is_active").on(table.isActive),
  ]
);

// Brands table - Franchise brands managed in the system
// Supports Pat Vini, Mina Tomai, and King Kong brands
export const brand = pgTable(
  "brand",
  {
    id: text("id").primaryKey(),
    code: text("code").notNull().unique(),
    nameHe: text("name_he").notNull(), // Hebrew name (primary for RTL)
    nameEn: text("name_en"), // English name (optional)
    description: text("description"),
    logoUrl: text("logo_url"),
    website: text("website"),
    contactEmail: text("contact_email"),
    contactPhone: text("contact_phone"),
    address: text("address"),
    isActive: boolean("is_active")
      .$default(() => true)
      .notNull(),
    // System brands are hidden from regular UI (e.g., "שונות" for other income)
    isSystemBrand: boolean("is_system_brand")
      .$default(() => false)
      .notNull(),
    createdAt: timestamp("created_at")
      .$defaultFn(() => new Date())
      .notNull(),
    updatedAt: timestamp("updated_at")
      .$defaultFn(() => new Date())
      .notNull(),
    createdBy: text("created_by").references(() => user.id, {
      onDelete: "set null",
    }),
  },
  (table) => [
    index("idx_brand_code").on(table.code),
    index("idx_brand_is_active").on(table.isActive),
    index("idx_brand_is_system_brand").on(table.isSystemBrand),
  ]
);

// Commission type enum
export const commissionTypeEnum = pgEnum("commission_type", [
  "percentage",
  "per_item",
]);

// Settlement frequency enum
export const settlementFrequencyEnum = pgEnum("settlement_frequency", [
  "weekly",
  "bi_weekly",
  "monthly",
  "quarterly",
  "semi_annual",
  "annual",
]);

// Commission exception type for item-level commission overrides
export type CommissionException = {
  identifier: string; // Keyword or SKU to match in supplier reports
  rate: number; // Commission rate (0-100) for this item
  matchType: "keyword" | "sku"; // How to match (keyword matches anywhere, sku exact match)
  notes?: string; // Optional notes
};

// Suppliers table - Suppliers that provide goods/services
export const supplier = pgTable(
  "supplier",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    code: text("code").notNull().unique(),
    companyId: text("company_id"), // Company registration ID
    description: text("description"),
    // Primary contact
    contactName: text("contact_name"),
    contactEmail: text("contact_email"),
    contactPhone: text("contact_phone"),
    // Secondary contact
    secondaryContactName: text("secondary_contact_name"),
    secondaryContactEmail: text("secondary_contact_email"),
    secondaryContactPhone: text("secondary_contact_phone"),
    address: text("address"),
    taxId: text("tax_id"),
    paymentTerms: text("payment_terms"),
    // Commission settings
    defaultCommissionRate: decimal("default_commission_rate", {
      precision: 5,
      scale: 2,
    }),
    commissionType: commissionTypeEnum("commission_type").$default(() => "percentage"),
    // Settlement settings
    settlementFrequency: settlementFrequencyEnum("settlement_frequency").$default(() => "monthly"),
    vatIncluded: boolean("vat_included").$default(() => false),
    // File mapping configuration for parsing supplier reports
    fileMapping: jsonb("file_mapping").$type<SupplierFileMapping>(),
    // Commission exceptions for item-level rate overrides
    // e.g., "פיקדון" at 0%, "קפסולות" at 8%
    commissionExceptions: jsonb("commission_exceptions").$type<CommissionException[]>(),
    // BKMV aliases - alternative names as they appear in franchisee unified reports (מבנה אחיד)
    // Used for matching supplier names from BKMVDATA files to this supplier
    bkmvAliases: jsonb("bkmv_aliases").$type<string[]>(),
    // Hashavshevet code - supplier's code in the Hashavshevet accounting system
    // Used for exporting commission data for import into Hashavshevet
    hashavshevetCode: text("hashavshevet_code"),
    isActive: boolean("is_active")
      .$default(() => true)
      .notNull(),
    // Hidden suppliers are excluded from commission reports but preserved in database
    // Used for irrelevant suppliers like pest control, insurance, payment processing
    isHidden: boolean("is_hidden")
      .$default(() => false)
      .notNull(),
    createdAt: timestamp("created_at")
      .$defaultFn(() => new Date())
      .notNull(),
    updatedAt: timestamp("updated_at")
      .$defaultFn(() => new Date())
      .notNull(),
    createdBy: text("created_by").references(() => user.id, {
      onDelete: "set null",
    }),
  },
  (table) => [
    index("idx_supplier_code").on(table.code),
    index("idx_supplier_is_active").on(table.isActive),
    index("idx_supplier_is_hidden").on(table.isHidden),
  ]
);

// Supplier-Brand junction table for many-to-many relationship
export const supplierBrand = pgTable(
  "supplier_brand",
  {
    id: text("id").primaryKey(),
    supplierId: text("supplier_id")
      .notNull()
      .references(() => supplier.id, { onDelete: "cascade" }),
    brandId: text("brand_id")
      .notNull()
      .references(() => brand.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at")
      .$defaultFn(() => new Date())
      .notNull(),
  },
  (table) => [
    index("idx_supplier_brand_supplier").on(table.supplierId),
    index("idx_supplier_brand_brand").on(table.brandId),
    uniqueIndex("idx_supplier_brand_unique").on(table.supplierId, table.brandId),
  ]
);

// Owner type for franchisee owners array
export type FranchiseeOwner = {
  name: string;
  phone: string;
  email: string;
  ownershipPercentage: number;
};

// ============================================================================
// SUPPLIER FILE MAPPING TYPES
// ============================================================================

// Column mapping configuration for supplier files
export type ColumnMapping = {
  franchiseeColumn: string; // Column identifier (e.g., "A", "B", "column_name")
  amountColumn: string; // Column identifier for amount
  dateColumn: string; // Column identifier for date
};

// File type enum for supplier file mapping
export type SupplierFileType = "xlsx" | "csv" | "xls" | "zip";

// Complete file mapping configuration stored as JSONB
export type SupplierFileMapping = {
  fileType: SupplierFileType;
  columnMappings: ColumnMapping;
  headerRow: number; // Row number where headers are located (1-indexed)
  dataStartRow: number; // Row number where data starts (1-indexed)
  rowsToSkip?: number; // Optional: number of rows to skip at the end
  skipKeywords?: string[]; // Keywords to skip rows (e.g., 'פיקדון', 'deposit')
  sheetName?: string; // Optional: specific sheet name to read
  customParser?: boolean; // If true, use custom parser from custom-parsers module
};

// Franchisees table - Franchise operators/owners
export const franchisee = pgTable(
  "franchisee",
  {
    id: text("id").primaryKey(),
    brandId: text("brand_id")
      .notNull()
      .references(() => brand.id, { onDelete: "restrict" }),
    // Management company that issues invoices for this franchisee
    managementCompanyId: text("management_company_id").references(
      () => managementCompany.id,
      { onDelete: "set null" }
    ),
    // Category: 'regular' for actual franchisees, 'other' for other income sources (e.g., Don Pedro)
    category: franchiseeCategoryEnum("category")
      .$default(() => "regular")
      .notNull(),
    name: text("name").notNull(),
    code: text("code").notNull().unique(),
    // New fields
    aliases: jsonb("aliases").$type<string[]>(), // Array of alternative names
    companyId: text("company_id"), // Company registration ID
    // Address fields
    address: text("address"),
    city: text("city"),
    state: text("state"),
    postalCode: text("postal_code"),
    country: text("country"),
    // Primary contact
    primaryContactName: text("primary_contact_name"),
    primaryContactEmail: text("primary_contact_email"),
    primaryContactPhone: text("primary_contact_phone"),
    // Owners array (name, phone, email, ownership %)
    owners: jsonb("owners").$type<FranchiseeOwner[]>(),
    // Legacy owner fields (kept for backward compatibility)
    ownerName: text("owner_name"),
    contactEmail: text("contact_email"),
    contactPhone: text("contact_phone"),
    // Important dates
    openingDate: date("opening_date"),
    leaseOption1End: date("lease_option_1_end"),
    leaseOption2End: date("lease_option_2_end"),
    leaseOption3End: date("lease_option_3_end"),
    franchiseAgreementEnd: date("franchise_agreement_end"),
    // Legacy agreement dates (kept for backward compatibility)
    agreementStartDate: date("agreement_start_date"),
    agreementEndDate: date("agreement_end_date"),
    // Financial
    royaltyRate: decimal("royalty_rate", { precision: 5, scale: 2 }),
    marketingFeeRate: decimal("marketing_fee_rate", { precision: 5, scale: 2 }),
    // Status and notes
    status: franchiseeStatusEnum("status")
      .$default(() => "pending")
      .notNull(),
    notes: text("notes"),
    // Hashavshevet item key - used in export for "מפתח פריט" column
    hashavshevetItemKey: text("hashavshevet_item_key"),
    isActive: boolean("is_active")
      .$default(() => true)
      .notNull(),
    createdAt: timestamp("created_at")
      .$defaultFn(() => new Date())
      .notNull(),
    updatedAt: timestamp("updated_at")
      .$defaultFn(() => new Date())
      .notNull(),
    createdBy: text("created_by").references(() => user.id, {
      onDelete: "set null",
    }),
  },
  (table) => [
    index("idx_franchisee_brand_id").on(table.brandId),
    index("idx_franchisee_management_company_id").on(table.managementCompanyId),
    index("idx_franchisee_code").on(table.code),
    index("idx_franchisee_status").on(table.status),
    index("idx_franchisee_is_active").on(table.isActive),
    index("idx_franchisee_category").on(table.category),
    // Composite index for brand-based report queries with active filter
    index("idx_franchisee_brand_active").on(table.brandId, table.isActive),
    // Composite index for filtering regular franchisees
    index("idx_franchisee_category_active").on(table.category, table.isActive),
  ]
);

// Documents table - Legal and business documents
export const document = pgTable(
  "document",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    description: text("description"),
    documentType: text("document_type").notNull(),
    status: documentStatusEnum("status")
      .$default(() => "draft")
      .notNull(),
    // Polymorphic association
    entityType: text("entity_type").notNull(), // 'brand', 'supplier', 'franchisee'
    entityId: text("entity_id").notNull(),
    fileUrl: text("file_url"),
    fileName: text("file_name"),
    fileSize: integer("file_size"),
    mimeType: text("mime_type"),
    version: integer("version")
      .$default(() => 1)
      .notNull(),
    effectiveDate: date("effective_date"),
    expirationDate: date("expiration_date"),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at")
      .$defaultFn(() => new Date())
      .notNull(),
    updatedAt: timestamp("updated_at")
      .$defaultFn(() => new Date())
      .notNull(),
    createdBy: text("created_by").references(() => user.id, {
      onDelete: "set null",
    }),
  },
  (table) => [
    index("idx_document_entity").on(table.entityType, table.entityId),
    index("idx_document_status").on(table.status),
    index("idx_document_type").on(table.documentType),
    index("idx_document_expiration").on(table.expirationDate),
  ]
);

// Reminders table - Scheduled reminders and notifications
export const reminder = pgTable(
  "reminder",
  {
    id: text("id").primaryKey(),
    title: text("title").notNull(),
    description: text("description"),
    reminderType: reminderTypeEnum("reminder_type").notNull(),
    status: reminderStatusEnum("status")
      .$default(() => "pending")
      .notNull(),
    dueDate: timestamp("due_date").notNull(),
    remindAt: timestamp("remind_at").notNull(),
    // Polymorphic association
    entityType: text("entity_type"), // 'document', 'settlement', 'commission', etc.
    entityId: text("entity_id"),
    assignedTo: text("assigned_to").references(() => user.id, {
      onDelete: "set null",
    }),
    acknowledgedAt: timestamp("acknowledged_at"),
    acknowledgedBy: text("acknowledged_by").references(() => user.id, {
      onDelete: "set null",
    }),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at")
      .$defaultFn(() => new Date())
      .notNull(),
    updatedAt: timestamp("updated_at")
      .$defaultFn(() => new Date())
      .notNull(),
    createdBy: text("created_by").references(() => user.id, {
      onDelete: "set null",
    }),
  },
  (table) => [
    index("idx_reminder_status").on(table.status),
    index("idx_reminder_due_date").on(table.dueDate),
    index("idx_reminder_remind_at").on(table.remindAt),
    index("idx_reminder_assigned_to").on(table.assignedTo),
    index("idx_reminder_entity").on(table.entityType, table.entityId),
  ]
);

// Franchisee Reminders table - Reminders specific to franchisees
// Types: lease_option, franchise_agreement, custom
// Tracks status: pending, sent, dismissed
export const franchiseeReminder = pgTable(
  "franchisee_reminder",
  {
    id: text("id").primaryKey(),
    franchiseeId: text("franchisee_id")
      .notNull()
      .references(() => franchisee.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description"),
    reminderType: franchiseeReminderTypeEnum("reminder_type").notNull(),
    status: reminderStatusEnum("status")
      .$default(() => "pending")
      .notNull(),
    // The date that this reminder is for (e.g., lease expiration date)
    reminderDate: date("reminder_date").notNull(),
    // Days before the reminder date to send notification
    daysBeforeNotification: integer("days_before_notification")
      .$default(() => 30)
      .notNull(),
    // Recipients - array of email addresses
    recipients: jsonb("recipients").$type<string[]>().notNull(),
    // When the notification should be sent (calculated from reminderDate - daysBeforeNotification)
    notificationDate: date("notification_date").notNull(),
    // When the reminder was actually sent
    sentAt: timestamp("sent_at"),
    // When the reminder was dismissed
    dismissedAt: timestamp("dismissed_at"),
    dismissedBy: text("dismissed_by").references(() => user.id, {
      onDelete: "set null",
    }),
    // Additional metadata
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at")
      .$defaultFn(() => new Date())
      .notNull(),
    updatedAt: timestamp("updated_at")
      .$defaultFn(() => new Date())
      .notNull(),
    createdBy: text("created_by").references(() => user.id, {
      onDelete: "set null",
    }),
  },
  (table) => [
    index("idx_franchisee_reminder_franchisee").on(table.franchiseeId),
    index("idx_franchisee_reminder_type").on(table.reminderType),
    index("idx_franchisee_reminder_status").on(table.status),
    index("idx_franchisee_reminder_date").on(table.reminderDate),
    index("idx_franchisee_reminder_notification_date").on(table.notificationDate),
  ]
);

// Franchisee Important Dates table - Track important dates like franchise agreements, rental contracts
// Each entry has a start date + duration → auto-calculated end date, with reminder configuration
export const franchiseeImportantDate = pgTable(
  "franchisee_important_date",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    franchiseeId: text("franchisee_id")
      .notNull()
      .references(() => franchisee.id, { onDelete: "cascade" }),

    // Date type
    dateType: importantDateTypeEnum("date_type").notNull(),
    customTypeName: text("custom_type_name"), // Only for 'custom' type

    // Date configuration
    startDate: date("start_date").notNull(),
    durationMonths: integer("duration_months").notNull(),
    displayUnit: durationUnitEnum("display_unit").default("months").notNull(),
    endDate: date("end_date").notNull(), // Calculated: startDate + durationMonths

    // Reminder configuration
    reminderMonthsBefore: integer("reminder_months_before").default(3).notNull(),
    reminderDate: date("reminder_date").notNull(), // Calculated: endDate - reminderMonthsBefore

    // Optional
    description: text("description"),
    notes: text("notes"),
    isActive: boolean("is_active").default(true).notNull(),

    // Audit
    createdAt: timestamp("created_at")
      .$defaultFn(() => new Date())
      .notNull(),
    updatedAt: timestamp("updated_at")
      .$defaultFn(() => new Date())
      .notNull(),
    createdBy: text("created_by").references(() => user.id, {
      onDelete: "set null",
    }),
  },
  (table) => [
    index("idx_franchisee_important_date_franchisee").on(table.franchiseeId),
    index("idx_franchisee_important_date_type").on(table.dateType),
    index("idx_franchisee_important_date_end_date").on(table.endDate),
    index("idx_franchisee_important_date_reminder_date").on(table.reminderDate),
    index("idx_franchisee_important_date_is_active").on(table.isActive),
  ]
);

// Upload Links table - Secure links for external document uploads
export const uploadLink = pgTable(
  "upload_link",
  {
    id: text("id").primaryKey(),
    token: text("token").notNull().unique(),
    name: text("name").notNull(),
    description: text("description"),
    status: uploadLinkStatusEnum("status")
      .$default(() => "active")
      .notNull(),
    // Target entity for the upload
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    allowedFileTypes: text("allowed_file_types"), // Comma-separated MIME types
    maxFileSize: integer("max_file_size"), // In bytes
    maxFiles: integer("max_files")
      .$default(() => 1)
      .notNull(),
    expiresAt: timestamp("expires_at"),
    usedAt: timestamp("used_at"),
    usedByEmail: text("used_by_email"),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at")
      .$defaultFn(() => new Date())
      .notNull(),
    updatedAt: timestamp("updated_at")
      .$defaultFn(() => new Date())
      .notNull(),
    createdBy: text("created_by").references(() => user.id, {
      onDelete: "set null",
    }),
  },
  (table) => [
    uniqueIndex("idx_upload_link_token").on(table.token),
    index("idx_upload_link_status").on(table.status),
    index("idx_upload_link_entity").on(table.entityType, table.entityId),
    index("idx_upload_link_expires_at").on(table.expiresAt),
  ]
);

// Uploaded Files table - Files uploaded through upload links or admin uploads
export const uploadedFile = pgTable(
  "uploaded_file",
  {
    id: text("id").primaryKey(),
    // uploadLinkId is nullable for admin uploads
    uploadLinkId: text("upload_link_id")
      .references(() => uploadLink.id, { onDelete: "cascade" }),
    fileName: text("file_name").notNull(),
    originalFileName: text("original_file_name").notNull(),
    fileUrl: text("file_url").notNull(),
    fileSize: integer("file_size").notNull(),
    mimeType: text("mime_type").notNull(),
    checksum: text("checksum"),
    uploadedByEmail: text("uploaded_by_email"),
    uploadedByIp: text("uploaded_by_ip"),
    metadata: jsonb("metadata"),
    // BKMVDATA processing fields
    processingStatus: uploadedFileReviewStatusEnum("processing_status").$default(() => "pending"),
    reviewedBy: text("reviewed_by").references(() => user.id, { onDelete: "set null" }),
    reviewedAt: timestamp("reviewed_at"),
    reviewNotes: text("review_notes"),
    bkmvProcessingResult: jsonb("bkmv_processing_result").$type<BkmvProcessingResult>(),
    // Direct franchisee reference for admin uploads (bypasses uploadLink)
    franchiseeId: text("franchisee_id").references(() => franchisee.id, { onDelete: "set null" }),
    // Period dates for organizing BKMVDATA history
    periodStartDate: date("period_start_date"),
    periodEndDate: date("period_end_date"),
    createdAt: timestamp("created_at")
      .$defaultFn(() => new Date())
      .notNull(),
  },
  (table) => [
    index("idx_uploaded_file_upload_link").on(table.uploadLinkId),
    index("idx_uploaded_file_created_at").on(table.createdAt),
    index("idx_uploaded_file_processing_status").on(table.processingStatus),
    index("idx_uploaded_file_franchisee").on(table.franchiseeId),
    index("idx_uploaded_file_period").on(table.periodStartDate, table.periodEndDate),
  ]
);

// BKMV Blacklist table - Names to exclude from supplier matching
// These are names that appear in BKMVDATA files but are not actual suppliers
// (e.g., "ביגי", "מור מזון" - internal accounts or irrelevant entries)
export const bkmvBlacklist = pgTable(
  "bkmv_blacklist",
  {
    id: text("id").primaryKey(),
    // Original name as it appears in the BKMVDATA file
    name: text("name").notNull(),
    // Normalized name for matching (lowercase, trimmed, etc.)
    normalizedName: text("normalized_name").notNull(),
    // Who added this to the blacklist
    createdBy: text("created_by").references(() => user.id, {
      onDelete: "set null",
    }),
    // Optional notes explaining why this was blacklisted
    notes: text("notes"),
    // Timestamps
    createdAt: timestamp("created_at")
      .$defaultFn(() => new Date())
      .notNull(),
  },
  (table) => [
    index("idx_bkmv_blacklist_normalized_name").on(table.normalizedName),
    uniqueIndex("idx_bkmv_blacklist_name_unique").on(table.normalizedName),
  ]
);

// BKMV Blacklist relations
export const bkmvBlacklistRelations = relations(bkmvBlacklist, ({ one }) => ({
  createdByUser: one(user, {
    fields: [bkmvBlacklist.createdBy],
    references: [user.id],
  }),
}));

// BKMV Blacklist types
export type BkmvBlacklist = typeof bkmvBlacklist.$inferSelect;
export type CreateBkmvBlacklistData = typeof bkmvBlacklist.$inferInsert;

// ============================================================================
// SUPPLIER FILE PROCESSING RESULT TYPE
// ============================================================================

// Type for supplier file processing result stored in JSONB
export interface SupplierFileProcessingResult {
  totalRows: number;
  processedRows: number;
  skippedRows: number;
  totalGrossAmount: number;
  totalNetAmount: number;
  vatAdjusted: boolean;

  matchStats: {
    total: number;
    exactMatches: number;
    fuzzyMatches: number;
    unmatched: number;
  };

  franchiseeMatches: Array<{
    originalName: string;
    rowNumber: number;
    grossAmount: number;
    netAmount: number;
    matchedFranchiseeId: string | null;
    matchedFranchiseeName: string | null;
    confidence: number;
    matchType: "exact" | "fuzzy" | "manual" | "blacklisted" | "none";
    requiresReview: boolean;
    preCalculatedCommission?: number;
  }>;

  processedAt: string;
}

// ============================================================================
// SUPPLIER FILE UPLOAD TABLE
// ============================================================================

// Supplier file upload table - Tracks supplier file uploads for review queue
export const supplierFileUpload = pgTable(
  "supplier_file_upload",
  {
    id: text("id").primaryKey(),
    supplierId: text("supplier_id")
      .notNull()
      .references(() => supplier.id, { onDelete: "restrict" }),
    originalFileName: text("original_file_name").notNull(),
    fileUrl: text("file_url"),
    fileSize: integer("file_size"),
    filePath: text("file_path"),

    // Processing
    processingStatus: uploadedFileReviewStatusEnum("processing_status")
      .$default(() => "pending")
      .notNull(),
    processingResult: jsonb("processing_result").$type<SupplierFileProcessingResult>(),

    // Review
    reviewedBy: text("reviewed_by").references(() => user.id, { onDelete: "set null" }),
    reviewedAt: timestamp("reviewed_at"),
    reviewNotes: text("review_notes"),

    // Period
    periodStartDate: date("period_start_date"),
    periodEndDate: date("period_end_date"),

    // Timestamps
    createdAt: timestamp("created_at").$defaultFn(() => new Date()).notNull(),
    updatedAt: timestamp("updated_at").$defaultFn(() => new Date()).notNull(),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
  },
  (table) => [
    index("idx_supplier_file_upload_supplier").on(table.supplierId),
    index("idx_supplier_file_upload_status").on(table.processingStatus),
    index("idx_supplier_file_upload_created").on(table.createdAt),
  ]
);

// Supplier File Upload relations
export const supplierFileUploadRelations = relations(supplierFileUpload, ({ one }) => ({
  supplier: one(supplier, {
    fields: [supplierFileUpload.supplierId],
    references: [supplier.id],
  }),
  reviewedByUser: one(user, {
    fields: [supplierFileUpload.reviewedBy],
    references: [user.id],
    relationName: "reviewedSupplierFiles",
  }),
  createdByUser: one(user, {
    fields: [supplierFileUpload.createdBy],
    references: [user.id],
    relationName: "createdSupplierFiles",
  }),
}));

// Supplier File Upload types
export type SupplierFileUpload = typeof supplierFileUpload.$inferSelect;
export type CreateSupplierFileUploadData = typeof supplierFileUpload.$inferInsert;
export type UpdateSupplierFileUploadData = Partial<
  Omit<CreateSupplierFileUploadData, "id" | "createdAt">
>;

// ============================================================================
// SUPPLIER FILE BLACKLIST TABLE
// ============================================================================

// Blacklist for irrelevant franchisee names in supplier files
// These are names that appear in supplier files but are not actual franchisees
// (e.g., "סה״כ", "total", "summary" - summary rows or irrelevant entries)
export const supplierFileBlacklist = pgTable(
  "supplier_file_blacklist",
  {
    id: text("id").primaryKey(),
    // Original name as it appears in the supplier file
    name: text("name").notNull(),
    // Normalized name for matching (lowercase, trimmed, etc.)
    normalizedName: text("normalized_name").notNull().unique(),
    // Optional: specific to a supplier (null means applies to all suppliers)
    supplierId: text("supplier_id").references(() => supplier.id, { onDelete: "cascade" }),
    // Optional notes explaining why this was blacklisted
    notes: text("notes"),
    // Who added this to the blacklist
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    // Timestamps
    createdAt: timestamp("created_at").$defaultFn(() => new Date()).notNull(),
  },
  (table) => [
    index("idx_supplier_file_blacklist_normalized").on(table.normalizedName),
    index("idx_supplier_file_blacklist_supplier").on(table.supplierId),
  ]
);

// Supplier File Blacklist relations
export const supplierFileBlacklistRelations = relations(supplierFileBlacklist, ({ one }) => ({
  supplier: one(supplier, {
    fields: [supplierFileBlacklist.supplierId],
    references: [supplier.id],
  }),
  createdByUser: one(user, {
    fields: [supplierFileBlacklist.createdBy],
    references: [user.id],
  }),
}));

// Supplier File Blacklist types
export type SupplierFileBlacklist = typeof supplierFileBlacklist.$inferSelect;
export type CreateSupplierFileBlacklistData = typeof supplierFileBlacklist.$inferInsert;

// Type for BKMV processing result stored in JSONB
export type BkmvProcessingResult = {
  /** Company ID from the file */
  companyId: string | null;
  /** File version */
  fileVersion: string;
  /** Total records parsed */
  totalRecords: number;
  /** Date range in the file */
  dateRange: { startDate: string; endDate: string } | null;
  /** Match statistics */
  matchStats: {
    total: number;
    exactMatches: number;
    fuzzyMatches: number;
    unmatched: number;
  };
  /** Matched franchisee ID if detected */
  matchedFranchiseeId: string | null;
  /** Supplier matching results (cumulative totals) */
  supplierMatches: Array<{
    bkmvName: string;
    amount: number;
    transactionCount: number;
    matchedSupplierId: string | null;
    matchedSupplierName: string | null;
    confidence: number;
    matchType: string;
    requiresReview: boolean;
  }>;
  /** Monthly breakdown per supplier - for precise period matching */
  monthlyBreakdown?: Record<string, Array<{
    supplierId: string | null;
    supplierName: string;
    amount: number;
    transactionCount: number;
  }>>;
  /** Timestamp of processing */
  processedAt: string;
};

// Settlement Periods table - Financial settlement periods
export const settlementPeriod = pgTable(
  "settlement_period",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    // Optional: null for period-based settlements, set for per-franchisee settlements
    franchiseeId: text("franchisee_id")
      .references(() => franchisee.id, { onDelete: "restrict" }),
    // Period type: monthly, quarterly, semi_annual, annual
    periodType: settlementPeriodTypeEnum("period_type")
      .$default(() => "monthly")
      .notNull(),
    periodStartDate: date("period_start_date").notNull(),
    periodEndDate: date("period_end_date").notNull(),
    status: settlementStatusEnum("status")
      .$default(() => "open")
      .notNull(),
    grossSales: decimal("gross_sales", { precision: 12, scale: 2 }),
    netSales: decimal("net_sales", { precision: 12, scale: 2 }),
    royaltyAmount: decimal("royalty_amount", { precision: 12, scale: 2 }),
    marketingFeeAmount: decimal("marketing_fee_amount", {
      precision: 12,
      scale: 2,
    }),
    totalDeductions: decimal("total_deductions", { precision: 12, scale: 2 }),
    totalAdjustments: decimal("total_adjustments", { precision: 12, scale: 2 }),
    netPayable: decimal("net_payable", { precision: 12, scale: 2 }),
    dueDate: date("due_date"),
    paidDate: date("paid_date"),
    notes: text("notes"),
    metadata: jsonb("metadata"),
    approvedAt: timestamp("approved_at"),
    approvedBy: text("approved_by").references(() => user.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at")
      .$defaultFn(() => new Date())
      .notNull(),
    updatedAt: timestamp("updated_at")
      .$defaultFn(() => new Date())
      .notNull(),
    createdBy: text("created_by").references(() => user.id, {
      onDelete: "set null",
    }),
  },
  (table) => [
    index("idx_settlement_franchisee").on(table.franchiseeId),
    index("idx_settlement_status").on(table.status),
    index("idx_settlement_period_type").on(table.periodType),
    index("idx_settlement_period_dates").on(
      table.periodStartDate,
      table.periodEndDate
    ),
    index("idx_settlement_due_date").on(table.dueDate),
  ]
);

// Cross References table - Linking entities for reconciliation
export const crossReference = pgTable(
  "cross_reference",
  {
    id: text("id").primaryKey(),
    sourceType: text("source_type").notNull(),
    sourceId: text("source_id").notNull(),
    targetType: text("target_type").notNull(),
    targetId: text("target_id").notNull(),
    referenceCode: text("reference_code"),
    referenceType: text("reference_type"),
    description: text("description"),
    metadata: jsonb("metadata"),
    isActive: boolean("is_active")
      .$default(() => true)
      .notNull(),
    createdAt: timestamp("created_at")
      .$defaultFn(() => new Date())
      .notNull(),
    updatedAt: timestamp("updated_at")
      .$defaultFn(() => new Date())
      .notNull(),
    createdBy: text("created_by").references(() => user.id, {
      onDelete: "set null",
    }),
  },
  (table) => [
    index("idx_cross_ref_source").on(table.sourceType, table.sourceId),
    index("idx_cross_ref_target").on(table.targetType, table.targetId),
    index("idx_cross_ref_code").on(table.referenceCode),
    uniqueIndex("idx_cross_ref_unique").on(
      table.sourceType,
      table.sourceId,
      table.targetType,
      table.targetId,
      table.referenceType
    ),
  ]
);

// Adjustments table - Financial adjustments to settlements
export const adjustment = pgTable(
  "adjustment",
  {
    id: text("id").primaryKey(),
    settlementPeriodId: text("settlement_period_id")
      .notNull()
      .references(() => settlementPeriod.id, { onDelete: "cascade" }),
    adjustmentType: adjustmentTypeEnum("adjustment_type").notNull(),
    amount: decimal("amount", { precision: 12, scale: 2 }).notNull(),
    reason: text("reason").notNull(),
    description: text("description"),
    referenceNumber: text("reference_number"),
    effectiveDate: date("effective_date"),
    metadata: jsonb("metadata"),
    approvedAt: timestamp("approved_at"),
    approvedBy: text("approved_by").references(() => user.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at")
      .$defaultFn(() => new Date())
      .notNull(),
    updatedAt: timestamp("updated_at")
      .$defaultFn(() => new Date())
      .notNull(),
    createdBy: text("created_by").references(() => user.id, {
      onDelete: "set null",
    }),
  },
  (table) => [
    index("idx_adjustment_settlement").on(table.settlementPeriodId),
    index("idx_adjustment_type").on(table.adjustmentType),
    index("idx_adjustment_effective_date").on(table.effectiveDate),
  ]
);

// Commissions table - Supplier commission records
export const commission = pgTable(
  "commission",
  {
    id: text("id").primaryKey(),
    supplierId: text("supplier_id")
      .notNull()
      .references(() => supplier.id, { onDelete: "restrict" }),
    franchiseeId: text("franchisee_id")
      .notNull()
      .references(() => franchisee.id, { onDelete: "restrict" }),
    settlementPeriodId: text("settlement_period_id").references(
      () => settlementPeriod.id,
      { onDelete: "set null" }
    ),
    periodStartDate: date("period_start_date").notNull(),
    periodEndDate: date("period_end_date").notNull(),
    status: commissionStatusEnum("status")
      .$default(() => "pending")
      .notNull(),
    grossAmount: decimal("gross_amount", { precision: 12, scale: 2 }).notNull(),
    // Net amount before VAT (used for commission calculation)
    netAmount: decimal("net_amount", { precision: 12, scale: 2 }),
    // Whether VAT adjustment was applied when calculating this commission
    vatAdjusted: boolean("vat_adjusted").$default(() => false),
    commissionRate: decimal("commission_rate", {
      precision: 5,
      scale: 2,
    }).notNull(),
    commissionAmount: decimal("commission_amount", {
      precision: 12,
      scale: 2,
    }).notNull(),
    invoiceNumber: text("invoice_number"),
    invoiceDate: date("invoice_date"),
    notes: text("notes"),
    metadata: jsonb("metadata"),
    calculatedAt: timestamp("calculated_at"),
    approvedAt: timestamp("approved_at"),
    approvedBy: text("approved_by").references(() => user.id, {
      onDelete: "set null",
    }),
    paidAt: timestamp("paid_at"),
    createdAt: timestamp("created_at")
      .$defaultFn(() => new Date())
      .notNull(),
    updatedAt: timestamp("updated_at")
      .$defaultFn(() => new Date())
      .notNull(),
    createdBy: text("created_by").references(() => user.id, {
      onDelete: "set null",
    }),
  },
  (table) => [
    index("idx_commission_supplier").on(table.supplierId),
    index("idx_commission_franchisee").on(table.franchiseeId),
    index("idx_commission_settlement").on(table.settlementPeriodId),
    index("idx_commission_status").on(table.status),
    index("idx_commission_period").on(table.periodStartDate, table.periodEndDate),
    // Composite indexes for report query optimization
    index("idx_commission_supplier_period").on(table.supplierId, table.periodStartDate),
    index("idx_commission_franchisee_status").on(table.franchiseeId, table.status),
    index("idx_commission_status_period").on(table.status, table.periodStartDate),
  ]
);

// Email Templates table - Reusable email templates
export const emailTemplate = pgTable(
  "email_template",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull().unique(),
    code: text("code").notNull().unique(),
    subject: text("subject").notNull(),
    bodyHtml: text("body_html").notNull(),
    bodyText: text("body_text"),
    description: text("description"),
    category: text("category"),
    variables: jsonb("variables"), // Array of variable names used in template
    isActive: boolean("is_active")
      .$default(() => true)
      .notNull(),
    createdAt: timestamp("created_at")
      .$defaultFn(() => new Date())
      .notNull(),
    updatedAt: timestamp("updated_at")
      .$defaultFn(() => new Date())
      .notNull(),
    createdBy: text("created_by").references(() => user.id, {
      onDelete: "set null",
    }),
  },
  (table) => [
    uniqueIndex("idx_email_template_code").on(table.code),
    index("idx_email_template_category").on(table.category),
    index("idx_email_template_is_active").on(table.isActive),
  ]
);

// Email Logs table - Log of sent emails
export const emailLog = pgTable(
  "email_log",
  {
    id: text("id").primaryKey(),
    templateId: text("template_id").references(() => emailTemplate.id, {
      onDelete: "set null",
    }),
    toEmail: text("to_email").notNull(),
    toName: text("to_name"),
    fromEmail: text("from_email").notNull(),
    fromName: text("from_name"),
    subject: text("subject").notNull(),
    bodyHtml: text("body_html"),
    bodyText: text("body_text"),
    status: emailStatusEnum("status")
      .$default(() => "pending")
      .notNull(),
    // Related entity
    entityType: text("entity_type"),
    entityId: text("entity_id"),
    // Delivery tracking
    messageId: text("message_id"),
    sentAt: timestamp("sent_at"),
    deliveredAt: timestamp("delivered_at"),
    failedAt: timestamp("failed_at"),
    errorMessage: text("error_message"),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at")
      .$defaultFn(() => new Date())
      .notNull(),
    createdBy: text("created_by").references(() => user.id, {
      onDelete: "set null",
    }),
  },
  (table) => [
    index("idx_email_log_template").on(table.templateId),
    index("idx_email_log_status").on(table.status),
    index("idx_email_log_to_email").on(table.toEmail),
    index("idx_email_log_entity").on(table.entityType, table.entityId),
    index("idx_email_log_sent_at").on(table.sentAt),
    index("idx_email_log_created_at").on(table.createdAt),
  ]
);

// File Requests table - Manage file upload requests sent to external parties
export const fileRequest = pgTable(
  "file_request",
  {
    id: text("id").primaryKey(),
    // Target entity for the file request
    entityType: text("entity_type").notNull(), // 'supplier', 'franchisee', 'brand'
    entityId: text("entity_id").notNull(),
    // Associated upload link
    uploadLinkId: text("upload_link_id").references(() => uploadLink.id, {
      onDelete: "set null",
    }),
    // Request details
    documentType: text("document_type").notNull(), // e.g., 'sales_report', 'commission_statement'
    description: text("description"),
    recipientEmail: text("recipient_email").notNull(),
    recipientName: text("recipient_name"),
    // Status tracking
    status: fileRequestStatusEnum("status")
      .$default(() => "pending")
      .notNull(),
    // Email template used
    emailTemplateId: text("email_template_id").references(() => emailTemplate.id, {
      onDelete: "set null",
    }),
    // Scheduling
    scheduledFor: timestamp("scheduled_for"), // null = send immediately
    dueDate: date("due_date"),
    // Reminders tracking (array of timestamps when reminders were sent)
    remindersSent: jsonb("reminders_sent").$type<string[]>(),
    // Timeline
    sentAt: timestamp("sent_at"),
    submittedAt: timestamp("submitted_at"),
    expiresAt: timestamp("expires_at"),
    // Additional metadata
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at")
      .$defaultFn(() => new Date())
      .notNull(),
    updatedAt: timestamp("updated_at")
      .$defaultFn(() => new Date())
      .notNull(),
    createdBy: text("created_by").references(() => user.id, {
      onDelete: "set null",
    }),
  },
  (table) => [
    index("idx_file_request_entity").on(table.entityType, table.entityId),
    index("idx_file_request_status").on(table.status),
    index("idx_file_request_scheduled_for").on(table.scheduledFor),
    index("idx_file_request_due_date").on(table.dueDate),
    index("idx_file_request_upload_link").on(table.uploadLinkId),
    index("idx_file_request_created_at").on(table.createdAt),
  ]
);

// ============================================================================
// HISTORY TABLES
// ============================================================================

// Supplier Commission History - Track changes to supplier commission rates
export const supplierCommissionHistory = pgTable(
  "supplier_commission_history",
  {
    id: text("id").primaryKey(),
    supplierId: text("supplier_id")
      .notNull()
      .references(() => supplier.id, { onDelete: "cascade" }),
    previousRate: decimal("previous_rate", { precision: 5, scale: 2 }),
    newRate: decimal("new_rate", { precision: 5, scale: 2 }).notNull(),
    effectiveDate: date("effective_date").notNull(),
    reason: text("reason"),
    notes: text("notes"),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at")
      .$defaultFn(() => new Date())
      .notNull(),
    createdBy: text("created_by").references(() => user.id, {
      onDelete: "set null",
    }),
  },
  (table) => [
    index("idx_supplier_commission_history_supplier").on(table.supplierId),
    index("idx_supplier_commission_history_effective").on(table.effectiveDate),
    index("idx_supplier_commission_history_created").on(table.createdAt),
  ]
);

// Franchisee Status History - Track franchisee status changes
export const franchiseeStatusHistory = pgTable(
  "franchisee_status_history",
  {
    id: text("id").primaryKey(),
    franchiseeId: text("franchisee_id")
      .notNull()
      .references(() => franchisee.id, { onDelete: "cascade" }),
    previousStatus: franchiseeStatusEnum("previous_status"),
    newStatus: franchiseeStatusEnum("new_status").notNull(),
    effectiveDate: date("effective_date").notNull(),
    reason: text("reason"),
    notes: text("notes"),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at")
      .$defaultFn(() => new Date())
      .notNull(),
    createdBy: text("created_by").references(() => user.id, {
      onDelete: "set null",
    }),
  },
  (table) => [
    index("idx_franchisee_status_history_franchisee").on(table.franchiseeId),
    index("idx_franchisee_status_history_effective").on(table.effectiveDate),
    index("idx_franchisee_status_history_created").on(table.createdAt),
  ]
);

// ============================================================================
// COMPREHENSIVE AUDIT LOG TABLE
// ============================================================================

// Audit action types enum
export const auditActionEnum = pgEnum("audit_action", [
  "create",
  "update",
  "delete",
  "approve",
  "reject",
  "status_change",
  "commission_change",
  "adjustment_create",
  "adjustment_update",
  "adjustment_delete",
  "settlement_approve",
  "settlement_status_change",
  "user_approve",
  "user_suspend",
  "user_reactivate",
  "permission_change",
  // File processing actions
  "file_process",
  "file_process_error",
  "file_process_flagged",
]);

// Entity types enum for audit logging
export const auditEntityTypeEnum = pgEnum("audit_entity_type", [
  "user",
  "supplier",
  "franchisee",
  "commission",
  "adjustment",
  "settlement_period",
  "brand",
  "document",
  "file_processing",
  "management_company",
]);

// Comprehensive Audit Log - Track all sensitive actions across the system
export const auditLog = pgTable(
  "audit_log",
  {
    id: text("id").primaryKey(),
    // Who performed the action
    userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
    userName: text("user_name"), // Cached for historical accuracy
    userEmail: text("user_email"), // Cached for historical accuracy
    // When the action occurred
    timestamp: timestamp("timestamp")
      .$defaultFn(() => new Date())
      .notNull(),
    // What action was performed
    action: auditActionEnum("action").notNull(),
    // What entity was affected
    entityType: auditEntityTypeEnum("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    entityName: text("entity_name"), // Cached entity name for display
    // Before and after values (JSONB for flexibility)
    beforeValue: jsonb("before_value"),
    afterValue: jsonb("after_value"),
    // Additional context
    reason: text("reason"),
    notes: text("notes"),
    // Request context
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    // Additional metadata
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at")
      .$defaultFn(() => new Date())
      .notNull(),
  },
  (table) => [
    index("idx_audit_log_user").on(table.userId),
    index("idx_audit_log_timestamp").on(table.timestamp),
    index("idx_audit_log_action").on(table.action),
    index("idx_audit_log_entity").on(table.entityType, table.entityId),
    index("idx_audit_log_entity_type").on(table.entityType),
    index("idx_audit_log_created_at").on(table.createdAt),
  ]
);

// ============================================================================
// RELATIONS FOR NEW TABLES
// ============================================================================

// Management Company relations
export const managementCompanyRelations = relations(managementCompany, ({ one, many }) => ({
  franchisees: many(franchisee),
  createdByUser: one(user, {
    fields: [managementCompany.createdBy],
    references: [user.id],
  }),
}));

// Brand relations
export const brandRelations = relations(brand, ({ many, one }) => ({
  franchisees: many(franchisee),
  supplierBrands: many(supplierBrand),
  createdByUser: one(user, {
    fields: [brand.createdBy],
    references: [user.id],
  }),
}));

// Supplier relations
export const supplierRelations = relations(supplier, ({ many, one }) => ({
  commissions: many(commission),
  commissionHistory: many(supplierCommissionHistory),
  supplierBrands: many(supplierBrand),
  createdByUser: one(user, {
    fields: [supplier.createdBy],
    references: [user.id],
  }),
}));

// Supplier-Brand junction relations
export const supplierBrandRelations = relations(supplierBrand, ({ one }) => ({
  supplier: one(supplier, {
    fields: [supplierBrand.supplierId],
    references: [supplier.id],
  }),
  brand: one(brand, {
    fields: [supplierBrand.brandId],
    references: [brand.id],
  }),
}));

// Franchisee relations
export const franchiseeRelations = relations(franchisee, ({ one, many }) => ({
  brand: one(brand, {
    fields: [franchisee.brandId],
    references: [brand.id],
  }),
  managementCompany: one(managementCompany, {
    fields: [franchisee.managementCompanyId],
    references: [managementCompany.id],
  }),
  settlementPeriods: many(settlementPeriod),
  commissions: many(commission),
  statusHistory: many(franchiseeStatusHistory),
  reminders: many(franchiseeReminder),
  importantDates: many(franchiseeImportantDate),
  createdByUser: one(user, {
    fields: [franchisee.createdBy],
    references: [user.id],
  }),
}));

// Franchisee Reminder relations
export const franchiseeReminderRelations = relations(franchiseeReminder, ({ one }) => ({
  franchisee: one(franchisee, {
    fields: [franchiseeReminder.franchiseeId],
    references: [franchisee.id],
  }),
  dismissedByUser: one(user, {
    fields: [franchiseeReminder.dismissedBy],
    references: [user.id],
    relationName: "dismissedReminders",
  }),
  createdByUser: one(user, {
    fields: [franchiseeReminder.createdBy],
    references: [user.id],
    relationName: "createdFranchiseeReminders",
  }),
}));

// Franchisee Important Date relations
export const franchiseeImportantDateRelations = relations(franchiseeImportantDate, ({ one }) => ({
  franchisee: one(franchisee, {
    fields: [franchiseeImportantDate.franchiseeId],
    references: [franchisee.id],
  }),
  createdByUser: one(user, {
    fields: [franchiseeImportantDate.createdBy],
    references: [user.id],
  }),
}));

// Document relations
export const documentRelations = relations(document, ({ one }) => ({
  createdByUser: one(user, {
    fields: [document.createdBy],
    references: [user.id],
  }),
}));

// Reminder relations
export const reminderRelations = relations(reminder, ({ one }) => ({
  assignedToUser: one(user, {
    fields: [reminder.assignedTo],
    references: [user.id],
    relationName: "assignedReminders",
  }),
  acknowledgedByUser: one(user, {
    fields: [reminder.acknowledgedBy],
    references: [user.id],
    relationName: "acknowledgedReminders",
  }),
  createdByUser: one(user, {
    fields: [reminder.createdBy],
    references: [user.id],
    relationName: "createdReminders",
  }),
}));

// Upload Link relations
export const uploadLinkRelations = relations(uploadLink, ({ one, many }) => ({
  uploadedFiles: many(uploadedFile),
  createdByUser: one(user, {
    fields: [uploadLink.createdBy],
    references: [user.id],
  }),
}));

// Uploaded File relations
export const uploadedFileRelations = relations(uploadedFile, ({ one }) => ({
  uploadLink: one(uploadLink, {
    fields: [uploadedFile.uploadLinkId],
    references: [uploadLink.id],
  }),
  franchisee: one(franchisee, {
    fields: [uploadedFile.franchiseeId],
    references: [franchisee.id],
  }),
}));

// Settlement Period relations
export const settlementPeriodRelations = relations(
  settlementPeriod,
  ({ one, many }) => ({
    franchisee: one(franchisee, {
      fields: [settlementPeriod.franchiseeId],
      references: [franchisee.id],
    }),
    adjustments: many(adjustment),
    commissions: many(commission),
    approvedByUser: one(user, {
      fields: [settlementPeriod.approvedBy],
      references: [user.id],
      relationName: "approvedSettlements",
    }),
    createdByUser: one(user, {
      fields: [settlementPeriod.createdBy],
      references: [user.id],
      relationName: "createdSettlements",
    }),
  })
);

// Adjustment relations
export const adjustmentRelations = relations(adjustment, ({ one }) => ({
  settlementPeriod: one(settlementPeriod, {
    fields: [adjustment.settlementPeriodId],
    references: [settlementPeriod.id],
  }),
  approvedByUser: one(user, {
    fields: [adjustment.approvedBy],
    references: [user.id],
    relationName: "approvedAdjustments",
  }),
  createdByUser: one(user, {
    fields: [adjustment.createdBy],
    references: [user.id],
    relationName: "createdAdjustments",
  }),
}));

// Commission relations
export const commissionRelations = relations(commission, ({ one }) => ({
  supplier: one(supplier, {
    fields: [commission.supplierId],
    references: [supplier.id],
  }),
  franchisee: one(franchisee, {
    fields: [commission.franchiseeId],
    references: [franchisee.id],
  }),
  settlementPeriod: one(settlementPeriod, {
    fields: [commission.settlementPeriodId],
    references: [settlementPeriod.id],
  }),
  approvedByUser: one(user, {
    fields: [commission.approvedBy],
    references: [user.id],
    relationName: "approvedCommissions",
  }),
  createdByUser: one(user, {
    fields: [commission.createdBy],
    references: [user.id],
    relationName: "createdCommissions",
  }),
}));

// Email Template relations
export const emailTemplateRelations = relations(
  emailTemplate,
  ({ one, many }) => ({
    emailLogs: many(emailLog),
    createdByUser: one(user, {
      fields: [emailTemplate.createdBy],
      references: [user.id],
    }),
  })
);

// Email Log relations
export const emailLogRelations = relations(emailLog, ({ one }) => ({
  template: one(emailTemplate, {
    fields: [emailLog.templateId],
    references: [emailTemplate.id],
  }),
  createdByUser: one(user, {
    fields: [emailLog.createdBy],
    references: [user.id],
  }),
}));

// File Request relations
export const fileRequestRelations = relations(fileRequest, ({ one }) => ({
  uploadLink: one(uploadLink, {
    fields: [fileRequest.uploadLinkId],
    references: [uploadLink.id],
  }),
  emailTemplate: one(emailTemplate, {
    fields: [fileRequest.emailTemplateId],
    references: [emailTemplate.id],
  }),
  createdByUser: one(user, {
    fields: [fileRequest.createdBy],
    references: [user.id],
  }),
}));

// Supplier Commission History relations
export const supplierCommissionHistoryRelations = relations(
  supplierCommissionHistory,
  ({ one }) => ({
    supplier: one(supplier, {
      fields: [supplierCommissionHistory.supplierId],
      references: [supplier.id],
    }),
    createdByUser: one(user, {
      fields: [supplierCommissionHistory.createdBy],
      references: [user.id],
    }),
  })
);

// Franchisee Status History relations
export const franchiseeStatusHistoryRelations = relations(
  franchiseeStatusHistory,
  ({ one }) => ({
    franchisee: one(franchisee, {
      fields: [franchiseeStatusHistory.franchiseeId],
      references: [franchisee.id],
    }),
    createdByUser: one(user, {
      fields: [franchiseeStatusHistory.createdBy],
      references: [user.id],
    }),
  })
);

// Audit Log relations
export const auditLogRelations = relations(auditLog, ({ one }) => ({
  performedByUser: one(user, {
    fields: [auditLog.userId],
    references: [user.id],
  }),
}));

// ============================================================================
// TYPE EXPORTS FOR NEW TABLES
// ============================================================================

// Management Company types
export type ManagementCompany = typeof managementCompany.$inferSelect;
export type CreateManagementCompanyData = typeof managementCompany.$inferInsert;
export type UpdateManagementCompanyData = Partial<
  Omit<CreateManagementCompanyData, "id" | "createdAt">
>;

// Brand types
export type Brand = typeof brand.$inferSelect;
export type CreateBrandData = typeof brand.$inferInsert;
export type UpdateBrandData = Partial<Omit<CreateBrandData, "id" | "createdAt">>;

// Supplier types
export type Supplier = typeof supplier.$inferSelect;
export type CreateSupplierData = typeof supplier.$inferInsert;
export type UpdateSupplierData = Partial<
  Omit<CreateSupplierData, "id" | "createdAt">
>;
export type CommissionType = (typeof commissionTypeEnum.enumValues)[number];
export type SettlementFrequency = (typeof settlementFrequencyEnum.enumValues)[number];

// Supplier-Brand junction types
export type SupplierBrand = typeof supplierBrand.$inferSelect;
export type CreateSupplierBrandData = typeof supplierBrand.$inferInsert;

// Franchisee types
export type Franchisee = typeof franchisee.$inferSelect;
export type CreateFranchiseeData = typeof franchisee.$inferInsert;
export type UpdateFranchiseeData = Partial<
  Omit<CreateFranchiseeData, "id" | "createdAt">
>;
export type FranchiseeStatus = (typeof franchiseeStatusEnum.enumValues)[number];
export type FranchiseeCategory = (typeof franchiseeCategoryEnum.enumValues)[number];

// Document types
export type Document = typeof document.$inferSelect;
export type CreateDocumentData = typeof document.$inferInsert;
export type UpdateDocumentData = Partial<
  Omit<CreateDocumentData, "id" | "createdAt">
>;
export type DocumentStatus = (typeof documentStatusEnum.enumValues)[number];

// Reminder types
export type Reminder = typeof reminder.$inferSelect;
export type CreateReminderData = typeof reminder.$inferInsert;
export type UpdateReminderData = Partial<
  Omit<CreateReminderData, "id" | "createdAt">
>;
export type ReminderStatus = (typeof reminderStatusEnum.enumValues)[number];
export type ReminderType = (typeof reminderTypeEnum.enumValues)[number];

// Franchisee Reminder types
export type FranchiseeReminder = typeof franchiseeReminder.$inferSelect;
export type CreateFranchiseeReminderData = typeof franchiseeReminder.$inferInsert;
export type UpdateFranchiseeReminderData = Partial<
  Omit<CreateFranchiseeReminderData, "id" | "createdAt">
>;
export type FranchiseeReminderType = (typeof franchiseeReminderTypeEnum.enumValues)[number];

// Franchisee Important Date types
export type FranchiseeImportantDate = typeof franchiseeImportantDate.$inferSelect;
export type CreateFranchiseeImportantDateData = typeof franchiseeImportantDate.$inferInsert;
export type UpdateFranchiseeImportantDateData = Partial<
  Omit<CreateFranchiseeImportantDateData, "id" | "createdAt">
>;
export type ImportantDateType = (typeof importantDateTypeEnum.enumValues)[number];
export type DurationUnit = (typeof durationUnitEnum.enumValues)[number];

// Upload Link types
export type UploadLink = typeof uploadLink.$inferSelect;
export type CreateUploadLinkData = typeof uploadLink.$inferInsert;
export type UpdateUploadLinkData = Partial<
  Omit<CreateUploadLinkData, "id" | "createdAt">
>;
export type UploadLinkStatus = (typeof uploadLinkStatusEnum.enumValues)[number];

// Uploaded File types
export type UploadedFile = typeof uploadedFile.$inferSelect;
export type CreateUploadedFileData = typeof uploadedFile.$inferInsert;

// Settlement Period types
export type SettlementPeriod = typeof settlementPeriod.$inferSelect;
export type CreateSettlementPeriodData = typeof settlementPeriod.$inferInsert;
export type UpdateSettlementPeriodData = Partial<
  Omit<CreateSettlementPeriodData, "id" | "createdAt">
>;
export type SettlementStatus = (typeof settlementStatusEnum.enumValues)[number];
export type SettlementPeriodType = (typeof settlementPeriodTypeEnum.enumValues)[number];

// Cross Reference types
export type CrossReference = typeof crossReference.$inferSelect;
export type CreateCrossReferenceData = typeof crossReference.$inferInsert;
export type UpdateCrossReferenceData = Partial<
  Omit<CreateCrossReferenceData, "id" | "createdAt">
>;

// Adjustment types
export type Adjustment = typeof adjustment.$inferSelect;
export type CreateAdjustmentData = typeof adjustment.$inferInsert;
export type UpdateAdjustmentData = Partial<
  Omit<CreateAdjustmentData, "id" | "createdAt">
>;
export type AdjustmentType = (typeof adjustmentTypeEnum.enumValues)[number];

// Commission types
export type Commission = typeof commission.$inferSelect;
export type CreateCommissionData = typeof commission.$inferInsert;
export type UpdateCommissionData = Partial<
  Omit<CreateCommissionData, "id" | "createdAt">
>;
export type CommissionStatus = (typeof commissionStatusEnum.enumValues)[number];

// Email Template types
export type EmailTemplate = typeof emailTemplate.$inferSelect;
export type CreateEmailTemplateData = typeof emailTemplate.$inferInsert;
export type UpdateEmailTemplateData = Partial<
  Omit<CreateEmailTemplateData, "id" | "createdAt">
>;

// Email Log types
export type EmailLog = typeof emailLog.$inferSelect;
export type CreateEmailLogData = typeof emailLog.$inferInsert;
export type EmailStatus = (typeof emailStatusEnum.enumValues)[number];

// File Request types
export type FileRequest = typeof fileRequest.$inferSelect;
export type CreateFileRequestData = typeof fileRequest.$inferInsert;
export type UpdateFileRequestData = Partial<
  Omit<CreateFileRequestData, "id" | "createdAt">
>;
export type FileRequestStatus = (typeof fileRequestStatusEnum.enumValues)[number];

// Supplier Commission History types
export type SupplierCommissionHistory =
  typeof supplierCommissionHistory.$inferSelect;
export type CreateSupplierCommissionHistoryData =
  typeof supplierCommissionHistory.$inferInsert;

// Franchisee Status History types
export type FranchiseeStatusHistory =
  typeof franchiseeStatusHistory.$inferSelect;
export type CreateFranchiseeStatusHistoryData =
  typeof franchiseeStatusHistory.$inferInsert;

// Audit Log types
export type AuditLog = typeof auditLog.$inferSelect;
export type CreateAuditLogData = typeof auditLog.$inferInsert;
export type AuditAction = (typeof auditActionEnum.enumValues)[number];
export type AuditEntityType = (typeof auditEntityTypeEnum.enumValues)[number];

// ============================================================================
// VAT RATE TABLE
// ============================================================================

// VAT Rate table - Track historical VAT rates with effective dates
// This allows for accurate historical commission calculations when VAT rates change
export const vatRate = pgTable(
  "vat_rate",
  {
    id: text("id").primaryKey(),
    // The VAT rate as a decimal (e.g., 0.18 for 18%)
    rate: decimal("rate", { precision: 5, scale: 4 }).notNull(),
    // The date from which this rate is effective
    effectiveFrom: date("effective_from").notNull(),
    // Optional description (e.g., "Standard VAT rate increase")
    description: text("description"),
    // Optional notes for internal documentation
    notes: text("notes"),
    // Audit fields
    createdAt: timestamp("created_at")
      .$defaultFn(() => new Date())
      .notNull(),
    updatedAt: timestamp("updated_at")
      .$defaultFn(() => new Date())
      .notNull(),
    createdBy: text("created_by").references(() => user.id, {
      onDelete: "set null",
    }),
  },
  (table) => [
    index("idx_vat_rate_effective_from").on(table.effectiveFrom),
    // Only one rate per effective date
    uniqueIndex("idx_vat_rate_effective_from_unique").on(table.effectiveFrom),
  ]
);

// VAT Rate relations
export const vatRateRelations = relations(vatRate, ({ one }) => ({
  createdByUser: one(user, {
    fields: [vatRate.createdBy],
    references: [user.id],
  }),
}));

// VAT Rate types
export type VatRate = typeof vatRate.$inferSelect;
export type CreateVatRateData = typeof vatRate.$inferInsert;
export type UpdateVatRateData = Partial<Omit<CreateVatRateData, "id" | "createdAt">>;

// ============================================================================
// FILE PROCESSING LOG TABLE
// ============================================================================

// File processing status enum
export const fileProcessingStatusEnum = pgEnum("file_processing_status", [
  "success",
  "partial_success",
  "failed",
  "flagged",
]);

// File processing error category enum
export const fileProcessingErrorCategoryEnum = pgEnum("file_processing_error_category", [
  "file_format",
  "missing_columns",
  "invalid_data",
  "unmatched_franchisee",
  "configuration",
  "parsing",
  "validation",
  "system",
]);

// File Processing Log table - Track all file processing attempts
export const fileProcessingLog = pgTable(
  "file_processing_log",
  {
    id: text("id").primaryKey(),
    // Supplier information
    supplierId: text("supplier_id")
      .notNull()
      .references(() => supplier.id, { onDelete: "cascade" }),
    supplierName: text("supplier_name").notNull(),
    // File information
    fileName: text("file_name").notNull(),
    fileSize: integer("file_size").notNull(),
    mimeType: text("mime_type"),
    // Processing status
    status: fileProcessingStatusEnum("status").notNull(),
    // Statistics
    totalRows: integer("total_rows").$default(() => 0).notNull(),
    processedRows: integer("processed_rows").$default(() => 0).notNull(),
    skippedRows: integer("skipped_rows").$default(() => 0).notNull(),
    errorCount: integer("error_count").$default(() => 0).notNull(),
    warningCount: integer("warning_count").$default(() => 0).notNull(),
    // Amounts
    totalGrossAmount: decimal("total_gross_amount", { precision: 12, scale: 2 }),
    totalNetAmount: decimal("total_net_amount", { precision: 12, scale: 2 }),
    // Franchisee matching summary
    matchedFranchisees: integer("matched_franchisees").$default(() => 0).notNull(),
    unmatchedFranchisees: integer("unmatched_franchisees").$default(() => 0).notNull(),
    franchiseesNeedingReview: integer("franchisees_needing_review").$default(() => 0).notNull(),
    // Error details (JSONB for detailed error information)
    errors: jsonb("errors").$type<Array<{
      code: string;
      category: string;
      severity: string;
      message: string;
      details?: string;
      rowNumber?: number;
      columnName?: string;
      value?: string;
      suggestion?: string;
    }>>(),
    warnings: jsonb("warnings").$type<Array<{
      code: string;
      category: string;
      severity: string;
      message: string;
      details?: string;
      rowNumber?: number;
      columnName?: string;
      value?: string;
      suggestion?: string;
    }>>(),
    // Unmatched franchisee details
    unmatchedFranchiseeSummary: jsonb("unmatched_franchisee_summary").$type<Array<{
      name: string;
      occurrences: number;
      rowNumbers: number[];
      totalAmount: number;
      suggestedMatches?: Array<{
        franchiseeName: string;
        franchiseeId: string;
        confidence: number;
      }>;
    }>>(),
    // Processing duration
    processingDurationMs: integer("processing_duration_ms"),
    // User context
    processedBy: text("processed_by").references(() => user.id, {
      onDelete: "set null",
    }),
    processedByName: text("processed_by_name"),
    processedByEmail: text("processed_by_email"),
    // Additional metadata
    metadata: jsonb("metadata"),
    // Timestamps
    processedAt: timestamp("processed_at")
      .$defaultFn(() => new Date())
      .notNull(),
    createdAt: timestamp("created_at")
      .$defaultFn(() => new Date())
      .notNull(),
  },
  (table) => [
    index("idx_file_processing_log_supplier").on(table.supplierId),
    index("idx_file_processing_log_status").on(table.status),
    index("idx_file_processing_log_processed_at").on(table.processedAt),
    index("idx_file_processing_log_processed_by").on(table.processedBy),
    index("idx_file_processing_log_created_at").on(table.createdAt),
  ]
);

// File Processing Log relations
export const fileProcessingLogRelations = relations(fileProcessingLog, ({ one }) => ({
  supplier: one(supplier, {
    fields: [fileProcessingLog.supplierId],
    references: [supplier.id],
  }),
  processedByUser: one(user, {
    fields: [fileProcessingLog.processedBy],
    references: [user.id],
  }),
}));

// File Processing Log types
export type FileProcessingLog = typeof fileProcessingLog.$inferSelect;
export type CreateFileProcessingLogData = typeof fileProcessingLog.$inferInsert;
export type FileProcessingStatus = (typeof fileProcessingStatusEnum.enumValues)[number];
export type FileProcessingErrorCategory = (typeof fileProcessingErrorCategoryEnum.enumValues)[number];

// ============================================================================
// CONTACTS TABLE
// ============================================================================

// Contacts table - General contacts for franchisees and brands
export const contact = pgTable(
  "contact",
  {
    id: text("id").primaryKey(),
    // קישור לזכיין (אופציונלי - יכול להיות null לאנשי קשר ברמת מותג)
    franchiseeId: text("franchisee_id").references(() => franchisee.id, {
      onDelete: "cascade",
    }),
    // קישור למותג (אופציונלי - לאנשי קשר ברמת רשת)
    brandId: text("brand_id").references(() => brand.id, {
      onDelete: "cascade",
    }),
    // פרטי איש קשר
    name: text("name").notNull(),
    phone: text("phone"),
    email: text("email"),
    // תפקיד
    role: contactRoleEnum("role")
      .$default(() => "other")
      .notNull(),
    // האם איש קשר ראשי
    isPrimary: boolean("is_primary")
      .$default(() => false)
      .notNull(),
    // הערות
    notes: text("notes"),
    // סטטוס
    isActive: boolean("is_active")
      .$default(() => true)
      .notNull(),
    // Audit
    createdAt: timestamp("created_at")
      .$defaultFn(() => new Date())
      .notNull(),
    updatedAt: timestamp("updated_at")
      .$defaultFn(() => new Date())
      .notNull(),
    createdBy: text("created_by").references(() => user.id, {
      onDelete: "set null",
    }),
  },
  (table) => [
    index("idx_contact_franchisee").on(table.franchiseeId),
    index("idx_contact_brand").on(table.brandId),
    index("idx_contact_role").on(table.role),
    index("idx_contact_is_active").on(table.isActive),
  ]
);

// Contact relations
export const contactRelations = relations(contact, ({ one }) => ({
  franchisee: one(franchisee, {
    fields: [contact.franchiseeId],
    references: [franchisee.id],
  }),
  brand: one(brand, {
    fields: [contact.brandId],
    references: [brand.id],
  }),
  createdByUser: one(user, {
    fields: [contact.createdBy],
    references: [user.id],
  }),
}));

// Contact types
export type Contact = typeof contact.$inferSelect;
export type CreateContactData = typeof contact.$inferInsert;
export type UpdateContactData = Partial<Omit<CreateContactData, "id" | "createdAt">>;
export type ContactRole = (typeof contactRoleEnum.enumValues)[number];

// ============================================================================
// RECONCILIATION V2 TABLES (Supplier Reconciliation Module)
// ============================================================================

// Reconciliation session status enum
export const reconciliationSessionStatusEnum = pgEnum("reconciliation_session_status", [
  "in_progress",
  "completed",
  "file_approved",
  "file_rejected",
]);

// Reconciliation comparison status enum
export const reconciliationComparisonStatusEnum = pgEnum("reconciliation_comparison_status", [
  "pending",
  "auto_approved",
  "needs_review",
  "manually_approved",
  "sent_to_review_queue",
]);

// Reconciliation review queue status enum
export const reconciliationReviewQueueStatusEnum = pgEnum("reconciliation_review_queue_status", [
  "pending",
  "resolved",
]);

// Reconciliation Session table - Main session for supplier vs franchisee comparison
export const reconciliationSession = pgTable(
  "reconciliation_session",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    supplierId: text("supplier_id")
      .notNull()
      .references(() => supplier.id, { onDelete: "cascade" }),
    supplierFileId: text("supplier_file_id")
      .references(() => supplierFileUpload.id, { onDelete: "set null" }),
    periodStartDate: date("period_start_date").notNull(),
    periodEndDate: date("period_end_date").notNull(),
    status: reconciliationSessionStatusEnum("status")
      .$default(() => "in_progress")
      .notNull(),
    // Statistics
    totalFranchisees: integer("total_franchisees")
      .$default(() => 0)
      .notNull(),
    matchedCount: integer("matched_count")
      .$default(() => 0)
      .notNull(),
    needsReviewCount: integer("needs_review_count")
      .$default(() => 0)
      .notNull(),
    approvedCount: integer("approved_count")
      .$default(() => 0)
      .notNull(),
    toReviewQueueCount: integer("to_review_queue_count")
      .$default(() => 0)
      .notNull(),
    // Totals
    totalSupplierAmount: decimal("total_supplier_amount", { precision: 12, scale: 2 }),
    totalFranchiseeAmount: decimal("total_franchisee_amount", { precision: 12, scale: 2 }),
    totalDifference: decimal("total_difference", { precision: 12, scale: 2 }),
    // File approval/rejection
    fileRejectionReason: text("file_rejection_reason"),
    fileApprovedAt: timestamp("file_approved_at"),
    fileApprovedBy: text("file_approved_by").references(() => user.id, {
      onDelete: "set null",
    }),
    // Audit
    createdAt: timestamp("created_at")
      .$defaultFn(() => new Date())
      .notNull(),
    updatedAt: timestamp("updated_at")
      .$defaultFn(() => new Date())
      .notNull(),
    createdBy: text("created_by").references(() => user.id, {
      onDelete: "set null",
    }),
  },
  (table) => [
    index("idx_reconciliation_session_supplier").on(table.supplierId),
    index("idx_reconciliation_session_supplier_file").on(table.supplierFileId),
    index("idx_reconciliation_session_period").on(table.periodStartDate, table.periodEndDate),
    index("idx_reconciliation_session_status").on(table.status),
    index("idx_reconciliation_session_created_at").on(table.createdAt),
    // Unique constraint for supplier + period to prevent duplicate sessions
    uniqueIndex("idx_reconciliation_session_unique").on(
      table.supplierId,
      table.periodStartDate,
      table.periodEndDate
    ),
  ]
);

// Reconciliation Comparison table - Individual comparison rows
export const reconciliationComparison = pgTable(
  "reconciliation_comparison",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    sessionId: text("session_id")
      .notNull()
      .references(() => reconciliationSession.id, { onDelete: "cascade" }),
    franchiseeId: text("franchisee_id")
      .notNull()
      .references(() => franchisee.id, { onDelete: "restrict" }),
    // Amounts
    supplierAmount: decimal("supplier_amount", { precision: 12, scale: 2 }).notNull(),
    franchiseeAmount: decimal("franchisee_amount", { precision: 12, scale: 2 }).notNull(),
    difference: decimal("difference", { precision: 12, scale: 2 }).notNull(),
    absoluteDifference: decimal("absolute_difference", { precision: 12, scale: 2 }).notNull(),
    // Original name from supplier file (for reference)
    supplierOriginalName: text("supplier_original_name"),
    // Reference to franchisee's BKMVDATA file
    franchiseeFileId: text("franchisee_file_id").references(() => uploadedFile.id, {
      onDelete: "set null",
    }),
    // Status
    status: reconciliationComparisonStatusEnum("status")
      .$default(() => "pending")
      .notNull(),
    // Review info
    reviewedBy: text("reviewed_by").references(() => user.id, {
      onDelete: "set null",
    }),
    reviewedAt: timestamp("reviewed_at"),
    reviewNotes: text("review_notes"),
  },
  (table) => [
    index("idx_reconciliation_comparison_session").on(table.sessionId),
    index("idx_reconciliation_comparison_franchisee").on(table.franchiseeId),
    index("idx_reconciliation_comparison_status").on(table.status),
    // Unique constraint for session + franchisee
    uniqueIndex("idx_reconciliation_comparison_unique").on(table.sessionId, table.franchiseeId),
  ]
);

// Reconciliation Review Queue table - Items flagged for review
export const reconciliationReviewQueue = pgTable(
  "reconciliation_review_queue",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    comparisonId: text("comparison_id")
      .notNull()
      .references(() => reconciliationComparison.id, { onDelete: "cascade" }),
    sessionId: text("session_id")
      .notNull()
      .references(() => reconciliationSession.id, { onDelete: "cascade" }),
    // Denormalized fields for quick access without joins
    supplierId: text("supplier_id").notNull(),
    supplierName: text("supplier_name").notNull(),
    franchiseeId: text("franchisee_id").notNull(),
    franchiseeName: text("franchisee_name").notNull(),
    periodStartDate: date("period_start_date").notNull(),
    periodEndDate: date("period_end_date").notNull(),
    supplierAmount: decimal("supplier_amount", { precision: 12, scale: 2 }).notNull(),
    franchiseeAmount: decimal("franchisee_amount", { precision: 12, scale: 2 }).notNull(),
    difference: decimal("difference", { precision: 12, scale: 2 }).notNull(),
    // Status
    status: reconciliationReviewQueueStatusEnum("status")
      .$default(() => "pending")
      .notNull(),
    // Resolution
    resolvedBy: text("resolved_by").references(() => user.id, {
      onDelete: "set null",
    }),
    resolvedAt: timestamp("resolved_at"),
    resolutionNotes: text("resolution_notes"),
    // Timestamps
    createdAt: timestamp("created_at")
      .$defaultFn(() => new Date())
      .notNull(),
  },
  (table) => [
    index("idx_reconciliation_review_queue_comparison").on(table.comparisonId),
    index("idx_reconciliation_review_queue_session").on(table.sessionId),
    index("idx_reconciliation_review_queue_status").on(table.status),
    index("idx_reconciliation_review_queue_created_at").on(table.createdAt),
    // Unique constraint for comparison to prevent duplicate queue entries
    uniqueIndex("idx_reconciliation_review_queue_unique").on(table.comparisonId),
  ]
);

// Reconciliation Session relations
export const reconciliationSessionRelations = relations(reconciliationSession, ({ one, many }) => ({
  supplier: one(supplier, {
    fields: [reconciliationSession.supplierId],
    references: [supplier.id],
  }),
  supplierFile: one(supplierFileUpload, {
    fields: [reconciliationSession.supplierFileId],
    references: [supplierFileUpload.id],
  }),
  comparisons: many(reconciliationComparison),
  reviewQueueItems: many(reconciliationReviewQueue),
  approvedByUser: one(user, {
    fields: [reconciliationSession.fileApprovedBy],
    references: [user.id],
    relationName: "approvedReconciliationSessions",
  }),
  createdByUser: one(user, {
    fields: [reconciliationSession.createdBy],
    references: [user.id],
    relationName: "createdReconciliationSessions",
  }),
}));

// Reconciliation Comparison relations
export const reconciliationComparisonRelations = relations(reconciliationComparison, ({ one }) => ({
  session: one(reconciliationSession, {
    fields: [reconciliationComparison.sessionId],
    references: [reconciliationSession.id],
  }),
  franchisee: one(franchisee, {
    fields: [reconciliationComparison.franchiseeId],
    references: [franchisee.id],
  }),
  franchiseeFile: one(uploadedFile, {
    fields: [reconciliationComparison.franchiseeFileId],
    references: [uploadedFile.id],
  }),
  reviewedByUser: one(user, {
    fields: [reconciliationComparison.reviewedBy],
    references: [user.id],
  }),
}));

// Reconciliation Review Queue relations
export const reconciliationReviewQueueRelations = relations(reconciliationReviewQueue, ({ one }) => ({
  comparison: one(reconciliationComparison, {
    fields: [reconciliationReviewQueue.comparisonId],
    references: [reconciliationComparison.id],
  }),
  session: one(reconciliationSession, {
    fields: [reconciliationReviewQueue.sessionId],
    references: [reconciliationSession.id],
  }),
  resolvedByUser: one(user, {
    fields: [reconciliationReviewQueue.resolvedBy],
    references: [user.id],
  }),
}));

// Reconciliation Session types
export type ReconciliationSession = typeof reconciliationSession.$inferSelect;
export type CreateReconciliationSessionData = typeof reconciliationSession.$inferInsert;
export type UpdateReconciliationSessionData = Partial<Omit<CreateReconciliationSessionData, "id" | "createdAt">>;
export type ReconciliationSessionStatus = (typeof reconciliationSessionStatusEnum.enumValues)[number];

// Reconciliation Comparison types
export type ReconciliationComparison = typeof reconciliationComparison.$inferSelect;
export type CreateReconciliationComparisonData = typeof reconciliationComparison.$inferInsert;
export type UpdateReconciliationComparisonData = Partial<Omit<CreateReconciliationComparisonData, "id">>;
export type ReconciliationComparisonStatus = (typeof reconciliationComparisonStatusEnum.enumValues)[number];

// Reconciliation Review Queue types
export type ReconciliationReviewQueue = typeof reconciliationReviewQueue.$inferSelect;
export type CreateReconciliationReviewQueueData = typeof reconciliationReviewQueue.$inferInsert;
export type ReconciliationReviewQueueStatus = (typeof reconciliationReviewQueueStatusEnum.enumValues)[number];
