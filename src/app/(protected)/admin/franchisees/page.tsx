"use client";

import { fetchWithTimeout } from "@/lib/fetch-with-timeout";
import { useState, useMemo, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
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
  Store,
  Plus,
  Pencil,
  Trash2,
  RefreshCw,
  ChevronRight,
  X,
  Check,
  Loader2,
  Building2,
  Users,
  Phone,
  Mail,
  MapPin,
  Calendar,
  FileText,
  UserCircle,
  Tag,
  ChevronDown,
  ChevronUp,
  History,
  ArrowRight,
  Eye,
  Search,
  Bell,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { Brand, FranchiseeStatus, Document, Contact, ContactRole } from "@/db/schema";
import type { FranchiseeWithBrandAndContacts } from "@/data-access/franchisees";
import Link from "next/link";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { AliasManager } from "@/components/alias-manager";
import { DocumentManager } from "@/components/document-manager";
import { ImportantDatesManager } from "@/components/important-dates-manager";
import { he } from "@/lib/translations/he";

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

// Brand stats type for sidebar
interface BrandStat {
  brandId: string;
  count: number;
  activeCount: number;
}

// Status change modal state
interface StatusChangeModal {
  isOpen: boolean;
  franchisee: FranchiseeWithBrandAndContacts | null;
  newStatus: FranchiseeStatus | null;
  reason: string;
  notes: string;
  isSubmitting: boolean;
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

// Status labels - use translations
const statusLabels: Record<FranchiseeStatus, string> = {
  active: he.admin.franchisees.statuses.active,
  inactive: he.admin.franchisees.statuses.inactive,
  pending: he.admin.franchisees.statuses.pending,
  suspended: he.admin.franchisees.statuses.suspended,
  terminated: he.admin.franchisees.statuses.terminated,
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

interface FranchiseeFormData {
  brandId: string;
  name: string;
  code: string;
  aliases: string[];
  address: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  openingDate: string;
  leaseOption1End: string;
  leaseOption2End: string;
  leaseOption3End: string;
  franchiseAgreementEnd: string;
  status: FranchiseeStatus;
  notes: string;
  hashavshevetItemKey: string;
  isActive: boolean;
  isKosher: boolean;
}

const initialFormData: FranchiseeFormData = {
  brandId: "",
  name: "",
  code: "",
  aliases: [],
  address: "",
  city: "",
  state: "",
  postalCode: "",
  country: "",
  openingDate: "",
  leaseOption1End: "",
  leaseOption2End: "",
  leaseOption3End: "",
  franchiseAgreementEnd: "",
  status: "pending",
  notes: "",
  hashavshevetItemKey: "",
  isActive: true,
  isKosher: true,
};

export default function AdminFranchiseesPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [filterBrand, setFilterBrand] = useState<string>("all");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editingFranchisee, setEditingFranchisee] =
    useState<FranchiseeWithBrandAndContacts | null>(null);
  const [formData, setFormData] =
    useState<FranchiseeFormData>(initialFormData);
  const [formError, setFormError] = useState<string | null>(null);
  const [expandedDocumentsId, setExpandedDocumentsId] = useState<string | null>(null);
  const [loadingDocumentsId, setLoadingDocumentsId] = useState<string | null>(null);
  const [franchiseeDocuments, setFranchiseeDocuments] = useState<
    Record<string, DocumentWithUploader[]>
  >({});

  // Status change modal state
  const [statusChangeModal, setStatusChangeModal] = useState<StatusChangeModal>({
    isOpen: false,
    franchisee: null,
    newStatus: null,
    reason: "",
    notes: "",
    isSubmitting: false,
  });

  // Status history state
  const [expandedHistoryId, setExpandedHistoryId] = useState<string | null>(null);
  const [loadingHistoryId, setLoadingHistoryId] = useState<string | null>(null);
  const [franchiseeHistory, setFranchiseeHistory] = useState<
    Record<string, StatusHistoryEntry[]>
  >({});

  // Edit dialog documents state
  const [editFranchiseeDocuments, setEditFranchiseeDocuments] = useState<DocumentWithUploader[]>([]);
  const [loadingEditDocs, setLoadingEditDocs] = useState(false);

  // Contact form state (for edit form)
  const [showContactFormInEdit, setShowContactFormInEdit] = useState(false);
  const [editingContactIdInEdit, setEditingContactIdInEdit] = useState<string | null>(null);
  const [contactFormInEdit, setContactFormInEdit] = useState({
    name: "",
    phone: "",
    email: "",
    role: "accountant" as ContactRole,
    notes: "",
    ownershipPercentage: "",
  });
  const [isContactSubmittingInEdit, setIsContactSubmittingInEdit] = useState(false);
  const [deletingContactIdInEdit, setDeletingContactIdInEdit] = useState<string | null>(null);
  // Pending contacts for create mode (saved after franchisee creation)
  const [pendingContacts, setPendingContacts] = useState<Array<{
    tempId: string;
    name: string;
    phone: string;
    email: string;
    role: ContactRole;
    notes: string;
    ownershipPercentage: string;
  }>>([]);

  const { data: session, isPending } = authClient.useSession();

  const userRole = session
    ? (session.user as { role?: string })?.role
    : undefined;



  // Fetch franchisees with TanStack Query
  const { data: franchiseesData, isLoading } = useQuery({
    queryKey: ["franchisees", "list", { filterBrand, filterStatus, stats: true }],
    queryFn: async () => {
      let url = "/api/franchisees?stats=true";
      if (filterBrand && filterBrand !== "all") {
        url += `&brandId=${filterBrand}`;
      }
      if (filterStatus && filterStatus !== "all") {
        url += `&filter=${filterStatus}`;
      }
      const response = await fetchWithTimeout(url);
      if (!response.ok) {
        throw new Error("Failed to fetch franchisees");
      }
      return response.json();
    },
    enabled: !isPending && !!session,
  });

  const franchisees: FranchiseeWithBrandAndContacts[] = franchiseesData?.franchisees || [];
  const stats = franchiseesData?.stats || null;

  // Fetch documents when editing a franchisee
  const editingFranchiseeId = editingFranchisee?.id;
  useEffect(() => {
    if (!editingFranchiseeId) {
      setEditFranchiseeDocuments([]);
      return;
    }
    setLoadingEditDocs(true);
    fetch(`/api/documents/franchisee/${editingFranchiseeId}`)
      .then((res) => res.json())
      .then((data) => setEditFranchiseeDocuments(data.documents || []))
      .catch(() => setEditFranchiseeDocuments([]))
      .finally(() => setLoadingEditDocs(false));
  }, [editingFranchiseeId]);

  const handleEditDocsChange = useCallback((docs: DocumentWithUploader[]) => {
    setEditFranchiseeDocuments(docs);
  }, []);

  // Keep editingFranchisee contacts in sync after contact mutations
  const editingId = editingFranchisee?.id;
  const freshFranchisee = editingId
    ? franchisees.find((f) => f.id === editingId)
    : undefined;

  // Filter franchisees by search term
  const filteredFranchisees = useMemo(() => {
    if (!searchTerm.trim()) return franchisees;
    const term = searchTerm.toLowerCase().trim();
    return franchisees.filter((f) =>
      f.name.toLowerCase().includes(term) ||
      f.code?.toLowerCase().includes(term) ||
      f.aliases?.some((a) => a.toLowerCase().includes(term)) ||
      f.contacts?.some((c) => c.name.toLowerCase().includes(term)) ||
      f.city?.toLowerCase().includes(term)
    );
  }, [franchisees, searchTerm]);

  // Fetch brands with TanStack Query
  const { data: brandsData } = useQuery({
    queryKey: ["brands", "list", { filter: "active" }],
    queryFn: async () => {
      const response = await fetchWithTimeout("/api/brands?filter=active");
      if (!response.ok) {
        throw new Error("Failed to fetch brands");
      }
      return response.json();
    },
    enabled: !isPending && !!session,
  });

  const brands: Brand[] = brandsData?.brands || [];

  // Fetch reminder counts for all franchisees
  const { data: reminderCountsData } = useQuery({
    queryKey: ["reminder-counts"],
    queryFn: async () => {
      const response = await fetchWithTimeout("/api/franchisees/important-dates/reminder-counts");
      if (!response.ok) {
        throw new Error("Failed to fetch reminder counts");
      }
      return response.json();
    },
    enabled: !isPending && !!session,
  });

  const reminderCounts: Record<string, number> = reminderCountsData?.counts || {};

  const fetchFranchiseeDocuments = async (franchiseeId: string) => {
    try {
      setLoadingDocumentsId(franchiseeId);
      const response = await fetchWithTimeout(`/api/documents/franchisee/${franchiseeId}`);
      if (!response.ok) {
        throw new Error("Failed to fetch documents");
      }
      const data = await response.json();
      setFranchiseeDocuments((prev) => ({
        ...prev,
        [franchiseeId]: data.documents || [],
      }));
    } catch (error) {
      console.error("Error fetching documents:", error);
    } finally {
      setLoadingDocumentsId(null);
    }
  };

  const toggleDocumentsExpanded = async (franchiseeId: string) => {
    if (expandedDocumentsId === franchiseeId) {
      setExpandedDocumentsId(null);
    } else {
      setExpandedDocumentsId(franchiseeId);
      // Fetch documents if not already loaded
      if (!franchiseeDocuments[franchiseeId]) {
        await fetchFranchiseeDocuments(franchiseeId);
      }
    }
  };

  const handleDocumentsChange = (franchiseeId: string, documents: DocumentWithUploader[]) => {
    setFranchiseeDocuments((prev) => ({
      ...prev,
      [franchiseeId]: documents,
    }));
  };

  // Create franchisee mutation
  const createFranchisee = useMutation({
    mutationFn: async (data: typeof formData) => {
      const response = await fetchWithTimeout("/api/franchisees", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...data,
          aliases: data.aliases.length > 0 ? data.aliases : null,
          openingDate: data.openingDate || null,
          leaseOption1End: data.leaseOption1End || null,
          leaseOption2End: data.leaseOption2End || null,
          leaseOption3End: data.leaseOption3End || null,
          franchiseAgreementEnd: data.franchiseAgreementEnd || null,
        }),
      });
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to create franchisee");
      }
      return response.json();
    },
    onSuccess: async (result) => {
      // Batch-create pending contacts for new franchisee
      const franchiseeId = result.franchisee?.id;
      if (franchiseeId && pendingContacts.length > 0) {
        for (const pc of pendingContacts) {
          try {
            await fetchWithTimeout(`/api/franchisees/${franchiseeId}/contacts`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                name: pc.name,
                phone: pc.phone || null,
                email: pc.email || null,
                role: pc.role,
                notes: pc.notes || null,
                ownershipPercentage: pc.role === "owner" && pc.ownershipPercentage
                  ? parseFloat(pc.ownershipPercentage)
                  : null,
              }),
            });
          } catch (err) {
            console.error("Error creating contact:", err);
          }
        }
      }
      queryClient.invalidateQueries({ queryKey: ["franchisees"] });
      setShowForm(false);
      setEditingFranchisee(null);
      setFormData(initialFormData);
      setPendingContacts([]);
    },
    onError: (error: Error) => {
      setFormError(error.message);
      toast.error("שגיאה ביצירת זכיין: " + error.message);
    },
  });

  // Update franchisee mutation
  const updateFranchisee = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: typeof formData }) => {
      const response = await fetchWithTimeout(`/api/franchisees/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...data,
          aliases: data.aliases.length > 0 ? data.aliases : null,
          openingDate: data.openingDate || null,
          leaseOption1End: data.leaseOption1End || null,
          leaseOption2End: data.leaseOption2End || null,
          leaseOption3End: data.leaseOption3End || null,
          franchiseAgreementEnd: data.franchiseAgreementEnd || null,
        }),
      });
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to update franchisee");
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["franchisees"] });
      setShowForm(false);
      setEditingFranchisee(null);
      setFormData(initialFormData);
    },
    onError: (error: Error) => {
      setFormError(error.message);
      toast.error("שגיאה בעדכון זכיין: " + error.message);
    },
  });

  const isSubmitting = createFranchisee.isPending || updateFranchisee.isPending;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (!formData.brandId || !formData.name || !formData.code) {
      setFormError(he.forms.validation.required);
      return;
    }

    if (editingFranchisee) {
      updateFranchisee.mutate({ id: editingFranchisee.id, data: formData });
    } else {
      createFranchisee.mutate(formData);
    }
  };

  const handleEdit = (franchisee: FranchiseeWithBrandAndContacts) => {
    setEditingFranchisee(franchisee);
    setFormData({
      brandId: franchisee.brandId,
      name: franchisee.name,
      code: franchisee.code,
      aliases: franchisee.aliases || [],
      address: franchisee.address || "",
      city: franchisee.city || "",
      state: franchisee.state || "",
      postalCode: franchisee.postalCode || "",
      country: franchisee.country || "",
      openingDate: franchisee.openingDate || "",
      leaseOption1End: franchisee.leaseOption1End || "",
      leaseOption2End: franchisee.leaseOption2End || "",
      leaseOption3End: franchisee.leaseOption3End || "",
      franchiseAgreementEnd: franchisee.franchiseAgreementEnd || "",
      status: franchisee.status,
      notes: franchisee.notes || "",
      hashavshevetItemKey: franchisee.hashavshevetItemKey || "",
      isActive: franchisee.isActive,
      isKosher: franchisee.isKosher ?? true,
    });
    setShowForm(true);
    setFormError(null);
  };

  // Open status change modal
  const openStatusChangeModal = (
    franchisee: FranchiseeWithBrandAndContacts,
    newStatus: FranchiseeStatus
  ) => {
    setStatusChangeModal({
      isOpen: true,
      franchisee,
      newStatus,
      reason: "",
      notes: "",
      isSubmitting: false,
    });
  };

  // Status change mutation
  const changeStatusMutation = useMutation({
    mutationFn: async ({
      id,
      status,
      reason,
      notes,
    }: {
      id: string;
      status: FranchiseeStatus;
      reason?: string;
      notes?: string;
    }) => {
      const response = await fetchWithTimeout(`/api/franchisees/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status,
          statusChangeReason: reason || undefined,
          statusChangeNotes: notes || undefined,
        }),
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to update franchisee status");
      }
      return response.json();
    },
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: ["franchisees"] });
      // Clear history cache for this franchisee to force refresh
      setFranchiseeHistory((prev) => {
        const updated = { ...prev };
        delete updated[id];
        return updated;
      });
      // Close modal
      setStatusChangeModal({
        isOpen: false,
        franchisee: null,
        newStatus: null,
        reason: "",
        notes: "",
        isSubmitting: false,
      });
    },
    onError: (error: Error) => {
      alert(error.message);
      setStatusChangeModal((prev) => ({ ...prev, isSubmitting: false }));
    },
  });

  // Handle status change with reason
  const handleStatusChangeConfirm = async () => {
    if (!statusChangeModal.franchisee || !statusChangeModal.newStatus) return;

    setStatusChangeModal((prev) => ({ ...prev, isSubmitting: true }));

    changeStatusMutation.mutate({
      id: statusChangeModal.franchisee.id,
      status: statusChangeModal.newStatus,
      reason: statusChangeModal.reason || undefined,
      notes: statusChangeModal.notes || undefined,
    });
  };

  // Fetch status history for a franchisee
  const fetchStatusHistory = async (franchiseeId: string) => {
    if (franchiseeHistory[franchiseeId]) {
      // Already loaded, just toggle expansion
      setExpandedHistoryId(
        expandedHistoryId === franchiseeId ? null : franchiseeId
      );
      return;
    }

    setLoadingHistoryId(franchiseeId);

    try {
      const response = await fetchWithTimeout(
        `/api/franchisees/${franchiseeId}/status-history`
      );

      if (!response.ok) {
        throw new Error("Failed to fetch status history");
      }

      const data = await response.json();
      setFranchiseeHistory((prev) => ({
        ...prev,
        [franchiseeId]: data.history,
      }));
      setExpandedHistoryId(franchiseeId);
    } catch (error) {
      console.error("Error fetching status history:", error);
      alert(he.errors.failedToFetch);
    } finally {
      setLoadingHistoryId(null);
    }
  };

  // Toggle history panel
  const toggleHistoryExpanded = (franchiseeId: string) => {
    if (expandedHistoryId === franchiseeId) {
      setExpandedHistoryId(null);
    } else {
      fetchStatusHistory(franchiseeId);
    }
  };

  const cancelForm = () => {
    setShowForm(false);
    setEditingFranchisee(null);
    setFormData(initialFormData);
    setFormError(null);
    setPendingContacts([]);
    setShowContactFormInEdit(false);
  };

  const handleAddContactInEdit = (presetRole?: ContactRole) => {
    setEditingContactIdInEdit(null);
    setContactFormInEdit({
      name: "",
      phone: "",
      email: "",
      role: presetRole || "accountant",
      notes: "",
      ownershipPercentage: "",
    });
    setShowContactFormInEdit(true);
  };

  const handleEditContactInEdit = (c: Contact) => {
    setEditingContactIdInEdit(c.id);
    setContactFormInEdit({
      name: c.name,
      phone: c.phone || "",
      email: c.email || "",
      role: c.role,
      notes: c.notes || "",
      ownershipPercentage: c.ownershipPercentage || "",
    });
    setShowContactFormInEdit(true);
  };

  const handleCancelContactFormInEdit = () => {
    setShowContactFormInEdit(false);
    setEditingContactIdInEdit(null);
    setContactFormInEdit({
      name: "",
      phone: "",
      email: "",
      role: "accountant",
      notes: "",
      ownershipPercentage: "",
    });
  };

  // Add contact to pending list (create mode)
  const handleAddPendingContact = (presetRole?: ContactRole) => {
    setEditingContactIdInEdit(null);
    setContactFormInEdit({
      name: "",
      phone: "",
      email: "",
      role: presetRole || "accountant",
      notes: "",
      ownershipPercentage: "",
    });
    setShowContactFormInEdit(true);
  };

  const handleSavePendingContact = () => {
    if (!contactFormInEdit.name.trim()) return;
    if (editingContactIdInEdit) {
      // Edit existing pending contact
      setPendingContacts((prev) =>
        prev.map((c) =>
          c.tempId === editingContactIdInEdit
            ? { ...contactFormInEdit, tempId: c.tempId }
            : c
        )
      );
    } else {
      // Add new pending contact
      setPendingContacts((prev) => [
        ...prev,
        { ...contactFormInEdit, tempId: crypto.randomUUID() },
      ]);
    }
    handleCancelContactFormInEdit();
  };

  const handleEditPendingContact = (c: typeof pendingContacts[number]) => {
    setEditingContactIdInEdit(c.tempId);
    setContactFormInEdit({
      name: c.name,
      phone: c.phone,
      email: c.email,
      role: c.role,
      notes: c.notes,
      ownershipPercentage: c.ownershipPercentage,
    });
    setShowContactFormInEdit(true);
  };

  const handleRemovePendingContact = (tempId: string) => {
    setPendingContacts((prev) => prev.filter((c) => c.tempId !== tempId));
  };

  const handleSaveContactInEdit = async () => {
    if (!editingFranchisee || !contactFormInEdit.name.trim()) return;
    setIsContactSubmittingInEdit(true);
    try {
      const url = editingContactIdInEdit
        ? `/api/franchisees/${editingFranchisee.id}/contacts/${editingContactIdInEdit}`
        : `/api/franchisees/${editingFranchisee.id}/contacts`;
      const method = editingContactIdInEdit ? "PATCH" : "POST";
      const response = await fetchWithTimeout(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(contactFormInEdit),
      });
      if (!response.ok) throw new Error("Failed to save contact");
      queryClient.invalidateQueries({ queryKey: ["franchisees"] });
      handleCancelContactFormInEdit();
    } catch (error) {
      console.error("Error saving contact:", error);
    } finally {
      setIsContactSubmittingInEdit(false);
    }
  };

  const handleDeleteContactInEdit = async (contactId: string) => {
    if (!editingFranchisee) return;
    setDeletingContactIdInEdit(contactId);
    try {
      const response = await fetchWithTimeout(
        `/api/franchisees/${editingFranchisee.id}/contacts/${contactId}`,
        { method: "DELETE" }
      );
      if (!response.ok) throw new Error("Failed to delete contact");
      queryClient.invalidateQueries({ queryKey: ["franchisees"] });
    } catch (error) {
      console.error("Error deleting contact:", error);
    } finally {
      setDeletingContactIdInEdit(null);
    }
  };

  if (isLoading || isPending) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6">
      <div className="mb-8">
        <h1 className="text-3xl font-bold">{he.admin.franchisees.title}</h1>
      </div>


      {/* Brand Tabs Filter - Large Header */}
      <div className="mb-8">
        <div className="flex items-center justify-between">
          <div className="flex gap-4 flex-wrap">
            <button
              onClick={() => setFilterBrand("all")}
              className={`flex flex-col items-center justify-center px-6 py-3 rounded-xl transition-all min-w-[160px] bg-card ${
                filterBrand === "all"
                  ? "border-4 border-primary shadow-lg"
                  : "border-2 border-muted hover:border-primary/50"
              }`}
            >
              <Store className="h-14 w-14 text-primary" />
              <span className="font-bold text-xl">{stats?.total || 0}</span>
              <span className="text-sm text-muted-foreground">כל הזכיינים</span>
            </button>
            {brands.map((brand) => {
              const brandStats = stats?.byBrand?.find((b: BrandStat) => b.brandId === brand.id);
              const count = brandStats?.count || 0;
              const activeCount = brandStats?.activeCount || 0;
              return (
                <button
                  key={brand.id}
                  onClick={() => setFilterBrand(brand.id)}
                  className={`flex flex-col items-center justify-center px-6 py-3 rounded-xl transition-all min-w-[180px] bg-card ${
                    filterBrand === brand.id
                      ? "border-4 border-primary shadow-lg"
                      : "border-2 border-muted hover:border-primary/50"
                  }`}
                >
                  {brand.logoUrl ? (
                    <img
                      src={brand.logoUrl}
                      alt={brand.nameHe}
                      className="h-16 w-16 object-contain"
                    />
                  ) : (
                    <Building2 className="h-14 w-14 text-primary" />
                  )}
                  <div className="flex items-baseline gap-2">
                    <span className="font-bold text-xl">{count}</span>
                    <span className="text-xs text-green-600">({activeCount} פעילים)</span>
                  </div>
                  <span className="text-sm font-medium">{brand.nameHe}</span>
                </button>
              );
            })}
          </div>
          <div className="flex items-center gap-2">
            <Link href="/admin/brands">
              <Button variant="outline" size="lg">
                <Tag className="me-2 h-5 w-5" />
                ניהול מותגים
              </Button>
            </Link>
            <Button
              size="lg"
              onClick={() => {
                setShowForm(true);
                setEditingFranchisee(null);
                setFormData(initialFormData);
              }}
            >
              <Plus className="me-2 h-5 w-5" />
              הוספת זכיין
            </Button>
          </div>
        </div>
      </div>

      {/* Franchisee Form Dialog */}
      <Dialog open={showForm} onOpenChange={(open) => { if (!open) setShowForm(false); else setShowForm(true); }}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingFranchisee ? he.admin.franchisees.form.editTitle : he.admin.franchisees.form.createTitle}
            </DialogTitle>
            <DialogDescription>
              {editingFranchisee
                ? he.admin.franchisees.form.editDescription
                : he.admin.franchisees.form.createDescription}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-6">
              {formError && (
                <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-3">
                  <p className="text-sm text-destructive">{formError}</p>
                </div>
              )}

              {/* Basic Information */}
              <Collapsible defaultOpen={true}>
                <CollapsibleTrigger className="flex items-center gap-2 w-full p-2 rounded-md border bg-muted/50 hover:bg-muted transition-colors">
                  <FileText className="h-4 w-4" />
                  <span className="text-sm font-medium">{he.admin.franchisees.form.sections.basicInfo}</span>
                  <ChevronDown className="h-4 w-4 ms-auto transition-transform data-[state=open]:rotate-180" />
                </CollapsibleTrigger>
                <CollapsibleContent className="pt-3">
                <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                  <div className="space-y-1">
                    <Label htmlFor="brandId" className="text-xs">{he.admin.franchisees.form.fields.brand} *</Label>
                    <Select
                      value={formData.brandId}
                      onValueChange={(value) =>
                        setFormData({ ...formData, brandId: value })
                      }
                      disabled={isSubmitting}
                    >
                      <SelectTrigger className="h-8">
                        <SelectValue placeholder={he.admin.franchisees.form.fields.brandPlaceholder} />
                      </SelectTrigger>
                      <SelectContent>
                        {brands.map((brand) => (
                          <SelectItem key={brand.id} value={brand.id}>
                            {brand.nameHe}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-1">
                    <Label htmlFor="name" className="text-xs">{he.admin.franchisees.form.fields.name} *</Label>
                    <Input
                      id="name"
                      value={formData.name}
                      onChange={(e) =>
                        setFormData({ ...formData, name: e.target.value })
                      }
                      placeholder={he.admin.franchisees.form.fields.namePlaceholder}
                      disabled={isSubmitting}
                      required
                      dir="rtl"
                      className="h-8"
                    />
                  </div>

                  <div className="space-y-1">
                    <Label htmlFor="code" className="text-xs">{he.admin.franchisees.form.fields.code} *</Label>
                    <Input
                      id="code"
                      value={formData.code}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          code: e.target.value.toUpperCase(),
                        })
                      }
                      placeholder={he.admin.franchisees.form.fields.codePlaceholder}
                      disabled={isSubmitting}
                      required
                      className="h-8"
                    />
                  </div>

                  <div className="space-y-1">
                    <Label htmlFor="status" className="text-xs">{he.admin.franchisees.form.fields.status}</Label>
                    <Select
                      value={formData.status}
                      onValueChange={(value: FranchiseeStatus) =>
                        setFormData({ ...formData, status: value })
                      }
                      disabled={isSubmitting}
                    >
                      <SelectTrigger className="h-8">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="pending">{he.admin.franchisees.statuses.pending}</SelectItem>
                        <SelectItem value="active">{he.admin.franchisees.statuses.active}</SelectItem>
                        <SelectItem value="inactive">{he.admin.franchisees.statuses.inactive}</SelectItem>
                        <SelectItem value="suspended">{he.admin.franchisees.statuses.suspended}</SelectItem>
                        <SelectItem value="terminated">{he.admin.franchisees.statuses.terminated}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-1">
                    <Label htmlFor="hashavshevetItemKey" className="text-xs">{he.admin.franchisees.form.fields.hashavshevetItemKey}</Label>
                    <Input
                      id="hashavshevetItemKey"
                      value={formData.hashavshevetItemKey}
                      onChange={(e) =>
                        setFormData({ ...formData, hashavshevetItemKey: e.target.value })
                      }
                      placeholder={he.admin.franchisees.form.fields.hashavshevetItemKeyPlaceholder}
                      disabled={isSubmitting}
                      dir="rtl"
                      className="h-8"
                    />
                  </div>

                </div>
                </CollapsibleContent>
              </Collapsible>

              {/* Address */}
              <Collapsible defaultOpen={false}>
                <CollapsibleTrigger className="flex items-center gap-2 w-full p-2 rounded-md border bg-muted/50 hover:bg-muted transition-colors">
                  <MapPin className="h-4 w-4" />
                  <span className="text-sm font-medium">{he.admin.franchisees.form.sections.address}</span>
                  {(formData.address || formData.city) && (
                    <Check className="h-3.5 w-3.5 text-green-500" />
                  )}
                  <ChevronDown className="h-4 w-4 ms-auto transition-transform data-[state=open]:rotate-180" />
                </CollapsibleTrigger>
                <CollapsibleContent className="pt-3">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2 md:col-span-2">
                    <Label htmlFor="address">{he.admin.franchisees.form.fields.streetAddress}</Label>
                    <Input
                      id="address"
                      value={formData.address}
                      onChange={(e) =>
                        setFormData({ ...formData, address: e.target.value })
                      }
                      placeholder={he.admin.franchisees.form.fields.streetAddressPlaceholder}
                      disabled={isSubmitting}
                      dir="rtl"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="city">{he.admin.franchisees.form.fields.city}</Label>
                    <Input
                      id="city"
                      value={formData.city}
                      onChange={(e) =>
                        setFormData({ ...formData, city: e.target.value })
                      }
                      placeholder={he.admin.franchisees.form.fields.cityPlaceholder}
                      disabled={isSubmitting}
                      dir="rtl"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="state">{he.admin.franchisees.form.fields.state}</Label>
                    <Input
                      id="state"
                      value={formData.state}
                      onChange={(e) =>
                        setFormData({ ...formData, state: e.target.value })
                      }
                      placeholder={he.admin.franchisees.form.fields.statePlaceholder}
                      disabled={isSubmitting}
                      dir="rtl"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="postalCode">{he.admin.franchisees.form.fields.postalCode}</Label>
                    <Input
                      id="postalCode"
                      value={formData.postalCode}
                      onChange={(e) =>
                        setFormData({ ...formData, postalCode: e.target.value })
                      }
                      placeholder={he.admin.franchisees.form.fields.postalCodePlaceholder}
                      disabled={isSubmitting}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="country">{he.admin.franchisees.form.fields.country}</Label>
                    <Input
                      id="country"
                      value={formData.country}
                      onChange={(e) =>
                        setFormData({ ...formData, country: e.target.value })
                      }
                      placeholder={he.admin.franchisees.form.fields.countryPlaceholder}
                      disabled={isSubmitting}
                      dir="rtl"
                    />
                  </div>
                </div>
                </CollapsibleContent>
              </Collapsible>

              {/* Unified Contacts Section */}
              <Collapsible defaultOpen={false}>
                <CollapsibleTrigger className="flex items-center gap-2 w-full p-2 rounded-md border bg-muted/50 hover:bg-muted transition-colors">
                  <Users className="h-4 w-4" />
                  <span className="text-sm font-medium">אנשי קשר</span>
                  {(() => {
                    const count = editingFranchisee
                      ? ((freshFranchisee || editingFranchisee)?.contacts?.length ?? 0)
                      : pendingContacts.length;
                    return count > 0 ? (
                      <Badge variant="secondary" className="text-xs">{count}</Badge>
                    ) : null;
                  })()}
                  <ChevronDown className="h-4 w-4 ms-auto transition-transform data-[state=open]:rotate-180" />
                </CollapsibleTrigger>
                <CollapsibleContent className="pt-3 space-y-3">
                  {/* Action Buttons */}
                  <div className="flex gap-2 justify-end">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => editingFranchisee ? handleAddContactInEdit("owner") : handleAddPendingContact("owner")}
                      disabled={isSubmitting || showContactFormInEdit}
                    >
                      <Plus className="h-4 w-4 me-1" />
                      הוספת בעלים
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => editingFranchisee ? handleAddContactInEdit() : handleAddPendingContact()}
                      disabled={isSubmitting || showContactFormInEdit}
                    >
                      <Plus className="h-4 w-4 me-1" />
                      הוספת איש קשר
                    </Button>
                  </div>

                  {!editingFranchisee && (
                    <p className="text-xs text-muted-foreground">אנשי קשר יישמרו לאחר יצירת הזכיין</p>
                  )}

                  {/* Contact Add/Edit Form */}
                  {showContactFormInEdit && (
                    <div className="p-4 border rounded-lg bg-muted/20 space-y-3">
                      <h4 className="font-medium text-sm">
                        {editingContactIdInEdit
                          ? (contactFormInEdit.role === "owner" ? "עריכת בעלים" : "עריכת איש קשר")
                          : (contactFormInEdit.role === "owner" ? "הוספת בעלים" : "הוספת איש קשר חדש")
                        }
                      </h4>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div className="space-y-1.5">
                          <Label className="text-xs">שם *</Label>
                          <Input
                            value={contactFormInEdit.name}
                            onChange={(e) =>
                              setContactFormInEdit({ ...contactFormInEdit, name: e.target.value })
                            }
                            placeholder="שם איש הקשר"
                            disabled={isContactSubmittingInEdit}
                            dir="rtl"
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label className="text-xs">תפקיד</Label>
                          <Select
                            value={contactFormInEdit.role}
                            onValueChange={(value) =>
                              setContactFormInEdit({ ...contactFormInEdit, role: value as ContactRole })
                            }
                            disabled={isContactSubmittingInEdit}
                          >
                            <SelectTrigger>
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
                          <Label className="text-xs">טלפון</Label>
                          <Input
                            value={contactFormInEdit.phone}
                            onChange={(e) =>
                              setContactFormInEdit({ ...contactFormInEdit, phone: e.target.value })
                            }
                            placeholder="+972-XX-XXX-XXXX"
                            disabled={isContactSubmittingInEdit}
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label className="text-xs">אימייל</Label>
                          <Input
                            type="email"
                            value={contactFormInEdit.email}
                            onChange={(e) =>
                              setContactFormInEdit({ ...contactFormInEdit, email: e.target.value })
                            }
                            placeholder="contact@example.com"
                            disabled={isContactSubmittingInEdit}
                          />
                        </div>
                        {contactFormInEdit.role === "owner" && (
                          <div className="space-y-1.5">
                            <Label className="text-xs">אחוז בעלות</Label>
                            <Input
                              type="number"
                              min="0"
                              max="100"
                              value={contactFormInEdit.ownershipPercentage}
                              onChange={(e) =>
                                setContactFormInEdit({ ...contactFormInEdit, ownershipPercentage: e.target.value })
                              }
                              placeholder="0-100"
                              disabled={isContactSubmittingInEdit}
                            />
                          </div>
                        )}
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs">הערות</Label>
                        <Input
                          value={contactFormInEdit.notes}
                          onChange={(e) =>
                            setContactFormInEdit({ ...contactFormInEdit, notes: e.target.value })
                          }
                          placeholder="הערות נוספות"
                          disabled={isContactSubmittingInEdit}
                          dir="rtl"
                        />
                      </div>
                      <div className="flex gap-2 justify-end">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={handleCancelContactFormInEdit}
                          disabled={isContactSubmittingInEdit}
                        >
                          ביטול
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          onClick={editingFranchisee ? handleSaveContactInEdit : handleSavePendingContact}
                          disabled={
                            (editingFranchisee ? isContactSubmittingInEdit : false) ||
                            !contactFormInEdit.name.trim()
                          }
                        >
                          {isContactSubmittingInEdit && (
                            <Loader2 className="h-4 w-4 animate-spin me-1" />
                          )}
                          {editingContactIdInEdit ? "עדכון" : "שמירה"}
                        </Button>
                      </div>
                    </div>
                  )}

                  {/* Contacts List - Edit Mode (from DB) */}
                  {editingFranchisee && (() => {
                    const contacts = (freshFranchisee || editingFranchisee)?.contacts || [];
                    const owners = contacts.filter((c) => c.role === "owner");
                    const others = contacts.filter((c) => c.role !== "owner");
                    const sorted = [...owners, ...others];
                    return sorted.length > 0 ? (
                      <div className="space-y-2">
                        {sorted.map((c) => (
                          <div
                            key={c.id}
                            className="flex items-center justify-between p-3 border rounded-lg bg-muted/30"
                          >
                            <div className="space-y-1">
                              <div className="flex items-center gap-2 text-sm font-medium">
                                {c.name}
                                <Badge variant="outline" className="text-xs">
                                  {contactRoleLabels[c.role as ContactRole] || c.role}
                                </Badge>
                                {c.isPrimary && (
                                  <Badge variant="secondary" className="text-xs">ראשי</Badge>
                                )}
                                {c.role === "owner" && c.ownershipPercentage && (
                                  <Badge variant="secondary" className="text-xs">
                                    {c.ownershipPercentage}% בעלות
                                  </Badge>
                                )}
                              </div>
                              <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                                {c.phone && (
                                  <span className="flex items-center gap-1">
                                    <Phone className="h-3 w-3" />
                                    {c.phone}
                                  </span>
                                )}
                                {c.email && (
                                  <span className="flex items-center gap-1">
                                    <Mail className="h-3 w-3" />
                                    {c.email}
                                  </span>
                                )}
                              </div>
                            </div>
                            <div className="flex items-center gap-1">
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="h-7 w-7 p-0"
                                onClick={() => handleEditContactInEdit(c)}
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="h-7 w-7 p-0 hover:text-destructive"
                                onClick={() => handleDeleteContactInEdit(c.id)}
                                disabled={deletingContactIdInEdit === c.id}
                              >
                                {deletingContactIdInEdit === c.id ? (
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                ) : (
                                  <Trash2 className="h-3.5 w-3.5" />
                                )}
                              </Button>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : !showContactFormInEdit ? (
                      <p className="text-muted-foreground text-sm">לא הוגדרו אנשי קשר</p>
                    ) : null;
                  })()}

                  {/* Contacts List - Create Mode (pending) */}
                  {!editingFranchisee && pendingContacts.length > 0 && (
                    <div className="space-y-2">
                      {pendingContacts.map((c) => (
                        <div
                          key={c.tempId}
                          className="flex items-center justify-between p-3 border rounded-lg bg-muted/30"
                        >
                          <div className="space-y-1">
                            <div className="flex items-center gap-2 text-sm font-medium">
                              {c.name}
                              <Badge variant="outline" className="text-xs">
                                {contactRoleLabels[c.role] || c.role}
                              </Badge>
                              {c.role === "owner" && c.ownershipPercentage && (
                                <Badge variant="secondary" className="text-xs">
                                  {c.ownershipPercentage}% בעלות
                                </Badge>
                              )}
                            </div>
                            <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                              {c.phone && (
                                <span className="flex items-center gap-1">
                                  <Phone className="h-3 w-3" />
                                  {c.phone}
                                </span>
                              )}
                              {c.email && (
                                <span className="flex items-center gap-1">
                                  <Mail className="h-3 w-3" />
                                  {c.email}
                                </span>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-1">
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="h-7 w-7 p-0"
                              onClick={() => handleEditPendingContact(c)}
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="h-7 w-7 p-0 hover:text-destructive"
                              onClick={() => handleRemovePendingContact(c.tempId)}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {!editingFranchisee && pendingContacts.length === 0 && !showContactFormInEdit && (
                    <p className="text-muted-foreground text-sm">לא הוגדרו אנשי קשר</p>
                  )}
                </CollapsibleContent>
              </Collapsible>

              {/* Important Dates */}
              <Collapsible defaultOpen={false}>
                <CollapsibleTrigger className="flex items-center gap-2 w-full p-2 rounded-md border bg-muted/50 hover:bg-muted transition-colors">
                  <Calendar className="h-4 w-4" />
                  <span className="text-sm font-medium">{he.admin.franchisees.form.sections.importantDates}</span>
                  {formData.openingDate && (
                    <Check className="h-3.5 w-3.5 text-green-500" />
                  )}
                  <ChevronDown className="h-4 w-4 ms-auto transition-transform data-[state=open]:rotate-180" />
                </CollapsibleTrigger>
                <CollapsibleContent className="pt-3 space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="openingDate">{he.admin.franchisees.form.fields.openingDate}</Label>
                    <Input
                      id="openingDate"
                      type="date"
                      value={formData.openingDate}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          openingDate: e.target.value,
                        })
                      }
                      disabled={isSubmitting}
                    />
                  </div>

                </div>

              {/* Important Dates Manager - Only shown when editing an existing franchisee */}
              {editingFranchisee && (
                <div className="border rounded-lg p-4 bg-muted/30">
                  <ImportantDatesManager
                    franchiseeId={editingFranchisee.id}
                    disabled={isSubmitting}
                  />
                </div>
              )}

              {/* Message for new franchisees */}
              {!editingFranchisee && (
                <div className="border border-dashed rounded-lg p-4 text-sm text-muted-foreground text-center">
                  <Calendar className="h-5 w-5 mx-auto mb-2 opacity-50" />
                  תאריכים חשובים (חוזים, הסכמים וכו&apos;) ניתנים להוספה לאחר יצירת הזכיין
                </div>
              )}
                </CollapsibleContent>
              </Collapsible>

              {/* Aliases Section */}
              <Collapsible defaultOpen={false}>
                <CollapsibleTrigger className="flex items-center gap-2 w-full p-2 rounded-md border bg-muted/50 hover:bg-muted transition-colors">
                  <Tag className="h-4 w-4" />
                  <span className="text-sm font-medium">{he.admin.franchisees.form.sections.aliases}</span>
                  {formData.aliases.length > 0 && (
                    <Badge variant="secondary" className="text-xs">{formData.aliases.length}</Badge>
                  )}
                  <ChevronDown className="h-4 w-4 ms-auto transition-transform data-[state=open]:rotate-180" />
                </CollapsibleTrigger>
                <CollapsibleContent className="pt-3">
                <AliasManager
                  aliases={formData.aliases}
                  onChange={(newAliases) =>
                    setFormData({ ...formData, aliases: newAliases })
                  }
                  disabled={isSubmitting}
                  placeholder={he.admin.franchisees.form.aliases.placeholder}
                />
                </CollapsibleContent>
              </Collapsible>

              {/* Documents Section */}
              {editingFranchisee ? (
                <Collapsible defaultOpen={editFranchiseeDocuments.length > 0}>
                  <CollapsibleTrigger className="flex items-center gap-2 w-full p-2 rounded-md border bg-muted/50 hover:bg-muted transition-colors">
                    <FileText className="h-4 w-4" />
                    <span className="text-sm font-medium">הסכמים ומסמכים</span>
                    {editFranchiseeDocuments.length > 0 && (
                      <Badge variant="secondary" className="text-xs">{editFranchiseeDocuments.length}</Badge>
                    )}
                    <ChevronDown className="h-4 w-4 ms-auto transition-transform data-[state=open]:rotate-180" />
                  </CollapsibleTrigger>
                  <CollapsibleContent className="pt-3">
                    {loadingEditDocs ? (
                      <div className="flex items-center justify-center py-6">
                        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                      </div>
                    ) : (
                      <DocumentManager
                        entityType="franchisee"
                        entityId={editingFranchisee.id}
                        entityName={editingFranchisee.name}
                        documents={editFranchiseeDocuments}
                        onDocumentsChange={handleEditDocsChange}
                        canUpload={userRole === "super_user" || userRole === "admin"}
                        canDelete={userRole === "super_user"}
                        canEdit={userRole === "super_user" || userRole === "admin"}
                      />
                    )}
                  </CollapsibleContent>
                </Collapsible>
              ) : (
                <div className="border border-dashed rounded-lg p-4 text-sm text-muted-foreground text-center">
                  <FileText className="h-5 w-5 mx-auto mb-2 opacity-50" />
                  ניתן להעלות הסכמים ומסמכים לאחר יצירת הזכיין
                </div>
              )}

              {/* Notes */}
              <div className="space-y-2">
                <Label htmlFor="notes">{he.admin.franchisees.form.fields.notes}</Label>
                <Input
                  id="notes"
                  value={formData.notes}
                  onChange={(e) =>
                    setFormData({ ...formData, notes: e.target.value })
                  }
                  placeholder={he.admin.franchisees.form.fields.notesPlaceholder}
                  disabled={isSubmitting}
                  dir="rtl"
                />
              </div>

              {/* Kosher Checkbox */}
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="isKosher"
                  checked={formData.isKosher}
                  onChange={(e) =>
                    setFormData({ ...formData, isKosher: e.target.checked })
                  }
                  disabled={isSubmitting}
                  className="h-4 w-4 rounded border-gray-300"
                />
                <Label htmlFor="isKosher">כשר</Label>
              </div>

              <div className="flex justify-end gap-2 pt-4">
                <Button
                  type="button"
                  variant="outline"
                  onClick={cancelForm}
                  disabled={isSubmitting}
                >
                  {he.common.cancel}
                </Button>
                <Button type="submit" disabled={isSubmitting}>
                  {isSubmitting ? (
                    <>
                      <Loader2 className="me-2 h-4 w-4 animate-spin" />
                      {he.common.saving}
                    </>
                  ) : (
                    <>
                      <Check className="me-2 h-4 w-4" />
                      {editingFranchisee ? he.common.update : he.common.create}
                    </>
                  )}
                </Button>
              </div>
            </form>
        </DialogContent>
      </Dialog>

      {/* Franchisees List */}
      <div className="border rounded-lg">
        {/* Search */}
        <div className="p-3 border-b bg-muted/30">
          <div className="relative">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              type="text"
              placeholder="חיפוש לפי שם, קוד, כינוי או עיר..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="h-8 text-sm pr-9"
            />
          </div>
        </div>

        {/* List */}
        <div className="divide-y">
          {filteredFranchisees.length === 0 ? (
            <div className="text-center py-6 text-sm text-muted-foreground">
              {searchTerm.trim()
                ? "לא נמצאו זכיינים התואמים לחיפוש"
                : filterBrand !== "all" || filterStatus !== "all"
                  ? he.admin.franchisees.empty.noMatchingFilters
                  : he.admin.franchisees.empty.noFranchisees}
            </div>
          ) : (
            filteredFranchisees.map((franchisee) => (
              <FranchiseeCard
                key={franchisee.id}
                franchisee={franchisee}
                userRole={userRole}
                onEdit={handleEdit}
                onStatusChange={openStatusChangeModal}
                documents={franchiseeDocuments[franchisee.id] || []}
                onDocumentsChange={(docs) => handleDocumentsChange(franchisee.id, docs)}
                isDocumentsExpanded={expandedDocumentsId === franchisee.id}
                isLoadingDocuments={loadingDocumentsId === franchisee.id}
                onToggleDocuments={() => toggleDocumentsExpanded(franchisee.id)}
                statusHistory={franchiseeHistory[franchisee.id] || []}
                isHistoryExpanded={expandedHistoryId === franchisee.id}
                isLoadingHistory={loadingHistoryId === franchisee.id}
                onToggleHistory={() => toggleHistoryExpanded(franchisee.id)}
                reminderCount={reminderCounts[franchisee.id] || 0}
              />
            ))
          )}
        </div>
      </div>

      {/* Status Change Modal */}
      <Dialog
        open={statusChangeModal.isOpen}
        onOpenChange={(open) => {
          if (!open && !statusChangeModal.isSubmitting) {
            setStatusChangeModal({
              isOpen: false,
              franchisee: null,
              newStatus: null,
              reason: "",
              notes: "",
              isSubmitting: false,
            });
          }
        }}
      >
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>{he.admin.franchisees.statusChange.title}</DialogTitle>
            <DialogDescription>
              {he.admin.franchisees.statusChange.description}{" "}
              <span className="font-semibold">
                {statusChangeModal.franchisee?.name}
              </span>{" "}
              {he.admin.franchisees.statusChange.from}
              <Badge variant={statusVariants[statusChangeModal.franchisee?.status || "pending"]}>
                {statusLabels[statusChangeModal.franchisee?.status || "pending"]}
              </Badge>{" "}
              {he.admin.franchisees.statusChange.to}
              <Badge variant={statusVariants[statusChangeModal.newStatus || "pending"]}>
                {statusLabels[statusChangeModal.newStatus || "pending"]}
              </Badge>
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="statusReason">{he.admin.franchisees.statusChange.reasonLabel} *</Label>
              <Input
                id="statusReason"
                placeholder={he.admin.franchisees.statusChange.reasonPlaceholder}
                value={statusChangeModal.reason}
                onChange={(e) =>
                  setStatusChangeModal((prev) => ({
                    ...prev,
                    reason: e.target.value,
                  }))
                }
                disabled={statusChangeModal.isSubmitting}
                dir="rtl"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="statusNotes">{he.admin.franchisees.statusChange.notesLabel}</Label>
              <Input
                id="statusNotes"
                placeholder={he.admin.franchisees.statusChange.notesPlaceholder}
                value={statusChangeModal.notes}
                onChange={(e) =>
                  setStatusChangeModal((prev) => ({
                    ...prev,
                    notes: e.target.value,
                  }))
                }
                disabled={statusChangeModal.isSubmitting}
                dir="rtl"
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() =>
                setStatusChangeModal({
                  isOpen: false,
                  franchisee: null,
                  newStatus: null,
                  reason: "",
                  notes: "",
                  isSubmitting: false,
                })
              }
              disabled={statusChangeModal.isSubmitting}
            >
              {he.common.cancel}
            </Button>
            <Button
              onClick={handleStatusChangeConfirm}
              disabled={statusChangeModal.isSubmitting || !statusChangeModal.reason.trim()}
            >
              {statusChangeModal.isSubmitting ? (
                <>
                  <Loader2 className="me-2 h-4 w-4 animate-spin" />
                  {he.common.saving}
                </>
              ) : (
                he.admin.franchisees.statusChange.confirmButton
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  );
}

// Franchisee Card Component
interface FranchiseeCardProps {
  franchisee: FranchiseeWithBrandAndContacts;
  userRole: string | undefined;
  onEdit: (franchisee: FranchiseeWithBrandAndContacts) => void;
  onStatusChange: (
    franchisee: FranchiseeWithBrandAndContacts,
    status: FranchiseeStatus
  ) => void;
  documents: DocumentWithUploader[];
  onDocumentsChange: (documents: DocumentWithUploader[]) => void;
  isDocumentsExpanded: boolean;
  isLoadingDocuments: boolean;
  onToggleDocuments: () => void;
  // Status history props
  statusHistory: StatusHistoryEntry[];
  isHistoryExpanded: boolean;
  isLoadingHistory: boolean;
  onToggleHistory: () => void;
  // Reminder count for badges
  reminderCount: number;
}

function FranchiseeCard({
  franchisee,
  userRole,
  onEdit,
  onStatusChange,
  documents,
  onDocumentsChange,
  isDocumentsExpanded,
  isLoadingDocuments,
  onToggleDocuments,
  statusHistory,
  isHistoryExpanded,
  isLoadingHistory,
  onToggleHistory,
  reminderCount,
}: FranchiseeCardProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="p-3 hover:bg-muted/30 transition-colors">
      {/* Header Row */}
      <div className="flex items-start justify-between gap-2">
        <div className="space-y-1 flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={() => onEdit(franchisee)}
              className="font-medium truncate hover:text-primary hover:underline transition-colors text-start"
            >
              {franchisee.name}
            </button>
            <span className="text-xs text-muted-foreground font-mono">{franchisee.code}</span>
            <Badge variant={statusVariants[franchisee.status]} className="text-xs px-1.5 py-0">
              {statusLabels[franchisee.status]}
            </Badge>
            {reminderCount > 0 && (
              <Badge variant="outline" className="text-xs px-1.5 py-0 border-amber-500 text-amber-600 bg-amber-50">
                <Bell className="h-3 w-3 ml-1" />
                {reminderCount} תזכורות
              </Badge>
            )}
            {franchisee.brand && (
              <Badge variant="outline" className="text-xs px-1.5 py-0">{franchisee.brand.nameHe}</Badge>
            )}
            {franchisee.city && (
              <span className="text-xs text-muted-foreground">{franchisee.city}</span>
            )}
            {franchisee.contacts?.[0]?.name && (
              <span className="text-xs text-muted-foreground">{franchisee.contacts[0].name}</span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1">
          <Link href={`/admin/franchisees/${franchisee.id}`} title={he.common.viewDetails}>
            <Button size="sm" variant="ghost" className="h-7 px-2">
              <Eye className="h-3.5 w-3.5" />
            </Button>
          </Link>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2"
            onClick={() => setExpanded(!expanded)}
            title={expanded ? he.admin.franchisees.card.less : he.admin.franchisees.card.more}
          >
            {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2"
            onClick={onToggleHistory}
            disabled={isLoadingHistory}
            title={he.admin.franchisees.card.history}
          >
            {isLoadingHistory ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <History className="h-3.5 w-3.5" />
            )}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2"
            onClick={() => onEdit(franchisee)}
            title={he.admin.franchisees.form.editTitle}
          >
            <Pencil className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Expanded Details */}
      {expanded && (
        <div className="pt-3 border-t space-y-4">
          {/* Address Section */}
          {(franchisee.address ||
            franchisee.city ||
            franchisee.state ||
            franchisee.country) && (
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-sm font-medium">
                <MapPin className="h-4 w-4" />
                {he.admin.franchisees.card.address}
              </div>
              <div className="text-sm text-muted-foreground me-6">
                {[
                  franchisee.address,
                  franchisee.city,
                  franchisee.state,
                  franchisee.postalCode,
                  franchisee.country,
                ]
                  .filter(Boolean)
                  .join(", ")}
              </div>
            </div>
          )}

          {/* Contacts */}
          {franchisee.contacts && franchisee.contacts.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Users className="h-4 w-4" />
                אנשי קשר ({franchisee.contacts.length})
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2 me-6">
                {[...franchisee.contacts]
                  .sort((a, b) => (a.role === "owner" ? -1 : 1) - (b.role === "owner" ? -1 : 1))
                  .map((contact) => (
                  <div
                    key={contact.id}
                    className="text-sm bg-muted/50 rounded p-2 space-y-1"
                  >
                    <div className="font-medium flex items-center gap-2">
                      {contact.name}
                      <Badge variant="outline" className="text-xs">
                        {contactRoleLabels[contact.role as ContactRole] || contact.role}
                      </Badge>
                      {contact.isPrimary && (
                        <Badge variant="secondary" className="text-xs">ראשי</Badge>
                      )}
                      {contact.role === "owner" && contact.ownershipPercentage && (
                        <Badge variant="secondary" className="text-xs">
                          {contact.ownershipPercentage}% בעלות
                        </Badge>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-3 text-muted-foreground text-xs">
                      {contact.phone && (
                        <span className="flex items-center gap-1">
                          <Phone className="h-3 w-3" />
                          {contact.phone}
                        </span>
                      )}
                      {contact.email && (
                        <span className="flex items-center gap-1">
                          <Mail className="h-3 w-3" />
                          {contact.email}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Important Dates */}
          {(franchisee.openingDate ||
            franchisee.leaseOption1End ||
            franchisee.leaseOption2End ||
            franchisee.leaseOption3End ||
            franchisee.franchiseAgreementEnd) && (
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Calendar className="h-4 w-4" />
                {he.admin.franchisees.card.importantDates}
              </div>
              <div className="text-sm text-muted-foreground me-6 flex flex-wrap gap-4">
                {franchisee.openingDate && (
                  <span>
                    {he.admin.franchisees.card.opening}{" "}
                    {new Date(franchisee.openingDate).toLocaleDateString(
                      "he-IL"
                    )}
                  </span>
                )}
                {franchisee.leaseOption1End && (
                  <span>
                    {he.admin.franchisees.card.leaseOption1End}{" "}
                    {new Date(franchisee.leaseOption1End).toLocaleDateString(
                      "he-IL"
                    )}
                  </span>
                )}
                {franchisee.leaseOption2End && (
                  <span>
                    {he.admin.franchisees.card.leaseOption2End}{" "}
                    {new Date(franchisee.leaseOption2End).toLocaleDateString(
                      "he-IL"
                    )}
                  </span>
                )}
                {franchisee.leaseOption3End && (
                  <span>
                    {he.admin.franchisees.card.leaseOption3End}{" "}
                    {new Date(franchisee.leaseOption3End).toLocaleDateString(
                      "he-IL"
                    )}
                  </span>
                )}
                {franchisee.franchiseAgreementEnd && (
                  <span>
                    {he.admin.franchisees.card.agreementEnd}{" "}
                    {new Date(
                      franchisee.franchiseAgreementEnd
                    ).toLocaleDateString("he-IL")}
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Notes */}
          {franchisee.notes && (
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-sm font-medium">
                <FileText className="h-4 w-4" />
                {he.admin.franchisees.card.notes}
              </div>
              <div className="text-sm text-muted-foreground me-6">
                {franchisee.notes}
              </div>
            </div>
          )}

          {/* Meta Info */}
          <div className="text-xs text-muted-foreground pt-2 border-t">
            {he.admin.franchisees.card.created}{" "}
            {new Date(franchisee.createdAt).toLocaleDateString("he-IL")}
            {franchisee.updatedAt && (
              <>
                {" "}
                | {he.admin.franchisees.card.updated}{" "}
                {new Date(franchisee.updatedAt).toLocaleDateString("he-IL")}
              </>
            )}
          </div>
        </div>
      )}

      {/* Documents Panel */}
      {isDocumentsExpanded && (
        <div className="pt-3 border-t">
          <DocumentManager
            entityType="franchisee"
            entityId={franchisee.id}
            entityName={franchisee.name}
            documents={documents}
            onDocumentsChange={onDocumentsChange}
            canUpload={userRole === "super_user" || userRole === "admin"}
            canDelete={userRole === "super_user"}
            canEdit={userRole === "super_user" || userRole === "admin"}
          />
        </div>
      )}

      {/* Status History Panel */}
      {isHistoryExpanded && (
        <div className="pt-3 border-t">
          <div className="flex items-center gap-2 text-sm font-medium mb-3">
            <History className="h-4 w-4" />
            {he.admin.franchisees.statusHistory.title}
          </div>
          {statusHistory.length === 0 ? (
            <div className="text-sm text-muted-foreground text-center py-4">
              {he.admin.franchisees.statusHistory.noChanges}
            </div>
          ) : (
            <div className="space-y-3">
              {statusHistory.map((entry) => (
                <div
                  key={entry.id}
                  className="text-sm bg-muted/50 rounded p-3 space-y-2"
                >
                  <div className="flex items-center gap-2 flex-wrap">
                    {entry.previousStatus ? (
                      <>
                        <Badge
                          variant={statusVariants[entry.previousStatus]}
                          className="text-xs"
                        >
                          {statusLabels[entry.previousStatus]}
                        </Badge>
                        <ArrowRight className="h-3 w-3 text-muted-foreground rtl-flip" />
                      </>
                    ) : (
                      <span className="text-xs text-muted-foreground">
                        {he.admin.franchisees.statusHistory.initial}
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
                    <div className="text-muted-foreground">
                      <span className="font-medium">{he.admin.franchisees.statusHistory.reason} </span>
                      {entry.reason}
                    </div>
                  )}

                  {entry.notes && (
                    <div className="text-muted-foreground">
                      <span className="font-medium">{he.admin.franchisees.statusHistory.notes} </span>
                      {entry.notes}
                    </div>
                  )}

                  <div className="flex items-center gap-4 text-xs text-muted-foreground pt-1 border-t border-muted">
                    <span>
                      {new Date(entry.createdAt).toLocaleDateString("he-IL", {
                        year: "numeric",
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                    {entry.createdByUser && (
                      <span className="flex items-center gap-1">
                        <UserCircle className="h-3 w-3" />
                        {entry.createdByUser.name}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
