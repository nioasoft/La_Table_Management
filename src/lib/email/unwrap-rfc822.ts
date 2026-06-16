/**
 * Unwrap "Forward as attachment" emails (message/rfc822).
 *
 * Outlook's "Forward as attachment" wraps each original email as a
 * `message/rfc822` attachment instead of carrying the original PDF/link
 * directly. The inbound pipeline only accepts `application/pdf` (+Excel)
 * attachments, so these wrapped emails were silently filtered to zero and
 * logged as "no attachments / no download links".
 *
 * Real incident 2026-06-15: hadas@latableg.com forwarded 3 March Tenbis
 * commission invoices as message/rfc822 attachments — all three were dropped
 * (`raw_attachment_count=3`, `filtered_attachment_count=0`).
 *
 * This module parses the wrapped .eml and surfaces what the inbound handler
 * needs:
 *  - any PDF/Excel attachments inside (link-less invoices), and
 *  - the inner HTML/text body so the existing link-download path
 *    (`extractAndDownloadLinks`) can recover link-based invoices
 *    (10bis invoice-one.com / Mandrill PDFs), and
 *  - the inner Subject, so the caller can classify the document correctly
 *    (the OUTER forward often has an empty subject).
 */
import PostalMime from "postal-mime";

const DOCUMENT_EXTENSIONS = [".pdf", ".xlsx", ".xls"] as const;
const DOCUMENT_MIME_TYPES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
]);

/** Maximum nesting depth — guards against "forward of a forward of a ...". */
const MAX_DEPTH = 2;

export interface UnwrappedRfc822 {
  /** Inner email Subject (used to classify the document type). */
  subject: string;
  /** Inner email HTML body (for link extraction). */
  html: string;
  /** Inner email plain-text body (for link extraction). */
  text: string;
  /** Document attachments (PDF/Excel) found inside the wrapped email. */
  pdfFiles: { fileName: string; buffer: Buffer }[];
}

/** True when an inbound attachment is a forwarded email (message/rfc822 / .eml). */
export function isRfc822Attachment(att: {
  contentType: string;
  filename: string;
}): boolean {
  return (
    att.contentType.toLowerCase() === "message/rfc822" ||
    att.filename.toLowerCase().endsWith(".eml")
  );
}

function toBuffer(content: ArrayBuffer | Uint8Array | string): Buffer {
  if (typeof content === "string") return Buffer.from(content, "base64");
  return Buffer.from(content as ArrayBuffer);
}

function isDocumentAttachment(filename: string, mimeType: string): boolean {
  const lower = filename.toLowerCase();
  return (
    DOCUMENT_MIME_TYPES.has(mimeType.toLowerCase()) ||
    DOCUMENT_EXTENSIONS.some((ext) => lower.endsWith(ext))
  );
}

/**
 * Parse a wrapped email (raw RFC822 bytes) and extract document attachments
 * plus the inner subject/body. Recurses one level into nested message/rfc822
 * attachments (defensive — a forward of a forward). A malformed nested
 * message is skipped rather than failing the whole unwrap.
 */
export async function unwrapRfc822(
  buffer: Buffer,
  depth = 0,
): Promise<UnwrappedRfc822> {
  const email = await PostalMime.parse(buffer, {
    attachmentEncoding: "arraybuffer",
  });

  const pdfFiles: { fileName: string; buffer: Buffer }[] = [];
  let html = email.html ?? "";
  let text = email.text ?? "";

  for (const att of email.attachments) {
    const fileName = att.filename ?? "attachment";
    const mimeType = att.mimeType ?? "";
    const contentBuffer = toBuffer(att.content);

    // Nested forward-as-attachment: recurse to find the real document.
    if (
      depth < MAX_DEPTH &&
      (mimeType.toLowerCase() === "message/rfc822" ||
        fileName.toLowerCase().endsWith(".eml"))
    ) {
      try {
        const nested = await unwrapRfc822(contentBuffer, depth + 1);
        pdfFiles.push(...nested.pdfFiles);
        html += `\n${nested.html}`;
        text += `\n${nested.text}`;
      } catch {
        // Skip a malformed nested message — the body link scan may still
        // recover the invoice.
      }
      continue;
    }

    if (isDocumentAttachment(fileName, mimeType)) {
      pdfFiles.push({ fileName, buffer: contentBuffer });
    }
  }

  return { subject: email.subject ?? "", html, text, pdfFiles };
}
