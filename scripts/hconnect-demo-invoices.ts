/**
 * Demo-only: real invoices (imovein) in the shape our Excel exports produce —
 * customer card + item key + quantity 1 + price before VAT.
 *
 *   1. itemin  — creates the items the invoices need (Masofon2 must import
 *                these before the invoices; a rejected invoice file retries
 *                on the next run, so order self-heals).
 *   2. imovein — three invoices (DocumentID 1 = חשבונית):
 *        אברהמי — עמלות רשת
 *        ויני ע — הכנסותת (royalty, our real item key) + שיווק, one invoice, two lines
 *        סיבוס  — עמלות לקוחות, with a leading-zero allocation number
 *
 * Amounts are illustrative, not real billing data.
 * Usage: npx dotenv -e .env -- npx tsx scripts/hconnect-demo-invoices.ts
 */
import { sendToHashavshevet } from "../src/lib/hconnect";

const DOCUMENT_ID_INVOICE = "1";

const ITEMS = [
  { ItemKey: "עמלות רשת", ItemName: "עמלות רשת" },
  { ItemKey: "הכנסותת", ItemName: "תמלוגים" },
  { ItemKey: "שיווק", ItemName: "שיווק" },
  { ItemKey: "עמלות לקוחות", ItemName: "עמלות מלקוחות" },
];

interface InvoiceLine {
  accountKey: string;
  reference: string;
  itemKey: string;
  price: number;
  details: string;
  allocation?: string;
}

const LINES: InvoiceLine[] = [
  { accountKey: "אברהמי", reference: "910001", itemKey: "עמלות רשת", price: 1000, details: "עמלות רשת - דמו" },
  { accountKey: "ויני ע", reference: "910002", itemKey: "הכנסותת", price: 5000, details: "תמלוגים ושיווק - דמו" },
  { accountKey: "ויני ע", reference: "910002", itemKey: "שיווק", price: 1500, details: "תמלוגים ושיווק - דמו" },
  { accountKey: "סיבוס", reference: "910003", itemKey: "עמלות לקוחות", price: 750, details: "עמלות סיבוס - דמו", allocation: "012345678" },
];

function ddmmyyyy(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`; // never toISOString()
}

async function main() {
  if (process.env.HCONNECT_COMPANY?.toLowerCase() !== "demo") {
    throw new Error("Demo invoices run only against the demo company");
  }

  const items = await sendToHashavshevet("itemin", ITEMS);
  console.log("itemin:", JSON.stringify(items.body));
  if (!items.ok) process.exit(1);

  const today = ddmmyyyy(new Date());
  const invoices = await sendToHashavshevet(
    "imovein",
    LINES.map((l) => ({
      accountKey: l.accountKey,
      Reference: l.reference,
      DocumentID: DOCUMENT_ID_INVOICE,
      valueDate: today,
      itemkey: l.itemKey,
      Quantity: "1.000", // API rejects "1": decimal fields need a decimal point
      price: l.price.toFixed(2),
      details: l.details,
      ...(l.allocation ? { Assignmentnumber: l.allocation } : {}),
    }))
  );
  console.log("imovein:", JSON.stringify(invoices.body));
  process.exit(invoices.ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
