"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
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
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Building2,
  Users,
  Phone,
  Mail,
  MapPin,
  Calendar,
  FileText,
  UserCircle,
  Tag,
  History,
  ArrowRight,
  Bell,
  ShoppingCart,
  Loader2,
  Clock,
  RefreshCw,
  Percent,
  Send,
  BellOff,
  ExternalLink,
} from "lucide-react";
import type { FranchiseeStatus, Document, FranchiseeReminderType, ReminderStatus, Contact } from "@/db/schema";
import type { FranchiseeWithBrandAndContacts } from "@/data-access/franchisees";
import { DocumentManager } from "@/components/document-manager";
import { formatCurrency } from "@/lib/translations";

// Document type with uploader info
interface DocumentWithUploader extends Document {
  uploaderName?: string | null;
  uploaderEmail?: string | null;
}

// Status history entry type
interface StatusHistoryEntry {
  id: string;
  franchiseeId: string;
  previousStatus: FranchiseeStatus | null;
  newStatus: FranchiseeStatus;
  effectiveDate: string;
  reason: string | null;
  notes: string | null;
  createdAt: string;
  createdBy: string | null;
  createdByUser: { name: string; email: string } | null;
}

// Reminder type
interface FranchiseeReminderWithFranchisee {
  id: string;
  franchiseeId: string;
  title: string;
  description: string | null;
  reminderType: FranchiseeReminderType;
  reminderDate: string;
  daysBeforeNotification: number;
  recipients: string[];
  status: ReminderStatus;
  notificationSentAt: string | null;
  createdAt: string;
}

// Purchase history types
interface SupplierPurchase {
  supplierId: string;
  supplierName: string;
  supplierCode: string;
  purchaseCount: number;
  totalGrossAmount: number;
  totalNetAmount: number;
  totalCommissionAmount: number;
  avgCommissionRate: number;
}

interface PurchaseSummary {
  totalSuppliers: number;
  totalPurchases: number;
  totalGrossAmount: number;
  totalNetAmount: number;
  totalCommissionAmount: number;
  avgCommissionRate: number;
  periodRange: {
    startDate: string | null;
    endDate: string | null;
  };
}

// Status badge variant mapping
const statusVariants: Record<
  FranchiseeStatus,
  "success" | "secondary" | "warning" | "destructive" | "info"
> = {
  active: "success",
  inactive: "secondary",
  pending: "warning",
  suspended: "destructive",
  terminated: "destructive",
};

// Status labels in Hebrew
const statusLabels: Record<FranchiseeStatus, string> = {
  active: "פעיל",
  inactive: "לא פעיל",
  pending: "ממתין",
  suspended: "מושעה",
  terminated: "סיום",
};

// Reminder status colors
const reminderStatusColors: Record<ReminderStatus, "default" | "success" | "secondary" | "destructive"> = {
  pending: "default",
  sent: "success",
  acknowledged: "success",
  dismissed: "secondary",
};

const reminderStatusLabels: Record<ReminderStatus, string> = {
  pending: "ממתין",
  sent: "נשלח",
  acknowledged: "אושר",
  dismissed: "נדחה",
};

const reminderTypeLabels: Record<FranchiseeReminderType, string> = {
  lease_option: "אופציית שכירות",
  franchise_agreement: "הסכם זכיינות",
  custom: "מותאם אישית",
};


// Format percentage
const formatPercent = (rate: number): string => {
  return `${rate.toFixed(2)}%`;
};

interface FranchiseeDetailCardProps {
  franchisee: FranchiseeWithBrandAndContacts;
  isOpen: boolean;
  onClose: () => void;
  userRole?: string;
  // Optional callbacks for actions
  onEdit?: (franchisee: FranchiseeWithBrandAndContacts) => void;
  onStatusChange?: (franchisee: FranchiseeWithBrandAndContacts, status: FranchiseeStatus) => void;
}

export function FranchiseeDetailCard({
  franchisee,
  isOpen,
  onClose,
  userRole,
  onEdit,
  onStatusChange,
}: FranchiseeDetailCardProps) {
  const [activeTab, setActiveTab] = useState("overview");

  // Documents state
  const [documents, setDocuments] = useState<DocumentWithUploader[]>([]);
  const [isLoadingDocuments, setIsLoadingDocuments] = useState(false);
  const [documentsLoaded, setDocumentsLoaded] = useState(false);

  // Status history state
  const [statusHistory, setStatusHistory] = useState<StatusHistoryEntry[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [historyLoaded, setHistoryLoaded] = useState(false);

  // Reminders state
  const [reminders, setReminders] = useState<FranchiseeReminderWithFranchisee[]>([]);
  const [isLoadingReminders, setIsLoadingReminders] = useState(false);
  const [remindersLoaded, setRemindersLoaded] = useState(false);

  // Purchase history state
  const [purchaseSummary, setPurchaseSummary] = useState<PurchaseSummary | null>(null);
  const [purchasesBySupplier, setPurchasesBySupplier] = useState<SupplierPurchase[]>([]);
  const [isLoadingPurchases, setIsLoadingPurchases] = useState(false);
  const [purchasesLoaded, setPurchasesLoaded] = useState(false);

  // Reset state when dialog closes or franchisee changes
  useEffect(() => {
    if (!isOpen) {
      setActiveTab("overview");
      setDocuments([]);
      setDocumentsLoaded(false);
      setStatusHistory([]);
      setHistoryLoaded(false);
      setReminders([]);
      setRemindersLoaded(false);
      setPurchaseSummary(null);
      setPurchasesBySupplier([]);
      setPurchasesLoaded(false);
    }
  }, [isOpen, franchisee.id]);

  // Fetch documents when tab is selected
  const fetchDocuments = useCallback(async () => {
    if (documentsLoaded) return;

    try {
      setIsLoadingDocuments(true);
      const response = await fetch(`/api/documents/franchisee/${franchisee.id}`);
      if (!response.ok) throw new Error("Failed to fetch documents");
      const data = await response.json();
      setDocuments(data.documents || []);
      setDocumentsLoaded(true);
    } catch (error) {
      console.error("Error fetching documents:", error);
    } finally {
      setIsLoadingDocuments(false);
    }
  }, [franchisee.id, documentsLoaded]);

  // Fetch status history when tab is selected
  const fetchStatusHistory = useCallback(async () => {
    if (historyLoaded) return;

    try {
      setIsLoadingHistory(true);
      const response = await fetch(`/api/franchisees/${franchisee.id}/status-history`);
      if (!response.ok) throw new Error("Failed to fetch status history");
      const data = await response.json();
      setStatusHistory(data.history || []);
      setHistoryLoaded(true);
    } catch (error) {
      console.error("Error fetching status history:", error);
    } finally {
      setIsLoadingHistory(false);
    }
  }, [franchisee.id, historyLoaded]);

  // Fetch reminders when tab is selected
  const fetchReminders = useCallback(async () => {
    if (remindersLoaded) return;

    try {
      setIsLoadingReminders(true);
      const response = await fetch(`/api/franchisee-reminders?franchiseeId=${franchisee.id}`);
      if (!response.ok) throw new Error("Failed to fetch reminders");
      const data = await response.json();
      setReminders(data.reminders || []);
      setRemindersLoaded(true);
    } catch (error) {
      console.error("Error fetching reminders:", error);
    } finally {
      setIsLoadingReminders(false);
    }
  }, [franchisee.id, remindersLoaded]);

  // Fetch purchase history when tab is selected
  const fetchPurchaseHistory = useCallback(async () => {
    if (purchasesLoaded) return;

    try {
      setIsLoadingPurchases(true);
      const response = await fetch(`/api/commissions/franchisee/${franchisee.id}`);
      if (!response.ok) throw new Error("Failed to fetch purchase history");
      const data = await response.json();
      if (data.report) {
        setPurchaseSummary(data.report.summary);
        setPurchasesBySupplier(data.report.bySupplier || []);
      }
      setPurchasesLoaded(true);
    } catch (error) {
      console.error("Error fetching purchase history:", error);
    } finally {
      setIsLoadingPurchases(false);
    }
  }, [franchisee.id, purchasesLoaded]);

  // Load data when tab changes
  useEffect(() => {
    if (!isOpen) return;

    switch (activeTab) {
      case "documents":
        fetchDocuments();
        break;
      case "history":
        fetchStatusHistory();
        break;
      case "reminders":
        fetchReminders();
        break;
      case "purchases":
        fetchPurchaseHistory();
        break;
    }
  }, [activeTab, isOpen, fetchDocuments, fetchStatusHistory, fetchReminders, fetchPurchaseHistory]);

  const handleDocumentsChange = (newDocuments: DocumentWithUploader[]) => {
    setDocuments(newDocuments);
  };

  const formatDate = (dateString: string | Date | null | undefined) => {
    if (!dateString) return "—";
    const date = dateString instanceof Date ? dateString : new Date(dateString);
    return date.toLocaleDateString("he-IL");
  };

  const formatDateTime = (dateString: string) => {
    return new Date(dateString).toLocaleDateString("he-IL", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden flex flex-col" data-testid="franchisee-detail-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            <Building2 className="h-6 w-6" />
            <span>{franchisee.name}</span>
            <Badge variant={statusVariants[franchisee.status]}>
              {statusLabels[franchisee.status]}
            </Badge>
            {franchisee.brand && (
              <Badge variant="outline">{franchisee.brand.nameHe}</Badge>
            )}
          </DialogTitle>
          <DialogDescription>
            קוד: {franchisee.code}
            {franchisee.companyId && ` | מספר חברה: ${franchisee.companyId}`}
          </DialogDescription>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col overflow-hidden">
          <TabsList className="grid w-full grid-cols-6" data-testid="franchisee-detail-tabs">
            <TabsTrigger value="overview" className="flex items-center gap-1.5">
              <Building2 className="h-4 w-4" />
              <span className="hidden sm:inline">סקירה</span>
            </TabsTrigger>
            <TabsTrigger value="contacts" className="flex items-center gap-1.5">
              <Users className="h-4 w-4" />
              <span className="hidden sm:inline">אנשי קשר</span>
            </TabsTrigger>
            <TabsTrigger value="documents" className="flex items-center gap-1.5">
              <FileText className="h-4 w-4" />
              <span className="hidden sm:inline">מסמכים</span>
              {documentsLoaded && documents.length > 0 && (
                <Badge variant="secondary" className="ml-1 px-1 py-0 text-xs">
                  {documents.length}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="reminders" className="flex items-center gap-1.5">
              <Bell className="h-4 w-4" />
              <span className="hidden sm:inline">תזכורות</span>
              {remindersLoaded && reminders.length > 0 && (
                <Badge variant="secondary" className="ml-1 px-1 py-0 text-xs">
                  {reminders.length}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="purchases" className="flex items-center gap-1.5">
              <ShoppingCart className="h-4 w-4" />
              <span className="hidden sm:inline">רכישות</span>
            </TabsTrigger>
            <TabsTrigger value="history" className="flex items-center gap-1.5">
              <History className="h-4 w-4" />
              <span className="hidden sm:inline">היסטוריה</span>
              {historyLoaded && statusHistory.length > 0 && (
                <Badge variant="secondary" className="ml-1 px-1 py-0 text-xs">
                  {statusHistory.length}
                </Badge>
              )}
            </TabsTrigger>
          </TabsList>

          <div className="flex-1 overflow-y-auto mt-4" dir="rtl">
            {/* Overview Tab */}
            <TabsContent value="overview" className="mt-0 space-y-4" data-testid="overview-tab-content">
              {/* Basic Info */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Building2 className="h-4 w-4" />
                    פרטים בסיסיים
                  </CardTitle>
                </CardHeader>
                <CardContent className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
                  <div>
                    <p className="text-muted-foreground">שם</p>
                    <p className="font-medium">{franchisee.name}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">קוד</p>
                    <p className="font-medium font-mono">{franchisee.code}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">מותג</p>
                    <p className="font-medium">{franchisee.brand?.nameHe || "—"}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">סטטוס</p>
                    <Badge variant={statusVariants[franchisee.status]}>
                      {statusLabels[franchisee.status]}
                    </Badge>
                  </div>
                  <div>
                    <p className="text-muted-foreground">מספר חברה</p>
                    <p className="font-medium">{franchisee.companyId || "—"}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">פעיל</p>
                    <p className="font-medium">{franchisee.isActive ? "כן" : "לא"}</p>
                  </div>
                </CardContent>
              </Card>

              {/* Address */}
              {(franchisee.address || franchisee.city || franchisee.country) && (
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base flex items-center gap-2">
                      <MapPin className="h-4 w-4" />
                      כתובת
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="text-sm">
                    <p>
                      {[
                        franchisee.address,
                        franchisee.city,
                        franchisee.state,
                        franchisee.postalCode,
                        franchisee.country,
                      ]
                        .filter(Boolean)
                        .join(", ") || "—"}
                    </p>
                  </CardContent>
                </Card>
              )}

              {/* Aliases */}
              {franchisee.aliases && franchisee.aliases.length > 0 && (
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base flex items-center gap-2">
                      <Tag className="h-4 w-4" />
                      כינויים
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="flex flex-wrap gap-2">
                      {franchisee.aliases.map((alias, idx) => (
                        <Badge key={`${alias}-${idx}`} variant="outline">
                          {alias}
                        </Badge>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Important Dates */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Calendar className="h-4 w-4" />
                    תאריכים חשובים
                  </CardTitle>
                </CardHeader>
                <CardContent className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
                  <div>
                    <p className="text-muted-foreground">תאריך פתיחה</p>
                    <p className="font-medium">{formatDate(franchisee.openingDate)}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">סיום אופציה 1</p>
                    <p className="font-medium">{formatDate(franchisee.leaseOption1End)}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">סיום אופציה 2</p>
                    <p className="font-medium">{formatDate(franchisee.leaseOption2End)}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">סיום אופציה 3</p>
                    <p className="font-medium">{formatDate(franchisee.leaseOption3End)}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">סיום הסכם זכיינות</p>
                    <p className="font-medium">{formatDate(franchisee.franchiseAgreementEnd)}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">נוצר</p>
                    <p className="font-medium">{formatDate(franchisee.createdAt)}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">עודכן</p>
                    <p className="font-medium">{formatDate(franchisee.updatedAt)}</p>
                  </div>
                </CardContent>
              </Card>

              {/* Notes */}
              {franchisee.notes && (
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base flex items-center gap-2">
                      <FileText className="h-4 w-4" />
                      הערות
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm whitespace-pre-wrap">{franchisee.notes}</p>
                  </CardContent>
                </Card>
              )}
            </TabsContent>

            {/* Contacts & Owners Tab */}
            <TabsContent value="contacts" className="mt-0 space-y-4" data-testid="contacts-tab-content">
              {/* Primary Contact */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <UserCircle className="h-4 w-4" />
                    איש קשר ראשי
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {franchisee.primaryContactName || franchisee.primaryContactPhone || franchisee.primaryContactEmail ? (
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                      <div>
                        <p className="text-muted-foreground">שם</p>
                        <p className="font-medium">{franchisee.primaryContactName || "—"}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">טלפון</p>
                        <p className="font-medium flex items-center gap-1">
                          {franchisee.primaryContactPhone ? (
                            <>
                              <Phone className="h-3 w-3" />
                              <a href={`tel:${franchisee.primaryContactPhone}`} className="hover:underline">
                                {franchisee.primaryContactPhone}
                              </a>
                            </>
                          ) : "—"}
                        </p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">אימייל</p>
                        <p className="font-medium flex items-center gap-1">
                          {franchisee.primaryContactEmail ? (
                            <>
                              <Mail className="h-3 w-3" />
                              <a href={`mailto:${franchisee.primaryContactEmail}`} className="hover:underline">
                                {franchisee.primaryContactEmail}
                              </a>
                            </>
                          ) : "—"}
                        </p>
                      </div>
                    </div>
                  ) : (
                    <p className="text-muted-foreground text-sm">לא הוגדר איש קשר ראשי</p>
                  )}
                </CardContent>
              </Card>

              {/* Contacts */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Users className="h-4 w-4" />
                    אנשי קשר
                    {franchisee.contacts && franchisee.contacts.length > 0 && (
                      <Badge variant="secondary" className="mr-2">
                        {franchisee.contacts.length}
                      </Badge>
                    )}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {franchisee.contacts && franchisee.contacts.length > 0 ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {franchisee.contacts.map((contact) => (
                        <div
                          key={contact.id}
                          className="p-3 border rounded-lg bg-muted/30 space-y-2"
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-medium flex items-center gap-2">
                              {contact.name}
                              {contact.role === "owner" && (
                                <Badge variant="outline" className="text-xs">בעלים</Badge>
                              )}
                              {contact.isPrimary && (
                                <Badge variant="secondary" className="text-xs">ראשי</Badge>
                              )}
                            </span>
                          </div>
                          <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                            {contact.phone && (
                              <span className="flex items-center gap-1">
                                <Phone className="h-3 w-3" />
                                <a href={`tel:${contact.phone}`} className="hover:underline">
                                  {contact.phone}
                                </a>
                              </span>
                            )}
                            {contact.email && (
                              <span className="flex items-center gap-1">
                                <Mail className="h-3 w-3" />
                                <a href={`mailto:${contact.email}`} className="hover:underline">
                                  {contact.email}
                                </a>
                              </span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-muted-foreground text-sm">לא הוגדרו אנשי קשר</p>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            {/* Documents Tab */}
            <TabsContent value="documents" className="mt-0" data-testid="documents-tab-content">
              {isLoadingDocuments ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <DocumentManager
                  entityType="franchisee"
                  entityId={franchisee.id}
                  entityName={franchisee.name}
                  documents={documents}
                  onDocumentsChange={handleDocumentsChange}
                  canUpload={userRole === "super_user" || userRole === "admin"}
                  canDelete={userRole === "super_user"}
                  canEdit={userRole === "super_user" || userRole === "admin"}
                />
              )}
            </TabsContent>

            {/* Reminders Tab */}
            <TabsContent value="reminders" className="mt-0 space-y-4" data-testid="reminders-tab-content">
              {isLoadingReminders ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
              ) : reminders.length === 0 ? (
                <Card>
                  <CardContent className="py-12 text-center">
                    <Bell className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                    <h3 className="text-lg font-medium mb-2">אין תזכורות</h3>
                    <p className="text-muted-foreground">
                      לא הוגדרו תזכורות לזכיין זה
                    </p>
                  </CardContent>
                </Card>
              ) : (
                <div className="space-y-3">
                  {reminders.map((reminder) => (
                    <Card key={reminder.id}>
                      <CardContent className="p-4">
                        <div className="flex items-start justify-between">
                          <div className="space-y-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <p className="font-medium">{reminder.title}</p>
                              <Badge variant={reminderStatusColors[reminder.status]}>
                                {reminderStatusLabels[reminder.status]}
                              </Badge>
                              <Badge variant="outline">
                                {reminderTypeLabels[reminder.reminderType]}
                              </Badge>
                            </div>
                            {reminder.description && (
                              <p className="text-sm text-muted-foreground">
                                {reminder.description}
                              </p>
                            )}
                            <div className="flex items-center gap-4 text-sm text-muted-foreground">
                              <span className="flex items-center gap-1">
                                <Calendar className="h-3 w-3" />
                                תאריך: {formatDate(reminder.reminderDate)}
                              </span>
                              <span className="flex items-center gap-1">
                                <Clock className="h-3 w-3" />
                                התראה: {reminder.daysBeforeNotification} ימים לפני
                              </span>
                              <span className="flex items-center gap-1">
                                <Mail className="h-3 w-3" />
                                {reminder.recipients.length} נמענים
                              </span>
                            </div>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </TabsContent>

            {/* Purchase History Tab */}
            <TabsContent value="purchases" className="mt-0 space-y-4" data-testid="purchases-tab-content">
              {isLoadingPurchases ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
              ) : !purchaseSummary ? (
                <Card>
                  <CardContent className="py-12 text-center">
                    <ShoppingCart className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                    <h3 className="text-lg font-medium mb-2">אין נתוני רכישות</h3>
                    <p className="text-muted-foreground">
                      לא נמצאו נתוני רכישות לזכיין זה
                    </p>
                  </CardContent>
                </Card>
              ) : (
                <>
                  {/* Summary Cards */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <Card>
                      <CardContent className="p-4">
                        <p className="text-sm text-muted-foreground">סה״כ רכישות</p>
                        <p className="text-xl font-bold">{formatCurrency(purchaseSummary.totalGrossAmount)}</p>
                        <p className="text-xs text-muted-foreground">{purchaseSummary.totalPurchases} רשומות</p>
                      </CardContent>
                    </Card>
                    <Card>
                      <CardContent className="p-4">
                        <p className="text-sm text-muted-foreground">סכום לפני מע״מ</p>
                        <p className="text-xl font-bold">{formatCurrency(purchaseSummary.totalNetAmount)}</p>
                      </CardContent>
                    </Card>
                    <Card>
                      <CardContent className="p-4">
                        <p className="text-sm text-muted-foreground">סה״כ עמלות</p>
                        <p className="text-xl font-bold">{formatCurrency(purchaseSummary.totalCommissionAmount)}</p>
                      </CardContent>
                    </Card>
                    <Card>
                      <CardContent className="p-4">
                        <p className="text-sm text-muted-foreground">ספקים</p>
                        <p className="text-xl font-bold">{purchaseSummary.totalSuppliers}</p>
                      </CardContent>
                    </Card>
                  </div>

                  {/* Purchases by Supplier Table */}
                  {purchasesBySupplier.length > 0 && (
                    <Card>
                      <CardHeader className="pb-3">
                        <CardTitle className="text-base">רכישות לפי ספק</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>ספק</TableHead>
                              <TableHead>קוד</TableHead>
                              <TableHead>רכישות</TableHead>
                              <TableHead>סכום כולל מע״מ</TableHead>
                              <TableHead>עמלה</TableHead>
                              <TableHead>% עמלה</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {purchasesBySupplier.slice(0, 10).map((supplier) => (
                              <TableRow key={supplier.supplierId}>
                                <TableCell className="font-medium">{supplier.supplierName}</TableCell>
                                <TableCell className="font-mono text-xs">{supplier.supplierCode}</TableCell>
                                <TableCell>{supplier.purchaseCount}</TableCell>
                                <TableCell>{formatCurrency(supplier.totalGrossAmount)}</TableCell>
                                <TableCell>{formatCurrency(supplier.totalCommissionAmount)}</TableCell>
                                <TableCell>{formatPercent(supplier.avgCommissionRate)}</TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                        {purchasesBySupplier.length > 10 && (
                          <p className="text-center text-sm text-muted-foreground mt-4">
                            מציג 10 מתוך {purchasesBySupplier.length} ספקים
                          </p>
                        )}
                      </CardContent>
                    </Card>
                  )}
                </>
              )}
            </TabsContent>

            {/* Status History Tab */}
            <TabsContent value="history" className="mt-0" data-testid="history-tab-content">
              {isLoadingHistory ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
              ) : statusHistory.length === 0 ? (
                <Card>
                  <CardContent className="py-12 text-center">
                    <History className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                    <h3 className="text-lg font-medium mb-2">אין היסטוריית סטטוס</h3>
                    <p className="text-muted-foreground">
                      עדיין לא נרשמו שינויי סטטוס לזכיין זה
                    </p>
                  </CardContent>
                </Card>
              ) : (
                <div className="space-y-3">
                  {statusHistory.map((entry) => (
                    <Card key={entry.id}>
                      <CardContent className="p-4 space-y-2">
                        <div className="flex items-center gap-2 flex-wrap">
                          {entry.previousStatus ? (
                            <>
                              <Badge
                                variant={statusVariants[entry.previousStatus]}
                                className="text-xs"
                              >
                                {statusLabels[entry.previousStatus]}
                              </Badge>
                              <ArrowRight className="h-3 w-3 text-muted-foreground rotate-180" />
                            </>
                          ) : (
                            <span className="text-xs text-muted-foreground">
                              ראשוני:
                            </span>
                          )}
                          <Badge
                            variant={statusVariants[entry.newStatus]}
                            className="text-xs"
                          >
                            {statusLabels[entry.newStatus]}
                          </Badge>
                        </div>

                        {entry.reason && (
                          <div className="text-sm text-muted-foreground">
                            <span className="font-medium">סיבה: </span>
                            {entry.reason}
                          </div>
                        )}

                        {entry.notes && (
                          <div className="text-sm text-muted-foreground">
                            <span className="font-medium">הערות: </span>
                            {entry.notes}
                          </div>
                        )}

                        <div className="flex items-center gap-4 text-xs text-muted-foreground pt-1 border-t border-muted">
                          <span>{formatDateTime(entry.createdAt)}</span>
                          {entry.createdByUser && (
                            <span className="flex items-center gap-1">
                              <UserCircle className="h-3 w-3" />
                              {entry.createdByUser.name}
                            </span>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </TabsContent>
          </div>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
