import { database } from "@/db";
import {
  franchiseeAccountClassification,
  franchiseeRevenueCode,
  type AccountCategory,
  type FranchiseeAccountClassification,
} from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { randomUUID } from "crypto";

/**
 * Classification entry for bulk operations
 */
export interface ClassificationEntry {
  accountKey: string;
  accountName?: string | null;
  category: AccountCategory;
}

/**
 * Get all classifications for a franchisee as a Map<accountKey, category>
 */
export async function getClassificationMap(
  franchiseeId: string
): Promise<Map<string, AccountCategory>> {
  const rows = await database
    .select({
      accountKey: franchiseeAccountClassification.accountKey,
      category: franchiseeAccountClassification.category,
    })
    .from(franchiseeAccountClassification)
    .where(eq(franchiseeAccountClassification.franchiseeId, franchiseeId));

  const map = new Map<string, AccountCategory>();
  for (const row of rows) {
    map.set(row.accountKey, row.category as AccountCategory);
  }
  return map;
}

/**
 * Get all classification records for a franchisee (full details)
 */
export async function getClassifications(
  franchiseeId: string
): Promise<FranchiseeAccountClassification[]> {
  return database
    .select()
    .from(franchiseeAccountClassification)
    .where(eq(franchiseeAccountClassification.franchiseeId, franchiseeId));
}

/**
 * Upsert a single classification.
 * When setting category='revenue', also syncs to franchisee_revenue_code.
 * When changing away from 'revenue', removes from franchisee_revenue_code.
 */
export async function setClassification(
  franchiseeId: string,
  accountKey: string,
  category: AccountCategory,
  accountName?: string | null,
  userId?: string
): Promise<void> {
  const id = randomUUID();
  const now = new Date();

  await database
    .insert(franchiseeAccountClassification)
    .values({
      id,
      franchiseeId,
      accountKey,
      accountName: accountName ?? null,
      category,
      createdAt: now,
      updatedAt: now,
      createdBy: userId ?? null,
    })
    .onConflictDoUpdate({
      target: [
        franchiseeAccountClassification.franchiseeId,
        franchiseeAccountClassification.accountKey,
      ],
      set: {
        category,
        accountName: accountName ?? undefined,
        updatedAt: now,
      },
    });

  // Sync revenue code table
  if (category === "revenue") {
    await syncRevenueCode(franchiseeId, accountKey, accountName, userId);
  } else {
    await removeRevenueCode(franchiseeId, accountKey);
  }
}

/**
 * Bulk upsert classifications.
 * Syncs revenue codes for any items with category='revenue'.
 */
export async function bulkSetClassifications(
  franchiseeId: string,
  items: ClassificationEntry[],
  userId?: string
): Promise<{ upserted: number }> {
  if (items.length === 0) return { upserted: 0 };

  const now = new Date();

  for (const item of items) {
    const id = randomUUID();
    await database
      .insert(franchiseeAccountClassification)
      .values({
        id,
        franchiseeId,
        accountKey: item.accountKey,
        accountName: item.accountName ?? null,
        category: item.category,
        createdAt: now,
        updatedAt: now,
        createdBy: userId ?? null,
      })
      .onConflictDoUpdate({
        target: [
          franchiseeAccountClassification.franchiseeId,
          franchiseeAccountClassification.accountKey,
        ],
        set: {
          category: item.category,
          accountName: item.accountName ?? undefined,
          updatedAt: now,
        },
      });

    // Sync revenue code table
    if (item.category === "revenue") {
      await syncRevenueCode(franchiseeId, item.accountKey, item.accountName, userId);
    } else {
      await removeRevenueCode(franchiseeId, item.accountKey);
    }
  }

  return { upserted: items.length };
}

/**
 * Remove a classification (revert to auto-detection).
 * Also removes from revenue codes if it was previously classified as revenue.
 */
export async function removeClassification(
  franchiseeId: string,
  accountKey: string
): Promise<boolean> {
  const result = await database
    .delete(franchiseeAccountClassification)
    .where(
      and(
        eq(franchiseeAccountClassification.franchiseeId, franchiseeId),
        eq(franchiseeAccountClassification.accountKey, accountKey)
      )
    )
    .returning({ id: franchiseeAccountClassification.id });

  // Also remove from revenue codes
  await removeRevenueCode(franchiseeId, accountKey);

  return result.length > 0;
}

// ============================================================================
// Revenue code sync helpers
// ============================================================================

async function syncRevenueCode(
  franchiseeId: string,
  accountCode: string,
  accountName?: string | null,
  userId?: string
): Promise<void> {
  const id = randomUUID();
  await database
    .insert(franchiseeRevenueCode)
    .values({
      id,
      franchiseeId,
      accountCode,
      accountName: accountName ?? null,
      createdBy: userId ?? null,
    })
    .onConflictDoNothing();
}

async function removeRevenueCode(
  franchiseeId: string,
  accountCode: string
): Promise<void> {
  await database
    .delete(franchiseeRevenueCode)
    .where(
      and(
        eq(franchiseeRevenueCode.franchiseeId, franchiseeId),
        eq(franchiseeRevenueCode.accountCode, accountCode)
      )
    );
}
