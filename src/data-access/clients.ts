import { database } from "@/db";
import {
  client,
  clientFranchisee,
  franchisee,
  brand,
  type Client,
  type CreateClientData,
  type UpdateClientData,
} from "@/db/schema";
import { eq, and, inArray, sql } from "drizzle-orm";

export type ClientWithFranchisees = Client & {
  franchisees: {
    id: string;
    name: string;
    code: string;
    brandId: string | null;
  }[];
};

interface GetClientsOptions {
  isActive?: boolean;
}

/**
 * Get all clients with their associated franchisees
 */
export async function getClients(
  options: GetClientsOptions = {}
): Promise<ClientWithFranchisees[]> {
  const conditions = [];

  if (options.isActive !== undefined) {
    conditions.push(eq(client.isActive, options.isActive));
  }

  const clients = await database
    .select()
    .from(client)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(client.name);

  if (clients.length === 0) return [];

  // Batch-load franchisee associations
  const clientIds = clients.map((c) => c.id);
  const junctionRows = await database
    .select({
      clientId: clientFranchisee.clientId,
      franchiseeId: franchisee.id,
      franchiseeName: franchisee.name,
      franchiseeCode: franchisee.code,
      franchiseeBrandId: franchisee.brandId,
    })
    .from(clientFranchisee)
    .innerJoin(franchisee, eq(clientFranchisee.franchiseeId, franchisee.id))
    .where(inArray(clientFranchisee.clientId, clientIds));

  // Group franchisees by client
  const franchiseesByClient = new Map<
    string,
    { id: string; name: string; code: string; brandId: string | null }[]
  >();
  for (const row of junctionRows) {
    const list = franchiseesByClient.get(row.clientId) || [];
    list.push({
      id: row.franchiseeId,
      name: row.franchiseeName,
      code: row.franchiseeCode,
      brandId: row.franchiseeBrandId,
    });
    franchiseesByClient.set(row.clientId, list);
  }

  return clients.map((c) => ({
    ...c,
    franchisees: franchiseesByClient.get(c.id) || [],
  }));
}

/**
 * Get a single client by ID with franchisees
 */
export async function getClientById(
  id: string
): Promise<ClientWithFranchisees | null> {
  const [row] = await database
    .select()
    .from(client)
    .where(eq(client.id, id));

  if (!row) return null;

  const junctionRows = await database
    .select({
      franchiseeId: franchisee.id,
      franchiseeName: franchisee.name,
      franchiseeCode: franchisee.code,
      franchiseeBrandId: franchisee.brandId,
    })
    .from(clientFranchisee)
    .innerJoin(franchisee, eq(clientFranchisee.franchiseeId, franchisee.id))
    .where(eq(clientFranchisee.clientId, id));

  return {
    ...row,
    franchisees: junctionRows.map((j) => ({
      id: j.franchiseeId,
      name: j.franchiseeName,
      code: j.franchiseeCode,
      brandId: j.franchiseeBrandId,
    })),
  };
}

/**
 * Create a new client
 */
export async function createClient(data: CreateClientData): Promise<Client> {
  const [newClient] = await database
    .insert(client)
    .values({
      ...data,
      id: data.id || crypto.randomUUID(),
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .returning();
  return newClient;
}

/**
 * Update a client
 */
export async function updateClient(
  id: string,
  data: UpdateClientData
): Promise<Client | null> {
  const [updated] = await database
    .update(client)
    .set({
      ...data,
      updatedAt: new Date(),
    })
    .where(eq(client.id, id))
    .returning();
  return updated || null;
}

/**
 * Delete a client (hard delete - cascades to client_franchisee)
 */
export async function deleteClient(id: string): Promise<boolean> {
  const result = await database.delete(client).where(eq(client.id, id));
  return (result.rowCount ?? 0) > 0;
}

/**
 * Set franchisee associations for a client (replace all)
 */
export async function setClientFranchisees(
  clientId: string,
  franchiseeIds: string[]
): Promise<void> {
  // Delete existing associations
  await database
    .delete(clientFranchisee)
    .where(eq(clientFranchisee.clientId, clientId));

  // Insert new associations
  if (franchiseeIds.length > 0) {
    await database.insert(clientFranchisee).values(
      franchiseeIds.map((franchiseeId) => ({
        id: crypto.randomUUID(),
        clientId,
        franchiseeId,
        createdAt: new Date(),
      }))
    );
  }
}
