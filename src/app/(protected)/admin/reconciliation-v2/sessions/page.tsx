"use client";

import { useState } from "react";
import Link from "next/link";
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
import { Scale, ArrowLeft, Loader2, ExternalLink, Trash2 } from "lucide-react";
import { useReconciliationSessions, useDeleteReconciliationSession } from "@/queries/reconciliation-v2";
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

export default function SessionsListPage() {
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const { data: sessions, isLoading, error } = useReconciliationSessions(
    statusFilter !== "all" ? { status: statusFilter } : undefined
  );
  const deleteSession = useDeleteReconciliationSession();

  const handleDeleteSession = async (sessionId: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (!confirm("האם למחוק את הסשן? פעולה זו אינה ניתנת לביטול.")) {
      return;
    }

    try {
      await deleteSession.mutateAsync(sessionId);
      toast.success("הסשן נמחק בהצלחה");
    } catch (error) {
      toast.error("שגיאה במחיקת הסשן");
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
            <SelectItem value="completed">הושלם</SelectItem>
            <SelectItem value="file_approved">קובץ אושר</SelectItem>
            <SelectItem value="file_rejected">קובץ נדחה</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Sessions Table */}
      <Card>
        <CardHeader>
          <CardTitle>סשני התאמה</CardTitle>
          <CardDescription>
            {sessions?.length ?? 0} סשנים נמצאו
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
          ) : sessions?.length === 0 ? (
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
                {sessions?.map((session) => {
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
                        <Badge variant={statusColors[session.status as SessionStatus]}>
                          {statusLabels[session.status as SessionStatus] || session.status}
                        </Badge>
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
                            disabled={deleteSession.isPending}
                            className="text-destructive hover:text-destructive"
                          >
                            {deleteSession.isPending ? (
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
    </div>
  );
}
