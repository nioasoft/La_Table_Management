/**
 * Migrate legacy contact data from franchisee table to contact table.
 *
 * For each franchisee:
 * 1. If primaryContactName exists → create contact with role='manager', isPrimary=true
 * 2. If owners JSONB has entries → create contact per owner with role='owner' + ownershipPercentage
 *
 * Run: npx tsx src/scripts/migrate-legacy-contacts.ts
 */

import "dotenv/config";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "../db/schema";
import { eq, sql } from "drizzle-orm";
import { randomUUID } from "crypto";

async function main() {
  const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL!,
    max: 5,
  });

  const db = drizzle(pool, { schema });

  console.log("Starting legacy contacts migration...\n");

  // Get all franchisees with legacy data
  const franchisees = await db
    .select({
      id: schema.franchisee.id,
      name: schema.franchisee.name,
      primaryContactName: schema.franchisee.primaryContactName,
      primaryContactEmail: schema.franchisee.primaryContactEmail,
      primaryContactPhone: schema.franchisee.primaryContactPhone,
      owners: schema.franchisee.owners,
    })
    .from(schema.franchisee);

  let ownersCreated = 0;
  let primaryCreated = 0;
  let skipped = 0;

  for (const f of franchisees) {
    // Check if contacts already exist for this franchisee
    const existingContacts = await db
      .select({ id: schema.contact.id, role: schema.contact.role })
      .from(schema.contact)
      .where(eq(schema.contact.franchiseeId, f.id));

    const hasOwnerContacts = existingContacts.some((c) => c.role === "owner");
    const hasPrimaryContact = existingContacts.some((c) => c.isPrimary);

    // 1. Migrate primaryContactName if exists and no primary contact in contact table
    if (f.primaryContactName && !hasPrimaryContact) {
      await db.insert(schema.contact).values({
        id: randomUUID(),
        franchiseeId: f.id,
        name: f.primaryContactName,
        phone: f.primaryContactPhone || null,
        email: f.primaryContactEmail || null,
        role: "manager",
        isPrimary: true,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      primaryCreated++;
      console.log(`  [Primary] ${f.name} → ${f.primaryContactName}`);
    }

    // 2. Migrate owners JSONB
    const owners = f.owners as schema.FranchiseeOwner[] | null;
    if (owners && owners.length > 0 && !hasOwnerContacts) {
      for (const owner of owners) {
        if (!owner.name) continue; // skip empty names
        await db.insert(schema.contact).values({
          id: randomUUID(),
          franchiseeId: f.id,
          name: owner.name,
          phone: owner.phone || null,
          email: owner.email || null,
          role: "owner",
          isPrimary: false,
          ownershipPercentage: owner.ownershipPercentage?.toString() || null,
          isActive: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
        ownersCreated++;
      }
      console.log(`  [Owners] ${f.name} → ${owners.length} owners migrated`);
    }

    if (
      !f.primaryContactName &&
      (!owners || owners.length === 0)
    ) {
      skipped++;
    }
  }

  console.log(`\nMigration complete:`);
  console.log(`  Primary contacts created: ${primaryCreated}`);
  console.log(`  Owner contacts created: ${ownersCreated}`);
  console.log(`  Franchisees skipped (no data): ${skipped}`);

  await pool.end();
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
