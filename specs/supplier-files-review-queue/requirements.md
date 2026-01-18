# Requirements: Supplier Files Review Queue

## Overview

Create a review queue system for supplier commission files, mirroring the existing BKMVDATA (מבנה אחיד) system. When supplier files are uploaded and processed, those with incomplete franchisee matching (not 100%) enter a review queue for manual verification and approval.

## Background

- **BKMVDATA**: Franchisee files → matches **suppliers** (existing system)
- **Supplier Files**: Supplier files → matches **franchisees** (this feature)

Both systems follow the same workflow pattern but operate on opposite data relationships.

## User Stories

### As an Admin
1. I want to see a list of supplier files that need review so I can process them
2. I want to view detailed matching results for each file so I can verify accuracy
3. I want to manually assign franchisees to unmatched rows so the data is complete
4. I want to add aliases when I manually match so future files match automatically
5. I want to mark irrelevant names (like "total" or "summary" rows) as blacklisted so they don't appear in future reviews
6. I want to approve or reject files after review so they move out of the queue

### As a Super User
1. I want a badge in the sidebar showing how many files need review so I'm aware of pending work

## Acceptance Criteria

### File Upload & Processing
- [ ] When a supplier file is uploaded, it is saved to the database with processing results
- [ ] Files with 100% franchisee match rate are auto-approved
- [ ] Files with unmatched or fuzzy matches enter the review queue (status: `needs_review`)

### Review Queue Page (`/admin/supplier-files/review`)
- [ ] Displays list of all files with `needs_review` status
- [ ] Shows summary cards: pending count, approved today, rejected today
- [ ] Table shows: supplier name, file name, upload date, match stats (exact/fuzzy/unmatched)
- [ ] Can click a file to view details
- [ ] Can approve/reject files directly from the list

### File Detail Page (`/admin/supplier-files/review/[fileId]`)
- [ ] Shows file info: supplier, filename, size, upload date, period
- [ ] Shows match statistics summary
- [ ] Table of all franchisee matches with:
  - Original name from file
  - Amount
  - Matched franchisee (if any)
  - Match confidence/status (100%, fuzzy %, unmatched)
- [ ] Edit button for each row to manually select franchisee
- [ ] Option to "Add as alias" when manually matching
- [ ] Blacklist button for unmatched rows to mark as irrelevant
- [ ] Approve/Reject buttons with optional notes

### Manual Matching
- [ ] Dialog to select franchisee from dropdown with search
- [ ] Checkbox to add the original name as alias for future matching
- [ ] When alias is added, it's saved to `franchisee.aliases` array
- [ ] Match stats update immediately in UI

### Blacklist System
- [ ] Can mark names as "not relevant" with optional notes
- [ ] Blacklisted names stored in dedicated table
- [ ] Future processing skips blacklisted names automatically
- [ ] Admin can view/manage blacklist

### Sidebar Badge
- [ ] Show count of files needing review next to "Supplier Files" menu item
- [ ] Same pattern as BKMVDATA badge
- [ ] Refresh every 60 seconds

## Dependencies

- Existing supplier file processing system (`/admin/supplier-files`)
- Existing franchisee matching logic (`src/lib/franchisee-matcher.ts`)
- Existing file processor (`src/lib/file-processor.ts`)
- Existing BKMVDATA review system (pattern reference)

## Out of Scope

- Automatic commission creation from approved files (separate feature)
- Email notifications for pending reviews
- Bulk file processing
