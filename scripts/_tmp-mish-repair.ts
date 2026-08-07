/**
 * Repair: 4 ezcount invoices addressed to תן ביס that landed as MISHLOCHA
 * client_reports, and the Mishloha invoices they bounced.
 *   --backup --delete --replay --verify
 */
import "dotenv/config";
import { writeFileSync } from "node:fs";
import { database } from "../src/db";
import { sql } from "drizzle-orm";

const BACKUP = "/private/tmp/claude-501/-Users-asafbenatia-Projects--clients-La-Table-Management/bfc7b50e-cacf-4cf8-aa7e-271cacc61522/scratchpad/mishloha-july-backup.json";
const MISROUTED = ["10062", "10056", "10017", "10002"];

const rows = async (t: string) => ((await database.execute(sql.raw(t))).rows ?? []) as any[];

const WHERE = `c.code='MISHLOCHA' AND cd.period_year=2026 AND cd.period_month=7
   AND cd.document_type='client_report'
   AND cd.invoice_number IN (${MISROUTED.map((n) => `'${n}'`).join(",")})`;

if (process.argv.includes("--backup")) {
  const data = await rows(
    `SELECT cd.* FROM client_document cd JOIN client c ON c.id=cd.client_id
     WHERE c.code='MISHLOCHA' AND cd.period_year=2026 AND cd.period_month=7`
  );
  writeFileSync(BACKUP, JSON.stringify(data, null, 2));
  console.log(`backed up ${data.length} MISHLOCHA July rows → ${BACKUP}`);
}

if (process.argv.includes("--delete")) {
  for (const d of await rows(
    `SELECT f.name, cd.invoice_number, cd.total_amount
     FROM client_document cd JOIN client c ON c.id=cd.client_id
     JOIN franchisee f ON f.id=cd.franchisee_id WHERE ${WHERE}`
  )) {
    console.log(`  deleting  ${String(d.name).padEnd(22)} #${d.invoice_number} ₪${d.total_amount}`);
  }
  const r = await database.execute(sql.raw(
    `DELETE FROM client_document cd USING client c WHERE c.id=cd.client_id AND ${WHERE}`
  ));
  console.log(`deleted ${r.rowCount} misrouted rows`);
}

if (process.argv.includes("--replay")) {
  const ids = (await rows(
    `SELECT DISTINCT g.email_id, g.created_at
     FROM gmail_sync_log g
     WHERE g.client_code='MISHLOCHA' AND g.email_id IS NOT NULL
       AND g.subject LIKE '%[העתק]%' AND g.created_at > '2026-07-28'
     ORDER BY g.created_at`
  )).map((r) => r.email_id);
  const secret = process.env.CRON_SECRET;
  if (!secret) throw new Error("CRON_SECRET missing");
  console.log(`replaying ${ids.length} ezcount copy email(s)...`);
  const res = await fetch("https://www.latable.co.il/api/admin/replay-inbound", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${secret}` },
    body: JSON.stringify({ emailIds: ids }),
  });
  const body = await res.json();
  for (const o of body.outcomes ?? []) {
    console.log(`  ${String(o.status).padEnd(8)} client=${o.clientCode ?? "—"} docs=${o.documentsCreated ?? 0} dupes=${o.duplicatesSkipped ?? 0} ${o.error ?? ""}`);
  }
}

if (process.argv.includes("--verify")) {
  console.log("ספק      | זכיין | סוג | סכום | חשבונית");
  for (const r of await rows(
    `SELECT c.code, f.name, cd.document_type dt, cd.total_amount amt, cd.invoice_number inv
     FROM client_document cd JOIN client c ON c.id=cd.client_id
     JOIN franchisee f ON f.id=cd.franchisee_id
     WHERE c.code IN ('MISHLOCHA','TENBIS') AND cd.period_year=2026 AND cd.period_month=7
       AND cd.document_type<>'tabit_report'
     ORDER BY c.code, f.name, cd.document_type`
  )) {
    console.log(`${String(r.code).padEnd(10)} ${String(r.name).padEnd(22)} ${r.dt.padEnd(18)} ${String(r.amt).padStart(10)} #${r.inv ?? "—"}`);
  }
}
process.exit(0);
