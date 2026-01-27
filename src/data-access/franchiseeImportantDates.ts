import { database } from "@/db";
import { formatDateAsLocal } from "@/lib/date-utils";
import {
  franchiseeImportantDate,
  franchisee,
  user,
  type FranchiseeImportantDate,
  type CreateFranchiseeImportantDateData,
  type UpdateFranchiseeImportantDateData,
  type ImportantDateType,
  type DurationUnit,
} from "@/db/schema";
import { eq, desc, and, lte, gte, sql } from "drizzle-orm";
import {
  calculateEndDate,
  calculateReminderDate,
  toMonths,
  fromMonths,
  getReminderUrgency,
  DATE_TYPE_LABELS,
  DURATION_UNIT_LABELS,
} from "@/lib/important-dates-utils";

// Re-export utilities for backward compatibility
export {
  calculateEndDate,
  calculateReminderDate,
  toMonths,
  fromMonths,
  getReminderUrgency,
  DATE_TYPE_LABELS,
  DURATION_UNIT_LABELS,
};

/**
 * Franchisee Important Date with franchisee information
 */
export type FranchiseeImportantDateWithFranchisee = FranchiseeImportantDate & {
  franchisee: {
    id: string;
    name: string;
    code: string;
  } | null;
  createdByUser?: {
    name: string;
    email: string;
  } | null;
};

/**
 * Get all important dates for a specific franchisee
 */
export async function getImportantDatesByFranchisee(
  franchiseeId: string
): Promise<FranchiseeImportantDateWithFranchisee[]> {
  const results = await database
    .select({
      importantDate: franchiseeImportantDate,
      franchisee: {
        id: franchisee.id,
        name: franchisee.name,
        code: franchisee.code,
      },
      createdByUserName: user.name,
      createdByUserEmail: user.email,
    })
    .from(franchiseeImportantDate)
    .leftJoin(franchisee, eq(franchiseeImportantDate.franchiseeId, franchisee.id))
    .leftJoin(user, eq(franchiseeImportantDate.createdBy, user.id))
    .where(eq(franchiseeImportantDate.franchiseeId, franchiseeId))
    .orderBy(franchiseeImportantDate.endDate);

  return results.map((r) => ({
    ...r.importantDate,
    franchisee: r.franchisee,
    createdByUser: r.createdByUserName
      ? { name: r.createdByUserName, email: r.createdByUserEmail! }
      : null,
  }));
}

/**
 * Get a single important date by ID
 */
export async function getImportantDateById(
  id: string
): Promise<FranchiseeImportantDateWithFranchisee | null> {
  const results = await database
    .select({
      importantDate: franchiseeImportantDate,
      franchisee: {
        id: franchisee.id,
        name: franchisee.name,
        code: franchisee.code,
      },
      createdByUserName: user.name,
      createdByUserEmail: user.email,
    })
    .from(franchiseeImportantDate)
    .leftJoin(franchisee, eq(franchiseeImportantDate.franchiseeId, franchisee.id))
    .leftJoin(user, eq(franchiseeImportantDate.createdBy, user.id))
    .where(eq(franchiseeImportantDate.id, id))
    .limit(1);

  if (results.length === 0) return null;

  return {
    ...results[0].importantDate,
    franchisee: results[0].franchisee,
    createdByUser: results[0].createdByUserName
      ? { name: results[0].createdByUserName, email: results[0].createdByUserEmail! }
      : null,
  };
}

/**
 * Input data for creating important date (before date calculations)
 */
export interface CreateImportantDateInput {
  franchiseeId: string;
  dateType: ImportantDateType;
  customTypeName?: string;
  startDate: string;
  durationMonths: number;
  displayUnit?: DurationUnit;
  reminderMonthsBefore?: number;
  description?: string;
  notes?: string;
  isActive?: boolean;
  createdBy?: string;
}

/**
 * Create a new important date with auto-calculated end date and reminder date
 */
export async function createImportantDate(
  input: CreateImportantDateInput
): Promise<FranchiseeImportantDate> {
  const endDate = calculateEndDate(input.startDate, input.durationMonths);
  const reminderMonthsBefore = input.reminderMonthsBefore ?? 3;
  const reminderDate = calculateReminderDate(endDate, reminderMonthsBefore);

  const data: CreateFranchiseeImportantDateData = {
    id: crypto.randomUUID(),
    franchiseeId: input.franchiseeId,
    dateType: input.dateType,
    customTypeName: input.customTypeName,
    startDate: input.startDate,
    durationMonths: input.durationMonths,
    displayUnit: input.displayUnit ?? "months",
    endDate,
    reminderMonthsBefore,
    reminderDate,
    description: input.description,
    notes: input.notes,
    isActive: input.isActive ?? true,
    createdBy: input.createdBy,
  };

  const [newDate] = (await database
    .insert(franchiseeImportantDate)
    .values(data)
    .returning()) as unknown as FranchiseeImportantDate[];

  return newDate;
}

/**
 * Input data for updating important date
 */
export interface UpdateImportantDateInput {
  dateType?: ImportantDateType;
  customTypeName?: string;
  startDate?: string;
  durationMonths?: number;
  displayUnit?: DurationUnit;
  reminderMonthsBefore?: number;
  description?: string;
  notes?: string;
  isActive?: boolean;
}

/**
 * Update an existing important date (recalculates dates if needed)
 */
export async function updateImportantDate(
  id: string,
  input: UpdateImportantDateInput
): Promise<FranchiseeImportantDate | null> {
  // Get current record to fill in missing values for calculation
  const current = await getImportantDateById(id);
  if (!current) return null;

  const startDate = input.startDate ?? current.startDate;
  const durationMonths = input.durationMonths ?? current.durationMonths;
  const reminderMonthsBefore = input.reminderMonthsBefore ?? current.reminderMonthsBefore;

  // Recalculate dates if any date-related field changed
  const endDate = calculateEndDate(startDate, durationMonths);
  const reminderDate = calculateReminderDate(endDate, reminderMonthsBefore);

  const updateData: UpdateFranchiseeImportantDateData = {
    ...input,
    endDate,
    reminderDate,
    updatedAt: new Date(),
  };

  const results = (await database
    .update(franchiseeImportantDate)
    .set(updateData)
    .where(eq(franchiseeImportantDate.id, id))
    .returning()) as unknown as FranchiseeImportantDate[];

  return results[0] || null;
}

/**
 * Delete an important date
 */
export async function deleteImportantDate(id: string): Promise<boolean> {
  const result = await database
    .delete(franchiseeImportantDate)
    .where(eq(franchiseeImportantDate.id, id));
  return (result.rowCount ?? 0) > 0;
}

/**
 * Copy an important date to a new type (same franchisee)
 */
export async function copyImportantDate(
  sourceId: string,
  targetType: ImportantDateType,
  customTypeName?: string
): Promise<FranchiseeImportantDate | null> {
  const source = await getImportantDateById(sourceId);
  if (!source) return null;

  return createImportantDate({
    franchiseeId: source.franchiseeId,
    dateType: targetType,
    customTypeName: targetType === "custom" ? customTypeName : undefined,
    startDate: source.startDate,
    durationMonths: source.durationMonths,
    displayUnit: source.displayUnit,
    reminderMonthsBefore: source.reminderMonthsBefore,
    description: source.description ?? undefined,
    notes: source.notes ?? undefined,
    isActive: source.isActive,
    createdBy: source.createdBy ?? undefined,
  });
}

/**
 * Get all active important dates with upcoming reminders
 * Returns dates where reminder date has passed but end date hasn't
 */
export async function getActiveReminders(): Promise<FranchiseeImportantDateWithFranchisee[]> {
  const today = formatDateAsLocal(new Date());

  const results = await database
    .select({
      importantDate: franchiseeImportantDate,
      franchisee: {
        id: franchisee.id,
        name: franchisee.name,
        code: franchisee.code,
      },
      createdByUserName: user.name,
      createdByUserEmail: user.email,
    })
    .from(franchiseeImportantDate)
    .leftJoin(franchisee, eq(franchiseeImportantDate.franchiseeId, franchisee.id))
    .leftJoin(user, eq(franchiseeImportantDate.createdBy, user.id))
    .where(
      and(
        eq(franchiseeImportantDate.isActive, true),
        lte(franchiseeImportantDate.reminderDate, today),
        gte(franchiseeImportantDate.endDate, today)
      )
    )
    .orderBy(franchiseeImportantDate.endDate);

  return results.map((r) => ({
    ...r.importantDate,
    franchisee: r.franchisee,
    createdByUser: r.createdByUserName
      ? { name: r.createdByUserName, email: r.createdByUserEmail! }
      : null,
  }));
}

/**
 * Get count of active reminders for a specific franchisee
 */
export async function getActiveReminderCountForFranchisee(
  franchiseeId: string
): Promise<number> {
  const today = formatDateAsLocal(new Date());

  const result = await database
    .select({ count: sql<number>`count(*)::int` })
    .from(franchiseeImportantDate)
    .where(
      and(
        eq(franchiseeImportantDate.franchiseeId, franchiseeId),
        eq(franchiseeImportantDate.isActive, true),
        lte(franchiseeImportantDate.reminderDate, today),
        gte(franchiseeImportantDate.endDate, today)
      )
    );

  return result[0]?.count ?? 0;
}

/**
 * Get active reminder counts for all franchisees (for list view badges)
 * Returns a map of franchiseeId -> reminder count
 */
export async function getAllFranchiseeReminderCounts(): Promise<Map<string, number>> {
  const today = formatDateAsLocal(new Date());

  const results = await database
    .select({
      franchiseeId: franchiseeImportantDate.franchiseeId,
      count: sql<number>`count(*)::int`,
    })
    .from(franchiseeImportantDate)
    .where(
      and(
        eq(franchiseeImportantDate.isActive, true),
        lte(franchiseeImportantDate.reminderDate, today),
        gte(franchiseeImportantDate.endDate, today)
      )
    )
    .groupBy(franchiseeImportantDate.franchiseeId);

  const countMap = new Map<string, number>();
  for (const r of results) {
    countMap.set(r.franchiseeId, r.count);
  }
  return countMap;
}
