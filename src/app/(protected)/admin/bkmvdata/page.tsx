"use client";

import { useState, useCallback, useMemo } from "react";
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
} from "lucide-react";
import type { Supplier, Franchisee, SettlementPeriod } from "@/db/schema";
import { parseBkmvData, formatAmount, type BkmvParseResult, type BkmvTransaction } from "@/lib/bkmvdata-parser";
import {
  matchBkmvSuppliers,
  type BkmvSupplierMatchingResult,
} from "@/lib/supplier-matcher";

// Type for franchisee with brand
interface FranchiseeWithBrand extends Franchisee {
  brand: {
    id: string;
    code: string;
    nameHe: string;
    nameEn: string | null;
  } | null;
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

  // State
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [parseResult, setParseResult] = useState<BkmvParseResult | null>(null);
  const [matchingResults, setMatchingResults] = useState<BkmvSupplierMatchingResult[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filterStatus, setFilterStatus] = useState<"all" | "matched" | "unmatched" | "review">("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [matchedFranchisee, setMatchedFranchisee] = useState<FranchiseeWithBrand | null>(null);
  const [franchiseeError, setFranchiseeError] = useState<string | null>(null);
  const [dateRange, setDateRange] = useState<{ minDate: Date | null; maxDate: Date | null }>({ minDate: null, maxDate: null });

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
  const { data: suppliersData } = useQuery({
    queryKey: ["suppliers", "list", { filter: "all" }],
    queryFn: async () => {
      const response = await fetch("/api/suppliers?filter=all");
      if (!response.ok) throw new Error("Failed to fetch suppliers");
      return response.json();
    },
    enabled: !isPending && !!session,
  });

  const suppliers: Supplier[] = suppliersData?.suppliers || [];

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
    }
  }, []);

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

  return (
    <div className="container mx-auto p-6">
      <div className="mb-8">
        <h1 className="text-3xl font-bold">עיבוד קובץ מבנה אחיד</h1>
        <p className="text-muted-foreground mt-2">
          העלה קובץ BKMVDATA כדי לזהות ספקים ולהשוות מול דוחות ספקים
        </p>
      </div>

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
          <div className="flex items-center gap-4">
            <div className="flex-1">
              <Label htmlFor="bkmvFile" className="sr-only">קובץ BKMVDATA</Label>
              <Input
                id="bkmvFile"
                type="file"
                accept=".txt"
                onChange={handleFileSelect}
                className="cursor-pointer"
              />
            </div>
            <Button
              onClick={handleProcessFile}
              disabled={!selectedFile || isProcessing}
            >
              {isProcessing ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin ms-2" />
                  מעבד...
                </>
              ) : (
                <>
                  <FileSpreadsheet className="h-4 w-4 ms-2" />
                  עבד קובץ
                </>
              )}
            </Button>
          </div>

          {selectedFile && (
            <p className="text-sm text-muted-foreground">
              קובץ נבחר: {selectedFile.name} ({(selectedFile.size / 1024).toFixed(1)} KB)
            </p>
          )}

          {error && (
            <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-3">
              <p className="text-sm text-destructive">{error}</p>
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
                      <TableHead className="text-right">עסקאות</TableHead>
                      <TableHead className="text-right">התאמה לספק</TableHead>
                      <TableHead className="text-right">ביטחון</TableHead>
                      <TableHead className="text-right">פעולות</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredResults.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                          {matchingResults.length === 0 ? "לא נמצאו ספקים בקובץ" : "לא נמצאו תוצאות מתאימות לסינון"}
                        </TableCell>
                      </TableRow>
                    ) : (
                      filteredResults.map((result, index) => (
                        <TableRow key={index}>
                          <TableCell className="font-medium">{result.bkmvName}</TableCell>
                          <TableCell className="font-mono">{formatAmount(result.amount)}</TableCell>
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
                                הוסף כשם חלופי
                              </Button>
                            )}
                            {result.matchResult.matchType.startsWith("exact") && (
                              <Badge variant="success" className="gap-1">
                                <CheckCircle2 className="h-3 w-3" />
                                התאמה מדויקת
                              </Badge>
                            )}
                            {!result.matchResult.matchedSupplier && result.matchResult.alternatives.length > 0 && (
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
                            )}
                            {!result.matchResult.matchedSupplier && result.matchResult.alternatives.length === 0 && (
                              <Select
                                onValueChange={(value) => handleAddAlias(value, result.bkmvName)}
                              >
                                <SelectTrigger className="w-[180px]">
                                  <SelectValue placeholder="בחר ספק מהרשימה" />
                                </SelectTrigger>
                                <SelectContent>
                                  {suppliers.map((s) => (
                                    <SelectItem key={s.id} value={s.id}>
                                      {s.name}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
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
    </div>
  );
}
