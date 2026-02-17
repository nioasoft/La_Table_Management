"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
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
} from "@/components/ui/dialog";
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
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Pencil,
  Loader2,
  Plus,
  Trash2,
  UserRound,
  Phone,
  Mail,
  X,
  Users,
} from "lucide-react";
import { he } from "@/lib/translations/he";
import { useBrands } from "@/queries/brands";
import {
  useStaffContacts,
  useCreateStaffContact,
  useUpdateStaffContact,
  useDeleteStaffContact,
} from "@/queries/staff-contacts";
import type { StaffRole } from "@/db/schema";
import type { StaffContactWithBrand } from "@/data-access/staff-contacts";

const ROLE_LABELS = he.staffContacts.roles;

// Role color mapping for badges
const ROLE_STYLES: Record<
  StaffRole,
  { bg: string; text: string; border: string }
> = {
  back_office: {
    bg: "bg-blue-50 dark:bg-blue-950/40",
    text: "text-blue-700 dark:text-blue-300",
    border: "border-blue-200 dark:border-blue-800",
  },
  consultant: {
    bg: "bg-purple-50 dark:bg-purple-950/40",
    text: "text-purple-700 dark:text-purple-300",
    border: "border-purple-200 dark:border-purple-800",
  },
  owner: {
    bg: "bg-amber-50 dark:bg-amber-950/40",
    text: "text-amber-700 dark:text-amber-300",
    border: "border-amber-200 dark:border-amber-800",
  },
  chain_chef: {
    bg: "bg-emerald-50 dark:bg-emerald-950/40",
    text: "text-emerald-700 dark:text-emerald-300",
    border: "border-emerald-200 dark:border-emerald-800",
  },
  brand_manager: {
    bg: "bg-rose-50 dark:bg-rose-950/40",
    text: "text-rose-700 dark:text-rose-300",
    border: "border-rose-200 dark:border-rose-800",
  },
};

// Avatar background colors per role
const AVATAR_COLORS: Record<StaffRole, string> = {
  back_office: "bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300",
  consultant: "bg-purple-100 text-purple-700 dark:bg-purple-900/50 dark:text-purple-300",
  owner: "bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300",
  chain_chef: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300",
  brand_manager: "bg-rose-100 text-rose-700 dark:bg-rose-900/50 dark:text-rose-300",
};

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return parts[0][0] + parts[1][0];
  }
  return name.slice(0, 2);
}

interface StaffFormData {
  name: string;
  phone: string;
  email: string;
  role: StaffRole | "";
  brandId: string;
}

const initialFormData: StaffFormData = {
  name: "",
  phone: "",
  email: "",
  role: "",
  brandId: "",
};

export default function StaffContactsPage() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingContact, setEditingContact] =
    useState<StaffContactWithBrand | null>(null);
  const [formData, setFormData] = useState<StaffFormData>(initialFormData);
  const [formError, setFormError] = useState<string | null>(null);
  const [contactToDelete, setContactToDelete] =
    useState<StaffContactWithBrand | null>(null);

  // Filters
  const [filterBrandId, setFilterBrandId] = useState<string>("");
  const [filterRole, setFilterRole] = useState<string>("");

  // Build filters for the query ("all" means no filter)
  const queryFilters: Record<string, string> = {};
  if (filterBrandId && filterBrandId !== "all")
    queryFilters.brandId = filterBrandId;
  if (filterRole && filterRole !== "all") queryFilters.role = filterRole;

  const hasActiveFilters =
    (filterBrandId && filterBrandId !== "all") ||
    (filterRole && filterRole !== "all");

  const { data: staffContacts, isLoading } = useStaffContacts(
    Object.keys(queryFilters).length > 0 ? queryFilters : undefined
  );
  const { data: brands } = useBrands();
  const createMutation = useCreateStaffContact();
  const updateMutation = useUpdateStaffContact();
  const deleteMutation = useDeleteStaffContact();

  const isSubmitting = createMutation.isPending || updateMutation.isPending;

  const openCreateDialog = () => {
    setEditingContact(null);
    setFormData(initialFormData);
    setFormError(null);
    setDialogOpen(true);
  };

  const openEditDialog = (contact: StaffContactWithBrand) => {
    setEditingContact(contact);
    setFormData({
      name: contact.name,
      phone: contact.phone || "",
      email: contact.email || "",
      role: contact.role,
      brandId: contact.brandId || "",
    });
    setFormError(null);
    setDialogOpen(true);
  };

  const closeDialog = () => {
    setDialogOpen(false);
    setEditingContact(null);
    setFormData(initialFormData);
    setFormError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (!formData.name.trim()) {
      setFormError("יש להזין שם");
      return;
    }

    if (!formData.role) {
      setFormError("יש לבחור תפקיד");
      return;
    }

    const payload = {
      name: formData.name.trim(),
      phone: formData.phone.trim() || null,
      email: formData.email.trim() || null,
      role: formData.role,
      brandId: formData.brandId || null,
    };

    const callbacks = {
      onSuccess: () => closeDialog(),
      onError: (error: Error) => setFormError(error.message),
    };

    if (editingContact) {
      updateMutation.mutate(
        { id: editingContact.id, data: payload },
        callbacks
      );
    } else {
      createMutation.mutate(payload, callbacks);
    }
  };

  const handleDelete = () => {
    if (contactToDelete) {
      deleteMutation.mutate(contactToDelete.id, {
        onSuccess: () => setContactToDelete(null),
        onError: () => setContactToDelete(null),
      });
    }
  };

  const clearFilters = () => {
    setFilterBrandId("");
    setFilterRole("");
  };

  const activeBrands = (brands || []).filter(
    (b: { isActive: boolean; isSystemBrand?: boolean }) =>
      b.isActive && !b.isSystemBrand
  );

  const contactCount = staffContacts?.length ?? 0;

  if (isLoading) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
            <Users className="h-5 w-5 text-primary" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold">{he.staffContacts.title}</h1>
              {contactCount > 0 && (
                <Badge variant="secondary" className="text-xs tabular-nums">
                  {contactCount}
                </Badge>
              )}
            </div>
            <p className="text-sm text-muted-foreground">
              {he.staffContacts.description}
            </p>
          </div>
        </div>
        {contactCount > 0 && (
          <Button onClick={openCreateDialog} className="shrink-0">
            <Plus className="me-2 h-4 w-4" />
            {he.staffContacts.addButton}
          </Button>
        )}
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3">
        <Select
          value={filterBrandId || "all"}
          onValueChange={setFilterBrandId}
        >
          <SelectTrigger className="w-[200px]">
            <SelectValue placeholder={he.staffContacts.filters.allBrands} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">
              {he.staffContacts.filters.allBrands}
            </SelectItem>
            <SelectItem value="group">{he.staffContacts.group}</SelectItem>
            {activeBrands.map((b: { id: string; nameHe: string }) => (
              <SelectItem key={b.id} value={b.id}>
                {b.nameHe}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={filterRole || "all"} onValueChange={setFilterRole}>
          <SelectTrigger className="w-[200px]">
            <SelectValue placeholder={he.staffContacts.filters.allRoles} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">
              {he.staffContacts.filters.allRoles}
            </SelectItem>
            {(Object.entries(ROLE_LABELS) as [StaffRole, string][]).map(
              ([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              )
            )}
          </SelectContent>
        </Select>

        {hasActiveFilters && (
          <Button
            variant="ghost"
            size="sm"
            onClick={clearFilters}
            className="text-muted-foreground"
          >
            <X className="me-1 h-3.5 w-3.5" />
            נקה סינון
          </Button>
        )}
      </div>

      {/* Content */}
      {!staffContacts || staffContacts.length === 0 ? (
        /* Empty State */
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted mb-4">
              <UserRound className="h-8 w-8 text-muted-foreground" />
            </div>
            <h3 className="text-lg font-semibold mb-1">
              {hasActiveFilters
                ? "לא נמצאו תוצאות"
                : "אין אנשי מטה"}
            </h3>
            <p className="text-sm text-muted-foreground mb-6 text-center max-w-sm">
              {hasActiveFilters
                ? "נסה לשנות את הסינון או להוסיף איש מטה חדש"
                : "הוסף את אנשי המטה הראשונים של קבוצת לה טייבל"}
            </p>
            {!hasActiveFilters && (
              <Button onClick={openCreateDialog}>
                <Plus className="me-2 h-4 w-4" />
                {he.staffContacts.addButton}
              </Button>
            )}
            {hasActiveFilters && (
              <Button variant="outline" onClick={clearFilters}>
                <X className="me-1 h-3.5 w-3.5" />
                נקה סינון
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        /* Table */
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="text-right pe-4">
                    {he.staffContacts.table.name}
                  </TableHead>
                  <TableHead className="text-right">
                    {he.staffContacts.table.role}
                  </TableHead>
                  <TableHead className="text-right">
                    {he.staffContacts.table.brand}
                  </TableHead>
                  <TableHead className="text-right">
                    {he.staffContacts.table.phone}
                  </TableHead>
                  <TableHead className="text-right">
                    {he.staffContacts.table.email}
                  </TableHead>
                  <TableHead className="text-right w-[90px]">
                    {he.staffContacts.table.actions}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {staffContacts.map((contact: StaffContactWithBrand) => {
                  const roleStyle =
                    ROLE_STYLES[contact.role as StaffRole] || ROLE_STYLES.back_office;
                  const avatarColor =
                    AVATAR_COLORS[contact.role as StaffRole] || AVATAR_COLORS.back_office;

                  return (
                    <TableRow
                      key={contact.id}
                      className="group"
                    >
                      {/* Name with avatar */}
                      <TableCell className="pe-4">
                        <div className="flex items-center gap-3">
                          <div
                            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${avatarColor}`}
                          >
                            {getInitials(contact.name)}
                          </div>
                          <span className="font-medium">{contact.name}</span>
                        </div>
                      </TableCell>

                      {/* Role badge */}
                      <TableCell>
                        <span
                          className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium ${roleStyle.bg} ${roleStyle.text} ${roleStyle.border}`}
                        >
                          {ROLE_LABELS[contact.role as StaffRole] ||
                            contact.role}
                        </span>
                      </TableCell>

                      {/* Brand */}
                      <TableCell>
                        {contact.brand ? (
                          <span className="text-sm">
                            {contact.brand.nameHe}
                          </span>
                        ) : (
                          <span className="text-sm text-muted-foreground">
                            {he.staffContacts.group}
                          </span>
                        )}
                      </TableCell>

                      {/* Phone */}
                      <TableCell>
                        {contact.phone ? (
                          <a
                            href={`tel:${contact.phone}`}
                            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
                            dir="ltr"
                          >
                            <Phone className="h-3.5 w-3.5" />
                            {contact.phone}
                          </a>
                        ) : (
                          <span className="text-sm text-muted-foreground/50">
                            -
                          </span>
                        )}
                      </TableCell>

                      {/* Email */}
                      <TableCell>
                        {contact.email ? (
                          <a
                            href={`mailto:${contact.email}`}
                            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
                            dir="ltr"
                          >
                            <Mail className="h-3.5 w-3.5" />
                            {contact.email}
                          </a>
                        ) : (
                          <span className="text-sm text-muted-foreground/50">
                            -
                          </span>
                        )}
                      </TableCell>

                      {/* Actions */}
                      <TableCell>
                        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8"
                                onClick={() => openEditDialog(contact)}
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>{he.common.edit}</TooltipContent>
                          </Tooltip>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-destructive hover:text-destructive"
                                onClick={() => setContactToDelete(contact)}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>{he.common.delete}</TooltipContent>
                          </Tooltip>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Add/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {editingContact
                ? he.staffContacts.editTitle
                : he.staffContacts.createTitle}
            </DialogTitle>
            <DialogDescription>
              {editingContact
                ? `עריכת פרטי ${editingContact.name}`
                : "הזן את פרטי איש המטה החדש"}
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="space-y-4">
            {formError && (
              <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-3">
                <p className="text-sm text-destructive">{formError}</p>
              </div>
            )}

            {/* Name */}
            <div className="space-y-2">
              <Label htmlFor="staff-name">
                {he.staffContacts.form.name}{" "}
                <span className="text-destructive">*</span>
              </Label>
              <Input
                id="staff-name"
                value={formData.name}
                onChange={(e) =>
                  setFormData({ ...formData, name: e.target.value })
                }
                placeholder={he.staffContacts.form.namePlaceholder}
                disabled={isSubmitting}
                autoFocus
              />
            </div>

            {/* Role + Brand */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="staff-role">
                  {he.staffContacts.form.role}{" "}
                  <span className="text-destructive">*</span>
                </Label>
                <Select
                  value={formData.role || undefined}
                  onValueChange={(value) =>
                    setFormData({ ...formData, role: value as StaffRole })
                  }
                  disabled={isSubmitting}
                >
                  <SelectTrigger id="staff-role">
                    <SelectValue placeholder="בחר תפקיד" />
                  </SelectTrigger>
                  <SelectContent>
                    {(
                      Object.entries(ROLE_LABELS) as [StaffRole, string][]
                    ).map(([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="staff-brand">
                  {he.staffContacts.form.brand}
                </Label>
                <Select
                  value={formData.brandId || "group"}
                  onValueChange={(value) =>
                    setFormData({
                      ...formData,
                      brandId: value === "group" ? "" : value,
                    })
                  }
                  disabled={isSubmitting}
                >
                  <SelectTrigger id="staff-brand">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="group">
                      {he.staffContacts.group}
                    </SelectItem>
                    {activeBrands.map(
                      (b: { id: string; nameHe: string }) => (
                        <SelectItem key={b.id} value={b.id}>
                          {b.nameHe}
                        </SelectItem>
                      )
                    )}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Phone + Email */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="staff-phone">
                  {he.staffContacts.form.phone}
                </Label>
                <Input
                  id="staff-phone"
                  value={formData.phone}
                  onChange={(e) =>
                    setFormData({ ...formData, phone: e.target.value })
                  }
                  placeholder={he.staffContacts.form.phonePlaceholder}
                  disabled={isSubmitting}
                  dir="ltr"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="staff-email">
                  {he.staffContacts.form.email}
                </Label>
                <Input
                  id="staff-email"
                  type="email"
                  value={formData.email}
                  onChange={(e) =>
                    setFormData({ ...formData, email: e.target.value })
                  }
                  placeholder={he.staffContacts.form.emailPlaceholder}
                  disabled={isSubmitting}
                  dir="ltr"
                />
              </div>
            </div>

            <DialogFooter className="gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={closeDialog}
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
                ) : editingContact ? (
                  he.common.update
                ) : (
                  he.staffContacts.addButton
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog
        open={!!contactToDelete}
        onOpenChange={() => setContactToDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{he.staffContacts.deleteTitle}</AlertDialogTitle>
            <AlertDialogDescription>
              {he.staffContacts.deleteDescription} {contactToDelete?.name}?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{he.common.cancel}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {he.staffContacts.deleteConfirm}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
