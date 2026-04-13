/**
 * Reproduce the export failure for the failing franchisee.
 */
import { database } from "@/db";
import { franchisee } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getOccasionalClientsForExport } from "@/data-access/occasional-clients";
import { getApprovedForExport } from "@/data-access/client-reconciliation-approval";

async function main() {
  const franchiseeId = "326aaeda-bed8-4d89-b1bf-d1467b440b61";
  const [fr] = await database
    .select({ id: franchisee.id, name: franchisee.name })
    .from(franchisee)
    .where(eq(franchisee.id, franchiseeId))
    .limit(1);
  console.log("Franchisee:", fr);

  const approved = await getApprovedForExport({
    franchiseeId,
    periodMonth: 3,
    periodYear: 2026,
  });
  console.log("Approved rows:", approved.length);

  const occRows = await getOccasionalClientsForExport({
    franchiseeId,
    periodMonth: 3,
    periodYear: 2026,
  });
  console.log("Occasional rows:", JSON.stringify(occRows, null, 2));
}

main().catch((e) => {
  console.error("ERR:", e);
  process.exit(1);
});
