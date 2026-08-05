import "dotenv/config";
import { database } from "../src/db";
import { sql } from "drizzle-orm";
const rows = ((await database.execute(sql.raw(
  `SELECT id, created_at, client_code, email_subject, file_name, status,
          proposed_franchisee_name, franchisee_confidence, proposed_document_type,
          parsed_data
   FROM inbound_review_queue
   WHERE client_code='HAAT' AND email_subject ILIKE '%easycount%' AND status='failed'
   ORDER BY created_at`
))).rows ?? []) as any[];

for (const r of rows) {
  console.log(`\n--- ${r.id} (${String(r.created_at).slice(0,16)}) ---`);
  console.log(`  what Reut sees: ספק=${r.client_code} | נושא="${r.email_subject}" | סוג=${r.proposed_document_type} | זכיין מוצע=${r.proposed_franchisee_name} | ביטחון=${r.franchisee_confidence} | קובץ=${r.file_name}`);
  console.log(`  parsed_data: ${JSON.stringify(r.parsed_data)?.slice(0, 400)}`);
}

console.log(`\n===== what the 7-day default window shows her right now =====`);
for (const r of ((await database.execute(sql.raw(
  `SELECT status, count(*) n FROM inbound_review_queue
   WHERE created_at > now() - interval '7 days' GROUP BY 1 ORDER BY 2 DESC`
))).rows ?? []) as any[]) {
  console.log(`  ${String(r.status).padEnd(16)} ${r.n}`);
}
process.exit(0);
