import { render } from "@react-email/components";
import { Resend } from "resend";
import { randomUUID } from "crypto";
import {
  SupplierRequestEmail,
  FranchiseeRequestEmail,
  ReminderEmail,
  FileRequestEmail,
  CustomEmail,
} from "@/emails";
import {
  type TemplateVariables,
  type SendEmailOptions,
  type SendEmailResult,
  type EmailTemplateType,
  VARIABLE_PATTERN,
  EMAIL_DEFAULTS,
} from "./types";
import {
  getEmailTemplateById,
  getEmailTemplateByCode,
  createEmailLog,
  updateEmailLogStatus,
} from "@/data-access/emailTemplates";
import type { EmailTemplate } from "@/db/schema";

// Initialize Resend client (can be null if not configured)
const resend = process.env.RESEND_API_KEY
  ? new Resend(process.env.RESEND_API_KEY)
  : null;

/**
 * Replace template variables in a string
 * Supports variables in {{variable_name}} format
 */
export function substituteVariables(
  template: string,
  variables: TemplateVariables
): string {
  return template.replace(VARIABLE_PATTERN, (match, variableName) => {
    const value = variables[variableName];
    return value !== undefined ? value : match;
  });
}

/**
 * Extract variables used in a template string
 */
export function extractVariables(template: string): string[] {
  const matches = template.matchAll(VARIABLE_PATTERN);
  const variables = new Set<string>();
  for (const match of matches) {
    variables.add(match[1]);
  }
  return Array.from(variables);
}

/**
 * Get React Email component by template type
 */
function getEmailComponent(templateType: EmailTemplateType) {
  switch (templateType) {
    case "supplier_request":
      return SupplierRequestEmail;
    case "franchisee_request":
      return FranchiseeRequestEmail;
    case "reminder":
      return ReminderEmail;
    case "file_request":
      return FileRequestEmail;
    case "custom":
    default:
      return CustomEmail;
  }
}

/**
 * Render a React Email template to HTML
 */
export async function renderEmailTemplate(
  templateType: EmailTemplateType,
  variables: TemplateVariables
): Promise<{ html: string; text: string }> {
  const EmailComponent = getEmailComponent(templateType);

  // Render with React Email
  const html = await render(EmailComponent(variables));

  // Generate plain text version (basic conversion)
  const text = await render(EmailComponent(variables), { plainText: true });

  return { html, text };
}

/**
 * Render a custom HTML template with variable substitution
 */
export function renderCustomTemplate(
  bodyHtml: string,
  bodyText: string | null,
  variables: TemplateVariables
): { html: string; text: string } {
  const html = substituteVariables(bodyHtml, variables);
  const text = bodyText
    ? substituteVariables(bodyText, variables)
    : html.replace(/<[^>]*>/g, ""); // Strip HTML tags for plain text

  return { html, text };
}

/**
 * Get template type from category or code
 */
export function getTemplateType(template: EmailTemplate): EmailTemplateType {
  const category = template.category?.toLowerCase();
  if (
    category === "supplier_request" ||
    category === "franchisee_request" ||
    category === "reminder" ||
    category === "file_request"
  ) {
    return category as EmailTemplateType;
  }
  return "custom";
}

/**
 * Send an email using a template ID
 */
export async function sendEmailWithTemplate(
  templateId: string,
  variables: TemplateVariables,
  options: SendEmailOptions
): Promise<SendEmailResult> {
  // Get the template
  const template = await getEmailTemplateById(templateId);
  if (!template) {
    return { success: false, error: "Template not found" };
  }

  return sendEmailWithTemplateData(template, variables, options);
}

/**
 * Send an email using a template code
 */
export async function sendEmailWithTemplateCode(
  templateCode: string,
  variables: TemplateVariables,
  options: SendEmailOptions
): Promise<SendEmailResult> {
  // Get the template
  const template = await getEmailTemplateByCode(templateCode);
  if (!template) {
    return { success: false, error: "Template not found" };
  }

  return sendEmailWithTemplateData(template, variables, options);
}

/**
 * Send an email using template data
 */
export async function sendEmailWithTemplateData(
  template: EmailTemplate,
  variables: TemplateVariables,
  options: SendEmailOptions
): Promise<SendEmailResult> {
  // Check if template is active
  if (!template.isActive) {
    return { success: false, error: "Template is inactive" };
  }

  // Substitute variables in subject
  const subject = options.subject || substituteVariables(template.subject, variables);

  // Render email content
  const { html, text } = renderCustomTemplate(
    template.bodyHtml,
    template.bodyText,
    variables
  );

  // Prepare email data
  const fromEmail = options.from || EMAIL_DEFAULTS.fromEmail;
  const fromName = options.fromName || EMAIL_DEFAULTS.fromName;

  // Create email log entry
  const logId = randomUUID();
  await createEmailLog({
    id: logId,
    templateId: template.id,
    toEmail: options.to,
    toName: options.toName || null,
    fromEmail,
    fromName,
    subject,
    bodyHtml: html,
    bodyText: text,
    status: "pending",
    entityType: options.entityType || null,
    entityId: options.entityId || null,
    metadata: options.metadata || null,
  });

  // Send email if Resend is configured
  if (resend) {
    try {
      const result = await resend.emails.send({
        from: `${fromName} <${fromEmail}>`,
        to: options.to,
        subject,
        html,
        text,
        replyTo: options.replyTo,
      });

      if (result.error) {
        await updateEmailLogStatus(logId, "failed", {
          failedAt: new Date(),
          errorMessage: result.error.message,
        });
        return { success: false, error: result.error.message };
      }

      await updateEmailLogStatus(logId, "sent", {
        messageId: result.data?.id,
        sentAt: new Date(),
      });

      return { success: true, messageId: result.data?.id };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      await updateEmailLogStatus(logId, "failed", {
        failedAt: new Date(),
        errorMessage,
      });
      return { success: false, error: errorMessage };
    }
  } else {
    // No email provider configured - log for development
    console.log("Email would be sent (no provider configured):", {
      to: options.to,
      subject,
      templateId: template.id,
    });

    await updateEmailLogStatus(logId, "sent", {
      sentAt: new Date(),
      messageId: `dev-${logId}`,
    });

    return { success: true, messageId: `dev-${logId}` };
  }
}

/**
 * Preview an email template with variables
 */
export async function previewEmailTemplate(
  templateId: string,
  variables: TemplateVariables
): Promise<{ subject: string; html: string; text: string } | null> {
  const template = await getEmailTemplateById(templateId);
  if (!template) {
    return null;
  }

  const subject = substituteVariables(template.subject, variables);
  const { html, text } = renderCustomTemplate(
    template.bodyHtml,
    template.bodyText,
    variables
  );

  return { subject, html, text };
}

/**
 * Preview a React Email template by type
 */
export async function previewReactEmailTemplate(
  templateType: EmailTemplateType,
  variables: TemplateVariables
): Promise<{ html: string; text: string }> {
  return renderEmailTemplate(templateType, variables);
}

/**
 * Validate template variables
 * Returns list of missing required variables
 */
export function validateTemplateVariables(
  template: EmailTemplate,
  variables: TemplateVariables
): string[] {
  const templateVariables = (template.variables as string[]) || [];
  const missing: string[] = [];

  for (const varName of templateVariables) {
    if (!variables[varName]) {
      missing.push(varName);
    }
  }

  return missing;
}
