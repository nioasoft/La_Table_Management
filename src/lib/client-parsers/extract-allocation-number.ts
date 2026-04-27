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

  return undefined;
}
