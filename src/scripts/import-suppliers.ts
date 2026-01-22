/**
 * Import suppliers with commission rates and file mappings
 * Run with: npx tsx src/scripts/import-suppliers.ts
 *
 * Source data: raw_data/ספקים טבלה עמלות רשת.xlsx
 * Reference: docs/suppliers-reference.md
 */

import "dotenv/config";
import { database } from "../db";
import { supplier } from "../db/schema";
import type {
  SupplierFileMapping,
  CommissionException,
  CommissionType,
  SettlementFrequency,
} from "../db/schema";
import { randomUUID } from "crypto";

// Supplier data type
type SupplierData = {
  name: string;
  code: string;
  commissionRate: number;
  commissionType: CommissionType;
  settlementFrequency: SettlementFrequency;
  vatIncluded: boolean;
  fileMapping?: SupplierFileMapping;
  commissionExceptions?: CommissionException[];
  notes?: string;
};

// All suppliers data
const suppliersData: SupplierData[] = [
  // ============================================================
  // ספקים חודשיים
  // ============================================================
  {
    name: "מיטלנד",
    code: "MITLAND",
    commissionRate: 13,
    commissionType: "percentage",
    settlementFrequency: "monthly",
    vatIncluded: false,
  },
  {
    name: "אברהמי",
    code: "AVRAHAMI",
    commissionRate: 10,
    commissionType: "percentage",
    settlementFrequency: "monthly",
    vatIncluded: false,
    notes: "12% ללאפה וחלת בריוש",
    commissionExceptions: [
      { identifier: "לאפה", rate: 12, matchType: "keyword", notes: "לאפה" },
      { identifier: "חלת בריוש", rate: 12, matchType: "keyword", notes: "חלת בריוש" },
    ],
  },

  // ============================================================
  // ספקים רבעוניים עם קבצי דוגמה
  // ============================================================
  {
    name: "פאנדנגו",
    code: "FANDANGO",
    commissionRate: 12,
    commissionType: "percentage",
    settlementFrequency: "quarterly",
    vatIncluded: false,
    fileMapping: {
      fileType: "xlsx",
      columnMappings: { franchiseeColumn: "B", amountColumn: "G", dateColumn: "" },
      headerRow: 1,
      dataStartRow: 2,
      skipKeywords: ["סה\"כ"],
    },
  },
  {
    name: "היכל הייו",
    code: "HEICHAL_HAYIU",
    commissionRate: 15,
    commissionType: "percentage",
    settlementFrequency: "quarterly",
    vatIncluded: false,
    fileMapping: {
      fileType: "xlsx",
      columnMappings: { franchiseeColumn: "A", amountColumn: "B", dateColumn: "" },
      headerRow: 1,
      dataStartRow: 2,
      skipKeywords: [],
    },
  },
  {
    name: "מדג",
    code: "MADAG",
    commissionRate: 15,
    commissionType: "percentage",
    settlementFrequency: "quarterly",
    vatIncluded: false,
    notes: "שם לקוח מוטבע בטקסט - צריך regex parsing",
  },
  {
    name: "מקאטי",
    code: "MAKATI",
    commissionRate: 17,
    commissionType: "percentage",
    settlementFrequency: "quarterly",
    vatIncluded: false,
    fileMapping: {
      fileType: "xlsx",
      columnMappings: { franchiseeColumn: "B", amountColumn: "E", dateColumn: "" },
      headerRow: 4,
      dataStartRow: 5,
      skipKeywords: [],
    },
  },
  {
    name: "יעקב סוכנויות",
    code: "YAAKOV_AGENCIES",
    commissionRate: 10,
    commissionType: "percentage",
    settlementFrequency: "quarterly",
    vatIncluded: false,
    notes: "מבנה היררכי - צריך forward fill",
    fileMapping: {
      fileType: "xlsx",
      columnMappings: { franchiseeColumn: "A", amountColumn: "E", dateColumn: "B" },
      headerRow: 6,
      dataStartRow: 7,
      skipKeywords: [],
    },
  },
  {
    name: "אראל אריזות",
    code: "AREL_PACKAGING",
    commissionRate: 15,
    commissionType: "percentage",
    settlementFrequency: "quarterly",
    vatIncluded: false,
    notes: "Pivot table מורכב - צריך בדיקה ידנית",
  },
  {
    name: "אספיריט",
    code: "ASPIRIT",
    commissionRate: 14,
    commissionType: "percentage",
    settlementFrequency: "quarterly",
    vatIncluded: false,
    fileMapping: {
      fileType: "xlsx",
      columnMappings: { franchiseeColumn: "B", amountColumn: "D", dateColumn: "" },
      headerRow: 1,
      dataStartRow: 2,
      skipKeywords: [],
    },
  },
  {
    name: "פרסקו",
    code: "FRESCO",
    commissionRate: 10,
    commissionType: "percentage",
    settlementFrequency: "quarterly",
    vatIncluded: false,
    fileMapping: {
      fileType: "xlsx",
      columnMappings: { franchiseeColumn: "B", amountColumn: "E", dateColumn: "C" },
      headerRow: 1,
      dataStartRow: 2,
      skipKeywords: ["סה\"כ"],
    },
  },
  {
    name: "קיל ביל",
    code: "KILL_BILL",
    commissionRate: 10,
    commissionType: "percentage",
    settlementFrequency: "quarterly",
    vatIncluded: false,
    fileMapping: {
      fileType: "xlsx",
      columnMappings: { franchiseeColumn: "G", amountColumn: "A", dateColumn: "" },
      headerRow: 2,
      dataStartRow: 3,
      skipKeywords: [],
    },
  },
  {
    name: "ג'ומון",
    code: "JUMON",
    commissionRate: 17,
    commissionType: "percentage",
    settlementFrequency: "quarterly",
    vatIncluded: false,
    notes: "אחוזים שונים לפי סוג מוצר: 17%/10%/20%",
    fileMapping: {
      fileType: "xlsx",
      columnMappings: { franchiseeColumn: "B", amountColumn: "F", dateColumn: "" },
      headerRow: 1,
      dataStartRow: 2,
      skipKeywords: [],
    },
  },
  {
    name: "מעדני הטבע",
    code: "MAADANEI_HATEVA",
    commissionRate: 10,
    commissionType: "percentage",
    settlementFrequency: "quarterly",
    vatIncluded: false,
    fileMapping: {
      fileType: "xlsx",
      columnMappings: { franchiseeColumn: "B", amountColumn: "G", dateColumn: "" },
      headerRow: 1,
      dataStartRow: 2,
      skipKeywords: [],
    },
  },
  {
    name: "רסטרטו",
    code: "RISTRETTO",
    commissionRate: 17,
    commissionType: "percentage",
    settlementFrequency: "quarterly",
    vatIncluded: false,
    notes: "כולל קניות פסטה",
    fileMapping: {
      fileType: "xlsx",
      columnMappings: { franchiseeColumn: "B", amountColumn: "F", dateColumn: "" },
      headerRow: 3,
      dataStartRow: 4,
      skipKeywords: [],
    },
  },
  {
    name: "תויות הצפון",
    code: "TUVIOT_HATZAFON",
    commissionRate: 15,
    commissionType: "percentage",
    settlementFrequency: "quarterly",
    vatIncluded: false,
    notes: "מרובה חודשים - צריך custom parser",
  },
  {
    name: "ארגל",
    code: "ARGEL",
    commissionRate: 10,
    commissionType: "percentage",
    settlementFrequency: "quarterly",
    vatIncluded: false,
    fileMapping: {
      fileType: "xlsx",
      columnMappings: { franchiseeColumn: "B", amountColumn: "H", dateColumn: "" },
      headerRow: 1,
      dataStartRow: 2,
      skipKeywords: [],
    },
  },
  {
    name: "דיפלומט",
    code: "DIPLOMAT",
    commissionRate: 17,
    commissionType: "percentage",
    settlementFrequency: "quarterly",
    vatIncluded: false,
    fileMapping: {
      fileType: "xlsx",
      columnMappings: { franchiseeColumn: "A", amountColumn: "F", dateColumn: "" },
      headerRow: 1,
      dataStartRow: 2,
      skipKeywords: [],
    },
  },
  {
    name: "עלה עלה",
    code: "ALE_ALE",
    commissionRate: 10,
    commissionType: "percentage",
    settlementFrequency: "quarterly",
    vatIncluded: false,
    notes: "קידוד Windows-1252",
    fileMapping: {
      fileType: "csv",
      columnMappings: { franchiseeColumn: "1", amountColumn: "7", dateColumn: "0" },
      headerRow: 1,
      dataStartRow: 2,
      skipKeywords: [],
    },
  },
  {
    name: "יוניקו",
    code: "UNICO",
    commissionRate: 15,
    commissionType: "percentage",
    settlementFrequency: "quarterly",
    vatIncluded: false,
    notes: "3 קטגוריות מקבילות - צריך unpivot",
  },
  {
    name: "מזרח ומערב",
    code: "MIZRACH_UMAARAV",
    commissionRate: 17,
    commissionType: "percentage",
    settlementFrequency: "quarterly",
    vatIncluded: false,
    notes: "תוקף עד 31/12/2025",
    fileMapping: {
      fileType: "xlsx",
      columnMappings: { franchiseeColumn: "B", amountColumn: "F", dateColumn: "" },
      headerRow: 3,
      dataStartRow: 4,
      skipKeywords: [],
    },
  },
  {
    name: "מור בריאות",
    code: "MOR_BRIUT",
    commissionRate: 12,
    commissionType: "percentage",
    settlementFrequency: "quarterly",
    vatIncluded: false,
    notes: "2 גיליונות (מינה, קינג קונג) - צריך aggregation",
  },
  {
    name: "פסטה לה קאזה",
    code: "PASTA_LA_CASA",
    commissionRate: 15,
    commissionType: "percentage",
    settlementFrequency: "quarterly",
    vatIncluded: false,
    notes: "קבצים נפרדים לכל זכיין - שם זכיין בשם הקובץ",
    fileMapping: {
      fileType: "xls",
      columnMappings: { franchiseeColumn: "C", amountColumn: "F", dateColumn: "E" },
      headerRow: 1,
      dataStartRow: 2,
      skipKeywords: ["סה\"כ"],
    },
  },

  // ============================================================
  // ספקים רבעוניים ללא קבצי דוגמה
  // ============================================================
  {
    name: "נספרסו",
    code: "NESPRESSO",
    commissionRate: 0.21,
    commissionType: "per_item",
    settlementFrequency: "quarterly",
    vatIncluded: false,
    notes: "0.21 ש\"ח לקפסולה",
  },
  {
    name: "סובר לרנר",
    code: "SOBER_LERNER",
    commissionRate: 15,
    commissionType: "percentage",
    settlementFrequency: "quarterly",
    vatIncluded: false,
    notes: "או לפי פריט",
  },
  {
    name: "אורן שיווק מיצים",
    code: "OREN_JUICES",
    commissionRate: 5,
    commissionType: "percentage",
    settlementFrequency: "quarterly",
    vatIncluded: false,
  },
  {
    name: "ביגי",
    code: "BIGI",
    commissionRate: 12,
    commissionType: "percentage",
    settlementFrequency: "quarterly",
    vatIncluded: false,
  },
  {
    name: "שף הים",
    code: "CHEF_HAYAM",
    commissionRate: 15,
    commissionType: "percentage",
    settlementFrequency: "quarterly",
    vatIncluded: false,
  },
  {
    name: "מור מזון",
    code: "MOR_MAZON",
    commissionRate: 15,
    commissionType: "percentage",
    settlementFrequency: "quarterly",
    vatIncluded: false,
  },
  {
    name: "ניסים גורן",
    code: "NISSIM_GOREN",
    commissionRate: 10,
    commissionType: "percentage",
    settlementFrequency: "quarterly",
    vatIncluded: false,
  },
  {
    name: "סנו",
    code: "SANO",
    commissionRate: 6,
    commissionType: "percentage",
    settlementFrequency: "quarterly",
    vatIncluded: false,
  },
  {
    name: "שטראוס קפה",
    code: "STRAUSS_COFFEE",
    commissionRate: 10,
    commissionType: "percentage",
    settlementFrequency: "quarterly",
    vatIncluded: false,
  },

  // ============================================================
  // ספקים חצי-שנתיים
  // ============================================================
  {
    name: "מחלבות גד",
    code: "MACHALVOT_GAD",
    commissionRate: 9,
    commissionType: "percentage",
    settlementFrequency: "semi_annual",
    vatIncluded: false,
    notes: "לא כולל מוצרי חלב מסוימים, 4 טבלאות בגיליון",
  },
  {
    name: "לאומי קארד",
    code: "LEUMI_CARD",
    commissionRate: 0.15,
    commissionType: "percentage",
    settlementFrequency: "semi_annual",
    vatIncluded: false,
    notes: "בדיקת חידוש חוזה 04/26",
  },
  {
    name: "קירוסקאי",
    code: "KIROSKAI",
    commissionRate: 5,
    commissionType: "percentage",
    settlementFrequency: "semi_annual",
    vatIncluded: false,
    notes: "מ-01/02",
  },

  // ============================================================
  // ספקים שנתיים
  // ============================================================
  {
    name: "טמפו שיווק",
    code: "TEMPO",
    commissionRate: 11,
    commissionType: "percentage",
    settlementFrequency: "annual",
    vatIncluded: false,
    notes: "מקניות ברוטו",
  },
  {
    name: "תנובה",
    code: "TNUVA",
    commissionRate: 6,
    commissionType: "percentage",
    settlementFrequency: "annual",
    vatIncluded: false,
    notes: "חלב 6% / בשר 7% / בקר 5% (לא חמאה)",
    commissionExceptions: [
      { identifier: "בשר", rate: 7, matchType: "keyword" },
      { identifier: "בקר", rate: 5, matchType: "keyword" },
      { identifier: "חמאה", rate: 0, matchType: "keyword", notes: "לא כולל חמאה" },
    ],
  },
];

async function main() {
  console.log("Starting supplier import...\n");

  let count = 0;

  for (const s of suppliersData) {
    const supplierId = randomUUID();

    await database.insert(supplier).values({
      id: supplierId,
      name: s.name,
      code: s.code,
      defaultCommissionRate: String(s.commissionRate),
      commissionType: s.commissionType,
      settlementFrequency: s.settlementFrequency,
      vatIncluded: s.vatIncluded,
      fileMapping: s.fileMapping || null,
      commissionExceptions: s.commissionExceptions || null,
      description: s.notes || null,
      isActive: true,
      isHidden: false,
    });

    count++;
    const hasFileMapping = s.fileMapping ? "with file mapping" : "no file mapping";
    console.log(`Supplier: ${s.name} (${s.code}) - ${s.commissionRate}% ${s.settlementFrequency} - ${hasFileMapping}`);
  }

  console.log("\n" + "=".repeat(50));
  console.log(`Summary: ${count} suppliers imported`);
  console.log("=".repeat(50));
  console.log("\nImport completed successfully!");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Error during import:", error);
    process.exit(1);
  });
