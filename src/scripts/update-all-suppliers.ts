import "dotenv/config";
import { database, pool } from "../db";
import { supplier } from "../db/schema";
import { eq } from "drizzle-orm";

// File mapping configurations for suppliers with sample files
const supplierConfigs: Record<
  string,
  {
    commissionRate?: string;
    fileMapping?: {
      fileType: string;
      columnMappings: {
        franchiseeColumn: string;
        amountColumn: string;
        dateColumn?: string;
      };
      headerRow: number;
      dataStartRow: number;
      skipKeywords?: string[];
      sheetName?: string;
      customParser?: boolean;
    };
  }
> = {
  // ============================================
  // MONTHLY SUPPLIERS (2)
  // ============================================
  MITLAND: {
    commissionRate: "13",
    // No file mapping - no sample file
  },
  AVRAHAMI: {
    commissionRate: "10", // 12% for לאפה וחלת בריוש
    fileMapping: {
      fileType: "xlsx",
      columnMappings: { franchiseeColumn: "", amountColumn: "" },
      headerRow: 0,
      dataStartRow: 2,
      customParser: true,
    },
  },

  // ============================================
  // QUARTERLY SUPPLIERS WITH SAMPLE FILES (Simple - 12)
  // ============================================
  FANDANGO: {
    commissionRate: "12",
    fileMapping: {
      fileType: "xlsx",
      columnMappings: { franchiseeColumn: "B", amountColumn: "G" },
      headerRow: 1,
      dataStartRow: 2,
      skipKeywords: ['סה"כ', "סהכ"],
      sheetName: "AlmogERP&CRM",
    },
  },
  HEICHAL_HAYIU: {
    commissionRate: "15",
    fileMapping: {
      fileType: "xlsx",
      columnMappings: { franchiseeColumn: "A", amountColumn: "B" },
      headerRow: 1,
      dataStartRow: 2,
      sheetName: "Export",
    },
  },
  MAKATI: {
    commissionRate: "17",
    fileMapping: {
      fileType: "xlsx",
      columnMappings: { franchiseeColumn: "B", amountColumn: "E" },
      headerRow: 4,
      dataStartRow: 5,
    },
  },
  ASPIRIT: {
    commissionRate: "14",
    fileMapping: {
      fileType: "xlsx",
      columnMappings: { franchiseeColumn: "B", amountColumn: "G" },
      headerRow: 1,
      dataStartRow: 2,
      sheetName: "DataSheet",
    },
  },
  FRESCO: {
    commissionRate: "10",
    fileMapping: {
      fileType: "xlsx",
      columnMappings: { franchiseeColumn: "A", amountColumn: "B" },
      headerRow: 0,
      dataStartRow: 1,
      sheetName: "גיליון2",
      customParser: true,
    },
  },
  KILL_BILL: {
    commissionRate: "10",
    fileMapping: {
      fileType: "xlsx",
      columnMappings: { franchiseeColumn: "G", amountColumn: "A" },
      headerRow: 2,
      dataStartRow: 3,
    },
  },
  JUMON: {
    commissionRate: "17", // Variable: 17%/10%/20% by product type
    fileMapping: {
      fileType: "xlsx",
      columnMappings: { franchiseeColumn: "B", amountColumn: "F" },
      headerRow: 1,
      dataStartRow: 2,
    },
  },
  MAADANEI_HATEVA: {
    commissionRate: "10",
    fileMapping: {
      fileType: "xlsx",
      columnMappings: { franchiseeColumn: "B", amountColumn: "G" },
      headerRow: 1,
      dataStartRow: 2,
      sheetName: "DataSheet",
    },
  },
  ARGEL: {
    commissionRate: "10",
    fileMapping: {
      fileType: "xlsx",
      columnMappings: { franchiseeColumn: "B", amountColumn: "H" },
      headerRow: 1,
      dataStartRow: 2,
    },
  },
  DIPLOMAT: {
    commissionRate: "17",
    fileMapping: {
      fileType: "xlsx",
      columnMappings: { franchiseeColumn: "A", amountColumn: "F" },
      headerRow: 1,
      dataStartRow: 2,
    },
  },
  ALE_ALE: {
    commissionRate: "10",
    fileMapping: {
      fileType: "csv",
      columnMappings: { franchiseeColumn: "B", amountColumn: "H", dateColumn: "A" },
      headerRow: 1,
      dataStartRow: 2,
    },
  },

  // ============================================
  // QUARTERLY SUPPLIERS WITH SAMPLE FILES (Complex - need custom parser)
  // ============================================
  MADAG: {
    commissionRate: "15",
    fileMapping: {
      fileType: "xls",
      columnMappings: { franchiseeColumn: "", amountColumn: "" },
      headerRow: 2,
      dataStartRow: 3,
      customParser: true,
    },
  },
  YAAKOV_AGENCIES: {
    commissionRate: "10",
    fileMapping: {
      fileType: "xlsx",
      columnMappings: { franchiseeColumn: "", amountColumn: "" },
      headerRow: 3,
      dataStartRow: 6,
      customParser: true,
    },
  },
  MOR_BRIUT: {
    commissionRate: "12",
    fileMapping: {
      fileType: "xls",
      columnMappings: { franchiseeColumn: "", amountColumn: "" },
      headerRow: 2,
      dataStartRow: 4,
      customParser: true,
    },
  },
  UNICO: {
    commissionRate: "15",
    fileMapping: {
      fileType: "xlsx",
      columnMappings: { franchiseeColumn: "", amountColumn: "" },
      headerRow: 2,
      dataStartRow: 3,
      customParser: true,
    },
  },
  TUVIOT_HATZAFON: {
    commissionRate: "15",
    fileMapping: {
      fileType: "xlsx",
      columnMappings: { franchiseeColumn: "", amountColumn: "" },
      headerRow: 2,
      dataStartRow: 3,
      customParser: true,
    },
  },
  AREL_PACKAGING: {
    commissionRate: "15",
    fileMapping: {
      fileType: "xlsx",
      columnMappings: { franchiseeColumn: "", amountColumn: "" },
      headerRow: 12,
      dataStartRow: 14,
      customParser: true,
    },
  },
  MIZRACH_UMAARAV: {
    commissionRate: "17",
    fileMapping: {
      fileType: "xlsx",
      columnMappings: { franchiseeColumn: "B", amountColumn: "F" },
      headerRow: 3,
      dataStartRow: 4,
      sheetName: "עמלה",
    },
  },
  RISTRETTO: {
    commissionRate: "17",
    fileMapping: {
      fileType: "xlsx",
      columnMappings: { franchiseeColumn: "B", amountColumn: "F" },
      headerRow: 3,
      dataStartRow: 4,
      sheetName: "עמלה",
    },
  },
  PASTA_LA_CASA: {
    commissionRate: "15",
    fileMapping: {
      fileType: "zip", // Accepts ZIP with multiple XLS files or single XLS
      columnMappings: { franchiseeColumn: "", amountColumn: "" },
      headerRow: 0,
      dataStartRow: 1,
      customParser: true,
    },
  },

  // ============================================
  // SEMI-ANNUAL SUPPLIERS (3)
  // ============================================
  MACHALVOT_GAD: {
    commissionRate: "9",
    fileMapping: {
      fileType: "xlsx",
      columnMappings: { franchiseeColumn: "", amountColumn: "" },
      headerRow: 0,
      dataStartRow: 2,
      customParser: true,
    },
  },
  LEUMI_CARD: {
    commissionRate: "0.15",
    // No file mapping - no sample file
  },
  KIROSKAI: {
    commissionRate: "5",
    // No file mapping - no sample file
  },

  // ============================================
  // ANNUAL SUPPLIERS (2)
  // ============================================
  TEMPO: {
    commissionRate: "11",
    // No file mapping - no sample file
  },
  TNUVA: {
    commissionRate: "6", // Variable: 6%/7%/5% by product category
    // No file mapping - no sample file
  },

  // ============================================
  // QUARTERLY SUPPLIERS WITHOUT SAMPLE FILES (9)
  // ============================================
  NESPRESSO: {
    commissionRate: "0.21", // Per capsule rate
    // No file mapping - no sample file
  },
  SOBER_LERNER: {
    commissionRate: "15",
    // No file mapping - no sample file
  },
  OREN_JUICES: {
    commissionRate: "5",
    // No file mapping - no sample file
  },
  BIGI: {
    commissionRate: "12",
    // No file mapping - no sample file
  },
  CHEF_HAYAM: {
    commissionRate: "15",
    // No file mapping - no sample file
  },
  MOR_MAZON: {
    commissionRate: "15",
    // No file mapping - no sample file
  },
  NISSIM_GOREN: {
    commissionRate: "10",
    // No file mapping - no sample file
  },
  SANO: {
    commissionRate: "6",
    // No file mapping - no sample file
  },
  STRAUSS_COFFEE: {
    commissionRate: "10",
    // No file mapping - no sample file
  },
};

async function main() {
  console.log("Updating suppliers with file mappings and commission rates...\n");

  let updated = 0;
  let skipped = 0;
  let errors = 0;

  for (const [code, config] of Object.entries(supplierConfigs)) {
    try {
      const updateData: Record<string, unknown> = {};

      if (config.commissionRate) {
        updateData.defaultCommissionRate = config.commissionRate;
      }

      if (config.fileMapping) {
        updateData.fileMapping = config.fileMapping;
      }

      if (Object.keys(updateData).length === 0) {
        console.log(`⏭️  ${code}: No updates needed`);
        skipped++;
        continue;
      }

      await database
        .update(supplier)
        .set(updateData)
        .where(eq(supplier.code, code));

      console.log(
        `✅ ${code}: Updated (commission: ${config.commissionRate || "-"}%, mapping: ${config.fileMapping ? "Yes" : "No"})`
      );
      updated++;
    } catch (error) {
      console.error(`❌ ${code}: Error - ${error}`);
      errors++;
    }
  }

  console.log("\n=== Summary ===");
  console.log(`Updated: ${updated}`);
  console.log(`Skipped: ${skipped}`);
  console.log(`Errors: ${errors}`);

  await pool.end();
}

main().catch(console.error);
