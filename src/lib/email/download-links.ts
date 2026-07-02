import { isSafePublicPdfUrl, MAX_PDF_DOWNLOAD_BYTES } from "@/lib/email/url-safety";

/**
 * Extract download links from email HTML body and download the PDFs.
 * Supports:
 * - Tenbis monthly reports: Mandrill tracking links wrapping cdn.10bis.co.il PDFs
 * - Tenbis tax invoices (חשבונית מס): invoice-one.com Y_GreeViewer pages
 *   that resolve to a Download endpoint returning the PDF as octet-stream
 * - ezcount (Mishloha, Haat): files.ezcount.co.il links that 302 to S3 PDFs
 */
export async function extractAndDownloadLinks(
  htmlBody: string,
  clientCode: string
): Promise<Array<{ buffer: Buffer; fileName: string }>> {
  const results: Array<{ buffer: Buffer; fileName: string }> = [];

  // Pattern 1: Tenbis monthly reports — Mandrill tracking links with
  // base64-encoded target URL. The `p` param JSON-decodes to an object whose
  // `url` field is the real cdn.10bis.co.il PDF.
  if (clientCode === "TENBIS") {
    const mandrillLinks = htmlBody.match(
      /https?:\/\/mandrillapp\.com\/track\/click\/[^"'\s<>]+/g
    ) || [];

    for (const trackingLink of mandrillLinks) {
      try {
        const url = new URL(trackingLink.replace(/&amp;/g, "&"));
        const pParam = url.searchParams.get("p");
        if (!pParam) continue;

        const decoded = JSON.parse(Buffer.from(pParam, "base64").toString());
        const innerData = JSON.parse(decoded.p);
        const pdfUrl: string = innerData.url;

        // SSRF guard: pdfUrl is decoded from attacker-influenceable email body.
        // Validate with an exact-host allowlist (not a substring match) over
        // https, and disable redirects so a 302 can't bounce us off-host.
        let parsedUrl: URL;
        try {
          parsedUrl = new URL(pdfUrl);
        } catch {
          continue;
        }
        const host = parsedUrl.hostname.toLowerCase().replace(/\.$/, "");
        if (
          parsedUrl.protocol !== "https:" ||
          (host !== "cdn.10bis.co.il" && !host.endsWith(".cdn.10bis.co.il")) ||
          !parsedUrl.pathname.toLowerCase().endsWith(".pdf")
        )
          continue;
        // Only download report PDFs (skip refund reports)
        if (pdfUrl.includes("refund_")) continue;

        console.log(`[email-inbound] Tenbis: downloading PDF from ${pdfUrl}`);
        const response = await fetch(pdfUrl, { redirect: "manual" });
        // 3xx (redirect) has response.ok === false → treated as failure below
        if (!response.ok) {
          console.warn(`[email-inbound] Failed to download ${pdfUrl}: ${response.status}`);
          continue;
        }

        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        const fileName = pdfUrl.split("/").pop() ?? "tenbis-report.pdf";

        results.push({ buffer, fileName });
      } catch (err) {
        console.warn("[email-inbound] Failed to decode Mandrill link:", err);
      }
    }

    // Pattern 1b: Tenbis tax invoices (חשבונית מס) — these come via the
    // invoice-one.com viewer, NOT Mandrill. Each email contains a viewer
    // URL like:
    //   https://invoice-one.com/ViewerNew/pages/Y_GreeViewer_document/<DOCID>
    // The PDF itself is at:
    //   https://invoice-one.com/ViewerNew/api/GreeViewer/Document/Download?DocumentID=<DOCID>
    // (returns application/octet-stream; the same DocID also appears in the
    // SetMailOpened tracking pixel inside the email body.)
    if (results.length === 0) {
      const viewerLinks = [
        ...htmlBody.matchAll(
          /https?:\/\/(?:www\.)?invoice-one\.com\/ViewerNew\/pages\/Y_GreeViewer_document\/(\w+)/gi
        ),
      ];
      // Dedupe by DocumentID — forwarded emails often carry the same link
      // both inline and as href, plus the SetMailOpened tracking-pixel URL.
      const docIds = [...new Set(viewerLinks.map((m) => m[1]))];

      for (const docId of docIds) {
        const pdfUrl = `https://invoice-one.com/ViewerNew/api/GreeViewer/Document/Download?DocumentID=${docId}`;
        try {
          console.log(`[email-inbound] Tenbis: downloading invoice from ${pdfUrl}`);
          const response = await fetch(pdfUrl);
          if (!response.ok) {
            console.warn(`[email-inbound] Failed to download ${pdfUrl}: ${response.status}`);
            continue;
          }
          const contentType = response.headers.get("content-type") ?? "";
          // The endpoint returns application/octet-stream when the doc exists
          // and text/html (the SPA shell) when the DocID is invalid. Skip the
          // HTML case so we don't try to PDF-parse an Angular index page.
          if (
            !contentType.includes("octet-stream") &&
            !contentType.includes("application/pdf")
          ) {
            console.warn(
              `[email-inbound] invoice-one.com returned non-PDF content-type "${contentType}" for DocID ${docId} — skipping`
            );
            continue;
          }
          const arrayBuffer = await response.arrayBuffer();
          const buffer = Buffer.from(arrayBuffer);
          results.push({
            buffer,
            fileName: `tenbis-invoice-${docId}.pdf`,
          });
        } catch (err) {
          console.warn(
            `[email-inbound] Failed to download invoice-one.com PDF (DocID ${docId}):`,
            err
          );
        }
      }
    }
  }

  // Pattern 2: ezcount (Mishloha, Haat) — files.ezcount.co.il download links
  // These redirect (302) to an S3 URL with the actual PDF
  if (results.length === 0) {
    const ezLinks =
      htmlBody.match(
        /https?:\/\/files\.ezcount\.co\.il\/front\/documents\/get\/[^"'\s<>]+/g
      ) || [];

    for (const ezUrl of ezLinks) {
      try {
        const cleanUrl = ezUrl.replace(/&amp;/g, "&");
        console.log(`[email-inbound] ezcount: downloading PDF from ${cleanUrl}`);
        // Follow the 302 redirect to S3
        const response = await fetch(cleanUrl, { redirect: "follow" });
        if (!response.ok) {
          console.warn(
            `[email-inbound] Failed to download ezcount PDF: ${response.status}`
          );
          continue;
        }

        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        // Extract UUID from URL for filename
        const uuidMatch = cleanUrl.match(
          /get\/([0-9a-f-]+)\//
        );
        const fileName = uuidMatch
          ? `ezcount-${uuidMatch[1]}.pdf`
          : "ezcount-invoice.pdf";

        results.push({ buffer, fileName });
      } catch (err) {
        console.warn("[email-inbound] Failed to download ezcount PDF:", err);
      }
    }
  }

  // Pattern 3: Direct PDF links (generic fallback) — covers HAAT (Azure
  // Blob), occasional Wolt/Mishloha direct links, and anything else that
  // posts a PDF URL straight in the body.
  //
  // CRITICAL: query strings must be preserved. HAAT links carry a SAS token
  // appended after `.pdf` (`?sv=...&sig=...`); without it Azure returns 403.
  if (results.length === 0) {
    const directLinks =
      htmlBody.match(
        /https?:\/\/[^\s"'<>]+\.pdf(?:\?[^\s"'<>]*)?/gi
      ) || [];

    // De-dup — HTML often repeats the same URL (text + href).
    const uniqueLinks = [...new Set(directLinks.map((u) => u.replace(/&amp;/g, "&")))];

    for (const pdfUrl of uniqueLinks) {
      try {
        // SSRF guard: pdfUrl comes straight from the attacker-influenceable
        // email body. Resolve + range-check the host (public, non-reserved)
        // before fetch.
        if (!(await isSafePublicPdfUrl(pdfUrl))) {
          console.warn(
            `[email-inbound] Direct PDF link rejected by SSRF guard: ${pdfUrl}`
          );
          continue;
        }

        console.log(`[email-inbound] Downloading direct PDF: ${pdfUrl}`);
        // redirect: "manual" so a redirect can't bounce the (guarded) public
        // URL to an internal host. Pattern 3 targets are direct PDFs (e.g. HAAT
        // Azure Blob SAS URLs); the one redirecting vendor (ezcount → S3) is
        // handled in Pattern 2 above with redirect: "follow".
        const response = await fetch(pdfUrl, { redirect: "manual" });
        if (!response.ok) {
          console.warn(
            `[email-inbound] Direct PDF download failed: ${response.status} ${response.statusText} (${pdfUrl})`
          );
          continue;
        }

        const declaredLength = Number(
          response.headers.get("content-length") ?? "0"
        );
        if (declaredLength > MAX_PDF_DOWNLOAD_BYTES) {
          console.warn(
            `[email-inbound] Direct PDF too large (${declaredLength} bytes): ${pdfUrl}`
          );
          continue;
        }

        const arrayBuffer = await response.arrayBuffer();
        if (arrayBuffer.byteLength > MAX_PDF_DOWNLOAD_BYTES) {
          console.warn(
            `[email-inbound] Direct PDF exceeded size cap after download (${arrayBuffer.byteLength} bytes): ${pdfUrl}`
          );
          continue;
        }
        const buffer = Buffer.from(arrayBuffer);
        // Strip query string from filename — keep only the actual `.pdf`
        // basename, never the SAS token.
        const fileName =
          pdfUrl.split("?")[0].split("/").pop() ?? "report.pdf";

        results.push({ buffer, fileName });
      } catch (err) {
        console.warn("[email-inbound] Failed to download PDF:", err);
      }
    }
  }

  return results;
}
