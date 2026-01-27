"use client";

import { useState, useCallback, useRef, useMemo, type DragEvent } from "react";
import { useRouter } from "next/navigation";
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
import { toast } from "sonner";
import type { Supplier, SupplierFileMapping, Franchisee, SupplierFileProcessingResult } from "@/db/schema";
import { formatCurrency } from "@/lib/translations";
import { formatDateAsLocal } from "@/lib/date-utils";
import { SupplierCombobox } from "@/components/supplier-files/supplier-combobox";
import { UploadHistoryPanel } from "@/components/supplier-files/upload-history-panel";
import { PeriodSelector, type PeriodWithStatus } from "@/components/supplier-files/period-selector";
import { OverwriteConfirmDialog } from "@/components/supplier-files/overwrite-confirm-dialog";
import { useSupplierFileReviewCount } from "@/queries/supplier-file-uploads";
import { getPeriodByKey } from "@/lib/settlement-periods";

/**
 * Convert XLS file to XLSX format in the browser
 * This is needed because Vercel WAF blocks XLS files
 */
async function convertXlsToXlsx(file: File): Promise<File> {
  // Dynamic import to avoid loading xlsx until needed
  const XLSX = await import("xlsx");

  // Read the XLS file
  const arrayBuffer = await file.arrayBuffer();
  const workbook = XLSX.read(arrayBuffer, { type: "array" });

  // Write as XLSX
  const xlsxData = XLSX.write(workbook, { type: "array", bookType: "xlsx" });

  // Create new file with xlsx extension
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
  errors: Array<{ code: string; message: string; rowNumber?: number }>;
  warnings: Array<{ code: string; message: string; rowNumber?: number }>;
}

export default function SupplierFilesPage() {
  const router = useRouter();
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
  const [errorsOpen, setErrorsOpen] = useState(false);
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

  // Drag and drop state
  const [isDragging, setIsDragging] = useState(false);

  const { data: session, isPending } = authClient.useSession();
  const userRole = session ? (session.user as { role?: string })?.role : undefined;

  // Redirect if not authenticated or authorized
  if (!isPending && !session) {
    router.push("/sign-in?redirect=/admin/supplier-files");
  }
  if (!isPending && session?.user && userRole !== "super_user" && userRole !== "admin") {
    router.push("/dashboard");
  }

  // Fetch suppliers with file mapping
  const { data: suppliersData, isLoading: suppliersLoading, refetch } = useQuery({
    queryKey: ["suppliers", "with-file-mapping"],
    queryFn: async () => {
      const response = await fetch("/api/suppliers?filter=active");
      if (!response.ok) throw new Error("Failed to fetch suppliers");
      const data = await response.json();
      // Filter to only suppliers with file mapping
      return data.suppliers.filter((s: SupplierWithMapping) => s.fileMapping !== null);
    },
    enabled: !isPending && !!session,
  });

  // Fetch franchisees for manual matching
  const { data: franchiseesData } = useQuery({
    queryKey: ["franchisees", "list"],
    queryFn: async () => {
      const response = await fetch("/api/franchisees");
      if (!response.ok) throw new Error("Failed to fetch franchisees");
      return response.json();
    },
    enabled: !isPending && !!session,
  });

  // Fetch review count for badge
  const { data: reviewCount } = useSupplierFileReviewCount();

  const suppliers: SupplierWithMapping[] = suppliersData || [];
  const franchisees: Franchisee[] = franchiseesData?.franchisees || [];

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

  // Handle supplier change - reset period and file state
  const handleSupplierChange = useCallback((supplierId: string) => {
    setSelectedSupplierId(supplierId);
    setSelectedPeriodKey("");
    setPeriodWithExistingFile(null);
    setProcessingResult(null);
    setSavedFileId(null);
    setUploadError(null);
  }, []);

  // Handle period change - reset state
  const handlePeriodChange = useCallback((periodKey: string) => {
    setSelectedPeriodKey(periodKey);
    setProcessingResult(null);
    setSavedFileId(null);
    setUploadError(null);
  }, []);

  // Handle overwrite cancel
  const handleOverwriteCancel = useCallback(() => {
    setPeriodWithExistingFile(null);
    setShowOverwriteDialog(false);
  }, []);

  // Add alias mutation
  const addAliasMutation = useMutation({
    mutationFn: async ({ franchiseeId, aliasName }: { franchiseeId: string; aliasName: string }) => {
      const response = await fetch(`/api/franchisees/${franchiseeId}/aliases`, {
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
      // Convert ProcessingResult to SupplierFileProcessingResult format
      const processingResultForDB: SupplierFileProcessingResult = {
        totalRows: result.summary.totalRows,
        processedRows: result.summary.processedRows,
        skippedRows: result.summary.skippedRows,
        totalGrossAmount: result.summary.totalGrossAmount,
        totalNetAmount: result.summary.totalNetAmount,
        vatAdjusted: result.summary.vatIncluded,
        matchStats: {
          total: result.matchSummary?.total || 0,
          exactMatches: result.matchSummary?.matched || 0,
          fuzzyMatches: result.matchSummary?.needsReview || 0,
          unmatched: result.matchSummary?.unmatched || 0,
        },
        franchiseeMatches: result.data.map(row => {
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
          };
        }),
        processedAt: new Date().toISOString(),
      };

      const response = await fetch("/api/supplier-files", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          supplierId,
          fileName: result.summary.fileName,
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

      // Invalidate queries to update the review count and history
      queryClient.invalidateQueries({ queryKey: ["supplier-files", "review", "count"] });
      queryClient.invalidateQueries({ queryKey: ["supplier-file-uploads"] });

      toast.success(data.message);
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

  // Handle file upload
  const handleFileUpload = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    let file = event.target.files?.[0];
    if (!file || !selectedSupplierId) return;

    setIsUploading(true);
    setUploadError(null);
    setProcessingResult(null);
    setSavedFileId(null);
    setErrorsOpen(false);
    setWarningsOpen(false);

    try {
      // Convert XLS to XLSX if needed (Vercel WAF blocks XLS files)
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

      const response = await fetch(`/api/suppliers/${selectedSupplierId}/process-file`, {
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
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : "Unknown error");
    } finally {
      setIsUploading(false);
      // Reset file input
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  }, [selectedSupplierId]);

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

    let file = e.dataTransfer.files?.[0];
    if (!file) return;

    // Validate file type
    const expectedType = selectedSupplier?.fileMapping?.fileType;
    const isExcel = file.name.toLowerCase().endsWith(".xlsx") || file.name.toLowerCase().endsWith(".xls");
    const isCsv = file.name.toLowerCase().endsWith(".csv");

    if (expectedType === "csv" && !isCsv) {
      setUploadError("יש להעלות קובץ CSV בלבד");
      return;
    }
    if (expectedType === "xlsx" && !isExcel) {
      setUploadError("יש להעלות קובץ Excel בלבד");
      return;
    }

    setIsUploading(true);
    setUploadError(null);
    setProcessingResult(null);
    setSavedFileId(null);
    setErrorsOpen(false);
    setWarningsOpen(false);

    try {
      // Convert XLS to XLSX if needed (Vercel WAF blocks XLS files)
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

      const response = await fetch(`/api/suppliers/${selectedSupplierId}/process-file`, {
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
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : "Unknown error");
    } finally {
      setIsUploading(false);
    }
  }, [selectedSupplierId, selectedPeriodKey, selectedSupplier]);

  // Handle manual match save
  const handleSaveMatch = useCallback(async () => {
    if (!editingRow || !selectedFranchiseeId || !processingResult) return;

    const selectedFranchisee = franchisees.find(f => f.id === selectedFranchiseeId);
    if (!selectedFranchisee) return;

    // Add alias if requested
    if (addAsAlias && editingRow.franchisee) {
      try {
        await addAliasMutation.mutateAsync({
          franchiseeId: selectedFranchiseeId,
          aliasName: editingRow.franchisee,
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
        data: prev.data.map(row => {
          if (row.rowNumber === editingRow.rowNumber) {
            return {
              ...row,
              manualMatch: {
                franchiseeId: selectedFranchisee.id,
                franchiseeName: selectedFranchisee.name,
                franchiseeCode: selectedFranchisee.code,
              },
            };
          }
          return row;
        }),
        matchSummary: prev.matchSummary ? {
          ...prev.matchSummary,
          matched: prev.matchSummary.matched + 1,
          unmatched: Math.max(0, prev.matchSummary.unmatched - 1),
          unmatchedNames: prev.matchSummary.unmatchedNames.filter(n => n !== editingRow.franchisee),
        } : undefined,
      };
    });

    setEditingRow(null);
    setSelectedFranchiseeId("");
    setFranchiseeSearch("");
  }, [editingRow, selectedFranchiseeId, processingResult, franchisees, addAsAlias, addAliasMutation]);

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

      {/* 2x2 Grid Layout */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Row 1, Col 1: Supplier Selection */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg">בחירת ספק</CardTitle>
            <CardDescription>
              בחר ספק מהרשימה כדי להעלות קובץ עמלות
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

        {/* Row 1, Col 2: Period Selection */}
        <Card className={!selectedSupplier ? "opacity-50" : ""}>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg">בחירת תקופה</CardTitle>
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

        {/* Row 2, Col 1: File Upload */}
        <Card className={!selectedPeriodKey ? "opacity-50" : ""}>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-lg">
              <FileUp className="h-5 w-5" />
              העלאת קובץ
            </CardTitle>
            <CardDescription>
              {selectedPeriodKey && selectedSupplier
                ? `העלה קובץ ${selectedSupplier.fileMapping?.fileType.toUpperCase()} מהספק`
                : "בחר ספק ותקופה תחילה"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {/* Drag and Drop Zone */}
            <div
              className={`
                relative rounded-lg border-2 border-dashed p-6 transition-colors cursor-pointer
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
                accept={selectedSupplier?.fileMapping?.fileType === "csv" ? ".csv" : ".xlsx,.xls"}
                onChange={handleFileUpload}
                disabled={isUploading || !selectedPeriodKey}
                className="hidden"
              />
              <div className="flex flex-col items-center gap-2 text-center">
                {isUploading ? (
                  <>
                    <Loader2 className="h-10 w-10 text-primary animate-spin" />
                    <p className="text-sm font-medium">מעבד את הקובץ...</p>
                  </>
                ) : (
                  <>
                    <Upload className={`h-10 w-10 ${isDragging ? "text-primary" : "text-muted-foreground"}`} />
                    <div>
                      <p className="text-sm font-medium">
                        {isDragging ? "שחרר כדי להעלות" : "גרור קובץ לכאן"}
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        או לחץ לבחירת קובץ
                      </p>
                    </div>
                    {selectedSupplier && (
                      <p className="text-xs text-muted-foreground">
                        קבצים נתמכים: {selectedSupplier.fileMapping?.fileType.toUpperCase()}
                      </p>
                    )}
                  </>
                )}
              </div>
            </div>

            {/* Upload Error */}
            {uploadError && (
              <div className="mt-4 rounded-lg border border-destructive/50 bg-destructive/10 p-4">
                <div className="flex items-center gap-2 text-destructive">
                  <XCircle className="h-5 w-5" />
                  <p className="font-medium">שגיאה בעיבוד הקובץ</p>
                </div>
                <p className="mt-1 text-sm text-destructive">{uploadError}</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Row 2, Col 2: Upload History */}
        {selectedSupplier ? (
          <UploadHistoryPanel
            supplierId={selectedSupplierId}
            supplierName={selectedSupplier.name}
          />
        ) : (
          <Card className="opacity-50">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg">היסטוריית העלאות</CardTitle>
              <CardDescription>בחר ספק תחילה</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground text-center py-4">
                בחר ספק כדי לראות את היסטוריית ההעלאות
              </p>
            </CardContent>
          </Card>
        )}
      </div>

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
                    <p className="text-xs text-muted-foreground">סה&quot;כ נטו</p>
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

                {/* Save to Review Queue */}
                <div className="flex items-center justify-between rounded-lg border bg-muted/50 p-3">
                  <div>
                    <p className="font-medium text-sm">
                      {savedFileId ? "הקובץ נשמר לתור הבדיקה" : "שמירה לתור הבדיקה"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {savedFileId
                        ? "ניתן לצפות בקובץ ולאשר/לדחות אותו בתור האישורים"
                        : "שמור את הקובץ כדי לאפשר בדיקה ואישור"}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {savedFileId ? (
                      <Link href={`/admin/supplier-files/review/${savedFileId}`}>
                        <Button variant="outline" size="sm">
                          <Eye className="h-4 w-4 me-2" />
                          צפייה בקובץ
                        </Button>
                      </Link>
                    ) : (
                      <Button
                        size="sm"
                        onClick={() => saveToReviewQueue(processingResult, selectedSupplierId, selectedPeriodKey)}
                        disabled={isSaving || !processingResult.success}
                      >
                        {isSaving ? (
                          <>
                            <Loader2 className="h-4 w-4 me-2 animate-spin" />
                            שומר...
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

                {/* Errors and Warnings - Compact, Closed by Default */}
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
                                <li key={i}>{err.message}</li>
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
                                <li key={i}>{warn.message}</li>
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
                            <TableHead>כולל מע"מ</TableHead>
                            <TableHead>לפני מע"מ</TableHead>
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
                                      <Button
                                        size="sm"
                                        variant="ghost"
                                        className="h-7 w-7 p-0"
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
      />
    </div>
  );
}
