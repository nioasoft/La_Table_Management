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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Truck,
  Plus,
  Pencil,
  Trash2,
  RefreshCw,
  X,
  Check,
  Loader2,
  Building2,
  Users,
  Percent,
  Hash,
  History,
  ChevronDown,
  ChevronUp,
  Calendar,
  User,
  FileSpreadsheet,
  FileText,
  Eye,
  Tags,
  Search,
} from "lucide-react";
import type { Supplier, Brand, CommissionType, SettlementFrequency, SupplierFileMapping, Document, CommissionException } from "@/db/schema";
import { FileMappingConfig } from "@/components/file-mapping-config";
import { DocumentManager } from "@/components/document-manager";
import {
  CommissionExceptionsEditor,
  type CommissionExceptionFormData,
  formDataToCommissionExceptions,
  commissionExceptionsToFormData,
} from "@/components/commission-exceptions-editor";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import Link from "next/link";
import { he } from "@/lib/translations/he";

// Document type with uploader info
interface DocumentWithUploader extends Document {
  uploaderName?: string | null;
  uploaderEmail?: string | null;
}

// Commission history type
interface CommissionHistoryEntry {
  id: string;
  supplierId: string;
  previousRate: string | null;
  newRate: string;
  effectiveDate: string;
  reason: string | null;
  notes: string | null;
  createdAt: Date;
  createdBy: string | null;
  createdByUser?: { name: string; email: string } | null;
}

// Extended supplier type with brands
type SupplierWithBrands = Supplier & {
  brands: Brand[];
};

interface SupplierFormData {
  code: string;
  name: string;
  companyId: string;
  description: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  secondaryContactName: string;
  secondaryContactEmail: string;
  secondaryContactPhone: string;
  address: string;
  paymentTerms: string;
  defaultCommissionRate: string;
  commissionType: CommissionType;
  settlementFrequency: SettlementFrequency;
  vatIncluded: boolean;
  isActive: boolean;
  isHidden: boolean;
  brandIds: string[];
  commissionExceptions: CommissionExceptionFormData[];
  bkmvAliases: string[];
  // Commission change logging fields
  commissionChangeReason: string;
  commissionChangeNotes: string;
  commissionEffectiveDate: string;
}

const initialFormData: SupplierFormData = {
  code: "",
  name: "",
  companyId: "",
  description: "",
  contactName: "",
  contactEmail: "",
  contactPhone: "",
  secondaryContactName: "",
  secondaryContactEmail: "",
  secondaryContactPhone: "",
  address: "",
  paymentTerms: "",
  defaultCommissionRate: "",
  commissionType: "percentage",
  settlementFrequency: "monthly",
  vatIncluded: false,
  isActive: true,
  isHidden: false,
  brandIds: [],
  commissionExceptions: [],
  bkmvAliases: [],
  commissionChangeReason: "",
  commissionChangeNotes: "",
  commissionEffectiveDate: new Date().toISOString().split("T")[0],
};

export default function AdminSuppliersPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<"all" | "active">("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editingSupplier, setEditingSupplier] = useState<SupplierWithBrands | null>(null);
  const [formData, setFormData] = useState<SupplierFormData>(initialFormData);
  const [formError, setFormError] = useState<string | null>(null);
  const [newAliasInput, setNewAliasInput] = useState<string>("");
  const [expandedHistoryId, setExpandedHistoryId] = useState<string | null>(null);
  const [loadingHistoryId, setLoadingHistoryId] = useState<string | null>(null);
  const [commissionHistories, setCommissionHistories] = useState<
    Record<string, CommissionHistoryEntry[]>
  >({});
  const [expandedFileMappingId, setExpandedFileMappingId] = useState<string | null>(null);
  const [expandedDocumentsId, setExpandedDocumentsId] = useState<string | null>(null);
  const [loadingDocumentsId, setLoadingDocumentsId] = useState<string | null>(null);
  const [supplierDocuments, setSupplierDocuments] = useState<
    Record<string, DocumentWithUploader[]>
  >({});
  const { data: session, isPending } = authClient.useSession();

  const userRole = session ? (session.user as { role?: string })?.role : undefined;

  // Redirect if not authenticated or authorized
  if (!isPending && !session) {
    router.push("/sign-in?redirect=/admin/suppliers");
  }
  if (!isPending && session?.user && userRole !== "super_user" && userRole !== "admin") {
    router.push("/dashboard");
  }

  // Fetch suppliers with TanStack Query
  const { data: suppliersData, isLoading, refetch: fetchSuppliers } = useQuery({
    queryKey: ["suppliers", "list", { filter, stats: true }],
    queryFn: async () => {
      const response = await fetch(`/api/suppliers?filter=${filter}&stats=true`);
      if (!response.ok) {
        throw new Error("Failed to fetch suppliers");
      }
      return response.json();
    },
    enabled: !isPending && !!session,
  });

  const suppliers: SupplierWithBrands[] = suppliersData?.suppliers || [];
  const stats = suppliersData?.stats || null;

  // Filter and sort suppliers by search term and name
  const filteredSuppliers = useMemo(() => {
    let result = suppliers;

    // Filter by search term
    if (searchTerm.trim()) {
      const search = searchTerm.toLowerCase();
      result = result.filter(
        (s) =>
          s.name.toLowerCase().includes(search) ||
          s.code.toLowerCase().includes(search)
      );
    }

    // Sort alphabetically by name (Hebrew)
    return result.sort((a, b) => a.name.localeCompare(b.name, "he"));
  }, [suppliers, searchTerm]);

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

  const fetchCommissionHistory = async (supplierId: string) => {
    try {
      setLoadingHistoryId(supplierId);
      const response = await fetch(
        `/api/suppliers/${supplierId}/commission-history`
      );
      if (!response.ok) {
        throw new Error("Failed to fetch commission history");
      }
      const data = await response.json();
      setCommissionHistories((prev) => ({
        ...prev,
        [supplierId]: data.history || [],
      }));
    } catch (error) {
      console.error("Error fetching commission history:", error);
    } finally {
      setLoadingHistoryId(null);
    }
  };

  const toggleHistoryExpanded = async (supplierId: string) => {
    if (expandedHistoryId === supplierId) {
      setExpandedHistoryId(null);
    } else {
      setExpandedHistoryId(supplierId);
      // Fetch history if not already loaded
      if (!commissionHistories[supplierId]) {
        await fetchCommissionHistory(supplierId);
      }
    }
  };

  const toggleFileMappingExpanded = (supplierId: string) => {
    if (expandedFileMappingId === supplierId) {
      setExpandedFileMappingId(null);
    } else {
      setExpandedFileMappingId(supplierId);
    }
  };

  const handleFileMappingSave = () => {
    // Invalidate the suppliers query to refetch the updated data
    queryClient.invalidateQueries({ queryKey: ["suppliers"] });
  };

  const fetchSupplierDocuments = async (supplierId: string) => {
    try {
      setLoadingDocumentsId(supplierId);
      const response = await fetch(`/api/documents/supplier/${supplierId}`);
      if (!response.ok) {
        throw new Error("Failed to fetch documents");
      }
      const data = await response.json();
      setSupplierDocuments((prev) => ({
        ...prev,
        [supplierId]: data.documents || [],
      }));
    } catch (error) {
      console.error("Error fetching documents:", error);
    } finally {
      setLoadingDocumentsId(null);
    }
  };

  const toggleDocumentsExpanded = async (supplierId: string) => {
    if (expandedDocumentsId === supplierId) {
      setExpandedDocumentsId(null);
    } else {
      setExpandedDocumentsId(supplierId);
      // Fetch documents if not already loaded
      if (!supplierDocuments[supplierId]) {
        await fetchSupplierDocuments(supplierId);
      }
    }
  };

  const handleDocumentsChange = (supplierId: string, documents: DocumentWithUploader[]) => {
    setSupplierDocuments((prev) => ({
      ...prev,
      [supplierId]: documents,
    }));
  };

  // Create supplier mutation
  const createSupplier = useMutation({
    mutationFn: async (data: typeof formData) => {
      const submitData = {
        ...data,
        defaultCommissionRate: data.defaultCommissionRate || null,
        commissionExceptions: formDataToCommissionExceptions(data.commissionExceptions),
      };
      const response = await fetch("/api/suppliers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(submitData),
      });
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to create supplier");
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["suppliers"] });
      setShowForm(false);
      setEditingSupplier(null);
      setFormData(initialFormData);
    },
    onError: (error: Error) => {
      setFormError(error.message);
    },
  });

  // Update supplier mutation
  const updateSupplier = useMutation({
    mutationFn: async ({ id, data, editingData }: { id: string; data: typeof formData; editingData: SupplierWithBrands }) => {
      const isCommissionChanging =
        data.defaultCommissionRate !== "" &&
        data.defaultCommissionRate !== (editingData.defaultCommissionRate || "");

      const submitData = {
        ...data,
        defaultCommissionRate: data.defaultCommissionRate || null,
        commissionExceptions: formDataToCommissionExceptions(data.commissionExceptions),
        ...(isCommissionChanging && {
          commissionChangeReason: data.commissionChangeReason,
          commissionChangeNotes: data.commissionChangeNotes,
          commissionEffectiveDate: data.commissionEffectiveDate,
        }),
      };

      const response = await fetch(`/api/suppliers/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(submitData),
      });
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to update supplier");
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["suppliers"] });
      setCommissionHistories({});
      setShowForm(false);
      setEditingSupplier(null);
      setFormData(initialFormData);
    },
    onError: (error: Error) => {
      setFormError(error.message);
    },
  });

  // Delete supplier mutation
  const deleteSupplier = useMutation({
    mutationFn: async (id: string) => {
      const response = await fetch(`/api/suppliers/${id}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to delete supplier");
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["suppliers"] });
    },
  });

  // Toggle status mutation
  const toggleStatusMutation = useMutation({
    mutationFn: async ({ id, isActive }: { id: string; isActive: boolean }) => {
      const response = await fetch(`/api/suppliers/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive }),
      });
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to update supplier status");
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["suppliers"] });
    },
    onError: (error: Error) => {
      alert(error.message);
    },
  });

  // Toggle hidden mutation
  const toggleHiddenMutation = useMutation({
    mutationFn: async ({ id, isHidden }: { id: string; isHidden: boolean }) => {
      const response = await fetch(`/api/suppliers/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isHidden }),
      });
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to update supplier hidden status");
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["suppliers"] });
    },
    onError: (error: Error) => {
      alert(error.message);
    },
  });

  const isSubmitting = createSupplier.isPending || updateSupplier.isPending;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (!formData.code || !formData.name) {
      setFormError("Code and name are required");
      return;
    }

    if (editingSupplier) {
      updateSupplier.mutate({ id: editingSupplier.id, data: formData, editingData: editingSupplier });
    } else {
      createSupplier.mutate(formData);
    }
  };

  const handleEdit = (supplier: SupplierWithBrands) => {
    setEditingSupplier(supplier);
    setFormData({
      code: supplier.code,
      name: supplier.name,
      companyId: supplier.companyId || "",
      description: supplier.description || "",
      contactName: supplier.contactName || "",
      contactEmail: supplier.contactEmail || "",
      contactPhone: supplier.contactPhone || "",
      secondaryContactName: supplier.secondaryContactName || "",
      secondaryContactEmail: supplier.secondaryContactEmail || "",
      secondaryContactPhone: supplier.secondaryContactPhone || "",
      address: supplier.address || "",
      paymentTerms: supplier.paymentTerms || "",
      defaultCommissionRate: supplier.defaultCommissionRate || "",
      commissionType: supplier.commissionType || "percentage",
      settlementFrequency: supplier.settlementFrequency || "monthly",
      vatIncluded: supplier.vatIncluded || false,
      isActive: supplier.isActive,
      isHidden: supplier.isHidden || false,
      brandIds: supplier.brands?.map((b) => b.id) || [],
      commissionExceptions: commissionExceptionsToFormData(supplier.commissionExceptions as CommissionException[] | null | undefined),
      bkmvAliases: supplier.bkmvAliases || [],
      commissionChangeReason: "",
      commissionChangeNotes: "",
      commissionEffectiveDate: new Date().toISOString().split("T")[0],
    });
    setShowForm(true);
    setFormError(null);
  };

  const handleDelete = async (supplierId: string) => {
    if (!confirm(he.admin.suppliers.confirmDelete)) {
      return;
    }
    deleteSupplier.mutate(supplierId);
  };

  const handleToggleStatus = async (supplier: SupplierWithBrands) => {
    toggleStatusMutation.mutate({ id: supplier.id, isActive: !supplier.isActive });
  };

  const handleToggleHidden = async (supplier: SupplierWithBrands) => {
    toggleHiddenMutation.mutate({ id: supplier.id, isHidden: !supplier.isHidden });
  };

  const cancelForm = () => {
    setShowForm(false);
    setEditingSupplier(null);
    setFormData(initialFormData);
    setFormError(null);
  };

  const handleBrandToggle = (brandId: string) => {
    setFormData((prev) => {
      const newBrandIds = prev.brandIds.includes(brandId)
        ? prev.brandIds.filter((id) => id !== brandId)
        : [...prev.brandIds, brandId];
      return { ...prev, brandIds: newBrandIds };
    });
  };

  // Check if commission rate is being changed (for form UI)
  const isCommissionRateChanging =
    editingSupplier &&
    formData.defaultCommissionRate !== "" &&
    formData.defaultCommissionRate !==
      (editingSupplier.defaultCommissionRate || "");

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
        <h1 className="text-3xl font-bold">{he.admin.suppliers.title}</h1>
      </div>

      {/* Stats Cards */}
      {stats && (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4 mb-8">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">{he.admin.suppliers.stats.totalSuppliers}</CardTitle>
              <Truck className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.total}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">{he.admin.suppliers.stats.activeSuppliers}</CardTitle>
              <Check className="h-4 w-4 text-green-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.active}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">{he.admin.suppliers.stats.inactiveSuppliers}</CardTitle>
              <X className="h-4 w-4 text-red-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.inactive}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">{he.admin.suppliers.stats.hiddenSuppliers}</CardTitle>
              <Eye className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.hidden}</div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Filter and Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <div className="flex flex-wrap items-center gap-4">
          <Select
            value={filter}
            onValueChange={(value) => setFilter(value as "all" | "active")}
          >
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder={he.common.filter} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{he.admin.suppliers.filters.allSuppliers}</SelectItem>
              <SelectItem value="active">{he.admin.suppliers.filters.activeOnly}</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" onClick={() => fetchSuppliers()}>
            <RefreshCw className="me-2 h-4 w-4" />
            {he.common.refresh}
          </Button>
        </div>
        <Button onClick={() => { setShowForm(true); setEditingSupplier(null); setFormData(initialFormData); }} className="w-full sm:w-auto">
          <Plus className="me-2 h-4 w-4" />
          {he.common.create}
        </Button>
      </div>

      {/* Supplier Form Modal */}
      <Dialog open={showForm} onOpenChange={(open) => { if (!open) cancelForm(); }}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingSupplier ? he.admin.suppliers.form.editTitle : he.admin.suppliers.form.createTitle}</DialogTitle>
            <DialogDescription>
              {editingSupplier
                ? he.admin.suppliers.form.editDescription
                : he.admin.suppliers.form.createDescription}
            </DialogDescription>
          </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4">
              {formError && (
                <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-3">
                  <p className="text-sm text-destructive">{formError}</p>
                </div>
              )}

              {/* Basic Information - Compact */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                <div className="space-y-1">
                  <Label htmlFor="code" className="text-xs">{he.admin.suppliers.form.fields.code} *</Label>
                  <Input
                    id="code"
                    value={formData.code}
                    onChange={(e) => setFormData({ ...formData, code: e.target.value.toUpperCase() })}
                    placeholder={he.admin.suppliers.form.fields.codePlaceholder}
                    disabled={isSubmitting}
                    required
                    className="h-8"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="name" className="text-xs">{he.admin.suppliers.form.fields.name} *</Label>
                  <Input
                    id="name"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    placeholder={he.admin.suppliers.form.fields.namePlaceholder}
                    disabled={isSubmitting}
                    required
                    dir="rtl"
                    className="h-8"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="companyId" className="text-xs">{he.admin.suppliers.form.fields.companyId}</Label>
                  <Input
                    id="companyId"
                    value={formData.companyId}
                    onChange={(e) => setFormData({ ...formData, companyId: e.target.value })}
                    placeholder={he.admin.suppliers.form.fields.companyIdPlaceholder}
                    disabled={isSubmitting}
                    className="h-8"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="address" className="text-xs">{he.admin.suppliers.form.fields.address}</Label>
                  <Input
                    id="address"
                    value={formData.address}
                    onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                    placeholder={he.admin.suppliers.form.fields.addressPlaceholder}
                    disabled={isSubmitting}
                    dir="rtl"
                    className="h-8"
                  />
                </div>
              </div>

              {/* Contacts - Combined Collapsible */}
              <Collapsible defaultOpen={!!(formData.contactName || formData.contactEmail || formData.contactPhone || formData.secondaryContactName || formData.secondaryContactEmail || formData.secondaryContactPhone)}>
                <CollapsibleTrigger className="flex items-center gap-2 w-full p-2 rounded-md border bg-muted/50 hover:bg-muted transition-colors">
                  <Users className="h-3.5 w-3.5" />
                  <span className="text-sm font-medium">אנשי קשר</span>
                  {(formData.contactName || formData.contactEmail || formData.secondaryContactName || formData.secondaryContactEmail) && (
                    <Check className="h-3.5 w-3.5 text-green-500" />
                  )}
                  <ChevronDown className="h-3.5 w-3.5 ms-auto transition-transform data-[state=open]:rotate-180" />
                </CollapsibleTrigger>
                <CollapsibleContent className="pt-2">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {/* Primary Contact */}
                    <div className="space-y-2 p-2 rounded-md bg-muted/30">
                      <p className="text-xs font-medium text-muted-foreground">{he.admin.suppliers.form.sections.primaryContact}</p>
                      <div className="grid grid-cols-3 gap-2">
                        <Input
                          id="contactName"
                          value={formData.contactName}
                          onChange={(e) => setFormData({ ...formData, contactName: e.target.value })}
                          placeholder="שם"
                          disabled={isSubmitting}
                          dir="rtl"
                          className="h-8 text-sm"
                        />
                        <Input
                          id="contactEmail"
                          type="email"
                          value={formData.contactEmail}
                          onChange={(e) => setFormData({ ...formData, contactEmail: e.target.value })}
                          placeholder="אימייל"
                          disabled={isSubmitting}
                          className="h-8 text-sm"
                        />
                        <Input
                          id="contactPhone"
                          value={formData.contactPhone}
                          onChange={(e) => setFormData({ ...formData, contactPhone: e.target.value })}
                          placeholder="טלפון"
                          disabled={isSubmitting}
                          className="h-8 text-sm"
                        />
                      </div>
                    </div>
                    {/* Secondary Contact */}
                    <div className="space-y-2 p-2 rounded-md bg-muted/30">
                      <p className="text-xs font-medium text-muted-foreground">{he.admin.suppliers.form.sections.secondaryContact}</p>
                      <div className="grid grid-cols-3 gap-2">
                        <Input
                          id="secondaryContactName"
                          value={formData.secondaryContactName}
                          onChange={(e) => setFormData({ ...formData, secondaryContactName: e.target.value })}
                          placeholder="שם"
                          disabled={isSubmitting}
                          dir="rtl"
                          className="h-8 text-sm"
                        />
                        <Input
                          id="secondaryContactEmail"
                          type="email"
                          value={formData.secondaryContactEmail}
                          onChange={(e) => setFormData({ ...formData, secondaryContactEmail: e.target.value })}
                          placeholder="אימייל"
                          disabled={isSubmitting}
                          className="h-8 text-sm"
                        />
                        <Input
                          id="secondaryContactPhone"
                          value={formData.secondaryContactPhone}
                          onChange={(e) => setFormData({ ...formData, secondaryContactPhone: e.target.value })}
                          placeholder="טלפון"
                          disabled={isSubmitting}
                          className="h-8 text-sm"
                        />
                      </div>
                    </div>
                  </div>
                </CollapsibleContent>
              </Collapsible>

              {/* Commission Settings */}
              <div className="space-y-2">
                <h3 className="text-base font-semibold flex items-center gap-2">
                  <Percent className="h-4 w-4" />
                  {he.admin.suppliers.form.sections.commissionSettings}
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label htmlFor="defaultCommissionRate">{he.admin.suppliers.form.fields.commissionRate}</Label>
                    <div className="flex items-center gap-2">
                      <Input
                        id="defaultCommissionRate"
                        type="number"
                        step="0.01"
                        min="0"
                        max="100"
                        value={formData.defaultCommissionRate}
                        onChange={(e) => setFormData({ ...formData, defaultCommissionRate: e.target.value })}
                        placeholder={he.admin.suppliers.form.fields.commissionRatePlaceholder}
                        disabled={isSubmitting}
                        className="w-28"
                      />
                      <span className="text-muted-foreground">%</span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      חל על כל הפריטים, אלא אם הוגדרו חריגות
                    </p>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="settlementFrequency">{he.admin.suppliers.form.fields.settlementFrequency}</Label>
                    <Select
                      value={formData.settlementFrequency}
                      onValueChange={(value: SettlementFrequency) =>
                        setFormData({ ...formData, settlementFrequency: value })
                      }
                      disabled={isSubmitting}
                    >
                      <SelectTrigger id="settlementFrequency">
                        <SelectValue placeholder={he.admin.suppliers.form.fields.settlementFrequencyPlaceholder} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="monthly">{he.admin.suppliers.form.fields.settlementMonthly}</SelectItem>
                        <SelectItem value="quarterly">{he.admin.suppliers.form.fields.settlementQuarterly}</SelectItem>
                        <SelectItem value="semi_annual">{he.admin.suppliers.form.fields.settlementSemiAnnual}</SelectItem>
                        <SelectItem value="annual">{he.admin.suppliers.form.fields.settlementAnnual}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="flex items-center gap-4">
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="vatIncluded"
                      checked={formData.vatIncluded}
                      onCheckedChange={(checked) =>
                        setFormData({ ...formData, vatIncluded: checked as boolean })
                      }
                      disabled={isSubmitting}
                    />
                    <Label htmlFor="vatIncluded" className="cursor-pointer">
                      {he.admin.suppliers.form.fields.vatIncluded}
                    </Label>
                  </div>
                </div>

                {/* Commission Exceptions */}
                <CommissionExceptionsEditor
                  exceptions={formData.commissionExceptions}
                  onChange={(exceptions) => setFormData({ ...formData, commissionExceptions: exceptions })}
                  disabled={isSubmitting}
                />

                {/* Commission Change Log Fields (only show when editing and rate is changing) */}
                {isCommissionRateChanging && (
                  <div className="rounded-lg border border-amber-500/50 bg-amber-50 dark:bg-amber-900/20 p-4 space-y-4">
                    <div className="flex items-center gap-2 text-amber-700 dark:text-amber-400">
                      <History className="h-5 w-5" />
                      <span className="font-medium">
                        {he.admin.suppliers.form.commissionChange.title}
                      </span>
                    </div>
                    <p className="text-sm text-amber-600 dark:text-amber-300">
                      {he.admin.suppliers.form.commissionChange.changingFrom
                        .replace("{from}", editingSupplier?.defaultCommissionRate || "0")
                        .replace("{to}", formData.defaultCommissionRate)}
                    </p>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="commissionEffectiveDate">
                          {he.admin.suppliers.form.commissionChange.effectiveDate} *
                        </Label>
                        <Input
                          id="commissionEffectiveDate"
                          type="date"
                          value={formData.commissionEffectiveDate}
                          onChange={(e) =>
                            setFormData({
                              ...formData,
                              commissionEffectiveDate: e.target.value,
                            })
                          }
                          disabled={isSubmitting}
                          required
                        />
                      </div>

                      <div className="space-y-2 md:col-span-2">
                        <Label htmlFor="commissionChangeReason">
                          {he.admin.suppliers.form.commissionChange.reason}
                        </Label>
                        <Input
                          id="commissionChangeReason"
                          value={formData.commissionChangeReason}
                          onChange={(e) =>
                            setFormData({
                              ...formData,
                              commissionChangeReason: e.target.value,
                            })
                          }
                          placeholder={he.admin.suppliers.form.commissionChange.reasonPlaceholder}
                          disabled={isSubmitting}
                        />
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="commissionChangeNotes">
                        {he.admin.suppliers.form.commissionChange.additionalNotes}
                      </Label>
                      <Input
                        id="commissionChangeNotes"
                        value={formData.commissionChangeNotes}
                        onChange={(e) =>
                          setFormData({
                            ...formData,
                            commissionChangeNotes: e.target.value,
                          })
                        }
                        placeholder={he.admin.suppliers.form.commissionChange.notesPlaceholder}
                        disabled={isSubmitting}
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Payment */}
              <div className="space-y-2">
                <h3 className="text-base font-semibold flex items-center gap-2">
                  <Hash className="h-4 w-4" />
                  {he.admin.suppliers.form.sections.taxPayment}
                </h3>
                <div className="space-y-2">
                  <Label htmlFor="paymentTerms">{he.admin.suppliers.form.fields.paymentTerms}</Label>
                  <Input
                    id="paymentTerms"
                    value={formData.paymentTerms}
                    onChange={(e) => setFormData({ ...formData, paymentTerms: e.target.value })}
                    placeholder={he.admin.suppliers.form.fields.paymentTermsPlaceholder}
                    disabled={isSubmitting}
                  />
                </div>
              </div>

              {/* Associated Brands */}
              {brands.length > 0 && (
                <div className="space-y-2">
                  <h3 className="text-base font-semibold">{he.admin.suppliers.form.sections.associatedBrands}</h3>
                  <div className="flex flex-wrap gap-3">
                    {brands.map((brand) => (
                      <div
                        key={brand.id}
                        className="flex items-center space-x-2"
                      >
                        <Checkbox
                          id={`brand-${brand.id}`}
                          checked={formData.brandIds.includes(brand.id)}
                          onCheckedChange={() => handleBrandToggle(brand.id)}
                          disabled={isSubmitting}
                        />
                        <Label
                          htmlFor={`brand-${brand.id}`}
                          className="cursor-pointer"
                        >
                          {brand.nameHe}
                          {brand.nameEn && (
                            <span className="text-muted-foreground text-sm ms-1">
                              ({brand.nameEn})
                            </span>
                          )}
                        </Label>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* BKMV Aliases - Collapsible */}
              <Collapsible defaultOpen={formData.bkmvAliases.length > 0}>
                <CollapsibleTrigger className="flex items-center gap-2 w-full p-3 rounded-lg border bg-muted/50 hover:bg-muted transition-colors">
                  <Tags className="h-4 w-4" />
                  <span className="text-base font-semibold">{he.admin.suppliers.form.sections.bkmvAliases}</span>
                  {formData.bkmvAliases.length > 0 && (
                    <Badge variant="secondary" className="ms-2">
                      {formData.bkmvAliases.length}
                    </Badge>
                  )}
                  <ChevronDown className="h-4 w-4 ms-auto transition-transform data-[state=open]:rotate-180" />
                </CollapsibleTrigger>
                <CollapsibleContent className="pt-3 space-y-3">
                  <p className="text-sm text-muted-foreground">
                    {he.admin.suppliers.form.fields.bkmvAliasesDescription}
                  </p>

                  {/* Existing aliases */}
                  {formData.bkmvAliases.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {formData.bkmvAliases.map((alias, index) => (
                        <Badge
                          key={index}
                          variant="outline"
                          className="py-1.5 px-3 text-sm flex items-center gap-2"
                        >
                          {alias}
                          <button
                            type="button"
                            onClick={() => {
                              setFormData({
                                ...formData,
                                bkmvAliases: formData.bkmvAliases.filter((_, i) => i !== index),
                              });
                            }}
                            className="text-muted-foreground hover:text-destructive transition-colors"
                            disabled={isSubmitting}
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </Badge>
                      ))}
                    </div>
                  )}

                  {/* Add new alias */}
                  <div className="flex gap-2">
                    <Input
                      value={newAliasInput}
                      onChange={(e) => setNewAliasInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          const trimmed = newAliasInput.trim();
                          if (trimmed && !formData.bkmvAliases.includes(trimmed)) {
                            setFormData({
                              ...formData,
                              bkmvAliases: [...formData.bkmvAliases, trimmed],
                            });
                            setNewAliasInput("");
                          }
                        }
                      }}
                      placeholder={he.admin.suppliers.form.fields.bkmvAliasesPlaceholder}
                      disabled={isSubmitting}
                      className="flex-1"
                      dir="rtl"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => {
                        const trimmed = newAliasInput.trim();
                        if (trimmed && !formData.bkmvAliases.includes(trimmed)) {
                          setFormData({
                            ...formData,
                            bkmvAliases: [...formData.bkmvAliases, trimmed],
                          });
                          setNewAliasInput("");
                        }
                      }}
                      disabled={isSubmitting || !newAliasInput.trim()}
                    >
                      <Plus className="h-4 w-4 me-2" />
                      {he.admin.suppliers.form.fields.addAlias}
                    </Button>
                  </div>

                  {formData.bkmvAliases.length === 0 && (
                    <p className="text-sm text-muted-foreground italic">
                      {he.admin.suppliers.form.fields.noAliases}
                    </p>
                  )}
                </CollapsibleContent>
              </Collapsible>

              {/* Status */}
              <div className="flex flex-col gap-4">
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="isActive"
                    checked={formData.isActive}
                    onCheckedChange={(checked) =>
                      setFormData({ ...formData, isActive: checked as boolean })
                    }
                    disabled={isSubmitting}
                  />
                  <Label htmlFor="isActive" className="cursor-pointer">
                    {he.admin.suppliers.form.fields.isActive}
                  </Label>
                </div>

                <div className="flex items-start gap-2">
                  <Checkbox
                    id="isHidden"
                    checked={formData.isHidden}
                    onCheckedChange={(checked) =>
                      setFormData({ ...formData, isHidden: checked as boolean })
                    }
                    disabled={isSubmitting}
                  />
                  <div className="flex flex-col gap-1">
                    <Label htmlFor="isHidden" className="cursor-pointer">
                      {he.admin.suppliers.form.fields.isHidden}
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      {he.admin.suppliers.form.fields.isHiddenDescription}
                    </p>
                  </div>
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-4">
                <Button type="button" variant="outline" onClick={cancelForm} disabled={isSubmitting}>
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
                      {editingSupplier ? he.common.update : he.common.create}
                    </>
                  )}
                </Button>
              </div>
            </form>
        </DialogContent>
      </Dialog>

      {/* Suppliers List */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Truck className="h-5 w-5" />
            {filter === "active" ? he.admin.suppliers.list.titleActive : he.admin.suppliers.list.title}
          </CardTitle>
          <CardDescription>
            {he.admin.suppliers.list.description}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {/* Search Input */}
          <div className="relative mb-4">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              type="text"
              placeholder="חיפוש לפי שם או קוד..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pr-10"
            />
          </div>

          {filteredSuppliers.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              {searchTerm.trim()
                ? "לא נמצאו ספקים התואמים לחיפוש"
                : filter === "active"
                  ? he.admin.suppliers.empty.noActiveSuppliers
                  : he.admin.suppliers.empty.noSuppliers}
            </div>
          ) : (
            <div className="space-y-4">
              {filteredSuppliers.map((supplier) => (
                <div key={supplier.id} className="rounded-lg border bg-card">
                  <div className="flex flex-col gap-4 p-4">
                    <div className="space-y-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-medium text-lg">{supplier.name}</p>
                        <Badge variant={supplier.isActive ? "success" : "secondary"}>
                          {supplier.isActive ? he.common.active : he.common.inactive}
                        </Badge>
                        {supplier.isHidden && (
                          <Badge variant="destructive" className="flex items-center gap-1">
                            {he.admin.suppliers.badge.hidden}
                          </Badge>
                        )}
                        {supplier.defaultCommissionRate && (
                          <Badge variant="outline" className="flex items-center gap-1">
                            <Percent className="h-3 w-3" />
                            {supplier.defaultCommissionRate}%
                          </Badge>
                        )}
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2 text-sm text-muted-foreground">
                        <p>
                          <span className="font-medium">{he.admin.suppliers.card.code}</span>{" "}
                          <span className="font-mono">{supplier.code}</span>
                        </p>
                        {supplier.companyId && (
                          <p>
                            <span className="font-medium">{he.admin.suppliers.card.companyId}</span> {supplier.companyId}
                          </p>
                        )}
                        {supplier.settlementFrequency && (
                          <p>
                            <span className="font-medium">{he.admin.suppliers.card.settlement}</span>{" "}
                            {supplier.settlementFrequency === "weekly" ? he.admin.suppliers.form.fields.settlementWeekly :
                             supplier.settlementFrequency === "bi_weekly" ? he.admin.suppliers.form.fields.settlementBiWeekly :
                             supplier.settlementFrequency === "monthly" ? he.admin.suppliers.form.fields.settlementMonthly :
                             supplier.settlementFrequency === "quarterly" ? he.admin.suppliers.form.fields.settlementQuarterly :
                             String(supplier.settlementFrequency).replace("_", "-")}
                          </p>
                        )}
                        {supplier.vatIncluded !== null && (
                          <p>
                            <span className="font-medium">{he.admin.suppliers.card.vat}</span>{" "}
                            {supplier.vatIncluded ? he.admin.suppliers.card.vatIncluded : he.admin.suppliers.card.vatNotIncluded}
                          </p>
                        )}
                        {supplier.contactName && (
                          <p>
                            <span className="font-medium">{he.admin.suppliers.card.contact}</span> {supplier.contactName}
                          </p>
                        )}
                      </div>
                      {supplier.brands && supplier.brands.length > 0 && (
                        <div className="flex items-center gap-2 flex-wrap mt-2">
                          <span className="text-sm font-medium">{he.admin.suppliers.card.brands}</span>
                          {supplier.brands.map((brand) => (
                            <Badge key={brand.id} variant="outline">
                              {brand.nameHe}
                            </Badge>
                          ))}
                        </div>
                      )}
                      <p className="text-xs text-muted-foreground">
                        {he.admin.suppliers.card.created} {new Date(supplier.createdAt).toLocaleDateString("he-IL")}
                      </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <Link href={`/admin/suppliers/${supplier.id}`}>
                        <Button size="sm" variant="default">
                          <Eye className="h-4 w-4 me-1" />
                          {he.admin.suppliers.actions.view}
                        </Button>
                      </Link>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => toggleHistoryExpanded(supplier.id)}
                        disabled={loadingHistoryId === supplier.id}
                      >
                        {loadingHistoryId === supplier.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <>
                            <History className="h-4 w-4 me-1" />
                            {he.admin.suppliers.actions.history}
                            {expandedHistoryId === supplier.id ? (
                              <ChevronUp className="h-4 w-4 ms-1" />
                            ) : (
                              <ChevronDown className="h-4 w-4 ms-1" />
                            )}
                          </>
                        )}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => toggleFileMappingExpanded(supplier.id)}
                      >
                        <FileSpreadsheet className="h-4 w-4 me-1" />
                        {he.admin.suppliers.actions.fileMapping}
                        {supplier.fileMapping && (
                          <Badge variant="secondary" className="ms-1 px-1 py-0 text-xs">
                            {he.admin.suppliers.actions.set}
                          </Badge>
                        )}
                        {expandedFileMappingId === supplier.id ? (
                          <ChevronUp className="h-4 w-4 ms-1" />
                        ) : (
                          <ChevronDown className="h-4 w-4 ms-1" />
                        )}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => toggleDocumentsExpanded(supplier.id)}
                        disabled={loadingDocumentsId === supplier.id}
                      >
                        {loadingDocumentsId === supplier.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <>
                            <FileText className="h-4 w-4 me-1" />
                            {he.admin.suppliers.actions.documents}
                            {supplierDocuments[supplier.id]?.length > 0 && (
                              <Badge variant="secondary" className="ms-1 px-1 py-0 text-xs">
                                {supplierDocuments[supplier.id].length}
                              </Badge>
                            )}
                            {expandedDocumentsId === supplier.id ? (
                              <ChevronUp className="h-4 w-4 ms-1" />
                            ) : (
                              <ChevronDown className="h-4 w-4 ms-1" />
                            )}
                          </>
                        )}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleToggleStatus(supplier)}
                      >
                        {supplier.isActive ? he.admin.suppliers.actions.deactivate : he.admin.suppliers.actions.activate}
                      </Button>
                      <Button
                        size="sm"
                        variant={supplier.isHidden ? "default" : "outline"}
                        onClick={() => handleToggleHidden(supplier)}
                      >
                        {supplier.isHidden ? he.admin.suppliers.actions.show : he.admin.suppliers.actions.hide}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleEdit(supplier)}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      {userRole === "super_user" && (
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={() => handleDelete(supplier.id)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </div>

                  {/* Commission History Panel */}
                  {expandedHistoryId === supplier.id && (
                    <div className="border-t bg-muted/30 p-4">
                      <h4 className="font-semibold mb-3 flex items-center gap-2">
                        <History className="h-4 w-4" />
                        {he.admin.suppliers.history.title}
                      </h4>
                      {commissionHistories[supplier.id]?.length > 0 ? (
                        <div className="space-y-2">
                          {commissionHistories[supplier.id].map((entry) => (
                            <div
                              key={entry.id}
                              className="flex items-start justify-between p-3 rounded-lg bg-card border text-sm"
                            >
                              <div className="space-y-1">
                                <div className="flex items-center gap-2">
                                  <span className="font-medium">
                                    {entry.previousRate ?? he.common.notApplicable}% → {entry.newRate}%
                                  </span>
                                  <Badge variant="outline" className="text-xs">
                                    <Calendar className="h-3 w-3 me-1" />
                                    {new Date(entry.effectiveDate).toLocaleDateString("he-IL")}
                                  </Badge>
                                </div>
                                {entry.reason && (
                                  <p className="text-muted-foreground">
                                    <strong>{he.admin.suppliers.history.reason}</strong> {entry.reason}
                                  </p>
                                )}
                                {entry.notes && (
                                  <p className="text-muted-foreground">
                                    <strong>{he.admin.suppliers.history.notes}</strong> {entry.notes}
                                  </p>
                                )}
                              </div>
                              <div className="text-xs text-muted-foreground text-end">
                                <div className="flex items-center gap-1">
                                  <User className="h-3 w-3" />
                                  {entry.createdByUser?.name || he.admin.suppliers.history.system}
                                </div>
                                <div>
                                  {new Date(entry.createdAt).toLocaleString("he-IL")}
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-sm text-muted-foreground">
                          {he.admin.suppliers.history.noChanges}
                        </p>
                      )}
                    </div>
                  )}

                  {/* File Mapping Configuration Panel */}
                  {expandedFileMappingId === supplier.id && (
                    <div className="border-t bg-muted/30 p-4">
                      <FileMappingConfig
                        supplierId={supplier.id}
                        initialFileMapping={supplier.fileMapping}
                        onSave={() => handleFileMappingSave()}
                      />
                    </div>
                  )}

                  {/* Documents Panel */}
                  {expandedDocumentsId === supplier.id && (
                    <div className="border-t bg-muted/30 p-4">
                      <DocumentManager
                        entityType="supplier"
                        entityId={supplier.id}
                        entityName={supplier.name}
                        documents={supplierDocuments[supplier.id] || []}
                        onDocumentsChange={(docs) => handleDocumentsChange(supplier.id, docs)}
                        canUpload={userRole === "super_user" || userRole === "admin"}
                        canDelete={userRole === "super_user"}
                        canEdit={userRole === "super_user" || userRole === "admin"}
                      />
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
