"use client";

import { fetchWithTimeout } from "@/lib/fetch-with-timeout";
import { useState, useCallback } from "react";
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
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
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
  Loader2,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  FileText,
  Calendar,
  Building2,
  ArrowRight,
  RefreshCw,
  Eye,
  Check,
  X,
  Clock,
} from "lucide-react";
import Link from "next/link";
import { SupplierUploadsList } from "@/components/supplier-files/supplier-uploads-list";

interface ReviewFile {
  id: string;
  fileName: string;
  fileSize: number;
  uploadedAt: string;
  processingStatus: string;
  supplier: {
    id: string;
    name: string;
    code: string;
  } | null;
  processingResult: {
    totalRows: number;
    processedRows: number;
    matchStats: {
      total: number;
      exactMatches: number;
      fuzzyMatches: number;
      unmatched: number;
    };
    processedAt: string;
    error?: string;
  } | null;
  periodStartDate: string | null;
  periodEndDate: string | null;
}

interface ReviewStats {
  pending: number;
  approvedToday: number;
  rejectedToday: number;
}

/** One review POST. Throws a user-readable Hebrew message on failure. */
async function postReview(fileId: string, action: "approve" | "reject", notes: string) {
  const response = await fetchWithTimeout("/api/supplier-files/review", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fileId, action, notes }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    // 4xx carry a Hebrew reason (already approved, wrong state); 5xx don't.
    throw new Error(response.status < 500 && body?.error ? body.error : "שגיאה בעדכון הקובץ");
  }
  return response.json();
}

export default function SupplierFilesReviewPage() {
  // The upload-history panel's "צפייה בכל ההעלאות" links here with
  // ?supplierId= — that means all of the supplier's uploads, not the queue.
  const supplierId = useSearchParams().get("supplierId");
  return supplierId ? <SupplierUploadsList supplierId={supplierId} /> : <ReviewQueue />;
}

function ReviewQueue() {
  const router = useRouter();
  const queryClient = useQueryClient();

  // Approve is one click; only reject opens a dialog (the reason is required).
  const [rejectingFile, setRejectingFile] = useState<ReviewFile | null>(null);
  const [reviewNotes, setReviewNotes] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkProgress, setBulkProgress] = useState<{ done: number; total: number } | null>(null);

  const { data: session, isPending } = authClient.useSession();
  const userRole = session ? (session.user as { role?: string })?.role : undefined;



  // Fetch files needing review
  const { data: reviewData, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: ["supplier-files", "review"],
    queryFn: async () => {
      const response = await fetchWithTimeout("/api/supplier-files/review");
      if (!response.ok) throw new Error("Failed to fetch review queue");
      return response.json();
    },
    enabled: !isPending && !!session,
  });

  const files: ReviewFile[] = reviewData?.files || [];
  const stats: ReviewStats = reviewData?.stats || { pending: 0, approvedToday: 0, rejectedToday: 0 };
  // A file with a processing error can't be approved (server refuses too).
  const approvableIds = files.filter((f) => !f.processingResult?.error).map((f) => f.id);
  const selectedApprovable = approvableIds.filter((id) => selectedIds.has(id));
  const allSelected = approvableIds.length > 0 && selectedApprovable.length === approvableIds.length;

  const invalidateQueue = () => {
    queryClient.invalidateQueries({ queryKey: ["supplier-files", "review"] });
    queryClient.invalidateQueries({ queryKey: ["supplier-files", "review", "count"] });
  };

  // Review action mutation
  const reviewMutation = useMutation({
    mutationFn: ({ fileId, action, notes }: { fileId: string; action: "approve" | "reject"; notes: string }) =>
      postReview(fileId, action, notes),
    onSuccess: (_data, { fileId, action }) => {
      invalidateQueue();
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.delete(fileId);
        return next;
      });
      setRejectingFile(null);
      setReviewNotes("");
      toast.success(action === "approve" ? "הקובץ אושר" : "הקובץ נדחה");
    },
    onError: (err) => {
      console.error("Supplier file review failed:", err);
      toast.error(err.message);
    },
  });

  const handleConfirmReject = useCallback(() => {
    if (!rejectingFile) return;
    reviewMutation.mutate({ fileId: rejectingFile.id, action: "reject", notes: reviewNotes });
  }, [rejectingFile, reviewNotes, reviewMutation]);

  const toggleSelected = (fileId: string) =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(fileId)) next.delete(fileId);
      else next.add(fileId);
      return next;
    });

  // ponytail: sequential on purpose — each approve re-syncs commissions for its
  // (supplier, period); parallel runs of sibling files could race on that sync.
  const handleBulkApprove = async () => {
    const ids = selectedApprovable;
    if (ids.length === 0) return;
    const failures: string[] = [];
    setBulkProgress({ done: 0, total: ids.length });
    for (const [i, id] of ids.entries()) {
      try {
        await postReview(id, "approve", "");
      } catch (err) {
        const name = files.find((f) => f.id === id)?.fileName ?? id;
        console.error("Bulk approve failed for", id, err);
        failures.push(`${name}: ${err instanceof Error ? err.message : "שגיאה"}`);
      }
      setBulkProgress({ done: i + 1, total: ids.length });
    }
    setBulkProgress(null);
    setSelectedIds(new Set());
    invalidateQueue();
    const approved = ids.length - failures.length;
    if (approved > 0) toast.success(`${approved} קבצים אושרו`);
    if (failures.length > 0) {
      toast.error(`${failures.length} קבצים לא אושרו`, {
        description: (
          <ul className="list-disc ps-4">
            {failures.map((f) => <li key={f}>{f}</li>)}
          </ul>
        ),
        duration: 15000,
      });
    }
  };

  const formatDate = (dateStr: string) => {
    return new Intl.DateTimeFormat("he-IL", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(dateStr));
  };

  const formatFileSize = (bytes: number) => {
    if (!bytes) return "לא ידוע";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const formatPeriod = (startDate: string | null, endDate: string | null) => {
    if (!startDate || !endDate) return "לא זמין";
    return `${new Date(startDate).toLocaleDateString("he-IL")} - ${new Date(endDate).toLocaleDateString("he-IL")}`;
  };

  if (isPending) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">תור אישורים לקבצי ספקים</h1>
          <p className="text-muted-foreground mt-2">
            קבצי ספקים שממתינים לבדיקה ואישור ידני
          </p>
        </div>
        <div className="flex items-center gap-4">
          <Link href="/admin/supplier-files">
            <Button variant="outline">
              <ArrowRight className="h-4 w-4 ms-2" />
              חזרה לעיבוד קבצים
            </Button>
          </Link>
          <Button variant="outline" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={`h-4 w-4 ms-2 ${isFetching ? "animate-spin" : ""}`} />
            רענן
          </Button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid gap-4 md:grid-cols-3 mb-6">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Clock className="h-4 w-4 text-amber-500" />
              ממתינים לבדיקה
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-amber-600">{stats.pending}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-green-500" />
              אושרו היום
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-green-600">{stats.approvedToday}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <XCircle className="h-4 w-4 text-red-500" />
              נדחו היום
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-red-600">{stats.rejectedToday}</div>
          </CardContent>
        </Card>
      </div>

      {/* Files Table */}
      <Card>
        <CardHeader>
          <CardTitle>קבצים לבדיקה</CardTitle>
          <CardDescription>
            לחץ על &quot;פרטים&quot; לצפייה בפרטי ההתאמות, או אשר/דחה קובץ ישירות.
            לאישור כמה קבצים יחד — סמני אותם ולחצי &quot;אשר נבחרים&quot;.
          </CardDescription>
          {selectedApprovable.length > 0 && (
            <div className="flex items-center gap-3 pt-2">
              <Button
                className="bg-green-600 hover:bg-green-700"
                onClick={handleBulkApprove}
                disabled={!!bulkProgress}
              >
                {bulkProgress ? (
                  <Loader2 className="h-4 w-4 animate-spin ms-2" />
                ) : (
                  <Check className="h-4 w-4 ms-2" />
                )}
                {bulkProgress
                  ? `מאשר ${bulkProgress.done}/${bulkProgress.total}...`
                  : `אשר נבחרים (${selectedApprovable.length})`}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setSelectedIds(new Set())} disabled={!!bulkProgress}>
                נקה בחירה
              </Button>
            </div>
          )}
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : error ? (
            <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-center">
              <p className="text-destructive">שגיאה בטעינת הקבצים</p>
            </div>
          ) : files.length === 0 ? (
            <div className="py-12 text-center">
              <CheckCircle2 className="h-12 w-12 text-green-500 mx-auto mb-4" />
              <p className="text-lg font-medium">אין קבצים ממתינים לבדיקה</p>
              <p className="text-muted-foreground mt-2">
                כל הקבצים עברו אישור אוטומטי או כבר נבדקו
              </p>
            </div>
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">
                      <Checkbox
                        checked={allSelected}
                        onCheckedChange={(v) => setSelectedIds(v === true ? new Set(approvableIds) : new Set())}
                        disabled={approvableIds.length === 0 || !!bulkProgress}
                        aria-label="בחר את כל הקבצים לאישור"
                      />
                    </TableHead>
                    <TableHead className="text-end">שם קובץ</TableHead>
                    <TableHead className="text-end">ספק</TableHead>
                    <TableHead className="text-end">תאריך העלאה</TableHead>
                    <TableHead className="text-end">התאמות זכיינים</TableHead>
                    <TableHead className="text-end">תקופה</TableHead>
                    <TableHead className="text-end">פעולות</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {files.map((file) => (
                    <TableRow key={file.id} data-state={selectedIds.has(file.id) ? "selected" : undefined}>
                      <TableCell>
                        <Checkbox
                          checked={selectedIds.has(file.id)}
                          onCheckedChange={() => toggleSelected(file.id)}
                          disabled={!!file.processingResult?.error || !!bulkProgress}
                          aria-label={`בחר ${file.fileName}`}
                        />
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <FileText className="h-4 w-4 text-muted-foreground" />
                          <div>
                            <p className="font-medium">{file.fileName}</p>
                            <p className="text-xs text-muted-foreground">
                              {formatFileSize(file.fileSize)}
                            </p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        {file.supplier ? (
                          <div className="flex items-center gap-2">
                            <Building2 className="h-4 w-4 text-muted-foreground" />
                            <div>
                              <p className="font-medium">{file.supplier.name}</p>
                              <p className="text-xs text-muted-foreground">
                                {file.supplier.code}
                              </p>
                            </div>
                          </div>
                        ) : (
                          <span className="text-muted-foreground">לא זוהה</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Calendar className="h-4 w-4 text-muted-foreground" />
                          <p>{formatDate(file.uploadedAt)}</p>
                        </div>
                      </TableCell>
                      <TableCell>
                        {file.processingResult?.error ? (
                          <div className="flex flex-col gap-1 max-w-[280px]">
                            <Badge variant="destructive" className="gap-1 self-start" title={file.processingResult.error}>
                              <XCircle className="h-3 w-3" />
                              שגיאת עיבוד
                            </Badge>
                            <p className="text-xs text-muted-foreground line-clamp-2" title={file.processingResult.error}>
                              {file.processingResult.error}
                            </p>
                          </div>
                        ) : file.processingResult?.matchStats ? (
                          <div className="flex flex-col gap-1">
                            <div className="flex items-center gap-2">
                              <Badge variant="success" className="gap-1">
                                <CheckCircle2 className="h-3 w-3" />
                                {file.processingResult.matchStats.exactMatches}
                              </Badge>
                              {file.processingResult.matchStats.fuzzyMatches > 0 && (
                                <Badge variant="warning" className="gap-1">
                                  <AlertTriangle className="h-3 w-3" />
                                  {file.processingResult.matchStats.fuzzyMatches}
                                </Badge>
                              )}
                              {file.processingResult.matchStats.unmatched > 0 && (
                                <Badge variant="destructive" className="gap-1">
                                  <XCircle className="h-3 w-3" />
                                  {file.processingResult.matchStats.unmatched}
                                </Badge>
                              )}
                            </div>
                            <p className="text-xs text-muted-foreground">
                              מתוך {file.processingResult.matchStats.total} זכיינים
                            </p>
                          </div>
                        ) : (
                          <span className="text-muted-foreground">לא זמין</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <p className="text-sm">
                          {formatPeriod(file.periodStartDate, file.periodEndDate)}
                        </p>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2 justify-end">
                          <Link href={`/admin/supplier-files/review/${file.id}`}>
                            <Button size="sm" variant="outline">
                              <Eye className="h-4 w-4 ms-1" />
                              פרטים
                            </Button>
                          </Link>
                          <Button
                            size="sm"
                            variant="default"
                            className="bg-green-600 hover:bg-green-700"
                            onClick={() => reviewMutation.mutate({ fileId: file.id, action: "approve", notes: "" })}
                            disabled={!!file.processingResult?.error || reviewMutation.isPending || !!bulkProgress}
                            title={file.processingResult?.error ? "לא ניתן לאשר קובץ עם שגיאת עיבוד — יש לדחות ולהעלות מחדש" : undefined}
                          >
                            {reviewMutation.isPending && reviewMutation.variables?.fileId === file.id ? (
                              <Loader2 className="h-4 w-4 animate-spin ms-1" />
                            ) : (
                              <Check className="h-4 w-4 ms-1" />
                            )}
                            אשר
                          </Button>
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={() => {
                              setReviewNotes("");
                              setRejectingFile(file);
                            }}
                            disabled={reviewMutation.isPending || !!bulkProgress}
                          >
                            <X className="h-4 w-4 ms-1" />
                            דחה
                          </Button>
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

      {/* Reject Dialog — approve has no dialog, it's one click */}
      <Dialog open={!!rejectingFile} onOpenChange={(open) => !open && setRejectingFile(null)}>
        <DialogContent dir="rtl">
          <DialogHeader>
            <DialogTitle>דחיית קובץ</DialogTitle>
            <DialogDescription>
              האם אתה בטוח שברצונך לדחות את הקובץ? יש לציין סיבה לדחייה.
            </DialogDescription>
          </DialogHeader>
          {rejectingFile && (
            <div className="py-4">
              <div className="bg-muted rounded-lg p-3 mb-4">
                <p className="font-medium">{rejectingFile.fileName}</p>
                {rejectingFile.supplier && (
                  <p className="text-sm text-muted-foreground">
                    ספק: {rejectingFile.supplier.name}
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">הערות (חובה)</label>
                <Textarea
                  value={reviewNotes}
                  onChange={(e) => setReviewNotes(e.target.value)}
                  placeholder="סיבת הדחייה..."
                  rows={3}
                />
              </div>
            </div>
          )}
          <DialogFooter className="flex gap-2">
            <Button variant="outline" onClick={() => setRejectingFile(null)}>
              ביטול
            </Button>
            <Button
              variant="destructive"
              onClick={handleConfirmReject}
              disabled={reviewMutation.isPending || !reviewNotes.trim()}
            >
              {reviewMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin ms-2" />
                  מעבד...
                </>
              ) : (
                "דחה קובץ"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
