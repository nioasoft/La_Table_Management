"use client";

import { useState, useMemo } from "react";
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
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { Brand, FranchiseeStatus, FranchiseeOwner, Document, Contact } from "@/db/schema";
import type { FranchiseeWithBrandAndContacts } from "@/data-access/franchisees";
import Link from "next/link";
import { AliasManager } from "@/components/alias-manager";
import { DocumentManager } from "@/components/document-manager";
import { FranchiseeDetailCard } from "@/components/franchisee-detail-card";
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

interface FranchiseeFormData {
  brandId: string;
  name: string;
  code: string;
  aliases: string[];
  companyId: string;
  address: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  primaryContactName: string;
  primaryContactEmail: string;
  primaryContactPhone: string;
  owners: FranchiseeOwner[];
  openingDate: string;
  leaseOption1End: string;
  leaseOption2End: string;
  leaseOption3End: string;
  franchiseAgreementEnd: string;
  status: FranchiseeStatus;
  notes: string;
  isActive: boolean;
}

const initialFormData: FranchiseeFormData = {
  brandId: "",
  name: "",
  code: "",
  aliases: [],
  companyId: "",
  address: "",
  city: "",
  state: "",
  postalCode: "",
  country: "",
  primaryContactName: "",
  primaryContactEmail: "",
  primaryContactPhone: "",
  owners: [],
  openingDate: "",
  leaseOption1End: "",
  leaseOption2End: "",
  leaseOption3End: "",
  franchiseAgreementEnd: "",
  status: "pending",
  notes: "",
  isActive: true,
};

const emptyOwner: FranchiseeOwner = {
  name: "",
  phone: "",
  email: "",
  ownershipPercentage: 0,
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

  // Detail card state
  const [detailViewFranchisee, setDetailViewFranchisee] = useState<FranchiseeWithBrandAndContacts | null>(null);

  const { data: session, isPending } = authClient.useSession();

  const userRole = session
    ? (session.user as { role?: string })?.role
    : undefined;

  // Redirect if not authenticated or authorized
  if (!isPending && !session) {
    router.push("/sign-in?redirect=/admin/franchisees");
  }
  if (!isPending && session?.user && userRole !== "super_user" && userRole !== "admin") {
    router.push("/dashboard");
  }

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
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error("Failed to fetch franchisees");
      }
      return response.json();
    },
    enabled: !isPending && !!session,
  });

  const franchisees: FranchiseeWithBrandAndContacts[] = franchiseesData?.franchisees || [];
  const stats = franchiseesData?.stats || null;

  // Filter franchisees by search term
  const filteredFranchisees = useMemo(() => {
    if (!searchTerm.trim()) return franchisees;
    const term = searchTerm.toLowerCase().trim();
    return franchisees.filter((f) =>
      f.name.toLowerCase().includes(term) ||
      f.code?.toLowerCase().includes(term) ||
      f.aliases?.some((a) => a.toLowerCase().includes(term)) ||
      f.primaryContactName?.toLowerCase().includes(term) ||
      f.city?.toLowerCase().includes(term)
    );
  }, [franchisees, searchTerm]);

  // Fetch brands with TanStack Query
  const { data: brandsData } = useQuery({
    queryKey: ["brands", "list", { filter: "active" }],
    queryFn: async () => {
      const response = await fetch("/api/brands?filter=active");
      if (!response.ok) {
        throw new Error("Failed to fetch brands");
      }
      return response.json();
    },
    enabled: !isPending && !!session,
  });

  const brands: Brand[] = brandsData?.brands || [];

  const fetchFranchiseeDocuments = async (franchiseeId: string) => {
    try {
      setLoadingDocumentsId(franchiseeId);
      const response = await fetch(`/api/documents/franchisee/${franchiseeId}`);
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
      const response = await fetch("/api/franchisees", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...data,
          aliases: data.aliases.length > 0 ? data.aliases : null,
          owners: data.owners.length > 0 ? data.owners : null,
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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["franchisees"] });
      setShowForm(false);
      setEditingFranchisee(null);
      setFormData(initialFormData);
    },
    onError: (error: Error) => {
      setFormError(error.message);
    },
  });

  // Update franchisee mutation
  const updateFranchisee = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: typeof formData }) => {
      const response = await fetch(`/api/franchisees/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...data,
          aliases: data.aliases.length > 0 ? data.aliases : null,
          owners: data.owners.length > 0 ? data.owners : null,
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
      companyId: franchisee.companyId || "",
      address: franchisee.address || "",
      city: franchisee.city || "",
      state: franchisee.state || "",
      postalCode: franchisee.postalCode || "",
      country: franchisee.country || "",
      primaryContactName: franchisee.primaryContactName || "",
      primaryContactEmail: franchisee.primaryContactEmail || "",
      primaryContactPhone: franchisee.primaryContactPhone || "",
      owners: franchisee.owners || [],
      openingDate: franchisee.openingDate || "",
      leaseOption1End: franchisee.leaseOption1End || "",
      leaseOption2End: franchisee.leaseOption2End || "",
      leaseOption3End: franchisee.leaseOption3End || "",
      franchiseAgreementEnd: franchisee.franchiseAgreementEnd || "",
      status: franchisee.status,
      notes: franchisee.notes || "",
      isActive: franchisee.isActive,
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
      const response = await fetch(`/api/franchisees/${id}`, {
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
      const response = await fetch(
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

  // Open detail view
  const handleViewDetails = (franchisee: FranchiseeWithBrandAndContacts) => {
    setDetailViewFranchisee(franchisee);
  };

  // Close detail view
  const handleCloseDetails = () => {
    setDetailViewFranchisee(null);
  };

  const cancelForm = () => {
    setShowForm(false);
    setEditingFranchisee(null);
    setFormData(initialFormData);
    setFormError(null);
  };

  const addOwner = () => {
    setFormData({
      ...formData,
      owners: [...formData.owners, { ...emptyOwner }],
    });
  };

  const removeOwner = (index: number) => {
    setFormData({
      ...formData,
      owners: formData.owners.filter((_, i) => i !== index),
    });
  };

  const updateOwner = (
    index: number,
    field: keyof FranchiseeOwner,
    value: string | number
  ) => {
    const newOwners = [...formData.owners];
    newOwners[index] = { ...newOwners[index], [field]: value };
    setFormData({ ...formData, owners: newOwners });
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

      {/* Franchisee Form Dialog */}
      <Dialog open={showForm} onOpenChange={(open) => !isSubmitting && setShowForm(open)}>
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
              <div className="space-y-4">
                <h3 className="text-lg font-semibold flex items-center gap-2">
                  <FileText className="h-5 w-5" />
                  {he.admin.franchisees.form.sections.basicInfo}
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="brandId">{he.admin.franchisees.form.fields.brand} *</Label>
                    <Select
                      value={formData.brandId}
                      onValueChange={(value) =>
                        setFormData({ ...formData, brandId: value })
                      }
                      disabled={isSubmitting}
                    >
                      <SelectTrigger>
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

                  <div className="space-y-2">
                    <Label htmlFor="name">{he.admin.franchisees.form.fields.name} *</Label>
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
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="code">{he.admin.franchisees.form.fields.code} *</Label>
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
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="companyId">{he.admin.franchisees.form.fields.companyId}</Label>
                    <Input
                      id="companyId"
                      value={formData.companyId}
                      onChange={(e) =>
                        setFormData({ ...formData, companyId: e.target.value })
                      }
                      placeholder={he.admin.franchisees.form.fields.companyIdPlaceholder}
                      disabled={isSubmitting}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="status">{he.admin.franchisees.form.fields.status}</Label>
                    <Select
                      value={formData.status}
                      onValueChange={(value: FranchiseeStatus) =>
                        setFormData({ ...formData, status: value })
                      }
                      disabled={isSubmitting}
                    >
                      <SelectTrigger>
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

                </div>
              </div>

              {/* Aliases Section */}
              <div className="space-y-4">
                <h3 className="text-lg font-semibold flex items-center gap-2">
                  <Tag className="h-5 w-5" />
                  {he.admin.franchisees.form.sections.aliases}
                </h3>
                <AliasManager
                  aliases={formData.aliases}
                  onChange={(newAliases) =>
                    setFormData({ ...formData, aliases: newAliases })
                  }
                  disabled={isSubmitting}
                  placeholder={he.admin.franchisees.form.aliases.placeholder}
                />
              </div>

              {/* Address */}
              <div className="space-y-4">
                <h3 className="text-lg font-semibold flex items-center gap-2">
                  <MapPin className="h-5 w-5" />
                  {he.admin.franchisees.form.sections.address}
                </h3>
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
              </div>

              {/* Primary Contact */}
              <div className="space-y-4">
                <h3 className="text-lg font-semibold flex items-center gap-2">
                  <UserCircle className="h-5 w-5" />
                  {he.admin.franchisees.form.sections.primaryContact}
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="primaryContactName">{he.admin.franchisees.form.fields.contactName}</Label>
                    <Input
                      id="primaryContactName"
                      value={formData.primaryContactName}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          primaryContactName: e.target.value,
                        })
                      }
                      placeholder={he.admin.franchisees.form.fields.contactNamePlaceholder}
                      disabled={isSubmitting}
                      dir="rtl"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="primaryContactPhone">{he.admin.franchisees.form.fields.contactPhone}</Label>
                    <Input
                      id="primaryContactPhone"
                      value={formData.primaryContactPhone}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          primaryContactPhone: e.target.value,
                        })
                      }
                      placeholder={he.admin.franchisees.form.fields.contactPhonePlaceholder}
                      disabled={isSubmitting}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="primaryContactEmail">{he.admin.franchisees.form.fields.contactEmail}</Label>
                    <Input
                      id="primaryContactEmail"
                      type="email"
                      value={formData.primaryContactEmail}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          primaryContactEmail: e.target.value,
                        })
                      }
                      placeholder={he.admin.franchisees.form.fields.contactEmailPlaceholder}
                      disabled={isSubmitting}
                    />
                  </div>
                </div>
              </div>

              {/* Owners */}
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-semibold flex items-center gap-2">
                    <Users className="h-5 w-5" />
                    {he.admin.franchisees.form.sections.owners}
                  </h3>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={addOwner}
                    disabled={isSubmitting}
                  >
                    <Plus className="h-4 w-4 me-1" />
                    {he.admin.franchisees.form.owners.addOwner}
                  </Button>
                </div>

                {formData.owners.map((owner, index) => (
                  <div
                    key={index}
                    className="grid grid-cols-1 md:grid-cols-5 gap-4 p-4 border rounded-lg relative"
                  >
                    <div className="space-y-2">
                      <Label>{he.admin.franchisees.form.fields.ownerName} *</Label>
                      <Input
                        value={owner.name}
                        onChange={(e) =>
                          updateOwner(index, "name", e.target.value)
                        }
                        placeholder={he.admin.franchisees.form.fields.ownerNamePlaceholder}
                        disabled={isSubmitting}
                        dir="rtl"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>{he.admin.franchisees.form.fields.ownerPhone}</Label>
                      <Input
                        value={owner.phone}
                        onChange={(e) =>
                          updateOwner(index, "phone", e.target.value)
                        }
                        placeholder={he.common.phone}
                        disabled={isSubmitting}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>{he.admin.franchisees.form.fields.ownerEmail}</Label>
                      <Input
                        type="email"
                        value={owner.email}
                        onChange={(e) =>
                          updateOwner(index, "email", e.target.value)
                        }
                        placeholder={he.common.email}
                        disabled={isSubmitting}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>{he.admin.franchisees.form.fields.ownershipPercentage}</Label>
                      <Input
                        type="number"
                        min="0"
                        max="100"
                        value={owner.ownershipPercentage}
                        onChange={(e) =>
                          updateOwner(
                            index,
                            "ownershipPercentage",
                            parseFloat(e.target.value) || 0
                          )
                        }
                        placeholder="0-100"
                        disabled={isSubmitting}
                      />
                    </div>
                    <div className="flex items-end">
                      <Button
                        type="button"
                        variant="destructive"
                        size="sm"
                        onClick={() => removeOwner(index)}
                        disabled={isSubmitting}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>

              {/* Important Dates */}
              <div className="space-y-4">
                <h3 className="text-lg font-semibold flex items-center gap-2">
                  <Calendar className="h-5 w-5" />
                  {he.admin.franchisees.form.sections.importantDates}
                </h3>
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

                  <div className="space-y-2">
                    <Label htmlFor="leaseOption1End">{he.admin.franchisees.form.fields.leaseOption1End}</Label>
                    <Input
                      id="leaseOption1End"
                      type="date"
                      value={formData.leaseOption1End}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          leaseOption1End: e.target.value,
                        })
                      }
                      disabled={isSubmitting}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="leaseOption2End">{he.admin.franchisees.form.fields.leaseOption2End}</Label>
                    <Input
                      id="leaseOption2End"
                      type="date"
                      value={formData.leaseOption2End}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          leaseOption2End: e.target.value,
                        })
                      }
                      disabled={isSubmitting}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="leaseOption3End">{he.admin.franchisees.form.fields.leaseOption3End}</Label>
                    <Input
                      id="leaseOption3End"
                      type="date"
                      value={formData.leaseOption3End}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          leaseOption3End: e.target.value,
                        })
                      }
                      disabled={isSubmitting}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="franchiseAgreementEnd">
                      {he.admin.franchisees.form.fields.franchiseAgreementEnd}
                    </Label>
                    <Input
                      id="franchiseAgreementEnd"
                      type="date"
                      value={formData.franchiseAgreementEnd}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          franchiseAgreementEnd: e.target.value,
                        })
                      }
                      disabled={isSubmitting}
                    />
                  </div>
                </div>
              </div>

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

              {/* Active Checkbox */}
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="isActive"
                  checked={formData.isActive}
                  onChange={(e) =>
                    setFormData({ ...formData, isActive: e.target.checked })
                  }
                  disabled={isSubmitting}
                  className="h-4 w-4 rounded border-gray-300"
                />
                <Label htmlFor="isActive">{he.admin.franchisees.form.fields.isActive}</Label>
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
                onViewDetails={handleViewDetails}
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

      {/* Franchisee Detail Card Dialog */}
      {detailViewFranchisee && (
        <FranchiseeDetailCard
          franchisee={detailViewFranchisee}
          isOpen={!!detailViewFranchisee}
          onClose={handleCloseDetails}
          userRole={userRole}
          onEdit={handleEdit}
          onStatusChange={openStatusChangeModal}
        />
      )}
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
  // Detail view props
  onViewDetails: (franchisee: FranchiseeWithBrandAndContacts) => void;
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
  onViewDetails,
}: FranchiseeCardProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="p-3 hover:bg-muted/30 transition-colors">
      {/* Header Row */}
      <div className="flex items-start justify-between gap-2">
        <div className="space-y-1 flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium">{franchisee.name}</span>
            <span className="text-xs text-muted-foreground font-mono">{franchisee.code}</span>
            <Badge variant={statusVariants[franchisee.status]} className="text-xs px-1.5 py-0">
              {statusLabels[franchisee.status]}
            </Badge>
            {franchisee.brand && (
              <Badge variant="outline" className="text-xs px-1.5 py-0">{franchisee.brand.nameHe}</Badge>
            )}
            {franchisee.aliases && franchisee.aliases.length > 0 && (
              franchisee.aliases.slice(0, 3).map((alias, idx) => (
                <Badge
                  key={`${alias}-${idx}`}
                  variant="outline"
                  className="text-xs px-1.5 py-0 text-muted-foreground"
                >
                  {alias}
                </Badge>
              ))
            )}
            {franchisee.aliases && franchisee.aliases.length > 3 && (
              <span className="text-xs text-muted-foreground">+{franchisee.aliases.length - 3}</span>
            )}
          </div>
          {(franchisee.city || franchisee.primaryContactName) && (
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              {franchisee.city && <span>{franchisee.city}</span>}
              {franchisee.primaryContactName && <span>{franchisee.primaryContactName}</span>}
            </div>
          )}
        </div>

        <div className="flex items-center gap-1">
          <Select
            value={franchisee.status}
            onValueChange={(value: FranchiseeStatus) =>
              onStatusChange(franchisee, value)
            }
          >
            <SelectTrigger className="w-[100px] h-7 text-xs">
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
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2"
            onClick={() => onViewDetails(franchisee)}
            title={he.common.viewDetails}
          >
            <Eye className="h-3.5 w-3.5" />
          </Button>
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
            onClick={onToggleDocuments}
            disabled={isLoadingDocuments}
            title={he.admin.franchisees.card.documents}
          >
            {isLoadingDocuments ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <>
                <FileText className="h-3.5 w-3.5" />
                {documents.length > 0 && (
                  <span className="text-xs ms-0.5">{documents.length}</span>
                )}
              </>
            )}
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

          {/* Primary Contact */}
          {(franchisee.primaryContactName ||
            franchisee.primaryContactPhone ||
            franchisee.primaryContactEmail) && (
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-sm font-medium">
                <UserCircle className="h-4 w-4" />
                {he.admin.franchisees.card.primaryContact}
              </div>
              <div className="text-sm text-muted-foreground me-6 flex flex-wrap gap-4">
                {franchisee.primaryContactName && (
                  <span>{franchisee.primaryContactName}</span>
                )}
                {franchisee.primaryContactPhone && (
                  <span className="flex items-center gap-1">
                    <Phone className="h-3 w-3" />
                    {franchisee.primaryContactPhone}
                  </span>
                )}
                {franchisee.primaryContactEmail && (
                  <span className="flex items-center gap-1">
                    <Mail className="h-3 w-3" />
                    {franchisee.primaryContactEmail}
                  </span>
                )}
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
                {franchisee.contacts.map((contact) => (
                  <div
                    key={contact.id}
                    className="text-sm bg-muted/50 rounded p-2 space-y-1"
                  >
                    <div className="font-medium flex items-center gap-2">
                      {contact.name}
                      {contact.role === "owner" && (
                        <Badge variant="outline" className="text-xs">בעלים</Badge>
                      )}
                      {contact.isPrimary && (
                        <Badge variant="secondary" className="text-xs">ראשי</Badge>
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
