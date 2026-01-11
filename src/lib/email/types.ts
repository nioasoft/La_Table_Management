/**
 * Email Template Types and Constants - Server-side exports
 * Re-exports client-safe constants and adds server-only types
 */

// Re-export client-safe constants and types
export {
  EMAIL_TEMPLATE_TYPES,
  TEMPLATE_VARIABLES,
  VARIABLE_DESCRIPTIONS,
  TEMPLATE_TYPE_LABELS,
  type EmailTemplateType,
  type TemplateVariable,
  type TemplateVariables,
} from "./constants";

// Variable pattern for substitution - matches {{variable_name}}
export const VARIABLE_PATTERN = /\{\{(\w+)\}\}/g;

// Interface for email send options
export interface SendEmailOptions {
  to: string;
  toName?: string;
  from?: string;
  fromName?: string;
  subject?: string;
  replyTo?: string;
  entityType?: string;
  entityId?: string;
  metadata?: Record<string, unknown>;
}

// Interface for email send result
export interface SendEmailResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

// Default email settings
export const EMAIL_DEFAULTS = {
  fromEmail: process.env.EMAIL_FROM || "noreply@latable.co.il",
  fromName: process.env.EMAIL_FROM_NAME || "La Table Management",
};
