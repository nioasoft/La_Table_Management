"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Scale, ArrowLeft, Loader2, ExternalLink, Trash2, AlertTriangle, FileQuestion } from "lucide-react";
import {
  useReconciliationSessions,
  useDeleteReconciliationSession,
  useMissingSessions,
  useCreateReconciliationSession,
} from "@/queries/reconciliation-v2";
import { format } from "date-fns";
import { he } from "date-fns/locale";
import { toast } from "sonner";

type SessionStatus = "in_progress" | "completed" | "file_approved" | "file_rejected";

const statusLabels: Record<SessionStatus, string> = {
  in_progress: "בתהליך",
  completed: "הושלם",
  file_approved: "קובץ אושר",
  file_rejected: "קובץ נדחה",
};

const statusColors: Record<SessionStatus, "default" | "secondary" | "destructive" | "outline"> = {
  in_progress: "default",
  completed: "secondary",
  file_approved: "secondary",
  file_rejected: "destructive",
};

function formatPeriod(startDate: string, endDate: string): string {
  try {
    const start = format(new Date(startDate), "MMM yyyy", { locale: he });
    const end = format(new Date(endDate), "MMM yyyy", { locale: he });
    return `${start} - ${end}`;
  } catch {
    return `${startDate} - ${endDate}`;
  }
}

function formatAmount(amount: string | number | null): string {
  if (amount === null || amount === undefined) return "₪0";
  const num = typeof amount === "string" ? parseFloat(amount) : amount;
  return `₪${num.toLocaleString("he-IL", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

// Files whose period never got approved yet — the session can still be built,
// this is only a hint about why nobody built it.
const PENDING_FILE_STATUSES = new Set(["pending", "processing", "needs_review"]);

export default function SessionsListPage() {
  const router = useRouter();
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [periodFilter, setPeriodFilter] = useState<string>("all");
  const [buildingKey, setBuildingKey] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const { data: sessions, isLoading, error } = useReconciliationSessions(
    statusFilter !== "all" ? { status: statusFilter } : undefined
  );
  const {
    data: missing,
    isLoading: missingLoading,
    error: missingError,
  } = useMissingSessions();
  const deleteSession = useDeleteReconciliationSession();
  const createSession = useCreateReconciliationSession();

  // Periods come from the rows themselves rather than a month/quarter picker,
  // so the list only ever offers periods that actually exist — on either side,
  // since a period with no session at all appears only in the missing list.
  const periods = useMemo(() => {
    const seen = new Map<string, string>();
    const add = (start: string | null, end: string | null) => {
      if (!start || !end) return;
      const key = `${start}_${end}`;
      if (!seen.has(key)) seen.set(key, formatPeriod(start, end));
    };
    for (const s of sessions ?? []) add(s.periodStartDate, s.periodEndDate);
    for (const m of missing ?? []) add(m.periodStartDate, m.periodEndDate);
    return [...seen.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [sessions, missing]);

  const visibleSessions = useMemo(
    () =>
      (sessions ?? []).filter(
        (s) =>
          periodFilter === "all" ||
          `${s.periodStartDate}_${s.periodEndDate}` === periodFilter
      ),
    [sessions, periodFilter]
  );

  // Undated files have no period to filter on — they stay visible under "all"
  // only, otherwise they'd look like they belong to whatever period is picked.
  const visibleMissing = useMemo(
    () =>
      (missing ?? []).filter(
        (m) =>
          periodFilter === "all" ||
          `${m.periodStartDate}_${m.periodEndDate}` === periodFilter
      ),
    [missing, periodFilter]
  );

  const handleBuildSession = async (row: (typeof visibleMissing)[number]) => {
    if (!row.periodStartDate || !row.periodEndDate) return;
    const periodKey = `${row.periodStartDate}_${row.periodEndDate}`;
    setBuildingKey(`${row.supplierId}_${periodKey}`);

    try {
      const session = await createSession.mutateAsync({
        supplierId: row.supplierId,
        supplierFileId: row.supplierFileId,
        supplierFileIds: row.supplierFileIds,
        periodStartDate: row.periodStartDate,
        periodEndDate: row.periodEndDate,
      });

      toast.success("סשן התאמה נוצר בהצלחה");
      if (session?.brandMappingMissing) {
        toast.warning(
          "לספק לא מוגדרים מותגים — יופיעו רק סניפים שמופיעים בקובץ הספק. סניפים ללא פעילות לא ייווצרו כשורות 0. הגדר מותגים בכרטיס הספק ובנה מחדש.",
          { duration: 12000 }
        );
      }
      router.push(`/admin/reconciliation-v2/${row.supplierId}/${periodKey}`);
    } catch (err) {
      console.error("Failed to create session:", err);
      toast.error(err instanceof Error ? err.message : "שגיאה ביצירת סשן התאמה");
      setBuildingKey(null);
    }
  };

  const handleDeleteSession = async (sessionId: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (!confirm("האם למחוק את הסשן? פעולה זו אינה ניתנת לביטול.")) {
      return;
    }

    // Track the row being deleted, not the mutation — mutation.isPending is
    // shared, so every row's button would spin during a single delete.
    setDeletingId(sessionId);
    try {
      await deleteSession.mutateAsync(sessionId);
      toast.success("הסשן נמחק בהצלחה");
    } catch {
      toast.error("שגיאה במחיקת הסשן");
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="container max-w-6xl py-8 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/admin/reconciliation-v2">
            <Button variant="ghost" size="icon">
              <ArrowLeft className="h-5 w-5" />
            </Button>
          </Link>
          <Scale className="h-8 w-8 text-primary" />
          <div>
            <h1 className="text-2xl font-bold">סשנים פעילים</h1>
            <p className="text-muted-foreground">
              רשימת כל סשני ההתאמה - פעילים ומושלמים
            </p>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-4">
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[200px]">
            <SelectValue placeholder="סנן לפי סטטוס" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">כל הסטטוסים</SelectItem>
            <SelectItem value="in_progress">בתהליך</SelectItem>
            <SelectItem value="file_approved">קובץ אושר</SelectItem>
            <SelectItem value="file_rejected">קובץ נדחה</SelectItem>
          </SelectContent>
        </Select>

        <Select value={periodFilter} onValueChange={setPeriodFilter} dir="rtl">
          <SelectTrigger className="w-[220px]">
            <SelectValue placeholder="סנן לפי תקופה" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">כל התקופות</SelectItem>
            {periods.map(([key, label]) => (
              <SelectItem key={key} value={key}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Sessions Table */}
      <Card>
        <CardHeader>
          <CardTitle>סשני התאמה</CardTitle>
          <CardDescription>
            {visibleSessions.length} סשנים נמצאו
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : error ? (
            <div className="text-center py-12 text-destructive">
              שגיאה בטעינת סשנים
            </div>
          ) : visibleSessions.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              לא נמצאו סשנים
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>ספק</TableHead>
                  <TableHead>תקופה</TableHead>
                  <TableHead>סטטוס</TableHead>
                  <TableHead>התקדמות</TableHead>
                  <TableHead>סכום ספק</TableHead>
                  <TableHead>הפרש</TableHead>
                  <TableHead>נוצר</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibleSessions.map((session) => {
                  const progress = session.totalFranchisees
                    ? Math.round(((session.approvedCount ?? 0) / session.totalFranchisees) * 100)
                    : 0;
                  const periodKey = `${session.periodStartDate}_${session.periodEndDate}`;

                  return (
                    <TableRow key={session.id}>
                      <TableCell>
                        <div>
                          <div className="font-medium">{session.supplierName}</div>
                          <div className="text-sm text-muted-foreground">{session.supplierCode}</div>
                        </div>
                      </TableCell>
                      <TableCell>
                        {formatPeriod(session.periodStartDate, session.periodEndDate)}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Badge variant={statusColors[session.status as SessionStatus]}>
                            {statusLabels[session.status as SessionStatus] || session.status}
                          </Badge>
                          {/* Archived runs are filtered out server-side, so staleAt
                              alone means "a newer file landed — rebuild me". The
                              session page has the banner and the rebuild button. */}
                          {session.staleAt && (
                            <Badge variant="warning" className="gap-1" title="התקבל קובץ חדש לתקופה — יש לבנות מחדש">
                              <AlertTriangle className="h-3 w-3" />
                              לא מעודכן
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <div className="w-24 bg-muted rounded-full h-2">
                            <div
                              className="bg-primary h-2 rounded-full"
                              style={{ width: `${progress}%` }}
                            />
                          </div>
                          <span className="text-sm text-muted-foreground">
                            {session.approvedCount ?? 0}/{session.totalFranchisees ?? 0}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>{formatAmount(session.totalSupplierAmount)}</TableCell>
                      <TableCell>
                        <span className={
                          parseFloat(session.totalDifference ?? "0") > 0
                            ? "text-amber-600"
                            : parseFloat(session.totalDifference ?? "0") < 0
                            ? "text-red-600"
                            : ""
                        }>
                          {formatAmount(session.totalDifference)}
                        </span>
                      </TableCell>
                      <TableCell>
                        <div className="text-sm">
                          {format(new Date(session.createdAt), "dd/MM/yyyy", { locale: he })}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Link href={`/admin/reconciliation-v2/${session.supplierId}/${periodKey}`}>
                            <Button variant="ghost" size="sm">
                              <ExternalLink className="h-4 w-4" />
                            </Button>
                          </Link>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={(e) => handleDeleteSession(session.id, e)}
                            disabled={deletingId === session.id}
                            className="text-destructive hover:text-destructive"
                          >
                            {deletingId === session.id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Trash2 className="h-4 w-4" />
                            )}
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Periods with a supplier file but no session — the inverse of the table
          above. Periods with no file at all are out of scope; that board is
          /admin/supplier-files/completeness. */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileQuestion className="h-5 w-5 text-muted-foreground" />
            ללא סשן ({visibleMissing.length})
          </CardTitle>
          <CardDescription>
            קבצי ספק שנכנסו למערכת ולא נבנה עליהם סשן התאמה
          </CardDescription>
        </CardHeader>
        <CardContent>
          {missingLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : missingError ? (
            <div className="text-center py-12 text-destructive">
              שגיאה בטעינת תקופות ללא סשן
            </div>
          ) : visibleMissing.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              אין פערים — לכל קובץ ספק יש סשן
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>ספק</TableHead>
                  <TableHead>תקופה</TableHead>
                  <TableHead>סטטוס קובץ</TableHead>
                  <TableHead>קובץ</TableHead>
                  <TableHead>הועלה</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibleMissing.map((row) => {
                  const hasPeriod = !!(row.periodStartDate && row.periodEndDate);
                  const isBuilding =
                    buildingKey ===
                    `${row.supplierId}_${row.periodStartDate}_${row.periodEndDate}`;

                  return (
                    <TableRow key={`${row.supplierId}_${row.supplierFileId}`}>
                      <TableCell>
                        <div>
                          <div className="font-medium">{row.supplierName}</div>
                          <div className="text-sm text-muted-foreground">
                            {row.supplierCode}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        {hasPeriod ? (
                          formatPeriod(row.periodStartDate!, row.periodEndDate!)
                        ) : (
                          <span className="text-muted-foreground">לא זוהתה</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {!hasPeriod ? (
                          <Badge variant="destructive" className="gap-1">
                            <AlertTriangle className="h-3 w-3" />
                            תאריכי תקופה לא זוהו
                          </Badge>
                        ) : PENDING_FILE_STATUSES.has(row.fileStatus) ? (
                          <Badge variant="warning">ממתין לבדיקת קובץ</Badge>
                        ) : (
                          <Badge variant="outline">מוכן לבנייה</Badge>
                        )}
                      </TableCell>
                      <TableCell
                        className="max-w-[220px] truncate text-sm"
                        title={row.supplierFileName}
                      >
                        {row.supplierFileName}
                      </TableCell>
                      <TableCell>
                        <div className="text-sm">
                          {format(new Date(row.uploadedAt), "dd/MM/yyyy", { locale: he })}
                        </div>
                      </TableCell>
                      <TableCell>
                        {hasPeriod && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleBuildSession(row)}
                            disabled={isBuilding}
                          >
                            {isBuilding ? (
                              <Loader2 className="h-4 w-4 me-2 animate-spin" />
                            ) : (
                              <Scale className="h-4 w-4 me-2" />
                            )}
                            התחל התאמה
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
