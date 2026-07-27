"use client";

import { fetchWithTimeout } from "@/lib/fetch-with-timeout";
import { useState, useCallback, useMemo, useEffect } from "react";
import { useRouter, useParams, useSearchParams } from "next/navigation";
import { resolveBackHref } from "@/lib/back-link";
import { toast } from "sonner";
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
import { Checkbox } from "@/components/ui/checkbox";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Loader2,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  FileText,
  Calendar,
  Building2,
  ArrowRight,
  Check,
  X,
  Edit,
  Plus,
  Ban,
  Download,
} from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";

interface FranchiseeMatch {
  originalName: string;
  rowNumber: number;
  grossAmount: number;
  netAmount: number;
  matchedFranchiseeId: string | null;
  matchedFranchiseeName: string | null;
  matchedFranchiseeCode: string | null;
  confidence: number;
  matchType: string;
  requiresReview: boolean;
}

interface FileDetails {
  file: {
    id: string;
    fileName: string;
    fileSize: number;
    fileUrl: string | null;
    uploadedAt: string;
    processingStatus: string;
    reviewedBy: string | null;
    reviewedByName: string | null;
    reviewedByEmail: string | null;
    reviewedAt: string | null;
    reviewNotes: string | null;
    createdBy: string | null;
    createdByName: string | null;
    createdByEmail: string | null;
    periodStartDate: string | null;
    periodEndDate: string | null;
  };
  supplier: {
    id: string;
    name: string | null;
    code: string | null;
  } | null;
  processingResult: {
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
    processedAt: string;
  } | null;
  franchiseeMatches: FranchiseeMatch[];
}

interface Franchisee {
  id: string;
  name: string;
  code: string;
}

export default function SupplierFileDetailPage() {
  const router = useRouter();
  const params = useParams();
  const searchParams = useSearchParams();
  const fileId = params.fileId as string;
  // Where "חזרה" goes: the list page we were opened from, else the review queue.
  const backHref = resolveBackHref(searchParams, "/admin/supplier-files/review");
  const queryClient = useQueryClient();

  useEffect(() => {
    if (searchParams.get("reprocessed") === "1") {
      toast.success(
        "הקובץ עובד מחדש. בדוק/י את האנומליות לפני יצירת השוואה חדשה."
      );
      const url = new URL(window.location.href);
      url.searchParams.delete("reprocessed");
      router.replace(url.pathname + url.search, { scroll: false });
    }
    // Run once on mount; the URL param is consumed and removed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [reviewNotes, setReviewNotes] = useState("");
  const [isApproveDialogOpen, setIsApproveDialogOpen] = useState(false);
  const [isRejectDialogOpen, setIsRejectDialogOpen] = useState(false);
  const [editingMatch, setEditingMatch] = useState<FranchiseeMatch | null>(null);
  const [selectedFranchisee, setSelectedFranchisee] = useState<string>("");
  const [franchiseeSearch, setFranchiseeSearch] = useState("");
  const [addAsAlias, setAddAsAlias] = useState(true);
  const [blacklistingMatch, setBlacklistingMatch] = useState<FranchiseeMatch | null>(null);
  const [blacklistNotes, setBlacklistNotes] = useState("");

  const { data: session, isPending } = authClient.useSession();
  const userRole = session ? (session.user as { role?: string })?.role : undefined;



  // Fetch file details
  const { data: fileData, isLoading, error } = useQuery<FileDetails>({
    queryKey: ["supplier-files", "review", fileId],
    queryFn: async () => {
      const response = await fetchWithTimeout(`/api/supplier-files/review/${fileId}`);
      if (!response.ok) throw new Error("Failed to fetch file details");
      return response.json();
    },
    enabled: !isPending && !!session && !!fileId,
  });

  // Fetch franchisees for manual matching
  const { data: franchiseesData } = useQuery({
    queryKey: ["franchisees", "list"],
    queryFn: async () => {
      const response = await fetchWithTimeout("/api/franchisees?filter=active");
      if (!response.ok) throw new Error("Failed to fetch franchisees");
      return response.json();
    },
    enabled: !isPending && !!session,
  });

  const franchisees: Franchisee[] = franchiseesData?.franchisees || [];
  const sortedFranchisees = useMemo(() => {
    return [...franchisees].sort((a, b) => a.name.localeCompare(b.name, "he"));
  }, [franchisees]);

  // Review action mutation
  const reviewMutation = useMutation({
    mutationFn: async ({ action, notes }: { action: "approve" | "reject"; notes: string }) => {
      const response = await fetchWithTimeout("/api/supplier-files/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileId, action, notes }),
      });
      if (!response.ok) throw new Error("Failed to process review");
      return response.json() as Promise<{
        success: boolean;
        message: string;
        learnedAliasCount?: number;
      }>;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["supplier-files", "review"] });
      if (data?.learnedAliasCount && data.learnedAliasCount > 0) {
        toast.success(
          `${data.learnedAliasCount} כינויים נשמרו לזיהוי אוטומטי בקבצים הבאים`
        );
      }
      router.push(backHref);
    },
  });

  // Manual match mutation
  const matchMutation = useMutation({
    mutationFn: async ({
      originalName,
      franchiseeId,
      addAlias,
    }: {
      originalName: string;
      franchiseeId: string;
      addAlias: boolean;
    }) => {
      const response = await fetchWithTimeout(`/api/supplier-files/review/${fileId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ originalName, franchiseeId, addAsAlias: addAlias }),
      });
      if (!response.ok) throw new Error("Failed to update match");
      return response.json() as Promise<{
        success: boolean;
        message: string;
        sweepNewlyMatched?: number;
      }>;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["supplier-files", "review", fileId] });
      setEditingMatch(null);
      setSelectedFranchisee("");
      setFranchiseeSearch("");
      // Surface the auto-sweep result so the admin understands why other rows
      // suddenly look matched without them clicking each one.
      if (data?.sweepNewlyMatched && data.sweepNewlyMatched > 0) {
        toast.success(
          `${data.sweepNewlyMatched} שורות נוספות תואמו אוטומטית בעקבות הוספת הכינוי`
        );
      }
    },
  });

  // Blacklist mutation
  const blacklistMutation = useMutation({
    mutationFn: async ({ name, notes }: { name: string; notes?: string }) => {
      const response = await fetchWithTimeout(`/api/supplier-files/review/${fileId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ originalName: name, blacklist: true, notes }),
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to add to blacklist");
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["supplier-files", "review", fileId] });
      queryClient.invalidateQueries({ queryKey: ["supplier-files", "blacklist"] });
      setBlacklistingMatch(null);
      setBlacklistNotes("");
    },
  });

  const handleApprove = useCallback(() => {
    reviewMutation.mutate({ action: "approve", notes: reviewNotes });
  }, [reviewMutation, reviewNotes]);

  const handleReject = useCallback(() => {
    reviewMutation.mutate({ action: "reject", notes: reviewNotes });
  }, [reviewMutation, reviewNotes]);

  const handleSaveMatch = useCallback(() => {
    if (!editingMatch || !selectedFranchisee) return;
    matchMutation.mutate({
      originalName: editingMatch.originalName,
      franchiseeId: selectedFranchisee,
      addAlias: addAsAlias,
    });
  }, [editingMatch, selectedFranchisee, addAsAlias, matchMutation]);

  const handleBlacklist = useCallback(() => {
    if (!blacklistingMatch) return;
    blacklistMutation.mutate({
      name: blacklistingMatch.originalName,
      notes: blacklistNotes || undefined,
    });
  }, [blacklistingMatch, blacklistNotes, blacklistMutation]);

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

  const formatFileSize = (bytes: number | null) => {
    if (!bytes) return "לא ידוע";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const getMatchBadge = (match: FranchiseeMatch) => {
    if (match.matchType === "blacklisted") {
      return (
        <Badge variant="secondary" className="gap-1 bg-gray-200">
          <Ban className="h-3 w-3" />
          לא רלוונטי
        </Badge>
      );
    }
    if (!match.matchedFranchiseeId) {
      return <Badge variant="destructive">לא מותאם</Badge>;
    }
    if (match.matchType === "manual") {
      return (
        <Badge variant="success" className="gap-1">
          <Check className="h-3 w-3" />
          ידני
        </Badge>
      );
    }
    if (match.matchType === "exact" || match.confidence === 1) {
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
          <Link href={backHref}>
            <Button variant="outline" className="mt-4">
              <ArrowRight className="h-4 w-4 ms-2" />
              חזרה
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  const { file, supplier, processingResult, franchiseeMatches } = fileData;
  const isReviewed = file.processingStatus === "approved" || file.processingStatus === "rejected";

  return (
    <div className="container mx-auto p-6">
      {/* Header */}
      <div className="mb-6 flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <Link href={backHref}>
              <Button variant="ghost" size="sm">
                <ArrowRight className="h-4 w-4 ms-1" />
                חזרה
              </Button>
            </Link>
            <h1 className="text-2xl font-bold">פרטי קובץ ספק לסקירה</h1>
          </div>
          <p className="text-muted-foreground">{file.fileName}</p>
        </div>
        <div className="flex items-center gap-2">
          {file.fileUrl && (
            <Button
              variant="outline"
              onClick={() =>
                window.open(
                  `/api/reports/supplier-files/${file.id}/download`,
                  "_blank"
                )
              }
              title="הורד את קובץ המקור"
            >
              <Download className="h-4 w-4 ms-2" />
              הורד קובץ
            </Button>
          )}
          {!isReviewed && (
            <>
              <Button
                variant="default"
                className="bg-green-600 hover:bg-green-700"
                onClick={() => setIsApproveDialogOpen(true)}
              >
                <Check className="h-4 w-4 ms-2" />
                אשר קובץ
              </Button>
              <Button
                variant="destructive"
                onClick={() => setIsRejectDialogOpen(true)}
              >
                <X className="h-4 w-4 ms-2" />
                דחה קובץ
              </Button>
            </>
          )}
          {isReviewed && (
            <Badge
              variant={file.processingStatus === "approved" ? "success" : "destructive"}
              className="text-base px-4 py-2"
            >
              {file.processingStatus === "approved" ? "אושר" : "נדחה"}
            </Badge>
          )}
        </div>
      </div>

      {/* File Info & Stats */}
      <div className="grid gap-6 md:grid-cols-2 mb-6">
        {/* File Info Card */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              פרטי קובץ
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-muted-foreground">שם קובץ</p>
                <p className="font-medium">{file.fileName}</p>
              </div>
              <div>
                <p className="text-muted-foreground">גודל</p>
                <p className="font-medium">{formatFileSize(file.fileSize)}</p>
              </div>
              <div>
                <p className="text-muted-foreground">תאריך העלאה</p>
                <p className="font-medium">{formatDate(file.uploadedAt)}</p>
              </div>
              <div>
                <p className="text-muted-foreground">הועלה ע״י</p>
                <p className="font-medium">{file.createdByName || file.createdByEmail || "לא צוין"}</p>
              </div>
              {file.periodStartDate && file.periodEndDate && (
                <div className="col-span-2">
                  <p className="text-muted-foreground">תקופה</p>
                  <p className="font-medium">
                    {new Date(file.periodStartDate).toLocaleDateString("he-IL")}
                    {" - "}
                    {new Date(file.periodEndDate).toLocaleDateString("he-IL")}
                  </p>
                </div>
              )}
            </div>
            {supplier && (
              <div className="mt-4 p-3 bg-muted rounded-lg">
                <div className="flex items-center gap-2">
                  <Building2 className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <p className="font-medium">{supplier.name}</p>
                    <p className="text-sm text-muted-foreground">קוד: {supplier.code}</p>
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Stats Card */}
        <Card>
          <CardHeader>
            <CardTitle>סטטיסטיקות התאמה</CardTitle>
          </CardHeader>
          <CardContent>
            {processingResult?.matchStats ? (
              <div className="grid grid-cols-2 gap-4">
                <div className="text-center p-4 bg-muted rounded-lg">
                  <p className="text-3xl font-bold">{processingResult.matchStats.total}</p>
                  <p className="text-sm text-muted-foreground">סה״כ זכיינים</p>
                </div>
                <div className="text-center p-4 bg-green-50 rounded-lg">
                  <p className="text-3xl font-bold text-green-600">
                    {processingResult.matchStats.exactMatches}
                  </p>
                  <p className="text-sm text-muted-foreground">התאמות מלאות</p>
                </div>
                <div className="text-center p-4 bg-amber-50 rounded-lg">
                  <p className="text-3xl font-bold text-amber-600">
                    {processingResult.matchStats.fuzzyMatches}
                  </p>
                  <p className="text-sm text-muted-foreground">התאמות חלקיות</p>
                </div>
                <div className="text-center p-4 bg-red-50 rounded-lg">
                  <p className="text-3xl font-bold text-red-600">
                    {processingResult.matchStats.unmatched}
                  </p>
                  <p className="text-sm text-muted-foreground">לא מותאמים</p>
                </div>
              </div>
            ) : (
              <p className="text-muted-foreground">אין נתוני עיבוד</p>
            )}
            {processingResult && (
              <div className="mt-4 pt-4 border-t grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-muted-foreground">סה״כ כולל מע״מ</p>
                  <p className="font-medium">{formatAmount(processingResult.totalGrossAmount)}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">סה״כ לפני מע״מ</p>
                  <p className="font-medium">{formatAmount(processingResult.totalNetAmount)}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">שורות שעובדו</p>
                  <p className="font-medium">{processingResult.processedRows} / {processingResult.totalRows}</p>
                </div>
                {processingResult.vatAdjusted && (
                  <div>
                    <Badge variant="secondary">מע״מ הותאם</Badge>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Review Info (if reviewed) */}
      {isReviewed && file.reviewedAt && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>פרטי סקירה</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-muted-foreground">תאריך סקירה</p>
                <p className="font-medium">{formatDate(file.reviewedAt)}</p>
              </div>
              <div>
                <p className="text-muted-foreground">נסקר ע״י</p>
                <p className="font-medium">{file.reviewedByName || file.reviewedByEmail || "לא ידוע"}</p>
              </div>
              <div>
                <p className="text-muted-foreground">סטטוס</p>
                <Badge variant={file.processingStatus === "approved" ? "success" : "destructive"}>
                  {file.processingStatus === "approved" ? "אושר" : "נדחה"}
                </Badge>
              </div>
              {file.reviewNotes && (
                <div className="col-span-2">
                  <p className="text-muted-foreground">הערות</p>
                  <p className="font-medium">{file.reviewNotes}</p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Matches Table */}
      <Card>
        <CardHeader>
          <CardTitle>טבלת התאמות זכיינים</CardTitle>
          <CardDescription>
            {!isReviewed && "לחץ על עריכה כדי לשנות התאמה או להוסיף כינוי לזכיין"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-end">#</TableHead>
                  <TableHead className="text-end">שם בקובץ ספק</TableHead>
                  <TableHead className="text-end">כולל מע״מ</TableHead>
                  <TableHead className="text-end">לפני מע״מ</TableHead>
                  <TableHead className="text-end">זכיין מותאם</TableHead>
                  <TableHead className="text-end">סטטוס</TableHead>
                  {!isReviewed && <TableHead className="text-end">פעולות</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {franchiseeMatches.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={isReviewed ? 6 : 7}
                      className="text-center py-8 text-muted-foreground"
                    >
                      אין נתוני התאמות
                    </TableCell>
                  </TableRow>
                ) : (
                  franchiseeMatches.map((match, index) => (
                    <TableRow
                      key={index}
                      className={
                        match.matchType === "blacklisted"
                          ? "bg-gray-50/50"
                          : !match.matchedFranchiseeId
                          ? "bg-red-50/50"
                          : match.confidence < 1 && match.matchType !== "manual" && match.matchType !== "exact"
                          ? "bg-amber-50/50"
                          : ""
                      }
                    >
                      <TableCell className="font-mono text-muted-foreground">
                        {match.rowNumber}
                      </TableCell>
                      <TableCell className="font-medium">{match.originalName}</TableCell>
                      <TableCell className="font-mono">{formatAmount(match.grossAmount)}</TableCell>
                      <TableCell className="font-mono">{formatAmount(match.netAmount)}</TableCell>
                      <TableCell>
                        {match.matchedFranchiseeId ? (
                          <div>
                            <p className="font-medium">{match.matchedFranchiseeName}</p>
                            {match.matchedFranchiseeCode && (
                              <p className="text-xs text-muted-foreground">
                                {match.matchedFranchiseeCode}
                              </p>
                            )}
                          </div>
                        ) : (
                          <span className="text-muted-foreground">לא מותאם</span>
                        )}
                      </TableCell>
                      <TableCell>{getMatchBadge(match)}</TableCell>
                      {!isReviewed && (
                        <TableCell>
                          <div className="flex gap-1">
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => {
                                setEditingMatch(match);
                                setSelectedFranchisee(match.matchedFranchiseeId || "");
                                setFranchiseeSearch("");
                                setAddAsAlias(true);
                              }}
                            >
                              <Edit className="h-4 w-4 ms-1" />
                              עריכה
                            </Button>
                            {!match.matchedFranchiseeId && match.matchType !== "blacklisted" && (
                              <Button
                                size="sm"
                                variant="ghost"
                                className="text-gray-600 hover:text-gray-900"
                                onClick={() => {
                                  setBlacklistingMatch(match);
                                  setBlacklistNotes("");
                                }}
                                title="סמן כלא רלוונטי"
                              >
                                <Ban className="h-4 w-4 ms-1" />
                                לא רלוונטי
                              </Button>
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
              {reviewMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin ms-2" />
              ) : (
                <Check className="h-4 w-4 ms-2" />
              )}
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
              {reviewMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin ms-2" />
              ) : (
                <X className="h-4 w-4 ms-2" />
              )}
              דחה קובץ
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Match Dialog */}
      <Dialog open={!!editingMatch} onOpenChange={(open) => !open && setEditingMatch(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>עריכת התאמה</DialogTitle>
            <DialogDescription>
              בחר זכיין עבור &quot;{editingMatch?.originalName}&quot;
            </DialogDescription>
          </DialogHeader>
          <div className="py-4 space-y-4">
            {/* Combined search + list — types and pick in one box */}
            <Command
              dir="rtl"
              className="border rounded-md"
              filter={(value, search) => {
                const v = value.toLowerCase();
                const s = search.toLowerCase();
                return v.includes(s) ? 1 : 0;
              }}
            >
              <CommandInput
                placeholder="חיפוש זכיין..."
                value={franchiseeSearch}
                onValueChange={setFranchiseeSearch}
              />
              <CommandList className="max-h-60">
                <CommandEmpty>לא נמצאו זכיינים</CommandEmpty>
                <CommandGroup>
                  {sortedFranchisees.map((f) => (
                    <CommandItem
                      key={f.id}
                      value={`${f.name} ${f.code}`}
                      onSelect={() => setSelectedFranchisee(f.id)}
                      className={cn(
                        "flex flex-col items-start gap-0.5 cursor-pointer",
                        selectedFranchisee === f.id && "bg-primary/10 data-[selected=true]:bg-primary/15"
                      )}
                    >
                      <span className="font-medium flex items-center gap-2">
                        {selectedFranchisee === f.id && (
                          <Check className="h-3.5 w-3.5 text-primary" />
                        )}
                        {f.name}
                      </span>
                      <span className="text-xs text-muted-foreground">{f.code}</span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>

            {/* Add as alias checkbox */}
            <div className="flex items-center gap-2">
              <Checkbox
                id="addAsAlias"
                checked={addAsAlias}
                onCheckedChange={(checked) => setAddAsAlias(checked === true)}
              />
              <label htmlFor="addAsAlias" className="text-sm">
                הוסף &quot;{editingMatch?.originalName}&quot; ככינוי לזכיין
              </label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingMatch(null)}>
              ביטול
            </Button>
            <Button
              onClick={handleSaveMatch}
              disabled={matchMutation.isPending || !selectedFranchisee}
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

      {/* Blacklist Dialog */}
      <Dialog open={!!blacklistingMatch} onOpenChange={(open) => !open && setBlacklistingMatch(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>הוספה לרשימה שחורה</DialogTitle>
            <DialogDescription>
              האם להוסיף את &quot;{blacklistingMatch?.originalName}&quot; לרשימה השחורה?
              שם זה יסומן כ&quot;לא רלוונטי&quot; ולא יופיע בהתאמות עתידיות.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <label className="text-sm font-medium">הערות (אופציונלי)</label>
            <Textarea
              value={blacklistNotes}
              onChange={(e) => setBlacklistNotes(e.target.value)}
              placeholder="למה השם הזה לא רלוונטי? (למשל: סיכום, לא זכיין)"
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
    </div>
  );
}
