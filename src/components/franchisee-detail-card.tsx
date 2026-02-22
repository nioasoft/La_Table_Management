"use client";

import { useState, useEffect, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
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
  Coins,
  X,
  Plus,
  Pencil,
  Trash2,
  Save,
  ChevronDown,
} from "lucide-react";
import type { FranchiseeStatus, Document, FranchiseeReminderType, ReminderStatus, Contact, ContactRole } from "@/db/schema";
import type { FranchiseeWithBrandAndContacts } from "@/data-access/franchisees";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
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
  handled: "success",
};

const reminderStatusLabels: Record<ReminderStatus, string> = {
  pending: "ממתין",
  sent: "נשלח",
  acknowledged: "אושר",
  dismissed: "נדחה",
  handled: "טופל",
};

const reminderTypeLabels: Record<FranchiseeReminderType, string> = {
  lease_option: "אופציית שכירות",
  franchise_agreement: "הסכם זכיינות",
  custom: "מותאם אישית",
};


// Contact role labels in Hebrew
const contactRoleLabels: Record<ContactRole, string> = {
  owner: "בעלים",
  manager: "מנהל",
  accountant: "מנהלת חשבונות",
  chef: "שף",
  staff: "עובד מטה",
  operations: "תפעול",
  marketing: "שיווק",
  other: "אחר",
};

// Contact form data
interface ContactFormData {
  name: string;
  phone: string;
  email: string;
  role: ContactRole;
  notes: string;
  ownershipPercentage: string;
}

const emptyContactForm: ContactFormData = {
  name: "",
  phone: "",
  email: "",
  role: "accountant",
  notes: "",
  ownershipPercentage: "",
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
  const queryClient = useQueryClient();
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

  // Revenue codes state
  const [revenueCodes, setRevenueCodes] = useState<Array<{ accountCode: string; accountName: string | null }>>([]);
  const [isLoadingRevenueCodes, setIsLoadingRevenueCodes] = useState(false);
  const [revenueCodesLoaded, setRevenueCodesLoaded] = useState(false);
  const [removingRevenueCode, setRemovingRevenueCode] = useState<string | null>(null);

  // Contact form state
  const [showContactForm, setShowContactForm] = useState(false);
  const [contactsOpen, setContactsOpen] = useState(false);
  const [editingContactId, setEditingContactId] = useState<string | null>(null);
  const [contactForm, setContactForm] = useState<ContactFormData>(emptyContactForm);
  const [isContactSubmitting, setIsContactSubmitting] = useState(false);
  const [deletingContactId, setDeletingContactId] = useState<string | null>(null);

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
      setRevenueCodes([]);
      setRevenueCodesLoaded(false);
      setShowContactForm(false);
      setEditingContactId(null);
      setContactForm(emptyContactForm);
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

  // Fetch revenue codes when overview tab is shown
  const fetchRevenueCodes = useCallback(async () => {
    if (revenueCodesLoaded) return;

    try {
      setIsLoadingRevenueCodes(true);
      const response = await fetch(`/api/franchisees/${franchisee.id}/revenue-codes?details=true`);
      if (!response.ok) throw new Error("Failed to fetch revenue codes");
      const data = await response.json();
      setRevenueCodes(data.details || []);
      setRevenueCodesLoaded(true);
    } catch (error) {
      console.error("Error fetching revenue codes:", error);
    } finally {
      setIsLoadingRevenueCodes(false);
    }
  }, [franchisee.id, revenueCodesLoaded]);

  // Remove a revenue code
  const handleRemoveRevenueCode = useCallback(async (accountCode: string) => {
    setRemovingRevenueCode(accountCode);
    try {
      const response = await fetch(`/api/franchisees/${franchisee.id}/revenue-codes`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountCode }),
      });
      if (!response.ok) throw new Error("Failed to remove revenue code");
      setRevenueCodes((prev) => prev.filter((c) => c.accountCode !== accountCode));
    } catch (error) {
      console.error("Error removing revenue code:", error);
    } finally {
      setRemovingRevenueCode(null);
    }
  }, [franchisee.id]);

  // Contact CRUD handlers
  const handleAddContact = (presetRole?: ContactRole) => {
    setEditingContactId(null);
    setContactForm({
      ...emptyContactForm,
      role: presetRole || "accountant",
    });
    setShowContactForm(true);
  };

  const handleEditContact = (c: Contact) => {
    setEditingContactId(c.id);
    setContactForm({
      name: c.name,
      phone: c.phone || "",
      email: c.email || "",
      role: c.role,
      notes: c.notes || "",
      ownershipPercentage: c.ownershipPercentage || "",
    });
    setShowContactForm(true);
  };

  const handleCancelContactForm = () => {
    setShowContactForm(false);
    setEditingContactId(null);
    setContactForm(emptyContactForm);
  };

  const handleSaveContact = async () => {
    if (!contactForm.name.trim()) return;

    setIsContactSubmitting(true);
    try {
      if (editingContactId) {
        const response = await fetch(
          `/api/franchisees/${franchisee.id}/contacts/${editingContactId}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(contactForm),
          }
        );
        if (!response.ok) throw new Error("Failed to update contact");
      } else {
        const response = await fetch(
          `/api/franchisees/${franchisee.id}/contacts`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(contactForm),
          }
        );
        if (!response.ok) throw new Error("Failed to create contact");
      }

      // Refresh franchisee data
      queryClient.invalidateQueries({ queryKey: ["franchisees"] });
      handleCancelContactForm();
    } catch (error) {
      console.error("Error saving contact:", error);
    } finally {
      setIsContactSubmitting(false);
    }
  };

  const handleDeleteContact = async (contactId: string) => {
    setDeletingContactId(contactId);
    try {
      const response = await fetch(
        `/api/franchisees/${franchisee.id}/contacts/${contactId}`,
        { method: "DELETE" }
      );
      if (!response.ok) throw new Error("Failed to delete contact");

      queryClient.invalidateQueries({ queryKey: ["franchisees"] });
    } catch (error) {
      console.error("Error deleting contact:", error);
    } finally {
      setDeletingContactId(null);
    }
  };

  // Load data when tab changes
  useEffect(() => {
    if (!isOpen) return;

    switch (activeTab) {
      case "overview":
        fetchRevenueCodes();
        break;
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
  }, [activeTab, isOpen, fetchRevenueCodes, fetchDocuments, fetchStatusHistory, fetchReminders, fetchPurchaseHistory]);

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

              {/* Revenue Codes */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Coins className="h-4 w-4" />
                    חשבונות הכנסות מזוהים
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {isLoadingRevenueCodes ? (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      טוען...
                    </div>
                  ) : revenueCodes.length === 0 ? (
                    <p className="text-muted-foreground text-sm">לא הוגדרו חשבונות הכנסות</p>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {revenueCodes.map((code) => (
                        <Badge
                          key={code.accountCode}
                          variant="outline"
                          className="gap-1.5 pe-1"
                        >
                          <span className="font-mono">{code.accountCode}</span>
                          {code.accountName && (
                            <span className="text-muted-foreground">- {code.accountName}</span>
                          )}
                          {(userRole === "super_user" || userRole === "admin") && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-4 w-4 p-0 ms-1 hover:bg-destructive/20 hover:text-destructive rounded-full"
                              onClick={() => handleRemoveRevenueCode(code.accountCode)}
                              disabled={removingRevenueCode === code.accountCode}
                            >
                              {removingRevenueCode === code.accountCode ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              ) : (
                                <X className="h-3 w-3" />
                              )}
                            </Button>
                          )}
                        </Badge>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>

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
              {/* Unified Contacts */}
              <Card>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base flex items-center gap-2">
                      <Users className="h-4 w-4" />
                      אנשי קשר
                      {franchisee.contacts && franchisee.contacts.length > 0 && (
                        <Badge variant="secondary" className="mr-2">
                          {franchisee.contacts.length}
                        </Badge>
                      )}
                    </CardTitle>
                    {(userRole === "super_user" || userRole === "admin") && !showContactForm && (
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleAddContact("owner")}
                        >
                          <Plus className="h-4 w-4 me-1" />
                          הוספת בעלים
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleAddContact()}
                        >
                          <Plus className="h-4 w-4 me-1" />
                          הוספת איש קשר
                        </Button>
                      </div>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  {/* Contact Form (Add/Edit) */}
                  {showContactForm && (
                    <div className="p-4 border rounded-lg bg-muted/20 space-y-4">
                      <h4 className="font-medium text-sm">
                        {editingContactId
                          ? (contactForm.role === "owner" ? "עריכת בעלים" : "עריכת איש קשר")
                          : (contactForm.role === "owner" ? "הוספת בעלים" : "הוספת איש קשר חדש")
                        }
                      </h4>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div className="space-y-1.5">
                          <Label htmlFor="contact-name" className="text-xs">שם *</Label>
                          <Input
                            id="contact-name"
                            value={contactForm.name}
                            onChange={(e) =>
                              setContactForm({ ...contactForm, name: e.target.value })
                            }
                            placeholder="שם איש הקשר"
                            disabled={isContactSubmitting}
                            dir="rtl"
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label htmlFor="contact-role" className="text-xs">תפקיד</Label>
                          <Select
                            value={contactForm.role}
                            onValueChange={(value) =>
                              setContactForm({ ...contactForm, role: value as ContactRole })
                            }
                            disabled={isContactSubmitting}
                          >
                            <SelectTrigger id="contact-role">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {Object.entries(contactRoleLabels).map(([value, label]) => (
                                <SelectItem key={value} value={value}>
                                  {label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-1.5">
                          <Label htmlFor="contact-phone" className="text-xs">טלפון</Label>
                          <Input
                            id="contact-phone"
                            value={contactForm.phone}
                            onChange={(e) =>
                              setContactForm({ ...contactForm, phone: e.target.value })
                            }
                            placeholder="+972-XX-XXX-XXXX"
                            disabled={isContactSubmitting}
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label htmlFor="contact-email" className="text-xs">אימייל</Label>
                          <Input
                            id="contact-email"
                            type="email"
                            value={contactForm.email}
                            onChange={(e) =>
                              setContactForm({ ...contactForm, email: e.target.value })
                            }
                            placeholder="contact@example.com"
                            disabled={isContactSubmitting}
                          />
                        </div>
                        {contactForm.role === "owner" && (
                          <div className="space-y-1.5">
                            <Label htmlFor="contact-ownership" className="text-xs">אחוז בעלות</Label>
                            <Input
                              id="contact-ownership"
                              type="number"
                              min="0"
                              max="100"
                              value={contactForm.ownershipPercentage}
                              onChange={(e) =>
                                setContactForm({ ...contactForm, ownershipPercentage: e.target.value })
                              }
                              placeholder="0-100"
                              disabled={isContactSubmitting}
                            />
                          </div>
                        )}
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="contact-notes" className="text-xs">הערות</Label>
                        <Input
                          id="contact-notes"
                          value={contactForm.notes}
                          onChange={(e) =>
                            setContactForm({ ...contactForm, notes: e.target.value })
                          }
                          placeholder="הערות נוספות"
                          disabled={isContactSubmitting}
                          dir="rtl"
                        />
                      </div>
                      <div className="flex gap-2 justify-end">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={handleCancelContactForm}
                          disabled={isContactSubmitting}
                        >
                          ביטול
                        </Button>
                        <Button
                          size="sm"
                          onClick={handleSaveContact}
                          disabled={isContactSubmitting || !contactForm.name.trim()}
                        >
                          {isContactSubmitting ? (
                            <Loader2 className="h-4 w-4 animate-spin me-1" />
                          ) : (
                            <Save className="h-4 w-4 me-1" />
                          )}
                          {editingContactId ? "עדכון" : "שמירה"}
                        </Button>
                      </div>
                    </div>
                  )}

                  {/* Contacts List - owners first, then others */}
                  {franchisee.contacts && franchisee.contacts.length > 0 ? (
                    <Collapsible open={contactsOpen || showContactForm} onOpenChange={setContactsOpen}>
                      <CollapsibleTrigger asChild>
                        <Button variant="ghost" size="sm" className="w-full justify-between px-2 h-8 text-xs text-muted-foreground hover:text-foreground">
                          <span>{contactsOpen || showContactForm ? "הסתר אנשי קשר" : "הצג אנשי קשר"}</span>
                          <ChevronDown className={`h-4 w-4 transition-transform ${contactsOpen || showContactForm ? "rotate-180" : ""}`} />
                        </Button>
                      </CollapsibleTrigger>
                      <CollapsibleContent>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2">
                          {[...franchisee.contacts]
                            .sort((a, b) => (a.role === "owner" ? -1 : 1) - (b.role === "owner" ? -1 : 1))
                            .map((c) => (
                            <div
                              key={c.id}
                              className="p-3 border rounded-lg bg-muted/30 space-y-2"
                            >
                              <div className="flex items-center justify-between">
                                <span className="font-medium flex items-center gap-2 flex-wrap">
                                  {c.name}
                                  <Badge variant="outline" className="text-xs">
                                    {contactRoleLabels[c.role] || c.role}
                                  </Badge>
                                  {c.isPrimary && (
                                    <Badge variant="secondary" className="text-xs">ראשי</Badge>
                                  )}
                                  {c.role === "owner" && c.ownershipPercentage && (
                                    <Badge variant="secondary" className="text-xs">
                                      {c.ownershipPercentage}% בעלות
                                    </Badge>
                                  )}
                                </span>
                                {(userRole === "super_user" || userRole === "admin") && (
                                  <div className="flex items-center gap-1">
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      className="h-7 w-7 p-0"
                                      onClick={() => handleEditContact(c)}
                                      disabled={isContactSubmitting}
                                    >
                                      <Pencil className="h-3.5 w-3.5" />
                                    </Button>
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      className="h-7 w-7 p-0 hover:text-destructive"
                                      onClick={() => handleDeleteContact(c.id)}
                                      disabled={deletingContactId === c.id}
                                    >
                                      {deletingContactId === c.id ? (
                                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                      ) : (
                                        <Trash2 className="h-3.5 w-3.5" />
                                      )}
                                    </Button>
                                  </div>
                                )}
                              </div>
                              <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                                {c.phone && (
                                  <span className="flex items-center gap-1">
                                    <Phone className="h-3 w-3" />
                                    <a href={`tel:${c.phone}`} className="hover:underline">
                                      {c.phone}
                                    </a>
                                  </span>
                                )}
                                {c.email && (
                                  <span className="flex items-center gap-1">
                                    <Mail className="h-3 w-3" />
                                    <a href={`mailto:${c.email}`} className="hover:underline">
                                      {c.email}
                                    </a>
                                  </span>
                                )}
                              </div>
                              {c.notes && (
                                <p className="text-xs text-muted-foreground">{c.notes}</p>
                              )}
                            </div>
                          ))}
                        </div>
                      </CollapsibleContent>
                    </Collapsible>
                  ) : !showContactForm ? (
                    <p className="text-muted-foreground text-sm">לא הוגדרו אנשי קשר</p>
                  ) : null}
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
                  canUpload={false}
                  canDelete={false}
                  canEdit={false}
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
