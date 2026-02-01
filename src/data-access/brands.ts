import { database } from "@/db";
import { brand, type Brand, type CreateBrandData, type UpdateBrandData } from "@/db/schema";
import { eq, desc, and } from "drizzle-orm";

/**
 * Options for filtering brands
 */
export interface GetBrandsOptions {
  /** Include system brands (default: false) */
  includeSystemBrands?: boolean;
  /** Filter by active status */
  isActive?: boolean;
}

/**
 * Get all brands from the database
 * By default, excludes system brands (like "שונות" for other income sources)
 *
 * @param options - Filter options
 */
export async function getBrands(options: GetBrandsOptions = {}): Promise<Brand[]> {
  const { includeSystemBrands = false, isActive } = options;

  const conditions = [];

  // Exclude system brands by default
  if (!includeSystemBrands) {
    conditions.push(eq(brand.isSystemBrand, false));
  }

  // Filter by active status if specified
  if (isActive !== undefined) {
    conditions.push(eq(brand.isActive, isActive));
  }

  return database
    .select()
    .from(brand)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(brand.createdAt)) as unknown as Promise<Brand[]>;
}

/**
 * Get all active brands (excludes system brands by default)
 *
 * @param options - Filter options
 */
export async function getActiveBrands(
  options: Pick<GetBrandsOptions, "includeSystemBrands"> = {}
): Promise<Brand[]> {
  return getBrands({ ...options, isActive: true });
}

/**
 * Get the "Other" system brand for other income sources
 * Creates it if it doesn't exist
 */
export async function getOtherBrand(): Promise<Brand> {
  const OTHER_BRAND_CODE = "OTHER";

  const existingBrand = await getBrandByCode(OTHER_BRAND_CODE);
  if (existingBrand) {
    return existingBrand;
  }

  // Create the system brand if it doesn't exist
  return createBrand({
    id: crypto.randomUUID(),
    code: OTHER_BRAND_CODE,
    nameHe: "שונות",
    nameEn: "Other",
    description: "מקורות הכנסה שאינם זכיינים (כגון דון פדרו)",
    isActive: true,
    isSystemBrand: true,
  });
}

/**
 * Get a single brand by ID
 */
export async function getBrandById(id: string): Promise<Brand | null> {
  const results = await database
    .select()
    .from(brand)
    .where(eq(brand.id, id))
    .limit(1) as unknown as Brand[];
  return results[0] || null;
}

/**
 * Get a single brand by code
 */
export async function getBrandByCode(code: string): Promise<Brand | null> {
  const results = await database
    .select()
    .from(brand)
    .where(eq(brand.code, code))
    .limit(1) as unknown as Brand[];
  return results[0] || null;
}

/**
 * Create a new brand
 */
export async function createBrand(data: CreateBrandData): Promise<Brand> {
  const [newBrand] = await database
    .insert(brand)
    .values(data)
    .returning() as unknown as Brand[];
  return newBrand;
}

/**
 * Update an existing brand
 */
export async function updateBrand(
  id: string,
  data: UpdateBrandData
): Promise<Brand | null> {
  const results = await database
    .update(brand)
    .set({
      ...data,
      updatedAt: new Date(),
    })
    .where(eq(brand.id, id))
    .returning() as unknown as Brand[];
  return results[0] || null;
}

/**
 * Delete a brand
 */
export async function deleteBrand(id: string): Promise<boolean> {
  const result = await database.delete(brand).where(eq(brand.id, id));
  return (result.rowCount ?? 0) > 0;
}

/**
 * Toggle brand active status
 */
export async function toggleBrandStatus(id: string): Promise<Brand | null> {
  const existingBrand = await getBrandById(id);
  if (!existingBrand) return null;

  const results = await database
    .update(brand)
    .set({
      isActive: !existingBrand.isActive,
      updatedAt: new Date(),
    })
    .where(eq(brand.id, id))
    .returning() as unknown as Brand[];
  return results[0] || null;
}

/**
 * Check if a brand code is unique
 */
export async function isBrandCodeUnique(code: string, excludeId?: string): Promise<boolean> {
  const existingBrand = await getBrandByCode(code);
  if (!existingBrand) return true;
  if (excludeId && existingBrand.id === excludeId) return true;
  return false;
}

/**
 * Get brand statistics (excludes system brands by default)
 *
 * @param options - Filter options
 */
export async function getBrandStats(
  options: Pick<GetBrandsOptions, "includeSystemBrands"> = {}
): Promise<{
  total: number;
  active: number;
  inactive: number;
}> {
  const allBrands = await getBrands(options);

  const stats = {
    total: allBrands.length,
    active: 0,
    inactive: 0,
  };

  for (const b of allBrands) {
    if (b.isActive) {
      stats.active++;
    } else {
      stats.inactive++;
    }
  }

  return stats;
}
