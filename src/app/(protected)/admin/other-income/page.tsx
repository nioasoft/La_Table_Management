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
  Plus,
  Pencil,
  RefreshCw,
  Check,
  Loader2,
  Building2,
  Search,
  Tag,
  DollarSign,
  ChevronDown,
  ChevronUp,
  ArrowLeft,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { Brand, FranchiseeStatus } from "@/db/schema";
import type { FranchiseeWithBrand } from "@/data-access/franchisees";
import Link from "next/link";
import { AliasManager } from "@/components/alias-manager";

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

// Status labels
const statusLabels: Record<FranchiseeStatus, string> = {
  active: "פעיל",
  inactive: "לא פעיל",
  pending: "ממתין",
  suspended: "מושהה",
  terminated: "בוטל",
};

interface OtherIncomeFormData {
  brandId: string;
  name: string;
  code: string;
  aliases: string[];
  notes: string;
  status: FranchiseeStatus;
  isActive: boolean;
}

const initialFormData: OtherIncomeFormData = {
  brandId: "",
  name: "",
  code: "",
  aliases: [],
  notes: "",
  status: "active",
  isActive: true,
};

export default function OtherIncomePage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [searchTerm, setSearchTerm] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editingSource, setEditingSource] = useState<FranchiseeWithBrand | null>(null);
  const [formData, setFormData] = useState<OtherIncomeFormData>(initialFormData);
  const [formError, setFormError] = useState<string | null>(null);

  const { data: session, isPending } = authClient.useSession();

  const userRole = session
    ? (session.user as { role?: string })?.role
    : undefined;

  // Redirect if not authenticated or authorized
  if (!isPending && !session) {
    router.push("/sign-in?redirect=/admin/other-income");
  }
  if (!isPending && session?.user && userRole !== "super_user" && userRole !== "admin") {
    router.push("/dashboard");
  }

  // Fetch other income sources
  const { data: sourcesData, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["franchisees", "other-income"],
    queryFn: async () => {
      const response = await fetch("/api/franchisees?category=other&stats=true");
      if (!response.ok) {
        throw new Error("Failed to fetch other income sources");
      }
      return response.json();
    },
    enabled: !isPending && !!session,
  });

  const sources: FranchiseeWithBrand[] = sourcesData?.franchisees || [];
  const stats = sourcesData?.stats || null;

  // Filter sources by search term
  const filteredSources = useMemo(() => {
    if (!searchTerm.trim()) return sources;
    const term = searchTerm.toLowerCase().trim();
    return sources.filter((s) =>
      s.name.toLowerCase().includes(term) ||
      s.code?.toLowerCase().includes(term) ||
      s.aliases?.some((a) => a.toLowerCase().includes(term))
    );
  }, [sources, searchTerm]);

  // Fetch brands for form (include system brands)
  const { data: brandsData } = useQuery({
    queryKey: ["brands", "list", { includeSystem: true }],
    queryFn: async () => {
      const response = await fetch("/api/brands?filter=active&includeSystem=true");
      if (!response.ok) {
        throw new Error("Failed to fetch brands");
      }
      return response.json();
    },
    enabled: !isPending && !!session,
  });

  const brands: Brand[] = brandsData?.brands || [];

  // Create source mutation
  const createSource = useMutation({
    mutationFn: async (data: typeof formData) => {
      const response = await fetch("/api/franchisees", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...data,
          category: "other",
          aliases: data.aliases.length > 0 ? data.aliases : null,
        }),
      });
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to create income source");
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["franchisees", "other-income"] });
      setShowForm(false);
      setEditingSource(null);
      setFormData(initialFormData);
    },
    onError: (error: Error) => {
      setFormError(error.message);
    },
  });

  // Update source mutation
  const updateSource = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: typeof formData }) => {
      const response = await fetch(`/api/franchisees/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...data,
          aliases: data.aliases.length > 0 ? data.aliases : null,
        }),
      });
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to update income source");
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["franchisees", "other-income"] });
      setShowForm(false);
      setEditingSource(null);
      setFormData(initialFormData);
    },
    onError: (error: Error) => {
      setFormError(error.message);
    },
  });

  const isSubmitting = createSource.isPending || updateSource.isPending;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (!formData.brandId || !formData.name || !formData.code) {
      setFormError("יש למלא את כל השדות הנדרשים");
      return;
    }

    if (editingSource) {
      updateSource.mutate({ id: editingSource.id, data: formData });
    } else {
      createSource.mutate(formData);
    }
  };

  const handleEdit = (source: FranchiseeWithBrand) => {
    setEditingSource(source);
    setFormData({
      brandId: source.brandId,
      name: source.name,
      code: source.code,
      aliases: source.aliases || [],
      notes: source.notes || "",
      status: source.status,
      isActive: source.isActive,
    });
    setShowForm(true);
    setFormError(null);
  };

  const cancelForm = () => {
    setShowForm(false);
    setEditingSource(null);
    setFormData(initialFormData);
    setFormError(null);
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
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-2 text-muted-foreground mb-2">
          <Link href="/admin/franchisees" className="hover:text-primary transition-colors">
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <span className="text-sm">חזרה לרשימת הזכיינים</span>
        </div>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold flex items-center gap-3">
              <DollarSign className="h-8 w-8 text-primary" />
              הכנסות אחרות
            </h1>
            <p className="text-muted-foreground mt-1">
              ניהול מקורות הכנסה שאינם זכיינים (כגון דון פדרו)
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="icon"
              onClick={() => refetch()}
              disabled={isFetching}
            >
              <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
            </Button>
            <Button
              onClick={() => {
                setShowForm(true);
                setEditingSource(null);
                setFormData(initialFormData);
              }}
            >
              <Plus className="me-2 h-4 w-4" />
              הוספת מקור הכנסה
            </Button>
          </div>
        </div>
      </div>

      {/* Stats Summary */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-2xl font-bold">{stats?.total || 0}</p>
                <p className="text-sm text-muted-foreground">סה״כ מקורות</p>
              </div>
              <Building2 className="h-8 w-8 text-muted-foreground" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-2xl font-bold text-green-600">{stats?.active || 0}</p>
                <p className="text-sm text-muted-foreground">פעילים</p>
              </div>
              <Badge variant="success" className="h-8 w-8 flex items-center justify-center rounded-full">
                <Check className="h-4 w-4" />
              </Badge>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-2xl font-bold text-muted-foreground">{stats?.inactive || 0}</p>
                <p className="text-sm text-muted-foreground">לא פעילים</p>
              </div>
              <Badge variant="secondary" className="h-8 w-8 flex items-center justify-center rounded-full">
                <span className="text-xs">{stats?.inactive || 0}</span>
              </Badge>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Form Dialog */}
      <Dialog open={showForm} onOpenChange={(open) => !isSubmitting && setShowForm(open)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {editingSource ? "עריכת מקור הכנסה" : "הוספת מקור הכנסה חדש"}
            </DialogTitle>
            <DialogDescription>
              {editingSource
                ? "עדכון פרטי מקור ההכנסה"
                : "הוספת מקור הכנסה חדש שאינו זכיין (כגון דון פדרו)"}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-6">
            {formError && (
              <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-3">
                <p className="text-sm text-destructive">{formError}</p>
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="brandId">מותג *</Label>
                <Select
                  value={formData.brandId}
                  onValueChange={(value) =>
                    setFormData({ ...formData, brandId: value })
                  }
                  disabled={isSubmitting}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="בחר מותג" />
                  </SelectTrigger>
                  <SelectContent>
                    {brands.map((brand) => (
                      <SelectItem key={brand.id} value={brand.id}>
                        {brand.nameHe}
                        {(brand as Brand & { isSystemBrand?: boolean }).isSystemBrand && (
                          <span className="text-muted-foreground text-xs ms-1">(מערכת)</span>
                        )}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="status">סטטוס</Label>
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
                    <SelectItem value="active">פעיל</SelectItem>
                    <SelectItem value="inactive">לא פעיל</SelectItem>
                    <SelectItem value="pending">ממתין</SelectItem>
                    <SelectItem value="suspended">מושהה</SelectItem>
                    <SelectItem value="terminated">בוטל</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="name">שם *</Label>
                <Input
                  id="name"
                  value={formData.name}
                  onChange={(e) =>
                    setFormData({ ...formData, name: e.target.value })
                  }
                  placeholder="לדוגמה: דון פדרו"
                  disabled={isSubmitting}
                  required
                  dir="rtl"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="code">קוד *</Label>
                <Input
                  id="code"
                  value={formData.code}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      code: e.target.value.toUpperCase(),
                    })
                  }
                  placeholder="לדוגמה: DON_PEDRO"
                  disabled={isSubmitting}
                  required
                />
              </div>
            </div>

            {/* Aliases Section */}
            <div className="space-y-2">
              <Label className="flex items-center gap-2">
                <Tag className="h-4 w-4" />
                כינויים (לזיהוי בקבצי ספקים)
              </Label>
              <AliasManager
                aliases={formData.aliases}
                onChange={(newAliases) =>
                  setFormData({ ...formData, aliases: newAliases })
                }
                disabled={isSubmitting}
                placeholder="הוסף כינוי להתאמה אוטומטית..."
              />
              <p className="text-xs text-muted-foreground">
                הכינויים משמשים לזיהוי אוטומטי של מקור ההכנסה בקבצי ספקים
              </p>
            </div>

            {/* Notes */}
            <div className="space-y-2">
              <Label htmlFor="notes">הערות</Label>
              <Input
                id="notes"
                value={formData.notes}
                onChange={(e) =>
                  setFormData({ ...formData, notes: e.target.value })
                }
                placeholder="הערות נוספות..."
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
              <Label htmlFor="isActive">פעיל</Label>
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={cancelForm}
                disabled={isSubmitting}
              >
                ביטול
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? (
                  <>
                    <Loader2 className="me-2 h-4 w-4 animate-spin" />
                    שומר...
                  </>
                ) : (
                  <>
                    <Check className="me-2 h-4 w-4" />
                    {editingSource ? "עדכון" : "הוספה"}
                  </>
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Sources List */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>רשימת מקורות הכנסה</CardTitle>
            <div className="relative w-64">
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                type="text"
                placeholder="חיפוש לפי שם או קוד..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pr-9"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {filteredSources.length === 0 ? (
            <div className="text-center py-12">
              <DollarSign className="h-12 w-12 mx-auto text-muted-foreground/50 mb-4" />
              <p className="text-muted-foreground">
                {searchTerm.trim()
                  ? "לא נמצאו מקורות הכנסה התואמים לחיפוש"
                  : "אין מקורות הכנסה אחרים. הוסף את הראשון!"}
              </p>
            </div>
          ) : (
            <div className="divide-y">
              {filteredSources.map((source) => (
                <SourceCard
                  key={source.id}
                  source={source}
                  onEdit={handleEdit}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// Source Card Component
interface SourceCardProps {
  source: FranchiseeWithBrand;
  onEdit: (source: FranchiseeWithBrand) => void;
}

function SourceCard({ source, onEdit }: SourceCardProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="py-4 hover:bg-muted/30 transition-colors">
      {/* Header Row */}
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1 flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={() => onEdit(source)}
              className="font-medium truncate hover:text-primary hover:underline transition-colors text-start"
            >
              {source.name}
            </button>
            <span className="text-xs text-muted-foreground font-mono">{source.code}</span>
            <Badge variant={statusVariants[source.status]} className="text-xs px-1.5 py-0">
              {statusLabels[source.status]}
            </Badge>
            {source.brand && (
              <Badge variant="outline" className="text-xs px-1.5 py-0">{source.brand.nameHe}</Badge>
            )}
          </div>
          {source.aliases && source.aliases.length > 0 && (
            <div className="flex items-center gap-1 flex-wrap">
              <Tag className="h-3 w-3 text-muted-foreground" />
              {source.aliases.slice(0, 5).map((alias, idx) => (
                <Badge
                  key={`${alias}-${idx}`}
                  variant="secondary"
                  className="text-xs px-1.5 py-0"
                >
                  {alias}
                </Badge>
              ))}
              {source.aliases.length > 5 && (
                <span className="text-xs text-muted-foreground">+{source.aliases.length - 5}</span>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center gap-1">
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2"
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2"
            onClick={() => onEdit(source)}
          >
            <Pencil className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Expanded Details */}
      {expanded && (
        <div className="mt-3 pt-3 border-t space-y-2">
          {source.notes && (
            <div className="text-sm">
              <span className="font-medium">הערות:</span>{" "}
              <span className="text-muted-foreground">{source.notes}</span>
            </div>
          )}
          <div className="text-xs text-muted-foreground">
            נוצר: {new Date(source.createdAt).toLocaleDateString("he-IL")}
            {source.updatedAt && (
              <>
                {" "}| עודכן: {new Date(source.updatedAt).toLocaleDateString("he-IL")}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
