"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { useRouter, useParams } from "next/navigation";
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
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ChevronRight,
  RefreshCw,
  Plus,
  Check,
  Clock,
  Pencil,
  Trash2,
  MoreHorizontal,
  Loader2,
  Receipt,
  ArrowUpDown,
} from "lucide-react";
import { toast } from "sonner";
import type { UserRole, AdjustmentType } from "@/db/schema";
import { getPeriodByKey } from "@/lib/settlement-periods";
import { formatCurrency } from "@/lib/translations";

// Types
interface AdjustmentItem {
  id: string;
  adjustmentType: AdjustmentType;
  amount: number;
  reason: string;
  description?: string | null;
  referenceNumber?: string | null;
  effectiveDate?: string | null;
  approvedAt?: string | null;
  approvedBy?: string | null;
  createdAt: string;
  createdBy?: string | null;
}

interface AdjustmentSummary {
  total: number;
  totalAmount: number;
  pending: number;
  approved: number;
  byType: Record<string, number>;
}

// Adjustment type configurations (Hebrew labels)
const adjustmentTypeConfig: Record<
  AdjustmentType,
  { label: string; description: string }
> = {
  credit: { label: "זיכוי", description: "זיכוי כספי" },
  debit: { label: "חיוב", description: "חיוב נוסף" },
  refund: { label: "החזר", description: "החזר כספי" },
  penalty: { label: "קנס", description: "קנס או עיצום" },
  bonus: { label: "בונוס", description: "בונוס או פרס" },
  deposit: { label: "פיקדון", description: "פיקדון שהופקד" },
  supplier_error: { label: "טעות ספק", description: "תיקון טעות של הספק" },
  timing: { label: "הפרשי עיתוי", description: "נכנס לתקופה אחרת" },
  other: { label: "אחר", description: "התאמה אחרת - נדרש תיאור" },
};

// Form state type
interface AdjustmentFormData {
  adjustmentType: AdjustmentType;
  amount: string;
  reason: string;
  description: string;
  referenceNumber: string;
  effectiveDate: string;
}

const initialFormData: AdjustmentFormData = {
  adjustmentType: "credit",
  amount: "",
  reason: "",
  description: "",
  referenceNumber: "",
  effectiveDate: "",
};

export default function AdjustmentsPage() {
  const router = useRouter();
  const params = useParams();
  const periodKey = decodeURIComponent(params.periodKey as string);

  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [adjustments, setAdjustments] = useState<AdjustmentItem[]>([]);
  const [summary, setSummary] = useState<AdjustmentSummary | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingAdjustment, setEditingAdjustment] = useState<AdjustmentItem | null>(null);
  const [formData, setFormData] = useState<AdjustmentFormData>(initialFormData);

  const { data: session, isPending } = authClient.useSession();
  const userRole = session
    ? (session.user as { role?: UserRole })?.role
    : undefined;

  // Parse period info from key (memoized to prevent infinite loop)
  const periodInfo = useMemo(() => getPeriodByKey(periodKey), [periodKey]);

  const fetchAdjustments = useCallback(async () => {
    try {
      setIsLoading(true);
      const response = await fetch(`/api/settlement-workflow/${encodeURIComponent(periodKey)}/adjustments`);
      if (!response.ok) {
        throw new Error("Failed to fetch adjustments");
      }
      const data = await response.json();
      setAdjustments(data.adjustments || []);
      setSummary(data.summary || null);
    } catch (error) {
      console.error("Error fetching adjustments:", error);
      toast.error("שגיאה בטעינת ההתאמות");
    } finally {
      setIsLoading(false);
    }
  }, [periodKey]);

  useEffect(() => {
    if (!isPending && !session) {
      router.push(`/sign-in?redirect=/admin/settlement-workflow/${encodeURIComponent(periodKey)}/adjustments`);
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

    if (!isPending && session && periodInfo) {
      fetchAdjustments();
    }
  }, [session, isPending, router, userRole, periodKey, periodInfo, fetchAdjustments]);

  const handleOpenDialog = (adjustment?: AdjustmentItem) => {
    if (adjustment) {
      setEditingAdjustment(adjustment);
      setFormData({
        adjustmentType: adjustment.adjustmentType,
        amount: adjustment.amount.toString(),
        reason: adjustment.reason,
        description: adjustment.description || "",
        referenceNumber: adjustment.referenceNumber || "",
        effectiveDate: adjustment.effectiveDate || "",
      });
    } else {
      setEditingAdjustment(null);
      setFormData(initialFormData);
    }
    setIsDialogOpen(true);
  };

  const handleCloseDialog = () => {
    setIsDialogOpen(false);
    setEditingAdjustment(null);
    setFormData(initialFormData);
  };

  const handleSubmit = async () => {
    // Validate form
    if (!formData.adjustmentType) {
      toast.error("יש לבחור סוג התאמה");
      return;
    }
    if (!formData.amount || isNaN(parseFloat(formData.amount))) {
      toast.error("יש להזין סכום תקין");
      return;
    }
    if (!formData.reason.trim()) {
      toast.error("יש להזין סיבה");
      return;
    }
    if (formData.adjustmentType === "other" && !formData.description.trim()) {
      toast.error("סוג 'אחר' דורש תיאור");
      return;
    }

    setIsSaving(true);
    try {
      if (editingAdjustment) {
        // Update existing
        const response = await fetch(
          `/api/settlement-workflow/${encodeURIComponent(periodKey)}/adjustments`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              adjustmentId: editingAdjustment.id,
              action: "update",
              amount: parseFloat(formData.amount),
              reason: formData.reason.trim(),
              description: formData.description.trim() || null,
              referenceNumber: formData.referenceNumber.trim() || null,
              effectiveDate: formData.effectiveDate || null,
            }),
          }
        );

        if (!response.ok) {
          const data = await response.json();
          throw new Error(data.error || "שגיאה בעדכון ההתאמה");
        }

        toast.success("ההתאמה עודכנה בהצלחה");
      } else {
        // Create new
        const response = await fetch(
          `/api/settlement-workflow/${encodeURIComponent(periodKey)}/adjustments`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              adjustmentType: formData.adjustmentType,
              amount: parseFloat(formData.amount),
              reason: formData.reason.trim(),
              description: formData.description.trim() || null,
              referenceNumber: formData.referenceNumber.trim() || null,
              effectiveDate: formData.effectiveDate || null,
            }),
          }
        );

        if (!response.ok) {
          const data = await response.json();
          throw new Error(data.error || "שגיאה ביצירת ההתאמה");
        }

        toast.success("ההתאמה נוצרה בהצלחה");
      }

      handleCloseDialog();
      fetchAdjustments();
    } catch (error) {
      console.error("Error saving adjustment:", error);
      toast.error(error instanceof Error ? error.message : "שגיאה בשמירת ההתאמה");
    } finally {
      setIsSaving(false);
    }
  };

  const handleApprove = async (adjustmentId: string) => {
    try {
      const response = await fetch(
        `/api/settlement-workflow/${encodeURIComponent(periodKey)}/adjustments`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            adjustmentId,
            action: "approve",
          }),
        }
      );

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "שגיאה באישור ההתאמה");
      }

      toast.success("ההתאמה אושרה בהצלחה");
      fetchAdjustments();
    } catch (error) {
      console.error("Error approving adjustment:", error);
      toast.error(error instanceof Error ? error.message : "שגיאה באישור ההתאמה");
    }
  };

  const handleDelete = async (adjustmentId: string) => {
    if (!confirm("האם למחוק את ההתאמה?")) return;

    try {
      const response = await fetch(
        `/api/settlement-workflow/${encodeURIComponent(periodKey)}/adjustments`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            adjustmentId,
            action: "delete",
          }),
        }
      );

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "שגיאה במחיקת ההתאמה");
      }

      toast.success("ההתאמה נמחקה בהצלחה");
      fetchAdjustments();
    } catch (error) {
      console.error("Error deleting adjustment:", error);
      toast.error(error instanceof Error ? error.message : "שגיאה במחיקת ההתאמה");
    }
  };

  if (!periodInfo) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center">
          <h2 className="text-xl font-semibold mb-2">תקופה לא נמצאה</h2>
          <p className="text-muted-foreground mb-4">מפתח תקופה: {periodKey}</p>
          <Button onClick={() => router.push("/admin/settlements")}>
            חזרה לרשימת התקופות
          </Button>
        </div>
      </div>
    );
  }

  if (isLoading || isPending) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          <Link href={`/admin/settlement-workflow/${encodeURIComponent(periodKey)}`}>
            <Button variant="ghost" size="sm">
              <ChevronRight className="h-4 w-4 ms-1" />
              חזרה לתקופה
            </Button>
          </Link>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold">התאמות</h1>
              <Badge variant="outline">{periodInfo.nameHe}</Badge>
            </div>
            <p className="text-muted-foreground text-sm">
              {periodInfo.startDate?.toLocaleDateString("he-IL", { day: "numeric", month: "short", year: "numeric" })} - {periodInfo.endDate?.toLocaleDateString("he-IL", { day: "numeric", month: "short", year: "numeric" })}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={fetchAdjustments}>
            <RefreshCw className="me-2 h-4 w-4" />
            רענון
          </Button>
          <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
            <DialogTrigger asChild>
              <Button onClick={() => handleOpenDialog()}>
                <Plus className="me-2 h-4 w-4" />
                התאמה חדשה
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[500px]">
              <DialogHeader>
                <DialogTitle>
                  {editingAdjustment ? "עריכת התאמה" : "התאמה חדשה"}
                </DialogTitle>
                <DialogDescription>
                  {editingAdjustment
                    ? "עדכן את פרטי ההתאמה"
                    : "הוסף התאמה חדשה לתקופה"}
                </DialogDescription>
              </DialogHeader>

              <div className="grid gap-4 py-4">
                <div className="grid gap-2">
                  <Label htmlFor="adjustmentType">סוג התאמה</Label>
                  <Select
                    value={formData.adjustmentType}
                    onValueChange={(v) =>
                      setFormData({ ...formData, adjustmentType: v as AdjustmentType })
                    }
                    disabled={!!editingAdjustment}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="בחר סוג" />
                    </SelectTrigger>
                    <SelectContent>
                      {(Object.keys(adjustmentTypeConfig) as AdjustmentType[]).map((type) => (
                        <SelectItem key={type} value={type}>
                          {adjustmentTypeConfig[type].label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="grid gap-2">
                  <Label htmlFor="amount">סכום</Label>
                  <Input
                    id="amount"
                    type="number"
                    step="0.01"
                    placeholder="0.00"
                    value={formData.amount}
                    onChange={(e) =>
                      setFormData({ ...formData, amount: e.target.value })
                    }
                    dir="ltr"
                    className="text-start"
                  />
                  <p className="text-xs text-muted-foreground">
                    סכום חיובי = זיכוי, סכום שלילי = חיוב
                  </p>
                </div>

                <div className="grid gap-2">
                  <Label htmlFor="reason">סיבה</Label>
                  <Input
                    id="reason"
                    placeholder="סיבת ההתאמה"
                    value={formData.reason}
                    onChange={(e) =>
                      setFormData({ ...formData, reason: e.target.value })
                    }
                  />
                </div>

                <div className="grid gap-2">
                  <Label htmlFor="description">
                    תיאור{" "}
                    {formData.adjustmentType === "other" && (
                      <span className="text-destructive">*</span>
                    )}
                  </Label>
                  <Textarea
                    id="description"
                    placeholder="תיאור מפורט (אופציונלי)"
                    value={formData.description}
                    onChange={(e) =>
                      setFormData({ ...formData, description: e.target.value })
                    }
                    rows={3}
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="grid gap-2">
                    <Label htmlFor="referenceNumber">מספר אסמכתא</Label>
                    <Input
                      id="referenceNumber"
                      placeholder="אופציונלי"
                      value={formData.referenceNumber}
                      onChange={(e) =>
                        setFormData({ ...formData, referenceNumber: e.target.value })
                      }
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="effectiveDate">תאריך תוקף</Label>
                    <Input
                      id="effectiveDate"
                      type="date"
                      value={formData.effectiveDate}
                      onChange={(e) =>
                        setFormData({ ...formData, effectiveDate: e.target.value })
                      }
                    />
                  </div>
                </div>
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={handleCloseDialog}>
                  ביטול
                </Button>
                <Button onClick={handleSubmit} disabled={isSaving}>
                  {isSaving ? (
                    <>
                      <Loader2 className="me-2 h-4 w-4 animate-spin" />
                      שומר...
                    </>
                  ) : editingAdjustment ? (
                    "עדכון"
                  ) : (
                    "יצירה"
                  )}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid gap-4 md:grid-cols-4 mb-6">
        <Card>
          <CardContent className="pt-6">
            <div className="text-2xl font-bold">{summary?.total || 0}</div>
            <p className="text-muted-foreground text-sm">{`סה"כ התאמות`}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-2xl font-bold">{formatCurrency(summary?.totalAmount || 0)}</div>
            <p className="text-muted-foreground text-sm">{`סה"כ סכום`}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-2xl font-bold text-amber-600">{summary?.pending || 0}</div>
            <p className="text-muted-foreground text-sm">ממתינות לאישור</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-2xl font-bold text-green-600">{summary?.approved || 0}</div>
            <p className="text-muted-foreground text-sm">מאושרות</p>
          </CardContent>
        </Card>
      </div>

      {/* Adjustments Table */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ArrowUpDown className="h-5 w-5" />
            רשימת התאמות
          </CardTitle>
          <CardDescription>
            {adjustments.length} התאמות בתקופה זו
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-right">סוג</TableHead>
                <TableHead className="text-right">סכום</TableHead>
                <TableHead className="text-right">סיבה</TableHead>
                <TableHead className="text-right">אסמכתא</TableHead>
                <TableHead className="text-right">תאריך תוקף</TableHead>
                <TableHead className="text-right">סטטוס</TableHead>
                <TableHead className="text-right">פעולות</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {adjustments.map((adj) => (
                <TableRow key={adj.id}>
                  <TableCell className="font-medium">
                    <Badge variant="secondary">
                      {adjustmentTypeConfig[adj.adjustmentType]?.label || adj.adjustmentType}
                    </Badge>
                  </TableCell>
                  <TableCell
                    className={`text-start font-medium ${
                      adj.amount >= 0 ? "text-green-600" : "text-red-600"
                    }`}
                    dir="ltr"
                  >
                    {formatCurrency(adj.amount)}
                  </TableCell>
                  <TableCell className="max-w-[200px] truncate" title={adj.reason}>
                    {adj.reason}
                  </TableCell>
                  <TableCell>{adj.referenceNumber || "-"}</TableCell>
                  <TableCell>
                    {adj.effectiveDate
                      ? new Date(adj.effectiveDate).toLocaleDateString("he-IL")
                      : "-"}
                  </TableCell>
                  <TableCell>
                    {adj.approvedAt ? (
                      <Badge variant="default" className="flex items-center gap-1 w-fit">
                        <Check className="h-3 w-3" />
                        מאושר
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="flex items-center gap-1 w-fit">
                        <Clock className="h-3 w-3" />
                        ממתין
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon">
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        {!adj.approvedAt && (
                          <>
                            <DropdownMenuItem onClick={() => handleOpenDialog(adj)}>
                              <Pencil className="me-2 h-4 w-4" />
                              עריכה
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handleApprove(adj.id)}>
                              <Check className="me-2 h-4 w-4" />
                              אישור
                            </DropdownMenuItem>
                          </>
                        )}
                        <DropdownMenuItem
                          onClick={() => handleDelete(adj.id)}
                          className="text-destructive"
                        >
                          <Trash2 className="me-2 h-4 w-4" />
                          מחיקה
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          {adjustments.length === 0 && (
            <div className="text-center py-8 text-muted-foreground">
              {`אין התאמות. לחץ על "התאמה חדשה" כדי להוסיף.`}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
