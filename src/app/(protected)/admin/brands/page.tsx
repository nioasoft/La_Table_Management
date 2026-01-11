"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
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
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  LogOut,
  Pencil,
  ChevronRight,
  Check,
  Loader2,
  MoreVertical,
  Power,
} from "lucide-react";
import type { Brand } from "@/db/schema";
import Link from "next/link";
import Image from "next/image";
import { he } from "@/lib/translations/he";

interface BrandFormData {
  code: string;
  nameHe: string;
  nameEn: string;
  description: string;
  logoUrl: string;
  website: string;
  isActive: boolean;
}

const initialFormData: BrandFormData = {
  code: "",
  nameHe: "",
  nameEn: "",
  description: "",
  logoUrl: "",
  website: "",
  isActive: true,
};

export default function AdminBrandsPage() {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(true);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editingBrand, setEditingBrand] = useState<Brand | null>(null);
  const [formData, setFormData] = useState<BrandFormData>(initialFormData);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [brandToToggle, setBrandToToggle] = useState<Brand | null>(null);
  const [expandedBrand, setExpandedBrand] = useState<string | null>(null);
  const { data: session, isPending } = authClient.useSession();

  const userRole = session ? (session.user as { role?: string })?.role : undefined;

  useEffect(() => {
    if (!isPending && !session) {
      router.push("/sign-in?redirect=/admin/brands");
      return;
    }

    if (!isPending && session?.user && userRole !== "super_user" && userRole !== "admin") {
      router.push("/dashboard");
      return;
    }

    if (!isPending && session) {
      fetchBrands();
    }
  }, [session, isPending, router, userRole]);

  const fetchBrands = async () => {
    try {
      setIsLoading(true);
      const response = await fetch("/api/brands?filter=all");
      if (!response.ok) {
        throw new Error("Failed to fetch brands");
      }
      const data = await response.json();
      setBrands(data.brands || []);
    } catch (error) {
      console.error("Error fetching brands:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (!formData.code || !formData.nameHe) {
      setFormError(he.admin.brands.form.validation.codeNameRequired);
      return;
    }

    try {
      setIsSubmitting(true);

      const url = editingBrand
        ? `/api/brands/${editingBrand.id}`
        : "/api/brands";

      const method = editingBrand ? "PATCH" : "POST";

      const response = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || `Failed to ${editingBrand ? "update" : "create"} brand`);
      }

      setShowForm(false);
      setEditingBrand(null);
      setFormData(initialFormData);
      await fetchBrands();
    } catch (error) {
      console.error("Error saving brand:", error);
      setFormError(error instanceof Error ? error.message : he.errors.failedToSave);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleEdit = (brand: Brand) => {
    setEditingBrand(brand);
    setFormData({
      code: brand.code,
      nameHe: brand.nameHe,
      nameEn: brand.nameEn || "",
      description: brand.description || "",
      logoUrl: brand.logoUrl || "",
      website: brand.website || "",
      isActive: brand.isActive,
    });
    setShowForm(true);
    setFormError(null);
    setExpandedBrand(null);
  };

  const handleToggleStatus = async () => {
    if (!brandToToggle) return;

    try {
      const response = await fetch(`/api/brands/${brandToToggle.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !brandToToggle.isActive }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to update brand status");
      }

      await fetchBrands();
    } catch (error) {
      console.error("Error updating brand status:", error);
      alert(error instanceof Error ? error.message : he.errors.failedToUpdate);
    } finally {
      setBrandToToggle(null);
    }
  };

  const handleSignOut = async () => {
    await authClient.signOut();
    router.push("/sign-in");
  };

  const cancelForm = () => {
    setShowForm(false);
    setEditingBrand(null);
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
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-4">
          <Link href="/dashboard">
            <Button variant="ghost" size="sm">
              <ChevronRight className="h-4 w-4 ml-1" />
              {he.common.dashboard}
            </Button>
          </Link>
          <h1 className="text-3xl font-bold">{he.admin.brands.title}</h1>
        </div>
        <Button variant="outline" onClick={handleSignOut}>
          <LogOut className="ml-2 h-4 w-4" />
          {he.common.signOut}
        </Button>
      </div>

      {/* Brand Form Modal */}
      {showForm && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>{editingBrand ? he.admin.brands.form.editTitle : he.admin.brands.form.createTitle}</CardTitle>
            <CardDescription>
              {editingBrand
                ? he.admin.brands.form.editDescription
                : he.admin.brands.form.createDescription}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              {formError && (
                <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-3">
                  <p className="text-sm text-destructive">{formError}</p>
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="code">{he.admin.brands.form.fields.code} *</Label>
                  <Input
                    id="code"
                    value={formData.code}
                    onChange={(e) => setFormData({ ...formData, code: e.target.value.toUpperCase() })}
                    placeholder={he.admin.brands.form.fields.codePlaceholder}
                    disabled={isSubmitting}
                    required
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="nameHe">{he.admin.brands.form.fields.nameHe} *</Label>
                  <Input
                    id="nameHe"
                    value={formData.nameHe}
                    onChange={(e) => setFormData({ ...formData, nameHe: e.target.value })}
                    placeholder={he.admin.brands.form.fields.nameHePlaceholder}
                    disabled={isSubmitting}
                    required
                    dir="rtl"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="nameEn">{he.admin.brands.form.fields.nameEn}</Label>
                  <Input
                    id="nameEn"
                    value={formData.nameEn}
                    onChange={(e) => setFormData({ ...formData, nameEn: e.target.value })}
                    placeholder={he.admin.brands.form.fields.nameEnPlaceholder}
                    disabled={isSubmitting}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="logoUrl">{he.admin.brands.form.fields.logoUrl}</Label>
                  <Input
                    id="logoUrl"
                    value={formData.logoUrl}
                    onChange={(e) => setFormData({ ...formData, logoUrl: e.target.value })}
                    placeholder={he.admin.brands.form.fields.logoUrlPlaceholder}
                    disabled={isSubmitting}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="website">{he.admin.brands.form.fields.website}</Label>
                  <Input
                    id="website"
                    value={formData.website}
                    onChange={(e) => setFormData({ ...formData, website: e.target.value })}
                    placeholder={he.admin.brands.form.fields.websitePlaceholder}
                    disabled={isSubmitting}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="description">{he.admin.brands.form.fields.description}</Label>
                <Input
                  id="description"
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  placeholder={he.admin.brands.form.fields.descriptionPlaceholder}
                  disabled={isSubmitting}
                  dir="rtl"
                />
              </div>

              <div className="flex justify-end gap-2 pt-4">
                <Button type="button" variant="outline" onClick={cancelForm} disabled={isSubmitting}>
                  {he.common.cancel}
                </Button>
                <Button type="submit" disabled={isSubmitting}>
                  {isSubmitting ? (
                    <>
                      <Loader2 className="ml-2 h-4 w-4 animate-spin" />
                      {he.common.saving}
                    </>
                  ) : (
                    <>
                      <Check className="ml-2 h-4 w-4" />
                      {editingBrand ? he.common.update : he.common.create}
                    </>
                  )}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {/* Brand Cards Grid */}
      {brands.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          {he.admin.brands.empty.noBrands}
        </div>
      ) : (
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
          {brands.map((brand) => (
            <Card
              key={brand.id}
              className={`relative overflow-hidden transition-all hover:shadow-lg ${
                !brand.isActive ? "opacity-60" : ""
              }`}
            >
              {/* Content */}
              <CardContent className="p-6">
                {/* Logo */}
                <div className="flex justify-center mb-4">
                  {brand.logoUrl ? (
                    <Image
                      src={brand.logoUrl}
                      alt={brand.nameHe}
                      width={140}
                      height={90}
                      className="object-contain"
                    />
                  ) : (
                    <div className="text-5xl font-bold text-muted-foreground/30">
                      {brand.nameHe.charAt(0)}
                    </div>
                  )}
                </div>
                {/* Brand Name - Centered */}
                <div className="text-center">
                  <h3 className="font-semibold text-lg">{brand.nameHe}</h3>
                  {brand.nameEn && (
                    <p className="text-sm text-muted-foreground">{brand.nameEn}</p>
                  )}
                  {!brand.isActive && (
                    <Badge variant="secondary" className="text-xs mt-2">
                      {he.common.inactive}
                    </Badge>
                  )}
                </div>

                {brand.description && (
                  <p className="text-sm text-muted-foreground mt-3 text-center line-clamp-2">
                    {brand.description}
                  </p>
                )}

                {/* Actions */}
                <div className="mt-4 pt-4 border-t flex justify-center gap-2">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => handleEdit(brand)}
                    className="gap-1"
                  >
                    <Pencil className="h-3 w-3" />
                    {he.common.edit}
                  </Button>

                  {/* More options button */}
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setExpandedBrand(expandedBrand === brand.id ? null : brand.id)}
                    className="text-muted-foreground"
                  >
                    <MoreVertical className="h-4 w-4" />
                  </Button>
                </div>

                {/* Expanded options */}
                {expandedBrand === brand.id && (
                  <div className="mt-2 pt-2 border-t">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setBrandToToggle(brand)}
                      className="w-full justify-center gap-2 text-muted-foreground hover:text-foreground"
                    >
                      <Power className="h-3 w-3" />
                      {brand.isActive ? he.admin.brands.actions.deactivate : he.admin.brands.actions.activate}
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Confirmation Dialog for Status Toggle */}
      <AlertDialog open={!!brandToToggle} onOpenChange={() => setBrandToToggle(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {brandToToggle?.isActive
                ? he.admin.brands.confirmDeactivate?.title || "ביטול פעיל מותג"
                : he.admin.brands.confirmActivate?.title || "הפעלת מותג"
              }
            </AlertDialogTitle>
            <AlertDialogDescription>
              {brandToToggle?.isActive
                ? he.admin.brands.confirmDeactivate?.description || `האם אתה בטוח שברצונך לבטל את המותג "${brandToToggle?.nameHe}"? המותג לא יהיה זמין לשימוש.`
                : he.admin.brands.confirmActivate?.description || `האם להפעיל מחדש את המותג "${brandToToggle?.nameHe}"?`
              }
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{he.common.cancel}</AlertDialogCancel>
            <AlertDialogAction onClick={handleToggleStatus}>
              {brandToToggle?.isActive ? he.admin.brands.actions.deactivate : he.admin.brands.actions.activate}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
