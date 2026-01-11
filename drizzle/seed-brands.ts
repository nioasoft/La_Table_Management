import { database, pool } from "../src/db";
import { sql } from "drizzle-orm";
import { randomUUID } from "crypto";

const brands = [
  {
    id: randomUUID(),
    name: "מינה טומיי", // Legacy field - keeping for backward compatibility
    code: "MINNA_TOMEI",
    nameHe: "מינה טומיי",
    nameEn: "Minna Tomei",
    description: "",
    logoUrl: "/logos/minna tomei.jpeg",
    website: "",
    isActive: true,
  },
  {
    id: randomUUID(),
    name: "ויני", // Legacy field
    code: "VINNI",
    nameHe: "ויני",
    nameEn: "Vinni",
    description: "",
    logoUrl: "/logos/vinni.jpeg",
    website: "",
    isActive: true,
  },
  {
    id: randomUUID(),
    name: "נתנזון", // Legacy field
    code: "NATANZON",
    nameHe: "נתנזון",
    nameEn: "Natanzon",
    description: "",
    logoUrl: "/logos/natanzon.jpeg",
    website: "",
    isActive: true,
  },
  {
    id: randomUUID(),
    name: "קינג קונג", // Legacy field
    code: "KING_KONG",
    nameHe: "קינג קונג",
    nameEn: "King Kong",
    description: "",
    logoUrl: "/logos/king kong.jpeg",
    website: "",
    isActive: true,
  },
];

async function seedBrands() {
  console.log("Seeding brands...");

  for (const brandData of brands) {
    try {
      // Using raw SQL because the schema doesn't have the legacy 'name' column but the DB still requires it
      await database.execute(sql`
        INSERT INTO brand (id, name, code, name_he, name_en, description, logo_url, website, is_active, created_at, updated_at)
        VALUES (
          ${brandData.id},
          ${brandData.name},
          ${brandData.code},
          ${brandData.nameHe},
          ${brandData.nameEn},
          ${brandData.description},
          ${brandData.logoUrl},
          ${brandData.website},
          ${brandData.isActive},
          NOW(),
          NOW()
        )
        ON CONFLICT (code) DO NOTHING
      `);
      console.log(`Added brand: ${brandData.nameHe} (${brandData.code})`);
    } catch (error) {
      console.error(`Error adding brand ${brandData.nameHe}:`, error);
    }
  }

  console.log("Brands seeding complete!");
  await pool.end();
}

seedBrands().catch(console.error);
