"use client";

import { useState, useMemo, useRef } from "react";
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
  Mail,
  Plus,
  Pencil,
  RefreshCw,
  X,
  Check,
  Loader2,
  Eye,
  Copy,
  Power,
  PowerOff,
  Send,
} from "lucide-react";
import type { EmailTemplate } from "@/db/schema";
import {
  EMAIL_TEMPLATE_TYPES,
  type EmailTemplateType,
} from "@/lib/email/constants";
import { toast } from "sonner";
import { he } from "@/lib/translations/he";
import { authClient } from "@/lib/auth-client";
import {
  useEmailTemplates,
  useCreateEmailTemplate,
  useUpdateEmailTemplate,
  useToggleEmailTemplateStatus,
  usePreviewEmailTemplate,
} from "@/queries/email-templates";
import SendTestEmailDialog from "./send-test-email-dialog";

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

// Sample variables for live preview
const SAMPLE_VARS: Record<string, string> = {
  entity_name: "ספק לדוגמה",
  period: "ינואר 2025",
  upload_link: "https://example.com/upload",
  deadline: "31/01/2025",
  brand_name: "Pat Vini",
  brand_names: "Pat Vini, Mina Tomai",
  recipient_name: "ישראל ישראלי",
  document_type: "דוח עמלות",
  due_date: "31/01/2025",
  description: "נא להעלות את הדוח",
};

/** Client-side variable substitution for live preview */
function substituteVarsClient(
  template: string,
  vars: Record<string, string>
): string {
  return template.replace(
    /\{\{(\w+)\}\}/g,
    (match, name) => vars[name] || match
  );
}

export default function EmailTemplatesTab() {
  const [filter, setFilter] = useState<"all" | "active">("all");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");

  // Form dialog state
  const [showFormDialog, setShowFormDialog] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<EmailTemplate | null>(
    null
  );
  const [formData, setFormData] = useState<TemplateFormData>(initialFormData);
  const [formError, setFormError] = useState<string | null>(null);

  // Preview dialog state
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [showPreviewDialog, setShowPreviewDialog] = useState(false);

  // Send test dialog state
  const [sendTestTemplate, setSendTestTemplate] =
    useState<EmailTemplate | null>(null);

  // Ref for HTML textarea (for cursor-position insert)
  const htmlTextareaRef = useRef<HTMLTextAreaElement>(null);

  const { data: session } = authClient.useSession();
  const userRole = session
    ? (session.user as { role?: string })?.role
    : undefined;

  // TanStack Query hooks
  const {
    data: templatesData,
    isLoading,
    refetch,
  } = useEmailTemplates({ filter, category: categoryFilter });

  const createMutation = useCreateEmailTemplate();
  const updateMutation = useUpdateEmailTemplate();
  const toggleStatusMutation = useToggleEmailTemplateStatus();
  const previewMutation = usePreviewEmailTemplate();

  const templates = templatesData?.templates ?? [];
  const stats = templatesData?.stats ?? null;
  const isSubmitting = createMutation.isPending || updateMutation.isPending;

  // Live preview HTML for the editor
  const livePreviewHtml = useMemo(() => {
    if (!formData.bodyHtml) return null;
    const subject = substituteVarsClient(formData.subject, SAMPLE_VARS);
    const body = substituteVarsClient(formData.bodyHtml, SAMPLE_VARS);
    return { subject, body };
  }, [formData.bodyHtml, formData.subject]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (
      !formData.name ||
      !formData.code ||
      !formData.subject ||
      !formData.bodyHtml
    ) {
      setFormError(t.form.validation.required);
      return;
    }

    const onSuccess = () => {
      setShowFormDialog(false);
      setEditingTemplate(null);
      setFormData(initialFormData);
      toast.success(
        editingTemplate ? t.messages.updateSuccess : t.messages.createSuccess
      );
    };

    const onError = (error: Error) => {
      setFormError(error.message || t.messages.saveError);
    };

    if (editingTemplate) {
      updateMutation.mutate(
        { id: editingTemplate.id, data: formData },
        { onSuccess, onError }
      );
    } else {
      createMutation.mutate(formData, { onSuccess, onError });
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

  const handleToggleStatus = (template: EmailTemplate) => {
    toggleStatusMutation.mutate(template.id, {
      onSuccess: () => {
        toast.success(
          template.isActive
            ? t.messages.deactivateSuccess
            : t.messages.activateSuccess
        );
      },
      onError: (error) => {
        toast.error(error.message || t.messages.statusUpdateError);
      },
    });
  };

  const handlePreview = (templateId: string) => {
    setShowPreviewDialog(true);
    setPreviewHtml(null);
    previewMutation.mutate(
      { templateId, variables: {} },
      {
        onSuccess: (data) => setPreviewHtml(data.html),
        onError: () => {
          toast.error(t.messages.previewError);
          setShowPreviewDialog(false);
        },
      }
    );
  };

  const cancelForm = () => {
    setShowFormDialog(false);
    setEditingTemplate(null);
    setFormData(initialFormData);
    setFormError(null);
  };

  const insertVariable = (variable: string) => {
    const variableText = `{{${variable}}}`;
    const textarea = htmlTextareaRef.current;

    if (textarea) {
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const before = formData.bodyHtml.substring(0, start);
      const after = formData.bodyHtml.substring(end);
      setFormData((prev) => ({
        ...prev,
        bodyHtml: before + variableText + after,
      }));
      // Restore cursor position after state update
      requestAnimationFrame(() => {
        textarea.selectionStart = textarea.selectionEnd =
          start + variableText.length;
        textarea.focus();
      });
    } else {
      setFormData((prev) => ({
        ...prev,
        bodyHtml: prev.bodyHtml + variableText,
      }));
    }
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
              <CardTitle className="text-sm font-medium">
                {t.stats.totalTemplates}
              </CardTitle>
              <Mail className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.total}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">
                {t.stats.active}
              </CardTitle>
              <Check className="h-4 w-4 text-green-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.active}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">
                {t.stats.inactive}
              </CardTitle>
              <X className="h-4 w-4 text-red-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.inactive}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">
                {t.stats.categories}
              </CardTitle>
              <Mail className="h-4 w-4 text-blue-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {Object.keys(stats.byCategory).length}
              </div>
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
          <Button variant="outline" onClick={() => refetch()}>
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
          <CardDescription>{t.list.description}</CardDescription>
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
                      <Badge
                        variant={
                          template.isActive ? "success" : "secondary"
                        }
                      >
                        {template.isActive
                          ? t.statuses.active
                          : t.statuses.inactive}
                      </Badge>
                      {template.category && (
                        <Badge variant="outline">
                          {t.templateTypes[
                            template.category as EmailTemplateType
                          ] || template.category}
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <p className="text-sm text-muted-foreground">
                        {t.card.code}{" "}
                        <span className="font-mono" dir="ltr">
                          {template.code}
                        </span>
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
                      <p className="text-sm text-muted-foreground">
                        {template.description}
                      </p>
                    )}
                    {(() => {
                      const vars = template.variables as string[] | null;
                      if (
                        !vars ||
                        !Array.isArray(vars) ||
                        vars.length === 0
                      )
                        return null;
                      return (
                        <div className="flex items-center gap-1 flex-wrap">
                          <span className="text-xs text-muted-foreground">
                            {t.card.variables}
                          </span>
                          {vars.map((v: string) => (
                            <Badge
                              key={v}
                              variant="outline"
                              className="text-xs"
                            >
                              {`{{${v}}}`}
                            </Badge>
                          ))}
                        </div>
                      );
                    })()}
                    <p className="text-xs text-muted-foreground">
                      {t.card.updated}{" "}
                      {new Date(template.updatedAt).toLocaleDateString(
                        "he-IL"
                      )}
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setSendTestTemplate(template)}
                      title="שלח מייל ניסיון"
                    >
                      <Send className="h-4 w-4" />
                    </Button>
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
                      title={
                        template.isActive
                          ? t.actions.deactivate
                          : t.actions.activate
                      }
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
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Create/Edit Template Dialog - Side-by-side with live preview */}
      <Dialog
        open={showFormDialog}
        onOpenChange={(open) => !open && cancelForm()}
      >
        <DialogContent className="max-w-7xl max-h-[90vh] overflow-hidden flex flex-col">
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

          <form onSubmit={handleSubmit} className="flex-1 min-h-0 flex flex-col overflow-hidden">
            {formError && (
              <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-3 mb-4 shrink-0">
                <p className="text-sm text-destructive">{formError}</p>
              </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 flex-1 min-h-0 overflow-hidden">
              {/* Left column: Form fields */}
              <div className="space-y-4 overflow-y-auto pe-2">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="name">{t.form.fields.name}</Label>
                    <Input
                      id="name"
                      value={formData.name}
                      onChange={(e) =>
                        setFormData({ ...formData, name: e.target.value })
                      }
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
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          code: e.target.value
                            .toLowerCase()
                            .replace(/\s+/g, "_"),
                        })
                      }
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
                      onValueChange={(value) =>
                        setFormData({
                          ...formData,
                          category: value as EmailTemplateType,
                        })
                      }
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
                    <Label htmlFor="description">
                      {t.form.fields.description}
                    </Label>
                    <Input
                      id="description"
                      value={formData.description}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          description: e.target.value,
                        })
                      }
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
                    onChange={(e) =>
                      setFormData({ ...formData, subject: e.target.value })
                    }
                    placeholder={t.form.fields.subjectPlaceholder}
                    disabled={isSubmitting}
                    required
                  />
                </div>

                {/* Variable Buttons */}
                <div className="space-y-2">
                  <Label>{t.form.fields.insertVariables}</Label>
                  <div className="flex flex-wrap gap-2">
                    {Object.entries(t.variableDescriptions).map(
                      ([key, { description }]) => (
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
                      )
                    )}
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="bodyHtml">{t.form.fields.htmlBody}</Label>
                  <Textarea
                    ref={htmlTextareaRef}
                    id="bodyHtml"
                    value={formData.bodyHtml}
                    onChange={(e) =>
                      setFormData({ ...formData, bodyHtml: e.target.value })
                    }
                    placeholder={t.form.fields.htmlBodyPlaceholder}
                    disabled={isSubmitting}
                    required
                    className="min-h-[250px] text-sm"
                    dir="auto"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="bodyText">
                    {t.form.fields.plainTextBody}
                  </Label>
                  <Textarea
                    id="bodyText"
                    value={formData.bodyText}
                    onChange={(e) =>
                      setFormData({ ...formData, bodyText: e.target.value })
                    }
                    placeholder={t.form.fields.plainTextBodyPlaceholder}
                    disabled={isSubmitting}
                    className="min-h-[80px] text-sm"
                    dir="auto"
                  />
                </div>

                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="isActive"
                    checked={formData.isActive}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        isActive: e.target.checked,
                      })
                    }
                    disabled={isSubmitting}
                    className="h-4 w-4 rounded border-gray-300"
                  />
                  <Label htmlFor="isActive">{t.form.fields.isActive}</Label>
                </div>
              </div>

              {/* Right column: Live preview */}
              <div className="space-y-3 overflow-y-auto">
                <div className="flex items-center gap-2">
                  <Eye className="h-4 w-4 text-muted-foreground" />
                  <Label className="text-sm font-medium">
                    תצוגה מקדימה חיה
                  </Label>
                </div>

                {livePreviewHtml ? (
                  <>
                    {/* Subject preview */}
                    <div className="rounded-md border bg-muted/30 p-3">
                      <p className="text-xs text-muted-foreground mb-1">
                        נושא:
                      </p>
                      <p className="text-sm font-medium" dir="auto">
                        {livePreviewHtml.subject}
                      </p>
                    </div>

                    {/* Body preview */}
                    <div className="border rounded-lg overflow-hidden flex-1">
                      <iframe
                        key={livePreviewHtml.body}
                        srcDoc={livePreviewHtml.body}
                        className="w-full h-[500px]"
                        title="תצוגה מקדימה חיה"
                        sandbox="allow-same-origin"
                      />
                    </div>
                  </>
                ) : (
                  <div className="flex items-center justify-center h-[400px] border rounded-lg bg-muted/20">
                    <div className="text-center text-muted-foreground">
                      <Eye className="h-12 w-12 mx-auto mb-4 opacity-20" />
                      <p className="text-sm">
                        הכנס HTML כדי לראות תצוגה מקדימה
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </div>

            <DialogFooter className="gap-2 pt-6 shrink-0">
              <Button
                type="button"
                variant="outline"
                onClick={cancelForm}
                disabled={isSubmitting}
              >
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
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
          <DialogHeader className="shrink-0">
            <DialogTitle>{t.preview.title}</DialogTitle>
            <DialogDescription>{t.preview.description}</DialogDescription>
          </DialogHeader>
          <div className="flex-1 min-h-0">
            {previewMutation.isPending ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-8 w-8 animate-spin" />
              </div>
            ) : previewHtml ? (
              <iframe
                srcDoc={previewHtml}
                className="w-full h-full border rounded"
                title={t.preview.title}
              />
            ) : null}
          </div>
        </DialogContent>
      </Dialog>

      {/* Send Test Email Dialog */}
      <SendTestEmailDialog
        template={sendTestTemplate}
        open={!!sendTestTemplate}
        onOpenChange={(open) => !open && setSendTestTemplate(null)}
      />
    </div>
  );
}
