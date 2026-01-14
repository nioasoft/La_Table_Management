import "dotenv/config";
import { database, pool } from "../db";
import { supplier } from "../db/schema";

async function main() {
  const allSuppliers = await database.select().from(supplier);
  console.log("Total suppliers:", allSuppliers.length);
  console.log("");
  console.log("| Name | Code | Commission | Frequency | Has Mapping |");
  console.log("|------|------|------------|-----------|-------------|");

  for (const s of allSuppliers) {
    const hasMapping = s.fileMapping ? "Yes" : "No";
    console.log(
      `| ${s.name} | ${s.code || "-"} | ${s.defaultCommissionRate || "-"} | ${s.settlementFrequency || "-"} | ${hasMapping} |`
    );
  }

  await pool.end();
}

main().catch(console.error);
