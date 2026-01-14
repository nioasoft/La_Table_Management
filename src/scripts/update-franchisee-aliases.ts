/**
 * Update franchisees with their aliases for supplier file matching
 * Run with: npx tsx src/scripts/update-franchisee-aliases.ts
 *
 * Reference: docs/suppliers-reference.md
 */

import "dotenv/config";
import { database } from "../db";
import { franchisee } from "../db/schema";
import { eq, or, ilike } from "drizzle-orm";

// Alias mappings: key = partial match for franchisee name, value = aliases to add
type AliasMapping = {
  nameMatch: string; // Partial match to find the franchisee
  aliases: string[];
};

const aliasMappings: AliasMapping[] = [
  // ============================================================
  // מינה טומאיי
  // ============================================================
  {
    nameMatch: "קסטרא",
    aliases: [
      "קסטרא טומאיי בע\"מ",
      "קסטרא טומאי בע'מ",
      "קסטרא טומאי בע\"מ",
      "מינה טומאיי קסטרא",
    ],
  },
  {
    nameMatch: "אודון",
    aliases: [
      "אודון ניהול ואחזקות בע\"מ",
      "אודון ניהול ואחזקות בעמ",
      "אודון ניהול ואחזקות בעמ-מינה טומיי",
      "מינה טומיי קריון",
      "מינה טומאיי קריון",
    ],
  },
  {
    nameMatch: "מינה שרונה",
    aliases: [
      "מינה שרונה בע\"מ",
      "מינה טומאיי שרונה",
      "מינה טומיי שרונה",
    ],
  },
  {
    nameMatch: "עין שמר",
    aliases: [
      "מינה טומי עין שמר בע\"מ",
      "מינה טומיי עין שמר בע\"מ",
      "מינה טומאיי עין שמר",
      "מינה טומי עין שמר",
    ],
  },
  {
    nameMatch: "מינה טומאיי יהוד",
    aliases: [
      "אושיבה בע\"מ",
      "אושיבה בעמ",
      "אושיבה בעמ (מינה טומי יהוד)",
      "מינה טומי יהוד",
    ],
  },
  {
    nameMatch: "ביאליק",
    aliases: [
      "מינה טומיי ביאליק",
      "מינה טומאיי ביאליק",
    ],
  },

  // ============================================================
  // קינג קונג
  // ============================================================
  {
    nameMatch: "קינג קונג ביג",
    aliases: [
      "קינג קונג ביג בע\"מ",
      "קינג קונג ביג קריות",
      "קינג קונג ביג בעמ",
    ],
  },
  {
    nameMatch: "קינג קונג חורב",
    aliases: [
      "קינג קונג חורב בע\"מ",
      "קינג קונג חורב חיפה",
      "קינג קונג חורב בעמ",
    ],
  },
  {
    nameMatch: "קינג קונג כרמיאל",
    aliases: [
      "קינג כרמיאל בעמ",
      "קינג כרמיאל בע\"מ",
      "קינג כרמיאל בע\"מ (קינג קונג כרמיאל)",
    ],
  },
  {
    nameMatch: "קינג קונג רעננה",
    aliases: [
      "אטפה בע\"מ",
      "אטפה בעמ",
      "אטפה בע\"מ (קינג קונג רעננה)",
    ],
  },
  {
    nameMatch: "קינג געתון",
    aliases: [
      "קינג געתון בע\"מ",
      "קינג געתון בעמ",
      "קינג קונג נהריה",
    ],
  },
  {
    nameMatch: "קינג קונג חדרה",
    aliases: [
      "קינג קונג חדרה בע\"מ",
      "קינג קונג חדרה בעמ",
    ],
  },

  // ============================================================
  // פאט ויני
  // ============================================================
  {
    nameMatch: "ויני רגבה",
    aliases: [
      "ויני רגבה בע\"מ",
      "פט ויני רגבה",
      "פאט ויני - רגבה",
    ],
  },
  {
    nameMatch: "פט ויני כרמיאל",
    aliases: [
      "ויני כרמיאל בע\"מ",
      "פאט ויני - כרמיאל",
    ],
  },
  {
    nameMatch: "סידיוס",
    aliases: [
      "סידיוס בע\"מ",
      "פט ויני נתניה",
      "פט ויני נתניה-סידיוס בע\"מ",
      "פאט ויני - נתניה",
    ],
  },
  {
    nameMatch: "דארת",
    aliases: [
      "דארת' בע\"מ",
      "פט ויני חדרה",
      "פאט ויני - חדרה",
      "ויני חדרה מול החוף בע\"מ",
      "ויני חדרה",
    ],
  },
  {
    nameMatch: "מיאמוטו",
    aliases: [
      "מיאמוטו בע\"מ",
      "מיאמוטו בע\"מ-פט ויני",
      "פט ויני קריות",
      "פט ויני קריית אתא",
      "פאט ויני - קריות",
    ],
  },
  {
    nameMatch: "טמפר",
    aliases: [
      "טמפר הסעדה בע\"מ",
      "פט ויני יהוד",
      "פט ויני יהוד-טמפר הסעדה בע\"מ",
      "פאט ויני - יהוד",
    ],
  },
  {
    nameMatch: "פט ויני עפולה",
    aliases: [
      "פאט ויני - עפולה",
    ],
  },
  {
    nameMatch: "פט ויני עזריאלי",
    aliases: [
      "פט ויני עזריאלי בע\"מ-חיפה",
      "פט ויני קניון חיפה",
      "פאט ויני - חיפה",
      "פט ויני חיפה",
    ],
  },
];

async function main() {
  console.log("Starting franchisee aliases update...\n");

  let updatedCount = 0;
  let notFoundCount = 0;

  for (const mapping of aliasMappings) {
    // Find franchisee by partial name match
    const results = await database
      .select()
      .from(franchisee)
      .where(ilike(franchisee.name, `%${mapping.nameMatch}%`));

    if (results.length === 0) {
      console.log(`❌ Not found: "${mapping.nameMatch}"`);
      notFoundCount++;
      continue;
    }

    if (results.length > 1) {
      console.log(`⚠️  Multiple matches for "${mapping.nameMatch}":`);
      results.forEach((f) => console.log(`   - ${f.name}`));
      // Use the first match
    }

    const targetFranchisee = results[0];

    // Merge existing aliases with new ones
    const existingAliases = (targetFranchisee.aliases as string[]) || [];
    const mergedAliases = [...new Set([...existingAliases, ...mapping.aliases])];

    // Update franchisee
    await database
      .update(franchisee)
      .set({ aliases: mergedAliases })
      .where(eq(franchisee.id, targetFranchisee.id));

    console.log(`✅ Updated: ${targetFranchisee.name}`);
    console.log(`   Aliases: ${mergedAliases.length} total`);
    updatedCount++;
  }

  console.log("\n" + "=".repeat(50));
  console.log(`Summary:`);
  console.log(`   Updated: ${updatedCount}`);
  console.log(`   Not found: ${notFoundCount}`);
  console.log("=".repeat(50));
  console.log("\nAliases update completed!");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Error during update:", error);
    process.exit(1);
  });
