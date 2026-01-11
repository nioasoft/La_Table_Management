/**
 * Upload Notification Service
 * Handles sending notifications to Super Users when files are uploaded via secure links
 */

import { render } from "@react-email/components";
import { Resend } from "resend";
import { randomUUID } from "crypto";
import { getUsersByRole } from "@/data-access/users";
import { getUploadLinkById, type UploadLinkWithEntity } from "@/data-access/uploadLinks";
import { createEmailLog, updateEmailLogStatus } from "@/data-access/emailTemplates";
import { UploadNotificationEmail } from "@/emails";
import type { UploadedFile } from "@/db/schema";

// Initialize Resend client (can be null if not configured)
const resend = process.env.RESEND_API_KEY
  ? new Resend(process.env.RESEND_API_KEY)
  : null;

// Default email settings
const EMAIL_DEFAULTS = {
  fromEmail: process.env.EMAIL_FROM || "noreply@latable.co.il",
  fromName: process.env.EMAIL_FROM_NAME || "La Table Management",
};

/**
 * Format file size for display (bytes to KB/MB)
 */
function formatFileSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  } else if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  } else {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
}

/**
 * Format date for display
 */
function formatDate(date: Date): string {
  return date.toLocaleDateString("he-IL", {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Build the process link URL for the uploaded file
 */
function buildProcessLink(uploadLink: UploadLinkWithEntity): string {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.VERCEL_URL || "http://localhost:3000";

  // Link to the entity's page with upload link ID parameter
  // This allows admins to navigate directly to the relevant entity and see the uploaded files
  const entityPath = uploadLink.entityType === "supplier"
    ? `/suppliers/${uploadLink.entityId}`
    : uploadLink.entityType === "franchisee"
    ? `/franchisees/${uploadLink.entityId}`
    : uploadLink.entityType === "brand"
    ? `/brands/${uploadLink.entityId}`
    : `/upload-links/${uploadLink.id}`;

  return `${baseUrl}${entityPath}?uploadLinkId=${uploadLink.id}`;
}

/**
 * Notification result for a single super user
 */
export interface NotificationResult {
  userId: string;
  email: string;
  success: boolean;
  messageId?: string;
  error?: string;
}

/**
 * Result of notifying all super users
 */
export interface NotifySuperUsersResult {
  success: boolean;
  totalSent: number;
  totalFailed: number;
  results: NotificationResult[];
}

/**
 * Send upload notification to all active super users
 *
 * @param uploadLinkId - The ID of the upload link used for the upload
 * @param uploadedFile - The uploaded file record
 * @returns Result with details about each notification sent
 */
export async function notifySuperUsersAboutUpload(
  uploadLinkId: string,
  uploadedFile: UploadedFile
): Promise<NotifySuperUsersResult> {
  const results: NotificationResult[] = [];

  try {
    // Get the upload link details
    const uploadLink = await getUploadLinkById(uploadLinkId);
    if (!uploadLink) {
      return {
        success: false,
        totalSent: 0,
        totalFailed: 0,
        results: [{
          userId: "",
          email: "",
          success: false,
          error: "Upload link not found",
        }],
      };
    }

    // Get all active super users
    const superUsers = await getUsersByRole("super_user");
    const activeSuperUsers = superUsers.filter(u => u.status === "active" && u.email);

    if (activeSuperUsers.length === 0) {
      console.log("No active super users to notify about upload");
      return {
        success: true,
        totalSent: 0,
        totalFailed: 0,
        results: [],
      };
    }

    // Prepare email content
    const emailVariables = {
      entity_name: uploadLink.entityName || uploadLink.entityId,
      entity_type: uploadLink.entityType,
      file_name: uploadedFile.originalFileName,
      file_size: formatFileSize(uploadedFile.fileSize),
      uploader_email: uploadedFile.uploadedByEmail || "Not provided",
      upload_date: formatDate(new Date(uploadedFile.createdAt)),
      process_link: buildProcessLink(uploadLink),
      brand_name: "La Table",
    };

    // Render the email template
    const html = await render(UploadNotificationEmail(emailVariables));
    const text = await render(UploadNotificationEmail(emailVariables), { plainText: true });
    const subject = `New File Uploaded: ${uploadedFile.originalFileName} - ${uploadLink.entityName || uploadLink.entityId}`;

    // Send notification to each super user
    for (const superUser of activeSuperUsers) {
      const notificationResult = await sendNotificationEmail(
        superUser.id,
        superUser.email,
        subject,
        html,
        text,
        {
          uploadLinkId,
          uploadedFileId: uploadedFile.id,
          entityType: uploadLink.entityType,
          entityId: uploadLink.entityId,
        }
      );
      results.push(notificationResult);
    }

    const totalSent = results.filter(r => r.success).length;
    const totalFailed = results.filter(r => !r.success).length;

    return {
      success: totalFailed === 0,
      totalSent,
      totalFailed,
      results,
    };
  } catch (error) {
    console.error("Error notifying super users about upload:", error);
    return {
      success: false,
      totalSent: 0,
      totalFailed: 1,
      results: [{
        userId: "",
        email: "",
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      }],
    };
  }
}

/**
 * Send a single notification email
 */
async function sendNotificationEmail(
  userId: string,
  email: string,
  subject: string,
  html: string,
  text: string,
  metadata: Record<string, unknown>
): Promise<NotificationResult> {
  // Create email log entry
  const logId = randomUUID();

  try {
    await createEmailLog({
      id: logId,
      templateId: null, // Using React Email component directly
      toEmail: email,
      toName: null,
      fromEmail: EMAIL_DEFAULTS.fromEmail,
      fromName: EMAIL_DEFAULTS.fromName,
      subject,
      bodyHtml: html,
      bodyText: text,
      status: "pending",
      entityType: "upload_notification",
      entityId: metadata.uploadLinkId as string,
      metadata: {
        ...metadata,
        notificationType: "upload_notification",
        recipientUserId: userId,
        sentAt: new Date().toISOString(),
      },
    });

    // Send email if Resend is configured
    if (resend) {
      const result = await resend.emails.send({
        from: `${EMAIL_DEFAULTS.fromName} <${EMAIL_DEFAULTS.fromEmail}>`,
        to: email,
        subject,
        html,
        text,
      });

      if (result.error) {
        await updateEmailLogStatus(logId, "failed", {
          failedAt: new Date(),
          errorMessage: result.error.message,
        });
        return {
          userId,
          email,
          success: false,
          error: result.error.message,
        };
      }

      await updateEmailLogStatus(logId, "sent", {
        messageId: result.data?.id,
        sentAt: new Date(),
      });

      return {
        userId,
        email,
        success: true,
        messageId: result.data?.id,
      };
    } else {
      // No email provider configured - log for development
      console.log("Upload notification email would be sent (no provider configured):", {
        to: email,
        subject,
        metadata,
      });

      await updateEmailLogStatus(logId, "sent", {
        sentAt: new Date(),
        messageId: `dev-${logId}`,
      });

      return {
        userId,
        email,
        success: true,
        messageId: `dev-${logId}`,
      };
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";

    try {
      await updateEmailLogStatus(logId, "failed", {
        failedAt: new Date(),
        errorMessage,
      });
    } catch (updateError) {
      console.error("Failed to update email log status:", updateError);
    }

    return {
      userId,
      email,
      success: false,
      error: errorMessage,
    };
  }
}
