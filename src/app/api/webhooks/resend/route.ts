import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import {
  processResendWebhookEvent,
  parseWebhookEvent,
} from "@/lib/email";

const resend = process.env.RESEND_API_KEY
  ? new Resend(process.env.RESEND_API_KEY)
  : null;

/**
 * POST /api/webhooks/resend - Handle Resend webhook events
 *
 * This endpoint receives webhook notifications from Resend for email delivery events.
 * Events include: email.sent, email.delivered, email.bounced, email.complained, etc.
 *
 * Security: Webhook signatures are verified using resend.webhooks.verify().
 *
 * @see https://resend.com/docs/dashboard/webhooks/introduction
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.text();
    const webhookSecret = process.env.RESEND_WEBHOOK_SECRET;

    // Verify webhook signature
    if (webhookSecret && resend) {
      const svixId = request.headers.get("svix-id");
      const svixTimestamp = request.headers.get("svix-timestamp");
      const svixSignature = request.headers.get("svix-signature");

      if (!svixId || !svixTimestamp || !svixSignature) {
        return NextResponse.json(
          { error: "Missing signature headers" },
          { status: 401 }
        );
      }

      try {
        resend.webhooks.verify({
          payload: body,
          headers: {
            id: svixId,
            timestamp: svixTimestamp,
            signature: svixSignature,
          },
          webhookSecret,
        });
      } catch (verifyError) {
        console.error("Invalid webhook signature:", verifyError);
        return NextResponse.json(
          { error: "Invalid signature" },
          { status: 401 }
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
 */
export async function GET() {
  return NextResponse.json({
    status: "ok",
    endpoint: "Resend webhook handler",
    configured: !!process.env.RESEND_WEBHOOK_SECRET,
  });
}
