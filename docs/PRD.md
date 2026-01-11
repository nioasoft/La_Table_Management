# La Table Management - Product Requirements Document

## Overview

**Project Name:** La Table Management  
**Version:** 1.0  
**Last Updated:** January 2025  
**Status:** Phase 1 Development

### Executive Summary

La Table Management is a commission management system for a restaurant franchise group. The group operates ~20 franchisees across 3 brands (Pat Vini, Mina Tomai, King Kong) and works with ~30 suppliers. Currently, quarterly commission calculations are done manually via Excel spreadsheets, causing significant time waste, human errors, and tracking difficulties.

This system will automate the entire commission workflow: from requesting reports, through cross-referencing supplier vs. franchisee data, to generating invoices per brand.

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| Framework | Next.js 16, React 19, TypeScript |
| Authentication | Better Auth with Google OAuth |
| Database | PostgreSQL with Drizzle ORM |
| UI | shadcn/ui + Tailwind CSS |
| File Storage | Vercel Blob (with local fallback) |
| Email | Resend + React Email |
| Excel Processing | xlsx / exceljs |
| PDF Generation | react-pdf |
| Job Scheduling | Vercel Cron / Trigger.dev |
| Hosting | Vercel |

---

## System Architecture

### Organizational Hierarchy

```
La Table Group
├── Pat Vini (Brand)
│   ├── Pat Vini Haifa (Franchisee)
│   │   └── Branch 1, Branch 2... (Branches)
│   ├── Pat Vini Netanya (Franchisee)
│   └── ...
├── Mina Tomai (Brand)
│   └── ...
└── King Kong (Brand)
    └── ...
```

**Key Points:**
- A franchisee can own multiple branches
- A franchisee can own branches from different brands
- Franchisees have multiple owners (shareholders)

### User Roles & Permissions

| Role | Description | Permissions |
|------|-------------|-------------|
| **Super User** | System administrator | Full access, approves users, handles discrepancies, approves settlements |
| **Admin** | Office staff with partial access | Configurable view/edit per module |
| **Franchisee Owner** | Business owner | Limited access, configurable by Super User |

**Permission Matrix:**
Each module should support granular permissions:
- View
- Edit
- Create
- Delete
- Approve (where applicable)

**Authentication Flow:**
1. User signs up via Google OAuth (Better Auth)
2. Account created in "pending" status
3. Super User approves and assigns role
4. User gains access based on role

---

## Core Modules

### 1. Supplier Management

#### Supplier Card Fields

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| Name | String | Yes | |
| Company ID (ח.פ) | String | No | |
| Address | String | No | |
| Primary Contact | Object | Yes | Name, Phone, Email |
| Secondary Contact | Object | No | Name, Phone, Email |
| Commission Rate | Decimal | Yes | Percentage (e.g., 10%) |
| Commission Type | Enum | Yes | `percentage` / `per_item` |
| Settlement Frequency | Enum | Yes | `monthly` / `quarterly` / `semi_annual` / `annual` |
| VAT Included | Boolean | Yes | Whether supplier reports include VAT |
| Status | Enum | Yes | `active` / `inactive` |
| Associated Brands | Array | No | Which brands work with this supplier |
| Email Template | Reference | No | Custom email template |
| Created At | DateTime | Auto | |
| Updated At | DateTime | Auto | |

#### Commission Rate History

Every change to commission rate must be logged:

| Field | Type |
|-------|------|
| Supplier ID | Reference |
| Old Rate | Decimal |
| New Rate | Decimal |
| Changed By | Reference (User) |
| Changed At | DateTime |
| Effective From | Date |
| Notes | String |

#### Per-Item Commission (Future Enhancement)

For suppliers with item-specific rates:

| Field | Type |
|-------|------|
| Supplier ID | Reference |
| Item Identifier | String | (SKU or name) |
| Commission Rate | Decimal |
| Notes | String |

**Note:** Phase 1 handles per-item exceptions manually. System should be designed to support this in the future.

#### Supplier File Mapping

Each supplier sends reports in different formats. Store mapping configuration:

| Field | Type | Notes |
|-------|------|-------|
| Supplier ID | Reference | |
| File Type | Enum | `xlsx` / `csv` / `xls` |
| Franchisee Column | String | Column name/index containing franchisee identifier |
| Amount Column | String | Column name/index containing purchase amount |
| Date Column | String | Column name/index containing date (if applicable) |
| Header Row | Integer | Which row contains headers |
| Data Start Row | Integer | Which row data starts |
| Skip Rows | Array | Rows to skip (e.g., subtotals) |
| Skip Keywords | Array | Keywords that indicate rows to skip (e.g., "פיקדון", "deposit") |
| Notes | Text | Special handling instructions |

#### Supplier Documents

| Field | Type |
|-------|------|
| Supplier ID | Reference |
| Document Type | Enum | `agreement` / `correspondence` / `invoice` / `other` |
| File URL | String |
| File Name | String |
| Uploaded By | Reference (User) |
| Uploaded At | DateTime |
| Notes | String |

---

### 2. Franchisee Management

#### Franchisee Card Fields

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| Name | String | Yes | Official name |
| Brand | Reference | Yes | Which brand |
| Aliases | Array<String> | Yes | Alternative names used by suppliers |
| Company ID (ח.פ) | String | No | |
| Address | String | No | |
| Primary Contact | Object | Yes | Name, Phone, Email |
| Owners | Array<Object> | No | Name, Phone, Email, Ownership % |
| Opening Date | Date | No | Public opening date |
| Lease Option End | Date | No | For reminders |
| Franchise Agreement End | Date | No | For reminders |
| Status | Enum | Yes | `active` / `suspended` / `closed` |
| Created At | DateTime | Auto | |
| Updated At | DateTime | Auto | |

**Aliases Example:**
```
Franchisee: "פט ויני קריות"
Aliases: [
  "מיאמוטו בע\"מ",
  "מיאמוטו בע\"מ (פט ויני קרית אתא)",
  "פט ויני קרית אתא",
  "pat vini kiryot"
]
```

#### Franchisee Status History

| Field | Type |
|-------|------|
| Franchisee ID | Reference |
| Old Status | Enum |
| New Status | Enum |
| Changed By | Reference (User) |
| Changed At | DateTime |
| Reason | String |

#### Franchisee Documents

Same structure as Supplier Documents.

#### Franchisee Reminders

| Field | Type |
|-------|------|
| Franchisee ID | Reference |
| Reminder Type | Enum | `lease_option` / `franchise_agreement` / `custom` |
| Reminder Date | Date |
| Days Before | Integer | How many days before to send reminder |
| Recipients | Array<Reference> | Users to notify |
| Status | Enum | `pending` / `sent` / `dismissed` |
| Notes | String |

---

### 3. File Upload System

#### Secure Upload Links

When requesting files from suppliers/franchisees, system generates secure upload links:

| Field | Type |
|-------|------|
| ID | UUID |
| Token | String | Unique, unguessable token |
| Type | Enum | `supplier` / `franchisee` |
| Entity ID | Reference | Supplier or Franchisee ID |
| Period | Object | { start: Date, end: Date } |
| Created At | DateTime |
| Expires At | DateTime | 14 days from creation |
| Used At | DateTime | Null until used |
| File ID | Reference | Uploaded file reference |
| Status | Enum | `pending` / `uploaded` / `expired` |

**Upload Flow:**
1. System generates token with 14-day expiry
2. Email sent with link: `https://app.latable.co.il/upload/{token}`
3. Recipient clicks link, uploads file
4. Token marked as used, link becomes invalid
5. System notifies Super User of new upload

#### Uploaded Files

| Field | Type |
|-------|------|
| ID | UUID |
| Upload Link ID | Reference |
| Entity Type | Enum | `supplier` / `franchisee` |
| Entity ID | Reference |
| Period | Object | { start: Date, end: Date } |
| Original Filename | String |
| Stored URL | String | Vercel Blob URL |
| File Size | Integer |
| Uploaded At | DateTime |
| Processed | Boolean |
| Processed At | DateTime |
| Processing Errors | Array<String> |

---

### 4. Cross-Reference Engine

#### Settlement Period

| Field | Type |
|-------|------|
| ID | UUID |
| Period Type | Enum | `monthly` / `quarterly` / `semi_annual` / `annual` |
| Start Date | Date |
| End Date | Date |
| Status | Enum | `open` / `processing` / `pending_approval` / `approved` / `invoiced` |
| Created At | DateTime |
| Created By | Reference (User) |

#### Cross-Reference Record

For each supplier-franchisee pair in a period:

| Field | Type |
|-------|------|
| ID | UUID |
| Period ID | Reference |
| Supplier ID | Reference |
| Franchisee ID | Reference |
| Supplier Amount | Decimal | Amount reported by supplier |
| Franchisee Amount | Decimal | Amount reported by franchisee |
| Difference | Decimal | Calculated: Supplier - Franchisee |
| Difference Absolute | Decimal | Math.abs(Difference) |
| Status | Enum | `matched` / `discrepancy` / `approved` / `adjusted` |
| Commission Rate | Decimal | Rate at time of calculation |
| Commission Amount | Decimal | Calculated commission |
| Notes | String |

**Matching Logic:**
- If `|Supplier Amount - Franchisee Amount| <= 10` → Status = `matched`
- Otherwise → Status = `discrepancy`

#### Adjustments

When Super User makes manual adjustments:

| Field | Type |
|-------|------|
| ID | UUID |
| Cross Reference ID | Reference |
| Adjustment Type | Enum | `credit` / `deposit` / `supplier_error` / `timing` / `other` |
| Amount | Decimal |
| Description | String |
| Created By | Reference (User) |
| Created At | DateTime |

**Predefined Adjustment Types:**
- `credit` - זיכוי
- `deposit` - פיקדון
- `supplier_error` - טעות ספק
- `timing` - הפרשי עיתוי
- `other` - אחר (requires description)

---

### 5. Commission Calculation

#### Calculation Rules

1. Commission is calculated **before VAT** (on net amount)
2. Commission rate is per supplier (same for all franchisees)
3. No minimum/maximum caps
4. No volume bonuses

#### Commission Record

| Field | Type |
|-------|------|
| ID | UUID |
| Period ID | Reference |
| Supplier ID | Reference |
| Brand ID | Reference | For invoice grouping |
| Total Purchases | Decimal | Sum of all franchisee purchases |
| Commission Rate | Decimal |
| Commission Amount | Decimal |
| Status | Enum | `calculated` / `approved` / `invoiced` |
| Approved By | Reference (User) |
| Approved At | DateTime |

**Important:** Invoices are generated **per brand**, not per supplier. A supplier working with all 3 brands will receive 3 separate invoices.

---

### 6. Email System

#### Email Templates

| Field | Type |
|-------|------|
| ID | UUID |
| Name | String |
| Type | Enum | `supplier_request` / `franchisee_request` / `reminder` / `custom` |
| Subject | String | Supports variables |
| Body | Text | React Email component content |
| Variables | Array<String> | Available merge fields |
| Active | Boolean |
| Created At | DateTime |
| Updated At | DateTime |

**Available Variables:**
- `{{entity_name}}` - Supplier/Franchisee name
- `{{period}}` - e.g., "Q3 2025"
- `{{upload_link}}` - Secure upload URL
- `{{deadline}}` - Due date
- `{{brand_name}}` - Brand name

#### Email Log

| Field | Type |
|-------|------|
| ID | UUID |
| Template ID | Reference |
| Recipient Email | String |
| Recipient Name | String |
| Entity Type | Enum | `supplier` / `franchisee` |
| Entity ID | Reference |
| Subject | String | Rendered |
| Status | Enum | `sent` / `delivered` / `bounced` / `failed` |
| Sent At | DateTime |
| Resend Message ID | String |
| Error | String |

#### Automated Email Schedule

| Trigger | Action |
|---------|--------|
| 1st of month | Send file requests to suppliers/franchisees (based on their frequency settings) |
| 5 days after request | Send reminder if file not uploaded |
| Custom reminder dates | Send franchisee contract/lease reminders |

---

### 7. Reports & Analytics

#### Required Reports (Phase 1)

1. **Network Commission Summary**
   - Total commissions for entire network
   - Breakdown by brand
   - Breakdown by period

2. **Supplier Report**
   - Per-supplier commission details
   - All franchisees that purchased from supplier
   - Historical comparison

3. **Franchisee Report**
   - Per-franchisee purchase details
   - All suppliers they purchased from

4. **Brand Report**
   - All commissions for a specific brand
   - Ready for invoice generation

5. **Variance Report** (New requirement)
   - Compare current period to previous periods
   - Flag suppliers with >10% variance in purchase percentage
   - Helps identify anomalies

#### Export Formats

- Excel (.xlsx) - Primary
- PDF - For formal reports
- Hashavshevet format - Future (preparation in Phase 1)

---

### 8. Analytics Dashboard (Phase 1 Basic)

#### Metrics to Display

- Total commissions this period
- Number of pending cross-references
- Number of discrepancies requiring attention
- Upload status (who uploaded, who didn't)
- Upcoming reminders

---

## Workflow

### Complete Settlement Workflow

```
┌─────────────────────────────────────────────────────────────────┐
│                    MONTHLY/QUARTERLY CYCLE                       │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ 1. TRIGGER (1st of month)                                        │
│    System checks which suppliers/franchisees need to report      │
│    based on their settlement frequency                           │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ 2. SEND REQUESTS                                                 │
│    - Generate secure upload links (14-day expiry)                │
│    - Send emails via Resend                                      │
│    - Log all sent emails                                         │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ 3. COLLECT FILES                                                 │
│    - Suppliers/Franchisees upload via secure link                │
│    - System marks upload complete                                │
│    - Notify Super User of new uploads                            │
│                                                                  │
│    [If no upload after 5 days → Send reminder]                   │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ 4. PROCESS FILES                                                 │
│    - Parse Excel files using supplier-specific mappings          │
│    - Match franchisee names using aliases                        │
│    - Extract amounts (handle VAT based on supplier settings)     │
│    - Store parsed data                                           │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ 5. CROSS-REFERENCE                                               │
│    For each Supplier-Franchisee pair:                            │
│    - Compare supplier amount vs franchisee amount                │
│    - If difference <= ₪10 → Mark as MATCHED                      │
│    - If difference > ₪10 → Mark as DISCREPANCY                   │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ 6. HANDLE DISCREPANCIES (Super User)                             │
│    Options:                                                      │
│    a) Add adjustment (credit, deposit, error, etc.)              │
│    b) Request corrected file from franchisee                     │
│    c) Approve with explanation                                   │
│                                                                  │
│    All actions logged with user and timestamp                    │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ 7. CALCULATE COMMISSIONS                                         │
│    - Apply commission rate per supplier                          │
│    - Calculate on amount BEFORE VAT                              │
│    - Group by brand for invoicing                                │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ 8. APPROVE SETTLEMENT (Super User)                               │
│    - Review all calculations                                     │
│    - Final approval locks the period                             │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ 9. GENERATE INVOICE REPORT                                       │
│    - One report per brand per supplier                           │
│    - Export to Excel (Hashavshevet format in future)             │
│    - Super User issues invoices manually                         │
└─────────────────────────────────────────────────────────────────┘
```

---

## Database Schema Overview

### Core Tables

```
users
├── id (UUID)
├── email
├── name
├── role (super_user / admin / franchisee_owner)
├── permissions (JSONB)
├── status (pending / active / inactive)
├── google_id
└── timestamps

brands
├── id (UUID)
├── name
├── code (pat_vini / mina_tomai / king_kong)
└── timestamps

suppliers
├── id (UUID)
├── name
├── company_id
├── address
├── primary_contact (JSONB)
├── secondary_contact (JSONB)
├── commission_rate
├── commission_type
├── settlement_frequency
├── vat_included
├── status
├── file_mapping (JSONB)
└── timestamps

supplier_commission_history
├── id (UUID)
├── supplier_id (FK)
├── old_rate
├── new_rate
├── changed_by (FK users)
├── effective_from
├── notes
└── created_at

franchisees
├── id (UUID)
├── brand_id (FK)
├── name
├── aliases (JSONB array)
├── company_id
├── address
├── primary_contact (JSONB)
├── owners (JSONB array)
├── opening_date
├── lease_option_end
├── franchise_agreement_end
├── status
└── timestamps

franchisee_status_history
├── id (UUID)
├── franchisee_id (FK)
├── old_status
├── new_status
├── changed_by (FK users)
├── reason
└── created_at

documents
├── id (UUID)
├── entity_type (supplier / franchisee)
├── entity_id (UUID)
├── document_type
├── file_url
├── file_name
├── uploaded_by (FK users)
├── notes
└── uploaded_at

reminders
├── id (UUID)
├── franchisee_id (FK)
├── reminder_type
├── reminder_date
├── days_before
├── recipients (JSONB array of user IDs)
├── status
├── notes
└── timestamps

upload_links
├── id (UUID)
├── token (unique)
├── entity_type
├── entity_id
├── period_start
├── period_end
├── expires_at
├── used_at
├── file_id (FK)
├── status
└── created_at

uploaded_files
├── id (UUID)
├── upload_link_id (FK)
├── entity_type
├── entity_id
├── period_start
├── period_end
├── original_filename
├── stored_url
├── file_size
├── processed
├── processed_at
├── processing_errors (JSONB)
└── uploaded_at

settlement_periods
├── id (UUID)
├── period_type
├── start_date
├── end_date
├── status
├── created_by (FK users)
└── timestamps

cross_references
├── id (UUID)
├── period_id (FK)
├── supplier_id (FK)
├── franchisee_id (FK)
├── supplier_amount
├── franchisee_amount
├── difference
├── status
├── commission_rate
├── commission_amount
├── notes
└── timestamps

adjustments
├── id (UUID)
├── cross_reference_id (FK)
├── adjustment_type
├── amount
├── description
├── created_by (FK users)
└── created_at

commissions
├── id (UUID)
├── period_id (FK)
├── supplier_id (FK)
├── brand_id (FK)
├── total_purchases
├── commission_rate
├── commission_amount
├── status
├── approved_by (FK users)
├── approved_at
└── timestamps

email_templates
├── id (UUID)
├── name
├── type
├── subject
├── body
├── variables (JSONB)
├── active
└── timestamps

email_logs
├── id (UUID)
├── template_id (FK)
├── recipient_email
├── recipient_name
├── entity_type
├── entity_id
├── subject
├── status
├── sent_at
├── resend_message_id
├── error
└── timestamps
```

---

## UI/UX Requirements

### General

- **Language:** Hebrew (RTL)
- **Responsive:** Desktop-first, mobile-friendly
- **Framework:** shadcn/ui components
- **Theme:** Custom branding (to be provided)

### Key Screens

1. **Dashboard**
   - Period status overview
   - Pending actions count
   - Recent uploads
   - Upcoming reminders

2. **Suppliers List**
   - Filterable table
   - Quick status toggle
   - Link to supplier card

3. **Supplier Card**
   - All supplier details
   - Commission history
   - Documents
   - Upload history
   - Cross-reference history

4. **Franchisees List**
   - Filterable by brand
   - Status indicators
   - Link to franchisee card

5. **Franchisee Card**
   - All details including aliases
   - Documents
   - Reminders management
   - Purchase history

6. **Cross-Reference View**
   - Table showing all supplier-franchisee pairs
   - Color coding: green (matched), red (discrepancy), yellow (pending)
   - Filter by status
   - Bulk approve matched items

7. **Discrepancy Resolution**
   - Side-by-side comparison
   - Add adjustment form
   - Approval workflow

8. **Reports**
   - Report type selector
   - Date range picker
   - Preview + Export

9. **Settings**
   - Email templates
   - Adjustment types
   - User management

### Public Pages

1. **Secure Upload Page** (`/upload/[token]`)
   - Validates token
   - Shows what's being requested
   - Drag & drop upload
   - Success confirmation

---

## Security Requirements

1. **Authentication**
   - Google OAuth only
   - Session-based with Better Auth
   - Role-based access control

2. **Upload Links**
   - UUID v4 tokens
   - 14-day expiry
   - Single use
   - No authentication required (public page)

3. **Data Protection**
   - All data encrypted in transit (HTTPS)
   - Database backups (daily)
   - Vercel Blob for file storage

4. **Audit Trail**
   - Log all sensitive actions
   - User, timestamp, action, before/after values

---

## Phase 1 Scope Summary

### Included ✅

- User management with roles and permissions
- Supplier management (CRUD, documents, history)
- Franchisee management (CRUD, documents, aliases, reminders)
- Secure file upload via email links
- Excel file parsing with supplier-specific mappings
- Cross-reference engine with discrepancy detection
- Manual adjustment system
- Commission calculation per brand
- Automated emails (requests + reminders)
- Basic reporting (Excel export)
- Dashboard with key metrics
- Variance detection (>10% flag)

### Not Included (Future Phases) ❌

- Franchisee portal (view their own data)
- P&L reports from Hashavshevet
- Dividend management
- Food cost tracking
- Task management system
- Direct Hashavshevet integration for invoicing
- Per-item commission in system (handled manually)
- Employee contracts (101) system
- Branch comparison heat map

---

## Success Metrics

1. **Time Saved:** Reduce quarterly processing time from X hours to Y hours
2. **Accuracy:** Zero calculation errors
3. **Visibility:** 100% of discrepancies identified automatically
4. **Compliance:** All settlements approved before invoice deadline

---

## Appendix

### A. Sample Supplier File Formats

| Supplier | Format Notes |
|----------|--------------|
| Fresco | Detailed line items, includes SKU, quantity, amount, date |
| Kill Bill | Pivot table + raw data, includes deposit rows to skip |
| Regba | Summary per supplier (this is franchisee report) |
| Restreto | Monthly summary per customer |
| Taviot HaTzafon | Split by month, needs quarterly aggregation |

### B. Brands

| Code | Hebrew Name | English Name |
|------|-------------|--------------|
| pat_vini | פט ויני | Pat Vini |
| mina_tomai | מינה טומיי | Mina Tomai |
| king_kong | קינג קונג | King Kong |

### C. Settlement Frequencies

| Code | Hebrew | Description |
|------|--------|-------------|
| monthly | חודשי | Every month |
| quarterly | רבעוני | Every 3 months |
| semi_annual | חצי שנתי | Every 6 months |
| annual | שנתי | Once a year |
