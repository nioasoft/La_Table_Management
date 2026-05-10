/**
 * One-off CLI: re-route 3 client_documents that the older content-blind
 * parent-brand-map kidnapped to נתנזון עזריאלי חיפה when they actually
 * belong to פט ויני עזריאלי חיפה.
 *
 * Documents (verified by hand against parsed franchiseeName + rawText):
 *   1. HAAT income invoice 10074 (₪3,148.00) — `20b2201c-...`
 *      Parsed name "פאט ויני עזריאלי בע\"מ", content has NO Natanzon mention.
 *   2. HAAT commission invoice (₪3,892.00) — `c7ae5193-...`
 *      Parsed name "פט ויני עזריאלי בע\"מ", content has NO Natanzon mention.
 *   3. MISHLOCHA invoice 10075 (₪6,880.03) — `9beb6a7c-...`
 *      Mixed invoice: 81% VINNI ויני חיפה, 19% נתנזון בורגר חיפה. Parser
 *      mis-extracted recipient legal name ("דיב אנד רד פרוגקטס") as the
 *      franchisee. Per Reut 2026-05-10 the dominant brand wins — move the
 *      whole row to Pat Vini. (Splitting per line-item is a follow-up.)
 *
 * The new content-aware findOperatingBrand (2026-05-10) prevents this
 * kidnapping for future docs; this script only fixes the historical 3.
 *
 * Usage:
 *   dotenv -e .env -- npx tsx src/scripts/reroute-vini-from-natanzon.ts [--apply]
 */

import dns from "node:dns";
dns.setDefaultResultOrder("ipv4first");

import { database } from "@/db";
import { clientDocument } from "@/db/schema";
import { eq } from "drizzle-orm";

const PAT_VINI_AZRIELI_HAIFA_ID = "0e2a027a-18bb-4274-af4e-be451799a29b";
const NATANZON_AZRIELI_HAIFA_ID = "ab020323-fefe-4543-9a69-16d14dd54b99";

const TARGETS: Array<{
  id: string;
  description: string;
  newReviewNote: string;
}> = [
  {
    id: "20b2201c-0cdd-4aec-b5a6-5e102d6fdadb",
    description: "HAAT income invoice 10074 (₪3,148.00)",
    newReviewNote:
      'נותב מחדש 2026-05-10: HAAT income invoice של פאט ויני עזריאלי בע"מ ' +
      "שנותב בטעות לנתנזון על ידי כלל parent-brand-map ישן (לפני content gate). " +
      "המסמך לא מאזכר נתנזון, שייך לפט ויני עזריאלי חיפה.",
  },
  {
    id: "c7ae5193-1c68-4bb5-a695-8ac9b6b426bf",
    description: "HAAT commission invoice (₪3,892.00)",
    newReviewNote:
      'נותב מחדש 2026-05-10: HAAT commission invoice של פט ויני עזריאלי בע"מ ' +
      "שנותב בטעות לנתנזון על ידי כלל parent-brand-map ישן (לפני content gate). " +
      "המסמך לא מאזכר נתנזון, שייך לפט ויני עזריאלי חיפה.",
  },
  {
    id: "9beb6a7c-b0d9-4042-9abc-a14ded772196",
    description:
      "MISHLOCHA invoice 10075 mixed (Vini 81% / Natanzon 19%, ₪6,880.03)",
    newReviewNote:
      "נותב מחדש 2026-05-10: MISHLOCHA invoice 10075 הוא חשבונית מעורבת — 81% " +
      "VINNI ויני חיפה (₪4,723) + 19% נתנזון בורגר חיפה (₪1,107). הוקצה במלואו " +
      "לפט ויני עזריאלי חיפה לפי הברנד הדומיננטי. פיצול per-line-item הוא תיקון " +
      "עתידי. הפרסר חילץ בטעות 'דיב אנד רד פרוגקטס' (השם המשפטי של משלוחה כלקוח) " +
      "כזכיין במקום להוציא את המוציא 'פאט ויני עזריאלי'.",
  },
];

async function main() {
  const apply = process.argv.includes("--apply");

  for (const target of TARGETS) {
    console.log(`── ${target.id} ──`);
    console.log(`  ${target.description}`);

    const [existing] = await database
      .select({
        id: clientDocument.id,
        franchiseeId: clientDocument.franchiseeId,
        existingNotes: clientDocument.reviewNotes,
      })
      .from(clientDocument)
      .where(eq(clientDocument.id, target.id))
      .limit(1);

    if (!existing) {
      console.log(`  ↳ row not found — skipping`);
      continue;
    }
    if (existing.franchiseeId !== NATANZON_AZRIELI_HAIFA_ID) {
      console.log(
        `  ↳ row currently assigned to ${existing.franchiseeId} (not Natanzon) — skipping (already moved or unexpected state)`
      );
      continue;
    }

    if (!apply) {
      console.log(`  ↳ would move: Natanzon → Pat Vini Azrieli Haifa`);
      continue;
    }

    const merged = existing.existingNotes
      ? `${existing.existingNotes}\n\n${target.newReviewNote}`
      : target.newReviewNote;

    await database
      .update(clientDocument)
      .set({
        franchiseeId: PAT_VINI_AZRIELI_HAIFA_ID,
        reviewNotes: merged,
        updatedAt: new Date(),
      })
      .where(eq(clientDocument.id, target.id));
    console.log(`  ↳ MOVED → Pat Vini Azrieli Haifa`);
  }

  if (!apply) {
    console.log("\nDry-run. Pass --apply to write.");
  } else {
    console.log("\nDone.");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
