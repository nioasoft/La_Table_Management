/**
 * One-off CLI: reprocess the Q1 2026 מור בריאות supplier file after fixing
 * mor-briut-parser.ts (DATA_START_ROW 4 → 0).
 *
 * The "קינג קונג" sheet has only 1 customer-block header row before data,
 * not 3 metadata rows like the "מינה" sheet. The previous DATA_START_ROW=4
 * dropped 3 real לימון line-items in קינג קונג קריות, undercounting by ₪630.
 *
 * Usage:
 *   dotenv -e .env -- npx tsx src/scripts/reprocess-mor-briut-q1-2026.ts
 */

import dns from "node:dns";
dns.setDefaultResultOrder("ipv4first");

import { reprocessSupplierFileById } from "@/data-access/supplier-file-reprocess";

const FILE_ID = "0c34b4c8-c545-477a-9df2-5585e92abcac";

async function main() {
  console.log(`Reprocessing supplier file ${FILE_ID}...`);
  const result = await reprocessSupplierFileById(FILE_ID);

  if (!result.success) {
    console.error("Reprocess FAILED:", result.error);
    process.exit(1);
  }

  console.log("OK", {
    fileName: result.fileName,
    supplierId: result.supplierId,
    before: result.before,
    after: result.after,
    deltaNet: result.after.net - result.before.net,
  });
  process.exit(0);
}

main().catch((err) => {
  console.error("Unhandled error:", err);
  process.exit(1);
});
