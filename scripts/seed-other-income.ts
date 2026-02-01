/**
 * Seed script for "Other Income" feature
 *
 * Creates:
 * 1. System brand "שונות" (OTHER) for categorizing non-franchisee income sources
 * 2. "דון פדרו" as the first other income source with relevant aliases
 *
 * Usage:
 *   npx dotenv -e .env -- tsx scripts/seed-other-income.ts
 */

import "dotenv/config";
import { database } from "../src/db";
import { brand, franchisee } from "../src/db/schema";
import { eq } from "drizzle-orm";

const OTHER_BRAND_CODE = "OTHER";
const DON_PEDRO_CODE = "DON_PEDRO";

async function seedOtherIncome() {
  console.log("Starting seed for Other Income feature...\n");

  // 1. Create or get the "שונות" system brand
  console.log("1. Checking for system brand 'שונות'...");

  const existingBrand = await database
    .select()
    .from(brand)
    .where(eq(brand.code, OTHER_BRAND_CODE))
    .limit(1);

  let otherBrandId: string;

  if (existingBrand.length > 0) {
    console.log("   ✓ System brand already exists");
    otherBrandId = existingBrand[0].id;

    // Make sure it's marked as system brand
    if (!existingBrand[0].isSystemBrand) {
      await database
        .update(brand)
        .set({ isSystemBrand: true })
        .where(eq(brand.id, otherBrandId));
      console.log("   ✓ Updated to system brand");
    }
  } else {
    const newBrand = await database
      .insert(brand)
      .values({
        id: crypto.randomUUID(),
        code: OTHER_BRAND_CODE,
        nameHe: "שונות",
        nameEn: "Other",
        description: "מקורות הכנסה שאינם זכיינים (כגון דון פדרו)",
        isActive: true,
        isSystemBrand: true,
      })
      .returning();

    otherBrandId = newBrand[0].id;
    console.log("   ✓ Created system brand 'שונות'");
  }

  // 2. Create "דון פדרו" as the first other income source
  console.log("\n2. Checking for 'דון פדרו' income source...");

  const existingDonPedro = await database
    .select()
    .from(franchisee)
    .where(eq(franchisee.code, DON_PEDRO_CODE))
    .limit(1);

  if (existingDonPedro.length > 0) {
    console.log("   ✓ 'דון פדרו' already exists");

    // Make sure it has the correct category
    if (existingDonPedro[0].category !== "other") {
      await database
        .update(franchisee)
        .set({ category: "other" })
        .where(eq(franchisee.id, existingDonPedro[0].id));
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

    await database.insert(franchisee).values({
      id: crypto.randomUUID(),
      brandId: otherBrandId,
      name: "דון פדרו",
      code: DON_PEDRO_CODE,
      category: "other",
      aliases: donPedroAliases,
      status: "active",
      isActive: true,
      notes: "מקור הכנסה שאינו זכיין - מופיע בקבצי ספקים כמו מחלבות גד ורסטרטו",
    });

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
