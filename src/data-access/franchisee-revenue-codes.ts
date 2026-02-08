import { database } from "@/db";
import {
  franchiseeRevenueCode,
  type FranchiseeRevenueCode,
  type CreateFranchiseeRevenueCodeData,
} from "@/db/schema";
import { eq, and, inArray } from "drizzle-orm";
import { randomUUID } from "crypto";

/**
 * Revenue code with account info
 */
export interface RevenueCodeInfo {
  accountCode: string;
  accountName: string | null;
}

/**
 * Get all revenue codes for a franchisee
 */
export async function getFranchiseeRevenueCodes(
  franchiseeId: string
): Promise<FranchiseeRevenueCode[]> {
  return database
    .select()
    .from(franchiseeRevenueCode)
    .where(eq(franchiseeRevenueCode.franchiseeId, franchiseeId));
}

/**
 * Get just the account codes for a franchisee (for quick lookups)
 */
export async function getFranchiseeRevenueCodesList(
  franchiseeId: string
): Promise<string[]> {
  const codes = await database
    .select({ accountCode: franchiseeRevenueCode.accountCode })
    .from(franchiseeRevenueCode)
    .where(eq(franchiseeRevenueCode.franchiseeId, franchiseeId));
  return codes.map((c) => c.accountCode);
}

/**
 * Add multiple revenue codes to a franchisee
 * Skips codes that already exist
 */
export async function addFranchiseeRevenueCodes(
  franchiseeId: string,
  codes: RevenueCodeInfo[],
  userId?: string
): Promise<{ added: number; skipped: number }> {
  if (codes.length === 0) {
    return { added: 0, skipped: 0 };
  }

  // Get existing codes to avoid duplicates
  const existingCodes = await getFranchiseeRevenueCodesList(franchiseeId);
  const existingSet = new Set(existingCodes);

  // Filter out codes that already exist
  const newCodes = codes.filter((c) => !existingSet.has(c.accountCode));

  if (newCodes.length === 0) {
    return { added: 0, skipped: codes.length };
  }

  // Insert new codes
  const toInsert: CreateFranchiseeRevenueCodeData[] = newCodes.map((c) => ({
    id: randomUUID(),
    franchiseeId,
    accountCode: c.accountCode,
    accountName: c.accountName,
    createdBy: userId,
  }));

  await database.insert(franchiseeRevenueCode).values(toInsert);

  return { added: newCodes.length, skipped: codes.length - newCodes.length };
}

/**
 * Remove a specific revenue code from a franchisee
 */
export async function removeFranchiseeRevenueCode(
  franchiseeId: string,
  accountCode: string
): Promise<boolean> {
  const result = await database
    .delete(franchiseeRevenueCode)
    .where(
      and(
        eq(franchiseeRevenueCode.franchiseeId, franchiseeId),
        eq(franchiseeRevenueCode.accountCode, accountCode)
      )
    )
    .returning({ id: franchiseeRevenueCode.id });

  return result.length > 0;
}

/**
 * Set the revenue codes for a franchisee (replaces all existing codes)
 */
export async function setFranchiseeRevenueCodes(
  franchiseeId: string,
  codes: RevenueCodeInfo[],
  userId?: string
): Promise<{ added: number; removed: number }> {
  // Get existing codes
  const existingCodes = await getFranchiseeRevenueCodesList(franchiseeId);
  const existingSet = new Set(existingCodes);
  const newCodesSet = new Set(codes.map((c) => c.accountCode));

  // Find codes to remove (exist but not in new list)
  const codesToRemove = existingCodes.filter((c) => !newCodesSet.has(c));

  // Find codes to add (in new list but don't exist)
  const codesToAdd = codes.filter((c) => !existingSet.has(c.accountCode));

  // Remove old codes
  if (codesToRemove.length > 0) {
    await database
      .delete(franchiseeRevenueCode)
      .where(
        and(
          eq(franchiseeRevenueCode.franchiseeId, franchiseeId),
          inArray(franchiseeRevenueCode.accountCode, codesToRemove)
        )
      );
  }

  // Add new codes
  if (codesToAdd.length > 0) {
    const toInsert: CreateFranchiseeRevenueCodeData[] = codesToAdd.map((c) => ({
      id: randomUUID(),
      franchiseeId,
      accountCode: c.accountCode,
      accountName: c.accountName,
      createdBy: userId,
    }));

    await database.insert(franchiseeRevenueCode).values(toInsert);
  }

  return { added: codesToAdd.length, removed: codesToRemove.length };
}

/**
 * Check if a franchisee has a specific revenue code
 */
export async function hasFranchiseeRevenueCode(
  franchiseeId: string,
  accountCode: string
): Promise<boolean> {
  const result = await database
    .select({ id: franchiseeRevenueCode.id })
    .from(franchiseeRevenueCode)
    .where(
      and(
        eq(franchiseeRevenueCode.franchiseeId, franchiseeId),
        eq(franchiseeRevenueCode.accountCode, accountCode)
      )
    )
    .limit(1);

  return result.length > 0;
}
