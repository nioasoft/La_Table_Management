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
 * Verify Resend webhook signature (Svix format)
 *
 * Svix uses 3 headers:
 * - svix-id: message ID
 * - svix-timestamp: unix timestamp (seconds)
 * - svix-signature: "v1,base64_signature" (comma-separated, may have multiple)
 *
 * Signed content: `${svix-id}.${svix-timestamp}.${body}`
 * Secret: strip "whsec_" prefix, base64-decode to get raw key
 * HMAC-SHA256, then base64-encode result
 *
 * @see https://docs.svix.com/receiving/verifying-payloads/how
 */
export function verifyResendWebhookSignature(
  payload: string,
  signatureHeader: string,
  webhookSecret: string,
  svixId?: string,
  svixTimestamp?: string
): boolean {
  if (!signatureHeader || !webhookSecret) {
    console.error("Missing signature or webhook secret for verification");
    return false;
  }

  try {
    // Extract timestamp — from separate header or from signature header
    let msgId = svixId ?? "";
    let timestamp = svixTimestamp ?? "";
    let signatures: string[] = [];

    if (svixId && svixTimestamp) {
      // New format: separate headers
      signatures = signatureHeader
        .split(" ")
        .map((s) => s.trim())
        .filter(Boolean);
    } else {
      // Legacy format fallback: "t=timestamp,v1=signature"
      const parts = signatureHeader.split(",");
      timestamp =
        parts.find((p) => p.startsWith("t="))?.split("=")[1] ?? "";
      const v1 = parts.find((p) => p.startsWith("v1="));
      if (v1) signatures = [v1];
    }

    if (!timestamp) {
      console.error("Missing timestamp in webhook signature");
      return false;
    }

    // Verify timestamp is within tolerance (5 minutes)
    const timestampSec = parseInt(timestamp, 10);
    const nowSec = Math.floor(Date.now() / 1000);
    const tolerance = 5 * 60;

    if (Math.abs(nowSec - timestampSec) > tolerance) {
      console.error("Webhook timestamp too old or in the future");
      return false;
    }

    // Decode secret: strip "whsec_" prefix and base64-decode
    const secretStr = webhookSecret.startsWith("whsec_")
      ? webhookSecret.slice(6)
      : webhookSecret;
    const secretBytes = Buffer.from(secretStr, "base64");

    // Compute expected signature: HMAC-SHA256 of "msgId.timestamp.body"
    const signedContent = `${msgId}.${timestamp}.${payload}`;
    const expectedSignature = crypto
      .createHmac("sha256", secretBytes)
      .update(signedContent)
      .digest("base64");

    // Compare against all provided signatures (v1,xxx format)
    for (const sig of signatures) {
      const sigValue = sig.startsWith("v1,") ? sig.slice(3) : sig;

      const sigBuf = Buffer.from(sigValue, "base64");
      const expBuf = Buffer.from(expectedSignature, "base64");

      if (sigBuf.length === expBuf.length) {
        if (crypto.timingSafeEqual(sigBuf, expBuf)) {
          return true;
        }
      }
    }

    console.error("No matching signature found");
    return false;
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
