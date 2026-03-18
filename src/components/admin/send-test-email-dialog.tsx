"use client";

import { useState, useEffect } from "react";
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
import { Send, Loader2, Eye, CheckCircle } from "lucide-react";
import { toast } from "sonner";
import { authClient } from "@/lib/auth-client";
import { useSendEmail, usePreviewEmailTemplate } from "@/queries/email-templates";
import type { EmailTemplate } from "@/db/schema";

interface SendTestEmailDialogProps {
  template: EmailTemplate | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// Default sample values for common template variables
const SAMPLE_VARIABLES: Record<string, string> = {
  entity_name: "ספק לדוגמה",
  period: "ינואר 2025",
  period_end_date: "31/01/2025",
  upload_link: "https://example.com/upload/test",
  deadline: "31/01/2025",
  brand_name: "VINNI",
  brand_names: "VINNI, MINNA TOMEI",
  recipient_name: "ישראל ישראלי",
  document_type: "דוח עמלות",
  due_date: "31/01/2025",
  description: "נא להעלות את הדוח החודשי",
};

export default function SendTestEmailDialog({
  template,
  open,
  onOpenChange,
}: SendTestEmailDialogProps) {
  const { data: session } = authClient.useSession();
  const userEmail = session?.user?.email || "";

  const [recipientEmail, setRecipientEmail] = useState(userEmail);
  const [variables, setVariables] = useState<Record<string, string>>({});
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [showPreview, setShowPreview] = useState(false);

  const sendMutation = useSendEmail();
  const previewMutation = usePreviewEmailTemplate();

  // Reset state when dialog opens with a new template
  useEffect(() => {
    if (open && template) {
      setRecipientEmail(userEmail);
      setShowPreview(false);
      setPreviewHtml(null);

      // Initialize variables with sample defaults
      const templateVars = (template.variables as string[]) || [];
      const initial: Record<string, string> = {};
      for (const v of templateVars) {
        initial[v] = SAMPLE_VARIABLES[v] || "";
      }
      setVariables(initial);
    }
  }, [open, template, userEmail]);

  const templateVars = (template?.variables as string[]) || [];

  const handlePreview = async () => {
    if (!template) return;
    previewMutation.mutate(
      { templateId: template.id, variables },
      {
        onSuccess: (data) => {
          setPreviewHtml(data.html);
          setShowPreview(true);
        },
        onError: () => {
          toast.error("שגיאה בתצוגה מקדימה");
        },
      }
    );
  };

  const handleSend = async () => {
    if (!template || !recipientEmail) return;

    sendMutation.mutate(
      {
        templateId: template.id,
        to: recipientEmail,
        variables,
      },
      {
        onSuccess: () => {
          toast.success("מייל הניסיון נשלח בהצלחה");
          onOpenChange(false);
        },
        onError: (error) => {
          toast.error(error.message || "שגיאה בשליחת מייל הניסיון");
        },
      }
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" dir="rtl">
        <DialogHeader>
          <DialogTitle>שליחת מייל ניסיון</DialogTitle>
          <DialogDescription>
            {template?.name
              ? `שלח מייל ניסיון מתבנית "${template.name}"`
              : "שלח מייל ניסיון עם נתונים לדוגמה"}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Recipient email */}
          <div className="space-y-2">
            <Label htmlFor="test-email">כתובת אימייל לבדיקה</Label>
            <Input
              id="test-email"
              type="email"
              value={recipientEmail}
              onChange={(e) => setRecipientEmail(e.target.value)}
              placeholder="your@email.com"
              dir="ltr"
            />
          </div>

          {/* Template variables */}
          {templateVars.length > 0 && (
            <div className="space-y-3">
              <Label>משתנים</Label>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {templateVars.map((varName) => (
                  <div key={varName} className="space-y-1">
                    <Label
                      htmlFor={`var-${varName}`}
                      className="text-xs text-muted-foreground"
                    >
                      {`{{${varName}}}`}
                    </Label>
                    <Input
                      id={`var-${varName}`}
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
            disabled={!recipientEmail || sendMutation.isPending}
            className="gap-2"
          >
            {sendMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : sendMutation.isSuccess ? (
              <CheckCircle className="h-4 w-4" />
            ) : (
              <Send className="h-4 w-4" />
            )}
            שלח מייל ניסיון
          </Button>
          <Button
            variant="outline"
            onClick={handlePreview}
            disabled={previewMutation.isPending}
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
