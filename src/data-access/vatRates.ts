import { database } from "@/db";
import {
  vatRate,
  type VatRate,
  type CreateVatRateData,
  type UpdateVatRateData,
} from "@/db/schema";
import { eq, desc, lte, and } from "drizzle-orm";
import { nanoid } from "nanoid";

// Default VAT rate to use as fallback if database is unavailable
export const DEFAULT_VAT_RATE = 0.18;

// In-memory cache for VAT rates (permanent - rates rarely change)
let vatRatesCache: VatRate[] | null = null;

/**
 * Clear the VAT rates cache (call after create/update/delete)
 */
export function clearVatRatesCache(): void {
  vatRatesCache = null;
}

/**
 * Get all VAT rates from the database, sorted by effective date (newest first)
 * Uses in-memory cache for performance
 */
export async function getAllVatRates(): Promise<VatRate[]> {
  if (vatRatesCache) {
    return vatRatesCache;
  }

  const rates = (await database
    .select()
    .from(vatRate)
    .orderBy(desc(vatRate.effectiveFrom))) as unknown as VatRate[];

  vatRatesCache = rates;
  return rates;
}

/**
 * Get the VAT rate effective for a specific date
 * Returns the most recent rate where effectiveFrom <= date
 *
 * @param date - The date to get the VAT rate for (defaults to current date)
 * @returns The VAT rate as a decimal (e.g., 0.18) or DEFAULT_VAT_RATE if not found
 */
export async function getVatRateForDate(date: Date = new Date()): Promise<number> {
  try {
    const rates = await getAllVatRates();

    // Format date to YYYY-MM-DD for comparison with date field
    const dateStr = date.toISOString().split("T")[0];

    // Find the most recent rate effective on or before the given date
    const effectiveRate = rates.find((r) => r.effectiveFrom <= dateStr);

    if (effectiveRate) {
      return parseFloat(effectiveRate.rate);
    }

    // No rate found - return default
    return DEFAULT_VAT_RATE;
  } catch (error) {
    console.error("Error fetching VAT rate for date:", error);
    return DEFAULT_VAT_RATE;
  }
}

/**
 * Get the current VAT rate (rate effective today)
 *
 * @returns The current VAT rate as a decimal (e.g., 0.18)
 */
export async function getCurrentVatRate(): Promise<number> {
  return getVatRateForDate(new Date());
}

/**
 * Get a single VAT rate by ID
 */
export async function getVatRateById(id: string): Promise<VatRate | null> {
  const results = (await database
    .select()
    .from(vatRate)
    .where(eq(vatRate.id, id))
    .limit(1)) as unknown as VatRate[];
  return results[0] || null;
}

/**
 * Get a VAT rate by effective date
 */
export async function getVatRateByEffectiveDate(
  effectiveFrom: string
): Promise<VatRate | null> {
  const results = (await database
    .select()
    .from(vatRate)
    .where(eq(vatRate.effectiveFrom, effectiveFrom))
    .limit(1)) as unknown as VatRate[];
  return results[0] || null;
}

/**
 * Create a new VAT rate
 *
 * @param data - The VAT rate data
 * @returns The created VAT rate
 */
export async function createVatRate(
  data: Omit<CreateVatRateData, "id">
): Promise<VatRate> {
  const id = `vat_rate_${nanoid()}`;

  const [newRate] = (await database
    .insert(vatRate)
    .values({
      ...data,
      id,
    })
    .returning()) as unknown as VatRate[];

  // Clear cache after creating
  clearVatRatesCache();

  return newRate;
}

/**
 * Update an existing VAT rate
 *
 * @param id - The VAT rate ID
 * @param data - The data to update
 * @returns The updated VAT rate or null if not found
 */
export async function updateVatRate(
  id: string,
  data: UpdateVatRateData
): Promise<VatRate | null> {
  const results = (await database
    .update(vatRate)
    .set({
      ...data,
      updatedAt: new Date(),
    })
    .where(eq(vatRate.id, id))
    .returning()) as unknown as VatRate[];

  // Clear cache after updating
  clearVatRatesCache();

  return results[0] || null;
}

/**
 * Delete a VAT rate
 *
 * @param id - The VAT rate ID
 * @returns True if deleted, false if not found
 */
export async function deleteVatRate(id: string): Promise<boolean> {
  const result = await database.delete(vatRate).where(eq(vatRate.id, id));

  // Clear cache after deleting
  clearVatRatesCache();

  return (result.rowCount ?? 0) > 0;
}

/**
 * Check if an effective date is unique (excluding a specific ID)
 *
 * @param effectiveFrom - The effective date to check
 * @param excludeId - Optional ID to exclude from check (for updates)
 * @returns True if the date is unique, false otherwise
 */
export async function isEffectiveDateUnique(
  effectiveFrom: string,
  excludeId?: string
): Promise<boolean> {
  const existing = await getVatRateByEffectiveDate(effectiveFrom);
  if (!existing) return true;
  if (excludeId && existing.id === excludeId) return true;
  return false;
}

/**
 * Get VAT rate statistics
 */
export async function getVatRateStats(): Promise<{
  total: number;
  currentRate: number;
  oldestRate: VatRate | null;
  newestRate: VatRate | null;
}> {
  const rates = await getAllVatRates();
  const currentRate = await getCurrentVatRate();

  return {
    total: rates.length,
    currentRate,
    oldestRate: rates.length > 0 ? rates[rates.length - 1] : null,
    newestRate: rates.length > 0 ? rates[0] : null,
  };
}
