/**
 * Email Template Constants - Client-safe exports
 * This file contains only constants and types that can be safely used on both client and server
 */

// Template types supported by the system
export const EMAIL_TEMPLATE_TYPES = [
  "supplier_request",
  "franchisee_request",
  "reminder",
  "file_request",
  "custom",
] as const;

export type EmailTemplateType = (typeof EMAIL_TEMPLATE_TYPES)[number];

// Supported template variables for substitution
export const TEMPLATE_VARIABLES = [
  "entity_name",
  "period",
  "upload_link",
  "deadline",
  "brand_name",
] as const;

export type TemplateVariable = (typeof TEMPLATE_VARIABLES)[number];

// Variable descriptions for UI
export const VARIABLE_DESCRIPTIONS: Record<TemplateVariable, { label: string; description: string }> = {
  entity_name: {
    label: "Entity Name",
    description: "The name of the supplier or franchisee",
  },
  period: {
    label: "Period",
    description: "The reporting period (e.g., 'January 2024')",
  },
  upload_link: {
    label: "Upload Link",
    description: "The secure link for document upload",
  },
  deadline: {
    label: "Deadline",
    description: "The deadline date for the request",
  },
  brand_name: {
    label: "Brand Name",
    description: "The name of the franchise brand",
  },
};

// Template type labels for UI
export const TEMPLATE_TYPE_LABELS: Record<EmailTemplateType, string> = {
  supplier_request: "Supplier Request",
  franchisee_request: "Franchisee Request",
  reminder: "Reminder",
  file_request: "File Request",
  custom: "Custom",
};

// Interface for template variable values during substitution
export interface TemplateVariables {
  entity_name?: string;
  period?: string;
  upload_link?: string;
  deadline?: string;
  brand_name?: string;
  [key: string]: string | undefined;
}
