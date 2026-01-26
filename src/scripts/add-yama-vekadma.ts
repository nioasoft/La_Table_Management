import "dotenv/config";
import { randomUUID } from "crypto";
import { database, pool } from "../db";
import { supplier } from "../db/schema";
import { eq } from "drizzle-orm";

/**
 * Add ימה וקדמה (YAMA_VEKADMA) supplier to the database
 *
 * Supplier details:
 * - Name: ימה וקדמה
 * - Code: YAMA_VEKADMA
 * - Commission: Need to confirm (not in current supplier list)
 * - Settlement Period: Quarterly (based on similar suppliers)
 * - File format: Account ledger (כרטסת) with transactions grouped by franchisee
 * - Custom parser: yama-vekadma-parser.ts
 */
async function main() {
  try {
    const supplierCode = "YAMA_VEKADMA";

    // Check if supplier already exists
    const existing = await database.query.supplier.findFirst({
      where: eq(supplier.code, supplierCode),
    });

    if (existing) {
      console.log(`Supplier ${supplierCode} already exists with ID: ${existing.id}`);
      console.log("Updating file mapping...");

      await database
        .update(supplier)
        .set({
          fileMapping: {
            fileType: "xlsx",
            columnMappings: {
              franchiseeColumn: "A", // Franchisee names appear in first column
              amountColumn: "H",     // Debit column (חובה)
              dateColumn: "",        // No date column
            },
            headerRow: 0,
            dataStartRow: 1,
            customParser: true,
          },
          updatedAt: new Date(),
        })
        .where(eq(supplier.code, supplierCode));

      console.log("File mapping updated successfully");
    } else {
      console.log(`Creating new supplier: ${supplierCode}`);

      const supplierId = randomUUID();
      const [newSupplier] = await database
        .insert(supplier)
        .values({
          id: supplierId,
          name: "ימה וקדמה",
          code: supplierCode,
          defaultCommissionRate: "12",
          commissionType: "percentage",
          settlementFrequency: "quarterly",
          vatIncluded: true, // סכומים כוללים מע"מ
          isActive: true,
          fileMapping: {
            fileType: "xlsx",
            columnMappings: {
              franchiseeColumn: "A",
              amountColumn: "H",
              dateColumn: "",
            },
            headerRow: 0,
            dataStartRow: 1,
            customParser: true,
          },
          description: "כרטסת חשבון - סכומים כוללים מע\"מ",
        })
        .returning();

      console.log(`Created supplier with ID: ${newSupplier.id}`);
    }

    console.log("\nDone!");
  } catch (error) {
    console.error("Error:", error);
    throw error;
  } finally {
    await pool.end();
  }
}

main();
