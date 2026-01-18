# Implementation Plan: Supplier Files Review Queue

## Overview

Build a review queue system for supplier files that mirrors the existing BKMVDATA review system. Files with incomplete franchisee matching enter a queue for manual review, matching, and approval.

---

## Phase 1: Database Schema

Add new tables to track supplier file uploads and blacklist.

### Tasks

- [ ] Add `supplierFileUpload` table to schema
- [ ] Add `supplierFileBlacklist` table to schema
- [ ] Add TypeScript types for `SupplierFileProcessingResult`
- [ ] Generate and run database migration

### Technical Details

**Schema definitions to add to `src/db/schema.ts`:**

```typescript
// Supplier file upload table
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

// Blacklist for irrelevant franchisee names in supplier files
export const supplierFileBlacklist = pgTable(
  "supplier_file_blacklist",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    normalizedName: text("normalized_name").notNull().unique(),
    supplierId: text("supplier_id").references(() => supplier.id, { onDelete: "cascade" }),
    notes: text("notes"),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").$defaultFn(() => new Date()).notNull(),
  },
  (table) => [
    index("idx_supplier_file_blacklist_normalized").on(table.normalizedName),
  ]
);
```

**TypeScript type for processing result:**

```typescript
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
  }>;

  processedAt: string;
}
```

**Migration command:**
```bash
npm run db:generate
npm run db:migrate
```

---

## Phase 2: Data Access Layer

Create functions to interact with the new tables.

### Tasks

- [ ] Create `src/data-access/supplier-file-uploads.ts` with CRUD functions
- [ ] Add functions for processing status updates
- [ ] Add functions for review workflow (approve/reject)
- [ ] Create `src/data-access/supplier-file-blacklist.ts` for blacklist operations

### Technical Details

**File: `src/data-access/supplier-file-uploads.ts`**

Key functions:
```typescript
// Get all files needing review
export async function getSupplierFilesNeedingReview()

// Get single file by ID with supplier info
export async function getSupplierFileById(fileId: string)

// Create new upload record
export async function createSupplierFileUpload(data: NewSupplierFileUpload)

// Update processing result
export async function updateSupplierFileProcessing(
  fileId: string,
  result: SupplierFileProcessingResult,
  status: "auto_approved" | "needs_review"
)

// Approve/reject file
export async function reviewSupplierFile(
  fileId: string,
  action: "approve" | "reject",
  reviewedBy: string,
  notes?: string
)

// Update single match (for manual matching)
export async function updateSupplierFileMatch(
  fileId: string,
  originalName: string,
  franchiseeId: string,
  franchiseeName: string
)

// Get count of files needing review (for badge)
export async function getSupplierFileReviewCount(): Promise<number>
```

**File: `src/data-access/supplier-file-blacklist.ts`**

Key functions:
```typescript
export async function getAllBlacklisted()
export async function isBlacklisted(name: string): Promise<boolean>
export async function addToBlacklist(name: string, createdBy?: string, notes?: string, supplierId?: string)
export async function removeFromBlacklist(id: string)
export function normalizeSupplierFileName(name: string): string
```

---

## Phase 3: API Endpoints

Create REST API endpoints for the review queue.

### Tasks

- [ ] Create `GET /api/supplier-files/review` - list files needing review
- [ ] Create `POST /api/supplier-files/review` - approve/reject file
- [ ] Create `GET /api/supplier-files/review/[fileId]` - get file details
- [ ] Create `PATCH /api/supplier-files/review/[fileId]` - update match
- [ ] Create `GET/POST/DELETE /api/supplier-files/blacklist` - blacklist management
- [ ] Create `GET /api/supplier-files/review/count` - count for badge

### Technical Details

**File: `src/app/api/supplier-files/review/route.ts`**

```typescript
// GET - List files needing review
export async function GET(req: NextRequest) {
  // Auth check
  // Call getSupplierFilesNeedingReview()
  // Return files with supplier info
}

// POST - Approve or reject
export async function POST(req: NextRequest) {
  // Body: { fileId, action: "approve" | "reject", notes? }
  // Auth check
  // Call reviewSupplierFile()
  // Create audit log
}
```

**File: `src/app/api/supplier-files/review/[fileId]/route.ts`**

```typescript
// GET - File details with matches
export async function GET(req: NextRequest, { params }) {
  // Auth check
  // Call getSupplierFileById()
  // Enrich franchisee matches with current codes
}

// PATCH - Update match
export async function PATCH(req: NextRequest, { params }) {
  // Body: { originalName, franchiseeId, addAsAlias: boolean }
  // Update processing result
  // If addAsAlias, update franchisee.aliases
  // Recalculate match stats
}
```

**File: `src/app/api/supplier-files/blacklist/route.ts`**

```typescript
// GET - List all blacklisted
// POST - Add to blacklist { name, notes?, supplierId? }
// DELETE - Remove from blacklist (query param: id)
```

---

## Phase 4: Review Queue UI

Create the review queue list page.

### Tasks

- [ ] Create `src/app/(protected)/admin/supplier-files/review/page.tsx`
- [ ] Add summary cards (pending, approved, rejected counts)
- [ ] Add files table with match stats
- [ ] Add approve/reject dialogs
- [ ] Add navigation from supplier-files page

### Technical Details

**File: `src/app/(protected)/admin/supplier-files/review/page.tsx`**

UI Components needed:
- 3 summary cards at top
- Table with columns: supplier, filename, date, exact/fuzzy/unmatched counts, actions
- Approve dialog (optional notes)
- Reject dialog (mandatory notes)

Use TanStack Query for data fetching:
```typescript
const { data, isLoading } = useQuery({
  queryKey: ["supplier-files", "review"],
  queryFn: async () => {
    const res = await fetch("/api/supplier-files/review");
    return res.json();
  },
  refetchInterval: 30000,
});
```

Use mutations for approve/reject:
```typescript
const approveMutation = useMutation({
  mutationFn: async ({ fileId, notes }) => {
    const res = await fetch("/api/supplier-files/review", {
      method: "POST",
      body: JSON.stringify({ fileId, action: "approve", notes }),
    });
    return res.json();
  },
  onSuccess: () => queryClient.invalidateQueries(["supplier-files", "review"]),
});
```

---

## Phase 5: File Detail UI [complex]

Create the detailed file review page with match editing.

### Tasks

- [ ] Create `src/app/(protected)/admin/supplier-files/review/[fileId]/page.tsx`
  - [ ] File info card (supplier, filename, size, dates)
  - [ ] Match statistics card
  - [ ] Franchisee matches table with status badges
  - [ ] Edit match dialog with franchisee dropdown
  - [ ] Add as alias checkbox
  - [ ] Blacklist dialog
  - [ ] Approve/reject buttons

### Technical Details

**File: `src/app/(protected)/admin/supplier-files/review/[fileId]/page.tsx`**

Match status badges:
- `100%` - Green badge for exact matches
- `85%` - Yellow badge with confidence for fuzzy
- `Unmatched` - Red badge
- `Manual` - Blue badge for manually matched
- `Blacklisted` - Gray badge

Edit Match Dialog:
```tsx
<Dialog open={!!editingMatch} onOpenChange={() => setEditingMatch(null)}>
  <DialogContent>
    <DialogHeader>
      <DialogTitle>עריכת התאמה</DialogTitle>
      <DialogDescription>
        בחר זכיין עבור "{editingMatch?.originalName}"
      </DialogDescription>
    </DialogHeader>

    {/* Search input */}
    <Input
      placeholder="חיפוש זכיין..."
      value={franchiseeSearch}
      onChange={(e) => setFranchiseeSearch(e.target.value)}
    />

    {/* Franchisee list */}
    <div className="max-h-60 overflow-y-auto">
      {filteredFranchisees.map(f => (
        <div
          key={f.id}
          onClick={() => setSelectedFranchisee(f.id)}
          className={cn(
            "p-2 cursor-pointer hover:bg-muted",
            selectedFranchisee === f.id && "bg-primary/10"
          )}
        >
          {f.name} ({f.code})
        </div>
      ))}
    </div>

    {/* Add as alias checkbox */}
    <div className="flex items-center gap-2">
      <Checkbox
        id="addAsAlias"
        checked={addAsAlias}
        onCheckedChange={setAddAsAlias}
      />
      <label htmlFor="addAsAlias">הוסף ככינוי לזכיין</label>
    </div>

    <DialogFooter>
      <Button variant="outline" onClick={() => setEditingMatch(null)}>
        ביטול
      </Button>
      <Button onClick={handleSaveMatch} disabled={!selectedFranchisee}>
        שמירה
      </Button>
    </DialogFooter>
  </DialogContent>
</Dialog>
```

API mutation for updating match:
```typescript
const updateMatchMutation = useMutation({
  mutationFn: async ({ originalName, franchiseeId, addAsAlias }) => {
    const res = await fetch(`/api/supplier-files/review/${fileId}`, {
      method: "PATCH",
      body: JSON.stringify({ originalName, franchiseeId, addAsAlias }),
    });
    return res.json();
  },
  onSuccess: () => {
    queryClient.invalidateQueries(["supplier-files", "review", fileId]);
  },
});
```

---

## Phase 6: Integration & Badge

Update existing components to integrate with the review queue.

### Tasks

- [ ] Update upload page to save files to DB after processing
- [ ] Determine review status based on match results
- [ ] Add badge to sidebar for files needing review
- [ ] Add "Review Queue" link button on upload page

### Technical Details

**Update `src/app/(protected)/admin/supplier-files/page.tsx`:**

After processing a file, save to DB:
```typescript
// After processSupplierFile() succeeds
const processingResult: SupplierFileProcessingResult = {
  totalRows: result.summary.totalRows,
  processedRows: result.summary.processedRows,
  skippedRows: result.summary.skippedRows,
  totalGrossAmount: result.summary.totalGrossAmount,
  totalNetAmount: result.summary.totalNetAmount,
  vatAdjusted: result.summary.vatAdjusted,
  matchStats: {
    total: result.matchSummary.total,
    exactMatches: result.matchSummary.matched,
    fuzzyMatches: result.matchSummary.needsReview,
    unmatched: result.matchSummary.unmatched,
  },
  franchiseeMatches: result.data.map(row => ({
    originalName: row.franchisee,
    rowNumber: row.rowNumber,
    grossAmount: row.grossAmount,
    netAmount: row.netAmount,
    matchedFranchiseeId: row.matchResult?.matchedFranchisee?.id || null,
    matchedFranchiseeName: row.matchResult?.matchedFranchisee?.name || null,
    confidence: row.matchResult?.confidence || 0,
    matchType: determineMatchType(row.matchResult),
    requiresReview: row.matchResult?.requiresReview || true,
  })),
  processedAt: new Date().toISOString(),
};

// Determine status
const status = processingResult.matchStats.unmatched === 0 &&
               processingResult.matchStats.fuzzyMatches === 0
  ? "auto_approved"
  : "needs_review";

// Save to DB
await fetch("/api/supplier-files/upload", {
  method: "POST",
  body: JSON.stringify({
    supplierId: selectedSupplierId,
    fileName: file.name,
    fileSize: file.size,
    processingResult,
    status,
  }),
});
```

**Update `src/components/sidebar.tsx`:**

Add query for supplier files review count (similar to BKMVDATA):
```typescript
const { data: supplierFilesReviewData } = useQuery({
  queryKey: ["supplier-files", "review", "count"],
  queryFn: async () => {
    const response = await fetch("/api/supplier-files/review/count");
    if (!response.ok) return { count: 0 };
    return response.json();
  },
  enabled: isSuperUserOrAdmin,
  refetchInterval: 60000,
  staleTime: 30000,
});

const supplierFilesNeedingReviewCount = supplierFilesReviewData?.count || 0;
```

Add badge to the supplier files nav item:
```typescript
{
  label: he.sidebar.subNavigation.supplierFiles,
  href: "/admin/supplier-files",
  icon: <FileUp className="h-4 w-4" />,
  badge: supplierFilesNeedingReviewCount > 0 ? supplierFilesNeedingReviewCount : null,
},
```

---

## Verification

- [ ] Upload a supplier file → saved to DB with processing result
- [ ] File with unmatched names appears in review queue
- [ ] Can view file details with all matches
- [ ] Can manually select franchisee for unmatched row
- [ ] "Add as alias" saves to franchisee.aliases
- [ ] Can mark name as blacklisted
- [ ] Approve/reject updates status and removes from queue
- [ ] Badge in sidebar shows correct count
- [ ] Re-uploading same file with blacklisted names skips them
