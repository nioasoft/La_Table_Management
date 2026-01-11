/**
 * Resend Webhook Service
 * Handles processing of Resend webhook events for email status tracking
 */

import crypto from "crypto";
import {
  type ResendWebhookEvent,
  type ResendWebhookEventType,
  type ResendBounceEventData,
  type WebhookProcessResult,
  RESEND_EVENT_TO_STATUS_MAP,
} from "./webhook-types";
import {
  getEmailLogByMessageId,
  updateEmailLogStatus,
} from "@/data-access/emailTemplates";
import type { EmailStatus } from "@/db/schema";

/**
 * Verify Resend webhook signature
 * @see https://resend.com/docs/dashboard/webhooks/secure-your-webhooks
 */
export function verifyResendWebhookSignature(
  payload: string,
  signature: string,
  webhookSecret: string
): boolean {
  if (!signature || !webhookSecret) {
    console.error("Missing signature or webhook secret for verification");
    return false;
  }

  try {
    // Resend uses svix for webhook signing
    // The signature header contains a timestamp and signature
    // Format: "t=timestamp,v1=signature"
    const parts = signature.split(",");
    const timestamp = parts.find((p) => p.startsWith("t="))?.split("=")[1];
    const v1Signature = parts.find((p) => p.startsWith("v1="))?.split("=")[1];

    if (!timestamp || !v1Signature) {
      console.error("Invalid signature format");
      return false;
    }

    // Verify timestamp is within tolerance (5 minutes)
    const timestampMs = parseInt(timestamp, 10) * 1000;
    const now = Date.now();
    const tolerance = 5 * 60 * 1000; // 5 minutes

    if (Math.abs(now - timestampMs) > tolerance) {
      console.error("Webhook timestamp too old or in the future");
      return false;
    }

    // Compute expected signature
    const signedPayload = `${timestamp}.${payload}`;
    const expectedSignature = crypto
      .createHmac("sha256", webhookSecret)
      .update(signedPayload)
      .digest("hex");

    // Compare signatures using timing-safe comparison
    const signatureBuffer = Buffer.from(v1Signature, "hex");
    const expectedBuffer = Buffer.from(expectedSignature, "hex");

    if (signatureBuffer.length !== expectedBuffer.length) {
      return false;
    }

    return crypto.timingSafeEqual(signatureBuffer, expectedBuffer);
  } catch (error) {
    console.error("Error verifying webhook signature:", error);
    return false;
  }
}

/**
 * Process a Resend webhook event
 */
export async function processResendWebhookEvent(
  event: ResendWebhookEvent
): Promise<WebhookProcessResult> {
  const { type, data } = event;
  const messageId = data.email_id;

  console.log(`Processing Resend webhook event: ${type} for message ${messageId}`);

  // Check if we have a status mapping for this event type
  const newStatus = RESEND_EVENT_TO_STATUS_MAP[type];

  if (!newStatus) {
    // Event type doesn't require a status update (e.g., opened, clicked)
    console.log(`Event type ${type} does not require status update`);
    return {
      success: true,
      messageId,
      eventType: type,
    };
  }

  // Find the email log by message ID
  const emailLog = await getEmailLogByMessageId(messageId);

  if (!emailLog) {
    console.warn(`Email log not found for message ID: ${messageId}`);
    return {
      success: false,
      messageId,
      eventType: type,
      error: "Email log not found for this message ID",
    };
  }

  // Prepare update data based on event type
  const updateData: {
    sentAt?: Date;
    deliveredAt?: Date;
    failedAt?: Date;
    errorMessage?: string;
  } = {};

  const eventTime = new Date(event.created_at);

  switch (type) {
    case "email.sent":
      updateData.sentAt = eventTime;
      break;
    case "email.delivered":
      updateData.deliveredAt = eventTime;
      break;
    case "email.bounced":
      updateData.failedAt = eventTime;
      // Extract bounce message if available
      const bounceData = data as ResendBounceEventData;
      if (bounceData.bounce?.message) {
        updateData.errorMessage = `Bounce: ${bounceData.bounce.message}`;
      }
      break;
    case "email.complained":
      updateData.failedAt = eventTime;
      updateData.errorMessage = "Recipient marked email as spam";
      break;
  }

  // Update the email log status
  const updatedLog = await updateEmailLogStatus(
    emailLog.id,
    newStatus as EmailStatus,
    updateData
  );

  if (!updatedLog) {
    console.error(`Failed to update email log ${emailLog.id}`);
    return {
      success: false,
      messageId,
      eventType: type,
      error: "Failed to update email log status",
    };
  }

  console.log(`Successfully updated email log ${emailLog.id} to status: ${newStatus}`);

  return {
    success: true,
    messageId,
    eventType: type,
    statusUpdated: newStatus,
  };
}

/**
 * Parse and validate a webhook event from raw body
 */
export function parseWebhookEvent(body: string): ResendWebhookEvent | null {
  try {
    const event = JSON.parse(body) as ResendWebhookEvent;

    // Validate required fields
    if (!event.type || !event.data || !event.data.email_id) {
      console.error("Invalid webhook event structure:", event);
      return null;
    }

    // Validate event type
    const validEventTypes: ResendWebhookEventType[] = [
      "email.sent",
      "email.delivered",
      "email.delivery_delayed",
      "email.complained",
      "email.bounced",
      "email.opened",
      "email.clicked",
    ];

    if (!validEventTypes.includes(event.type)) {
      console.error(`Unknown webhook event type: ${event.type}`);
      return null;
    }

    return event;
  } catch (error) {
    console.error("Failed to parse webhook event:", error);
    return null;
  }
}
