"use client";

import { useState, useCallback, useMemo, useRef, type DragEvent } from "react";
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
import { Label } from "@/components/ui/label";
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
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  FileUp,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Plus,
  FileSpreadsheet,
  Search,
  RefreshCw,
  Building2,
  Calendar,
  User,
  AlertCircle,
  Filter,
  X,
  History,
  Eye,
  Upload,
  Clock,
  FileCheck,
  ExternalLink,
  Ban,
} from "lucide-react";
import type { Supplier, Franchisee, SettlementPeriod } from "@/db/schema";
import { parseBkmvData, formatAmount, getSupplierSummaryForPeriod, type BkmvParseResult, type BkmvTransaction } from "@/lib/bkmvdata-parser";
import {
  matchBkmvSuppliers,
  type BkmvSupplierMatchingResult,
} from "@/lib/supplier-matcher";
import { upload } from "@vercel/blob/client";

// Type for franchisee with brand
interface FranchiseeWithBrand extends Franchisee {
  brand: {
    id: string;
    code: string;
    nameHe: string;
    nameEn: string | null;
  } | null;
}

// Type for history item
interface BkmvHistoryItem {
  id: string;
  fileName: string;
  fileSize: number;
  fileUrl: string;
  processingStatus: string;
  periodStartDate: string | null;
  periodEndDate: string | null;
  createdAt: string;
  franchisee: {
    id: string;
    name: string;
    code: string;
  } | null;
  matchStats: {
    total: number;
    exactMatches: number;
    fuzzyMatches: number;
    unmatched: number;
  } | null;
  companyId: string | null;
}

// Type for duplicate check response
interface DuplicateCheckResult {
  exists: boolean;
  existingFile?: {
    id: string;
    fileName: string;
    createdAt: string;
    processingStatus: string;
  };
}

// Helper to get date range from transactions
function getDateRange(transactions: BkmvTransaction[]): { minDate: Date | null; maxDate: Date | null } {
  if (transactions.length === 0) {
    return { minDate: null, maxDate: null };
  }

  let minDate = transactions[0].documentDate;
  let maxDate = transactions[0].documentDate;

  for (const tx of transactions) {
    if (tx.documentDate < minDate) {
      minDate = tx.documentDate;
    }
    if (tx.documentDate > maxDate) {
      maxDate = tx.documentDate;
    }
  }

  return { minDate, maxDate };
}

// Format date for display
function formatDateHebrew(date: Date | null): string {
  if (!date) return "לא זוהה";
  return new Intl.DateTimeFormat('he-IL', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(date);
}

export default function BkmvDataPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // State
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [parseResult, setParseResult] = useState<BkmvParseResult | null>(null);
  const [matchingResults, setMatchingResults] = useState<BkmvSupplierMatchingResult[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filterStatus, setFilterStatus] = useState<"all" | "matched" | "unmatched" | "review">("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [matchedFranchisee, setMatchedFranchisee] = useState<FranchiseeWithBrand | null>(null);
  const [franchiseeError, setFranchiseeError] = useState<string | null>(null);
  const [dateRange, setDateRange] = useState<{ minDate: Date | null; maxDate: Date | null }>({ minDate: null, maxDate: null });

  // Date filter state
  const [filterStartDate, setFilterStartDate] = useState<string>("");
  const [filterEndDate, setFilterEndDate] = useState<string>("");
  const [isDateFiltered, setIsDateFiltered] = useState(false);

  // History and upload state
  const [activeTab, setActiveTab] = useState<string>("upload");
  const [historyFilterFranchisee, setHistoryFilterFranchisee] = useState<string>("all");
  const [historyFilterStatus, setHistoryFilterStatus] = useState<string>("all");
  const [isUploading, setIsUploading] = useState(false);
  const [uploadSuccess, setUploadSuccess] = useState<{ fileId: string; autoApproved: boolean } | null>(null);
  const [duplicateDialog, setDuplicateDialog] = useState<{
    open: boolean;
    existingFile?: DuplicateCheckResult["existingFile"];
  }>({ open: false });

  const { data: session, isPending } = authClient.useSession();
  const userRole = session ? (session.user as { role?: string })?.role : undefined;

  // Redirect if not authenticated or authorized
  if (!isPending && !session) {
    router.push("/sign-in?redirect=/admin/bkmvdata");
  }
  if (!isPending && session?.user && userRole !== "super_user" && userRole !== "admin") {
    router.push("/dashboard");
  }

  // Fetch suppliers
  const { data: suppliersData, isLoading: isLoadingSuppliers, error: suppliersError } = useQuery({
    queryKey: ["suppliers", "list", { filter: "all" }],
    queryFn: async () => {
      const response = await fetch("/api/suppliers?filter=all");
      if (!response.ok) throw new Error("Failed to fetch suppliers");
      return response.json();
    },
    enabled: !isPending && !!session,
  });

  const suppliers: Supplier[] = suppliersData?.suppliers || [];

  // Fetch blacklist for filtering
  const { data: blacklistData, refetch: refetchBlacklist } = useQuery({
    queryKey: ["bkmvdata", "blacklist"],
    queryFn: async () => {
      const response = await fetch("/api/bkmvdata/blacklist");
      if (!response.ok) throw new Error("Failed to fetch blacklist");
      return response.json();
    },
    enabled: !isPending && !!session,
  });

  // Convert blacklist to Set for matching
  const blacklistedNames = useMemo(() => {
    if (!blacklistData?.items) return new Set<string>();
    return new Set(blacklistData.items.map((item: { normalizedName: string }) => item.normalizedName));
  }, [blacklistData]);

  // Fetch franchisees for filter dropdown
  const { data: franchiseesData } = useQuery({
    queryKey: ["franchisees", "list"],
    queryFn: async () => {
      const response = await fetch("/api/franchisees");
      if (!response.ok) throw new Error("Failed to fetch franchisees");
      return response.json();
    },
    enabled: !isPending && !!session,
  });

  const franchisees: FranchiseeWithBrand[] = franchiseesData?.franchisees || [];

  // Fetch upload history
  const { data: historyData, isLoading: isLoadingHistory, refetch: refetchHistory } = useQuery({
    queryKey: ["bkmvdata", "history", historyFilterFranchisee, historyFilterStatus],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (historyFilterFranchisee && historyFilterFranchisee !== "all") {
        params.set("franchiseeId", historyFilterFranchisee);
      }
      if (historyFilterStatus && historyFilterStatus !== "all") {
        params.set("status", historyFilterStatus);
      }
      params.set("limit", "50");
      const response = await fetch(`/api/bkmvdata/history?${params.toString()}`);
      if (!response.ok) throw new Error("Failed to fetch history");
      return response.json();
    },
    enabled: !isPending && !!session && activeTab === "history",
  });

  const historyItems: BkmvHistoryItem[] = historyData?.files || [];

  // Sorted suppliers for dropdown (alphabetically by name)
  const sortedSuppliers = useMemo(() => {
    return [...suppliers].sort((a, b) => a.name.localeCompare(b.name, 'he'));
  }, [suppliers]);

  // Sorted franchisees for dropdown
  const sortedFranchisees = useMemo(() => {
    return [...franchisees].sort((a, b) => a.name.localeCompare(b.name, 'he'));
  }, [franchisees]);

  // Update supplier mutation (for adding aliases)
  const updateSupplierMutation = useMutation({
    mutationFn: async ({ supplierId, bkmvAliases }: { supplierId: string; bkmvAliases: string[] }) => {
      const response = await fetch(`/api/suppliers/${supplierId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bkmvAliases }),
      });
      if (!response.ok) throw new Error("Failed to update supplier");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["suppliers"] });
    },
  });

  // Add to blacklist mutation (for marking as not relevant)
  const addToBlacklistMutation = useMutation({
    mutationFn: async (name: string) => {
      const response = await fetch("/api/bkmvdata/blacklist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          notes: "נוסף מדף BKMVDATA - לא רלוונטי להתאמות ספקים",
        }),
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "שגיאה בהוספה לרשימה");
      }
      return response.json();
    },
    onSuccess: () => {
      // Refresh blacklist and re-run matching
      refetchBlacklist().then(() => {
        if (parseResult) {
          handleProcessFile();
        }
      });
    },
  });

  // Handle file selection
  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setSelectedFile(file);
      setParseResult(null);
      setMatchingResults([]);
      setError(null);
      setMatchedFranchisee(null);
      setFranchiseeError(null);
      setDateRange({ minDate: null, maxDate: null });
      setUploadSuccess(null);
    }
  }, []);

  // Handle drag events
  const handleDragOver = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const file = e.dataTransfer.files?.[0];
    if (!file) return;

    // Validate file type - only .txt files
    if (!file.name.toLowerCase().endsWith(".txt")) {
      setError("יש להעלות קובץ BKMVDATA בפורמט TXT בלבד");
      return;
    }

    setSelectedFile(file);
    setParseResult(null);
    setMatchingResults([]);
    setError(null);
    setMatchedFranchisee(null);
    setFranchiseeError(null);
    setDateRange({ minDate: null, maxDate: null });
    setUploadSuccess(null);
  }, []);

  // Upload file to server using client-side Vercel Blob upload
  const handleUploadToServer = useCallback(async (forceReplace = false) => {
    if (!selectedFile || !parseResult || !matchedFranchisee) return;

    // Client-side file size validation (50MB limit - larger now that we use direct blob upload)
    const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB
    if (selectedFile.size > MAX_FILE_SIZE) {
      setError("הקובץ גדול מדי. הגודל המקסימלי הוא 50MB");
      return;
    }

    setIsUploading(true);
    setError(null);

    try {
      // Step 1: Upload directly to Vercel Blob (bypasses serverless function body limit)
      const blob = await upload(selectedFile.name, selectedFile, {
        access: "public",
        handleUploadUrl: "/api/bkmvdata/admin-upload-url",
      });

      // Step 2: Process the uploaded file
      const response = await fetch("/api/bkmvdata/admin-process", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          blobUrl: blob.url,
          fileName: selectedFile.name,
          fileSize: selectedFile.size,
          franchiseeId: matchedFranchisee.id,
          periodStartDate: filterStartDate || undefined,
          periodEndDate: filterEndDate || undefined,
          forceReplace,
        }),
      });

      // Check response.ok FIRST before parsing JSON
      if (!response.ok) {
        let errorMessage = "שגיאה בעיבוד הקובץ";
        try {
          const data = await response.json();
          if (data.error === "duplicate") {
            // Show duplicate dialog
            setDuplicateDialog({
              open: true,
              existingFile: data.existingFile,
            });
            return;
          }
          errorMessage = data.error || errorMessage;
        } catch {
          errorMessage = `שגיאת שרת: ${response.status}`;
        }
        throw new Error(errorMessage);
      }

      const data = await response.json();

      // Success
      setUploadSuccess({
        fileId: data.file.id,
        autoApproved: data.processing.autoApproved,
      });

      // Refresh history
      queryClient.invalidateQueries({ queryKey: ["bkmvdata", "history"] });
    } catch (err) {
      console.error("Error uploading file:", err);
      setError(err instanceof Error ? err.message : "שגיאה בהעלאת הקובץ");
    } finally {
      setIsUploading(false);
      setDuplicateDialog({ open: false });
    }
  }, [selectedFile, parseResult, matchedFranchisee, filterStartDate, filterEndDate, queryClient]);

  // Process uploaded file
  const handleProcessFile = useCallback(async () => {
    if (!selectedFile) return;

    setIsProcessing(true);
    setError(null);
    setFranchiseeError(null);

    try {
      const buffer = await selectedFile.arrayBuffer();
      const result = parseBkmvData(Buffer.from(buffer));
      setParseResult(result);

      // Extract date range from transactions
      const range = getDateRange(result.transactions);
      setDateRange(range);

      // Auto-initialize date filter with file's date range
      if (range.minDate && range.maxDate) {
        setFilterStartDate(range.minDate.toISOString().split("T")[0]);
        setFilterEndDate(range.maxDate.toISOString().split("T")[0]);
      }
      setIsDateFiltered(false); // Reset filter state for new file

      // Auto-match franchisee by company ID
      if (result.companyId) {
        try {
          const franchiseeResponse = await fetch(`/api/franchisees?companyId=${encodeURIComponent(result.companyId)}`);
          if (franchiseeResponse.ok) {
            const data = await franchiseeResponse.json();
            if (data.found && data.franchisee) {
              setMatchedFranchisee(data.franchisee);
            } else {
              setFranchiseeError(`לא נמצא זכיין עם ח.פ ${result.companyId}`);
            }
          }
        } catch (err) {
          console.error("Error matching franchisee:", err);
          setFranchiseeError("שגיאה בחיפוש זכיין");
        }
      } else {
        setFranchiseeError("מספר חברה (ח.פ) לא נמצא בקובץ");
      }

      // Match against suppliers
      const matches = matchBkmvSuppliers(
        result.supplierSummary,
        suppliers,
        { minConfidence: 0.6, reviewThreshold: 0.85 }
      );
      setMatchingResults(matches);
    } catch (err) {
      console.error("Error processing file:", err);
      setError(err instanceof Error ? err.message : "Failed to process file");
    } finally {
      setIsProcessing(false);
    }
  }, [selectedFile, suppliers]);

  // Add alias to supplier
  const handleAddAlias = useCallback(async (supplierId: string, alias: string) => {
    const supplier = suppliers.find(s => s.id === supplierId);
    if (!supplier) return;

    const existingAliases = supplier.bkmvAliases || [];
    if (existingAliases.includes(alias)) return;

    await updateSupplierMutation.mutateAsync({
      supplierId,
      bkmvAliases: [...existingAliases, alias],
    });

    // Re-run matching with updated suppliers
    if (parseResult) {
      const updatedSuppliers = suppliers.map(s =>
        s.id === supplierId
          ? { ...s, bkmvAliases: [...existingAliases, alias] }
          : s
      );
      const matches = matchBkmvSuppliers(
        parseResult.supplierSummary,
        updatedSuppliers,
        { minConfidence: 0.6, reviewThreshold: 0.85 }
      );
      setMatchingResults(matches);
    }
  }, [suppliers, updateSupplierMutation, parseResult]);

  // Handle date filter
  const handleDateFilter = useCallback(() => {
    if (!parseResult || !filterStartDate || !filterEndDate) return;

    // Parse dates in local time (same as BKMV parser) to avoid timezone issues
    const [startYear, startMonth, startDay] = filterStartDate.split('-').map(Number);
    const startDate = new Date(startYear, startMonth - 1, startDay);

    const [endYear, endMonth, endDay] = filterEndDate.split('-').map(Number);
    const endDate = new Date(endYear, endMonth - 1, endDay);

    // Get filtered supplier summary for the date range
    const filteredSummary = getSupplierSummaryForPeriod(parseResult, startDate, endDate);

    // Re-run matching with filtered summary
    const matches = matchBkmvSuppliers(
      filteredSummary,
      suppliers,
      { minConfidence: 0.6, reviewThreshold: 0.85 }
    );
    setMatchingResults(matches);
    setIsDateFiltered(true);
  }, [parseResult, filterStartDate, filterEndDate, suppliers]);

  // Clear date filter
  const handleClearDateFilter = useCallback(() => {
    if (!parseResult) return;

    // Re-run matching with original full summary
    const matches = matchBkmvSuppliers(
      parseResult.supplierSummary,
      suppliers,
      { minConfidence: 0.6, reviewThreshold: 0.85 }
    );
    setMatchingResults(matches);
    setFilterStartDate("");
    setFilterEndDate("");
    setIsDateFiltered(false);
  }, [parseResult, suppliers]);

  // Filter and search results
  const filteredResults = useMemo(() => {
    return matchingResults.filter(result => {
      // Status filter
      if (filterStatus === "matched" && (!result.matchResult.matchedSupplier || result.matchResult.requiresReview)) return false;
      if (filterStatus === "unmatched" && result.matchResult.matchedSupplier) return false;
      if (filterStatus === "review" && (!result.matchResult.matchedSupplier || !result.matchResult.requiresReview)) return false;

      // Search filter
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        const matchesName = result.bkmvName.toLowerCase().includes(query);
        const matchesSupplier = result.matchResult.matchedSupplier?.name.toLowerCase().includes(query);
        if (!matchesName && !matchesSupplier) return false;
      }

      return true;
    });
  }, [matchingResults, filterStatus, searchQuery]);

  // Summary stats
  const stats = useMemo(() => ({
    total: matchingResults.length,
    matched: matchingResults.filter(r => r.matchResult.matchedSupplier && !r.matchResult.requiresReview).length,
    review: matchingResults.filter(r => r.matchResult.matchedSupplier && r.matchResult.requiresReview).length,
    unmatched: matchingResults.filter(r => !r.matchResult.matchedSupplier).length,
    totalAmount: matchingResults.reduce((sum, r) => sum + r.amount, 0),
  }), [matchingResults]);

  if (isPending) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  // Helper to get status badge variant
  const getStatusBadge = (status: string) => {
    switch (status) {
      case "auto_approved":
        return <Badge variant="success" className="gap-1"><CheckCircle2 className="h-3 w-3" />אושר אוטומטית</Badge>;
      case "approved":
        return <Badge variant="success" className="gap-1"><CheckCircle2 className="h-3 w-3" />אושר</Badge>;
      case "needs_review":
        return <Badge variant="warning" className="gap-1"><AlertTriangle className="h-3 w-3" />ממתין לסקירה</Badge>;
      case "processing":
        return <Badge variant="secondary" className="gap-1"><Loader2 className="h-3 w-3 animate-spin" />מעבד</Badge>;
      case "rejected":
        return <Badge variant="destructive" className="gap-1"><XCircle className="h-3 w-3" />נדחה</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  return (
    <div className="container mx-auto p-6" dir="rtl">
      {/* Duplicate Dialog */}
      <Dialog open={duplicateDialog.open} onOpenChange={(open) => setDuplicateDialog({ ...duplicateDialog, open })}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
              קובץ קיים לתקופה זו
            </DialogTitle>
            <DialogDescription>
              כבר קיים קובץ BKMVDATA לזכיין ולתקופה שנבחרו.
            </DialogDescription>
          </DialogHeader>
          {duplicateDialog.existingFile && (
            <div className="bg-muted/50 rounded-lg p-4 space-y-2">
              <p><strong>שם קובץ:</strong> {duplicateDialog.existingFile.fileName}</p>
              <p><strong>תאריך העלאה:</strong> {new Date(duplicateDialog.existingFile.createdAt).toLocaleDateString("he-IL")}</p>
              <p><strong>סטטוס:</strong> {getStatusBadge(duplicateDialog.existingFile.processingStatus)}</p>
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setDuplicateDialog({ open: false })}>
              ביטול
            </Button>
            <Button variant="destructive" onClick={() => handleUploadToServer(true)}>
              החלף קובץ קיים
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="mb-8 flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold">עיבוד קובץ מבנה אחיד</h1>
          <p className="text-muted-foreground mt-2">
            העלה קובץ BKMVDATA כדי לזהות ספקים ולהשוות מול דוחות ספקים
          </p>
        </div>
        <a href="/admin/bkmvdata/review">
          <Button variant="outline" className="gap-2">
            <AlertTriangle className="h-4 w-4" />
            תור סקירת קבצים
          </Button>
        </a>
      </div>

      {/* Tabs for Upload and History */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6" dir="rtl">
        <TabsList className="flex w-full max-w-md gap-1">
          <TabsTrigger value="upload" className="gap-2">
            <Upload className="h-4 w-4" />
            העלאה חדשה
          </TabsTrigger>
          <TabsTrigger value="history" className="gap-2">
            <History className="h-4 w-4" />
            היסטוריה
          </TabsTrigger>
        </TabsList>

        {/* Upload Tab */}
        <TabsContent value="upload" className="space-y-6">

      {/* Upload Section */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileUp className="h-5 w-5" />
            העלאת קובץ
          </CardTitle>
          <CardDescription>
            בחר קובץ BKMVDATA.txt מהמחשב שלך - המערכת תזהה אוטומטית את הזכיין לפי מספר החברה
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Drag and Drop Zone */}
          <div
            className={`
              relative rounded-lg border-2 border-dashed p-6 transition-colors cursor-pointer
              ${isDragging ? "border-primary bg-primary/5" : "border-muted-foreground/25 hover:border-muted-foreground/50"}
              ${isProcessing ? "pointer-events-none opacity-50" : ""}
            `}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={() => {
              if (!isProcessing) {
                fileInputRef.current?.click();
              }
            }}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".txt"
              onChange={handleFileSelect}
              className="hidden"
            />
            <div className="flex flex-col items-center gap-2 text-center">
              {isProcessing ? (
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
                  <p className="text-xs text-muted-foreground">
                    קבצים נתמכים: BKMVDATA.txt
                  </p>
                </>
              )}
            </div>
          </div>

          {/* Selected file info and process button */}
          {selectedFile && !isProcessing && (
            <div className="flex items-center justify-between rounded-lg border bg-muted/50 p-3">
              <div className="flex items-center gap-2">
                <FileSpreadsheet className="h-5 w-5 text-muted-foreground" />
                <div>
                  <p className="text-sm font-medium">{selectedFile.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {(selectedFile.size / 1024).toFixed(1)} KB
                  </p>
                </div>
              </div>
              <Button
                onClick={handleProcessFile}
                disabled={isLoadingSuppliers || suppliers.length === 0}
              >
                {isLoadingSuppliers ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin ms-2" />
                    טוען ספקים...
                  </>
                ) : (
                  <>
                    <FileSpreadsheet className="h-4 w-4 ms-2" />
                    עבד קובץ
                  </>
                )}
              </Button>
            </div>
          )}

          {error && (
            <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-3">
              <p className="text-sm text-destructive">{error}</p>
            </div>
          )}

          {/* Suppliers loading status */}
          {isLoadingSuppliers && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              טוען רשימת ספקים...
            </div>
          )}

          {suppliersError && (
            <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-3">
              <p className="text-sm text-destructive">שגיאה בטעינת רשימת הספקים</p>
            </div>
          )}

          {!isLoadingSuppliers && !suppliersError && suppliers.length === 0 && (
            <div className="rounded-lg border border-amber-500/50 bg-amber-50 p-3">
              <p className="text-sm text-amber-700">לא נמצאו ספקים במערכת. יש להוסיף ספקים לפני עיבוד קובץ.</p>
            </div>
          )}

          {!isLoadingSuppliers && suppliers.length > 0 && !selectedFile && (
            <div className="flex items-center gap-2 text-sm text-green-600">
              <CheckCircle2 className="h-4 w-4" />
              {suppliers.length} ספקים נטענו
            </div>
          )}
        </CardContent>
      </Card>

      {/* Parse Results */}
      {parseResult && (
        <>
          {/* File Info & Franchisee Detection */}
          <div className="grid gap-6 md:grid-cols-2 mb-6">
            {/* File Info Card */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">פרטי קובץ</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div className="flex items-center gap-2">
                    <Building2 className="h-4 w-4 text-muted-foreground" />
                    <div>
                      <p className="text-muted-foreground">מספר חברה (ח.פ)</p>
                      <p className="font-medium font-mono">{parseResult.companyId || "לא זוהה"}</p>
                    </div>
                  </div>
                  <div>
                    <p className="text-muted-foreground">גרסת קובץ</p>
                    <p className="font-medium">{parseResult.fileVersion}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Calendar className="h-4 w-4 text-muted-foreground" />
                    <div>
                      <p className="text-muted-foreground">טווח תאריכים</p>
                      <p className="font-medium">
                        {formatDateHebrew(dateRange.minDate)} - {formatDateHebrew(dateRange.maxDate)}
                      </p>
                    </div>
                  </div>
                  <div>
                    <p className="text-muted-foreground">סה״כ רשומות</p>
                    <p className="font-medium">{parseResult.totalRecords.toLocaleString()}</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Franchisee Detection Card */}
            <Card className={matchedFranchisee ? "border-green-500/50" : franchiseeError ? "border-amber-500/50" : ""}>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <User className="h-5 w-5" />
                  זיהוי זכיין
                </CardTitle>
              </CardHeader>
              <CardContent>
                {matchedFranchisee ? (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="h-5 w-5 text-green-500" />
                      <span className="font-medium text-green-700">זכיין זוהה בהצלחה</span>
                    </div>
                    <div className="bg-green-50 rounded-lg p-3 space-y-1">
                      <p className="font-medium text-lg">{matchedFranchisee.name}</p>
                      <div className="flex items-center gap-4 text-sm text-muted-foreground">
                        <span>קוד: {matchedFranchisee.code}</span>
                        {matchedFranchisee.brand && (
                          <Badge variant="outline">{matchedFranchisee.brand.nameHe}</Badge>
                        )}
                      </div>
                      {matchedFranchisee.companyId && (
                        <p className="text-sm text-muted-foreground font-mono">ח.פ: {matchedFranchisee.companyId}</p>
                      )}
                    </div>
                  </div>
                ) : franchiseeError ? (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <AlertCircle className="h-5 w-5 text-amber-500" />
                      <span className="font-medium text-amber-700">לא ניתן לזהות זכיין</span>
                    </div>
                    <p className="text-sm text-muted-foreground">{franchiseeError}</p>
                    <p className="text-sm text-muted-foreground">
                      יש להוסיף את מספר החברה (ח.פ) בכרטיס הזכיין המתאים
                    </p>
                  </div>
                ) : (
                  <p className="text-muted-foreground">ממתין לעיבוד קובץ...</p>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Save to Server Section */}
          {matchedFranchisee && parseResult && (
            <Card className={uploadSuccess ? "border-green-500/50 bg-green-50/30" : ""}>
              <CardHeader className="pb-3">
                <CardTitle className="text-lg flex items-center gap-2">
                  <FileCheck className="h-5 w-5" />
                  שמירת קובץ בשרת
                </CardTitle>
                <CardDescription>
                  שמור את הקובץ והעיבוד בהיסטוריה לשימוש עתידי
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {uploadSuccess ? (
                  <div className="space-y-3">
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="h-5 w-5 text-green-500" />
                      <span className="font-medium text-green-700">קובץ נשמר בהצלחה!</span>
                    </div>
                    <div className="bg-green-100 rounded-lg p-3 space-y-2">
                      {uploadSuccess.autoApproved ? (
                        <p className="text-sm text-green-800">
                          הקובץ אושר אוטומטית - כל הספקים הותאמו בדיוק של 100%
                        </p>
                      ) : (
                        <p className="text-sm text-amber-800">
                          הקובץ נשלח לתור הסקירה - יש התאמות שדורשות אישור ידני
                        </p>
                      )}
                      <div className="flex items-center gap-2 mt-2">
                        <a href={`/admin/bkmvdata/review/${uploadSuccess.fileId}`}>
                          <Button size="sm" variant="outline" className="gap-1">
                            <Eye className="h-3 w-3" />
                            צפה בפרטים
                          </Button>
                        </a>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setUploadSuccess(null);
                            setActiveTab("history");
                          }}
                        >
                          <History className="h-3 w-3 ms-1" />
                          לצפייה בהיסטוריה
                        </Button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-4">
                    <div className="flex-1 text-sm text-muted-foreground">
                      <p>זכיין: <strong>{matchedFranchisee.name}</strong></p>
                      {filterStartDate && filterEndDate && (
                        <p>תקופה: {new Date(filterStartDate).toLocaleDateString("he-IL")} - {new Date(filterEndDate).toLocaleDateString("he-IL")}</p>
                      )}
                    </div>
                    <Button
                      onClick={() => handleUploadToServer(false)}
                      disabled={isUploading}
                    >
                      {isUploading ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin ms-2" />
                          שומר...
                        </>
                      ) : (
                        <>
                          <Upload className="h-4 w-4 ms-2" />
                          שמור בשרת
                        </>
                      )}
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Date Filter */}
          <Card className={`mb-6 ${isDateFiltered ? "border-blue-500/50 bg-blue-50/30" : ""}`}>
            <CardHeader className="pb-3">
              <CardTitle className="text-lg flex items-center gap-2">
                <Filter className="h-5 w-5" />
                סינון לפי טווח תאריכים
                {isDateFiltered && (
                  <Badge variant="secondary" className="bg-blue-100 text-blue-700">
                    מסונן
                  </Badge>
                )}
              </CardTitle>
              <CardDescription>
                סנן את הסכומים לפי תקופה מסוימת (חודש, רבעון וכו&apos;)
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap items-end gap-4">
                <div className="space-y-2">
                  <Label htmlFor="filterStartDate">מתאריך</Label>
                  <Input
                    id="filterStartDate"
                    type="date"
                    value={filterStartDate}
                    onChange={(e) => setFilterStartDate(e.target.value)}
                    className="w-[160px]"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="filterEndDate">עד תאריך</Label>
                  <Input
                    id="filterEndDate"
                    type="date"
                    value={filterEndDate}
                    onChange={(e) => setFilterEndDate(e.target.value)}
                    className="w-[160px]"
                  />
                </div>
                <Button
                  onClick={handleDateFilter}
                  disabled={!filterStartDate || !filterEndDate}
                  variant="default"
                >
                  <Filter className="h-4 w-4 ms-2" />
                  סנן
                </Button>
                {isDateFiltered && (
                  <Button
                    onClick={handleClearDateFilter}
                    variant="outline"
                  >
                    <X className="h-4 w-4 ms-2" />
                    נקה סינון
                  </Button>
                )}
                {isDateFiltered && (
                  <div className="text-sm text-blue-700 flex items-center gap-2 me-auto">
                    <Calendar className="h-4 w-4" />
                    מציג נתונים מ-{new Date(filterStartDate).toLocaleDateString('he-IL')} עד {new Date(filterEndDate).toLocaleDateString('he-IL')}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Matching Stats */}
          <div className="grid gap-4 md:grid-cols-5 mb-6">
            <Card
              className={`cursor-pointer transition-colors ${filterStatus === "all" ? "border-primary ring-1 ring-primary" : "hover:border-muted-foreground/50"}`}
              onClick={() => setFilterStatus("all")}
            >
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">סה״כ ספקים</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{stats.total}</div>
                <p className="text-xs text-muted-foreground mt-1">
                  {formatAmount(stats.totalAmount)}
                </p>
              </CardContent>
            </Card>
            <Card
              className={`cursor-pointer transition-colors ${filterStatus === "matched" ? "border-green-500 ring-1 ring-green-500" : "hover:border-muted-foreground/50"}`}
              onClick={() => setFilterStatus("matched")}
            >
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-green-500" />
                  תואמים
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-green-600">{stats.matched}</div>
              </CardContent>
            </Card>
            <Card
              className={`cursor-pointer transition-colors ${filterStatus === "review" ? "border-amber-500 ring-1 ring-amber-500" : "hover:border-muted-foreground/50"}`}
              onClick={() => setFilterStatus("review")}
            >
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-amber-500" />
                  לבדיקה
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-amber-600">{stats.review}</div>
              </CardContent>
            </Card>
            <Card
              className={`cursor-pointer transition-colors ${filterStatus === "unmatched" ? "border-red-500 ring-1 ring-red-500" : "hover:border-muted-foreground/50"}`}
              onClick={() => setFilterStatus("unmatched")}
            >
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <XCircle className="h-4 w-4 text-red-500" />
                  לא תואמים
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-red-600">{stats.unmatched}</div>
              </CardContent>
            </Card>
            <Card className="bg-muted/30">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">אחוז התאמה</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {stats.total > 0 ? Math.round(((stats.matched + stats.review) / stats.total) * 100) : 0}%
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Results Table */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>ספקים שזוהו בקובץ</CardTitle>
                  <CardDescription>
                    לחץ על &quot;הוסף כשם חלופי&quot; כדי לשמור את ההתאמה לעתיד
                  </CardDescription>
                </div>
                <div className="flex items-center gap-2">
                  <div className="relative">
                    <Search className="absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      placeholder="חיפוש ספק..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="ps-9 w-64"
                    />
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleProcessFile}
                    disabled={isProcessing}
                  >
                    <RefreshCw className={`h-4 w-4 ms-2 ${isProcessing ? 'animate-spin' : ''}`} />
                    רענן
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-right">שם במבנה אחיד</TableHead>
                      <TableHead className="text-right">סכום</TableHead>
                      <TableHead className="text-right">לפני מע״מ</TableHead>
                      <TableHead className="text-right">עסקאות</TableHead>
                      <TableHead className="text-right">התאמה לספק</TableHead>
                      <TableHead className="text-right">ביטחון</TableHead>
                      <TableHead className="text-right">פעולות</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredResults.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                          {matchingResults.length === 0 ? "לא נמצאו ספקים בקובץ" : "לא נמצאו תוצאות מתאימות לסינון"}
                        </TableCell>
                      </TableRow>
                    ) : (
                      filteredResults.map((result, index) => (
                        <TableRow key={index}>
                          <TableCell className="font-medium">{result.bkmvName}</TableCell>
                          <TableCell className="font-mono">{formatAmount(result.amount)}</TableCell>
                          <TableCell className="font-mono text-muted-foreground">{formatAmount(result.amount / 1.18)}</TableCell>
                          <TableCell>{result.transactionCount}</TableCell>
                          <TableCell>
                            {result.matchResult.matchedSupplier ? (
                              <div className="flex items-center gap-2">
                                <span>{result.matchResult.matchedSupplier.name}</span>
                                <Badge variant="outline" className="text-xs">
                                  {result.matchResult.matchedSupplier.code}
                                </Badge>
                              </div>
                            ) : (
                              <span className="text-muted-foreground">לא נמצאה התאמה</span>
                            )}
                          </TableCell>
                          <TableCell>
                            {result.matchResult.matchedSupplier ? (
                              <Badge
                                variant={
                                  result.matchResult.confidence >= 0.85
                                    ? "success"
                                    : result.matchResult.confidence >= 0.7
                                    ? "warning"
                                    : "destructive"
                                }
                              >
                                {Math.round(result.matchResult.confidence * 100)}%
                              </Badge>
                            ) : (
                              <Badge variant="outline">-</Badge>
                            )}
                          </TableCell>
                          <TableCell>
                            {result.matchResult.matchedSupplier && result.matchResult.matchType.startsWith("fuzzy") && (
                              <div className="flex flex-wrap items-center gap-2 justify-end">
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() =>
                                    handleAddAlias(
                                      result.matchResult.matchedSupplier!.id,
                                      result.bkmvName
                                    )
                                  }
                                  disabled={updateSupplierMutation.isPending}
                                >
                                  <Plus className="h-4 w-4 ms-1" />
                                  אשר והוסף כינוי
                                </Button>
                                <Select
                                  onValueChange={(value) => handleAddAlias(value, result.bkmvName)}
                                >
                                  <SelectTrigger className="w-[140px]">
                                    <SelectValue placeholder="בחר אחר" />
                                  </SelectTrigger>
                                  <SelectContent className="max-h-[300px]">
                                    {sortedSuppliers
                                      .filter(s => s.id !== result.matchResult.matchedSupplier?.id)
                                      .map((s) => (
                                        <SelectItem key={s.id} value={s.id}>
                                          {s.name} ({s.code})
                                        </SelectItem>
                                      ))}
                                  </SelectContent>
                                </Select>
                              </div>
                            )}
                            {result.matchResult.matchType.startsWith("exact") && (
                              <Badge variant="success" className="gap-1">
                                <CheckCircle2 className="h-3 w-3" />
                                התאמה מדויקת
                              </Badge>
                            )}
                            {!result.matchResult.matchedSupplier && result.matchResult.alternatives.length > 0 && (
                              <div className="flex flex-wrap items-center gap-2 justify-end">
                                <Select
                                  onValueChange={(value) => handleAddAlias(value, result.bkmvName)}
                                >
                                  <SelectTrigger className="w-[180px]">
                                    <SelectValue placeholder="בחר ספק ידנית" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {result.matchResult.alternatives.map((alt) => (
                                      <SelectItem key={alt.supplier.id} value={alt.supplier.id}>
                                        {alt.supplier.name} ({Math.round(alt.confidence * 100)}%)
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="text-muted-foreground hover:text-destructive"
                                  onClick={() => addToBlacklistMutation.mutate(result.bkmvName)}
                                  disabled={addToBlacklistMutation.isPending}
                                >
                                  <Ban className="h-4 w-4 ms-1" />
                                  לא רלוונטי
                                </Button>
                              </div>
                            )}
                            {!result.matchResult.matchedSupplier && result.matchResult.alternatives.length === 0 && (
                              <div className="flex flex-wrap items-center gap-2 justify-end">
                                <Select
                                  onValueChange={(value) => handleAddAlias(value, result.bkmvName)}
                                >
                                  <SelectTrigger className="w-[180px]">
                                    <SelectValue placeholder="בחר ספק מהרשימה" />
                                  </SelectTrigger>
                                  <SelectContent className="max-h-[300px]">
                                    {sortedSuppliers.map((s) => (
                                      <SelectItem key={s.id} value={s.id}>
                                        <span className="flex items-center gap-2">
                                          <span>{s.name}</span>
                                          <span className="text-xs text-muted-foreground">({s.code})</span>
                                        </span>
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="text-muted-foreground hover:text-destructive"
                                  onClick={() => addToBlacklistMutation.mutate(result.bkmvName)}
                                  disabled={addToBlacklistMutation.isPending}
                                >
                                  <Ban className="h-4 w-4 ms-1" />
                                  לא רלוונטי
                                </Button>
                              </div>
                            )}
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </>
      )}
        </TabsContent>

        {/* History Tab */}
        <TabsContent value="history" className="space-y-6">
          {/* Filters */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-lg flex items-center gap-2">
                <Filter className="h-5 w-5" />
                סינון היסטוריה
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap items-end gap-4">
                <div className="space-y-2">
                  <Label htmlFor="historyFranchisee">זכיין</Label>
                  <Select
                    value={historyFilterFranchisee}
                    onValueChange={setHistoryFilterFranchisee}
                  >
                    <SelectTrigger className="w-[200px]">
                      <SelectValue placeholder="כל הזכיינים" />
                    </SelectTrigger>
                    <SelectContent className="max-h-[300px]">
                      <SelectItem value="all">כל הזכיינים</SelectItem>
                      {sortedFranchisees.map((f) => (
                        <SelectItem key={f.id} value={f.id}>
                          {f.name} ({f.code})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="historyStatus">סטטוס</Label>
                  <Select
                    value={historyFilterStatus}
                    onValueChange={setHistoryFilterStatus}
                  >
                    <SelectTrigger className="w-[180px]">
                      <SelectValue placeholder="כל הסטטוסים" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">כל הסטטוסים</SelectItem>
                      <SelectItem value="auto_approved">אושר אוטומטית</SelectItem>
                      <SelectItem value="needs_review">ממתין לסקירה</SelectItem>
                      <SelectItem value="approved">אושר</SelectItem>
                      <SelectItem value="rejected">נדחה</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => refetchHistory()}
                  disabled={isLoadingHistory}
                >
                  <RefreshCw className={`h-4 w-4 ms-2 ${isLoadingHistory ? 'animate-spin' : ''}`} />
                  רענן
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* History Table */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <History className="h-5 w-5" />
                היסטוריית העלאות
              </CardTitle>
              <CardDescription>
                קבצי BKMVDATA שהועלו בעבר
              </CardDescription>
            </CardHeader>
            <CardContent>
              {isLoadingHistory ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
              ) : historyItems.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <FileSpreadsheet className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p>לא נמצאו קבצים בהיסטוריה</p>
                </div>
              ) : (
                <div className="rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-right">זכיין</TableHead>
                        <TableHead className="text-right">שם קובץ</TableHead>
                        <TableHead className="text-right">תקופה</TableHead>
                        <TableHead className="text-right">סטטוס</TableHead>
                        <TableHead className="text-right">התאמות</TableHead>
                        <TableHead className="text-right">תאריך העלאה</TableHead>
                        <TableHead className="text-right">פעולות</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {historyItems.map((item) => (
                        <TableRow key={item.id}>
                          <TableCell>
                            {item.franchisee ? (
                              <div>
                                <span className="font-medium">{item.franchisee.name}</span>
                                <span className="text-xs text-muted-foreground me-2">({item.franchisee.code})</span>
                              </div>
                            ) : (
                              <span className="text-muted-foreground">לא זוהה</span>
                            )}
                          </TableCell>
                          <TableCell className="font-mono text-sm">{item.fileName}</TableCell>
                          <TableCell>
                            {item.periodStartDate && item.periodEndDate ? (
                              <span className="text-sm">
                                {new Date(item.periodStartDate).toLocaleDateString("he-IL")} - {new Date(item.periodEndDate).toLocaleDateString("he-IL")}
                              </span>
                            ) : (
                              <span className="text-muted-foreground">-</span>
                            )}
                          </TableCell>
                          <TableCell>{getStatusBadge(item.processingStatus)}</TableCell>
                          <TableCell>
                            {item.matchStats ? (
                              <div className="flex items-center gap-2 text-sm">
                                <span className="text-green-600">{item.matchStats.exactMatches}</span>
                                <span className="text-muted-foreground">/</span>
                                <span className="text-amber-600">{item.matchStats.fuzzyMatches}</span>
                                <span className="text-muted-foreground">/</span>
                                <span className="text-red-600">{item.matchStats.unmatched}</span>
                              </div>
                            ) : (
                              <span className="text-muted-foreground">-</span>
                            )}
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-1 text-sm text-muted-foreground">
                              <Clock className="h-3 w-3" />
                              {new Date(item.createdAt).toLocaleDateString("he-IL")}
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <a href={`/admin/bkmvdata/review/${item.id}`}>
                                <Button size="sm" variant="outline" className="gap-1">
                                  <Eye className="h-3 w-3" />
                                  צפה
                                </Button>
                              </a>
                              {item.fileUrl && (
                                <a href={item.fileUrl} target="_blank" rel="noopener noreferrer">
                                  <Button size="sm" variant="ghost" className="gap-1">
                                    <ExternalLink className="h-3 w-3" />
                                  </Button>
                                </a>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
