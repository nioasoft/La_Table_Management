"use client";

import { fetchWithTimeout } from "@/lib/fetch-with-timeout";
import React, { useState, useCallback, useRef, useMemo, type DragEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Textarea } from "@/components/ui/textarea";
import {
  FileUp,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  FileSpreadsheet,
  RefreshCw,
  ChevronDown,
  ChevronRight,
  Upload,
  Eye,
  Edit,
  Ban,
  Check,
  Plus,
  ClipboardList,
  Save,
  BarChart3,
} from "lucide-react";
import Link from "next/link";
import { withBack } from "@/lib/back-link";
import { toast } from "sonner";
import type { Supplier, SupplierFileMapping, Franchisee, SupplierFileProcessingResult } from "@/db/schema";
import { formatCurrency } from "@/lib/translations";
import { formatDateAsLocal } from "@/lib/date-utils";
import { hasCustomParser } from "@/lib/custom-parsers/custom-parser-codes";
import { SupplierCombobox } from "@/components/supplier-files/supplier-combobox";
import { UploadHistoryPanel } from "@/components/supplier-files/upload-history-panel";
import { PeriodSelector, type PeriodWithStatus } from "@/components/supplier-files/period-selector";
import { OverwriteConfirmDialog } from "@/components/supplier-files/overwrite-confirm-dialog";
import { AnomalyReviewModal } from "@/components/supplier-files/anomaly-review-modal";
import { useSupplierFileReviewCount } from "@/queries/supplier-file-uploads";
import { getPeriodByKey } from "@/lib/settlement-periods";
import type { Anomaly, AnomalyAction } from "@/types/file-anomalies";
import { looksLikeHtmlTableFile } from "@/lib/html-table-file";

/**
 * Convert XLS file to XLSX format in the browser. Vercel WAF blocks raw XLS
 * uploads, so legacy BIFF files must be re-encoded client-side before POST.
 *
 * Critical: SheetJS's browser bundle ships without the full Windows codepage
 * tables. Without them, BIFF cells stored in CP1255 (Hebrew), CP1251
 * (Cyrillic), etc., get decoded as Latin-1 and turn into mojibake — e.g. the
 * Hebrew title "ריכוז מכירות ללקוחות" arrives at the server as
 * "øéëåæ îëéøåú ìì÷åçåú", breaking compact-layout detection in
 * arel-arizot-parser. set_cptable + cpexcel.full registers the full codepage
 * map so the read step decodes correctly. (Node SSR has the codepage table
 * loaded by default, which is why this only manifests in production after
 * the browser-side conversion.)
 *
 * Files that are really HTML tables under a .xls name (ימה וקדמה) skip the
 * re-encode entirely: SheetJS either throws on them or mangles their Hebrew,
 * and the server parsers sniff content rather than the extension. The rename
 * alone is what the WAF needs.
 */
/** Tell the server which settlement period the admin picked for this upload. */
function appendChosenPeriod(formData: FormData, periodKey: string): void {
  const period = getPeriodByKey(periodKey);
  if (!period) return;
  formData.append("periodStartDate", formatDateAsLocal(period.startDate));
  formData.append("periodEndDate", formatDateAsLocal(period.endDate));
}

async function convertXlsToXlsx(file: File): Promise<File> {
  const arrayBuffer = await file.arrayBuffer();
  const newFileNameForHtml = file.name.replace(/\.xls$/i, ".xlsx");

  if (looksLikeHtmlTableFile(arrayBuffer)) {
    return new File([arrayBuffer], newFileNameForHtml, {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
  }

  const XLSX = await import("xlsx");
  // cpexcel.full.mjs ships without TS declarations
  // @ts-expect-error -- third-party codepage bundle (no .d.ts)
  const cptable = await import("xlsx/dist/cpexcel.full.mjs");
  XLSX.set_cptable(cptable);

  const workbook = XLSX.read(arrayBuffer, { type: "array" });
  const xlsxData = XLSX.write(workbook, { type: "array", bookType: "xlsx" });

  const newFileName = file.name.replace(/\.xls$/i, ".xlsx");
  const blob = new Blob([xlsxData], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  });

  return new File([blob], newFileName, {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  });
}

// Types
interface SupplierWithMapping extends Supplier {
  fileMapping: SupplierFileMapping | null;
}

interface ProcessedRow {
  franchisee: string;
  rowNumber: number;
  grossAmount: number;
  netAmount: number;
  date?: string;
  matchResult?: {
    matchedFranchisee: { id: string; name: string; code: string } | null;
    confidence: number;
    requiresReview: boolean;
  };
  // For manual matching
  manualMatch?: {
    franchiseeId: string;
    franchiseeName: string;
    franchiseeCode: string;
  };
  isBlacklisted?: boolean;
  // Pre-calculated commission from supplier file (for suppliers with manual commission calculation)
  preCalculatedCommission?: number;
}

interface ProcessingResult {
  success: boolean;
  data: ProcessedRow[];
  summary: {
    totalRows: number;
    processedRows: number;
    skippedRows: number;
    totalGrossAmount: number;
    totalNetAmount: number;
    supplierName: string;
    supplierId: string;
    vatIncluded: boolean;
    vatRate: number;
    fileName: string;
    fileSize: number;
    periodStartDate?: string;
  };
  matchSummary?: {
    total: number;
    matched: number;
    needsReview: number;
    unmatched: number;
    averageConfidence: number;
    unmatchedNames: string[];
  };
  processingStatus: string;
  errors: Array<{ code: string; message: string; details?: string; rowNumber?: number }>;
  warnings: Array<{ code: string; message: string; details?: string; rowNumber?: number }>;
  // File URL from Blob Storage (if upload succeeded)
  fileUrl?: string;
  storedFileName?: string;
  // Flag to indicate if storage upload failed (processing succeeded but file not saved)
  storageUploadFailed?: boolean;
  // Anomalies surfaced by parser + matcher; rendered in AnomalyReviewModal
  // before the user can save the file. Optional — older API responses or
  // non-anomaly uploads simply omit it.
  anomalies?: Anomaly[];
}

/**
 * Format a YYYY-MM-DD pair as a Hebrew DD/MM/YYYY range.
 */
function formatPeriodRangeHe(start: string, end: string): string {
  const fmt = (s: string) => {
    const [y, m, d] = s.split("-");
    return `${d}/${m}/${y}`;
  };
  return `${fmt(start)} – ${fmt(end)}`;
}

export default function SupplierFilesPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  // Return path handed to the review page, so its "חזרה" lands back here
  // with the same supplier selected.
  const currentPath = `/admin/supplier-files${searchParams.toString() ? `?${searchParams}` : ""}`;
  const fileInputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();

  const [selectedSupplierId, setSelectedSupplierId] = useState<string>("");
  const [selectedPeriodKey, setSelectedPeriodKey] = useState<string>("");
  const [periodWithExistingFile, setPeriodWithExistingFile] = useState<PeriodWithStatus | null>(null);
  const [showOverwriteDialog, setShowOverwriteDialog] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [processingResult, setProcessingResult] = useState<ProcessingResult | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [expandedResults, setExpandedResults] = useState(false);
  // Errors start expanded: an error means zero rows parsed and nothing to
  // save, so the sentence that says what to do about it must not sit behind
  // a click. Warnings stay collapsed — there can be dozens and none block.
  const [errorsOpen, setErrorsOpen] = useState(true);
  const [warningsOpen, setWarningsOpen] = useState(false);

  // Manual matching state
  const [editingRow, setEditingRow] = useState<ProcessedRow | null>(null);
  const [selectedFranchiseeId, setSelectedFranchiseeId] = useState<string>("");
  const [addAsAlias, setAddAsAlias] = useState(true);
  const [franchiseeSearch, setFranchiseeSearch] = useState("");

  // Blacklist state
  const [blacklistingRow, setBlacklistingRow] = useState<ProcessedRow | null>(null);
  const [blacklistNotes, setBlacklistNotes] = useState("");

  // Save to DB state
  const [savedFileId, setSavedFileId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // Multi-file overwrite state
  const [overlappingFranchiseeNames, setOverlappingFranchiseeNames] = useState<string[]>([]);

  // Multi-file upload progress state
  const [multiFileProgress, setMultiFileProgress] = useState<{
    total: number;
    current: number;
    currentFileName: string;
    succeeded: number;
    failed: number;
    results: Array<{ fileName: string; success: boolean; error?: string; fileId?: string }>;
  } | null>(null);
  // Track whether to overwrite all duplicates for batch upload
  const [overwriteAllDuplicates, setOverwriteAllDuplicates] = useState(false);

  // Drag and drop state
  const [isDragging, setIsDragging] = useState(false);

  // Pre-save anomaly review modal: when set, the user must triage these
  // anomalies before saving the file. `null` means modal is closed.
  const [pendingAnomalyReview, setPendingAnomalyReview] = useState<Anomaly[] | null>(null);
  // Set true once the user has confirmed the anomaly review dialog. Until
  // then the Save button stays disabled even if the rest of the page allows
  // it. Reset whenever a new file is processed.
  const [anomaliesReviewed, setAnomaliesReviewed] = useState(false);

  const { data: session, isPending } = authClient.useSession();
  const userRole = session ? (session.user as { role?: string })?.role : undefined;



  // Fetch suppliers with file mapping
  const { data: suppliersData, isLoading: suppliersLoading, refetch } = useQuery({
    queryKey: ["suppliers", "with-file-mapping"],
    queryFn: async () => {
      const response = await fetchWithTimeout("/api/suppliers?filter=active");
      if (!response.ok) throw new Error("Failed to fetch suppliers");
      const data = await response.json();
      // Filter to suppliers with file mapping OR custom parser
      return data.suppliers.filter((s: SupplierWithMapping) => s.fileMapping !== null || hasCustomParser(s.code));
    },
    enabled: !isPending && !!session,
  });

  // Fetch franchisees for manual matching
  const { data: franchiseesData } = useQuery({
    queryKey: ["franchisees", "list"],
    queryFn: async () => {
      const response = await fetchWithTimeout("/api/franchisees");
      if (!response.ok) throw new Error("Failed to fetch franchisees");
      return response.json();
    },
    enabled: !isPending && !!session,
  });

  // Fetch review count for badge
  const { data: reviewCount } = useSupplierFileReviewCount();

  const suppliers: SupplierWithMapping[] = useMemo(
    () => suppliersData || [],
    [suppliersData]
  );
  const franchisees: Franchisee[] = useMemo(
    () => franchiseesData?.franchisees || [],
    [franchiseesData?.franchisees]
  );

  const sortedFranchisees = useMemo(() => {
    return [...franchisees].sort((a, b) => a.name.localeCompare(b.name, 'he'));
  }, [franchisees]);

  const filteredFranchisees = useMemo(() => {
    if (!franchiseeSearch) return sortedFranchisees;
    const search = franchiseeSearch.toLowerCase();
    return sortedFranchisees.filter(f =>
      f.name.toLowerCase().includes(search) ||
      f.code.toLowerCase().includes(search)
    );
  }, [sortedFranchisees, franchiseeSearch]);

  const selectedSupplier = suppliers.find(s => s.id === selectedSupplierId);
  const isMultiFile = (selectedSupplier?.fileMapping?.maxUploadFiles ?? 1) > 1;

  // Track if initial selection from URL has been done
  const initialSelectionDone = useRef(false);

  // Pre-select supplier from URL query parameter (only on initial load)
  React.useEffect(() => {
    // Skip if initial selection already done
    if (initialSelectionDone.current) return;

    const supplierIdFromUrl = searchParams.get('supplierId');
    if (supplierIdFromUrl && suppliers.length > 0) {
      const supplierExists = suppliers.some(
        (s: SupplierWithMapping) => s.id === supplierIdFromUrl
      );
      if (supplierExists) {
        setSelectedSupplierId(supplierIdFromUrl);
        initialSelectionDone.current = true;
      }
    }
  }, [searchParams, suppliers]);

  // Handle supplier change - reset period and file state
  const handleSupplierChange = useCallback((supplierId: string) => {
    setSelectedSupplierId(supplierId);
    setSelectedPeriodKey("");
    setPeriodWithExistingFile(null);
    setProcessingResult(null);
    setSavedFileId(null);
    setUploadError(null);
    setMultiFileProgress(null);
  }, []);

  // Handle period change - reset state
  const handlePeriodChange = useCallback((periodKey: string) => {
    setSelectedPeriodKey(periodKey);
    setProcessingResult(null);
    setSavedFileId(null);
    setUploadError(null);
    setMultiFileProgress(null);
  }, []);

  // Handle overwrite cancel
  const handleOverwriteCancel = useCallback(() => {
    setPeriodWithExistingFile(null);
    setShowOverwriteDialog(false);
    setOverlappingFranchiseeNames([]);
  }, []);

  // Add alias mutation
  const addAliasMutation = useMutation({
    mutationFn: async ({ franchiseeId, aliasName }: { franchiseeId: string; aliasName: string }) => {
      const response = await fetchWithTimeout(`/api/franchisees/${franchiseeId}/aliases`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ alias: aliasName }),
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to add alias");
      }
      return response.json();
    },
  });

  // Internal save function - handles the actual API call
  const saveToReviewQueueInternal = useCallback(async (
    result: ProcessingResult,
    supplierId: string,
    periodKey: string,
    overwrite: boolean = false
  ): Promise<string | null> => {
    if (!result.success || !result.data.length || !periodKey) return null;

    // Get period dates from key
    const period = getPeriodByKey(periodKey);
    if (!period) {
      toast.error("תקופה לא תקינה");
      return null;
    }

    setIsSaving(true);
    try {
      // Build franchiseeMatches first so we can calculate accurate matchStats
      const franchiseeMatches = result.data.map(row => {
        const match = row.matchResult;
        let matchType: "exact" | "fuzzy" | "manual" | "blacklisted" | "none" = "none";

        if (row.isBlacklisted) {
          matchType = "blacklisted";
        } else if (row.manualMatch) {
          matchType = "manual";
        } else if (match?.matchedFranchisee) {
          matchType = match.confidence === 1 ? "exact" : "fuzzy";
        }

        return {
          originalName: row.franchisee,
          rowNumber: row.rowNumber,
          grossAmount: row.grossAmount,
          netAmount: row.netAmount,
          matchedFranchiseeId: row.manualMatch?.franchiseeId || match?.matchedFranchisee?.id || null,
          matchedFranchiseeName: row.manualMatch?.franchiseeName || match?.matchedFranchisee?.name || null,
          confidence: row.manualMatch ? 100 : (match?.confidence || 0) * 100,
          matchType,
          requiresReview: !row.isBlacklisted && !row.manualMatch && (match?.requiresReview || !match?.matchedFranchisee),
          preCalculatedCommission: row.preCalculatedCommission,
        };
      });

      // Calculate matchStats from current state (including manual matches and blacklisted)
      const recalculatedStats = {
        total: franchiseeMatches.length,
        exactMatches: franchiseeMatches.filter(m =>
          m.matchType === "exact" || m.matchType === "manual"
        ).length,
        fuzzyMatches: franchiseeMatches.filter(m =>
          m.matchType === "fuzzy"
        ).length,
        unmatched: franchiseeMatches.filter(m =>
          m.matchType === "none"
        ).length,
        blacklisted: franchiseeMatches.filter(m =>
          m.matchType === "blacklisted"
        ).length,
      };

      // Convert ProcessingResult to SupplierFileProcessingResult format
      const processingResultForDB: SupplierFileProcessingResult = {
        totalRows: result.summary.totalRows,
        processedRows: result.summary.processedRows,
        skippedRows: result.summary.skippedRows,
        totalGrossAmount: result.summary.totalGrossAmount,
        totalNetAmount: result.summary.totalNetAmount,
        vatAdjusted: result.summary.vatIncluded,
        matchStats: recalculatedStats,
        franchiseeMatches,
        processedAt: new Date().toISOString(),
        // Persist (acknowledged) anomalies so the file's review page can
        // replay the same warnings the admin saw on upload.
        anomalies: result.anomalies,
      };

      const response = await fetchWithTimeout("/api/supplier-files", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          supplierId,
          fileName: result.summary.fileName,
          fileUrl: result.fileUrl, // URL from Blob Storage
          fileSize: result.summary.fileSize,
          processingResult: processingResultForDB,
          periodStartDate: formatDateAsLocal(period.startDate),
          periodEndDate: formatDateAsLocal(period.endDate),
          overwrite,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        // Handle conflict error (409) - file already exists
        if (response.status === 409 && error.existingFile) {
          // Store overlapping franchisee names if provided (multi-file suppliers)
          setOverlappingFranchiseeNames(error.overlappingFranchiseeNames ?? []);
          // Show overwrite dialog with existing file info
          setPeriodWithExistingFile({
            type: period.type,
            name: period.name,
            nameHe: period.nameHe,
            startDate: period.startDate,
            endDate: period.endDate,
            dueDate: period.dueDate,
            key: periodKey,
            hasFile: true,
            existingFile: {
              id: error.existingFile.id,
              fileName: error.existingFile.fileName,
              status: error.existingFile.status,
              uploadedAt: new Date(error.existingFile.uploadedAt),
            },
          });
          setShowOverwriteDialog(true);
          return null;
        }
        throw new Error(error.error || "Failed to save file");
      }

      const data = await response.json();
      setSavedFileId(data.file.id);

      // Reset overwrite state
      setPeriodWithExistingFile(null);
      setOverlappingFranchiseeNames([]);

      // Invalidate queries to update the review count and history
      queryClient.invalidateQueries({ queryKey: ["supplier-files", "review", "count"] });
      queryClient.invalidateQueries({ queryKey: ["supplier-file-uploads"] });

      toast.success(data.message);
      if (data.periodSnapped && data.effectivePeriodStart && data.effectivePeriodEnd) {
        toast.info(
          `התקופה הותאמה לתדירות ההתחשבנות של הספק: ${formatPeriodRangeHe(
            data.effectivePeriodStart,
            data.effectivePeriodEnd
          )}`
        );
      }
      return data.file.id;
    } catch (error) {
      console.error("Failed to save file to review queue:", error);
      toast.error("שגיאה בשמירת הקובץ לתור הבדיקה");
      return null;
    } finally {
      setIsSaving(false);
    }
  }, [queryClient]);

  // Public save function - always tries without overwrite first
  const saveToReviewQueue = useCallback(async (
    result: ProcessingResult,
    supplierId: string,
    periodKey: string
  ): Promise<string | null> => {
    return saveToReviewQueueInternal(result, supplierId, periodKey, false);
  }, [saveToReviewQueueInternal]);

  // Handle overwrite confirmation - retry save with overwrite flag
  const handleOverwriteConfirm = useCallback(async () => {
    setShowOverwriteDialog(false);
    if (processingResult && selectedSupplierId && selectedPeriodKey) {
      // Retry save with overwrite=true
      await saveToReviewQueueInternal(processingResult, selectedSupplierId, selectedPeriodKey, true);
    }
  }, [processingResult, selectedSupplierId, selectedPeriodKey, saveToReviewQueueInternal]);

  // Process a single file: upload, process, and optionally auto-save
  const processSingleFile = useCallback(async (
    file: File,
    supplierId: string,
    periodKey: string,
    overwrite: boolean = false
  ): Promise<{ success: boolean; result?: ProcessingResult; fileId?: string; error?: string; needsOverwrite?: boolean; periodSnapped?: boolean; effectivePeriodStart?: string; effectivePeriodEnd?: string }> => {
    let processedFile = file;

    // Convert XLS to XLSX if needed (Vercel WAF blocks XLS files)
    if (file.name.toLowerCase().endsWith(".xls") && !file.name.toLowerCase().endsWith(".xlsx")) {
      try {
        processedFile = await convertXlsToXlsx(file);
      } catch (conversionError) {
        console.error("Failed to convert XLS to XLSX:", conversionError);
        return { success: false, error: "שגיאה בהמרת הקובץ מ-XLS ל-XLSX" };
      }
    }

    const formData = new FormData();
    formData.append("file", processedFile);
    formData.append("enableMatching", "true");
    // Send the chosen period so the server can check it against the dates
    // inside the file — nothing did, so any period was accepted in silence.
    appendChosenPeriod(formData, periodKey);

    const response = await fetchWithTimeout(`/api/suppliers/${supplierId}/process-file`, {
      method: "POST",
      body: formData,
    });

    const result = await response.json();

    if (!response.ok) {
      return { success: false, error: result.message || result.error || "Failed to process file" };
    }

    // Auto-save to review queue
    const processingResult = result as ProcessingResult;
    if (!processingResult.success || !processingResult.data.length) {
      return { success: false, result: processingResult, error: "העיבוד נכשל" };
    }

    // Block save if storage upload failed (file won't be downloadable)
    if (processingResult.storageUploadFailed) {
      return { success: false, result: processingResult, error: "שמירת הקובץ לאחסון נכשלה. יש לנסות שוב." };
    }

    const period = getPeriodByKey(periodKey);
    if (!period) {
      return { success: false, result: processingResult, error: "תקופה לא תקינה" };
    }

    // Build franchiseeMatches and save
    const franchiseeMatches = processingResult.data.map(row => {
      const match = row.matchResult;
      let matchType: "exact" | "fuzzy" | "manual" | "blacklisted" | "none" = "none";
      if (row.isBlacklisted) {
        matchType = "blacklisted";
      } else if (row.manualMatch) {
        matchType = "manual";
      } else if (match?.matchedFranchisee) {
        matchType = match.confidence === 1 ? "exact" : "fuzzy";
      }
      return {
        originalName: row.franchisee,
        rowNumber: row.rowNumber,
        grossAmount: row.grossAmount,
        netAmount: row.netAmount,
        matchedFranchiseeId: row.manualMatch?.franchiseeId || match?.matchedFranchisee?.id || null,
        matchedFranchiseeName: row.manualMatch?.franchiseeName || match?.matchedFranchisee?.name || null,
        confidence: row.manualMatch ? 100 : (match?.confidence || 0) * 100,
        matchType,
        requiresReview: !row.isBlacklisted && !row.manualMatch && (match?.requiresReview || !match?.matchedFranchisee),
        preCalculatedCommission: row.preCalculatedCommission,
      };
    });

    const recalculatedStats = {
      total: franchiseeMatches.length,
      exactMatches: franchiseeMatches.filter(m => m.matchType === "exact" || m.matchType === "manual").length,
      fuzzyMatches: franchiseeMatches.filter(m => m.matchType === "fuzzy").length,
      unmatched: franchiseeMatches.filter(m => m.matchType === "none").length,
      blacklisted: franchiseeMatches.filter(m => m.matchType === "blacklisted").length,
    };

    const processingResultForDB: SupplierFileProcessingResult = {
      totalRows: processingResult.summary.totalRows,
      processedRows: processingResult.summary.processedRows,
      skippedRows: processingResult.summary.skippedRows,
      totalGrossAmount: processingResult.summary.totalGrossAmount,
      totalNetAmount: processingResult.summary.totalNetAmount,
      vatAdjusted: processingResult.summary.vatIncluded,
      matchStats: recalculatedStats,
      franchiseeMatches,
      processedAt: new Date().toISOString(),
    };

    const saveResponse = await fetchWithTimeout("/api/supplier-files", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        supplierId,
        fileName: processingResult.summary.fileName,
        fileUrl: processingResult.fileUrl,
        fileSize: processingResult.summary.fileSize,
        processingResult: processingResultForDB,
        periodStartDate: formatDateAsLocal(period.startDate),
        periodEndDate: formatDateAsLocal(period.endDate),
        overwrite,
      }),
    });

    if (!saveResponse.ok) {
      const error = await saveResponse.json();
      if (saveResponse.status === 409) {
        return { success: false, result: processingResult, needsOverwrite: true, error: "קובץ קיים כבר לזכיין זה" };
      }
      return { success: false, result: processingResult, error: error.error || "שגיאה בשמירה" };
    }

    const saveData = await saveResponse.json();
    return {
      success: true,
      result: processingResult,
      fileId: saveData.file.id,
      periodSnapped: saveData.periodSnapped,
      effectivePeriodStart: saveData.effectivePeriodStart,
      effectivePeriodEnd: saveData.effectivePeriodEnd,
    };
  }, []);

  // Handle file upload - supports single and multi-file
  const handleFileUpload = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files?.length || !selectedSupplierId || !selectedPeriodKey) return;

    setUploadError(null);
    setProcessingResult(null);
    setSavedFileId(null);
    setErrorsOpen(true);
    setWarningsOpen(false);
    setPendingAnomalyReview(null);
    setAnomaliesReviewed(false);

    if (files.length === 1 && !isMultiFile) {
      // Single file - use original flow (allows manual matching before save)
      let file = files[0];
      setIsUploading(true);

      try {
        if (file.name.toLowerCase().endsWith(".xls") && !file.name.toLowerCase().endsWith(".xlsx")) {
          try {
            file = await convertXlsToXlsx(file);
            toast.info("הקובץ הומר מ-XLS ל-XLSX");
          } catch (conversionError) {
            console.error("Failed to convert XLS to XLSX:", conversionError);
            setUploadError("שגיאה בהמרת הקובץ מ-XLS ל-XLSX");
            return;
          }
        }

        const formData = new FormData();
        formData.append("file", file);
        formData.append("enableMatching", "true");
        appendChosenPeriod(formData, selectedPeriodKey);

        const response = await fetchWithTimeout(`/api/suppliers/${selectedSupplierId}/process-file`, {
          method: "POST",
          body: formData,
        });

        const result = await response.json();

        if (!response.ok) {
          setUploadError(result.message || result.error || "Failed to process file");
          return;
        }

        setProcessingResult(result);
        setExpandedResults(true);
        // Open the pre-save anomaly review modal if the parser/matcher
        // surfaced anything that needs triage. The Save button stays
        // disabled until the user works through the modal.
        if (Array.isArray(result.anomalies) && result.anomalies.length > 0) {
          setPendingAnomalyReview(result.anomalies);
          setAnomaliesReviewed(false);
        } else {
          setAnomaliesReviewed(true);
        }
      } catch (error) {
        setUploadError(error instanceof Error ? error.message : "Unknown error");
      } finally {
        setIsUploading(false);
        if (fileInputRef.current) fileInputRef.current.value = "";
      }
      return;
    }

    // Multi-file flow: process each file sequentially and auto-save
    const fileArray = Array.from(files);
    setIsUploading(true);
    const progress = {
      total: fileArray.length,
      current: 0,
      currentFileName: "",
      succeeded: 0,
      failed: 0,
      results: [] as Array<{ fileName: string; success: boolean; error?: string; fileId?: string }>,
    };
    setMultiFileProgress({ ...progress });

    let hasOverwritePrompt = false;
    let shouldOverwriteAll = overwriteAllDuplicates;
    let snappedRange: { start: string; end: string } | null = null;
    // Files that replaced an existing upload for the same franchisee+period.
    // Reported at the end — a silent overwrite reads as "nothing happened".
    const replacedFileNames: string[] = [];

    for (let i = 0; i < fileArray.length; i++) {
      const file = fileArray[i];
      progress.current = i + 1;
      progress.currentFileName = file.name;
      setMultiFileProgress({ ...progress });

      let result = await processSingleFile(file, selectedSupplierId, selectedPeriodKey, shouldOverwriteAll);

      // Handle duplicate - if first time, will need user choice
      if (!result.success && result.needsOverwrite && !shouldOverwriteAll && !hasOverwritePrompt) {
        // Ask once for all files - auto-overwrite for multi-file suppliers
        hasOverwritePrompt = true;
        shouldOverwriteAll = true;
        setOverwriteAllDuplicates(true);
        // Retry with overwrite
        result = await processSingleFile(file, selectedSupplierId, selectedPeriodKey, true);
        if (result.success) replacedFileNames.push(file.name);
      } else if (!result.success && result.needsOverwrite && shouldOverwriteAll) {
        // Already decided to overwrite all
        result = await processSingleFile(file, selectedSupplierId, selectedPeriodKey, true);
        if (result.success) replacedFileNames.push(file.name);
      }

      if (result.success) {
        progress.succeeded++;
        progress.results.push({ fileName: file.name, success: true, fileId: result.fileId });
        if (
          !snappedRange &&
          result.periodSnapped &&
          result.effectivePeriodStart &&
          result.effectivePeriodEnd
        ) {
          snappedRange = {
            start: result.effectivePeriodStart,
            end: result.effectivePeriodEnd,
          };
        }
      } else {
        progress.failed++;
        progress.results.push({ fileName: file.name, success: false, error: result.error });
      }
      setMultiFileProgress({ ...progress });
    }

    // Summary toast
    if (progress.succeeded > 0 && progress.failed === 0) {
      toast.success(`${progress.succeeded} קבצים הועלו ונשמרו בהצלחה`);
    } else if (progress.succeeded > 0 && progress.failed > 0) {
      toast.warning(`${progress.succeeded} הצליחו, ${progress.failed} נכשלו`);
    } else {
      toast.error(`כל ${progress.failed} הקבצים נכשלו`);
    }

    if (replacedFileNames.length > 0) {
      toast.info(
        `${replacedFileNames.length} קבצים כבר היו קיימים לאותם סניפים בתקופה הזו — הקובץ החדש החליף את הישן (הישן סומן כנדחה). זה תקין, לא צריך להעלות שוב.`,
        { duration: 12000 }
      );
    }

    if (snappedRange) {
      toast.info(
        `התקופה הותאמה לתדירות ההתחשבנות של הספק: ${formatPeriodRangeHe(snappedRange.start, snappedRange.end)}`
      );
    }

    // Invalidate queries to update history
    queryClient.invalidateQueries({ queryKey: ["supplier-files", "review", "count"] });
    queryClient.invalidateQueries({ queryKey: ["supplier-file-uploads"] });

    setIsUploading(false);
    setOverwriteAllDuplicates(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, [selectedSupplierId, selectedPeriodKey, isMultiFile, overwriteAllDuplicates, processSingleFile, queryClient]);

  // Handle drag events
  const handleDragOver = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (!selectedPeriodKey) return;
    setIsDragging(true);
  }, [selectedPeriodKey]);

  const handleDragLeave = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(async (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    if (!selectedSupplierId || !selectedPeriodKey) return;

    const droppedFiles = e.dataTransfer.files;
    if (!droppedFiles?.length) return;

    // Validate file types
    const expectedType = selectedSupplier?.fileMapping?.fileType;
    for (let i = 0; i < droppedFiles.length; i++) {
      const f = droppedFiles[i];
      const isExcel = f.name.toLowerCase().endsWith(".xlsx") || f.name.toLowerCase().endsWith(".xls");
      const isCsv = f.name.toLowerCase().endsWith(".csv");
      const isZip = f.name.toLowerCase().endsWith(".zip");

      if (expectedType === "csv" && !isCsv && !isZip) {
        setUploadError(`קובץ ${f.name}: יש להעלות קובץ CSV בלבד`);
        return;
      }
      if (expectedType === "xlsx" && !isExcel && !isZip) {
        setUploadError(`קובץ ${f.name}: יש להעלות קובץ Excel בלבד`);
        return;
      }
    }

    if (droppedFiles.length === 1 && !isMultiFile) {
      // Single file - use original flow
      let file = droppedFiles[0];
      setIsUploading(true);
      setUploadError(null);
      setProcessingResult(null);
      setSavedFileId(null);
      setErrorsOpen(true);
      setWarningsOpen(false);
      setPendingAnomalyReview(null);
      setAnomaliesReviewed(false);

      try {
        if (file.name.toLowerCase().endsWith(".xls") && !file.name.toLowerCase().endsWith(".xlsx")) {
          try {
            file = await convertXlsToXlsx(file);
            toast.info("הקובץ הומר מ-XLS ל-XLSX");
          } catch (conversionError) {
            console.error("Failed to convert XLS to XLSX:", conversionError);
            setUploadError("שגיאה בהמרת הקובץ מ-XLS ל-XLSX");
            return;
          }
        }

        const formData = new FormData();
        formData.append("file", file);
        formData.append("enableMatching", "true");
        appendChosenPeriod(formData, selectedPeriodKey);

        const response = await fetchWithTimeout(`/api/suppliers/${selectedSupplierId}/process-file`, {
          method: "POST",
          body: formData,
        });

        const result = await response.json();

        if (!response.ok) {
          setUploadError(result.message || result.error || "Failed to process file");
          return;
        }

        setProcessingResult(result);
        setExpandedResults(true);
        if (Array.isArray(result.anomalies) && result.anomalies.length > 0) {
          setPendingAnomalyReview(result.anomalies);
          setAnomaliesReviewed(false);
        } else {
          setAnomaliesReviewed(true);
        }
      } catch (error) {
        setUploadError(error instanceof Error ? error.message : "Unknown error");
      } finally {
        setIsUploading(false);
      }
      return;
    }

    // Multi-file drop: process each file sequentially and auto-save
    const fileArray = Array.from(droppedFiles);
    setIsUploading(true);
    setUploadError(null);
    setProcessingResult(null);
    setSavedFileId(null);

    const progress = {
      total: fileArray.length,
      current: 0,
      currentFileName: "",
      succeeded: 0,
      failed: 0,
      results: [] as Array<{ fileName: string; success: boolean; error?: string; fileId?: string }>,
    };
    setMultiFileProgress({ ...progress });

    let shouldOverwriteAll = false;
    let snappedRange: { start: string; end: string } | null = null;
    const replacedFileNames: string[] = [];

    for (let i = 0; i < fileArray.length; i++) {
      const file = fileArray[i];
      progress.current = i + 1;
      progress.currentFileName = file.name;
      setMultiFileProgress({ ...progress });

      let result = await processSingleFile(file, selectedSupplierId, selectedPeriodKey, shouldOverwriteAll);

      if (!result.success && result.needsOverwrite && !shouldOverwriteAll) {
        shouldOverwriteAll = true;
        result = await processSingleFile(file, selectedSupplierId, selectedPeriodKey, true);
        if (result.success) replacedFileNames.push(file.name);
      } else if (!result.success && result.needsOverwrite && shouldOverwriteAll) {
        result = await processSingleFile(file, selectedSupplierId, selectedPeriodKey, true);
        if (result.success) replacedFileNames.push(file.name);
      }

      if (result.success) {
        progress.succeeded++;
        progress.results.push({ fileName: file.name, success: true, fileId: result.fileId });
        if (
          !snappedRange &&
          result.periodSnapped &&
          result.effectivePeriodStart &&
          result.effectivePeriodEnd
        ) {
          snappedRange = {
            start: result.effectivePeriodStart,
            end: result.effectivePeriodEnd,
          };
        }
      } else {
        progress.failed++;
        progress.results.push({ fileName: file.name, success: false, error: result.error });
      }
      setMultiFileProgress({ ...progress });
    }

    if (progress.succeeded > 0 && progress.failed === 0) {
      toast.success(`${progress.succeeded} קבצים הועלו ונשמרו בהצלחה`);
    } else if (progress.succeeded > 0 && progress.failed > 0) {
      toast.warning(`${progress.succeeded} הצליחו, ${progress.failed} נכשלו`);
    } else {
      toast.error(`כל ${progress.failed} הקבצים נכשלו`);
    }

    if (replacedFileNames.length > 0) {
      toast.info(
        `${replacedFileNames.length} קבצים כבר היו קיימים לאותם סניפים בתקופה הזו — הקובץ החדש החליף את הישן (הישן סומן כנדחה). זה תקין, לא צריך להעלות שוב.`,
        { duration: 12000 }
      );
    }

    if (snappedRange) {
      toast.info(
        `התקופה הותאמה לתדירות ההתחשבנות של הספק: ${formatPeriodRangeHe(snappedRange.start, snappedRange.end)}`
      );
    }

    queryClient.invalidateQueries({ queryKey: ["supplier-files", "review", "count"] });
    queryClient.invalidateQueries({ queryKey: ["supplier-file-uploads"] });

    setIsUploading(false);
  }, [selectedSupplierId, selectedPeriodKey, selectedSupplier, isMultiFile, processSingleFile, queryClient]);

  // Handle manual match save
  /**
   * Pin one row to a franchisee, optionally registering the file's spelling as
   * an alias so the next file matches it outright. Shared by the edit dialog
   * and by the row's inline confirm — a suggested match that only needs
   * agreeing with shouldn't cost a dialog.
   */
  const applyMatch = useCallback(async (
    row: ProcessedRow,
    franchiseeId: string,
    alsoAddAlias: boolean
  ) => {
    const selectedFranchisee = franchisees.find(f => f.id === franchiseeId);
    if (!selectedFranchisee) return;

    // Add alias if requested
    if (alsoAddAlias && row.franchisee) {
      try {
        await addAliasMutation.mutateAsync({
          franchiseeId,
          aliasName: row.franchisee,
        });
      } catch (error) {
        console.error("Failed to add alias:", error);
        // Continue anyway - the manual match will still work
      }
    }

    // Update the processing result with the manual match
    setProcessingResult(prev => {
      if (!prev) return null;
      return {
        ...prev,
        data: prev.data.map(candidate => {
          if (candidate.rowNumber === row.rowNumber) {
            return {
              ...candidate,
              manualMatch: {
                franchiseeId: selectedFranchisee.id,
                franchiseeName: selectedFranchisee.name,
                franchiseeCode: selectedFranchisee.code,
              },
            };
          }
          return candidate;
        }),
        matchSummary: prev.matchSummary ? {
          ...prev.matchSummary,
          matched: prev.matchSummary.matched + 1,
          unmatched: Math.max(0, prev.matchSummary.unmatched - 1),
          unmatchedNames: prev.matchSummary.unmatchedNames.filter(n => n !== row.franchisee),
        } : undefined,
      };
    });
  }, [franchisees, addAliasMutation]);

  const handleSaveMatch = useCallback(async () => {
    if (!editingRow || !selectedFranchiseeId) return;
    await applyMatch(editingRow, selectedFranchiseeId, addAsAlias);
    setEditingRow(null);
    setSelectedFranchiseeId("");
    setFranchiseeSearch("");
  }, [editingRow, selectedFranchiseeId, addAsAlias, applyMatch]);

  // Handle blacklist
  const handleBlacklist = useCallback(() => {
    if (!blacklistingRow || !processingResult) return;

    // Update the processing result to mark as blacklisted
    setProcessingResult(prev => {
      if (!prev) return null;
      return {
        ...prev,
        data: prev.data.map(row => {
          if (row.rowNumber === blacklistingRow.rowNumber) {
            return {
              ...row,
              isBlacklisted: true,
            };
          }
          return row;
        }),
        matchSummary: prev.matchSummary ? {
          ...prev.matchSummary,
          unmatched: Math.max(0, prev.matchSummary.unmatched - 1),
          unmatchedNames: prev.matchSummary.unmatchedNames.filter(n => n !== blacklistingRow.franchisee),
        } : undefined,
      };
    });

    setBlacklistingRow(null);
    setBlacklistNotes("");
  }, [blacklistingRow, processingResult]);

  // Get effective match for a row
  const getEffectiveMatch = (row: ProcessedRow) => {
    if (row.isBlacklisted) {
      return { type: "blacklisted" as const, name: null };
    }
    if (row.manualMatch) {
      return { type: "manual" as const, name: row.manualMatch.franchiseeName, code: row.manualMatch.franchiseeCode };
    }
    if (row.matchResult?.matchedFranchisee) {
      return {
        type: row.matchResult.confidence === 1 ? "exact" as const : "fuzzy" as const,
        name: row.matchResult.matchedFranchisee.name,
        code: row.matchResult.matchedFranchisee.code,
        confidence: row.matchResult.confidence,
      };
    }
    return { type: "unmatched" as const, name: null };
  };

  // Check if all rows can be auto-approved (no unmatched or fuzzy)
  const canAutoApprove = useMemo(() => {
    if (!processingResult?.data) return false;
    return processingResult.data.every(row => {
      const match = getEffectiveMatch(row);
      // Auto-approve if exact match, manual match, or blacklisted
      return match.type === "exact" || match.type === "manual" || match.type === "blacklisted";
    });
  }, [processingResult?.data]);

  // Get status badge color
  const getStatusBadge = (status: string) => {
    switch (status) {
      case "success":
        return <Badge variant="success" className="gap-1"><CheckCircle2 className="h-3 w-3" /> הצלחה</Badge>;
      case "partial_success":
        return <Badge variant="outline" className="gap-1 bg-yellow-50 text-yellow-700 border-yellow-300"><AlertTriangle className="h-3 w-3" /> הצלחה חלקית</Badge>;
      case "needs_review":
        return <Badge variant="secondary" className="gap-1"><Eye className="h-3 w-3" /> נדרשת סקירה</Badge>;
      case "failed":
        return <Badge variant="destructive" className="gap-1"><XCircle className="h-3 w-3" /> נכשל</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  // Get match badge
  const getMatchBadge = (row: ProcessedRow) => {
    const match = getEffectiveMatch(row);
    switch (match.type) {
      case "blacklisted":
        return <Badge variant="secondary" className="gap-1 bg-gray-200"><Ban className="h-3 w-3" />לא רלוונטי</Badge>;
      case "manual":
        return <Badge variant="success" className="gap-1"><Check className="h-3 w-3" />ידני</Badge>;
      case "exact":
        return <Badge variant="success">100%</Badge>;
      case "fuzzy":
        return <Badge variant="outline" className="bg-yellow-50 text-yellow-700">{Math.round((match.confidence || 0) * 100)}%</Badge>;
      case "unmatched":
        return <Badge variant="destructive">לא מותאם</Badge>;
    }
  };

  if (isPending || suppliersLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="container mx-auto py-6 space-y-6" dir="rtl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">העלאת קבצי ספקים</h1>
          <p className="text-muted-foreground mt-1">
            העלאה וניתוח של קבצי עמלות מספקים
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/admin/supplier-files/by-franchisee">
            <Button variant="outline">
              <BarChart3 className="h-4 w-4 me-2" />
              לפי זכיין
            </Button>
          </Link>
          <Link href="/admin/supplier-files/completeness">
            <Button variant="outline">
              <BarChart3 className="h-4 w-4 me-2" />
              מצב דוחות
            </Button>
          </Link>
          <Link href="/admin/supplier-files/review">
            <Button variant="outline">
              <ClipboardList className="h-4 w-4 me-2" />
              תור אישורים
              {reviewCount !== undefined && reviewCount > 0 && (
                <Badge variant="secondary" className="ms-2">
                  {reviewCount}
                </Badge>
              )}
            </Button>
          </Link>
          <Button variant="outline" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 me-2" />
            רענון
          </Button>
        </div>
      </div>

      {/* 3-Step Workflow Row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Step 1: Supplier Selection */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-lg">
              <span className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${
                selectedSupplierId ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
              }`}>1</span>
              בחירת ספק
            </CardTitle>
            <CardDescription>
              בחר ספק מהרשימה
            </CardDescription>
          </CardHeader>
          <CardContent>
            <SupplierCombobox
              suppliers={suppliers}
              selectedSupplierId={selectedSupplierId}
              onSelect={handleSupplierChange}
            />
          </CardContent>
        </Card>

        {/* Step 2: Period Selection */}
        <Card className={!selectedSupplier ? "opacity-50" : ""}>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-lg">
              <span className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${
                selectedPeriodKey ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
              }`}>2</span>
              בחירת תקופה
            </CardTitle>
            <CardDescription>
              {selectedSupplier
                ? "בחר את התקופה עבורה מועלה הקובץ"
                : "בחר ספק תחילה"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {selectedSupplier ? (
              <PeriodSelector
                supplierId={selectedSupplierId}
                supplierName={selectedSupplier.name}
                selectedPeriodKey={selectedPeriodKey}
                onSelect={handlePeriodChange}
              />
            ) : (
              <p className="text-sm text-muted-foreground text-center py-4">
                בחר ספק כדי לראות את התקופות הזמינות
              </p>
            )}
          </CardContent>
        </Card>

        {/* Step 3: File Upload */}
        <Card className={!selectedPeriodKey ? "opacity-50" : ""}>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-lg">
              <span className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${
                processingResult ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
              }`}>3</span>
              העלאת קובץ
            </CardTitle>
            <CardDescription>
              {selectedPeriodKey && selectedSupplier
                ? `קובץ ${selectedSupplier.fileMapping?.fileType?.toUpperCase() ?? ''}`
                : "בחר ספק ותקופה תחילה"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {/* Drag and Drop Zone */}
            <div
              className={`
                relative rounded-lg border-2 border-dashed p-4 transition-colors cursor-pointer
                ${isDragging ? "border-primary bg-primary/5" : "border-muted-foreground/25 hover:border-muted-foreground/50"}
                ${!selectedPeriodKey ? "opacity-50 cursor-not-allowed" : ""}
                ${isUploading ? "pointer-events-none" : ""}
              `}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={() => {
                if (selectedPeriodKey && !isUploading) {
                  fileInputRef.current?.click();
                }
              }}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept={
                  selectedSupplier?.fileMapping?.fileType === "csv"
                    ? isMultiFile ? ".csv,.zip" : ".csv"
                    : isMultiFile ? ".xlsx,.xls,.zip" : ".xlsx,.xls"
                }
                multiple={isMultiFile}
                onChange={handleFileUpload}
                disabled={isUploading || !selectedPeriodKey}
                className="hidden"
              />
              <div className="flex flex-col items-center gap-1.5 text-center">
                {isUploading && multiFileProgress ? (
                  <>
                    <Loader2 className="h-8 w-8 text-primary animate-spin" />
                    <p className="text-sm font-medium">
                      מעבד קובץ {multiFileProgress.current} מתוך {multiFileProgress.total}
                    </p>
                    <p className="text-xs text-muted-foreground truncate max-w-full">
                      {multiFileProgress.currentFileName}
                    </p>
                    <div className="w-full bg-muted rounded-full h-1.5 mt-1">
                      <div
                        className="bg-primary h-1.5 rounded-full transition-all"
                        style={{ width: `${(multiFileProgress.current / multiFileProgress.total) * 100}%` }}
                      />
                    </div>
                    {(multiFileProgress.succeeded > 0 || multiFileProgress.failed > 0) && (
                      <p className="text-xs text-muted-foreground">
                        <span className="text-green-600">{multiFileProgress.succeeded} הצליחו</span>
                        {multiFileProgress.failed > 0 && (
                          <span className="text-destructive ms-2">{multiFileProgress.failed} נכשלו</span>
                        )}
                      </p>
                    )}
                  </>
                ) : isUploading ? (
                  <>
                    <Loader2 className="h-8 w-8 text-primary animate-spin" />
                    <p className="text-sm font-medium">מעבד...</p>
                  </>
                ) : (
                  <>
                    <Upload className={`h-8 w-8 ${isDragging ? "text-primary" : "text-muted-foreground"}`} />
                    <p className="text-sm font-medium">
                      {isDragging ? "שחרר כדי להעלות" : isMultiFile ? "גרור קבצים לכאן" : "גרור קובץ לכאן"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {isMultiFile ? "ניתן לבחור מספר קבצים בו-זמנית" : "או לחץ לבחירת קובץ"}
                    </p>
                  </>
                )}
              </div>
            </div>

            {/* Upload Error */}
            {uploadError && (
              <div className="mt-3 rounded-lg border border-destructive/50 bg-destructive/10 p-3">
                <div className="flex items-center gap-2 text-destructive">
                  <XCircle className="h-4 w-4" />
                  <p className="font-medium text-sm">שגיאה</p>
                </div>
                <p className="mt-1 text-xs text-destructive">{uploadError}</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Multi-File Upload Results */}
      {multiFileProgress && !isUploading && multiFileProgress.results.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-lg">
              <FileUp className="h-5 w-5" />
              תוצאות העלאה ({multiFileProgress.succeeded} הצליחו מתוך {multiFileProgress.total})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-1.5">
              {multiFileProgress.results.map((r, i) => (
                <div key={i} className={`flex items-center justify-between rounded-lg border px-3 py-2 text-sm ${
                  r.success ? "bg-green-50/50 border-green-200" : "bg-red-50/50 border-red-200"
                }`}>
                  <div className="flex items-center gap-2">
                    {r.success ? (
                      <CheckCircle2 className="h-4 w-4 text-green-600" />
                    ) : (
                      <XCircle className="h-4 w-4 text-destructive" />
                    )}
                    <span>{r.fileName}</span>
                  </div>
                  {r.success && r.fileId ? (
                    <Link href={withBack(`/admin/supplier-files/review/${r.fileId}`, currentPath)}>
                      <Button variant="ghost" size="sm" className="h-7 text-xs">
                        <Eye className="h-3 w-3 me-1" />
                        צפייה
                      </Button>
                    </Link>
                  ) : r.error ? (
                    <span className="text-xs text-destructive">{r.error}</span>
                  ) : null}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Upload History - Full Width */}
      {selectedSupplier && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg">היסטוריית העלאות - {selectedSupplier.name}</CardTitle>
          </CardHeader>
          <CardContent>
            <UploadHistoryPanel
              supplierId={selectedSupplierId}
              supplierName={selectedSupplier.name}
            />
          </CardContent>
        </Card>
      )}

      {/* Processing Results - Full Width */}
      {processingResult && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center justify-between">
                  <span className="flex items-center gap-2">
                    <FileSpreadsheet className="h-5 w-5" />
                    תוצאות עיבוד
                  </span>
                  {getStatusBadge(processingResult.processingStatus)}
                </CardTitle>
                <CardDescription>
                  {processingResult.summary.fileName} ({(processingResult.summary.fileSize / 1024).toFixed(1)} KB)
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Summary Stats */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <div className="rounded-lg border p-2.5 text-center">
                    <p className="text-xl font-bold">{processingResult.summary.processedRows}</p>
                    <p className="text-xs text-muted-foreground">שורות שעובדו</p>
                  </div>
                  <div className="rounded-lg border p-2.5 text-center">
                    <p className="text-xl font-bold">{formatCurrency(processingResult.summary.totalNetAmount)}</p>
                    <p className="text-xs text-muted-foreground">סה&quot;כ לפני מע״מ</p>
                  </div>
                  {processingResult.matchSummary && (
                    <>
                      <div className="rounded-lg border p-2.5 text-center">
                        <p className="text-xl font-bold text-green-600">{processingResult.matchSummary.matched}</p>
                        <p className="text-xs text-muted-foreground">מותאמים</p>
                      </div>
                      <div className="rounded-lg border p-2.5 text-center">
                        <p className="text-xl font-bold text-orange-600">{processingResult.matchSummary.unmatched}</p>
                        <p className="text-xs text-muted-foreground">לא מותאמים</p>
                      </div>
                    </>
                  )}
                </div>

                {/* Storage Upload Failed Warning */}
                {processingResult.storageUploadFailed && (
                  <div className="flex items-center gap-3 rounded-lg border border-destructive/50 bg-destructive/10 p-3">
                    <XCircle className="h-5 w-5 text-destructive shrink-0" />
                    <div>
                      <p className="font-medium text-sm text-destructive">
                        שמירת הקובץ לאחסון נכשלה
                      </p>
                      <p className="text-xs text-destructive/80">
                        הנתונים עובדו בהצלחה אך הקובץ לא נשמר. יש להעלות את הקובץ שוב.
                      </p>
                    </div>
                  </div>
                )}

                {/* Save to Review Queue */}
                <div className={`flex items-center justify-between rounded-lg border p-3 ${
                  processingResult.storageUploadFailed
                    ? "bg-muted/30 opacity-60"
                    : canAutoApprove ? "bg-green-50 border-green-200" : "bg-muted/50"
                }`}>
                  <div>
                    <p className="font-medium text-sm">
                      {savedFileId
                        ? "הקובץ נשמר"
                        : processingResult.storageUploadFailed
                          ? "לא ניתן לשמור - הקובץ לא הועלה לאחסון"
                          : canAutoApprove
                            ? "כל השורות מותאמות - הקובץ יאושר אוטומטית"
                            : "שמירה לתור הבדיקה"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {savedFileId
                        ? "ניתן לצפות בקובץ בתור האישורים"
                        : processingResult.storageUploadFailed
                          ? "העלה את הקובץ מחדש כדי לשמור"
                          : canAutoApprove
                            ? "הקובץ יישמר ויאושר ללא צורך בבדיקה נוספת"
                            : "שמור את הקובץ כדי לאפשר בדיקה ואישור"}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {savedFileId ? (
                      <Link href={withBack(`/admin/supplier-files/review/${savedFileId}`, currentPath)}>
                        <Button variant="outline" size="sm">
                          <Eye className="h-4 w-4 me-2" />
                          צפייה בקובץ
                        </Button>
                      </Link>
                    ) : (
                      <Button
                        size="sm"
                        variant={canAutoApprove ? "default" : "secondary"}
                        className={canAutoApprove ? "bg-green-600 hover:bg-green-700" : ""}
                        onClick={() => {
                          // Re-open the anomaly review modal if anomalies
                          // exist but haven't been triaged yet — saves can
                          // proceed only after explicit acknowledgement.
                          if (
                            !anomaliesReviewed &&
                            Array.isArray(processingResult.anomalies) &&
                            processingResult.anomalies.length > 0
                          ) {
                            setPendingAnomalyReview(processingResult.anomalies);
                            return;
                          }
                          saveToReviewQueue(processingResult, selectedSupplierId, selectedPeriodKey);
                        }}
                        disabled={
                          isSaving ||
                          !processingResult.success ||
                          processingResult.storageUploadFailed ||
                          (!anomaliesReviewed &&
                            Array.isArray(processingResult.anomalies) &&
                            processingResult.anomalies.some((a) => a.severity === "blocking"))
                        }
                        title={
                          !anomaliesReviewed &&
                          Array.isArray(processingResult.anomalies) &&
                          processingResult.anomalies.length > 0
                            ? "יש לבדוק את ההתראות לפני שמירה"
                            : undefined
                        }
                      >
                        {isSaving ? (
                          <>
                            <Loader2 className="h-4 w-4 me-2 animate-spin" />
                            שומר...
                          </>
                        ) : canAutoApprove ? (
                          <>
                            <CheckCircle2 className="h-4 w-4 me-2" />
                            שמור ואשר
                          </>
                        ) : (
                          <>
                            <Save className="h-4 w-4 me-2" />
                            שמור לתור הבדיקה
                          </>
                        )}
                      </Button>
                    )}
                  </div>
                </div>

                {/* Errors expanded by default; warnings compact and closed */}
                {(processingResult.errors.length > 0 || processingResult.warnings.length > 0) && (
                  <div className="flex flex-wrap gap-2">
                    {processingResult.errors.length > 0 && (
                      <Collapsible open={errorsOpen} onOpenChange={setErrorsOpen} className="flex-1 min-w-[200px]">
                        <CollapsibleTrigger asChild>
                          <button className="flex items-center gap-2 rounded-lg border border-destructive/50 bg-destructive/10 px-3 py-1.5 hover:bg-destructive/20 transition-colors text-xs">
                            <XCircle className="h-3.5 w-3.5 text-destructive" />
                            <span className="font-medium text-destructive">
                              שגיאות: {processingResult.errors.length}
                            </span>
                            <ChevronDown className={`h-3.5 w-3.5 text-destructive transition-transform ${errorsOpen ? 'rotate-180' : ''}`} />
                          </button>
                        </CollapsibleTrigger>
                        <CollapsibleContent>
                          <div className="mt-2 rounded-lg border border-destructive/50 bg-destructive/5 p-3">
                            <ul className="list-disc list-inside text-xs text-destructive space-y-0.5">
                              {processingResult.errors.map((err, i) => (
                                <li key={i}>{err.details || err.message}</li>
                              ))}
                            </ul>
                          </div>
                        </CollapsibleContent>
                      </Collapsible>
                    )}

                    {processingResult.warnings.length > 0 && (
                      <Collapsible open={warningsOpen} onOpenChange={setWarningsOpen} className="flex-1 min-w-[200px]">
                        <CollapsibleTrigger asChild>
                          <button className="flex items-center gap-2 rounded-lg border border-yellow-500/50 bg-yellow-50 px-3 py-1.5 hover:bg-yellow-100 transition-colors text-xs">
                            <AlertTriangle className="h-3.5 w-3.5 text-yellow-700" />
                            <span className="font-medium text-yellow-700">
                              אזהרות: {processingResult.warnings.length}
                            </span>
                            <ChevronDown className={`h-3.5 w-3.5 text-yellow-700 transition-transform ${warningsOpen ? 'rotate-180' : ''}`} />
                          </button>
                        </CollapsibleTrigger>
                        <CollapsibleContent>
                          <div className="mt-2 rounded-lg border border-yellow-500/50 bg-yellow-50/50 p-3">
                            <ul className="list-disc list-inside text-xs text-yellow-700 space-y-0.5">
                              {processingResult.warnings.map((warn, i) => (
                                <li key={i}>{warn.details || warn.message}</li>
                              ))}
                            </ul>
                          </div>
                        </CollapsibleContent>
                      </Collapsible>
                    )}
                  </div>
                )}

                {/* Unmatched Franchisees - Compact Inline Badges */}
                {processingResult.matchSummary && processingResult.matchSummary.unmatchedNames.length > 0 && (
                  <div className="rounded-lg border border-orange-500/50 bg-orange-50 p-3">
                    <p className="font-medium text-orange-700 text-sm mb-2">
                      זכיינים שלא נמצאו ({processingResult.matchSummary.unmatchedNames.length})
                    </p>
                    <div className="flex flex-wrap gap-1">
                      {processingResult.matchSummary.unmatchedNames.map((name, i) => (
                        <Badge key={i} variant="outline" className="bg-white text-xs">
                          {name}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}

                {/* Data Table */}
                <Collapsible open={expandedResults} onOpenChange={setExpandedResults}>
                  <CollapsibleTrigger asChild>
                    <Button variant="ghost" className="w-full justify-between" size="sm">
                      <span>צפייה בנתונים ({processingResult.data.length} שורות)</span>
                      {expandedResults ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                    </Button>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <div className="rounded-lg border mt-2">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="w-[50px]">#</TableHead>
                            <TableHead>זכיין (מקובץ)</TableHead>
                            <TableHead>התאמה</TableHead>
                            <TableHead>סטטוס</TableHead>
                            <TableHead>כולל מע&quot;מ</TableHead>
                            <TableHead>לפני מע&quot;מ</TableHead>
                            <TableHead className="w-[100px]">פעולות</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {processingResult.data.slice(0, 100).map((row, i) => {
                            const match = getEffectiveMatch(row);
                            const isUnmatched = match.type === "unmatched";
                            const isBlacklisted = match.type === "blacklisted";

                            return (
                              <TableRow
                                key={i}
                                className={isUnmatched ? "bg-red-50/50" : isBlacklisted ? "bg-gray-50" : ""}
                              >
                                <TableCell className="font-mono text-xs">{row.rowNumber}</TableCell>
                                <TableCell className="font-medium text-sm">{row.franchisee}</TableCell>
                                <TableCell>
                                  {match.name ? (
                                    <div className="text-sm">
                                      <span className={match.type === "manual" ? "text-blue-600" : "text-green-600"}>
                                        {match.name}
                                      </span>
                                      {match.code && (
                                        <span className="text-xs text-muted-foreground ms-1">({match.code})</span>
                                      )}
                                    </div>
                                  ) : isBlacklisted ? (
                                    <span className="text-gray-500 text-sm">לא רלוונטי</span>
                                  ) : (
                                    <span className="text-orange-600 text-sm">לא נמצא</span>
                                  )}
                                </TableCell>
                                <TableCell>{getMatchBadge(row)}</TableCell>
                                <TableCell className="text-sm">{formatCurrency(row.grossAmount)}</TableCell>
                                <TableCell className="text-sm">{formatCurrency(row.netAmount)}</TableCell>
                                <TableCell>
                                  {!isBlacklisted && (
                                    <div className="flex gap-1">
                                      {/* A 96% match is almost always simply right. Agreeing with
                                          it used to cost opening the dialog, picking the same
                                          franchisee and saving — fourteen times for one Nespresso
                                          file. One click here does the same thing, alias included. */}
                                      {match.type === "fuzzy" && row.matchResult?.matchedFranchisee && (
                                        <Button
                                          size="sm"
                                          variant="ghost"
                                          className="h-7 w-7 p-0 text-green-600 hover:text-green-700 hover:bg-green-50"
                                          disabled={addAliasMutation.isPending}
                                          onClick={() =>
                                            applyMatch(row, row.matchResult!.matchedFranchisee!.id, true)
                                          }
                                          title={`אשר התאמה ל"${match.name}" ושמור ככינוי`}
                                        >
                                          <Check className="h-3.5 w-3.5" />
                                        </Button>
                                      )}
                                      <Button
                                        size="sm"
                                        variant="ghost"
                                        className="h-7 w-7 p-0"
                                        title="בחר זכיין אחר"
                                        onClick={() => {
                                          setEditingRow(row);
                                          setSelectedFranchiseeId(
                                            row.manualMatch?.franchiseeId ||
                                            row.matchResult?.matchedFranchisee?.id ||
                                            ""
                                          );
                                          setAddAsAlias(true);
                                          setFranchiseeSearch("");
                                        }}
                                      >
                                        <Edit className="h-3.5 w-3.5" />
                                      </Button>
                                      {isUnmatched && (
                                        <Button
                                          size="sm"
                                          variant="ghost"
                                          className="h-7 w-7 p-0 text-gray-600 hover:text-gray-900"
                                          onClick={() => {
                                            setBlacklistingRow(row);
                                            setBlacklistNotes("");
                                          }}
                                          title="סמן כלא רלוונטי"
                                        >
                                          <Ban className="h-3.5 w-3.5" />
                                        </Button>
                                      )}
                                    </div>
                                  )}
                                </TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                      {processingResult.data.length > 100 && (
                        <p className="p-2 text-center text-xs text-muted-foreground">
                          מציג 100 מתוך {processingResult.data.length} שורות
                        </p>
                      )}
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              </CardContent>
            </Card>
          )}

      {/* Edit Match Dialog */}
      <Dialog open={!!editingRow} onOpenChange={(open) => !open && setEditingRow(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>עריכת התאמה</DialogTitle>
            <DialogDescription>
              בחר זכיין עבור &quot;{editingRow?.franchisee}&quot;
            </DialogDescription>
          </DialogHeader>
          <div className="py-4 space-y-4">
            <div>
              <label className="text-sm font-medium">חיפוש זכיין</label>
              <Input
                placeholder="חפש לפי שם או קוד..."
                value={franchiseeSearch}
                onChange={(e) => setFranchiseeSearch(e.target.value)}
                className="mt-2"
              />
            </div>
            <div>
              <label className="text-sm font-medium">בחר זכיין</label>
              <Select value={selectedFranchiseeId} onValueChange={setSelectedFranchiseeId}>
                <SelectTrigger className="mt-2">
                  <SelectValue placeholder="בחר זכיין..." />
                </SelectTrigger>
                <SelectContent className="max-h-[300px]">
                  {filteredFranchisees.map((f) => (
                    <SelectItem key={f.id} value={f.id}>
                      {f.name} ({f.code})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                id="addAsAlias"
                checked={addAsAlias}
                onCheckedChange={(checked) => setAddAsAlias(checked === true)}
              />
              <label htmlFor="addAsAlias" className="text-sm">
                הוסף &quot;{editingRow?.franchisee}&quot; ככינוי לזכיין
              </label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingRow(null)}>
              ביטול
            </Button>
            <Button
              onClick={handleSaveMatch}
              disabled={addAliasMutation.isPending || !selectedFranchiseeId}
            >
              {addAliasMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin me-2" />
              ) : (
                <Plus className="h-4 w-4 me-2" />
              )}
              שמור התאמה
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Blacklist Dialog */}
      <Dialog open={!!blacklistingRow} onOpenChange={(open) => !open && setBlacklistingRow(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>סימון כלא רלוונטי</DialogTitle>
            <DialogDescription>
              האם לסמן את &quot;{blacklistingRow?.franchisee}&quot; כלא רלוונטי?
              שורה זו תסומן ולא תיכלל בחישובים.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <label className="text-sm font-medium">הערות (אופציונלי)</label>
            <Textarea
              value={blacklistNotes}
              onChange={(e) => setBlacklistNotes(e.target.value)}
              placeholder="למה לא רלוונטי? (למשל: לא זכיין, חשבון פנימי)"
              rows={3}
              className="mt-2"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBlacklistingRow(null)}>
              ביטול
            </Button>
            <Button
              onClick={handleBlacklist}
              className="bg-gray-600 hover:bg-gray-700"
            >
              <Ban className="h-4 w-4 me-2" />
              סמן כלא רלוונטי
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Overwrite Confirm Dialog */}
      <OverwriteConfirmDialog
        open={showOverwriteDialog}
        onOpenChange={setShowOverwriteDialog}
        period={periodWithExistingFile}
        onConfirm={handleOverwriteConfirm}
        onCancel={handleOverwriteCancel}
        overlappingFranchiseeNames={overlappingFranchiseeNames}
      />

      {/* Pre-save anomaly review — surfaces non-fatal issues from parser
          and matcher (filtered rows, unknown business IDs, biz-id
          mismatches) and forces explicit acknowledgement before saving. */}
      <AnomalyReviewModal
        open={!!pendingAnomalyReview}
        anomalies={pendingAnomalyReview ?? []}
        fileId={savedFileId}
        onConfirm={(updatedAnomalies) => {
          // Persist the (possibly acknowledged) anomalies onto the in-memory
          // processing result so they round-trip into supplier_file_upload.
          const updated = processingResult
            ? { ...processingResult, anomalies: updatedAnomalies }
            : null;
          setProcessingResult(updated);
          setPendingAnomalyReview(null);
          setAnomaliesReviewed(true);
          // The button reads "שמור לבדיקה ידנית" — so save. It used to only
          // close the dialog and wait for a second click on the save button,
          // which reads as "the upload does nothing" (אראל אריזות, 2026-07-27).
          if (updated) {
            saveToReviewQueue(updated, selectedSupplierId, selectedPeriodKey);
          }
        }}
        onCancel={() => {
          // Treat cancel as "abort this upload": clear the result so the user
          // can pick a different file or fix the underlying issue first.
          setPendingAnomalyReview(null);
          setProcessingResult(null);
          setAnomaliesReviewed(false);
          setUploadError("ההעלאה בוטלה — חזרי לבדוק את הקובץ");
        }}
        onAfterAction={async (anomaly, action) => {
          if (action.type !== "update_franchisee_company_id") return null;
          try {
            const res = await fetchWithTimeout(
              `/api/admin/franchisees/${action.franchiseeId}/update-company-id`,
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ newCompanyId: action.newCompanyId }),
              }
            );
            if (!res.ok) {
              const err = await res.json().catch(() => ({}));
              throw new Error(err.error || "שגיאה בעדכון ה-ח.פ.");
            }
            toast.success(
              `ה-ח.פ. של "${action.franchiseeName}" עודכן ל-${action.newCompanyId}`
            );
            // Drop this anomaly from the list — the underlying issue is
            // fixed in DB. (The processing_result still shows the row as
            // unmatched until reprocess; that's surfaced to the user as a
            // hint to re-upload or wait for the next sync.)
            const remaining = (pendingAnomalyReview ?? []).filter(
              (a) => a !== anomaly
            );
            setPendingAnomalyReview(remaining);
            return remaining;
          } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : "שגיאה לא ידועה";
            toast.error(msg);
            return null;
          }
        }}
      />
    </div>
  );
}
