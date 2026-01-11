/**
 * Email Module Index
 * Exports all email-related types, constants, and services
 */

// Types and constants
export {
  EMAIL_TEMPLATE_TYPES,
  TEMPLATE_VARIABLES,
  VARIABLE_PATTERN,
  VARIABLE_DESCRIPTIONS,
  TEMPLATE_TYPE_LABELS,
  EMAIL_DEFAULTS,
  type EmailTemplateType,
  type TemplateVariable,
  type TemplateVariables,
  type SendEmailOptions,
  type SendEmailResult,
} from "./types";

// Service functions
export {
  substituteVariables,
  extractVariables,
  renderEmailTemplate,
  renderCustomTemplate,
  getTemplateType,
  sendEmailWithTemplate,
  sendEmailWithTemplateCode,
  sendEmailWithTemplateData,
  previewEmailTemplate,
  previewReactEmailTemplate,
  validateTemplateVariables,
} from "./service";

// Webhook types and services
export {
  type ResendWebhookEvent,
  type ResendWebhookEventType,
  type ResendWebhookEventData,
  type ResendBounceEventData,
  type ResendComplaintEventData,
  type WebhookProcessResult,
  RESEND_EVENT_TO_STATUS_MAP,
} from "./webhook-types";

export {
  verifyResendWebhookSignature,
  processResendWebhookEvent,
  parseWebhookEvent,
} from "./webhook-service";
