/**
 * Add missing franchisees that were not in the original import
 * Run with: npx tsx src/scripts/add-missing-franchisees.ts
 */

import "dotenv/config";
import { database } from "../db";
import { franchisee, contact } from "../db/schema";
import { randomUUID } from "crypto";

// Brand IDs (from database)
const BRAND_IDS = {
  MINNA_TOMEI: "d5e75b1a-04c4-4157-bac5-71df005df5e4",
  FAT_VINNY: "5bc671c3-b043-462e-a814-965ded4294fc",
};

// Missing franchisees
const missingFranchisees = [
  {
    name: "מינה טומיי ביאליק",
    code: "MINNA-BIALIK",
    companyId: null,
    city: "קריית ביאליק",
    address: null,
    brandId: BRAND_IDS.MINNA_TOMEI,
    aliases: ["מינה טומאיי ביאליק", "מינה טומיי ביאליק"],
    contacts: [],
  },
  {
    name: "פט ויני עזריאלי חיפה",
    code: "FV-AZRIELI-HAIFA",
    companyId: null,
    city: "חיפה",
    address: "קניון עזריאלי חיפה",
    brandId: BRAND_IDS.FAT_VINNY,
    aliases: [
      "פט ויני עזריאלי בע\"מ-חיפה",
      "פט ויני קניון חיפה",
      "פאט ויני - חיפה",
      "פט ויני חיפה",
    ],
    contacts: [],
  },
];

async function main() {
  console.log("Adding missing franchisees...\n");

  let count = 0;

  for (const f of missingFranchisees) {
    const franchiseeId = randomUUID();

    await database.insert(franchisee).values({
      id: franchiseeId,
      brandId: f.brandId,
      name: f.name,
      code: f.code,
      companyId: f.companyId,
      city: f.city,
      address: f.address,
      aliases: f.aliases,
      status: "active",
      isActive: true,
    });

    count++;
    console.log(`Added: ${f.name} with ${f.aliases.length} aliases`);
  }

  console.log("\n" + "=".repeat(50));
  console.log(`Summary: ${count} franchisees added`);
  console.log("=".repeat(50));
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Error:", error);
    process.exit(1);
  });
