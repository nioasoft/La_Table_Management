import { database } from "@/db";
import {
  staffContact,
  brand,
  type StaffContact,
  type CreateStaffContactData,
  type UpdateStaffContactData,
  type StaffRole,
} from "@/db/schema";
import { eq, and, isNull } from "drizzle-orm";

export type StaffContactWithBrand = StaffContact & {
  brand: { id: string; nameHe: string } | null;
};

interface GetStaffContactsOptions {
  brandId?: string | null; // null = group-level, undefined = all
  role?: StaffRole;
  isActive?: boolean;
}

/**
 * Get staff contacts with optional brand join and filtering
 */
export async function getStaffContacts(
  options: GetStaffContactsOptions = {}
): Promise<StaffContactWithBrand[]> {
  const conditions = [];

  if (options.isActive !== undefined) {
    conditions.push(eq(staffContact.isActive, options.isActive));
  }

  if (options.role) {
    conditions.push(eq(staffContact.role, options.role));
  }

  // brandId filtering: null = group-level, string = specific brand
  if (options.brandId === null) {
    conditions.push(isNull(staffContact.brandId));
  } else if (options.brandId) {
    conditions.push(eq(staffContact.brandId, options.brandId));
  }

  const rows = await database
    .select({
      id: staffContact.id,
      name: staffContact.name,
      phone: staffContact.phone,
      email: staffContact.email,
      role: staffContact.role,
      brandId: staffContact.brandId,
      isActive: staffContact.isActive,
      createdAt: staffContact.createdAt,
      updatedAt: staffContact.updatedAt,
      createdBy: staffContact.createdBy,
      brandData: {
        id: brand.id,
        nameHe: brand.nameHe,
      },
    })
    .from(staffContact)
    .leftJoin(brand, eq(staffContact.brandId, brand.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(staffContact.name);

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    phone: row.phone,
    email: row.email,
    role: row.role,
    brandId: row.brandId,
    isActive: row.isActive,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    createdBy: row.createdBy,
    brand: row.brandData?.id ? { id: row.brandData.id, nameHe: row.brandData.nameHe } : null,
  }));
}

/**
 * Get a single staff contact by ID
 */
export async function getStaffContactById(
  id: string
): Promise<StaffContactWithBrand | null> {
  const rows = await database
    .select({
      id: staffContact.id,
      name: staffContact.name,
      phone: staffContact.phone,
      email: staffContact.email,
      role: staffContact.role,
      brandId: staffContact.brandId,
      isActive: staffContact.isActive,
      createdAt: staffContact.createdAt,
      updatedAt: staffContact.updatedAt,
      createdBy: staffContact.createdBy,
      brandData: {
        id: brand.id,
        nameHe: brand.nameHe,
      },
    })
    .from(staffContact)
    .leftJoin(brand, eq(staffContact.brandId, brand.id))
    .where(eq(staffContact.id, id));

  const row = rows[0];
  if (!row) return null;

  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    email: row.email,
    role: row.role,
    brandId: row.brandId,
    isActive: row.isActive,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    createdBy: row.createdBy,
    brand: row.brandData?.id ? { id: row.brandData.id, nameHe: row.brandData.nameHe } : null,
  };
}

/**
 * Create a new staff contact
 */
export async function createStaffContact(
  data: CreateStaffContactData
): Promise<StaffContact> {
  const [newContact] = await database
    .insert(staffContact)
    .values({
      ...data,
      id: data.id || crypto.randomUUID(),
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .returning();
  return newContact;
}

/**
 * Update a staff contact
 */
export async function updateStaffContact(
  id: string,
  data: UpdateStaffContactData
): Promise<StaffContact | null> {
  const [updated] = await database
    .update(staffContact)
    .set({
      ...data,
      updatedAt: new Date(),
    })
    .where(eq(staffContact.id, id))
    .returning();
  return updated || null;
}

/**
 * Delete a staff contact (hard delete)
 */
export async function deleteStaffContact(id: string): Promise<boolean> {
  const result = await database
    .delete(staffContact)
    .where(eq(staffContact.id, id));
  return (result.rowCount ?? 0) > 0;
}
