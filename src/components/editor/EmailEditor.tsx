"use client";

import { useRef, useCallback } from "react";
import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import { ListPlugin } from "@lexical/react/LexicalListPlugin";
import { LinkPlugin } from "@lexical/react/LexicalLinkPlugin";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { OnChangePlugin } from "@lexical/react/LexicalOnChangePlugin";
import { HorizontalRulePlugin } from "@lexical/react/LexicalHorizontalRulePlugin";
import { HorizontalRuleNode } from "@lexical/react/LexicalHorizontalRuleNode";
import { $generateHtmlFromNodes } from "@lexical/html";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import type { EditorState, LexicalEditor as LexicalEditorType } from "lexical";
import { HeadingNode, QuoteNode } from "@lexical/rich-text";
import { ListNode, ListItemNode } from "@lexical/list";
import { LinkNode } from "@lexical/link";
import emailEditorTheme from "./email-editor-theme";
import { InitialValuePlugin } from "./plugins/InitialValuePlugin";
import { DefaultStylesPlugin } from "./plugins/DefaultStylesPlugin";
import { EmailEditorToolbar } from "./EmailEditorToolbar";
import { inlineEmailStyles } from "./inline-email-styles";

/** Static signature + brand footer shown below the editable area.
 *  Mirrors the EmailLayout component from src/emails/components/email-layout.tsx.
 *  Not editable — purely visual so the user sees the full email. */
function EmailSignatureFooter() {
  return (
    <div className="px-8 pb-6 select-none pointer-events-none opacity-80" dir="rtl">
      <hr className="border-t border-[#e6ebf1] my-6" />
      {/* Signature */}
      <div className="text-right px-5">
        <p className="text-[16px] font-bold text-[#333] m-0 mb-0.5">רעות</p>
        <p className="text-[14px] font-semibold text-[#333] m-0 mb-2 tracking-wide">
          קבוצת LA TABLE
        </p>
        <p className="text-[12px] text-[#666] m-0 mb-0.5">
          שדרות משה גושן 16, קרית מוצקין
        </p>
        <p className="text-[12px] text-[#666] m-0" dir="ltr">
          T: 04-8759732 &nbsp;&nbsp; F: 04-8763534
        </p>
      </div>
      <hr className="border-t border-[#e6ebf1] my-4" />
      {/* Brand logos */}
      <div className="grid grid-cols-4 text-center px-5">
        <p className="text-[13px] font-bold italic text-[#c41e3a] m-0 tracking-wide">
          VINNI
        </p>
        <p className="text-[12px] font-extrabold text-[#333] m-0 tracking-wide">
          KING KONG
        </p>
        <p className="text-[12px] font-semibold text-[#e67e22] m-0 tracking-[0.5px]">
          minna tomei
        </p>
        <p className="text-[13px] font-bold text-[#333] m-0 tracking-[2px]">
          NATANZON
        </p>
      </div>
      <hr className="border-t border-[#f0f0f0] mt-4 mb-2" />
      <p className="text-[11px] text-[#8898aa] text-center leading-4 m-0">
        נא להעלות את הקבצים בקישור המצורף בפורמט Excel
      </p>
    </div>
  );
}

interface EmailEditorProps {
  value?: string;
  onChange?: (html: string) => void;
  onEditorReady?: (editor: LexicalEditorType) => void;
  disabled?: boolean;
}

function EditorReadyPlugin({
  onEditorReady,
}: {
  onEditorReady?: (editor: LexicalEditorType) => void;
}) {
  const [editor] = useLexicalComposerContext();
  const calledRef = useRef(false);

  if (!calledRef.current && onEditorReady) {
    calledRef.current = true;
    queueMicrotask(() => onEditorReady(editor));
  }

  return null;
}

export function EmailEditor({
  value,
  onChange,
  onEditorReady,
  disabled,
}: EmailEditorProps) {
  const hasSetInitial = useRef(false);

  const initialConfig = {
    namespace: "EmailEditor",
    theme: emailEditorTheme,
    nodes: [
      HeadingNode,
      QuoteNode,
      ListNode,
      ListItemNode,
      LinkNode,
      HorizontalRuleNode,
    ],
    editable: !disabled,
    onError: (error: Error) => {
      console.error("EmailEditor error:", error);
    },
  };

  const handleChange = useCallback(
    (editorState: EditorState, editor: LexicalEditorType) => {
      if (!onChange) return;
      editorState.read(() => {
        const rawHtml = $generateHtmlFromNodes(editor);
        // Text-level styles (font, color, size) are already on the
        // <span> elements from DefaultStylesPlugin.
        // inlineEmailStyles only adds block-level styles (margin, etc.)
        // and strips Lexical CSS class names.
        const styledHtml = inlineEmailStyles(rawHtml);
        onChange(styledHtml);
      });
    },
    [onChange]
  );

  return (
    <LexicalComposer initialConfig={initialConfig}>
      <div className="flex flex-col flex-1 min-h-0">
        <div className="shrink-0 border-b px-3 py-1.5 bg-muted/20">
          <EmailEditorToolbar />
        </div>
        <div className="flex-1 min-h-0 overflow-auto bg-[#f6f9fc]">
          <div className="mx-auto my-4 max-w-[600px] rounded-lg bg-white shadow-sm">
            {/* Editable content area */}
            <RichTextPlugin
              contentEditable={
                <ContentEditable
                  className="min-h-[200px] px-8 pt-6 pb-2 outline-none"
                  dir="rtl"
                />
              }
              ErrorBoundary={LexicalErrorBoundary}
            />
            {/* Static signature & footer (not editable — mirrors EmailLayout) */}
            <EmailSignatureFooter />
          </div>
        </div>
      </div>
      {/* DefaultStylesPlugin BEFORE InitialValuePlugin so the node
          transform is registered before nodes are created */}
      <DefaultStylesPlugin />
      <HistoryPlugin />
      <ListPlugin />
      <LinkPlugin />
      <HorizontalRulePlugin />
      <InitialValuePlugin value={value} hasSetInitial={hasSetInitial} />
      <OnChangePlugin onChange={handleChange} ignoreSelectionChange />
      <EditorReadyPlugin onEditorReady={onEditorReady} />
    </LexicalComposer>
  );
}
