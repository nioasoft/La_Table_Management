"use client";

import { useState, useCallback } from "react";
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
  } | null;
  periodStartDate: string | null;
  periodEndDate: string | null;
}

interface ReviewStats {
  pending: number;
  approvedToday: number;
  rejectedToday: number;
}

export default function SupplierFilesReviewPage() {
  const router = useRouter();
  const queryClient = useQueryClient();

  const [selectedFile, setSelectedFile] = useState<ReviewFile | null>(null);
  const [reviewNotes, setReviewNotes] = useState("");
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [dialogAction, setDialogAction] = useState<"approve" | "reject" | null>(null);

  const { data: session, isPending } = authClient.useSession();
  const userRole = session ? (session.user as { role?: string })?.role : undefined;

  // Redirect if not authenticated or authorized
  if (!isPending && !session) {
    router.push("/sign-in?redirect=/admin/supplier-files/review");
  }
  if (!isPending && session?.user && userRole !== "super_user" && userRole !== "admin") {
    router.push("/dashboard");
  }

  // Fetch files needing review
  const { data: reviewData, isLoading, error, refetch } = useQuery({
    queryKey: ["supplier-files", "review"],
    queryFn: async () => {
      const response = await fetch("/api/supplier-files/review");
      if (!response.ok) throw new Error("Failed to fetch review queue");
      return response.json();
    },
    enabled: !isPending && !!session,
    refetchInterval: 30000, // Refetch every 30 seconds
  });

  const files: ReviewFile[] = reviewData?.files || [];
  const stats: ReviewStats = reviewData?.stats || { pending: 0, approvedToday: 0, rejectedToday: 0 };

  // Review action mutation
  const reviewMutation = useMutation({
    mutationFn: async ({ fileId, action, notes }: { fileId: string; action: "approve" | "reject"; notes: string }) => {
      const response = await fetch("/api/supplier-files/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileId, action, notes }),
      });
      if (!response.ok) throw new Error("Failed to process review");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["supplier-files", "review"] });
      queryClient.invalidateQueries({ queryKey: ["supplier-files", "review", "count"] });
      setIsDialogOpen(false);
      setSelectedFile(null);
      setReviewNotes("");
    },
  });

  const handleOpenDialog = useCallback((file: ReviewFile, action: "approve" | "reject") => {
    setSelectedFile(file);
    setDialogAction(action);
    setReviewNotes("");
    setIsDialogOpen(true);
  }, []);

  const handleConfirmAction = useCallback(() => {
    if (!selectedFile || !dialogAction) return;
    reviewMutation.mutate({
      fileId: selectedFile.id,
      action: dialogAction,
      notes: reviewNotes,
    });
  }, [selectedFile, dialogAction, reviewNotes, reviewMutation]);

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
          <Button variant="outline" onClick={() => refetch()} disabled={isLoading}>
            <RefreshCw className={`h-4 w-4 ms-2 ${isLoading ? "animate-spin" : ""}`} />
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
            לחץ על &quot;פרטים&quot; לצפייה בפרטי ההתאמות, או אשר/דחה קובץ ישירות
          </CardDescription>
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
                    <TableHead className="text-right">שם קובץ</TableHead>
                    <TableHead className="text-right">ספק</TableHead>
                    <TableHead className="text-right">תאריך העלאה</TableHead>
                    <TableHead className="text-right">התאמות זכיינים</TableHead>
                    <TableHead className="text-right">תקופה</TableHead>
                    <TableHead className="text-right">פעולות</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {files.map((file) => (
                    <TableRow key={file.id}>
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
                        {file.processingResult?.matchStats ? (
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
                            onClick={() => handleOpenDialog(file, "approve")}
                          >
                            <Check className="h-4 w-4 ms-1" />
                            אשר
                          </Button>
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={() => handleOpenDialog(file, "reject")}
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

      {/* Confirmation Dialog */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {dialogAction === "approve" ? "אישור קובץ" : "דחיית קובץ"}
            </DialogTitle>
            <DialogDescription>
              {dialogAction === "approve"
                ? "האם אתה בטוח שברצונך לאשר את הקובץ? פעולה זו תסמן את הקובץ כמאושר ותסיים את תהליך הבדיקה."
                : "האם אתה בטוח שברצונך לדחות את הקובץ? יש לציין סיבה לדחייה."}
            </DialogDescription>
          </DialogHeader>
          {selectedFile && (
            <div className="py-4">
              <div className="bg-muted rounded-lg p-3 mb-4">
                <p className="font-medium">{selectedFile.fileName}</p>
                {selectedFile.supplier && (
                  <p className="text-sm text-muted-foreground">
                    ספק: {selectedFile.supplier.name}
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">
                  הערות {dialogAction === "reject" ? "(חובה)" : "(אופציונלי)"}
                </label>
                <Textarea
                  value={reviewNotes}
                  onChange={(e) => setReviewNotes(e.target.value)}
                  placeholder={dialogAction === "approve" ? "הערות נוספות..." : "סיבת הדחייה..."}
                  rows={3}
                />
              </div>
            </div>
          )}
          <DialogFooter className="flex gap-2">
            <Button variant="outline" onClick={() => setIsDialogOpen(false)}>
              ביטול
            </Button>
            <Button
              variant={dialogAction === "approve" ? "default" : "destructive"}
              onClick={handleConfirmAction}
              disabled={reviewMutation.isPending || (dialogAction === "reject" && !reviewNotes.trim())}
            >
              {reviewMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin ms-2" />
                  מעבד...
                </>
              ) : dialogAction === "approve" ? (
                "אשר קובץ"
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
