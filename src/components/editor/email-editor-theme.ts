/**
 * Lexical theme for the email template editor.
 * Uses Tailwind classes for the editor surface; the actual email HTML
 * is generated via $generateHtmlFromNodes which uses the DOM export of each node.
 */
const emailEditorTheme = {
  ltr: "ltr",
  rtl: "rtl text-right",
  paragraph: "mb-2",
  quote:
    "border-r-4 border-gray-300 pr-4 italic text-gray-600 my-4",
  heading: {
    h1: "text-3xl font-bold mb-4",
    h2: "text-2xl font-bold mb-3",
    h3: "text-xl font-semibold mb-2",
  },
  text: {
    bold: "font-bold",
    italic: "italic",
    underline: "underline",
    strikethrough: "line-through",
  },
  list: {
    nested: { listitem: "list-none" },
    ol: "list-decimal list-outside ps-6 mb-2",
    ul: "list-disc list-outside ps-6 mb-2",
    listitem: "mb-1",
  },
  link: "text-blue-600 underline cursor-pointer",
};

export default emailEditorTheme;
