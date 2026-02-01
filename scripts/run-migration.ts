import "dotenv/config";
import { sql } from "drizzle-orm";
import { database } from "../src/db";

async function runMigration() {
  console.log("Running manual migration for franchisee category...\n");

  try {
    // 1. Create the franchisee_category enum if it doesn't exist
    console.log("1. Creating franchisee_category enum...");
    await database.execute(sql`
      DO $$ BEGIN
        CREATE TYPE "public"."franchisee_category" AS ENUM('regular', 'other');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$
    `);
    console.log("   Done.");

    // 2. Add category column to franchisee table
    console.log("2. Adding category column to franchisee table...");
    await database.execute(sql`
      ALTER TABLE "franchisee" ADD COLUMN IF NOT EXISTS "category" "franchisee_category" DEFAULT 'regular' NOT NULL
    `);
    console.log("   Done.");

    // 3. Add is_system_brand column to brand table
    console.log("3. Adding is_system_brand column to brand table...");
    await database.execute(sql`
      ALTER TABLE "brand" ADD COLUMN IF NOT EXISTS "is_system_brand" boolean DEFAULT false NOT NULL
    `);
    console.log("   Done.");

    // 4. Create indexes
    console.log("4. Creating indexes...");
    await database.execute(sql`
      CREATE INDEX IF NOT EXISTS "idx_franchisee_category" ON "franchisee" USING btree ("category")
    `);
    await database.execute(sql`
      CREATE INDEX IF NOT EXISTS "idx_franchisee_category_active" ON "franchisee" USING btree ("category", "is_active")
    `);
    await database.execute(sql`
      CREATE INDEX IF NOT EXISTS "idx_brand_is_system_brand" ON "brand" USING btree ("is_system_brand")
    `);
    console.log("   Done.");

    console.log("\n✅ Migration completed successfully!");

  } catch (error) {
    console.error("Migration error:", error);
    process.exit(1);
  }

  process.exit(0);
}

runMigration();
