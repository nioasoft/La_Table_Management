/**
 * Post-process Lexical's HTML output to produce email-compatible HTML.
 *
 * 1. Adds inline styles to block elements (margin, font on p/h/li)
 * 2. Strips Lexical CSS class names
 * 3. Adds dir="rtl" for Hebrew
 * 4. Wraps in the full email layout (container, signature, brands)
 */

const BASE_FONT =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Ubuntu, sans-serif';

const ELEMENT_STYLES: Record<string, Record<string, string>> = {
  p: {
    "font-family": BASE_FONT,
    color: "#333333",
    "font-size": "14px",
    "line-height": "24px",
    margin: "0 0 10px 0",
    "text-align": "right",
    direction: "rtl",
  },
  h1: {
    "font-family": BASE_FONT,
    color: "#333333",
    "font-size": "24px",
    "font-weight": "bold",
    "line-height": "1.3",
    margin: "0 0 16px 0",
    direction: "rtl",
  },
  h2: {
    "font-family": BASE_FONT,
    color: "#333333",
    "font-size": "20px",
    "font-weight": "bold",
    "line-height": "1.3",
    margin: "0 0 12px 0",
    direction: "rtl",
  },
  h3: {
    "font-family": BASE_FONT,
    color: "#333333",
    "font-size": "16px",
    "font-weight": "600",
    "line-height": "1.4",
    margin: "0 0 8px 0",
    direction: "rtl",
  },
  ul: {
    margin: "0 0 10px 0",
    "padding-right": "24px",
    "padding-left": "0",
    direction: "rtl",
  },
  ol: {
    margin: "0 0 10px 0",
    "padding-right": "24px",
    "padding-left": "0",
    direction: "rtl",
  },
  li: {
    "font-family": BASE_FONT,
    color: "#333333",
    "font-size": "14px",
    "line-height": "24px",
    margin: "0 0 4px 0",
  },
  a: {
    color: "#2563eb",
    "text-decoration": "underline",
  },
  blockquote: {
    margin: "0 0 10px 0",
    "padding-right": "16px",
    "border-right": "3px solid #e6ebf1",
    color: "#666666",
    "font-style": "italic",
    direction: "rtl",
  },
  hr: {
    border: "none",
    "border-top": "1px solid #e6ebf1",
    margin: "20px 0",
  },
};

/** Add inline styles to block elements and strip CSS classes */
function styleContentElements(html: string): string {
  if (!html?.trim()) return html;

  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");

  for (const [tag, styles] of Object.entries(ELEMENT_STYLES)) {
    const elements = doc.body.querySelectorAll(tag);
    elements.forEach((el) => {
      if (el.hasAttribute("class")) {
        el.removeAttribute("class");
      }
      if (el.getAttribute("style")) return;

      const styleStr = Object.entries(styles)
        .map(([prop, val]) => `${prop}: ${val}`)
        .join("; ");
      el.setAttribute("style", styleStr);
    });
  }

  doc.body.querySelectorAll("[class]").forEach((el) => {
    el.removeAttribute("class");
  });

  // Convert standalone links to CTA buttons:
  // If a <p> contains ONLY a single <a> (no other text), style it as a button
  doc.body.querySelectorAll("p").forEach((p) => {
    const links = p.querySelectorAll("a");
    if (links.length !== 1) return;

    // Check that the <p> has no other meaningful text content besides the link
    const linkText = links[0].textContent || "";
    const pText = (p.textContent || "").trim();
    if (linkText.trim() !== pText) return;

    const a = links[0];
    // Style the link as a button
    a.setAttribute(
      "style",
      [
        "background-color: #2563eb",
        "border-radius: 6px",
        "border: 1px solid #2563eb",
        "color: #ffffff",
        `font-family: ${BASE_FONT}`,
        "font-size: 14px",
        "font-weight: 600",
        "text-decoration: none",
        "text-align: center",
        "display: inline-block",
        "padding: 12px 24px",
      ].join("; ")
    );

    // Center the parent paragraph
    p.setAttribute(
      "style",
      "text-align: center; margin: 24px 0; direction: rtl;"
    );
  });

  return doc.body.innerHTML;
}

/** Email signature + brand footer HTML (matches EmailLayout component) */
const EMAIL_FOOTER_HTML = `
    <hr style="border: none; border-top: 1px solid #e6ebf1; margin: 30px 0 20px;" />
    <div style="text-align: right; padding: 0 20px;">
      <p style="color: #333333; font-size: 16px; font-weight: 700; margin: 0 0 2px; text-align: right; font-family: ${BASE_FONT};">רעות</p>
      <p style="color: #333333; font-size: 14px; font-weight: 600; margin: 0 0 8px; text-align: right; letter-spacing: 1px; font-family: ${BASE_FONT};">קבוצת LA TABLE</p>
      <p style="color: #666666; font-size: 12px; margin: 0 0 2px; text-align: right; font-family: ${BASE_FONT};">שדרות משה גושן 16, קרית מוצקין</p>
      <p style="color: #666666; font-size: 12px; margin: 0; text-align: right; direction: ltr; font-family: ${BASE_FONT};">T: 04-8759732 &nbsp;&nbsp; F: 04-8763534</p>
    </div>
    <hr style="border: none; border-top: 1px solid #e6ebf1; margin: 16px 0;" />
    <table style="width: 100%; text-align: center; padding: 0 20px;" cellpadding="0" cellspacing="0">
      <tr>
        <td style="width: 25%; text-align: center;"><p style="color: #c41e3a; font-size: 13px; font-weight: 700; font-style: italic; margin: 0; letter-spacing: 1px;">VINNI</p></td>
        <td style="width: 25%; text-align: center;"><p style="color: #333333; font-size: 12px; font-weight: 800; margin: 0; letter-spacing: 1px;">KING KONG</p></td>
        <td style="width: 25%; text-align: center;"><p style="color: #e67e22; font-size: 12px; font-weight: 600; margin: 0; letter-spacing: 0.5px;">minna tomei</p></td>
        <td style="width: 25%; text-align: center;"><p style="color: #333333; font-size: 13px; font-weight: 700; margin: 0; letter-spacing: 2px;">NATANZON</p></td>
      </tr>
    </table>
    <hr style="border: none; border-top: 1px solid #f0f0f0; margin: 16px 0 8px;" />
    <p style="color: #8898aa; font-size: 11px; line-height: 16px; margin: 4px 0; text-align: center; font-family: ${BASE_FONT};">נא להעלות את הקבצים בקישור המצורף בפורמט Excel</p>`;

/**
 * Process Lexical HTML → complete email-ready HTML.
 *
 * 1. Style content elements with inline styles + RTL
 * 2. Wrap in email container (white card on gray bg)
 * 3. Append signature + brand footer
 */
export function inlineEmailStyles(html: string): string {
  const styledContent = styleContentElements(html);

  return `<div style="background-color: #f6f9fc; font-family: ${BASE_FONT}; padding: 20px 0;" dir="rtl">
  <div style="background-color: #ffffff; margin: 0 auto; padding: 40px 20px; max-width: 600px; border-radius: 8px;">
    ${styledContent}
    ${EMAIL_FOOTER_HTML}
  </div>
</div>`;
}
