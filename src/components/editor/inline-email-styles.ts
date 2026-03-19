/**
 * Post-process Lexical's HTML output to produce email-compatible HTML.
 *
 * Lexical outputs clean semantic HTML with CSS class names from its theme
 * (e.g. `<p class="mb-2">`). Email clients ignore CSS classes entirely —
 * every element needs explicit inline styles.
 *
 * This function:
 * 1. Adds inline styles to every block/inline element
 * 2. Strips Lexical theme class names (useless in email)
 * 3. Preserves existing inline styles (from hand-edited HTML)
 */
export function inlineEmailStyles(html: string): string {
  if (!html?.trim()) return html;

  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");

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
    },
    h1: {
      "font-family": BASE_FONT,
      color: "#333333",
      "font-size": "24px",
      "font-weight": "bold",
      "line-height": "1.3",
      margin: "0 0 16px 0",
    },
    h2: {
      "font-family": BASE_FONT,
      color: "#333333",
      "font-size": "20px",
      "font-weight": "bold",
      "line-height": "1.3",
      margin: "0 0 12px 0",
    },
    h3: {
      "font-family": BASE_FONT,
      color: "#333333",
      "font-size": "16px",
      "font-weight": "600",
      "line-height": "1.4",
      margin: "0 0 8px 0",
    },
    ul: {
      margin: "0 0 10px 0",
      "padding-right": "24px",
      "padding-left": "0",
    },
    ol: {
      margin: "0 0 10px 0",
      "padding-right": "24px",
      "padding-left": "0",
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
    },
    hr: {
      border: "none",
      "border-top": "1px solid #e6ebf1",
      margin: "20px 0",
    },
  };

  for (const [tag, styles] of Object.entries(ELEMENT_STYLES)) {
    const elements = doc.body.querySelectorAll(tag);
    elements.forEach((el) => {
      // Strip Lexical CSS theme classes (meaningless in email)
      if (el.hasAttribute("class")) {
        el.removeAttribute("class");
      }

      // If the element already has inline styles, leave them alone
      // (preserves styles from hand-edited HTML tab)
      if (el.getAttribute("style")) return;

      // Build the inline style string
      const styleStr = Object.entries(styles)
        .map(([prop, val]) => `${prop}: ${val}`)
        .join("; ");
      el.setAttribute("style", styleStr);
    });
  }

  // Also strip class from any remaining elements (spans, divs, etc.)
  doc.body.querySelectorAll("[class]").forEach((el) => {
    el.removeAttribute("class");
  });

  return doc.body.innerHTML;
}
