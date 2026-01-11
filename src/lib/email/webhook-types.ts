/**
 * Resend Webhook Types
 * Types and interfaces for handling Resend webhook events
 */

// Resend webhook event types
export type ResendWebhookEventType =
  | "email.sent"
  | "email.delivered"
  | "email.delivery_delayed"
  | "email.complained"
  | "email.bounced"
  | "email.opened"
  | "email.clicked";

// Base webhook event structure
export interface ResendWebhookEvent {
  type: ResendWebhookEventType;
  created_at: string;
  data: ResendWebhookEventData;
}

// Common data structure for webhook events
export interface ResendWebhookEventData {
  email_id: string;
  from: string;
  to: string[];
  subject: string;
  created_at: string;
}

// Extended data for bounce events
export interface ResendBounceEventData extends ResendWebhookEventData {
  bounce: {
    message: string;
  };
}

// Extended data for complaint events
export interface ResendComplaintEventData extends ResendWebhookEventData {
  complaint: {
    feedback_type: string;
  };
}

// Mapping from Resend event types to our email statuses
export const RESEND_EVENT_TO_STATUS_MAP: Record<ResendWebhookEventType, string | null> = {
  "email.sent": "sent",
  "email.delivered": "delivered",
  "email.delivery_delayed": null, // No status change, just log
  "email.complained": "bounced", // Treat complaints as bounces
  "email.bounced": "bounced",
  "email.opened": null, // Could be tracked separately in future
  "email.clicked": null, // Could be tracked separately in future
};

// Result of processing a webhook event
export interface WebhookProcessResult {
  success: boolean;
  messageId: string;
  eventType: ResendWebhookEventType;
  statusUpdated?: string;
  error?: string;
}
