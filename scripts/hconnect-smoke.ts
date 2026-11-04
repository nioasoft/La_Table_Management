/**
 * Demo-only smoke test: creates two test accounts (heshin), then posts one
 * balanced ₪1 journal entry from each against income account 40001 (movein).
 * Masofon2 must import the heshin batch BEFORE the movein batch.
 * Usage: npx dotenv -e .env -- npx tsx scripts/hconnect-smoke.ts
 */
import { sendToHashavshevet } from "../src/lib/hconnect";

const INCOME_ACCOUNT = "40001";
// ponytail: 5 digits to match the demo index key length (40001); fixed keys, rerunning re-sends the same accounts
const TEST_ACCOUNTS = [
  { accountKey: "99901", fullName: "בדיקת API La Table 1", reference: "900002" },
  { accountKey: "99902", fullName: "בדיקת API La Table 2", reference: "900003" },
];

function ddmmyyyy(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`; // never toISOString()
}

async function main() {
  if (process.env.HCONNECT_COMPANY?.toLowerCase() !== "demo") {
    throw new Error("Smoke test runs only against the demo company");
  }

  const accounts = await sendToHashavshevet(
    "heshin",
    process.env.HCONNECT_COMPANY!,
    TEST_ACCOUNTS.map((a) => ({ accountKey: a.accountKey, fullName: a.fullName }))
  );
  console.log(JSON.stringify(accounts, null, 2));
  if (accounts.kind !== "ok") process.exit(1);

  const today = ddmmyyyy(new Date());
  const entries = await sendToHashavshevet(
    "movein",
    process.env.HCONNECT_COMPANY!,
    TEST_ACCOUNTS.map((a) => ({
      TransType: "00",
      Reference: a.reference,
      ValueDate: today,
      DueDate: today,
      AccountKeyDeb1: a.accountKey,
      SuFDeb1: "1.00",
      AccountKeyCred1: INCOME_ACCOUNT,
      SuFCred1: "1.00",
      Details: "בדיקת API La Table",
    }))
  );
  console.log(JSON.stringify(entries, null, 2));
  process.exit(entries.kind === "ok" ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
