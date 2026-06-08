"use client";

import { fetchWithTimeout } from "@/lib/fetch-with-timeout";
import { toast } from "sonner";
import { useState, useCallback, useMemo } from "react";
import { useRouter, useParams } from "next/navigation";
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
import { Textarea } from "@/components/ui/textarea";
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
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Loader2,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  FileText,
  Calendar,
  CalendarRange,
  Building2,
  ArrowRight,
  Check,
  X,
  Edit,
  Plus,
  Ban,
  DollarSign,
  Search,
  Store,
  ChevronDown,
  ChevronUp,
  Inbox,
  RefreshCcw,
} from "lucide-react";
import Link from "next/link";
import type { Supplier } from "@/db/schema";
import { ReviewQueueSheet } from "@/components/bkmvdata/review-queue-sheet";
import { useBkmvReviewQueueCount } from "@/queries/bkmv-review-queue";

interface SupplierMatch {
  bkmvName: string;
  amount: number;
  transactionCount: number;
  matchedSupplierId: string | null;
  matchedSupplierName: string | null;
  matchedSupplierCode: string | null;
  confidence: number;
  matchType: string;
  requiresReview: boolean;
}

interface RevenueAccount {
  accountCode: string;
  accountName: string;
  totalAmount: number;
  transactionCount: number;
  isConfirmed: boolean;
  monthlyBreakdown?: Record<string, number>;
}

interface AllAccountSummaryItem {
  accountCode: string;
  accountName: string;
  accountType: string;
  accountSort: string;
  totalAmount: number;
  transactionCount: number;
  monthlyBreakdown?: Record<string, number>;
  autoDetectedAsRevenue: boolean;
}

interface FileDetails {
  file: {
    id: string;
    fileName: string;
    fileSize: number;
    fileUrl: string;
    uploadedAt: string;
    uploadedByEmail: string | null;
    processingStatus: string;
    reviewedBy: string | null;
    reviewedAt: string | null;
    reviewNotes: string | null;
  };
  franchisee: {
    id: string;
    name: string;
    code: string;
    revenueAccountCode: string | null;
  } | null;
  uploadLink: {
    id: string;
    name: string;
    entityType: string;
  } | null;
  processingResult: {
    companyId: string | null;
    fileVersion: string;
    totalRecords: number;
    dateRange: { startDate: string; endDate: string } | null;
    matchStats: {
      total: number;
      exactMatches: number;
      fuzzyMatches: number;
      unmatched: number;
    };
    processedAt: string;
    matchedFranchiseeId: string | null;
    confirmedRevenueAccountCode: string | null;
    monthlyBreakdown: Record<string, Array<{
      supplierId: string | null;
      supplierName: string;
      amount: number;
      transactionCount: number;
    }>> | null;
    revenueMonthlyBreakdown: Record<string, number> | null;
  } | null;
  supplierMatches: SupplierMatch[];
  revenueAccounts: RevenueAccount[];
  allAccountSummaries: AllAccountSummaryItem[];
  savedRevenueCodes: string[];
}

export default function FileDetailsPage() {
  const router = useRouter();
  const params = useParams();
  const fileId = params.fileId as string;
  const queryClient = useQueryClient();

  const [reviewNotes, setReviewNotes] = useState("");
  const [isApproveDialogOpen, setIsApproveDialogOpen] = useState(false);
  const [isRejectDialogOpen, setIsRejectDialogOpen] = useState(false);
  const [isReprocessDialogOpen, setIsReprocessDialogOpen] = useState(false);
  const [editingMatch, setEditingMatch] = useState<SupplierMatch | null>(null);
  const [selectedNewSupplier, setSelectedNewSupplier] = useState<string>("");
  const [addAsAlias, setAddAsAlias] = useState(true);
  // Unmatch (remove an existing match) confirmation state
  const [unmatchingMatch, setUnmatchingMatch] = useState<SupplierMatch | null>(null);
  // Blacklist state
  const [blacklistingMatch, setBlacklistingMatch] = useState<SupplierMatch | null>(null);
  const [blacklistNotes, setBlacklistNotes] = useState("");
  // Small supplier state
  const [smallSupplierMatch, setSmallSupplierMatch] = useState<SupplierMatch | null>(null);
  const [smallSupplierNotes, setSmallSupplierNotes] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  // Status filter state
  const [matchFilter, setMatchFilter] = useState<string>("all");
  // Revenue account state
  const [revenueSearchQuery, setRevenueSearchQuery] = useState("");
  const [showOtherAccounts, setShowOtherAccounts] = useState(false);
  const [togglingRevenueCode, setTogglingRevenueCode] = useState<string | null>(null);
  // Date filter state
  const [selectedMonthStart, setSelectedMonthStart] = useState<string>("");
  const [selectedMonthEnd, setSelectedMonthEnd] = useState<string>("");
  // Review queue sheet state
  const [isQueueOpen, setIsQueueOpen] = useState(false);
  const { data: queueCount } = useBkmvReviewQueueCount();

  const { data: session, isPending } = authClient.useSession();
  const userRole = session ? (session.user as { role?: string })?.role : undefined;



  // Fetch file details
  const { data: fileData, isLoading, error } = useQuery<FileDetails>({
    queryKey: ["bkmvdata", "review", fileId],
    queryFn: async () => {
      const response = await fetchWithTimeout(`/api/bkmvdata/review/${fileId}`);
      if (!response.ok) throw new Error("Failed to fetch file details");
      return response.json();
    },
    enabled: !isPending && !!session && !!fileId,
  });

  // Fetch suppliers for manual matching
  const { data: suppliersData } = useQuery({
    queryKey: ["suppliers", "list"],
    queryFn: async () => {
      const response = await fetchWithTimeout("/api/suppliers?filter=active");
      if (!response.ok) throw new Error("Failed to fetch suppliers");
      return response.json();
    },
    enabled: !isPending && !!session,
  });

  const suppliers: Supplier[] = useMemo(
    () => suppliersData?.suppliers || [],
    [suppliersData?.suppliers]
  );
  const sortedSuppliers = useMemo(() => {
    return [...suppliers].sort((a, b) => a.name.localeCompare(b.name, 'he'));
  }, [suppliers]);

  // Set of supplier IDs already matched to OTHER bkmv names in this file
  // (excludes the supplier currently assigned to the row being edited)
  const alreadyMatchedSupplierIds = useMemo(() => {
    const matches = fileData?.supplierMatches || [];
    const ids = new Set<string>();
    for (const m of matches) {
      if (m.matchedSupplierId && m.bkmvName !== editingMatch?.bkmvName) {
        ids.add(m.matchedSupplierId);
      }
    }
    return ids;
  }, [fileData?.supplierMatches, editingMatch?.bkmvName]);

  // Flat list of suppliers with a flag for "already matched to another row in this file".
  // Mapping the same supplier to multiple bkmvNames is intentionally supported (alias mechanism).
  const dropdownSuppliers = useMemo(() => {
    return sortedSuppliers.map((s) => ({
      supplier: s,
      isAlreadyMatched: alreadyMatchedSupplierIds.has(s.id),
    }));
  }, [sortedSuppliers, alreadyMatchedSupplierIds]);

  // Extract available months from monthlyBreakdown
  const availableMonths = useMemo(() => {
    const mb = fileData?.processingResult?.monthlyBreakdown;
    if (!mb) return [];
    return Object.keys(mb).sort();
  }, [fileData?.processingResult?.monthlyBreakdown]);

  const hasMonthlyBreakdown = availableMonths.length > 0;
  const isDateFilterActive = hasMonthlyBreakdown && selectedMonthStart !== "";

  // Format YYYY-MM to Hebrew month label
  const formatMonthLabel = useCallback((yyyymm: string) => {
    const [year, month] = yyyymm.split("-");
    const monthNames = [
      "ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני",
      "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר",
    ];
    return `${monthNames[parseInt(month, 10) - 1]} ${year}`;
  }, []);

  // Filter end month options to be >= start month
  const endMonthOptions = useMemo(() => {
    if (!selectedMonthStart) return availableMonths;
    return availableMonths.filter((m) => m >= selectedMonthStart);
  }, [availableMonths, selectedMonthStart]);

  // Re-aggregate supplier matches based on date filter
  const dateFilteredMatches = useMemo(() => {
    const matches = fileData?.supplierMatches || [];
    const mb = fileData?.processingResult?.monthlyBreakdown;
    if (!isDateFilterActive || !mb) return matches;

    const effectiveEnd = selectedMonthEnd || selectedMonthStart;

    // Aggregate amounts per bkmvName for selected months
    const aggregated = new Map<string, { amount: number; transactionCount: number }>();
    for (const [month, entries] of Object.entries(mb)) {
      if (month < selectedMonthStart || month > effectiveEnd) continue;
      for (const entry of entries) {
        const existing = aggregated.get(entry.supplierName);
        if (existing) {
          existing.amount += entry.amount;
          existing.transactionCount += entry.transactionCount;
        } else {
          aggregated.set(entry.supplierName, {
            amount: entry.amount,
            transactionCount: entry.transactionCount,
          });
        }
      }
    }

    // Overlay filtered amounts onto original matches (preserve match metadata)
    return matches.map((match) => {
      const filtered = aggregated.get(match.bkmvName);
      return {
        ...match,
        amount: filtered?.amount ?? 0,
        transactionCount: filtered?.transactionCount ?? 0,
      };
    });
  }, [fileData?.supplierMatches, fileData?.processingResult?.monthlyBreakdown, isDateFilterActive, selectedMonthStart, selectedMonthEnd]);

  // Filtered total for the indicator
  const dateFilteredTotal = useMemo(() => {
    if (!isDateFilterActive) return null;
    let totalAmount = 0;
    let totalTransactions = 0;
    for (const m of dateFilteredMatches) {
      totalAmount += m.amount;
      totalTransactions += m.transactionCount;
    }
    return { totalAmount, totalTransactions };
  }, [isDateFilterActive, dateFilteredMatches]);

  // Status-filtered matches
  const statusFilteredMatches = useMemo(() => {
    if (matchFilter === "all") return dateFilteredMatches;
    return dateFilteredMatches.filter((m) => {
      switch (matchFilter) {
        case "matched": return !!m.matchedSupplierId;
        case "unmatched": return !m.matchedSupplierId && m.matchType !== "blacklisted" && m.matchType !== "small_supplier";
        case "small_supplier": return m.matchType === "small_supplier";
        case "blacklisted": return m.matchType === "blacklisted";
        default: return true;
      }
    });
  }, [dateFilteredMatches, matchFilter]);

  const filteredMatches = useMemo(() => {
    const matches = statusFilteredMatches;
    if (!searchQuery.trim()) return matches;
    const query = searchQuery.trim().toLowerCase();
    return matches.filter((m) =>
      m.bkmvName.toLowerCase().includes(query) ||
      m.matchedSupplierName?.toLowerCase().includes(query)
    );
  }, [statusFilteredMatches, searchQuery]);

  // Review action mutation
  const reviewMutation = useMutation({
    mutationFn: async ({ action, notes }: { action: "approve" | "reject"; notes: string }) => {
      const response = await fetchWithTimeout("/api/bkmvdata/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileId, action, notes }),
      });
      if (!response.ok) throw new Error("Failed to process review");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["bkmvdata", "review"] });
      router.push("/admin/bkmvdata/review");
    },
  });

  // Back-to-processing mutation: re-runs parser + matcher and resets the file
  // to needs_review. Manual overrides are preserved server-side.
  const reprocessMutation = useMutation({
    mutationFn: async () => {
      const response = await fetchWithTimeout(
        `/api/bkmvdata/review/${fileId}/reprocess`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
        }
      );
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || "החזרה לעיבוד נכשלה");
      }
      return response.json() as Promise<{
        manualMatchesPreserved: number;
        message: string;
      }>;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["bkmvdata", "review", fileId] });
      queryClient.invalidateQueries({ queryKey: ["bkmvdata", "review"] });
      setIsReprocessDialogOpen(false);
      toast.success(
        data.manualMatchesPreserved > 0
          ? `הקובץ עובד מחדש (${data.manualMatchesPreserved} התאמות ידניות נשמרו)`
          : data.message
      );
    },
    onError: (err: Error) => {
      toast.error(err.message || "החזרה לעיבוד נכשלה");
    },
  });

  // Manual match mutation
  const matchMutation = useMutation({
    mutationFn: async ({ bkmvName, newSupplierId, addAlias }: { bkmvName: string; newSupplierId: string; addAlias: boolean }) => {
      const response = await fetchWithTimeout(`/api/bkmvdata/review/${fileId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bkmvName, newSupplierId, addAsAlias: addAlias }),
      });
      if (!response.ok) {
        const err = await response.json().catch(() => ({ error: "שמירת ההתאמה נכשלה" }));
        throw new Error(err.error || "שמירת ההתאמה נכשלה");
      }
      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["bkmvdata", "review", fileId] });
      setEditingMatch(null);
      setSelectedNewSupplier("");
      toast.success(data?.message || "ההתאמה נשמרה");
    },
    onError: (err: Error) => {
      toast.error(err.message || "שמירת ההתאמה נכשלה");
    },
  });

  // Unmatch mutation — removes an existing match, reverting the row to "לא מותאם"
  const unmatchMutation = useMutation({
    mutationFn: async ({ bkmvName }: { bkmvName: string }) => {
      const response = await fetchWithTimeout(`/api/bkmvdata/review/${fileId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bkmvName, unmatch: true }),
      });
      if (!response.ok) {
        const err = await response.json().catch(() => ({ error: "ביטול ההתאמה נכשל" }));
        throw new Error(err.error || "ביטול ההתאמה נכשל");
      }
      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["bkmvdata", "review", fileId] });
      setUnmatchingMatch(null);
      setEditingMatch(null);
      toast.success(data?.message || "ההתאמה בוטלה");
    },
    onError: (err: Error) => {
      toast.error(err.message || "ביטול ההתאמה נכשל");
    },
  });

  // Blacklist mutation
  const blacklistMutation = useMutation({
    mutationFn: async ({ name, notes }: { name: string; notes?: string }) => {
      const response = await fetchWithTimeout("/api/bkmvdata/blacklist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, notes }),
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to add to blacklist");
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["bkmvdata", "review", fileId] });
      queryClient.invalidateQueries({ queryKey: ["bkmvdata", "blacklist"] });
      setBlacklistingMatch(null);
      setBlacklistNotes("");
    },
  });

  // Small supplier mutation
  const smallSupplierMutation = useMutation({
    mutationFn: async ({ name, notes }: { name: string; notes?: string }) => {
      // 1. Add to small supplier table
      const addResponse = await fetchWithTimeout("/api/bkmvdata/small-supplier", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, notes }),
      });
      if (!addResponse.ok) {
        const error = await addResponse.json();
        throw new Error(error.error || "Failed to add small supplier");
      }
      // 2. Update match type in processing result
      const patchResponse = await fetchWithTimeout(`/api/bkmvdata/review/${fileId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bkmvName: name, markAsSmallSupplier: true }),
      });
      if (!patchResponse.ok) {
        throw new Error("Failed to update match type");
      }
      return patchResponse.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["bkmvdata", "review", fileId] });
      queryClient.invalidateQueries({ queryKey: ["bkmvdata", "small-supplier"] });
      setSmallSupplierMatch(null);
      setSmallSupplierNotes("");
    },
  });

  // Revenue toggle mutation — immediate save per row
  const revenueToggleMutation = useMutation({
    mutationFn: async ({ accountCodes }: { accountCodes: string[] }) => {
      const response = await fetchWithTimeout(`/api/bkmvdata/review/${fileId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ revenueAccountCodes: accountCodes }),
      });
      if (!response.ok) throw new Error("Failed to update revenue accounts");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["bkmvdata", "review", fileId] });
      setTogglingRevenueCode(null);
    },
    onError: () => {
      toast.error("שגיאה בעדכון חשבון הכנסות");
      setTogglingRevenueCode(null);
    },
  });

  const handleApprove = useCallback(() => {
    reviewMutation.mutate({ action: "approve", notes: reviewNotes });
  }, [reviewMutation, reviewNotes]);

  const handleReject = useCallback(() => {
    reviewMutation.mutate({ action: "reject", notes: reviewNotes });
  }, [reviewMutation, reviewNotes]);

  const handleSaveMatch = useCallback(() => {
    if (!editingMatch || !selectedNewSupplier) return;
    matchMutation.mutate({
      bkmvName: editingMatch.bkmvName,
      newSupplierId: selectedNewSupplier,
      addAlias: addAsAlias,
    });
  }, [editingMatch, selectedNewSupplier, addAsAlias, matchMutation]);

  const handleUnmatch = useCallback(() => {
    if (!unmatchingMatch) return;
    unmatchMutation.mutate({ bkmvName: unmatchingMatch.bkmvName });
  }, [unmatchingMatch, unmatchMutation]);

  const handleBlacklist = useCallback(() => {
    if (!blacklistingMatch) return;
    blacklistMutation.mutate({
      name: blacklistingMatch.bkmvName,
      notes: blacklistNotes || undefined,
    });
  }, [blacklistingMatch, blacklistNotes, blacklistMutation]);

  const handleSmallSupplier = useCallback(() => {
    if (!smallSupplierMatch) return;
    smallSupplierMutation.mutate({
      name: smallSupplierMatch.bkmvName,
      notes: smallSupplierNotes || undefined,
    });
  }, [smallSupplierMatch, smallSupplierNotes, smallSupplierMutation]);

  const formatDate = (dateStr: string) => {
    return new Intl.DateTimeFormat("he-IL", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(dateStr));
  };

  const formatAmount = (amount: number) => {
    return new Intl.NumberFormat("he-IL", {
      style: "currency",
      currency: "ILS",
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const getMatchBadge = (match: SupplierMatch) => {
    // Check for blacklisted items
    if (match.matchType === "blacklisted") {
      return <Badge variant="secondary" className="gap-1 bg-gray-200"><Ban className="h-3 w-3" />לא רלוונטי</Badge>;
    }
    if (match.matchType === "small_supplier") {
      return <Badge variant="secondary" className="gap-1 bg-blue-100 text-blue-700"><Store className="h-3 w-3" />ספק קטן</Badge>;
    }
    if (!match.matchedSupplierId) {
      return <Badge variant="destructive">לא מותאם</Badge>;
    }
    if (match.matchType === "manual") {
      return <Badge variant="success" className="gap-1"><Check className="h-3 w-3" />ידני</Badge>;
    }
    if (match.confidence === 1) {
      return <Badge variant="success">100%</Badge>;
    }
    return <Badge variant="warning">{Math.round(match.confidence * 100)}%</Badge>;
  };

  if (isPending || isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !fileData) {
    return (
      <div className="container mx-auto p-6">
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-center">
          <p className="text-destructive">שגיאה בטעינת פרטי הקובץ</p>
          <Link href="/admin/bkmvdata/review">
            <Button variant="outline" className="mt-4">
              <ArrowRight className="h-4 w-4 ms-2" />
              חזרה לתור הסקירה
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  const { file, franchisee, processingResult, supplierMatches, revenueAccounts, allAccountSummaries, savedRevenueCodes } = fileData;
  const isReviewed = file.processingStatus === "approved" || file.processingStatus === "rejected";

  return (
    <div className="container mx-auto px-4 py-3">
      {/* Header */}
      <div className="mb-4 flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Link href="/admin/bkmvdata/review">
              <Button variant="ghost" size="sm" className="h-7 px-2 text-xs">
                <ArrowRight className="h-3.5 w-3.5 ms-1" />
                חזרה
              </Button>
            </Link>
            <h1 className="text-lg font-bold">פרטי קובץ לסקירה</h1>
          </div>
          <p className="text-sm text-muted-foreground">{file.fileName}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => setIsQueueOpen(true)}
            title="פתח רשימת קבצים ממתינים לסקירה"
          >
            <Inbox className="h-3.5 w-3.5 ms-1.5" />
            קבצים לסקירה
            {typeof queueCount === "number" && queueCount > 0 && (
              <Badge variant="secondary" className="ms-2 h-5 px-1.5">
                {queueCount}
              </Badge>
            )}
          </Button>
          {!isReviewed && (
            <>
              <Button
                size="sm"
                className="bg-green-600 hover:bg-green-700"
                onClick={() => setIsApproveDialogOpen(true)}
              >
                <Check className="h-3.5 w-3.5 ms-1.5" />
                אשר קובץ
              </Button>
              <Button
                size="sm"
                variant="destructive"
                onClick={() => setIsRejectDialogOpen(true)}
              >
                <X className="h-3.5 w-3.5 ms-1.5" />
                דחה קובץ
              </Button>
            </>
          )}
          {isReviewed && (
            <Badge variant={file.processingStatus === "approved" ? "success" : "destructive"} className="text-sm px-3 py-1">
              {file.processingStatus === "approved" ? "אושר" : "נדחה"}
            </Badge>
          )}
          <Button
            size="sm"
            variant="outline"
            onClick={() => setIsReprocessDialogOpen(true)}
            disabled={reprocessMutation.isPending}
            title="הרץ עיבוד מחדש על הקובץ"
          >
            {reprocessMutation.isPending ? (
              <Loader2 className="h-3.5 w-3.5 ms-1.5 animate-spin" />
            ) : (
              <RefreshCcw className="h-3.5 w-3.5 ms-1.5" />
            )}
            חזור לעיבוד
          </Button>
        </div>
      </div>

      <AlertDialog
        open={isReprocessDialogOpen}
        onOpenChange={setIsReprocessDialogOpen}
      >
        <AlertDialogContent className="max-w-md" dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-right">
              <RefreshCcw className="h-5 w-5 text-primary" />
              חזרה לעיבוד הקובץ
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3 text-right">
                <p>
                  פעולה זו תריץ עיבוד מחדש של הקובץ — פירוק BKMV, התאמת ספקים ובניית סיכום חודשי.
                </p>
                <p>
                  ההתאמות הידניות של הספקים, רשימת ה-blacklist, ספקים קטנים וקודי הכנסה מאושרים יישמרו.
                </p>
                <p className="text-muted-foreground text-sm">
                  לאחר העיבוד הקובץ יחזור למצב &quot;דורש בדיקה&quot; — תצטרך/י לאשר אותו מחדש.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-row-reverse gap-2 sm:gap-2">
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                reprocessMutation.mutate();
              }}
              disabled={reprocessMutation.isPending}
              className="bg-primary"
            >
              {reprocessMutation.isPending ? "מעבד..." : "חזור לעיבוד"}
            </AlertDialogAction>
            <AlertDialogCancel disabled={reprocessMutation.isPending}>
              ביטול
            </AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <ReviewQueueSheet
        currentFileId={fileId}
        open={isQueueOpen}
        onOpenChange={setIsQueueOpen}
      />

      {/* File Info & Stats */}
      <div className="grid gap-3 md:grid-cols-2 mb-4">
        {/* File Info Card */}
        <Card>
          <CardHeader className="pb-2 pt-3 px-4">
            <CardTitle className="flex items-center gap-2 text-sm font-semibold">
              <FileText className="h-4 w-4" />
              פרטי קובץ
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-3 pt-0 space-y-2">
            <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <div>
                <p className="text-xs text-muted-foreground">שם קובץ</p>
                <p className="font-medium text-sm">{file.fileName}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">גודל</p>
                <p className="font-medium text-sm">{formatFileSize(file.fileSize)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">תאריך העלאה</p>
                <p className="font-medium text-sm">{formatDate(file.uploadedAt)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">מייל מעלה</p>
                <p className="font-medium text-sm">{file.uploadedByEmail || "לא צוין"}</p>
              </div>
              {processingResult?.dateRange && (
                <div className="col-span-2">
                  <p className="text-xs text-muted-foreground">תקופה בקובץ</p>
                  <p className="font-medium text-sm">
                    {new Date(processingResult.dateRange.startDate).toLocaleDateString("he-IL")}
                    {" - "}
                    {new Date(processingResult.dateRange.endDate).toLocaleDateString("he-IL")}
                  </p>
                </div>
              )}
            </div>
            {franchisee && (
              <div className="mt-2 p-2 bg-muted rounded">
                <div className="flex items-center gap-2">
                  <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
                  <div>
                    <p className="font-medium text-sm">{franchisee.name}</p>
                    <p className="text-xs text-muted-foreground">קוד: {franchisee.code}</p>
                  </div>
                </div>
              </div>
            )}
            {isReviewed && file.reviewedAt && (
              <div className="mt-2 pt-2 border-t">
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                  <div>
                    <p className="text-xs text-muted-foreground">תאריך סקירה</p>
                    <p className="font-medium text-sm">{formatDate(file.reviewedAt)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">סטטוס</p>
                    <Badge variant={file.processingStatus === "approved" ? "success" : "destructive"} className="text-xs">
                      {file.processingStatus === "approved" ? "אושר" : "נדחה"}
                    </Badge>
                  </div>
                  {file.reviewNotes && (
                    <div className="col-span-2 mt-1">
                      <p className="text-xs text-muted-foreground">הערות</p>
                      <p className="font-medium text-sm">{file.reviewNotes}</p>
                    </div>
                  )}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Stats Card */}
        <Card>
          <CardHeader className="pb-2 pt-3 px-4">
            <CardTitle className="text-sm font-semibold">סטטיסטיקות התאמה</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-3 pt-0">
            {processingResult?.matchStats ? (
              <div className="grid grid-cols-2 gap-2">
                <div className="text-center p-2.5 bg-muted rounded">
                  <p className="text-2xl font-bold">{processingResult.matchStats.total}</p>
                  <p className="text-xs text-muted-foreground">סה״כ ספקים</p>
                </div>
                <div className="text-center p-2.5 bg-green-50 rounded">
                  <p className="text-2xl font-bold text-green-600">{processingResult.matchStats.exactMatches}</p>
                  <p className="text-xs text-muted-foreground">התאמות מלאות</p>
                </div>
                <div className="text-center p-2.5 bg-amber-50 rounded">
                  <p className="text-2xl font-bold text-amber-600">{processingResult.matchStats.fuzzyMatches}</p>
                  <p className="text-xs text-muted-foreground">התאמות חלקיות</p>
                </div>
                <div className="text-center p-2.5 bg-red-50 rounded">
                  <p className="text-2xl font-bold text-red-600">{processingResult.matchStats.unmatched}</p>
                  <p className="text-xs text-muted-foreground">לא מותאמים</p>
                </div>
              </div>
            ) : (
              <p className="text-muted-foreground text-sm">אין נתוני עיבוד</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Date Filter */}
      {hasMonthlyBreakdown && (
        <Card className={`mb-4 ${isDateFilterActive ? "border-blue-300 bg-blue-50/30" : ""}`}>
          <CardHeader className="pb-2 pt-3 px-4">
            <CardTitle className="flex items-center gap-2 text-sm font-semibold">
              <CalendarRange className="h-4 w-4" />
              סינון לפי תקופה
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-3 pt-0">
            <div className="flex items-center gap-3 flex-wrap">
              <div className="flex items-center gap-1.5">
                <label className="text-xs text-muted-foreground whitespace-nowrap">מחודש</label>
                <Select
                  value={selectedMonthStart}
                  onValueChange={(val) => {
                    setSelectedMonthStart(val);
                    // Reset end month if it's now before start
                    if (selectedMonthEnd && selectedMonthEnd < val) {
                      setSelectedMonthEnd("");
                    }
                  }}
                >
                  <SelectTrigger className="w-[180px]">
                    <SelectValue placeholder="בחר חודש..." />
                  </SelectTrigger>
                  <SelectContent>
                    {availableMonths.map((month) => (
                      <SelectItem key={month} value={month}>
                        {formatMonthLabel(month)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center gap-1.5">
                <label className="text-xs text-muted-foreground whitespace-nowrap">עד חודש</label>
                <Select
                  value={selectedMonthEnd}
                  onValueChange={setSelectedMonthEnd}
                  disabled={!selectedMonthStart}
                >
                  <SelectTrigger className="w-[180px]">
                    <SelectValue placeholder={selectedMonthStart ? "עד (אופציונלי)..." : "בחר חודש התחלה קודם"} />
                  </SelectTrigger>
                  <SelectContent>
                    {endMonthOptions.map((month) => (
                      <SelectItem key={month} value={month}>
                        {formatMonthLabel(month)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {isDateFilterActive && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setSelectedMonthStart("");
                    setSelectedMonthEnd("");
                  }}
                >
                  <X className="h-4 w-4 ms-1" />
                  נקה סינון
                </Button>
              )}
            </div>
            {isDateFilterActive && dateFilteredTotal && (
              <div className="mt-2 flex items-center gap-3 text-xs">
                <Badge variant="secondary" className="gap-1">
                  <Calendar className="h-3 w-3" />
                  {selectedMonthEnd && selectedMonthEnd !== selectedMonthStart
                    ? `${formatMonthLabel(selectedMonthStart)} - ${formatMonthLabel(selectedMonthEnd)}`
                    : formatMonthLabel(selectedMonthStart)}
                </Badge>
                <span className="text-muted-foreground">
                  סה״כ מסונן: <span className="font-mono font-medium text-foreground">{formatAmount(dateFilteredTotal.totalAmount)}</span>
                  {" "}({dateFilteredTotal.totalTransactions} עסקאות)
                </span>
              </div>
            )}
          </CardContent>
        </Card>
      )}


      {/* Revenue Account Classification — table of ALL accounts, toggle per row */}
      {(() => {
        // Use allAccountSummaries if available, fall back to revenueAccounts for older files
        const hasAllAccounts = allAccountSummaries && allAccountSummaries.length > 0;
        const hasRevenueOnly = revenueAccounts && revenueAccounts.length > 0;
        if (!hasAllAccounts && !hasRevenueOnly) return null;

        const savedCodesSet = new Set(savedRevenueCodes || []);

        // Build unified account list with classification status
        type AccountRow = {
          accountCode: string;
          accountName: string;
          accountType: string;
          totalAmount: number;
          transactionCount: number;
          monthlyBreakdown?: Record<string, number>;
          isSavedRevenue: boolean;
          autoDetected: boolean;
        };

        let allRows: AccountRow[];

        if (hasAllAccounts) {
          allRows = allAccountSummaries.map(a => ({
            accountCode: a.accountCode,
            accountName: a.accountName,
            accountType: a.accountType || "",
            totalAmount: a.totalAmount,
            transactionCount: a.transactionCount,
            monthlyBreakdown: a.monthlyBreakdown,
            isSavedRevenue: savedCodesSet.has(a.accountCode),
            autoDetected: a.autoDetectedAsRevenue,
          }));
        } else {
          allRows = (revenueAccounts || []).map(a => ({
            accountCode: a.accountCode,
            accountName: a.accountName,
            accountType: "",
            totalAmount: a.totalAmount,
            transactionCount: a.transactionCount,
            monthlyBreakdown: a.monthlyBreakdown,
            isSavedRevenue: savedCodesSet.has(a.accountCode),
            autoDetected: true,
          }));
        }

        // Apply date filter to amounts
        if (isDateFilterActive) {
          const effectiveEnd = selectedMonthEnd || selectedMonthStart;
          allRows = allRows.map(row => {
            if (!row.monthlyBreakdown) return row;
            let filteredAmount = 0;
            for (const [month, amount] of Object.entries(row.monthlyBreakdown)) {
              if (month >= selectedMonthStart && month <= effectiveEnd) {
                filteredAmount += amount;
              }
            }
            return { ...row, totalAmount: filteredAmount };
          });
        }

        // Apply search filter
        const searchFiltered = revenueSearchQuery.trim()
          ? allRows.filter(a =>
              a.accountName.includes(revenueSearchQuery.trim()) ||
              a.accountCode.includes(revenueSearchQuery.trim()) ||
              a.accountType.includes(revenueSearchQuery.trim())
            )
          : allRows;

        // Split: revenue accounts (saved + auto-detected) at top, rest below
        const revenueRows = searchFiltered.filter(a => a.isSavedRevenue || a.autoDetected);
        const otherRows = searchFiltered.filter(a => !a.isSavedRevenue && !a.autoDetected);

        // Saved codes NOT found in this file
        const missingSavedCodes = (savedRevenueCodes || []).filter(
          code => !allRows.some(a => a.accountCode === code)
        );

        // Toggle: add or remove a single account code and save immediately
        const handleToggleRevenue = (accountCode: string) => {
          setTogglingRevenueCode(accountCode);
          const currentCodes = new Set(savedRevenueCodes || []);
          if (currentCodes.has(accountCode)) {
            currentCodes.delete(accountCode);
          } else {
            currentCodes.add(accountCode);
          }
          revenueToggleMutation.mutate({ accountCodes: Array.from(currentCodes) });
        };

        const tableHeaders = (
          <TableRow>
            <TableHead className="text-xs py-1.5">קוד</TableHead>
            <TableHead className="text-xs py-1.5">שם חשבון</TableHead>
            <TableHead className="text-xs py-1.5">סוג חשבון</TableHead>
            <TableHead className="text-xs py-1.5">סכום</TableHead>
            <TableHead className="text-xs py-1.5">עסקאות</TableHead>
            <TableHead className="text-xs py-1.5">סטטוס</TableHead>
            <TableHead className="text-xs py-1.5 w-24">פעולה</TableHead>
          </TableRow>
        );

        const renderRow = (row: AccountRow) => {
          const isToggling = togglingRevenueCode === row.accountCode;
          const rowBg = row.isSavedRevenue
            ? "bg-green-50/50"
            : row.autoDetected
              ? "bg-amber-50/30"
              : "";

          return (
            <TableRow key={row.accountCode} className={rowBg}>
              <TableCell className="font-mono text-xs py-1.5">{row.accountCode}</TableCell>
              <TableCell className="text-sm py-1.5">{row.accountName}</TableCell>
              <TableCell className="text-xs text-muted-foreground py-1.5">{row.accountType}</TableCell>
              <TableCell className="font-mono text-sm py-1.5">{formatAmount(row.totalAmount)}</TableCell>
              <TableCell className="text-xs text-muted-foreground py-1.5">{row.transactionCount}</TableCell>
              <TableCell className="py-1.5">
                {row.isSavedRevenue ? (
                  <Badge variant="success" className="gap-1 text-xs">
                    <Check className="h-3 w-3" />
                    הכנסה
                  </Badge>
                ) : row.autoDetected ? (
                  <Badge variant="outline" className="gap-1 text-xs border-amber-300 text-amber-700 bg-amber-50">
                    זוהה אוטומטית
                  </Badge>
                ) : null}
              </TableCell>
              <TableCell className="py-1.5">
                {!isReviewed && (
                  <Button
                    variant={row.isSavedRevenue ? "outline" : "default"}
                    size="sm"
                    className="h-6 text-xs px-2"
                    disabled={isToggling || revenueToggleMutation.isPending}
                    onClick={() => handleToggleRevenue(row.accountCode)}
                  >
                    {isToggling ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : row.isSavedRevenue ? (
                      <>
                        <X className="h-3 w-3 ms-1" />
                        הסר
                      </>
                    ) : (
                      <>
                        <Plus className="h-3 w-3 ms-1" />
                        סמן כהכנסה
                      </>
                    )}
                  </Button>
                )}
              </TableCell>
            </TableRow>
          );
        };

        return (
          <Card className="mb-4">
            <CardHeader className="pb-2 pt-3 px-4">
              <CardTitle className="flex items-center gap-2 text-sm font-semibold">
                <DollarSign className="h-4 w-4" />
                סיווג חשבונות הכנסות
                {savedCodesSet.size > 0 && (
                  <Badge variant="secondary" className="text-xs">
                    {savedCodesSet.size} שמורים
                  </Badge>
                )}
                {!hasAllAccounts && (
                  <Badge variant="outline" className="gap-1 text-xs text-muted-foreground">
                    קובץ ישן — רק חשבונות שזוהו
                  </Badge>
                )}
              </CardTitle>
              <CardDescription className="text-xs">
                לחץ &quot;סמן כהכנסה&quot; כדי לשמור חשבון כהכנסות לזכיין. השינוי נשמר מיד.
              </CardDescription>
            </CardHeader>
            <CardContent className="px-4 pb-3 pt-0">
              {/* Search */}
              <div className="flex items-center gap-2 mb-3">
                <div className="relative flex-1">
                  <Search className="absolute start-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                  <Input
                    placeholder="חיפוש לפי שם חשבון, קוד או סוג..."
                    value={revenueSearchQuery}
                    onChange={(e) => setRevenueSearchQuery(e.target.value)}
                    className="ps-8 h-8 text-sm"
                  />
                </div>
              </div>

              {/* Revenue accounts table (saved + auto-detected) */}
              {revenueRows.length > 0 && (
                <div className="rounded-md border mb-3">
                  <Table>
                    <TableHeader>{tableHeaders}</TableHeader>
                    <TableBody>
                      {revenueRows.map(renderRow)}
                      {missingSavedCodes.map(code => (
                        <TableRow key={`missing-${code}`} className="bg-muted/20">
                          <TableCell className="font-mono text-xs py-1.5 text-muted-foreground line-through">{code}</TableCell>
                          <TableCell colSpan={4} className="text-xs text-muted-foreground py-1.5">—</TableCell>
                          <TableCell className="py-1.5">
                            <Badge variant="outline" className="gap-1 text-xs border-orange-300 text-orange-600">
                              <AlertTriangle className="h-3 w-3" />
                              לא בקובץ
                            </Badge>
                          </TableCell>
                          <TableCell className="py-1.5" />
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}

              {/* Other accounts — collapsible */}
              {otherRows.length > 0 && (
                <div>
                  <button
                    type="button"
                    onClick={() => setShowOtherAccounts(!showOtherAccounts)}
                    className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors mb-2"
                  >
                    {showOtherAccounts ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                    חשבונות אחרים ({otherRows.length})
                  </button>
                  {showOtherAccounts && (
                    <div className="rounded-md border">
                      <Table>
                        <TableHeader>{tableHeaders}</TableHeader>
                        <TableBody>
                          {otherRows.map(renderRow)}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </div>
              )}

              {/* No results after search */}
              {revenueRows.length === 0 && otherRows.length === 0 && revenueSearchQuery.trim() && (
                <p className="text-xs text-muted-foreground text-center py-4">
                  לא נמצאו חשבונות מתאימים לחיפוש
                </p>
              )}
            </CardContent>
          </Card>
        );
      })()}

      {/* Matches Table */}
      <Card>
        <CardHeader className="pb-2 pt-3 px-4">
          <CardTitle className="text-sm font-semibold">טבלת התאמות ספקים</CardTitle>
          <CardDescription className="text-xs">
            {!isReviewed && "לחץ על עריכה כדי לשנות התאמה או להוסיף כינוי לספק"}
          </CardDescription>
        </CardHeader>
        <CardContent className="px-4 pb-3 pt-0">
          <div className="flex items-center gap-2 mb-3">
            <div className="relative flex-1">
              <Search className="absolute start-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                placeholder="חיפוש לפי שם במבנה אחיד..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="ps-8 h-8 text-sm"
              />
            </div>
            <Select value={matchFilter} onValueChange={setMatchFilter}>
              <SelectTrigger className="w-[160px] h-8 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">הכל</SelectItem>
                <SelectItem value="matched">מותאמים</SelectItem>
                <SelectItem value="unmatched">לא מותאמים</SelectItem>
                <SelectItem value="small_supplier">ספקים קטנים</SelectItem>
                <SelectItem value="blacklisted">רשימה שחורה</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-right text-xs py-2">שם במבנה אחיד</TableHead>
                  <TableHead className="text-right text-xs py-2">סכום</TableHead>
                  <TableHead className="text-right text-xs py-2">עסקאות</TableHead>
                  <TableHead className="text-right text-xs py-2">ספק מותאם</TableHead>
                  <TableHead className="text-right text-xs py-2">סטטוס</TableHead>
                  {!isReviewed && <TableHead className="text-right text-xs py-2">פעולות</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredMatches.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={isReviewed ? 5 : 6} className="text-center py-4 text-sm text-muted-foreground">
                      {searchQuery.trim() ? "לא נמצאו תוצאות" : "אין נתוני התאמות"}
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredMatches.map((match, index) => (
                    <TableRow
                                    key={index}
                                    className={
                                      match.matchType === "blacklisted"
                                        ? "bg-gray-50/50"
                                        : match.matchType === "small_supplier"
                                        ? "bg-blue-50/50"
                                        : !match.matchedSupplierId
                                        ? "bg-red-50/50"
                                        : match.confidence < 1 && match.matchType !== "manual" && match.matchType !== "exact"
                                        ? "bg-amber-50/50"
                                        : ""
                                    }
                                  >
                      <TableCell className="font-medium text-sm py-1.5">{match.bkmvName}</TableCell>
                      <TableCell className="font-mono text-sm py-1.5">{formatAmount(match.amount)}</TableCell>
                      <TableCell className="text-sm py-1.5">{match.transactionCount}</TableCell>
                      <TableCell className="py-1.5">
                        {match.matchedSupplierId ? (
                          <div>
                            <p className="font-medium text-sm">{match.matchedSupplierName}</p>
                            {match.matchedSupplierCode && (
                              <p className="text-xs text-muted-foreground">{match.matchedSupplierCode}</p>
                            )}
                          </div>
                        ) : (
                          <span className="text-sm text-muted-foreground">לא מותאם</span>
                        )}
                      </TableCell>
                      <TableCell className="py-1.5">{getMatchBadge(match)}</TableCell>
                      {!isReviewed && (
                        <TableCell className="py-1.5">
                          <div className="flex gap-0.5">
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 px-2 text-xs"
                              onClick={() => {
                                setEditingMatch(match);
                                setSelectedNewSupplier(match.matchedSupplierId || "");
                                setAddAsAlias(true);
                              }}
                            >
                              <Edit className="h-3.5 w-3.5 ms-1" />
                              עריכה
                            </Button>
                            {/* Remove an existing match — reverts the row to "לא מותאם" */}
                            {match.matchedSupplierId && (
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 px-2 text-xs text-red-600 hover:text-red-800"
                                onClick={() => setUnmatchingMatch(match)}
                                title="בטל את ההתאמה (יחזור ללא מותאם)"
                              >
                                <XCircle className="h-3.5 w-3.5 ms-1" />
                                בטל התאמה
                              </Button>
                            )}
                            {/* Show blacklist + small supplier buttons for unmatched items */}
                            {!match.matchedSupplierId && match.matchType !== "blacklisted" && match.matchType !== "small_supplier" && (
                              <>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-7 px-2 text-xs text-blue-600 hover:text-blue-900"
                                  onClick={() => {
                                    setSmallSupplierMatch(match);
                                    setSmallSupplierNotes("");
                                  }}
                                  title="סמן כספק קטן ללא עמלה"
                                >
                                  <Store className="h-3.5 w-3.5 ms-1" />
                                  ספק קטן
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-7 px-2 text-xs text-gray-600 hover:text-gray-900"
                                  onClick={() => {
                                    setBlacklistingMatch(match);
                                    setBlacklistNotes("");
                                  }}
                                  title="סמן כלא רלוונטי"
                                >
                                  <Ban className="h-3.5 w-3.5 ms-1" />
                                  לא מתאים
                                </Button>
                              </>
                            )}
                          </div>
                        </TableCell>
                      )}
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Approve Dialog */}
      <Dialog open={isApproveDialogOpen} onOpenChange={setIsApproveDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>אישור קובץ</DialogTitle>
            <DialogDescription>
              האם אתה בטוח שברצונך לאשר את הקובץ? פעולה זו תסמן את הקובץ כמאושר.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <label className="text-sm font-medium">הערות (אופציונלי)</label>
            <Textarea
              value={reviewNotes}
              onChange={(e) => setReviewNotes(e.target.value)}
              placeholder="הערות נוספות..."
              rows={3}
              className="mt-2"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsApproveDialogOpen(false)}>
              ביטול
            </Button>
            <Button
              className="bg-green-600 hover:bg-green-700"
              onClick={handleApprove}
              disabled={reviewMutation.isPending}
            >
              {reviewMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin ms-2" /> : <Check className="h-4 w-4 ms-2" />}
              אשר קובץ
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reject Dialog */}
      <Dialog open={isRejectDialogOpen} onOpenChange={setIsRejectDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>דחיית קובץ</DialogTitle>
            <DialogDescription>
              האם אתה בטוח שברצונך לדחות את הקובץ? יש לציין סיבה לדחייה.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <label className="text-sm font-medium">סיבת הדחייה (חובה)</label>
            <Textarea
              value={reviewNotes}
              onChange={(e) => setReviewNotes(e.target.value)}
              placeholder="סיבת הדחייה..."
              rows={3}
              className="mt-2"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsRejectDialogOpen(false)}>
              ביטול
            </Button>
            <Button
              variant="destructive"
              onClick={handleReject}
              disabled={reviewMutation.isPending || !reviewNotes.trim()}
            >
              {reviewMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin ms-2" /> : <X className="h-4 w-4 ms-2" />}
              דחה קובץ
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Match Dialog */}
      <Dialog open={!!editingMatch} onOpenChange={(open) => !open && setEditingMatch(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>עריכת התאמה</DialogTitle>
            <DialogDescription>
              בחר ספק חדש עבור &quot;{editingMatch?.bkmvName}&quot;.
              <br />
              ניתן להצמיד את אותו ספק לכמה שמות בקובץ — סמן &quot;הוסף ככינוי לספק&quot; כדי שהשם הזה יזוהה אוטומטית בעתיד.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4 space-y-4">
            <div>
              <label className="text-sm font-medium">בחר ספק</label>
              <Select value={selectedNewSupplier} onValueChange={setSelectedNewSupplier}>
                <SelectTrigger className="mt-2">
                  <SelectValue placeholder="בחר ספק..." />
                </SelectTrigger>
                <SelectContent className="max-h-[300px]">
                  {dropdownSuppliers.map(({ supplier: s, isAlreadyMatched }) => (
                    <SelectItem key={s.id} value={s.id}>
                      <span>{s.name} ({s.code})</span>
                      {isAlreadyMatched && (
                        <span className="text-xs text-muted-foreground ms-2">
                          (כבר מותאם לשורה אחרת)
                        </span>
                      )}
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
                הוסף &quot;{editingMatch?.bkmvName}&quot; ככינוי לספק
              </label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingMatch(null)}>
              ביטול
            </Button>
            <Button
              onClick={handleSaveMatch}
              disabled={matchMutation.isPending || !selectedNewSupplier}
            >
              {matchMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin ms-2" />
              ) : (
                <Plus className="h-4 w-4 ms-2" />
              )}
              שמור התאמה
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Unmatch Confirmation Dialog */}
      <AlertDialog open={!!unmatchingMatch} onOpenChange={(open) => !open && setUnmatchingMatch(null)}>
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>ביטול התאמה</AlertDialogTitle>
            <AlertDialogDescription>
              לבטל את ההתאמה של &quot;{unmatchingMatch?.bkmvName}&quot; לספק{" "}
              &quot;{unmatchingMatch?.matchedSupplierName}&quot;?
              <br />
              השורה תחזור למצב &quot;לא מותאם&quot;, וניתן יהיה לסמן אותה כ&quot;לא מתאים&quot; או להתאים לספק אחר.
              הכינוי שמור לספק לא יושפע.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>ביטול</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleUnmatch}
              disabled={unmatchMutation.isPending}
              className="bg-red-600 hover:bg-red-700"
            >
              {unmatchMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin ms-2" />
              ) : (
                <XCircle className="h-4 w-4 ms-2" />
              )}
              בטל התאמה
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Blacklist Dialog */}
      <Dialog open={!!blacklistingMatch} onOpenChange={(open) => !open && setBlacklistingMatch(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>הוספה לרשימה שחורה</DialogTitle>
            <DialogDescription>
              האם להוסיף את &quot;{blacklistingMatch?.bkmvName}&quot; לרשימה השחורה?
              שם זה יסומן כ&quot;לא רלוונטי&quot; ולא יופיע בהתאמות עתידיות.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <label className="text-sm font-medium">הערות (אופציונלי)</label>
            <Textarea
              value={blacklistNotes}
              onChange={(e) => setBlacklistNotes(e.target.value)}
              placeholder="למה השם הזה לא רלוונטי? (למשל: חשבון פנימי, לא ספק)"
              rows={3}
              className="mt-2"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBlacklistingMatch(null)}>
              ביטול
            </Button>
            <Button
              onClick={handleBlacklist}
              disabled={blacklistMutation.isPending}
              className="bg-gray-600 hover:bg-gray-700"
            >
              {blacklistMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin ms-2" />
              ) : (
                <Ban className="h-4 w-4 ms-2" />
              )}
              הוסף לרשימה שחורה
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Small Supplier Dialog */}
      <Dialog open={!!smallSupplierMatch} onOpenChange={(open) => !open && setSmallSupplierMatch(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>סימון כספק קטן ללא עמלה</DialogTitle>
            <DialogDescription>
              האם לסמן את &quot;{smallSupplierMatch?.bkmvName}&quot; כספק קטן?
              סכומי ספק זה ייכללו בדוח אחוז הקניות ממחזור, אך לא תחושב עמלה.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <label className="text-sm font-medium">הערות (אופציונלי)</label>
            <Textarea
              value={smallSupplierNotes}
              onChange={(e) => setSmallSupplierNotes(e.target.value)}
              placeholder="הערות נוספות על הספק..."
              rows={3}
              className="mt-2"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSmallSupplierMatch(null)}>
              ביטול
            </Button>
            <Button
              onClick={handleSmallSupplier}
              disabled={smallSupplierMutation.isPending}
              className="bg-blue-600 hover:bg-blue-700"
            >
              {smallSupplierMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin ms-2" />
              ) : (
                <Store className="h-4 w-4 ms-2" />
              )}
              סמן כספק קטן
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
