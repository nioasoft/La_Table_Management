"use client";

import { useState, useMemo, useRef, useEffect } from "react";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
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

  // Active editor tab: "text" | "html"
  const [activeEditorTab, setActiveEditorTab] = useState<"text" | "html">(
    "text"
  );

  // Refs for each editor textarea (cursor-position insert)
  const htmlTextareaRef = useRef<HTMLTextAreaElement>(null);
  const textTextareaRef = useRef<HTMLTextAreaElement>(null);

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

  // Live preview plain text for the editor
  const livePreviewText = useMemo(() => {
    const subject = substituteVarsClient(formData.subject, SAMPLE_VARS);
    const body = formData.bodyText
      ? substituteVarsClient(formData.bodyText, SAMPLE_VARS)
      : null;
    return { subject, body };
  }, [formData.bodyText, formData.subject]);

  // Update iframe content via ref (more reliable than key prop)
  const previewIframeRef = useRef<HTMLIFrameElement>(null);
  useEffect(() => {
    const iframe = previewIframeRef.current;
    if (iframe && livePreviewHtml?.body) {
      iframe.srcdoc = livePreviewHtml.body;
    }
  }, [livePreviewHtml]);

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
    setActiveEditorTab("text");
  };

  const insertVariable = (variable: string) => {
    const variableText = `{{${variable}}}`;

    if (activeEditorTab === "html") {
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
    } else {
      // Plain text tab — insert into bodyText
      const textarea = textTextareaRef.current;
      if (textarea) {
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        const before = formData.bodyText.substring(0, start);
        const after = formData.bodyText.substring(end);
        setFormData((prev) => ({
          ...prev,
          bodyText: before + variableText + after,
        }));
        requestAnimationFrame(() => {
          textarea.selectionStart = textarea.selectionEnd =
            start + variableText.length;
          textarea.focus();
        });
      } else {
        setFormData((prev) => ({
          ...prev,
          bodyText: prev.bodyText + variableText,
        }));
      }
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
    setActiveEditorTab("text");
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

      {/* Create/Edit Template Dialog — full-screen redesign */}
      <Dialog
        open={showFormDialog}
        onOpenChange={(open) => !open && cancelForm()}
      >
        <DialogContent className="w-[95vw] max-w-[95vw] h-[95vh] max-h-[95vh] p-0 overflow-hidden flex flex-col gap-0">
          {/* ── Header ─────────────────────────────────────────────────────── */}
          <div className="shrink-0 border-b bg-card px-6 pt-5 pb-4 space-y-4">
            <DialogHeader className="space-y-0">
              <div className="flex items-center justify-between">
                <DialogTitle className="text-lg font-semibold">
                  {editingTemplate ? t.form.editTitle : t.form.createTitle}
                </DialogTitle>
                {/* isActive checkbox lives in the header, far end */}
                <div className="flex items-center gap-2 me-8">
                  <Checkbox
                    id="isActive"
                    checked={formData.isActive}
                    onCheckedChange={(checked) =>
                      setFormData({ ...formData, isActive: !!checked })
                    }
                    disabled={isSubmitting}
                  />
                  <Label
                    htmlFor="isActive"
                    className="text-sm cursor-pointer select-none"
                  >
                    {t.form.fields.isActive}
                  </Label>
                </div>
              </div>
              <DialogDescription className="text-xs text-muted-foreground">
                {editingTemplate
                  ? t.form.editDescription
                  : t.form.createDescription}
              </DialogDescription>
            </DialogHeader>

            {/* Metadata row — name | code | category | description */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="name" className="text-xs">
                  {t.form.fields.name}
                </Label>
                <Input
                  id="name"
                  value={formData.name}
                  onChange={(e) =>
                    setFormData({ ...formData, name: e.target.value })
                  }
                  placeholder={t.form.fields.namePlaceholder}
                  disabled={isSubmitting}
                  required
                  className="h-8 text-sm"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="code" className="text-xs">
                  {t.form.fields.code}
                </Label>
                <Input
                  id="code"
                  value={formData.code}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      code: e.target.value.toLowerCase().replace(/\s+/g, "_"),
                    })
                  }
                  placeholder={t.form.fields.codePlaceholder}
                  disabled={isSubmitting}
                  required
                  dir="ltr"
                  className="h-8 text-sm font-mono"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="category" className="text-xs">
                  {t.form.fields.type}
                </Label>
                <Select
                  value={formData.category}
                  onValueChange={(value) =>
                    setFormData({
                      ...formData,
                      category: value as EmailTemplateType,
                    })
                  }
                >
                  <SelectTrigger id="category" className="h-8 text-sm">
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

              <div className="space-y-1.5">
                <Label htmlFor="description" className="text-xs">
                  {t.form.fields.description}
                </Label>
                <Input
                  id="description"
                  value={formData.description}
                  onChange={(e) =>
                    setFormData({ ...formData, description: e.target.value })
                  }
                  placeholder={t.form.fields.descriptionPlaceholder}
                  disabled={isSubmitting}
                  className="h-8 text-sm"
                />
              </div>
            </div>

            {/* Subject row — always visible */}
            <div className="space-y-1.5">
              <Label htmlFor="subject" className="text-xs">
                {t.form.fields.subject}
              </Label>
              <Input
                id="subject"
                value={formData.subject}
                onChange={(e) =>
                  setFormData({ ...formData, subject: e.target.value })
                }
                placeholder={t.form.fields.subjectPlaceholder}
                disabled={isSubmitting}
                required
                className="h-8 text-sm"
              />
            </div>
          </div>

          {/* ── Main content area: editor + preview ────────────────────────── */}
          <form
            onSubmit={handleSubmit}
            className="flex-1 min-h-0 flex flex-col overflow-hidden"
          >
            {formError && (
              <div className="shrink-0 mx-6 mt-3 rounded-lg border border-destructive/50 bg-destructive/10 p-3">
                <p className="text-sm text-destructive">{formError}</p>
              </div>
            )}

            {/* Split pane: right = editor, left = preview (RTL) */}
            <div className="flex-1 min-h-0 grid grid-cols-2 divide-x divide-x-reverse">
              {/* ── Editor panel (right side in RTL) ───────────────────── */}
              <div className="flex flex-col min-h-0 overflow-hidden">
                <Tabs
                  value={activeEditorTab}
                  onValueChange={(v) =>
                    setActiveEditorTab(v as "text" | "html")
                  }
                  className="flex flex-col flex-1 min-h-0"
                >
                  {/* Tab bar + variable buttons */}
                  <div className="shrink-0 border-b bg-muted/30 px-4 pt-3 pb-2 space-y-2">
                    <TabsList className="h-8">
                      <TabsTrigger value="text" className="text-xs h-7 px-3">
                        טקסט פשוט
                      </TabsTrigger>
                      <TabsTrigger value="html" className="text-xs h-7 px-3">
                        HTML
                      </TabsTrigger>
                    </TabsList>

                    {/* Variable insertion chips */}
                    <div className="flex flex-wrap gap-1.5 items-center">
                      <span className="text-xs text-muted-foreground shrink-0">
                        {t.form.fields.insertVariables}:
                      </span>
                      {Object.entries(t.variableDescriptions).map(
                        ([key, { description }]) => (
                          <button
                            key={key}
                            type="button"
                            onClick={() => insertVariable(key)}
                            title={description}
                            className="inline-flex items-center rounded-full border border-dashed border-muted-foreground/40 bg-background px-2 py-0.5 text-[11px] font-mono text-muted-foreground transition-colors hover:border-primary hover:bg-primary/5 hover:text-primary"
                          >
                            {`{{${key}}}`}
                          </button>
                        )
                      )}
                    </div>
                  </div>

                  {/* Plain text editor */}
                  <TabsContent
                    value="text"
                    className="flex-1 min-h-0 m-0 p-0 data-[state=active]:flex flex-col"
                  >
                    <Textarea
                      ref={textTextareaRef}
                      id="bodyText"
                      value={formData.bodyText}
                      onChange={(e) =>
                        setFormData({ ...formData, bodyText: e.target.value })
                      }
                      placeholder={t.form.fields.plainTextBodyPlaceholder}
                      disabled={isSubmitting}
                      dir="auto"
                      className="flex-1 min-h-0 h-full resize-none rounded-none border-0 border-none focus-visible:ring-0 focus-visible:ring-offset-0 text-sm leading-relaxed font-mono"
                    />
                  </TabsContent>

                  {/* HTML editor */}
                  <TabsContent
                    value="html"
                    className="flex-1 min-h-0 m-0 p-0 data-[state=active]:flex flex-col"
                  >
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
                      dir="ltr"
                      className="flex-1 min-h-0 h-full resize-none rounded-none border-0 border-none focus-visible:ring-0 focus-visible:ring-offset-0 text-sm leading-relaxed font-mono"
                    />
                  </TabsContent>
                </Tabs>
              </div>

              {/* ── Preview panel (left side in RTL) — always HTML ──── */}
              <div className="flex flex-col min-h-0 overflow-hidden bg-muted/10">
                {/* Preview header */}
                <div className="shrink-0 border-b bg-muted/30 px-4 pt-3 pb-2 flex items-center gap-2">
                  <Eye className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="text-xs font-medium text-muted-foreground">
                    תצוגה מקדימה — איך הלקוח יקבל את המייל
                  </span>
                </div>

                {/* Subject preview strip */}
                <div className="shrink-0 border-b px-4 py-2 bg-background">
                  <p className="text-[11px] text-muted-foreground mb-0.5">
                    נושא:
                  </p>
                  <p className="text-sm font-medium truncate" dir="auto">
                    {livePreviewHtml?.subject || (
                      <span className="text-muted-foreground italic text-xs">
                        (ריק)
                      </span>
                    )}
                  </p>
                </div>

                {/* Body preview — always HTML iframe */}
                <div className="flex-1 min-h-0 overflow-hidden">
                  {livePreviewHtml?.body ? (
                    <iframe
                      ref={previewIframeRef}
                      srcDoc={livePreviewHtml.body}
                      className="w-full h-full border-0"
                      title="תצוגה מקדימה"
                      sandbox="allow-same-origin"
                    />
                  ) : (
                    <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground">
                      <Eye className="h-10 w-10 opacity-15" />
                      <p className="text-sm">הכנס HTML כדי לראות תצוגה מקדימה</p>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* ── Footer ───────────────────────────────────────────────────── */}
            <DialogFooter className="shrink-0 border-t bg-card px-6 py-3 gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={cancelForm}
                disabled={isSubmitting}
                size="sm"
              >
                {tCommon.cancel}
              </Button>
              <Button type="submit" disabled={isSubmitting} size="sm">
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
