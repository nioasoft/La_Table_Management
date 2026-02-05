"use client";

import { useState, useMemo } from "react";
import { formatDateAsLocal } from "@/lib/date-utils";
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
  Info,
} from "lucide-react";
import type { Supplier, Brand, CommissionType, SettlementFrequency, SupplierFileMapping, Document, CommissionException } from "@/db/schema";
import { FileMappingConfig } from "@/components/file-mapping-config";
import { hasCommissionFromFile } from "@/lib/custom-parsers/suppliers-with-file-commission";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
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
  vatExempt: boolean;
  isActive: boolean;
  isHidden: boolean;
  brandIds: string[];
  commissionExceptions: CommissionExceptionFormData[];
  bkmvAliases: string[];
  hashavshevetCode: string;
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
  vatExempt: false,
  isActive: true,
  isHidden: false,
  brandIds: [],
  commissionExceptions: [],
  bkmvAliases: [],
  hashavshevetCode: "",
  commissionChangeReason: "",
  commissionChangeNotes: "",
  commissionEffectiveDate: formatDateAsLocal(new Date()),
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
  const [showArchiveConfirm, setShowArchiveConfirm] = useState(false);
  const [archiveConfirmText, setArchiveConfirmText] = useState("");
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

  // Archive supplier mutation (soft delete)
  const archiveSupplier = useMutation({
    mutationFn: async (id: string) => {
      const response = await fetch(`/api/suppliers/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isArchived: true, isActive: false, isHidden: true }),
      });
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to archive supplier");
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["suppliers"] });
      setShowForm(false);
      setEditingSupplier(null);
      setShowArchiveConfirm(false);
      setArchiveConfirmText("");
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
      vatExempt: supplier.vatExempt || false,
      isActive: supplier.isActive,
      isHidden: supplier.isHidden || false,
      brandIds: supplier.brands?.map((b) => b.id) || [],
      commissionExceptions: commissionExceptionsToFormData(supplier.commissionExceptions as CommissionException[] | null | undefined),
      bkmvAliases: supplier.bkmvAliases || [],
      hashavshevetCode: supplier.hashavshevetCode || "",
      commissionChangeReason: "",
      commissionChangeNotes: "",
      commissionEffectiveDate: formatDateAsLocal(new Date()),
    });
    setShowForm(true);
    setFormError(null);
  };

  const handleArchive = () => {
    if (!editingSupplier) return;
    if (archiveConfirmText !== editingSupplier.code) return;
    archiveSupplier.mutate(editingSupplier.id);
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
    setShowArchiveConfirm(false);
    setArchiveConfirmText("");
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
    <div className="container mx-auto p-4">
      {/* Header with stats */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-bold">{he.admin.suppliers.title}</h1>
          {stats && (
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="text-xs">
                <Truck className="h-3 w-3 me-1" />
                {stats.total}
              </Badge>
              <Badge variant="outline" className="text-xs text-green-600 border-green-200">
                <Check className="h-3 w-3 me-1" />
                {stats.active}
              </Badge>
              {stats.inactive > 0 && (
                <Badge variant="outline" className="text-xs text-red-600 border-red-200">
                  <X className="h-3 w-3 me-1" />
                  {stats.inactive}
                </Badge>
              )}
              {stats.hidden > 0 && (
                <Badge variant="outline" className="text-xs text-muted-foreground">
                  <Eye className="h-3 w-3 me-1" />
                  {stats.hidden}
                </Badge>
              )}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Select
            value={filter}
            onValueChange={(value) => setFilter(value as "all" | "active")}
          >
            <SelectTrigger className="w-[140px] h-8 text-sm">
              <SelectValue placeholder={he.common.filter} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{he.admin.suppliers.filters.allSuppliers}</SelectItem>
              <SelectItem value="active">{he.admin.suppliers.filters.activeOnly}</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={() => fetchSuppliers()} title={he.common.refresh}>
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
          <Button size="sm" onClick={() => { setShowForm(true); setEditingSupplier(null); setFormData(initialFormData); }}>
            <Plus className="h-3.5 w-3.5 me-1" />
            {he.common.create}
          </Button>
        </div>
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

                    {editingSupplier && hasCommissionFromFile(editingSupplier.code) && (
                      <Badge variant="secondary" className="text-xs">
                        <FileText className="h-3 w-3 me-1" />
                        העמלה נלקחת מהקובץ
                      </Badge>
                    )}

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
                        disabled={isSubmitting || (editingSupplier ? hasCommissionFromFile(editingSupplier.code) : false)}
                        className="w-28"
                      />
                      <span className="text-muted-foreground">%</span>
                      {editingSupplier && hasCommissionFromFile(editingSupplier.code) && (
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Info className="h-4 w-4 text-muted-foreground cursor-help" />
                            </TooltipTrigger>
                            <TooltipContent>
                              <p>לספק זה העמלה מחושבת אוטומטית מהקובץ</p>
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {editingSupplier && hasCommissionFromFile(editingSupplier.code)
                        ? "העמלה מחושבת ישירות מקובץ הספק"
                        : "חל על כל הפריטים, אלא אם הוגדרו חריגות"}
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
                      id="vatExempt"
                      checked={formData.vatExempt}
                      onCheckedChange={(checked) =>
                        setFormData({
                          ...formData,
                          vatExempt: checked as boolean,
                          vatIncluded: checked ? false : formData.vatIncluded,
                        })
                      }
                      disabled={isSubmitting}
                    />
                    <Label htmlFor="vatExempt" className="cursor-pointer">
                      {he.admin.suppliers.form.fields.vatExempt}
                    </Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="vatIncluded"
                      checked={formData.vatIncluded}
                      onCheckedChange={(checked) =>
                        setFormData({ ...formData, vatIncluded: checked as boolean })
                      }
                      disabled={isSubmitting || formData.vatExempt}
                    />
                    <Label htmlFor="vatIncluded" className={`cursor-pointer ${formData.vatExempt ? "text-muted-foreground" : ""}`}>
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
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
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
                  <div className="space-y-2">
                    <Label htmlFor="hashavshevetCode">קוד חשבשבת</Label>
                    <Input
                      id="hashavshevetCode"
                      value={formData.hashavshevetCode}
                      onChange={(e) => setFormData({ ...formData, hashavshevetCode: e.target.value })}
                      placeholder="קוד מפתח חשבון"
                      disabled={isSubmitting}
                    />
                    <p className="text-xs text-muted-foreground">
                      קוד הספק במערכת חשבשבת לייבוא עמלות
                    </p>
                  </div>
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
              <div className="flex items-center gap-4 p-2 rounded-md bg-muted/30">
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="isActive"
                    checked={formData.isActive}
                    onCheckedChange={(checked) =>
                      setFormData({ ...formData, isActive: checked as boolean })
                    }
                    disabled={isSubmitting}
                  />
                  <Label htmlFor="isActive" className="cursor-pointer text-sm">
                    {he.admin.suppliers.form.fields.isActive}
                  </Label>
                </div>

                <div className="flex items-center gap-2">
                  <Checkbox
                    id="isHidden"
                    checked={formData.isHidden}
                    onCheckedChange={(checked) =>
                      setFormData({ ...formData, isHidden: checked as boolean })
                    }
                    disabled={isSubmitting}
                  />
                  <Label htmlFor="isHidden" className="cursor-pointer text-sm">
                    {he.admin.suppliers.form.fields.isHidden}
                  </Label>
                </div>
              </div>

              {/* Archive Section - Only when editing */}
              {editingSupplier && userRole === "super_user" && (
                <Collapsible open={showArchiveConfirm} onOpenChange={setShowArchiveConfirm}>
                  <CollapsibleTrigger className="flex items-center gap-2 w-full p-2 rounded-md border border-destructive/30 bg-destructive/5 hover:bg-destructive/10 transition-colors text-destructive">
                    <Trash2 className="h-3.5 w-3.5" />
                    <span className="text-sm font-medium">העבר לארכיון</span>
                    <ChevronDown className="h-3.5 w-3.5 ms-auto transition-transform data-[state=open]:rotate-180" />
                  </CollapsibleTrigger>
                  <CollapsibleContent className="pt-3">
                    <div className="p-3 rounded-md border border-destructive/30 bg-destructive/5 space-y-3">
                      <p className="text-sm text-destructive">
                        פעולה זו תעביר את הספק לארכיון. הספק לא יימחק אך יהיה מוסתר ולא פעיל.
                      </p>
                      <p className="text-sm">
                        להמשך, הקלד את קוד הספק: <strong className="font-mono">{editingSupplier.code}</strong>
                      </p>
                      <Input
                        value={archiveConfirmText}
                        onChange={(e) => setArchiveConfirmText(e.target.value.toUpperCase())}
                        placeholder="הקלד קוד ספק לאישור"
                        className="h-8 text-sm font-mono"
                        disabled={archiveSupplier.isPending}
                      />
                      <Button
                        type="button"
                        variant="destructive"
                        size="sm"
                        onClick={handleArchive}
                        disabled={archiveConfirmText !== editingSupplier.code || archiveSupplier.isPending}
                        className="w-full"
                      >
                        {archiveSupplier.isPending ? (
                          <Loader2 className="h-4 w-4 animate-spin me-2" />
                        ) : (
                          <Trash2 className="h-4 w-4 me-2" />
                        )}
                        אשר העברה לארכיון
                      </Button>
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              )}

              <div className="flex justify-end gap-2 pt-2">
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
      <div className="border rounded-lg">
        {/* Search */}
        <div className="p-3 border-b bg-muted/30">
          <div className="relative">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              type="text"
              placeholder="חיפוש לפי שם או קוד..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="h-8 text-sm pr-9"
            />
          </div>
        </div>

        {/* List */}
        <div className="divide-y">
          {filteredSuppliers.length === 0 ? (
            <div className="text-center py-6 text-sm text-muted-foreground">
              {searchTerm.trim()
                ? "לא נמצאו ספקים התואמים לחיפוש"
                : filter === "active"
                  ? he.admin.suppliers.empty.noActiveSuppliers
                  : he.admin.suppliers.empty.noSuppliers}
            </div>
          ) : (
            filteredSuppliers.map((supplier) => (
              <div key={supplier.id} className="hover:bg-muted/30 transition-colors">
                <div className="p-3">
                  {/* Row 1: Name + badges + actions */}
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <button
                        type="button"
                        onClick={() => handleEdit(supplier)}
                        className="font-medium truncate hover:text-primary hover:underline transition-colors text-start"
                      >
                        {supplier.name}
                      </button>
                      {supplier.contactName && (
                        <span className="text-xs text-muted-foreground">{supplier.contactName}</span>
                      )}
                      <span className="text-xs text-muted-foreground font-mono">{supplier.code}</span>
                      {!supplier.isActive && (
                        <Badge variant="secondary" className="text-xs px-1.5 py-0">לא פעיל</Badge>
                      )}
                      {supplier.isHidden && (
                        <Badge variant="destructive" className="text-xs px-1.5 py-0">מוסתר</Badge>
                      )}
                      {hasCommissionFromFile(supplier.code) ? (
                        <Badge variant="secondary" className="text-xs px-1.5 py-0">
                          <FileText className="h-3 w-3 me-1" />
                          מקובץ
                        </Badge>
                      ) : supplier.defaultCommissionRate && (
                        <Badge variant="outline" className="text-xs px-1.5 py-0">
                          {supplier.defaultCommissionRate}%
                        </Badge>
                      )}
                      {supplier.settlementFrequency && (
                        <Badge variant="outline" className="text-xs px-1.5 py-0 text-muted-foreground">
                          {supplier.settlementFrequency === "monthly" ? "חודשי" :
                           supplier.settlementFrequency === "quarterly" ? "רבעוני" :
                           supplier.settlementFrequency === "weekly" ? "שבועי" :
                           supplier.settlementFrequency}
                        </Badge>
                      )}
                      {supplier.brands && supplier.brands.length > 0 && (
                        supplier.brands.map((brand) => (
                          <Badge key={brand.id} variant="outline" className="text-xs px-1.5 py-0 bg-primary/5">
                            {brand.nameHe}
                          </Badge>
                        ))
                      )}
                    </div>
                    <div className="flex items-center gap-1">
                      <Link href={`/admin/suppliers/${supplier.id}`} title={he.admin.suppliers.actions.view}>
                        <Button size="sm" variant="ghost" className="h-7 px-2">
                          <Eye className="h-3.5 w-3.5" />
                        </Button>
                      </Link>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2"
                        onClick={() => toggleHistoryExpanded(supplier.id)}
                        disabled={loadingHistoryId === supplier.id}
                        title={he.admin.suppliers.actions.history}
                      >
                        {loadingHistoryId === supplier.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <History className="h-3.5 w-3.5" />
                        )}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2"
                        onClick={() => toggleFileMappingExpanded(supplier.id)}
                        title={he.admin.suppliers.actions.fileMapping}
                      >
                        <FileSpreadsheet className="h-3.5 w-3.5" />
                        {supplier.fileMapping && <span className="w-1.5 h-1.5 bg-green-500 rounded-full ms-1" />}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2"
                        onClick={() => toggleDocumentsExpanded(supplier.id)}
                        disabled={loadingDocumentsId === supplier.id}
                        title={he.admin.suppliers.actions.documents}
                      >
                        {loadingDocumentsId === supplier.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <>
                            <FileText className="h-3.5 w-3.5" />
                            {supplierDocuments[supplier.id]?.length > 0 && (
                              <span className="text-xs ms-0.5">{supplierDocuments[supplier.id].length}</span>
                            )}
                          </>
                        )}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2"
                        onClick={() => handleEdit(supplier)}
                        title={he.admin.suppliers.form.editTitle}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                  {/* Row 2: Meta info */}
                  {(supplier.vatExempt || supplier.vatIncluded) && (
                    <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                      <span>{supplier.vatExempt ? "פטור ממע״מ" : "כולל מע״מ"}</span>
                    </div>
                  )}
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
            ))
          )}
        </div>
      </div>
    </div>
  );
}
