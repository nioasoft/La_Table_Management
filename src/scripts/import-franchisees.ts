/**
 * Import franchisees and contacts from CSV data
 * Run with: npx tsx src/scripts/import-franchisees.ts
 */

import { database } from "../db";
import { franchisee, contact } from "../db/schema";
import { randomUUID } from "crypto";

// Brand IDs (from database)
const BRAND_IDS = {
  MINNA_TOMEI: "d5e75b1a-04c4-4157-bac5-71df005df5e4",
  KING_KONG: "2610a2d9-fc45-4216-befb-6f16acec38b8",
  FAT_VINNY: "5bc671c3-b043-462e-a814-965ded4294fc",
};

// Franchisee data type
type FranchiseeData = {
  name: string;
  code: string;
  companyId: string | null;
  city: string;
  address: string | null;
  brandId: string;
  contacts: { name: string; phone: string; email: string }[];
};

// All franchisees data parsed from CSV
const franchiseesData: FranchiseeData[] = [
  // ============================================================
  // מינה טומיי
  // ============================================================
  {
    name: 'קסטרא טומאיי בע"מ',
    code: "514177112",
    companyId: "514177112",
    city: "חיפה",
    address: "פלימן 8, קסטרא",
    brandId: BRAND_IDS.MINNA_TOMEI,
    contacts: [
      { name: "מאיר שלמה", phone: "054-2495199", email: "meir@latableg.com" },
      { name: "דינה פישלוביץ", phone: "052-8131119", email: "dinafis100@gmail.com" },
    ],
  },
  {
    name: 'אודון ניהול ואחזקות בע"מ',
    code: "515289262",
    companyId: "515289262",
    city: "קרית ביאליק",
    address: "ת.ד. 2015, קריון",
    brandId: BRAND_IDS.MINNA_TOMEI,
    contacts: [
      { name: "יעקב אטיאס", phone: "052-6708000", email: "yatias29@gmail.com" },
      { name: "אופק ביטון", phone: "054-3295396", email: "ofek95bit@gmail.com" },
      { name: "שלום", phone: "052-3257463", email: "shalomsmok@gmail.com" },
    ],
  },
  {
    name: 'מינה שרונה בע"מ',
    code: "516055480",
    companyId: "516055480",
    city: "תל אביב",
    address: "הארבעה 17",
    brandId: BRAND_IDS.MINNA_TOMEI,
    contacts: [
      { name: "שי זומר", phone: "054-4799999", email: "minnatelaviv@gmail.com" },
      { name: "שגיא טרטנר", phone: "054-4277979", email: "minnatelaviv@gmail.com" },
    ],
  },
  {
    name: 'מינה טומיי עין שמר בע"מ',
    code: "515745933",
    companyId: "515745933",
    city: "עין שמר",
    address: "מתחם אלונית פאשן",
    brandId: BRAND_IDS.MINNA_TOMEI,
    contacts: [
      { name: "שבי שבתאי", phone: "053-6532507", email: "shabi.s84@gmail.com" },
      { name: "שבתאי שבתאי", phone: "052-4808168", email: "shabibiga@gmail.com" },
      { name: "שני", phone: "050-6371448", email: "shanylev85@gmail.com" },
    ],
  },
  {
    name: "מינה טומאיי יהוד",
    code: "MINNA-YEHUD",
    companyId: null,
    city: "יהוד",
    address: "ביג",
    brandId: BRAND_IDS.MINNA_TOMEI,
    contacts: [
      { name: "מתן סלו", phone: "052-5523251", email: "matanselloo@gmail.com" },
      { name: "רון רומנוב", phone: "050-2210953", email: "ronromanov98@gmail.com" },
    ],
  },

  // ============================================================
  // קינג קונג
  // ============================================================
  {
    name: 'קינג קונג ביג בע"מ',
    code: "516229903",
    companyId: "516229903",
    city: "קריית אתא",
    address: "ביג",
    brandId: BRAND_IDS.KING_KONG,
    contacts: [
      { name: "רותם עשור", phone: "054-3344759", email: "rotem.assor5@gmail.com" },
      { name: "אור סלק", phone: "052-6500643", email: "orselek1@gmail.com" },
    ],
  },
  {
    name: "קינג קונג חורב",
    code: "516553534",
    companyId: "516553534",
    city: "חיפה",
    address: null,
    brandId: BRAND_IDS.KING_KONG,
    contacts: [
      { name: "טום צוויג", phone: "052-2707317", email: "tomzwieg1211@gmail.com" },
      { name: "מתן מאירי", phone: "050-9020424", email: "meirimatan3@gmail.com" },
    ],
  },
  {
    name: "קינג קונג כרמיאל",
    code: "516476561",
    companyId: "516476561",
    city: "כרמיאל",
    address: "ביג",
    brandId: BRAND_IDS.KING_KONG,
    contacts: [
      { name: "איציק זבק", phone: "054-4460781", email: "itsikzebak@gmail.com" },
      { name: "איתמר", phone: "052-8902391", email: "itamarbetzer14@gmail.com" },
    ],
  },
  {
    name: "קינג קונג רעננה",
    code: "516549102",
    companyId: "516549102",
    city: "רעננה",
    address: "דרך ירושלים 34, מרכז גמלא",
    brandId: BRAND_IDS.KING_KONG,
    contacts: [
      { name: "ניר חן", phone: "058-4084000", email: "nirchen83@gmail.com" },
      { name: "מאיה ברג", phone: "054-5252165", email: "mayaberg23@gmail.com" },
      { name: "מוראל אלוש", phone: "053-2759658", email: "alushmorel@gmail.com" },
    ],
  },
  {
    name: 'קינג געתון בע"מ',
    code: "516869385",
    companyId: "516869385",
    city: "נהריה",
    address: null,
    brandId: BRAND_IDS.KING_KONG,
    contacts: [
      { name: "דודי בן שושן", phone: "052-6825530", email: "kingkong.nhr@gmail.com" },
      { name: "יקיר אזוגי", phone: "054-7754488", email: "kingkong.nhr@gmail.com" },
      { name: "מורן אביטבול", phone: "052-5525490", email: "moran15483@gail.com" },
    ],
  },
  {
    name: "קינג קונג חדרה",
    code: "517012217",
    companyId: "517012217",
    city: "חדרה",
    address: null,
    brandId: BRAND_IDS.KING_KONG,
    contacts: [
      { name: "אורן הרשלר", phone: "054-9192272", email: "oren.he87@gmail.com" },
      { name: "נוי עדרי", phone: "052-7337779", email: "noyedri20@gmail.com" },
    ],
  },

  // ============================================================
  // פאט ויני
  // ============================================================
  {
    name: 'ויני רגבה בע"מ',
    code: "516148947",
    companyId: "516148947",
    city: "רגבה",
    address: "ביג",
    brandId: BRAND_IDS.FAT_VINNY,
    contacts: [
      { name: "דור רחמילוביץ", phone: "054-4431513", email: "dorrahmilovic@gmail.com" },
      { name: "גיא משולם", phone: "054-3117366", email: "guypnimion@gmail.com" },
    ],
  },
  {
    name: "פט ויני כרמיאל",
    code: "516312766",
    companyId: "516312766",
    city: "כרמיאל",
    address: "ביג",
    brandId: BRAND_IDS.FAT_VINNY,
    contacts: [
      { name: "איציק זבק", phone: "054-4460781", email: "itsikzebak@gmail.com" },
      { name: "גל זבק", phone: "052-8200884", email: "zebakgal@gmail.com" },
    ],
  },
  {
    name: 'סידיוס בע"מ',
    code: "515639052",
    companyId: "515639052",
    city: "נתניה",
    address: 'מפ"י 5, סוהו',
    brandId: BRAND_IDS.FAT_VINNY,
    contacts: [
      { name: "ערן צוקר", phone: "052-4537674", email: "eranzuker88@gmail.com" },
      { name: "עמית בלום", phone: "054-4050228", email: "amitblum08@gmail.com" },
      { name: "גולן גרוסמן", phone: "054-6723456", email: "goli4422@gmail.com" },
    ],
  },
  {
    name: 'דארת\' בע"מ',
    code: "515808954",
    companyId: "515808954",
    city: "חדרה",
    address: "רח' פרופ' שכטמן 10, מתחם ווילג'",
    brandId: BRAND_IDS.FAT_VINNY,
    contacts: [
      { name: "ניר חן", phone: "058-4084000", email: "nirchen83@gmail.com" },
      { name: "יניב רונן", phone: "052-4846797", email: "yanivronen28@gmail.com" },
      { name: "סלע חייט", phone: "052-4320303", email: "selachayat@gmail.com" },
      { name: "יהונתן בן אליעזר", phone: "050-9320272", email: "" },
    ],
  },
  {
    name: 'מיאמוטו בע"מ',
    code: "516087038",
    companyId: "516087038",
    city: "קריית אתא",
    address: "הסולל 8, ביג",
    brandId: BRAND_IDS.FAT_VINNY,
    contacts: [
      { name: "שחר יפרח", phone: "054-6987448", email: "sifrach15@gmail.com" },
      { name: "אביב סמולרציק", phone: "054-6734244", email: "smolarchik@gmail.com" },
      { name: "מתן קצוני", phone: "050-9406439", email: "" },
      { name: "חמודי", phone: "052-2840563", email: "mhemad.nab99@gmail.com" },
    ],
  },
  {
    name: 'טמפר הסעדה בע"מ',
    code: "516345857",
    companyId: "516345857",
    city: "יהוד",
    address: "ביג",
    brandId: BRAND_IDS.FAT_VINNY,
    contacts: [
      { name: "מתן סלו", phone: "052-5523251", email: "matanselloo@gmail.com" },
      { name: "רון רומנוב", phone: "050-2210953", email: "ronromanov98@gmail.com" },
    ],
  },
  {
    name: "פט ויני עפולה",
    code: "FV-AFULA",
    companyId: null,
    city: "עפולה",
    address: null,
    brandId: BRAND_IDS.FAT_VINNY,
    contacts: [
      { name: "סמאן", phone: "054-2665522", email: "simonshamshoum8@gmail.com" },
    ],
  },
  {
    name: "פט ויני עזריאלי חיפה",
    code: "FV-AZRIELI-HAIFA",
    companyId: null,
    city: "חיפה",
    address: "קניון עזריאלי חיפה",
    brandId: BRAND_IDS.FAT_VINNY,
    contacts: [],
  },
];

// Brand-level contacts (not associated with any franchisee)
const brandContacts = [
  {
    brandId: BRAND_IDS.FAT_VINNY,
    name: "דורין ברדוגו",
    phone: "052-5739071",
    email: "BERDUGODORIN@GMAIL.COM",
    role: "staff" as const,
  },
  {
    brandId: BRAND_IDS.FAT_VINNY,
    name: "אסף נתנזון",
    phone: "050-7601045",
    email: "asaf@latableg.com",
    role: "staff" as const,
  },
];

async function main() {
  console.log("🚀 Starting import...\n");

  let franchiseeCount = 0;
  let contactCount = 0;

  // Import franchisees and their contacts
  for (const f of franchiseesData) {
    const franchiseeId = randomUUID();

    // Insert franchisee
    await database.insert(franchisee).values({
      id: franchiseeId,
      brandId: f.brandId,
      name: f.name,
      code: f.code,
      companyId: f.companyId,
      city: f.city,
      address: f.address,
      status: "active",
      isActive: true,
    });

    franchiseeCount++;
    console.log(`✅ Franchisee: ${f.name} (${f.code})`);

    // Insert contacts for this franchisee
    for (const c of f.contacts) {
      await database.insert(contact).values({
        id: randomUUID(),
        franchiseeId: franchiseeId,
        name: c.name,
        phone: c.phone,
        email: c.email || null,
        role: "owner",
        isPrimary: false,
        isActive: true,
      });
      contactCount++;
    }
  }

  // Import brand-level contacts
  console.log("\n📋 Importing brand-level contacts...");
  for (const c of brandContacts) {
    await database.insert(contact).values({
      id: randomUUID(),
      brandId: c.brandId,
      franchiseeId: null,
      name: c.name,
      phone: c.phone,
      email: c.email,
      role: c.role,
      isPrimary: false,
      isActive: true,
    });
    contactCount++;
    console.log(`✅ Brand Contact: ${c.name}`);
  }

  console.log("\n" + "=".repeat(50));
  console.log(`📊 Summary:`);
  console.log(`   Franchisees imported: ${franchiseeCount}`);
  console.log(`   Contacts imported: ${contactCount}`);
  console.log("=".repeat(50));
  console.log("\n✨ Import completed successfully!");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("❌ Error during import:", error);
    process.exit(1);
  });
