import { database } from "@/db";
import { supplier, supplierFileUpload } from "@/db/schema";
import { eq, desc, ilike } from "drizzle-orm";

async function main() {
  const sups = await database
    .select({ id: supplier.id, name: supplier.name, code: supplier.code })
    .from(supplier)
    .where(ilike(supplier.name, "%שרי%"));
  console.log("SUPPLIERS:", JSON.stringify(sups));
  for (const s of sups) {
    const files = await database
      .select({
        id: supplierFileUpload.id,
        status: supplierFileUpload.processingStatus,
        ps: supplierFileUpload.periodStartDate,
        pe: supplierFileUpload.periodEndDate,
        fname: supplierFileUpload.originalFileName,
        created: supplierFileUpload.createdAt,
        pr: supplierFileUpload.processingResult,
      })
      .from(supplierFileUpload)
      .where(eq(supplierFileUpload.supplierId, s.id))
      .orderBy(desc(supplierFileUpload.createdAt))
      .limit(5);
    for (const f of files) {
      const pr = f.pr as { error?: string; totalNetAmount?: number; matchStats?: unknown; anomalies?: unknown[] } | null;
      console.log(`\n${f.fname} | ${f.status} | ${f.ps}..${f.pe} | created=${f.created?.toISOString?.()}`);
      console.log(`  error=${pr?.error ?? "-"} net=${pr?.totalNetAmount} matchStats=${JSON.stringify(pr?.matchStats)} anomalies=${(pr?.anomalies ?? []).length}`);
    }
  }
  process.exit(0);
}
main();
