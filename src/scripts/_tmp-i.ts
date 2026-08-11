import { database } from "@/db";
import { sql } from "drizzle-orm";
async function main() {
  const r = await database.execute(sql.raw(
    `select c.code, f.name, d.document_type dt, d.original_file_name fn, d.total_amount amt,
            d.invoice_number inv, d.file_url
     from client_document d join client c on c.id=d.client_id join franchisee f on f.id=d.franchisee_id
     where d.period_year=2026 and d.period_month=7 and f.name='ויני עזריאלי חיפה'
     order by c.code, d.document_type`));
  for (const row of r.rows ?? []) console.log(JSON.stringify(row));
  process.exit(0);
}
main();
