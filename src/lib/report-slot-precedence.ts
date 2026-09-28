/**
 * Who owns a 10bis client_report slot in a self-billed period.
 *
 * From the July-2026 period the slot holds the franchisee's ezcount tax
 * invoice (it carries the מספר הקצאה for column K of the journal-entries
 * export), not 10bis's transaction report. Both arrive in the same
 * "דוח חודשי מתן ביס" email, and whichever was processed first kept the slot:
 * August 2026 קסטרא טומאיי stored the report (₪27,796, no invoice, no
 * allocation) and parked invoice 10080 in the review queue.
 *
 * An invoice number is the tell — a transaction report never has one.
 */
export type SlotPrecedence = "replace" | "skip" | "default";

export function reportSlotPrecedence(args: {
  selfBilled: boolean;
  occupantInvoiceNumber: string | null;
  incomingInvoiceNumber: string | null;
}): SlotPrecedence {
  if (!args.selfBilled) return "default";
  if (!args.occupantInvoiceNumber && args.incomingInvoiceNumber) return "replace";
  if (args.occupantInvoiceNumber && !args.incomingInvoiceNumber) return "skip";
  return "default";
}
