import { database } from "@/db";
import {
  managementCompany,
  type ManagementCompany,
  type CreateManagementCompanyData,
  type UpdateManagementCompanyData,
} from "@/db/schema";
import { eq, desc } from "drizzle-orm";

/**
 * Get all management companies from the database
 */
export async function getManagementCompanies(): Promise<ManagementCompany[]> {
  return database
    .select()
    .from(managementCompany)
    .orderBy(desc(managementCompany.createdAt)) as unknown as Promise<ManagementCompany[]>;
}

/**
 * Get all active management companies
 */
export async function getActiveManagementCompanies(): Promise<ManagementCompany[]> {
  return database
    .select()
    .from(managementCompany)
    .where(eq(managementCompany.isActive, true))
    .orderBy(desc(managementCompany.createdAt)) as unknown as Promise<ManagementCompany[]>;
}

/**
 * Get a single management company by ID
 */
export async function getManagementCompanyById(
  id: string
): Promise<ManagementCompany | null> {
  const results = (await database
    .select()
    .from(managementCompany)
    .where(eq(managementCompany.id, id))
    .limit(1)) as unknown as ManagementCompany[];
  return results[0] || null;
}

/**
 * Get a single management company by code
 */
export async function getManagementCompanyByCode(
  code: string
): Promise<ManagementCompany | null> {
  const results = (await database
    .select()
    .from(managementCompany)
    .where(eq(managementCompany.code, code))
    .limit(1)) as unknown as ManagementCompany[];
  return results[0] || null;
}

/**
 * Create a new management company
 */
export async function createManagementCompany(
  data: CreateManagementCompanyData
): Promise<ManagementCompany> {
  const [newCompany] = (await database
    .insert(managementCompany)
    .values(data)
    .returning()) as unknown as ManagementCompany[];
  return newCompany;
}

/**
 * Update an existing management company
 */
export async function updateManagementCompany(
  id: string,
  data: UpdateManagementCompanyData
): Promise<ManagementCompany | null> {
  const results = (await database
    .update(managementCompany)
    .set({
      ...data,
      updatedAt: new Date(),
    })
    .where(eq(managementCompany.id, id))
    .returning()) as unknown as ManagementCompany[];
  return results[0] || null;
}

/**
 * Delete a management company
 */
export async function deleteManagementCompany(id: string): Promise<boolean> {
  const result = await database
    .delete(managementCompany)
    .where(eq(managementCompany.id, id));
  return (result.rowCount ?? 0) > 0;
}

/**
 * Toggle management company active status
 */
export async function toggleManagementCompanyStatus(
  id: string
): Promise<ManagementCompany | null> {
  const existingCompany = await getManagementCompanyById(id);
  if (!existingCompany) return null;

  const results = (await database
    .update(managementCompany)
    .set({
      isActive: !existingCompany.isActive,
      updatedAt: new Date(),
    })
    .where(eq(managementCompany.id, id))
    .returning()) as unknown as ManagementCompany[];
  return results[0] || null;
}

/**
 * Check if a management company code is unique
 */
export async function isManagementCompanyCodeUnique(
  code: string,
  excludeId?: string
): Promise<boolean> {
  const existingCompany = await getManagementCompanyByCode(code);
  if (!existingCompany) return true;
  if (excludeId && existingCompany.id === excludeId) return true;
  return false;
}

/**
 * Get management company statistics
 */
export async function getManagementCompanyStats(): Promise<{
  total: number;
  active: number;
  inactive: number;
}> {
  const allCompanies = await getManagementCompanies();

  const stats = {
    total: allCompanies.length,
    active: 0,
    inactive: 0,
  };

  for (const company of allCompanies) {
    if (company.isActive) {
      stats.active++;
    } else {
      stats.inactive++;
    }
  }

  return stats;
}

/**
 * Get the next invoice number for a management company and increment it
 */
export async function getNextInvoiceNumber(
  id: string
): Promise<{ invoiceNumber: number; prefix: string | null } | null> {
  const company = await getManagementCompanyById(id);
  if (!company) return null;

  const currentNumber = company.nextInvoiceNumber;

  // Increment the next invoice number
  await database
    .update(managementCompany)
    .set({
      nextInvoiceNumber: currentNumber + 1,
      updatedAt: new Date(),
    })
    .where(eq(managementCompany.id, id));

  return {
    invoiceNumber: currentNumber,
    prefix: company.invoicePrefix,
  };
}

/**
 * Generate a formatted invoice number for a management company
 */
export async function generateInvoiceNumber(id: string): Promise<string | null> {
  const result = await getNextInvoiceNumber(id);
  if (!result) return null;

  const { invoiceNumber, prefix } = result;
  const paddedNumber = invoiceNumber.toString().padStart(6, "0");

  return prefix ? `${prefix}${paddedNumber}` : paddedNumber;
}

/**
 * Seed the initial 3 management companies (פנקון, פדווילי, ונתמי)
 * This should be called during initial database setup
 */
export async function seedManagementCompanies(
  createdBy?: string
): Promise<ManagementCompany[]> {
  const initialCompanies: Omit<CreateManagementCompanyData, "createdAt" | "updatedAt">[] = [
    {
      id: "mc_panikon",
      code: "PANIKON",
      nameHe: "פנקון",
      nameEn: "Panikon",
      description: "חברת ניהול פנקון",
      invoicePrefix: "PNK-",
      isActive: true,
      createdBy,
    },
    {
      id: "mc_pedvili",
      code: "PEDVILI",
      nameHe: "פדווילי",
      nameEn: "Pedvili",
      description: "חברת ניהול פדווילי",
      invoicePrefix: "PDV-",
      isActive: true,
      createdBy,
    },
    {
      id: "mc_ventami",
      code: "VENTAMI",
      nameHe: "ונתמי",
      nameEn: "Ventami",
      description: "חברת ניהול ונתמי",
      invoicePrefix: "VNT-",
      isActive: true,
      createdBy,
    },
  ];

  const seededCompanies: ManagementCompany[] = [];

  for (const companyData of initialCompanies) {
    // Check if company already exists
    const existing = await getManagementCompanyByCode(companyData.code);
    if (!existing) {
      const newCompany = await createManagementCompany(companyData);
      seededCompanies.push(newCompany);
    } else {
      seededCompanies.push(existing);
    }
  }

  return seededCompanies;
}
