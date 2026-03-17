"use client";

import { useState, useEffect, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Send,
  Loader2,
  Eye,
  CheckCircle,
  Building2,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { useQuery } from "@tanstack/react-query";
import { fetchWithTimeout } from "@/lib/fetch-with-timeout";
import {
  useActiveEmailTemplates,
  useSendEmail,
  usePreviewEmailTemplate,
} from "@/queries/email-templates";
import type { EmailTemplate } from "@/db/schema";

interface SendToEntityDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface SupplierItem {
  id: string;
  name: string;
  code: string;
  contactEmail: string | null;
  contactName: string | null;
}

interface FranchiseeItem {
  id: string;
  name: string;
  code: string;
}

// Default sample values for variables
const SAMPLE_VARIABLES: Record<string, string> = {
  period: "ינואר 2025",
  upload_link: "https://example.com/upload/test",
  deadline: "31/01/2025",
  brand_name: "Pat Vini",
  brand_names: "Pat Vini, Mina Tomai",
  document_type: "דוח עמלות",
  due_date: "31/01/2025",
  description: "נא להעלות את הדוח החודשי",
};

export default function SendToEntityDialog({
  open,
  onOpenChange,
}: SendToEntityDialogProps) {
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>("");
  const [entityType, setEntityType] = useState<"supplier" | "franchisee">(
    "supplier"
  );
  const [entityId, setEntityId] = useState<string>("");
  const [recipientEmail, setRecipientEmail] = useState<string>("");
  const [recipientName, setRecipientName] = useState<string>("");
  const [variables, setVariables] = useState<Record<string, string>>({});
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [showPreview, setShowPreview] = useState(false);

  // Fetch active templates
  const { data: templates = [], isLoading: templatesLoading } =
    useActiveEmailTemplates();

  // Fetch suppliers
  const { data: suppliersData } = useQuery({
    queryKey: ["suppliers", "list"],
    queryFn: async () => {
      const res = await fetchWithTimeout("/api/suppliers");
      if (!res.ok) throw new Error("Failed to fetch suppliers");
      return res.json();
    },
    enabled: open && entityType === "supplier",
  });

  // Fetch franchisees
  const { data: franchiseesData } = useQuery({
    queryKey: ["franchisees", "list", { filter: "active" }],
    queryFn: async () => {
      const res = await fetchWithTimeout("/api/franchisees?filter=active");
      if (!res.ok) throw new Error("Failed to fetch franchisees");
      return res.json();
    },
    enabled: open && entityType === "franchisee",
  });

  const suppliers: SupplierItem[] = suppliersData?.suppliers || [];
  const franchisees: FranchiseeItem[] = franchiseesData?.franchisees || [];

  const sendMutation = useSendEmail();
  const previewMutation = usePreviewEmailTemplate();

  const selectedTemplate = useMemo(
    () =>
      (templates as EmailTemplate[]).find(
        (t: EmailTemplate) => t.id === selectedTemplateId
      ) || null,
    [templates, selectedTemplateId]
  );

  const templateVars = useMemo(
    () => (selectedTemplate?.variables as string[]) || [],
    [selectedTemplate]
  );

  // Reset when dialog opens
  useEffect(() => {
    if (open) {
      setSelectedTemplateId("");
      setEntityType("supplier");
      setEntityId("");
      setRecipientEmail("");
      setRecipientName("");
      setVariables({});
      setPreviewHtml(null);
      setShowPreview(false);
    }
  }, [open]);

  // Update variables when template changes
  useEffect(() => {
    if (selectedTemplate) {
      const initial: Record<string, string> = {};
      for (const v of templateVars) {
        if (v === "entity_name") {
          initial[v] = recipientName || "";
        } else {
          initial[v] = SAMPLE_VARIABLES[v] || "";
        }
      }
      setVariables(initial);
      setShowPreview(false);
      setPreviewHtml(null);
    }
  }, [selectedTemplate, templateVars, recipientName]);

  // Auto-fill email/name when entity changes
  useEffect(() => {
    if (entityType === "supplier" && entityId) {
      const supplier = suppliers.find((s) => s.id === entityId);
      if (supplier) {
        setRecipientEmail(supplier.contactEmail || "");
        setRecipientName(supplier.contactName || supplier.name);
        setVariables((prev) => ({
          ...prev,
          entity_name: supplier.name,
        }));
      }
    } else if (entityType === "franchisee" && entityId) {
      const franchisee = franchisees.find((f) => f.id === entityId);
      if (franchisee) {
        setRecipientName(franchisee.name);
        setRecipientEmail(""); // Franchisees don't have direct email
        setVariables((prev) => ({
          ...prev,
          entity_name: franchisee.name,
        }));
      }
    }
  }, [entityType, entityId, suppliers, franchisees]);

  const handlePreview = () => {
    if (!selectedTemplate) return;
    previewMutation.mutate(
      { templateId: selectedTemplate.id, variables },
      {
        onSuccess: (data) => {
          setPreviewHtml(data.html);
          setShowPreview(true);
        },
        onError: () => toast.error("שגיאה בתצוגה מקדימה"),
      }
    );
  };

  const handleSend = () => {
    if (!selectedTemplate || !recipientEmail) return;

    sendMutation.mutate(
      {
        templateId: selectedTemplate.id,
        to: recipientEmail,
        toName: recipientName || undefined,
        variables,
        entityType,
        entityId: entityId || undefined,
      },
      {
        onSuccess: () => {
          toast.success("האימייל נשלח בהצלחה");
          onOpenChange(false);
        },
        onError: (error) => {
          toast.error(error.message || "שגיאה בשליחת האימייל");
        },
      }
    );
  };

  const entities = entityType === "supplier" ? suppliers : franchisees;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-3xl max-h-[90vh] overflow-y-auto"
        dir="rtl"
      >
        <DialogHeader>
          <DialogTitle>שליחת אימייל</DialogTitle>
          <DialogDescription>
            בחר תבנית, בחר ספק או זכיין ושלח אימייל
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Template selection */}
          <div className="space-y-2">
            <Label>תבנית אימייל *</Label>
            <Select
              value={selectedTemplateId}
              onValueChange={setSelectedTemplateId}
              disabled={templatesLoading}
            >
              <SelectTrigger>
                <SelectValue
                  placeholder={
                    templatesLoading ? "טוען תבניות..." : "בחר תבנית"
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {(templates as EmailTemplate[]).map((t: EmailTemplate) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Entity type + entity selection */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>סוג ישות</Label>
              <Select
                value={entityType}
                onValueChange={(val) => {
                  setEntityType(val as "supplier" | "franchisee");
                  setEntityId("");
                  setRecipientEmail("");
                  setRecipientName("");
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="supplier">
                    <span className="flex items-center gap-2">
                      <Building2 className="h-3.5 w-3.5" />
                      ספק
                    </span>
                  </SelectItem>
                  <SelectItem value="franchisee">
                    <span className="flex items-center gap-2">
                      <Users className="h-3.5 w-3.5" />
                      זכיין
                    </span>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>{entityType === "supplier" ? "ספק" : "זכיין"} *</Label>
              <Select value={entityId} onValueChange={setEntityId}>
                <SelectTrigger>
                  <SelectValue
                    placeholder={
                      entityType === "supplier" ? "בחר ספק" : "בחר זכיין"
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {entities.map((e) => (
                    <SelectItem key={e.id} value={e.id}>
                      {e.name} ({e.code})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Recipient email - always editable */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>אימייל נמען *</Label>
              <Input
                type="email"
                value={recipientEmail}
                onChange={(e) => setRecipientEmail(e.target.value)}
                placeholder="email@example.com"
                dir="ltr"
              />
              {entityType === "franchisee" && !recipientEmail && entityId && (
                <p className="text-xs text-amber-600">
                  לזכיינים אין אימייל ישיר - נא להזין כתובת ידנית
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label>שם נמען</Label>
              <Input
                value={recipientName}
                onChange={(e) => setRecipientName(e.target.value)}
                placeholder="שם הנמען"
              />
            </div>
          </div>

          {/* Template variables */}
          {templateVars.length > 0 && (
            <div className="space-y-3">
              <Label>משתנים</Label>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {templateVars.map((varName) => (
                  <div key={varName} className="space-y-1">
                    <Label
                      htmlFor={`entity-var-${varName}`}
                      className="text-xs text-muted-foreground"
                    >
                      {`{{${varName}}}`}
                    </Label>
                    <Input
                      id={`entity-var-${varName}`}
                      value={variables[varName] || ""}
                      onChange={(e) =>
                        setVariables((prev) => ({
                          ...prev,
                          [varName]: e.target.value,
                        }))
                      }
                      placeholder={SAMPLE_VARIABLES[varName] || varName}
                      className="text-sm"
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Preview area */}
          {showPreview && previewHtml && (
            <div className="space-y-2">
              <Label>תצוגה מקדימה</Label>
              <div className="border rounded-lg overflow-hidden">
                <iframe
                  srcDoc={previewHtml}
                  className="w-full h-[300px]"
                  title="תצוגה מקדימה"
                  sandbox="allow-same-origin"
                />
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 flex-row-reverse sm:flex-row-reverse">
          <Button
            onClick={handleSend}
            disabled={
              !selectedTemplateId ||
              !recipientEmail ||
              sendMutation.isPending
            }
            className="gap-2"
          >
            {sendMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : sendMutation.isSuccess ? (
              <CheckCircle className="h-4 w-4" />
            ) : (
              <Send className="h-4 w-4" />
            )}
            שלח אימייל
          </Button>
          <Button
            variant="outline"
            onClick={handlePreview}
            disabled={!selectedTemplateId || previewMutation.isPending}
            className="gap-2"
          >
            {previewMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Eye className="h-4 w-4" />
            )}
            תצוגה מקדימה
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
