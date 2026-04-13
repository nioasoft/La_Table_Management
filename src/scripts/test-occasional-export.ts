/**
 * Verify getOccasionalClientsForExport() returns BIG קריות row
 * for קינג קונג ביג × 2026-03.
 */
import { database } from "@/db";
import { franchisee } from "@/db/schema";
import { ilike } from "drizzle-orm";
import { getOccasionalClientsForExport } from "@/data-access/occasional-clients";

async function main() {
  const [fr] = await database
    .select({ id: franchisee.id, name: franchisee.name })
    .from(franchisee)
    .where(ilike(franchisee.name, "%קינג קונג ביג%"))
    .limit(1);

  if (!fr) {
    throw new Error("franchisee not found");
  }
  console.log("Franchisee:", fr);

  const rows = await getOccasionalClientsForExport({
    franchiseeId: fr.id,
    periodMonth: 3,
    periodYear: 2026,
  });
  console.log("Occasional rows for export:", JSON.stringify(rows, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
