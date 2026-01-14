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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ChevronRight,
  RefreshCw,
  Upload,
  Mail,
  Check,
  Clock,
  AlertCircle,
  FileText,
  MoreVertical,
  Send,
  Link as LinkIcon,
  Copy,
  ExternalLink,
  FileUp,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import type { UserRole, SettlementPeriodType, FileRequestStatus } from "@/db/schema";
import { getPeriodByKey, getPeriodTypeLabel } from "@/lib/settlement-periods";

// Supplier with file request info
interface SupplierWithFileStatus {
  id: string;
  name: string;
  code: string;
  email: string | null;
  contactName: string | null;
  fileRequest: {
    id: string;
    status: FileRequestStatus;
    uploadUrl: string | null;
    sentAt: string | null;
    submittedAt: string | null;
    filesUploaded: number;
  } | null;
}

// File request status config
const fileStatusConfig: Record<
  FileRequestStatus | "not_sent",
  { label: string; variant: "default" | "secondary" | "destructive" | "outline"; icon: React.ReactNode }
> = {
  not_sent: { label: "לא נשלח", variant: "outline", icon: <Clock className="h-3 w-3" /> },
  pending: { label: "ממתין לשליחה", variant: "outline", icon: <Clock className="h-3 w-3" /> },
  sent: { label: "נשלח", variant: "secondary", icon: <Mail className="h-3 w-3" /> },
  in_progress: { label: "בתהליך", variant: "secondary", icon: <Upload className="h-3 w-3" /> },
  submitted: { label: "התקבל", variant: "default", icon: <Check className="h-3 w-3" /> },
  expired: { label: "פג תוקף", variant: "destructive", icon: <AlertCircle className="h-3 w-3" /> },
  cancelled: { label: "בוטל", variant: "destructive", icon: <AlertCircle className="h-3 w-3" /> },
};

export default function FilesManagementPage() {
  const router = useRouter();
  const params = useParams();
  const periodKey = decodeURIComponent(params.periodKey as string);

  const [isLoading, setIsLoading] = useState(true);
  const [suppliers, setSuppliers] = useState<SupplierWithFileStatus[]>([]);
  const [sendingRequests, setSendingRequests] = useState<Set<string>>(new Set());
  const [uploadDialog, setUploadDialog] = useState<{
    open: boolean;
    supplier: SupplierWithFileStatus | null;
  }>({ open: false, supplier: null });
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  const { data: session, isPending } = authClient.useSession();
  const userRole = session
    ? (session.user as { role?: UserRole })?.role
    : undefined;

  // Parse period info from key (memoized to prevent infinite loop)
  const periodInfo = useMemo(() => getPeriodByKey(periodKey), [periodKey]);

  const fetchSuppliers = useCallback(async (periodType: SettlementPeriodType) => {
    try {
      setIsLoading(true);
      // Fetch suppliers for this period frequency with file request status
      const response = await fetch(`/api/settlements/periods?frequency=${periodType}&includeFileRequests=true&periodKey=${encodeURIComponent(periodKey)}`);
      if (!response.ok) {
        throw new Error("Failed to fetch suppliers");
      }
      const data = await response.json();
      // Get suppliers for this frequency
      const frequencySuppliers = data.suppliersByFrequency?.[periodType] || [];

      // Map suppliers with file request status
      const suppliersWithStatus: SupplierWithFileStatus[] = frequencySuppliers.map((supplier: {
        id: string;
        name: string;
        code: string;
        email?: string | null;
        contactName?: string | null;
      }) => ({
        ...supplier,
        email: supplier.email || null,
        contactName: supplier.contactName || null,
        fileRequest: data.fileRequests?.find((fr: { entityId: string }) => fr.entityId === supplier.id) || null,
      }));

      setSuppliers(suppliersWithStatus);
    } catch (error) {
      console.error("Error fetching suppliers:", error);
      toast.error("שגיאה בטעינת הספקים");
    } finally {
      setIsLoading(false);
    }
  }, [periodKey]);

  useEffect(() => {
    if (!isPending && !session) {
      router.push(`/sign-in?redirect=/admin/settlement-workflow/${encodeURIComponent(periodKey)}/files`);
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

    const currentPeriodInfo = getPeriodByKey(periodKey);
    if (!isPending && session && currentPeriodInfo) {
      fetchSuppliers(currentPeriodInfo.type);
    }
  }, [session, isPending, router, userRole, periodKey, fetchSuppliers]);

  const handleSendRequest = async (supplier: SupplierWithFileStatus) => {
    if (!supplier.email) {
      toast.error("לספק זה לא מוגדר אימייל");
      return;
    }

    setSendingRequests(prev => new Set(prev).add(supplier.id));

    try {
      const response = await fetch("/api/file-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entityType: "supplier",
          entityId: supplier.id,
          documentType: `דוח ${getPeriodTypeLabel(periodInfo?.type || "quarterly")} - ${periodInfo?.nameHe}`,
          recipientEmail: supplier.email,
          recipientName: supplier.contactName || supplier.name,
          sendImmediately: true,
          dueDate: periodInfo?.dueDate?.toISOString().split("T")[0],
          metadata: {
            periodKey,
            periodType: periodInfo?.type,
          },
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to send request");
      }

      toast.success(`בקשה נשלחה ל${supplier.name}`);
      if (periodInfo) {
        fetchSuppliers(periodInfo.type);
      }
    } catch (error) {
      console.error("Error sending request:", error);
      toast.error(error instanceof Error ? error.message : "שגיאה בשליחת הבקשה");
    } finally {
      setSendingRequests(prev => {
        const next = new Set(prev);
        next.delete(supplier.id);
        return next;
      });
    }
  };

  const handleSendAllRequests = async () => {
    const suppliersToSend = suppliers.filter(s => s.email && !s.fileRequest);
    if (suppliersToSend.length === 0) {
      toast.info("כל הבקשות כבר נשלחו");
      return;
    }

    for (const supplier of suppliersToSend) {
      await handleSendRequest(supplier);
    }
  };

  const handleCopyUploadLink = (url: string) => {
    navigator.clipboard.writeText(url);
    toast.success("קישור הועתק ללוח");
  };

  const handleManualUpload = async () => {
    if (!uploadFile || !uploadDialog.supplier) return;

    setIsUploading(true);
    try {
      // Create form data
      const formData = new FormData();
      formData.append("file", uploadFile);
      formData.append("supplierId", uploadDialog.supplier.id);
      formData.append("periodKey", periodKey);
      formData.append("periodType", periodInfo?.type || "quarterly");

      // TODO: Implement actual upload endpoint
      // For now, just simulate success
      await new Promise(resolve => setTimeout(resolve, 1000));

      toast.success(`קובץ הועלה עבור ${uploadDialog.supplier.name}`);
      setUploadDialog({ open: false, supplier: null });
      setUploadFile(null);
      if (periodInfo) {
        fetchSuppliers(periodInfo.type);
      }
    } catch (error) {
      console.error("Error uploading file:", error);
      toast.error("שגיאה בהעלאת הקובץ");
    } finally {
      setIsUploading(false);
    }
  };

  const formatDate = (dateString: string | null) => {
    if (!dateString) return "-";
    return new Date(dateString).toLocaleDateString("he-IL", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
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

  // Calculate stats
  const stats = {
    total: suppliers.length,
    notSent: suppliers.filter(s => !s.fileRequest).length,
    sent: suppliers.filter(s => s.fileRequest?.status === "sent").length,
    submitted: suppliers.filter(s => s.fileRequest?.status === "submitted").length,
    noEmail: suppliers.filter(s => !s.email).length,
  };

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
              <h1 className="text-2xl font-bold">ניהול קבצים</h1>
              <Badge variant="outline">{periodInfo.nameHe}</Badge>
            </div>
            <p className="text-muted-foreground text-sm">
              {periodInfo.startDate?.toLocaleDateString("he-IL", { day: "numeric", month: "short", year: "numeric" })} - {periodInfo.endDate?.toLocaleDateString("he-IL", { day: "numeric", month: "short", year: "numeric" })}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => periodInfo && fetchSuppliers(periodInfo.type)}>
            <RefreshCw className="me-2 h-4 w-4" />
            רענון
          </Button>
          <Button onClick={handleSendAllRequests} disabled={stats.notSent === 0}>
            <Send className="me-2 h-4 w-4" />
            שלח לכולם ({stats.notSent})
          </Button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid gap-4 md:grid-cols-4 mb-6">
        <Card>
          <CardContent className="pt-6">
            <div className="text-2xl font-bold">{stats.total}</div>
            <p className="text-muted-foreground text-sm">סה״כ ספקים</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-2xl font-bold text-amber-600">{stats.notSent}</div>
            <p className="text-muted-foreground text-sm">ממתינים לשליחה</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-2xl font-bold text-blue-600">{stats.sent}</div>
            <p className="text-muted-foreground text-sm">נשלחו</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-2xl font-bold text-green-600">{stats.submitted}</div>
            <p className="text-muted-foreground text-sm">התקבלו</p>
          </CardContent>
        </Card>
      </div>

      {/* Suppliers Table */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            סטטוס קבצים לפי ספק
          </CardTitle>
          <CardDescription>
            {stats.submitted} מתוך {stats.total} קבצים התקבלו
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-right">ספק</TableHead>
                <TableHead className="text-right">אימייל</TableHead>
                <TableHead className="text-right">סטטוס</TableHead>
                <TableHead className="text-right">נשלח</TableHead>
                <TableHead className="text-right">התקבל</TableHead>
                <TableHead className="text-right">קבצים</TableHead>
                <TableHead className="text-right">פעולות</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {suppliers.map((supplier) => {
                const status = supplier.fileRequest?.status || "not_sent";
                const statusInfo = fileStatusConfig[status];
                const isSending = sendingRequests.has(supplier.id);

                return (
                  <TableRow key={supplier.id}>
                    <TableCell className="font-medium">{supplier.name}</TableCell>
                    <TableCell>
                      {supplier.email || (
                        <span className="text-muted-foreground text-sm">לא מוגדר</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant={statusInfo.variant} className="flex items-center gap-1 w-fit">
                        {statusInfo.icon}
                        {statusInfo.label}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {formatDate(supplier.fileRequest?.sentAt || null)}
                    </TableCell>
                    <TableCell>
                      {formatDate(supplier.fileRequest?.submittedAt || null)}
                    </TableCell>
                    <TableCell>
                      {supplier.fileRequest?.filesUploaded || 0}
                    </TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="sm">
                            <MoreVertical className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {!supplier.fileRequest && supplier.email && (
                            <DropdownMenuItem
                              onClick={() => handleSendRequest(supplier)}
                              disabled={isSending}
                            >
                              {isSending ? (
                                <Loader2 className="me-2 h-4 w-4 animate-spin" />
                              ) : (
                                <Send className="me-2 h-4 w-4" />
                              )}
                              שלח בקשה
                            </DropdownMenuItem>
                          )}
                          {supplier.fileRequest?.uploadUrl && (
                            <>
                              <DropdownMenuItem
                                onClick={() => handleCopyUploadLink(supplier.fileRequest!.uploadUrl!)}
                              >
                                <Copy className="me-2 h-4 w-4" />
                                העתק קישור
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={() => window.open(supplier.fileRequest!.uploadUrl!, "_blank")}
                              >
                                <ExternalLink className="me-2 h-4 w-4" />
                                פתח קישור
                              </DropdownMenuItem>
                            </>
                          )}
                          <DropdownMenuItem
                            onClick={() => setUploadDialog({ open: true, supplier })}
                          >
                            <FileUp className="me-2 h-4 w-4" />
                            העלאה ידנית
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>

          {suppliers.length === 0 && (
            <div className="text-center py-8 text-muted-foreground">
              אין ספקים עם תדירות {getPeriodTypeLabel(periodInfo.type)}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Manual Upload Dialog */}
      <Dialog open={uploadDialog.open} onOpenChange={(open) => setUploadDialog({ open, supplier: null })}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>העלאה ידנית</DialogTitle>
            <DialogDescription>
              העלאת קובץ עבור {uploadDialog.supplier?.name}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="file">בחר קובץ</Label>
              <Input
                id="file"
                type="file"
                accept=".xlsx,.xls,.csv"
                onChange={(e) => setUploadFile(e.target.files?.[0] || null)}
              />
            </div>
            {uploadFile && (
              <p className="text-sm text-muted-foreground">
                נבחר: {uploadFile.name} ({(uploadFile.size / 1024).toFixed(1)} KB)
              </p>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setUploadDialog({ open: false, supplier: null })}
            >
              ביטול
            </Button>
            <Button
              onClick={handleManualUpload}
              disabled={!uploadFile || isUploading}
            >
              {isUploading ? (
                <>
                  <Loader2 className="me-2 h-4 w-4 animate-spin" />
                  מעלה...
                </>
              ) : (
                <>
                  <Upload className="me-2 h-4 w-4" />
                  העלאה
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
