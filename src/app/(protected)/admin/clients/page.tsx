"use client";

import { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Pencil,
  Loader2,
  Plus,
  Trash2,
  Handshake,
  Mail,
  X,
  Check,
  Search,
  FileText,
  Settings2,
} from "lucide-react";
import { he } from "@/lib/translations/he";
import {
  useClients,
  useCreateClient,
  useUpdateClient,
  useDeleteClient,
} from "@/queries/clients";
import { useFranchisees } from "@/queries/franchisees";
import type { ClientWithFranchisees } from "@/data-access/clients";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

type ActiveFilter = "all" | "active" | "inactive";

interface ClientFormData {
  name: string;
  code: string;
  companyId: string;
  email: string;
  contactName: string;
  hashavshevetName: string;
  hashavshevetCode: string;
  fileFormat: string;
  gmailSearchQuery: string;
  gmailSenderEmail: string;
  tabitColumnNames: string;
  posTerminalCommission: string;
  dineInCommission: string;
  deliveryCommission: string;
  takeawayCommission: string;
  eventsCommission: string;
  additionalBenefits: string;
  invoiceGeneration: boolean;
  journalEntryGeneration: boolean;
  notes: string;
  isActive: boolean;
  franchiseeIds: string[];
}

const initialFormData: ClientFormData = {
  name: "",
  code: "",
  companyId: "",
  email: "",
  contactName: "",
  hashavshevetName: "",
  hashavshevetCode: "",
  fileFormat: "",
  gmailSearchQuery: "",
  gmailSenderEmail: "",
  tabitColumnNames: "",
  posTerminalCommission: "",
  dineInCommission: "",
  deliveryCommission: "",
  takeawayCommission: "",
  eventsCommission: "",
  additionalBenefits: "",
  invoiceGeneration: false,
  journalEntryGeneration: false,
  notes: "",
  isActive: true,
  franchiseeIds: [],
};

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function countNonNullCommissions(client: ClientWithFranchisees): number {
  return [
    client.posTerminalCommission,
    client.dineInCommission,
    client.deliveryCommission,
    client.takeawayCommission,
    client.eventsCommission,
  ].filter((v) => v !== null && v !== "").length;
}

// ─────────────────────────────────────────────────────────────────────────────
// Commission Input (default % suffix, overridable for fixed-currency fields)
// ─────────────────────────────────────────────────────────────────────────────

interface CommissionInputProps {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
  suffix?: string;
  max?: number;
}

function CommissionInput({
  id,
  label,
  value,
  onChange,
  disabled,
  suffix = "%",
  max,
}: CommissionInputProps) {
  const effectiveMax = max ?? (suffix === "%" ? 100 : undefined);
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <Input
          id={id}
          type="number"
          step="0.01"
          min="0"
          max={effectiveMax}
          dir="ltr"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          className="ps-8"
          placeholder="0.00"
        />
        <span className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
          {suffix}
        </span>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Page Component
// ─────────────────────────────────────────────────────────────────────────────

export default function ClientsPage() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingClient, setEditingClient] =
    useState<ClientWithFranchisees | null>(null);
  const [formData, setFormData] = useState<ClientFormData>(initialFormData);
  const [formError, setFormError] = useState<string | null>(null);
  const [clientToDelete, setClientToDelete] =
    useState<ClientWithFranchisees | null>(null);

  // Filter state
  const [activeFilter, setActiveFilter] = useState<ActiveFilter>("all");

  // Franchisee search state (inside form)
  const [franchiseeSearch, setFranchiseeSearch] = useState("");

  // Build filters for query
  const queryFilters =
    activeFilter === "all"
      ? undefined
      : { active: activeFilter === "active" };

  const { data: clients, isLoading } = useClients(queryFilters);
  const { data: allFranchisees } = useFranchisees();
  const createMutation = useCreateClient();
  const updateMutation = useUpdateClient();
  const deleteMutation = useDeleteClient();

  const isSubmitting = createMutation.isPending || updateMutation.isPending;

  // Filtered franchisees for multi-select search
  const filteredFranchisees = useMemo(() => {
    if (!allFranchisees) return [];
    const search = franchiseeSearch.trim().toLowerCase();
    if (!search) return allFranchisees;
    return allFranchisees.filter(
      (f: { name: string; code: string }) =>
        f.name.toLowerCase().includes(search) ||
        f.code.toLowerCase().includes(search)
    );
  }, [allFranchisees, franchiseeSearch]);

  // ─── Dialog open/close ───────────────────────────────────────────────────

  const openCreateDialog = () => {
    setEditingClient(null);
    setFormData(initialFormData);
    setFormError(null);
    setFranchiseeSearch("");
    setDialogOpen(true);
  };

  const openEditDialog = (c: ClientWithFranchisees) => {
    setEditingClient(c);
    setFormData({
      name: c.name,
      code: c.code ?? "",
      companyId: c.companyId ?? "",
      email: c.email ?? "",
      contactName: c.contactName ?? "",
      hashavshevetName: c.hashavshevetName ?? "",
      hashavshevetCode: c.hashavshevetCode ?? "",
      fileFormat: c.fileFormat ?? "",
      gmailSearchQuery: c.gmailSearchQuery ?? "",
      gmailSenderEmail: c.gmailSenderEmail ?? "",
      tabitColumnNames: Array.isArray(c.tabitColumnNames)
        ? (c.tabitColumnNames as string[]).join(", ")
        : "",
      posTerminalCommission: c.posTerminalCommission ?? "",
      dineInCommission: c.dineInCommission ?? "",
      deliveryCommission: c.deliveryCommission ?? "",
      takeawayCommission: c.takeawayCommission ?? "",
      eventsCommission: c.eventsCommission ?? "",
      additionalBenefits: c.additionalBenefits ?? "",
      invoiceGeneration: c.invoiceGeneration,
      journalEntryGeneration: c.journalEntryGeneration,
      notes: c.notes ?? "",
      isActive: c.isActive,
      franchiseeIds: c.franchisees.map((f) => f.id),
    });
    setFormError(null);
    setFranchiseeSearch("");
    setDialogOpen(true);
  };

  const closeDialog = () => {
    setDialogOpen(false);
    setEditingClient(null);
    setFormData(initialFormData);
    setFormError(null);
    setFranchiseeSearch("");
  };

  // ─── Form helpers ────────────────────────────────────────────────────────

  const updateField = <K extends keyof ClientFormData>(
    key: K,
    value: ClientFormData[K]
  ) => setFormData((prev) => ({ ...prev, [key]: value }));

  const toggleFranchisee = (id: string) => {
    setFormData((prev) => ({
      ...prev,
      franchiseeIds: prev.franchiseeIds.includes(id)
        ? prev.franchiseeIds.filter((fId) => fId !== id)
        : [...prev.franchiseeIds, id],
    }));
  };

  // ─── Submit ──────────────────────────────────────────────────────────────

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (!formData.name.trim()) {
      setFormError("יש להזין שם לקוח");
      return;
    }

    const payload = {
      name: formData.name.trim(),
      code: formData.code.trim().toUpperCase() || null,
      companyId: formData.companyId.trim() || null,
      email: formData.email.trim() || null,
      contactName: formData.contactName.trim() || null,
      hashavshevetName: formData.hashavshevetName.trim() || null,
      hashavshevetCode: formData.hashavshevetCode.trim() || null,
      fileFormat: formData.fileFormat || null,
      gmailSearchQuery: formData.gmailSearchQuery.trim() || null,
      gmailSenderEmail: formData.gmailSenderEmail.trim() || null,
      tabitColumnNames: formData.tabitColumnNames.trim()
        ? formData.tabitColumnNames
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
        : null,
      posTerminalCommission: formData.posTerminalCommission.trim() || null,
      dineInCommission: formData.dineInCommission.trim() || null,
      deliveryCommission: formData.deliveryCommission.trim() || null,
      takeawayCommission: formData.takeawayCommission.trim() || null,
      eventsCommission: formData.eventsCommission.trim() || null,
      additionalBenefits: formData.additionalBenefits.trim() || null,
      invoiceGeneration: formData.invoiceGeneration,
      journalEntryGeneration: formData.journalEntryGeneration,
      notes: formData.notes.trim() || null,
      isActive: formData.isActive,
      franchiseeIds: formData.franchiseeIds,
    };

    const callbacks = {
      onSuccess: () => closeDialog(),
      onError: (error: Error) => setFormError(error.message),
    };

    if (editingClient) {
      updateMutation.mutate({ id: editingClient.id, data: payload }, callbacks);
    } else {
      createMutation.mutate(payload, callbacks);
    }
  };

  // ─── Delete ──────────────────────────────────────────────────────────────

  const handleDelete = () => {
    if (clientToDelete) {
      deleteMutation.mutate(clientToDelete.id, {
        onSuccess: () => setClientToDelete(null),
        onError: () => setClientToDelete(null),
      });
    }
  };

  // ─── Derived values ──────────────────────────────────────────────────────

  const clientCount = clients?.length ?? 0;
  const hasNoResults =
    !isLoading && clients !== undefined && clients.length === 0;

  // ─── Loading state ───────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div className="p-6 space-y-6">
      {/* ── Header ── */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
            <Handshake className="h-5 w-5 text-primary" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold">{he.clients.title}</h1>
              {clientCount > 0 && (
                <Badge variant="secondary" className="text-xs tabular-nums">
                  {clientCount}
                </Badge>
              )}
            </div>
            <p className="text-sm text-muted-foreground">
              {he.clients.description}
            </p>
          </div>
        </div>
        {clientCount > 0 && (
          <Button onClick={openCreateDialog} className="shrink-0">
            <Plus className="me-2 h-4 w-4" />
            {he.clients.addButton}
          </Button>
        )}
      </div>

      {/* ── Filter Toggle ── */}
      <div className="flex items-center gap-2">
        <Button
          variant={activeFilter === "all" ? "secondary" : "ghost"}
          size="sm"
          onClick={() => setActiveFilter("all")}
        >
          הכל
        </Button>
        <Button
          variant={activeFilter === "active" ? "secondary" : "ghost"}
          size="sm"
          onClick={() => setActiveFilter("active")}
        >
          {he.clients.status.active}
        </Button>
        <Button
          variant={activeFilter === "inactive" ? "secondary" : "ghost"}
          size="sm"
          onClick={() => setActiveFilter("inactive")}
        >
          {he.clients.status.inactive}
        </Button>
        {activeFilter !== "all" && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setActiveFilter("all")}
            className="text-muted-foreground"
          >
            <X className="me-1 h-3.5 w-3.5" />
            נקה
          </Button>
        )}
      </div>

      {/* ── Content ── */}
      {hasNoResults ? (
        /* Empty State */
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted mb-4">
              <Handshake className="h-8 w-8 text-muted-foreground" />
            </div>
            <h3 className="text-lg font-semibold mb-1">
              {activeFilter !== "all"
                ? he.clients.noResults
                : he.clients.empty}
            </h3>
            <p className="text-sm text-muted-foreground mb-6 text-center max-w-sm">
              {activeFilter !== "all"
                ? "נסה לשנות את הסינון או להוסיף לקוח חדש"
                : "הוסף את הלקוחות הראשונים של קבוצת לה טייבל"}
            </p>
            {activeFilter === "all" && (
              <Button onClick={openCreateDialog}>
                <Plus className="me-2 h-4 w-4" />
                {he.clients.addButton}
              </Button>
            )}
            {activeFilter !== "all" && (
              <Button variant="outline" onClick={() => setActiveFilter("all")}>
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
                    {he.clients.table.name}
                  </TableHead>
                  <TableHead className="text-right">
                    {he.clients.table.code}
                  </TableHead>
                  <TableHead className="text-right">
                    {he.clients.table.companyId}
                  </TableHead>
                  <TableHead className="text-right">
                    {he.clients.table.contactName}
                  </TableHead>
                  <TableHead className="text-right">
                    {he.clients.table.email}
                  </TableHead>
                  <TableHead className="text-right">
                    {he.clients.table.commissions}
                  </TableHead>
                  <TableHead className="text-right">
                    {he.clients.table.invoiceGeneration}
                  </TableHead>
                  <TableHead className="text-right">
                    {he.clients.table.franchiseeCount}
                  </TableHead>
                  <TableHead className="text-right">
                    {he.clients.table.status}
                  </TableHead>
                  <TableHead className="text-right w-[90px]">
                    {he.clients.table.actions}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(clients as ClientWithFranchisees[]).map((c) => {
                  const commissionCount = countNonNullCommissions(c);

                  return (
                    <TableRow key={c.id} className="group">
                      {/* Name */}
                      <TableCell className="pe-4">
                        <span className="font-medium">{c.name}</span>
                      </TableCell>

                      {/* Code */}
                      <TableCell>
                        {c.code ? (
                          <Badge variant="outline" className="font-mono text-xs">
                            {c.code}
                          </Badge>
                        ) : (
                          <span className="text-sm text-muted-foreground/50">-</span>
                        )}
                      </TableCell>

                      {/* Company ID */}
                      <TableCell>
                        {c.companyId ? (
                          <span className="text-sm tabular-nums" dir="ltr">
                            {c.companyId}
                          </span>
                        ) : (
                          <span className="text-sm text-muted-foreground/50">
                            -
                          </span>
                        )}
                      </TableCell>

                      {/* Contact Name */}
                      <TableCell>
                        {c.contactName ? (
                          <span className="text-sm">{c.contactName}</span>
                        ) : (
                          <span className="text-sm text-muted-foreground/50">
                            -
                          </span>
                        )}
                      </TableCell>

                      {/* Email */}
                      <TableCell>
                        {c.email ? (
                          <a
                            href={`mailto:${c.email}`}
                            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
                            dir="ltr"
                          >
                            <Mail className="h-3.5 w-3.5 shrink-0" />
                            {c.email}
                          </a>
                        ) : (
                          <span className="text-sm text-muted-foreground/50">
                            -
                          </span>
                        )}
                      </TableCell>

                      {/* Commission count */}
                      <TableCell>
                        {commissionCount > 0 ? (
                          <span className="text-sm">
                            {commissionCount} עמלות
                          </span>
                        ) : (
                          <span className="text-sm text-muted-foreground/50">
                            -
                          </span>
                        )}
                      </TableCell>

                      {/* Invoice Generation */}
                      <TableCell>
                        {c.invoiceGeneration ? (
                          <Check className="h-4 w-4 text-emerald-600" />
                        ) : (
                          <span className="text-sm text-muted-foreground/50">
                            -
                          </span>
                        )}
                      </TableCell>

                      {/* Franchisee count */}
                      <TableCell>
                        {c.franchisees.length > 0 ? (
                          <Badge variant="secondary" className="tabular-nums">
                            {c.franchisees.length}
                          </Badge>
                        ) : (
                          <span className="text-sm text-muted-foreground/50">
                            -
                          </span>
                        )}
                      </TableCell>

                      {/* Status */}
                      <TableCell>
                        {c.isActive ? (
                          <Badge className="bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800 hover:bg-emerald-50">
                            {he.clients.status.active}
                          </Badge>
                        ) : (
                          <Badge
                            variant="secondary"
                            className="text-muted-foreground"
                          >
                            {he.clients.status.inactive}
                          </Badge>
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
                                onClick={() => openEditDialog(c)}
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
                                onClick={() => setClientToDelete(c)}
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

      {/* ── Add / Edit Dialog ── */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingClient
                ? he.clients.editTitle
                : he.clients.createTitle}
            </DialogTitle>
            <DialogDescription>
              {editingClient
                ? `עריכת פרטי ${editingClient.name}`
                : "הזן את פרטי הלקוח החדש"}
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="space-y-4">
            {formError && (
              <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-3">
                <p className="text-sm text-destructive">{formError}</p>
              </div>
            )}

            {/* Row 1 – Name + Code */}
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2 space-y-2">
                <Label htmlFor="client-name">
                  {he.clients.form.name}{" "}
                  <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="client-name"
                  value={formData.name}
                  onChange={(e) => updateField("name", e.target.value)}
                  placeholder={he.clients.form.namePlaceholder}
                  disabled={isSubmitting}
                  autoFocus
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="client-code">
                  {he.clients.form.code}
                </Label>
                <Input
                  id="client-code"
                  dir="ltr"
                  value={formData.code}
                  onChange={(e) => updateField("code", e.target.value.toUpperCase())}
                  placeholder={he.clients.form.codePlaceholder}
                  disabled={isSubmitting}
                  className="font-mono uppercase"
                />
              </div>
            </div>

            {/* Row 2 – Company ID + Contact Name */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="client-companyId">
                  {he.clients.form.companyId}
                </Label>
                <Input
                  id="client-companyId"
                  dir="ltr"
                  value={formData.companyId}
                  onChange={(e) => updateField("companyId", e.target.value)}
                  placeholder={he.clients.form.companyIdPlaceholder}
                  disabled={isSubmitting}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="client-contactName">
                  {he.clients.form.contactName}
                </Label>
                <Input
                  id="client-contactName"
                  value={formData.contactName}
                  onChange={(e) => updateField("contactName", e.target.value)}
                  placeholder={he.clients.form.contactNamePlaceholder}
                  disabled={isSubmitting}
                />
              </div>
            </div>

            {/* Row 3 – Email + Hashavshevet Name */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="client-email">{he.clients.form.email}</Label>
                <Input
                  id="client-email"
                  type="email"
                  dir="ltr"
                  value={formData.email}
                  onChange={(e) => updateField("email", e.target.value)}
                  placeholder={he.clients.form.emailPlaceholder}
                  disabled={isSubmitting}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="client-hashavshevetName">
                  {he.clients.form.hashavshevetName}
                </Label>
                <Input
                  id="client-hashavshevetName"
                  value={formData.hashavshevetName}
                  onChange={(e) =>
                    updateField("hashavshevetName", e.target.value)
                  }
                  placeholder={he.clients.form.hashavshevetNamePlaceholder}
                  disabled={isSubmitting}
                />
              </div>
            </div>

            {/* Commission rates section header */}
            <div className="relative flex items-center gap-3 py-1">
              <div className="flex-1 border-t" />
              <span className="text-xs font-medium text-muted-foreground shrink-0">
                {he.clients.form.commissionRates}
              </span>
              <div className="flex-1 border-t" />
            </div>

            {/* Row 4 – POS Terminal + Dine-in + Delivery (3 cols) */}
            <div className="grid grid-cols-3 gap-3">
              <CommissionInput
                id="client-posTerminalCommission"
                label={he.clients.form.posTerminalCommission}
                value={formData.posTerminalCommission}
                onChange={(v) => updateField("posTerminalCommission", v)}
                disabled={isSubmitting}
                suffix="₪"
              />
              <CommissionInput
                id="client-dineInCommission"
                label={he.clients.form.dineInCommission}
                value={formData.dineInCommission}
                onChange={(v) => updateField("dineInCommission", v)}
                disabled={isSubmitting}
              />
              <CommissionInput
                id="client-deliveryCommission"
                label={he.clients.form.deliveryCommission}
                value={formData.deliveryCommission}
                onChange={(v) => updateField("deliveryCommission", v)}
                disabled={isSubmitting}
              />
            </div>

            {/* Row 5 – Takeaway + Events (2 cols) */}
            <div className="grid grid-cols-2 gap-3">
              <CommissionInput
                id="client-takeawayCommission"
                label={he.clients.form.takeawayCommission}
                value={formData.takeawayCommission}
                onChange={(v) => updateField("takeawayCommission", v)}
                disabled={isSubmitting}
              />
              <CommissionInput
                id="client-eventsCommission"
                label={he.clients.form.eventsCommission}
                value={formData.eventsCommission}
                onChange={(v) => updateField("eventsCommission", v)}
                disabled={isSubmitting}
              />
            </div>

            {/* Row 6 – Additional Benefits (textarea, full width) */}
            <div className="space-y-2">
              <Label htmlFor="client-additionalBenefits">
                {he.clients.form.additionalBenefits}
              </Label>
              <Textarea
                id="client-additionalBenefits"
                value={formData.additionalBenefits}
                onChange={(e) =>
                  updateField("additionalBenefits", e.target.value)
                }
                placeholder={he.clients.form.additionalBenefitsPlaceholder}
                disabled={isSubmitting}
                rows={2}
              />
            </div>

            {/* Row 7 – Invoice Generation checkbox + isActive (edit only) */}
            <div className="flex items-center gap-6">
              <div className="flex items-center gap-2">
                <Checkbox
                  id="client-invoiceGeneration"
                  checked={formData.invoiceGeneration}
                  onCheckedChange={(checked) =>
                    updateField("invoiceGeneration", checked === true)
                  }
                  disabled={isSubmitting}
                />
                <Label
                  htmlFor="client-invoiceGeneration"
                  className="cursor-pointer font-normal"
                >
                  {he.clients.form.invoiceGeneration}
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="client-journalEntryGeneration"
                  checked={formData.journalEntryGeneration}
                  onCheckedChange={(checked) =>
                    updateField("journalEntryGeneration", checked === true)
                  }
                  disabled={isSubmitting}
                />
                <Label
                  htmlFor="client-journalEntryGeneration"
                  className="cursor-pointer font-normal"
                >
                  פקודת יומן
                </Label>
              </div>
              {editingClient && (
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="client-isActive"
                    checked={formData.isActive}
                    onCheckedChange={(checked) =>
                      updateField("isActive", checked === true)
                    }
                    disabled={isSubmitting}
                  />
                  <Label
                    htmlFor="client-isActive"
                    className="cursor-pointer font-normal"
                  >
                    {he.clients.status.active}
                  </Label>
                </div>
              )}
            </div>

            {/* Reconciliation settings section header */}
            <div className="relative flex items-center gap-3 py-1">
              <div className="flex-1 border-t" />
              <span className="text-xs font-medium text-muted-foreground shrink-0 flex items-center gap-1.5">
                <Settings2 className="h-3.5 w-3.5" />
                {he.clients.form.reconciliationSettings}
              </span>
              <div className="flex-1 border-t" />
            </div>

            {/* File format + Gmail sender email */}
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-2">
                <Label htmlFor="client-fileFormat">
                  {he.clients.form.fileFormat}
                </Label>
                <Select
                  value={formData.fileFormat}
                  onValueChange={(v) => updateField("fileFormat", v)}
                  disabled={isSubmitting}
                >
                  <SelectTrigger id="client-fileFormat">
                    <SelectValue placeholder={he.clients.form.fileFormatPlaceholder} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pdf">{he.clients.form.fileFormatOptions.pdf}</SelectItem>
                    <SelectItem value="excel">{he.clients.form.fileFormatOptions.excel}</SelectItem>
                    <SelectItem value="csv">{he.clients.form.fileFormatOptions.csv}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="col-span-2 space-y-2">
                <Label htmlFor="client-gmailSenderEmail">
                  {he.clients.form.gmailSenderEmail}
                </Label>
                <Input
                  id="client-gmailSenderEmail"
                  type="email"
                  dir="ltr"
                  value={formData.gmailSenderEmail}
                  onChange={(e) => updateField("gmailSenderEmail", e.target.value)}
                  placeholder={he.clients.form.gmailSenderEmailPlaceholder}
                  disabled={isSubmitting}
                />
              </div>
            </div>

            {/* Gmail search query */}
            <div className="space-y-2">
              <Label htmlFor="client-gmailSearchQuery">
                {he.clients.form.gmailSearchQuery}
              </Label>
              <Input
                id="client-gmailSearchQuery"
                dir="ltr"
                value={formData.gmailSearchQuery}
                onChange={(e) => updateField("gmailSearchQuery", e.target.value)}
                placeholder={he.clients.form.gmailSearchQueryPlaceholder}
                disabled={isSubmitting}
                className="font-mono text-sm"
              />
              <p className="text-xs text-muted-foreground">
                {he.clients.form.gmailSearchQueryHelp}
              </p>
            </div>

            {/* Tabit column names */}
            <div className="space-y-2">
              <Label htmlFor="client-tabitColumnNames">
                שמות עמודות בטאביט
              </Label>
              <Input
                id="client-tabitColumnNames"
                value={formData.tabitColumnNames}
                onChange={(e) => updateField("tabitColumnNames", e.target.value)}
                placeholder='למשל: סיבוס, סיבוס Online, סיבוס אונליין'
                disabled={isSubmitting}
              />
              <p className="text-xs text-muted-foreground">
                שמות אמצעי התשלום בקובץ טאביט, מופרדים בפסיק. משמש לפיוס אוטומטי.
              </p>
            </div>

            {/* Notes section */}
            <div className="space-y-2">
              <Label htmlFor="client-notes">{he.clients.form.notes}</Label>
              <Textarea
                id="client-notes"
                value={formData.notes}
                onChange={(e) => updateField("notes", e.target.value)}
                placeholder={he.clients.form.notesPlaceholder}
                disabled={isSubmitting}
                rows={2}
              />
            </div>

            {/* Franchisee multi-select section */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label>{he.clients.form.franchisees}</Label>
                {formData.franchiseeIds.length > 0 && (
                  <Badge variant="secondary" className="tabular-nums text-xs">
                    {formData.franchiseeIds.length} נבחרו
                  </Badge>
                )}
              </div>

              {/* Search input */}
              <div className="relative">
                <Search className="absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                <Input
                  value={franchiseeSearch}
                  onChange={(e) => setFranchiseeSearch(e.target.value)}
                  placeholder={he.clients.form.searchFranchisees}
                  className="ps-9"
                  disabled={isSubmitting}
                />
                {franchiseeSearch && (
                  <button
                    type="button"
                    onClick={() => setFranchiseeSearch("")}
                    className="absolute end-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>

              {/* Scrollable checkbox list */}
              <div className="max-h-48 overflow-y-auto rounded-md border bg-muted/30 p-2 space-y-1">
                {filteredFranchisees.length === 0 && (
                  <p className="py-4 text-center text-sm text-muted-foreground">
                    לא נמצאו זכיינים
                  </p>
                )}
                {filteredFranchisees.map(
                  (f: { id: string; name: string; code: string }) => {
                    const isChecked = formData.franchiseeIds.includes(f.id);
                    return (
                      <div
                        key={f.id}
                        className={`flex items-center gap-3 rounded px-2 py-1.5 cursor-pointer transition-colors ${
                          isChecked
                            ? "bg-primary/10"
                            : "hover:bg-muted"
                        }`}
                        onClick={() => !isSubmitting && toggleFranchisee(f.id)}
                      >
                        <Checkbox
                          id={`franchisee-${f.id}`}
                          checked={isChecked}
                          onCheckedChange={() =>
                            !isSubmitting && toggleFranchisee(f.id)
                          }
                          disabled={isSubmitting}
                          onClick={(e) => e.stopPropagation()}
                        />
                        <Label
                          htmlFor={`franchisee-${f.id}`}
                          className="flex-1 cursor-pointer font-normal flex items-center justify-between"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <span>{f.name}</span>
                          <span className="text-xs text-muted-foreground tabular-nums">
                            {f.code}
                          </span>
                        </Label>
                      </div>
                    );
                  }
                )}
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
                ) : editingClient ? (
                  he.common.update
                ) : (
                  he.clients.addButton
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ── Delete Confirmation ── */}
      <AlertDialog
        open={!!clientToDelete}
        onOpenChange={() => setClientToDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{he.clients.deleteTitle}</AlertDialogTitle>
            <AlertDialogDescription>
              {he.clients.deleteDescription} {clientToDelete?.name}?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{he.common.cancel}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {he.clients.deleteConfirm}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
