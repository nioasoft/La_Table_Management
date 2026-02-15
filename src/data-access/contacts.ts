import { database } from "@/db";
import {
  contact,
  type Contact,
  type CreateContactData,
  type UpdateContactData,
} from "@/db/schema";
import { eq, and } from "drizzle-orm";

/**
 * Get all contacts for a franchisee
 */
export async function getContactsByFranchiseeId(
  franchiseeId: string
): Promise<Contact[]> {
  return database
    .select()
    .from(contact)
    .where(
      and(
        eq(contact.franchiseeId, franchiseeId),
        eq(contact.isActive, true)
      )
    );
}

/**
 * Get a single contact by ID
 */
export async function getContactById(id: string): Promise<Contact | null> {
  const [result] = await database
    .select()
    .from(contact)
    .where(eq(contact.id, id));
  return result || null;
}

/**
 * Create a new contact
 */
export async function createContact(
  data: CreateContactData
): Promise<Contact> {
  const [newContact] = await database
    .insert(contact)
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
 * Update a contact
 */
export async function updateContact(
  id: string,
  data: UpdateContactData
): Promise<Contact | null> {
  const [updated] = await database
    .update(contact)
    .set({
      ...data,
      updatedAt: new Date(),
    })
    .where(eq(contact.id, id))
    .returning();
  return updated || null;
}

/**
 * Delete a contact (hard delete)
 */
export async function deleteContact(id: string): Promise<boolean> {
  const result = await database
    .delete(contact)
    .where(eq(contact.id, id));
  return (result.rowCount ?? 0) > 0;
}
