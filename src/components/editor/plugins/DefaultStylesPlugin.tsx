"use client";

import { useEffect } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { TextNode } from "lexical";

/**
 * Default email styles applied to every TextNode that has no inline style.
 *
 * Exactly like TicoVision: the styles live ON the nodes, so Lexical
 * renders them in the editor AND preserves them in $generateHtmlFromNodes
 * output as <span style="...">.
 */
const DEFAULT_TEXT_STYLE = [
  'font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Ubuntu, sans-serif',
  "font-size: 14px",
  "color: #333333",
  "line-height: 24px",
].join("; ");

/**
 * Applies default email inline styles to all TextNodes.
 *
 * Uses registerNodeTransform which fires on:
 * - Every existing TextNode when the transform is first registered
 * - Every new or modified TextNode going forward
 *
 * This ensures the editor surface displays styled text (what you see = what you get)
 * and $generateHtmlFromNodes exports <span style="..."> automatically.
 */
export function DefaultStylesPlugin() {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    return editor.registerNodeTransform(TextNode, (node) => {
      const existing = node.getStyle();
      if (!existing) {
        node.setStyle(DEFAULT_TEXT_STYLE);
      }
    });
  }, [editor]);

  return null;
}
