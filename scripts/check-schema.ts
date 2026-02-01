import "dotenv/config";
import { sql } from "drizzle-orm";
import { database } from "../src/db";

async function checkSchema() {
  console.log("Checking database schema...\n");

  try {
    // Check brand table columns
    const brandColumns = await database.execute(sql`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_name = 'brand'
      ORDER BY ordinal_position
    `);
    console.log("Brand table columns:");
    console.log(brandColumns.rows);

    // Check franchisee table for category column
    const franchiseeColumns = await database.execute(sql`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_name = 'franchisee' AND column_name = 'category'
    `);
    console.log("\nFranchisee category column:");
    console.log(franchiseeColumns.rows);

    // Check if migration was applied
    const migrations = await database.execute(sql`
      SELECT * FROM "__drizzle_migrations" ORDER BY created_at DESC LIMIT 5
    `);
    console.log("\nRecent migrations:");
    console.log(migrations.rows);

  } catch (error) {
    console.error("Error:", error);
  }

  process.exit(0);
}

checkSchema();
