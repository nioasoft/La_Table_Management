import { describe, expect, it } from "vitest";
import { isRfc822Attachment, unwrapRfc822 } from "../unwrap-rfc822";

/** Encode a (possibly Hebrew) header value as a UTF-8 base64 encoded-word. */
function encodeWord(value: string): string {
  return `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

/** Build a raw RFC822 message with an optional base64 attachment. */
function buildEml(opts: {
  subject: string;
  html: string;
  attachment?: { filename: string; contentType: string; content: Buffer };
}): Buffer {
  const boundary = "BOUND123";
  const lines: string[] = [
    `Subject: ${encodeWord(opts.subject)}`,
    "From: service@10bis.co.il",
    "To: hadas@latableg.com",
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    "Content-Type: text/html; charset=utf-8",
    "Content-Transfer-Encoding: base64",
    "",
    Buffer.from(opts.html, "utf8").toString("base64"),
  ];
  if (opts.attachment) {
    const { filename, contentType, content } = opts.attachment;
    lines.push(
      `--${boundary}`,
      `Content-Type: ${contentType}; name="${filename}"`,
      `Content-Disposition: attachment; filename="${filename}"`,
      "Content-Transfer-Encoding: base64",
      "",
      content.toString("base64"),
    );
  }
  lines.push(`--${boundary}--`, "");
  return Buffer.from(lines.join("\r\n"), "utf8");
}

describe("isRfc822Attachment", () => {
  it("detects message/rfc822 content type", () => {
    expect(
      isRfc822Attachment({ contentType: "message/rfc822", filename: "attachment" }),
    ).toBe(true);
  });

  it("detects .eml filename regardless of content type", () => {
    expect(
      isRfc822Attachment({ contentType: "application/octet-stream", filename: "Fwd.EML" }),
    ).toBe(true);
  });

  it("rejects a plain PDF attachment", () => {
    expect(
      isRfc822Attachment({ contentType: "application/pdf", filename: "invoice.pdf" }),
    ).toBe(false);
  });
});

describe("unwrapRfc822", () => {
  it("extracts an inner PDF attachment with its bytes and inner subject", async () => {
    const subject = 'חשבונית מס 12345 מאת תן ביס בע"מ';
    const pdfBytes = Buffer.from("%PDF-1.4 fake invoice body", "utf8");
    const eml = buildEml({
      subject,
      html: "<html><body>מצורפת חשבונית</body></html>",
      attachment: {
        filename: "invoice.pdf",
        contentType: "application/pdf",
        content: pdfBytes,
      },
    });

    const result = await unwrapRfc822(eml);

    expect(result.subject).toBe(subject);
    expect(result.pdfFiles).toHaveLength(1);
    expect(result.pdfFiles[0].fileName).toBe("invoice.pdf");
    expect(result.pdfFiles[0].buffer.equals(pdfBytes)).toBe(true);
  });

  it("returns the inner HTML body (for link extraction) when there is no attachment", async () => {
    const link = "https://invoice-one.com/view/abc.pdf?sig=xyz";
    const eml = buildEml({
      subject: "FW: חשבונית",
      html: `<html><body>צפה בחשבונית: <a href="${link}">כאן</a></body></html>`,
    });

    const result = await unwrapRfc822(eml);

    expect(result.pdfFiles).toHaveLength(0);
    expect(result.html).toContain(link);
  });

  it("recurses one level into a nested forwarded email to find the PDF", async () => {
    const pdfBytes = Buffer.from("%PDF-1.4 nested invoice", "utf8");
    const inner = buildEml({
      subject: "חשבונית מקורית",
      html: "<html><body>חשבונית</body></html>",
      attachment: {
        filename: "nested.pdf",
        contentType: "application/pdf",
        content: pdfBytes,
      },
    });
    const outer = buildEml({
      subject: "FW: העברה",
      html: "<html><body>מעביר אליך</body></html>",
      attachment: {
        filename: "forwarded.eml",
        contentType: "message/rfc822",
        content: inner,
      },
    });

    const result = await unwrapRfc822(outer);

    expect(result.pdfFiles).toHaveLength(1);
    expect(result.pdfFiles[0].fileName).toBe("nested.pdf");
    expect(result.pdfFiles[0].buffer.equals(pdfBytes)).toBe(true);
  });
});
