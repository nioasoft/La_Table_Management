# Graph Report - src  (2026-04-11)

## Corpus Check
- Large corpus: 550 files · ~454,595 words. Semantic extraction will be expensive (many Claude tokens). Consider running on a subfolder, or use --no-semantic to run AST-only.

## Summary
- 1788 nodes · 2974 edges · 43 communities detected
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS · INFERRED: 7 edges (avg confidence: 0.89)
- Token cost: 0 input · 0 output

## God Nodes (most connected - your core abstractions)
1. `GET()` - 37 edges
2. `POST()` - 19 edges
3. `Validation Schemas (README)` - 18 edges
4. `logAuditEvent()` - 14 edges
5. `formatDateHe()` - 13 edges
6. `formatCurrency()` - 12 edges
7. `transitionSettlementStatus()` - 10 edges
8. `processFrequency()` - 9 edges
9. `parseSupplierFile()` - 9 edges
10. `getUserById()` - 9 edges

## Surprising Connections (you probably didn't know these)
- `Validation Schemas (README)` --references--> `periodKeySchema`  [EXTRACTED]
  src/lib/validations/README.md → src/lib/validations/report-schemas.ts
- `Validation Schemas (README)` --references--> `paginationSchema`  [EXTRACTED]
  src/lib/validations/README.md → src/lib/validations/report-schemas.ts
- `Validation Schemas (README)` --references--> `dateRangeSchema`  [EXTRACTED]
  src/lib/validations/README.md → src/lib/validations/report-schemas.ts
- `Validation Schemas (README)` --references--> `depositsFiltersSchema`  [EXTRACTED]
  src/lib/validations/README.md → src/lib/validations/report-schemas.ts
- `Validation Schemas (README)` --references--> `unauthorizedSuppliersFiltersSchema`  [EXTRACTED]
  src/lib/validations/README.md → src/lib/validations/report-schemas.ts

## Communities

### Community 0 - "UI Dialogs & Components"
Cohesion: 0.02
Nodes (18): handleAddAlias(), handleKeyDown(), handleRemoveAlias(), getStatusBadgeVariant(), getStatusLabel(), handleSaveAndTest(), handleSubmit(), stripHtmlTags() (+10 more)

### Community 1 - "App Pages & Routing"
Cohesion: 0.01
Nodes (30): checkForDuplicateExport(), fetchCommissionHistory(), fetchFranchiseeDocuments(), fetchSettlement(), fetchStatusHistory(), fetchSupplierDocuments(), formatDate(), formatDateRange() (+22 more)

### Community 2 - "Supplier File Parsers"
Cohesion: 0.02
Nodes (104): createResult(), parseAleAleFile(), parseHebrewDate(), createResult(), parseArelArizotFile(), createResult(), parseAspiritFile(), createResult() (+96 more)

### Community 3 - "Cibus & Account Classification"
Cohesion: 0.03
Nodes (53): autoClassifyAccount(), classifyAccounts(), classifyByAccountKeyPrefix(), classifyBkmvFile(), classifyFromB100(), classifyFromB110(), countHebrew(), decodeBuffer() (+45 more)

### Community 4 - "PDF Report Generation"
Cohesion: 0.04
Nodes (78): autoCreateRemindersFromFranchisees(), autoCreateRemindersFromImportantDates(), calculateDueDate(), calculateMatchCommission(), calculateNextRequestDate(), createAllDetailsSheet(), createAllSuppliersSheet(), createBrandInvoiceSheet() (+70 more)

### Community 5 - "Scripts & Auth Client"
Cohesion: 0.03
Nodes (18): addFranchiseeRevenueCodes(), getFranchiseeRevenueCodesList(), setFranchiseeRevenueCodes(), extractPeriodFromSubject(), resolvePeriod(), ErrorBoundary, getCommissionReportData(), getFranchiseeReportData() (+10 more)

### Community 6 - "Date Utils & Franchisee Dates"
Cohesion: 0.03
Nodes (13): copyImportantDate(), createImportantDate(), getImportantDateById(), updateImportantDate(), getFranchiseeReminderById(), getFranchiseeReminders(), getFranchiseeReminderStats(), markReminderAsHandled() (+5 more)

### Community 7 - "BKMV Year & Brand Management"
Cohesion: 0.03
Nodes (11): createBrand(), getActiveBrands(), getBrandByCode(), getBrandById(), getBrands(), getBrandStats(), getOtherBrand(), isBrandCodeUnique() (+3 more)

### Community 8 - "Email Templates"
Cohesion: 0.04
Nodes (23): getEmailLogs(), getEmailLogStats(), getEmailTemplateByCode(), getEmailTemplateById(), getEmailTemplates(), getEmailTemplateStats(), isTemplateCodeUnique(), toggleEmailTemplateStatus() (+15 more)

### Community 9 - "Admin Dashboard & Actions"
Cohesion: 0.06
Nodes (14): getAnnualPeriods(), getAvailablePeriodsForSupplier(), getMonthlyPeriods(), getOpenPeriods(), getPeriodsForFrequency(), getPeriodsForYear(), getQuarterlyPeriods(), getSemiAnnualPeriods() (+6 more)

### Community 10 - "Commission CRUD Operations"
Cohesion: 0.06
Nodes (39): approveCommission(), bulkApproveCommissions(), bulkMarkCommissionsAsPaid(), bulkSetCommissionInvoiceInfo(), calculateAndCreateCommission(), calculateBatchCommissions(), cancelCommission(), createCommission() (+31 more)

### Community 11 - "Drizzle Errors & History Table"
Cohesion: 0.04
Nodes (10): getDatabaseError(), isConnectionError(), isUniqueViolation(), addToReviewQueue(), bulkApproveComparisons(), getSessionById(), getSessionWithComparisons(), recalculateSessionStats() (+2 more)

### Community 12 - "Business ID & ZIP Parsers"
Cohesion: 0.06
Nodes (26): businessIdsMatch(), createNormalizedBusinessIdMap(), normalizeBusinessId(), createResult(), isZipFile(), parseDageiHakibbutzimFile(), parseExcelDate(), parseSingleXlsx() (+18 more)

### Community 13 - "Adjustments Management"
Cohesion: 0.08
Nodes (34): approveAdjustment(), deleteAdjustment(), getAdjustmentById(), getAdjustments(), getAdjustmentStats(), updateAdjustment(), createAuditLogEntry(), getAuditLogs() (+26 more)

### Community 14 - "BKMV Blacklist"
Cohesion: 0.08
Nodes (32): addToBlacklist(), filterBlacklistedNames(), getAllBlacklisted(), getBlacklistById(), getBlacklistByName(), getBlacklistedNamesSet(), isBlacklisted(), normalizeSupplierName() (+24 more)

### Community 15 - "Pagination & Supplier CRUD"
Cohesion: 0.06
Nodes (14): createCommissionHistoryEntry(), createSupplier(), getSupplierBrands(), getSupplierByCode(), getSupplierById(), getSupplierFileMapping(), getSupplierMaxUploadFiles(), getSuppliers() (+6 more)

### Community 16 - "Fund Reports & Pasta Parser"
Cohesion: 0.08
Nodes (22): getFranchiseeFundReport(), getQuarterDateRange(), createResult(), extractFranchiseeFromFilename(), isZipFile(), mapSheetNameToFranchisee(), parsePastaLaCasaFile(), parseSheetData() (+14 more)

### Community 17 - "Upload Links & File Management"
Cohesion: 0.07
Nodes (11): calculateExpiryDate(), cancelUploadLink(), createUploadLink(), generateFranchiseeUploadLink(), generateSecureUploadLink(), generateSecureUUIDToken(), generateSupplierUploadLink(), getUploadLinksByEntity() (+3 more)

### Community 18 - "Cross-Reference Reconciliation"
Cohesion: 0.1
Nodes (15): compareAmounts(), createComparisonCrossReference(), createCrossReference(), findOrCreateCrossReference(), generateReconciliationReport(), getComparisonsByPeriod(), getCrossReferenceById(), performBulkComparison() (+7 more)

### Community 19 - "Settlement Periods Workflow"
Cohesion: 0.12
Nodes (21): approveSettlementPeriod(), approveSettlementWithValidation(), calculatePeriodDates(), cancelSettlementPeriod(), createSettlementPeriod(), createSettlementPeriodWithType(), generatePeriodName(), getAllowedNextStatuses() (+13 more)

### Community 20 - "Validation Schemas (Zod)"
Cohesion: 0.09
Nodes (25): Rationale: Schemas Enforce Business Rules, Rationale: z.coerce for Automatic Type Coercion, Rationale: Hebrew Error Messages, CommissionFilters (type), DepositsFilters (type), Pagination (type), PeriodKey (type), UUID (type) (+17 more)

### Community 21 - "User Management"
Cohesion: 0.12
Nodes (11): approveUser(), findUserById(), getUserById(), getUserPermissions(), getUsers(), getUserStats(), isAdminOrSuperUser(), isSuperUser() (+3 more)

### Community 22 - "File Requests"
Cohesion: 0.18
Nodes (17): cancelFileRequest(), createFileRequest(), enrichFileRequest(), getFileRequestById(), getFileRequests(), getFileRequestsForEntity(), getFileRequestStats(), getPendingScheduledRequests() (+9 more)

### Community 23 - "Client Document Processing"
Cohesion: 0.12
Nodes (8): generateFileName(), getAllowedMimeTypes(), getMaxFileSize(), isAllowedFileType(), isFileSizeValid(), uploadDocument(), parseHebrewPeriod(), parseTabitFile()

### Community 24 - "Client Reconciliation Sessions"
Cohesion: 0.11
Nodes (2): recalculateSessionStats(), updateComparisonStatus()

### Community 25 - "Email Editor (Lexical)"
Cohesion: 0.13
Nodes (6): getTextAfterElement(), removeElementAndFollowing(), removeTrailingSignature(), stripEmailFooter(), inlineEmailStyles(), styleContentElements()

### Community 26 - "Formatters & Client Parsers"
Cohesion: 0.15
Nodes (7): formatCurrency(), formatNumber(), formatPercent(), getNestedValue(), interpolate(), t(), ts()

### Community 27 - "Client Documents CRUD"
Cohesion: 0.13
Nodes (0): 

### Community 28 - "Mitland Parser"
Cohesion: 0.25
Nodes (14): createResult(), getCellLabel(), isFranchiseeNameRow(), isReportTotalRow(), isTotalRow(), parseMitlandFile(), parseNumericValue(), createResult() (+6 more)

### Community 29 - "Permissions System"
Cohesion: 0.22
Nodes (8): canApprove(), canCreate(), canDelete(), canEdit(), canView(), getEffectivePermissions(), getModulePermissions(), hasPermission()

### Community 30 - "Management Companies"
Cohesion: 0.22
Nodes (10): createManagementCompany(), generateInvoiceNumber(), getManagementCompanies(), getManagementCompanyByCode(), getManagementCompanyById(), getManagementCompanyStats(), getNextInvoiceNumber(), isManagementCompanyCodeUnique() (+2 more)

### Community 31 - "Clients CRUD"
Cohesion: 0.17
Nodes (0): 

### Community 32 - "Documents CRUD"
Cohesion: 0.17
Nodes (0): 

### Community 33 - "Supplier File Blacklist"
Cohesion: 0.27
Nodes (8): addToBlacklist(), filterBlacklistedNames(), getAllBlacklisted(), getBlacklistByName(), getBlacklistedNamesSet(), isBlacklisted(), normalizeSupplierFileName(), removeFromBlacklistByName()

### Community 34 - "API Auth Middleware"
Cohesion: 0.36
Nodes (7): forbiddenResponse(), requireAdminOrSuperUser(), requireAnyAuthenticatedUser(), requireAuth(), requireRole(), requireSuperUser(), unauthorizedResponse()

### Community 35 - "Commission Invoice Verification"
Cohesion: 0.31
Nodes (3): getClientCommissionRate(), getInvoiceVerification(), getInvoiceVerificationSummary()

### Community 36 - "Date Input Component"
Cohesion: 0.42
Nodes (7): clampAndEmit(), getDaysInMonth(), handleContainerBlur(), handleDayChange(), handleMonthChange(), handleYearChange(), set()

### Community 37 - "Franchisee BKMV Year Data"
Cohesion: 0.28
Nodes (3): extractMonthsCovered(), upsertBkmvYearData(), upsertFromFullBreakdown()

### Community 38 - "Franchisee Account Classifications"
Cohesion: 0.43
Nodes (5): bulkSetClassifications(), removeClassification(), removeRevenueCode(), setClassification(), syncRevenueCode()

### Community 39 - "Proxy & Rate Limiting"
Cohesion: 0.33
Nodes (2): checkRateLimit(), cleanupExpired()

### Community 40 - "File Type Validation"
Cohesion: 0.83
Nodes (3): hasExecutableSignature(), isValidTextFile(), validateFileType()

### Community 41 - "Client Parser Codes"
Cohesion: 0.67
Nodes (0): 

### Community 42 - "Report Pagination Hook"
Cohesion: 1.0
Nodes (0): 

## Knowledge Gaps
- **15 isolated node(s):** `sortDirectionSchema`, `unauthorizedSuppliersFiltersSchema`, `varianceFiltersSchema`, `invoiceFiltersSchema`, `batchDeleteSchema` (+10 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **Thin community `Report Pagination Hook`** (2 nodes): `use-report-pagination.ts`, `useReportPagination()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **What connects `sortDirectionSchema`, `unauthorizedSuppliersFiltersSchema`, `varianceFiltersSchema` to the rest of the system?**
  _15 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `UI Dialogs & Components` be split into smaller, more focused modules?**
  _Cohesion score 0.02 - nodes in this community are weakly interconnected._
- **Should `App Pages & Routing` be split into smaller, more focused modules?**
  _Cohesion score 0.01 - nodes in this community are weakly interconnected._
- **Should `Supplier File Parsers` be split into smaller, more focused modules?**
  _Cohesion score 0.02 - nodes in this community are weakly interconnected._
- **Should `Cibus & Account Classification` be split into smaller, more focused modules?**
  _Cohesion score 0.03 - nodes in this community are weakly interconnected._
- **Should `PDF Report Generation` be split into smaller, more focused modules?**
  _Cohesion score 0.04 - nodes in this community are weakly interconnected._
- **Should `Scripts & Auth Client` be split into smaller, more focused modules?**
  _Cohesion score 0.03 - nodes in this community are weakly interconnected._