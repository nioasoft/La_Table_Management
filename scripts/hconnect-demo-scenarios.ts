/**
 * Demo-only: books our three billing flows as journal entries (movein) against
 * the named cards Reut opened in the demo company. Each "invoice" is booked the
 * way it lands in the ledger: debit the customer gross, credit income net,
 * credit VAT.
 *
 *   1. Supplier network commission   — אברהמי  → עמלות רשת   (+ מע"מ)
 *   2. Franchisee royalty + marketing — ויני ע  → 40001 הכנסות (+ מע"מ)
 *   3. Client commission              — סיבוס   → עמלות לקוחות (+ מע"מ)
 *
 * Amounts are illustrative, not real billing data.
 * Usage: npx dotenv -e .env -- npx tsx scripts/hconnect-demo-scenarios.ts
 */
import { sendToHashavshevet } from "../src/lib/hconnect";

const VAT_RATE = 0.18;
const VAT_ACCOUNT = 'מע"מ'; // gershayim on purpose: tests a quote inside the comma-delimited .dat

interface Scenario {
  reference: string;
  debit: string;
  credit: string;
  net: number;
  details: string;
  allocation?: string;
}

const SCENARIOS: Scenario[] = [
  { reference: "900101", debit: "אברהמי", credit: "עמלות רשת", net: 1000, details: "עמלות רשת אברהמי - דמו" },
  { reference: "900102", debit: "ויני ע", credit: "40001", net: 5000, details: "תמלוגים ויני ע - דמו" },
  { reference: "900103", debit: "ויני ע", credit: "40001", net: 1500, details: "שיווק ויני ע - דמו" },
  // leading-zero allocation number: must survive as text
  { reference: "900104", debit: "סיבוס", credit: "עמלות לקוחות", net: 750, details: "עמלות סיבוס - דמו", allocation: "012345678" },
];

const money = (n: number) => n.toFixed(2);

function ddmmyyyy(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`; // never toISOString()
}

async function main() {
  if (process.env.HCONNECT_COMPANY?.toLowerCase() !== "demo") {
    throw new Error("Demo scenarios run only against the demo company");
  }
  const today = ddmmyyyy(new Date());

  const rows = SCENARIOS.map((s) => {
    const vat = Math.round(s.net * VAT_RATE * 100) / 100;
    return {
      TransType: "00",
      Ref2: s.reference, // Reut books our id in אסמכתא 2, not אסמכתא
      ValueDate: today,
      DueDate: today,
      AccountKeyDeb1: s.debit,
      SuFDeb1: money(s.net + vat),
      AccountKeyCred1: s.credit,
      SuFCred1: money(s.net),
      AccountKeyCred2: VAT_ACCOUNT,
      SuFCred2: money(vat),
      Details: s.details,
      ...(s.allocation ? { TaxAPINumber: s.allocation } : {}),
    };
  });

  console.table(rows.map((r) => ({ ref: r.Ref2, deb: r.AccountKeyDeb1, gross: r.SuFDeb1, cred: r.AccountKeyCred1, net: r.SuFCred1, vat: r.SuFCred2 })));
  const result = await sendToHashavshevet("movein", process.env.HCONNECT_COMPANY!, rows);
  console.log(JSON.stringify(result));
  process.exit(result.kind === "ok" ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
