/**
 * Israeli tax allocation number (מספר הקצאה) extraction.
 *
 * Israeli law requires a 9-digit allocation number on tax invoices over
 * ₪10,000 (dropping to ₪5,000 in the future). Suppliers print it near the
 * label "מספר הקצאה" — but pdf-parse output is visual-RTL, so the label
 * may appear before the digits, after them, reversed ("רפסמ האצקה"), or
 * with newlines between.
 *
 * Returns the 9-digit string, or undefined if not present (which is valid —
 * invoices below the threshold are not required to carry an allocation number).
 */
export function extractAllocationNumber(text: string): string | undefined {
  // Patterns cover both reading orders (label-then-digits, digits-then-label),
  // both spellings of the label (Hebrew and visual-RTL flipped), and tolerate
  // whitespace/newlines between the digits and the label.
  const patterns = [
    /(?<!\d)(\d{9})(?!\d)\s*\n?\s*(?:הקצאה|הצקה)\s*(?:מספר|רפסמ)/, // "091097208\nהקצאה מספר"
    /(?:הקצאה|הצקה)\s*(?:מספר|רפסמ)\s*\n?\s*(?<!\d)(\d{9})(?!\d)/, // "מספר הקצאה 091097208"
    /(?:מספר|רפסמ)\s*(?:הקצאה|הצקה)\s*\n?\s*(?<!\d)(\d{9})(?!\d)/, // "מספר הקצאה" reversed-words
    /(?<!\d)(\d{9})(?!\d)\s*\n?\s*(?:מספר|רפסמ)\s*(?:הקצאה|הצקה)/, // digits then "מספר הקצאה"
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      return match[1];
    }
  }

  // Fallback for ezcount / Hyp-EasyCount invoices that glue a 17-digit issue
  // timestamp (YYYYMMDDHHMMSSmmm) directly onto the 9-digit allocation number
  // with no separator, e.g.
  //   "20260601224523045152063195הקצאה מספר:"  → allocation 152063195
  //   "20260401153109051091056762הקצאה מספר:"  → allocation 091056762
  // The isolated patterns above miss these because their (?<!\d) boundary
  // fails when a timestamp precedes the allocation. We grab the full digit run
  // adjacent to the label and take the trailing 9 digits (the allocation — the
  // leading digits are the timestamp). Anchored to the label so stray ח.פ. /
  // invoice numbers elsewhere in the document are never picked up.
  const gluedBeforeLabel = [
    /(\d{17,})\s*\n?\s*(?:הקצאה|הצקה)\s*(?:מספר|רפסמ)/, // digits then "הקצאה מספר"
    /(\d{17,})\s*\n?\s*(?:מספר|רפסמ)\s*(?:הקצאה|הצקה)/, // digits then "מספר הקצאה"
  ];
  for (const pattern of gluedBeforeLabel) {
    const match = text.match(pattern);
    if (match?.[1]) {
      return match[1].slice(-9);
    }
  }

  return undefined;
}
