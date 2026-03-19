"use client";

import { useEffect } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $generateNodesFromDOM } from "@lexical/html";
import { $getRoot } from "lexical";

/**
 * Strip the EmailLayout signature/footer from HTML before loading into Lexical.
 * The signature is shown as a static element below the editor (EmailSignatureFooter),
 * so we don't want it duplicated inside the editable area.
 *
 * Detection: find the first <hr> whose following text contains signature markers
 * (רעות, LA TABLE, VINNI, etc.) and remove everything from that <hr> onwards.
 */
function stripEmailFooter(html: string): string {
  if (!html) return html;

  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");

  const SIGNATURE_MARKERS = ["רעות", "LA TABLE", "VINNI", "KING KONG"];

  // Walk all <hr> elements and check if what follows looks like a signature
  const hrs = doc.body.querySelectorAll("hr");
  for (const hr of hrs) {
    const followingText = getTextAfterElement(hr);
    const isSignature = SIGNATURE_MARKERS.some((marker) =>
      followingText.includes(marker)
    );
    if (isSignature) {
      // Remove the <hr> and everything after it
      removeElementAndFollowing(hr);
      return doc.body.innerHTML;
    }
  }

  // Also check for signature text in plain paragraphs (no <hr> separator)
  // e.g. when Lexical already parsed and re-exported the content
  const allElements = doc.body.children;
  for (let i = allElements.length - 1; i >= 0; i--) {
    const el = allElements[i];
    const text = el.textContent || "";
    // If a block near the end contains brand names, it's footer content
    if (
      text.includes("VINNI") &&
      text.includes("KING KONG") &&
      text.includes("NATANZON")
    ) {
      // Remove this element and everything after
      while (doc.body.children.length > i) {
        doc.body.removeChild(doc.body.children[doc.body.children.length - 1]);
      }
      // Also remove trailing signature blocks above (רעות, LA TABLE, etc.)
      removeTrailingSignature(doc.body);
      return doc.body.innerHTML;
    }
  }

  return html;
}

function getTextAfterElement(el: Element): string {
  const parts: string[] = [];
  let node: ChildNode | null = el.nextSibling;
  while (node) {
    parts.push(node.textContent || "");
    node = node.nextSibling;
  }
  return parts.join(" ");
}

function removeElementAndFollowing(el: Element): void {
  const parent = el.parentElement;
  if (!parent) return;
  while (el.nextSibling) {
    parent.removeChild(el.nextSibling);
  }
  parent.removeChild(el);
}

/** Remove trailing elements that look like signature content (רעות, LA TABLE, phone, address) */
function removeTrailingSignature(container: Element): void {
  const SIGNATURE_TEXTS = [
    "רעות",
    "LA TABLE",
    "קבוצת",
    "שדרות משה גושן",
    "04-8759732",
    "04-8763534",
    "הודעה זו נשלחה",
    "נא להעלות",
    "אנא אל תשיבו",
  ];

  let removed = true;
  while (removed && container.children.length > 0) {
    removed = false;
    const last = container.children[container.children.length - 1];
    const text = (last.textContent || "").trim();

    // Remove empty elements, <hr>s, and signature-matching blocks
    if (
      !text ||
      last.tagName === "HR" ||
      SIGNATURE_TEXTS.some((marker) => text.includes(marker))
    ) {
      container.removeChild(last);
      removed = true;
    }
  }
}

/**
 * Sets Lexical editor content from an HTML string on mount.
 * Only runs once (controlled by the hasSetInitial ref).
 * Strips the email signature/footer to avoid duplication with EmailSignatureFooter.
 */
export function InitialValuePlugin({
  value,
  hasSetInitial,
}: {
  value?: string;
  hasSetInitial: React.MutableRefObject<boolean>;
}) {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    if (value && !hasSetInitial.current) {
      hasSetInitial.current = true;
      const cleanedHtml = stripEmailFooter(value);
      editor.update(() => {
        const parser = new DOMParser();
        const dom = parser.parseFromString(cleanedHtml, "text/html");
        const nodes = $generateNodesFromDOM(editor, dom);
        const root = $getRoot();
        root.clear();
        root.append(...nodes);
      });
    }
  }, [editor, value, hasSetInitial]);

  return null;
}
