import { NextRequest, NextResponse } from "next/server";
import {
  verifyResendWebhookSignature,
  processResendWebhookEvent,
  parseWebhookEvent,
} from "@/lib/email";

/**
 * POST /api/webhooks/resend - Handle Resend webhook events
 *
 * This endpoint receives webhook notifications from Resend for email delivery events.
 * Events include: email.sent, email.delivered, email.bounced, email.complained, etc.
 *
 * Security: Webhook signatures are verified using the RESEND_WEBHOOK_SECRET.
 *
 * @see https://resend.com/docs/dashboard/webhooks/introduction
 */
export async function POST(request: NextRequest) {
  try {
    // Get raw body for signature verification
    const body = await request.text();

    // Get signature from headers
    const signature = request.headers.get("svix-signature");

    // Verify webhook signature in production
    const webhookSecret = process.env.RESEND_WEBHOOK_SECRET;

    if (process.env.NODE_ENV === "production") {
      if (!webhookSecret) {
        console.error("RESEND_WEBHOOK_SECRET is not configured");
        return NextResponse.json(
          { error: "Webhook secret not configured" },
          { status: 500 }
        );
      }

      if (!signature) {
        console.error("Missing webhook signature header");
        return NextResponse.json(
          { error: "Missing signature" },
          { status: 401 }
        );
      }

      const isValid = verifyResendWebhookSignature(body, signature, webhookSecret);

      if (!isValid) {
        console.error("Invalid webhook signature");
        return NextResponse.json(
          { error: "Invalid signature" },
          { status: 401 }
        );
      }
    } else {
      // In development, log a warning if signature verification is skipped
      if (!signature || !webhookSecret) {
        console.warn(
          "Skipping webhook signature verification in development mode"
        );
      }
    }

    // Parse the webhook event
    const event = parseWebhookEvent(body);

    if (!event) {
      return NextResponse.json(
        { error: "Invalid webhook payload" },
        { status: 400 }
      );
    }

    // Process the webhook event
    const result = await processResendWebhookEvent(event);

    if (!result.success) {
      // Log the error but return 200 to prevent Resend from retrying
      // (since the issue is likely that we don't have the email log)
      console.error("Webhook processing error:", result.error);
      return NextResponse.json({
        received: true,
        processed: false,
        error: result.error,
      });
    }

    return NextResponse.json({
      received: true,
      processed: true,
      eventType: result.eventType,
      statusUpdated: result.statusUpdated || null,
    });
  } catch (error) {
    console.error("Error handling Resend webhook:", error);

    // Return 200 to prevent retries for unrecoverable errors
    return NextResponse.json({
      received: true,
      processed: false,
      error: "Internal server error",
    });
  }
}

/**
 * GET /api/webhooks/resend - Health check endpoint
 *
 * Can be used to verify the webhook endpoint is accessible.
 */
export async function GET() {
  return NextResponse.json({
    status: "ok",
    endpoint: "Resend webhook handler",
    configured: !!process.env.RESEND_WEBHOOK_SECRET,
  });
}
