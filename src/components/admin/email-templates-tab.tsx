"use client";

import { useEffect, useState, useCallback } from "react";
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
import { Textarea } from "@/components/ui/textarea";
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
  Mail,
  Plus,
  Pencil,
  Trash2,
  RefreshCw,
  X,
  Check,
  Loader2,
  Eye,
  Copy,
  Power,
  PowerOff,
} from "lucide-react";
import type { EmailTemplate } from "@/db/schema";
import {
  EMAIL_TEMPLATE_TYPES,
  type EmailTemplateType,
} from "@/lib/email/constants";
import { toast } from "sonner";
import { he } from "@/lib/translations/he";
import { authClient } from "@/lib/auth-client";

const t = he.admin.emailTemplates;
const tCommon = he.common;

interface TemplateFormData {
  name: string;
  code: string;
  subject: string;
  bodyHtml: string;
  bodyText: string;
  description: string;
  category: EmailTemplateType;
  isActive: boolean;
}

const initialFormData: TemplateFormData = {
  name: "",
  code: "",
  subject: "",
  bodyHtml: "",
  bodyText: "",
  description: "",
  category: "custom",
  isActive: true,
};

export default function EmailTemplatesTab() {
  const [isLoading, setIsLoading] = useState(true);
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [stats, setStats] = useState<{
    total: number;
    active: number;
    inactive: number;
    byCategory: Record<string, number>;
  } | null>(null);
  const [filter, setFilter] = useState<"all" | "active">("all");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");

  // Form dialog state
  const [showFormDialog, setShowFormDialog] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<EmailTemplate | null>(null);
  const [formData, setFormData] = useState<TemplateFormData>(initialFormData);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Preview dialog state
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [showPreviewDialog, setShowPreviewDialog] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);

  // Delete confirmation state
  const [deleteTemplateId, setDeleteTemplateId] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const { data: session } = authClient.useSession();
  const userRole = session ? (session.user as { role?: string })?.role : undefined;

  const fetchTemplates = useCallback(async () => {
    try {
      setIsLoading(true);
      let url = `/api/email-templates?stats=true`;
      if (filter === "active") {
        url += "&filter=active";
      }
      if (categoryFilter !== "all") {
        url += `&category=${categoryFilter}`;
      }
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error("Failed to fetch email templates");
      }
      const data = await response.json();
      setTemplates(data.templates || []);
      setStats(data.stats || null);
    } catch (error) {
      console.error("Error fetching email templates:", error);
      toast.error(t.messages.loadError);
    } finally {
      setIsLoading(false);
    }
  }, [filter, categoryFilter]);

  useEffect(() => {
    fetchTemplates();
  }, [fetchTemplates]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (!formData.name || !formData.code || !formData.subject || !formData.bodyHtml) {
      setFormError(t.form.validation.required);
      return;
    }

    try {
      setIsSubmitting(true);

      const url = editingTemplate
        ? `/api/email-templates/${editingTemplate.id}`
        : "/api/email-templates";

      const method = editingTemplate ? "PUT" : "POST";

      const response = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || `Failed to ${editingTemplate ? "update" : "create"} template`);
      }

      setShowFormDialog(false);
      setEditingTemplate(null);
      setFormData(initialFormData);
      await fetchTemplates();
      toast.success(editingTemplate ? t.messages.updateSuccess : t.messages.createSuccess);
    } catch (error) {
      console.error("Error saving template:", error);
      setFormError(error instanceof Error ? error.message : t.messages.saveError);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleEdit = (template: EmailTemplate) => {
    setEditingTemplate(template);
    setFormData({
      name: template.name,
      code: template.code,
      subject: template.subject,
      bodyHtml: template.bodyHtml,
      bodyText: template.bodyText || "",
      description: template.description || "",
      category: (template.category as EmailTemplateType) || "custom",
      isActive: template.isActive,
    });
    setShowFormDialog(true);
    setFormError(null);
  };

  const handleDelete = async () => {
    if (!deleteTemplateId) return;

    try {
      setIsDeleting(true);
      const response = await fetch(`/api/email-templates/${deleteTemplateId}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to delete template");
      }

      await fetchTemplates();
      toast.success(t.messages.deleteSuccess);
    } catch (error) {
      console.error("Error deleting template:", error);
      toast.error(error instanceof Error ? error.message : t.messages.deleteError);
    } finally {
      setIsDeleting(false);
      setDeleteTemplateId(null);
    }
  };

  const handleToggleStatus = async (template: EmailTemplate) => {
    try {
      const response = await fetch(`/api/email-templates/${template.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "toggle_status" }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to update template status");
      }

      await fetchTemplates();
      toast.success(template.isActive ? t.messages.deactivateSuccess : t.messages.activateSuccess);
    } catch (error) {
      console.error("Error updating template status:", error);
      toast.error(error instanceof Error ? error.message : t.messages.statusUpdateError);
    }
  };

  const handlePreview = async (templateId: string) => {
    try {
      setPreviewLoading(true);
      setShowPreviewDialog(true);

      const response = await fetch(`/api/email-templates/${templateId}/preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ variables: {} }),
      });

      if (!response.ok) {
        throw new Error("Failed to preview template");
      }

      const data = await response.json();
      setPreviewHtml(data.preview.html);
    } catch (error) {
      console.error("Error previewing template:", error);
      toast.error(error instanceof Error ? error.message : t.messages.previewError);
      setShowPreviewDialog(false);
    } finally {
      setPreviewLoading(false);
    }
  };

  const cancelForm = () => {
    setShowFormDialog(false);
    setEditingTemplate(null);
    setFormData(initialFormData);
    setFormError(null);
  };

  const insertVariable = (variable: string) => {
    const variableText = `{{${variable}}}`;
    setFormData((prev) => ({
      ...prev,
      bodyHtml: prev.bodyHtml + variableText,
    }));
  };

  const copyCode = (code: string) => {
    navigator.clipboard.writeText(code);
    toast.success(t.actions.codeCopied);
  };

  const openCreateForm = () => {
    setEditingTemplate(null);
    setFormData(initialFormData);
    setFormError(null);
    setShowFormDialog(true);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Stats Cards */}
      {stats && (
        <div className="grid gap-4 md:grid-cols-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">{t.stats.totalTemplates}</CardTitle>
              <Mail className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.total}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">{t.stats.active}</CardTitle>
              <Check className="h-4 w-4 text-green-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.active}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">{t.stats.inactive}</CardTitle>
              <X className="h-4 w-4 text-red-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.inactive}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">{t.stats.categories}</CardTitle>
              <Mail className="h-4 w-4 text-blue-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{Object.keys(stats.byCategory).length}</div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Filter and Actions */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-4 flex-wrap">
          <Select
            value={filter}
            onValueChange={(value) => setFilter(value as "all" | "active")}
          >
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder={t.filters.filterStatus} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t.filters.allTemplates}</SelectItem>
              <SelectItem value="active">{t.filters.activeOnly}</SelectItem>
            </SelectContent>
          </Select>
          <Select
            value={categoryFilter}
            onValueChange={(value) => setCategoryFilter(value)}
          >
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder={t.filters.filterByType} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t.filters.allTypes}</SelectItem>
              {EMAIL_TEMPLATE_TYPES.map((type) => (
                <SelectItem key={type} value={type}>
                  {t.templateTypes[type]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" onClick={fetchTemplates}>
            <RefreshCw className="ms-2 h-4 w-4" />
            {t.actions.refresh}
          </Button>
        </div>
        <Button onClick={openCreateForm}>
          <Plus className="ms-2 h-4 w-4" />
          {t.actions.addTemplate}
        </Button>
      </div>

      {/* Templates List */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Mail className="h-5 w-5" />
            {filter === "active" ? t.list.titleActive : t.list.title}
          </CardTitle>
          <CardDescription>
            {t.list.description}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {templates.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              {filter === "active"
                ? t.empty.noActiveTemplates
                : t.empty.noTemplates}
            </div>
          ) : (
            <div className="space-y-4">
              {templates.map((template) => (
                <div
                  key={template.id}
                  className="flex items-center justify-between p-4 rounded-lg border bg-card"
                >
                  <div className="space-y-1 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-medium">{template.name}</p>
                      <Badge variant={template.isActive ? "success" : "secondary"}>
                        {template.isActive ? t.statuses.active : t.statuses.inactive}
                      </Badge>
                      {template.category && (
                        <Badge variant="outline">
                          {t.templateTypes[template.category as EmailTemplateType] || template.category}
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <p className="text-sm text-muted-foreground">
                        {t.card.code} <span className="font-mono" dir="ltr">{template.code}</span>
                      </p>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 w-6 p-0"
                        onClick={() => copyCode(template.code)}
                        title={t.actions.copyCode}
                      >
                        <Copy className="h-3 w-3" />
                      </Button>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {t.card.subject} {template.subject}
                    </p>
                    {template.description && (
                      <p className="text-sm text-muted-foreground">{template.description}</p>
                    )}
                    {(() => {
                      const vars = template.variables as string[] | null;
                      if (!vars || !Array.isArray(vars) || vars.length === 0) return null;
                      return (
                        <div className="flex items-center gap-1 flex-wrap">
                          <span className="text-xs text-muted-foreground">{t.card.variables}</span>
                          {vars.map((v: string) => (
                            <Badge key={v} variant="outline" className="text-xs">
                              {`{{${v}}}`}
                            </Badge>
                          ))}
                        </div>
                      );
                    })()}
                    <p className="text-xs text-muted-foreground">
                      {t.card.updated} {new Date(template.updatedAt).toLocaleDateString("he-IL")}
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handlePreview(template.id)}
                      title={t.actions.preview}
                    >
                      <Eye className="h-4 w-4" />
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleToggleStatus(template)}
                      title={template.isActive ? t.actions.deactivate : t.actions.activate}
                    >
                      {template.isActive ? (
                        <PowerOff className="h-4 w-4" />
                      ) : (
                        <Power className="h-4 w-4" />
                      )}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleEdit(template)}
                      title={t.actions.edit}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    {userRole === "super_user" && (
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => setDeleteTemplateId(template.id)}
                        title={t.actions.delete}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Create/Edit Template Dialog */}
      <Dialog open={showFormDialog} onOpenChange={(open) => !open && cancelForm()}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingTemplate ? t.form.editTitle : t.form.createTitle}
            </DialogTitle>
            <DialogDescription>
              {editingTemplate
                ? t.form.editDescription
                : t.form.createDescription}
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="space-y-4">
            {formError && (
              <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-3">
                <p className="text-sm text-destructive">{formError}</p>
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="name">{t.form.fields.name}</Label>
                <Input
                  id="name"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder={t.form.fields.namePlaceholder}
                  disabled={isSubmitting}
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="code">{t.form.fields.code}</Label>
                <Input
                  id="code"
                  value={formData.code}
                  onChange={(e) => setFormData({ ...formData, code: e.target.value.toLowerCase().replace(/\s+/g, "_") })}
                  placeholder={t.form.fields.codePlaceholder}
                  disabled={isSubmitting}
                  required
                  dir="ltr"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="category">{t.form.fields.type}</Label>
                <Select
                  value={formData.category}
                  onValueChange={(value) => setFormData({ ...formData, category: value as EmailTemplateType })}
                >
                  <SelectTrigger id="category">
                    <SelectValue placeholder={t.form.fields.selectType} />
                  </SelectTrigger>
                  <SelectContent>
                    {EMAIL_TEMPLATE_TYPES.map((type) => (
                      <SelectItem key={type} value={type}>
                        {t.templateTypes[type]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="description">{t.form.fields.description}</Label>
                <Input
                  id="description"
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  placeholder={t.form.fields.descriptionPlaceholder}
                  disabled={isSubmitting}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="subject">{t.form.fields.subject}</Label>
              <Input
                id="subject"
                value={formData.subject}
                onChange={(e) => setFormData({ ...formData, subject: e.target.value })}
                placeholder={t.form.fields.subjectPlaceholder}
                disabled={isSubmitting}
                required
              />
            </div>

            {/* Variable Buttons */}
            <div className="space-y-2">
              <Label>{t.form.fields.insertVariables}</Label>
              <div className="flex flex-wrap gap-2">
                {Object.entries(t.variableDescriptions).map(([key, { label, description }]) => (
                  <Button
                    key={key}
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => insertVariable(key)}
                    title={description}
                  >
                    {`{{${key}}}`}
                  </Button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="bodyHtml">{t.form.fields.htmlBody}</Label>
              <Textarea
                id="bodyHtml"
                value={formData.bodyHtml}
                onChange={(e) => setFormData({ ...formData, bodyHtml: e.target.value })}
                placeholder={t.form.fields.htmlBodyPlaceholder}
                disabled={isSubmitting}
                required
                className="min-h-[200px] font-mono text-sm"
                dir="ltr"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="bodyText">{t.form.fields.plainTextBody}</Label>
              <Textarea
                id="bodyText"
                value={formData.bodyText}
                onChange={(e) => setFormData({ ...formData, bodyText: e.target.value })}
                placeholder={t.form.fields.plainTextBodyPlaceholder}
                disabled={isSubmitting}
                className="min-h-[100px] text-sm"
                dir="ltr"
              />
            </div>

            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="isActive"
                checked={formData.isActive}
                onChange={(e) => setFormData({ ...formData, isActive: e.target.checked })}
                disabled={isSubmitting}
                className="h-4 w-4 rounded border-gray-300"
              />
              <Label htmlFor="isActive">{t.form.fields.isActive}</Label>
            </div>

            <DialogFooter className="gap-2 pt-4">
              <Button type="button" variant="outline" onClick={cancelForm} disabled={isSubmitting}>
                {tCommon.cancel}
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? (
                  <>
                    <Loader2 className="ms-2 h-4 w-4 animate-spin" />
                    {tCommon.saving}
                  </>
                ) : (
                  <>
                    <Check className="ms-2 h-4 w-4" />
                    {editingTemplate ? tCommon.update : tCommon.create}
                  </>
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Preview Dialog */}
      <Dialog open={showPreviewDialog} onOpenChange={setShowPreviewDialog}>
        <DialogContent className="max-w-4xl max-h-[90vh]">
          <DialogHeader>
            <DialogTitle>{t.preview.title}</DialogTitle>
            <DialogDescription>
              {t.preview.description}
            </DialogDescription>
          </DialogHeader>
          <div className="overflow-auto max-h-[calc(90vh-120px)]">
            {previewLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-8 w-8 animate-spin" />
              </div>
            ) : previewHtml ? (
              <iframe
                srcDoc={previewHtml}
                className="w-full h-[600px] border rounded"
                title={t.preview.title}
              />
            ) : null}
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={!!deleteTemplateId} onOpenChange={(open) => !open && setDeleteTemplateId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t.deleteDialog.title}</AlertDialogTitle>
            <AlertDialogDescription>
              {t.deleteDialog.description}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>{t.deleteDialog.cancel}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={isDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeleting ? (
                <>
                  <Loader2 className="ms-2 h-4 w-4 animate-spin" />
                  {t.deleteDialog.deleting}
                </>
              ) : (
                t.deleteDialog.confirm
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
