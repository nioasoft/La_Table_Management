/**
 * Seed script for "Other Income" feature - using raw SQL
 */

import "dotenv/config";
import { sql } from "drizzle-orm";
import { database } from "../src/db";

const OTHER_BRAND_CODE = "OTHER";
const DON_PEDRO_CODE = "DON_PEDRO";

async function seedOtherIncome() {
  console.log("Starting seed for Other Income feature...\n");

  // 1. Create or get the "שונות" system brand
  console.log("1. Checking for system brand 'שונות'...");

  const existingBrand = await database.execute(sql`
    SELECT id, is_system_brand FROM brand WHERE code = ${OTHER_BRAND_CODE} LIMIT 1
  `);

  let otherBrandId: string;

  if (existingBrand.rows.length > 0) {
    console.log("   ✓ System brand already exists");
    otherBrandId = existingBrand.rows[0].id as string;

    // Make sure it's marked as system brand
    if (!existingBrand.rows[0].is_system_brand) {
      await database.execute(sql`
        UPDATE brand SET is_system_brand = true WHERE id = ${otherBrandId}
      `);
      console.log("   ✓ Updated to system brand");
    }
  } else {
    const brandId = crypto.randomUUID();
    const now = new Date().toISOString();
    await database.execute(sql`
      INSERT INTO brand (id, code, name, name_he, name_en, description, is_active, is_system_brand, created_at, updated_at)
      VALUES (
        ${brandId},
        ${OTHER_BRAND_CODE},
        ${"שונות"},
        ${"שונות"},
        ${"Other"},
        ${"מקורות הכנסה שאינם זכיינים (כגון דון פדרו)"},
        true,
        true,
        ${now}::timestamp,
        ${now}::timestamp
      )
    `);

    otherBrandId = brandId;
    console.log("   ✓ Created system brand 'שונות'");
  }

  // 2. Create "דון פדרו" as the first other income source
  console.log("\n2. Checking for 'דון פדרו' income source...");

  const existingDonPedro = await database.execute(sql`
    SELECT id, category FROM franchisee WHERE code = ${DON_PEDRO_CODE} LIMIT 1
  `);

  if (existingDonPedro.rows.length > 0) {
    console.log("   ✓ 'דון פדרו' already exists");

    // Make sure it has the correct category
    if (existingDonPedro.rows[0].category !== "other") {
      await database.execute(sql`
        UPDATE franchisee SET category = 'other' WHERE id = ${existingDonPedro.rows[0].id}
      `);
      console.log("   ✓ Updated category to 'other'");
    }
  } else {
    // Create Don Pedro with aliases for matching
    const donPedroAliases = [
      "דון פדרו",
      "דון-פדרו",
      "דונפדרו",
      "don pedro",
      "donpedro",
      "Don Pedro",
    ];

    const franchiseeId = crypto.randomUUID();
    const now = new Date().toISOString();
    await database.execute(sql`
      INSERT INTO franchisee (id, brand_id, name, code, category, aliases, status, is_active, notes, created_at, updated_at)
      VALUES (
        ${franchiseeId},
        ${otherBrandId},
        ${"דון פדרו"},
        ${DON_PEDRO_CODE},
        'other',
        ${JSON.stringify(donPedroAliases)}::jsonb,
        'active',
        true,
        ${"מקור הכנסה שאינו זכיין - מופיע בקבצי ספקים כמו מחלבות גד ורסטרטו"},
        ${now}::timestamp,
        ${now}::timestamp
      )
    `);

    console.log("   ✓ Created 'דון פדרו' income source");
    console.log(`     Aliases: ${donPedroAliases.join(", ")}`);
  }

  console.log("\n✅ Seed completed successfully!");
  console.log("\nSummary:");
  console.log("  - System brand 'שונות' is ready");
  console.log("  - 'דון פדרו' is configured as an other income source");
  console.log("\nYou can now access the Other Income management page at:");
  console.log("  /admin/other-income");
}

// Run the seed
seedOtherIncome()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error("Seed failed:", error);
    process.exit(1);
  });
