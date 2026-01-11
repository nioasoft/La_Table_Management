"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { authClient } from "@/lib/auth-client";
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  LogOut,
  ChevronRight,
  RefreshCw,
  Loader2,
  Check,
  X,
  Clock,
  FileCheck,
  FilePlus,
  FileText,
  Lock,
  Unlock,
  AlertTriangle,
  CheckCircle2,
  Building2,
  Calendar,
  User,
} from "lucide-react";
import { toast } from "sonner";
import type { UserRole, SettlementStatus, SettlementPeriodType } from "@/db/schema";
import { he } from "@/lib/translations";

// Settlement type with details
interface SettlementWithDetails {
  id: string;
  name: string;
  franchiseeId: string;
  periodType: SettlementPeriodType;
  periodStartDate: string;
  periodEndDate: string;
  status: SettlementStatus;
  grossSales: string | null;
  netSales: string | null;
  royaltyAmount: string | null;
  marketingFeeAmount: string | null;
  totalDeductions: string | null;
  totalAdjustments: string | null;
  netPayable: string | null;
  dueDate: string | null;
  paidDate: string | null;
  notes: string | null;
  approvedAt: string | null;
  approvedBy: string | null;
  createdAt: string;
  updatedAt: string;
  createdBy: string | null;
  franchisee?: {
    id: string;
    name: string;
    code: string;
  } | null;
  createdByUser?: { name: string; email: string } | null;
  approvedByUser?: { name: string; email: string } | null;
}

// Status configuration
const statusConfig: Record<
  SettlementStatus,
  { label: string; variant: "default" | "secondary" | "destructive" | "outline"; icon: React.ReactNode }
> = {
  open: { label: "פתוח", variant: "outline", icon: <FilePlus className="h-3 w-3" /> },
  processing: { label: "בעיבוד", variant: "secondary", icon: <Clock className="h-3 w-3" /> },
  pending_approval: { label: "ממתין לאישור", variant: "default", icon: <AlertTriangle className="h-3 w-3" /> },
  approved: { label: "מאושר", variant: "default", icon: <CheckCircle2 className="h-3 w-3" /> },
  invoiced: { label: "חשבונית הופקה", variant: "secondary", icon: <FileCheck className="h-3 w-3" /> },
  // Legacy statuses
  draft: { label: "טיוטה", variant: "outline", icon: <FileText className="h-3 w-3" /> },
  pending: { label: "ממתין", variant: "secondary", icon: <Clock className="h-3 w-3" /> },
  completed: { label: "הושלם", variant: "default", icon: <Check className="h-3 w-3" /> },
  cancelled: { label: "בוטל", variant: "destructive", icon: <X className="h-3 w-3" /> },
};

// Period type labels
const periodTypeLabels: Record<SettlementPeriodType, string> = {
  monthly: "חודשי",
  quarterly: "רבעוני",
  semi_annual: "חצי שנתי",
  annual: "שנתי",
};

// Approval modal state
interface ApprovalModal {
  isOpen: boolean;
  settlement: SettlementWithDetails | null;
  action: "approve" | "reject" | "reopen" | null;
  reason: string;
  isSubmitting: boolean;
}

export default function SettlementsPage() {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(true);
  const [settlements, setSettlements] = useState<SettlementWithDetails[]>([]);
  const [stats, setStats] = useState<{
    total: number;
    byStatus: Record<string, number>;
    byPeriodType: Record<string, number>;
  } | null>(null);
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [filterPeriodType, setFilterPeriodType] = useState<string>("all");
  const [approvalModal, setApprovalModal] = useState<ApprovalModal>({
    isOpen: false,
    settlement: null,
    action: null,
    reason: "",
    isSubmitting: false,
  });

  const { data: session, isPending } = authClient.useSession();
  const userRole = session
    ? (session.user as { role?: UserRole })?.role
    : undefined;
  const isSuperUser = userRole === "super_user";

  useEffect(() => {
    if (!isPending && !session) {
      router.push("/sign-in?redirect=/admin/settlements");
      return;
    }

    if (
      !isPending &&
      session?.user &&
      userRole !== "super_user" &&
      userRole !== "admin"
    ) {
      router.push("/dashboard");
      return;
    }

    if (!isPending && session) {
      fetchSettlements();
    }
  }, [session, isPending, router, userRole]);

  useEffect(() => {
    if (!isPending && session) {
      fetchSettlements();
    }
  }, [filterStatus, filterPeriodType]);

  const fetchSettlements = async () => {
    try {
      setIsLoading(true);
      let url = "/api/settlements?stats=true";

      if (filterStatus && filterStatus !== "all") {
        if (filterStatus === "pending_approval") {
          url += "&filter=pending_approval";
        } else {
          url += `&status=${filterStatus}`;
        }
      }

      if (filterPeriodType && filterPeriodType !== "all") {
        url += `&periodType=${filterPeriodType}`;
      }

      const response = await fetch(url);
      if (!response.ok) {
        throw new Error("Failed to fetch settlements");
      }
      const data = await response.json();
      setSettlements(data.settlements || []);
      setStats(data.stats || null);
    } catch (error) {
      console.error("Error fetching settlements:", error);
      toast.error("שגיאה בטעינת התקופות");
    } finally {
      setIsLoading(false);
    }
  };

  const handleStatusAction = async (
    settlementId: string,
    action: string,
    reason?: string
  ) => {
    try {
      const response = await fetch(`/api/settlements/${settlementId}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, reason }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to update settlement status");
      }

      const data = await response.json();
      toast.success(
        action === "approve"
          ? "התקופה אושרה בהצלחה"
          : action === "reopen"
          ? "התקופה נפתחה מחדש"
          : "הסטטוס עודכן בהצלחה"
      );

      await fetchSettlements();
      return data;
    } catch (error) {
      console.error("Error updating settlement status:", error);
      toast.error(
        error instanceof Error ? error.message : "שגיאה בעדכון הסטטוס"
      );
      throw error;
    }
  };

  const openApprovalModal = (
    settlement: SettlementWithDetails,
    action: "approve" | "reject" | "reopen"
  ) => {
    setApprovalModal({
      isOpen: true,
      settlement,
      action,
      reason: "",
      isSubmitting: false,
    });
  };

  const handleApprovalConfirm = async () => {
    if (!approvalModal.settlement || !approvalModal.action) return;

    setApprovalModal((prev) => ({ ...prev, isSubmitting: true }));

    try {
      await handleStatusAction(
        approvalModal.settlement.id,
        approvalModal.action,
        approvalModal.reason || undefined
      );

      setApprovalModal({
        isOpen: false,
        settlement: null,
        action: null,
        reason: "",
        isSubmitting: false,
      });
    } catch {
      setApprovalModal((prev) => ({ ...prev, isSubmitting: false }));
    }
  };

  const handleSignOut = async () => {
    await authClient.signOut();
    router.push("/sign-in");
  };

  const formatCurrency = (value: string | null) => {
    if (!value) return "-";
    const num = parseFloat(value);
    return new Intl.NumberFormat("he-IL", {
      style: "currency",
      currency: "ILS",
    }).format(num);
  };

  const formatDate = (dateString: string | null) => {
    if (!dateString) return "-";
    return new Date(dateString).toLocaleDateString("he-IL");
  };

  const formatDateTime = (dateString: string | null) => {
    if (!dateString) return "-";
    return new Date(dateString).toLocaleString("he-IL", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const isLocked = (status: SettlementStatus) => {
    return status === "approved" || status === "invoiced";
  };

  if (isLoading || isPending) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  // Count pending approvals
  const pendingApprovalCount = stats?.byStatus?.pending_approval || 0;

  return (
    <div className="container mx-auto p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-4">
          <Link href="/dashboard">
            <Button variant="ghost" size="sm">
              <ChevronRight className="h-4 w-4 ms-1 rtl-flip" />
              {he.common.dashboard}
            </Button>
          </Link>
          <h1 className="text-3xl font-bold">ניהול תקופות התחשבנות</h1>
        </div>
        <Button variant="outline" onClick={handleSignOut}>
          <LogOut className="ml-2 h-4 w-4" />
          התנתקות
        </Button>
      </div>

      {/* Stats Cards */}
      {stats && (
        <div className="grid gap-4 md:grid-cols-3 lg:grid-cols-6 mb-8">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">סה״כ</CardTitle>
              <FileText className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.total}</div>
            </CardContent>
          </Card>
          <Card className={pendingApprovalCount > 0 ? "border-amber-500 bg-amber-50 dark:bg-amber-950/20" : ""}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">ממתין לאישור</CardTitle>
              <AlertTriangle className={`h-4 w-4 ${pendingApprovalCount > 0 ? "text-amber-500" : "text-muted-foreground"}`} />
            </CardHeader>
            <CardContent>
              <div className={`text-2xl font-bold ${pendingApprovalCount > 0 ? "text-amber-600" : ""}`}>
                {pendingApprovalCount}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">מאושר</CardTitle>
              <CheckCircle2 className="h-4 w-4 text-green-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-green-600">
                {stats.byStatus?.approved || 0}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">בעיבוד</CardTitle>
              <Clock className="h-4 w-4 text-blue-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-blue-600">
                {stats.byStatus?.processing || 0}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">פתוח</CardTitle>
              <FilePlus className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {stats.byStatus?.open || 0}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">חשבונית</CardTitle>
              <FileCheck className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {stats.byStatus?.invoiced || 0}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Filters and Actions */}
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <div className="flex flex-wrap items-center gap-4">
          <Select value={filterStatus} onValueChange={setFilterStatus}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="סינון לפי סטטוס" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">כל הסטטוסים</SelectItem>
              <SelectItem value="pending_approval">ממתין לאישור</SelectItem>
              <SelectItem value="open">פתוח</SelectItem>
              <SelectItem value="processing">בעיבוד</SelectItem>
              <SelectItem value="approved">מאושר</SelectItem>
              <SelectItem value="invoiced">חשבונית הופקה</SelectItem>
              <SelectItem value="cancelled">בוטל</SelectItem>
            </SelectContent>
          </Select>
          <Select value={filterPeriodType} onValueChange={setFilterPeriodType}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="סינון לפי סוג תקופה" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">כל התקופות</SelectItem>
              <SelectItem value="monthly">חודשי</SelectItem>
              <SelectItem value="quarterly">רבעוני</SelectItem>
              <SelectItem value="semi_annual">חצי שנתי</SelectItem>
              <SelectItem value="annual">שנתי</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" onClick={fetchSettlements}>
            <RefreshCw className="ml-2 h-4 w-4" />
            רענון
          </Button>
        </div>
      </div>

      {/* Settlements Table */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            תקופות התחשבנות
            {isSuperUser && pendingApprovalCount > 0 && (
              <Badge variant="default" className="mr-2 bg-amber-500">
                {pendingApprovalCount} ממתינים לאישור
              </Badge>
            )}
          </CardTitle>
          <CardDescription>
            {isSuperUser
              ? "בדוק ואשר תקופות התחשבנות. אישור נעילת התקופה ומניעת עריכה."
              : "צפה בתקופות התחשבנות"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {settlements.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              {filterStatus !== "all" || filterPeriodType !== "all"
                ? "לא נמצאו תקופות התואמות את הסינון"
                : "לא נמצאו תקופות התחשבנות"}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>שם התקופה</TableHead>
                    <TableHead>זכיין</TableHead>
                    <TableHead>סוג</TableHead>
                    <TableHead>תקופה</TableHead>
                    <TableHead>סטטוס</TableHead>
                    <TableHead>סכום נטו</TableHead>
                    <TableHead>אישור</TableHead>
                    <TableHead>פעולות</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {settlements.map((settlement) => (
                    <TableRow
                      key={settlement.id}
                      className={
                        settlement.status === "pending_approval"
                          ? "bg-amber-50 dark:bg-amber-950/20"
                          : isLocked(settlement.status)
                          ? "bg-gray-50 dark:bg-gray-900/20"
                          : ""
                      }
                    >
                      <TableCell className="font-medium">
                        <div className="flex items-center gap-2">
                          {isLocked(settlement.status) && (
                            <Lock className="h-4 w-4 text-gray-400" />
                          )}
                          {settlement.name}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Building2 className="h-3 w-3 text-muted-foreground" />
                          {settlement.franchisee?.name || "-"}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {settlement.franchisee?.code || ""}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">
                          {periodTypeLabels[settlement.periodType]}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Calendar className="h-3 w-3 text-muted-foreground" />
                          {formatDate(settlement.periodStartDate)}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          עד {formatDate(settlement.periodEndDate)}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={statusConfig[settlement.status].variant}
                          className={
                            settlement.status === "approved"
                              ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-100"
                              : settlement.status === "pending_approval"
                              ? "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-100"
                              : ""
                          }
                        >
                          {statusConfig[settlement.status].icon}
                          <span className="mr-1">
                            {statusConfig[settlement.status].label}
                          </span>
                        </Badge>
                      </TableCell>
                      <TableCell className="font-mono">
                        {formatCurrency(settlement.netPayable)}
                      </TableCell>
                      <TableCell>
                        {settlement.approvedAt && settlement.approvedByUser ? (
                          <div className="text-xs">
                            <div className="flex items-center gap-1 text-green-600">
                              <CheckCircle2 className="h-3 w-3" />
                              <span>{settlement.approvedByUser.name}</span>
                            </div>
                            <div className="text-muted-foreground">
                              {formatDateTime(settlement.approvedAt)}
                            </div>
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">-</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          {/* Approve button - only for super_user and pending_approval status */}
                          {isSuperUser && settlement.status === "pending_approval" && (
                            <Button
                              size="sm"
                              variant="default"
                              className="bg-green-600 hover:bg-green-700"
                              onClick={() => openApprovalModal(settlement, "approve")}
                            >
                              <Check className="h-4 w-4 ml-1" />
                              אשר
                            </Button>
                          )}
                          {/* Reopen button - only for super_user and approved status */}
                          {isSuperUser && settlement.status === "approved" && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => openApprovalModal(settlement, "reopen")}
                            >
                              <Unlock className="h-4 w-4 ml-1" />
                              פתח מחדש
                            </Button>
                          )}
                          {/* Start processing - for open settlements */}
                          {(userRole === "super_user" || userRole === "admin") &&
                            settlement.status === "open" && (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() =>
                                  handleStatusAction(settlement.id, "start_processing")
                                }
                              >
                                <Clock className="h-4 w-4 ml-1" />
                                התחל עיבוד
                              </Button>
                            )}
                          {/* Submit for approval - for processing settlements */}
                          {(userRole === "super_user" || userRole === "admin") &&
                            settlement.status === "processing" && (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() =>
                                  handleStatusAction(settlement.id, "submit_for_approval")
                                }
                              >
                                <FileCheck className="h-4 w-4 ml-1" />
                                שלח לאישור
                              </Button>
                            )}
                          {/* Mark as invoiced - for approved settlements */}
                          {isSuperUser && settlement.status === "approved" && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() =>
                                handleStatusAction(settlement.id, "invoice")
                              }
                            >
                              <FileText className="h-4 w-4 ml-1" />
                              הפק חשבונית
                            </Button>
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

      {/* Approval Confirmation Modal */}
      <Dialog
        open={approvalModal.isOpen}
        onOpenChange={(open) => {
          if (!open && !approvalModal.isSubmitting) {
            setApprovalModal({
              isOpen: false,
              settlement: null,
              action: null,
              reason: "",
              isSubmitting: false,
            });
          }
        }}
      >
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>
              {approvalModal.action === "approve" && (
                <span className="flex items-center gap-2">
                  <CheckCircle2 className="h-5 w-5 text-green-500" />
                  אישור תקופת התחשבנות
                </span>
              )}
              {approvalModal.action === "reopen" && (
                <span className="flex items-center gap-2">
                  <Unlock className="h-5 w-5 text-amber-500" />
                  פתיחה מחדש של תקופת התחשבנות
                </span>
              )}
            </DialogTitle>
            <DialogDescription>
              {approvalModal.action === "approve" && (
                <>
                  אתה עומד לאשר את תקופת ההתחשבנות{" "}
                  <strong>{approvalModal.settlement?.name}</strong>.
                  <br />
                  <br />
                  <div className="flex items-center gap-2 text-amber-600">
                    <Lock className="h-4 w-4" />
                    <span>אישור ינעל את התקופה ולא ניתן יהיה לערוך אותה.</span>
                  </div>
                </>
              )}
              {approvalModal.action === "reopen" && (
                <>
                  אתה עומד לפתוח מחדש את תקופת ההתחשבנות{" "}
                  <strong>{approvalModal.settlement?.name}</strong>.
                  <br />
                  <br />
                  <div className="flex items-center gap-2 text-amber-600">
                    <AlertTriangle className="h-4 w-4" />
                    <span>פתיחה מחדש תבטל את האישור ותאפשר עריכה.</span>
                  </div>
                </>
              )}
            </DialogDescription>
          </DialogHeader>

          {/* Settlement Summary */}
          {approvalModal.settlement && (
            <div className="bg-muted/50 rounded-lg p-4 space-y-2">
              <div className="flex justify-between">
                <span className="text-muted-foreground">זכיין:</span>
                <span className="font-medium">
                  {approvalModal.settlement.franchisee?.name}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">תקופה:</span>
                <span>
                  {formatDate(approvalModal.settlement.periodStartDate)} -{" "}
                  {formatDate(approvalModal.settlement.periodEndDate)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">סכום נטו לתשלום:</span>
                <span className="font-bold text-lg">
                  {formatCurrency(approvalModal.settlement.netPayable)}
                </span>
              </div>
              {approvalModal.settlement.approvedByUser && (
                <div className="flex justify-between pt-2 border-t">
                  <span className="text-muted-foreground">אושר ע״י:</span>
                  <span className="flex items-center gap-1">
                    <User className="h-3 w-3" />
                    {approvalModal.settlement.approvedByUser.name}
                  </span>
                </div>
              )}
              {approvalModal.settlement.approvedAt && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">בתאריך:</span>
                  <span>{formatDateTime(approvalModal.settlement.approvedAt)}</span>
                </div>
              )}
            </div>
          )}

          {/* Reason input for reopen */}
          {approvalModal.action === "reopen" && (
            <div className="space-y-2">
              <Label htmlFor="reason">סיבה לפתיחה מחדש *</Label>
              <Input
                id="reason"
                placeholder="הזן סיבה לפתיחה מחדש..."
                value={approvalModal.reason}
                onChange={(e) =>
                  setApprovalModal((prev) => ({
                    ...prev,
                    reason: e.target.value,
                  }))
                }
                disabled={approvalModal.isSubmitting}
              />
            </div>
          )}

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() =>
                setApprovalModal({
                  isOpen: false,
                  settlement: null,
                  action: null,
                  reason: "",
                  isSubmitting: false,
                })
              }
              disabled={approvalModal.isSubmitting}
            >
              ביטול
            </Button>
            <Button
              onClick={handleApprovalConfirm}
              disabled={
                approvalModal.isSubmitting ||
                (approvalModal.action === "reopen" && !approvalModal.reason.trim())
              }
              className={
                approvalModal.action === "approve"
                  ? "bg-green-600 hover:bg-green-700"
                  : ""
              }
            >
              {approvalModal.isSubmitting ? (
                <>
                  <Loader2 className="ml-2 h-4 w-4 animate-spin" />
                  מעבד...
                </>
              ) : approvalModal.action === "approve" ? (
                <>
                  <Check className="ml-2 h-4 w-4" />
                  אשר תקופה
                </>
              ) : (
                <>
                  <Unlock className="ml-2 h-4 w-4" />
                  פתח מחדש
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
