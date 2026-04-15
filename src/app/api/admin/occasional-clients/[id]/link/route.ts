import { NextRequest, NextResponse } from "next/server";
import { requireAdminOrSuperUser, isAuthError } from "@/lib/api-middleware";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { database } from "@/db";
import { client, occasionalClient } from "@/db/schema";
import { mergeOccasionalIntoClient } from "@/data-access/occasional-clients";

const linkSchema = z
  .object({
    clientId: z.string().min(1, "clientId נדרש"),
    addAlias: z.boolean().optional().default(true),
  })
  .strict();

/**
 * POST /api/admin/occasional-clients/[id]/link
 *
 * Body: { clientId, addAlias?: boolean (default true) }
 *
 * Manually link an occasional client to an existing client. The occasional
 * client is folded into the client (via mergeOccasionalIntoClient) and, by
 * default, its tabit_column_name is appended to the client's tabitColumnNames
 * so future Tabit uploads route directly to the client.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireAdminOrSuperUser(request);
  if (isAuthError(authResult)) return authResult;

  const { id } = await params;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON לא תקין" }, { status: 400 });
  }

  const parsed = linkSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "קלט לא חוקי", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { clientId, addAlias } = parsed.data;

  try {
    const [occRow] = await database
      .select()
      .from(occasionalClient)
      .where(eq(occasionalClient.id, id))
      .limit(1);
    if (!occRow) {
      return NextResponse.json(
        { error: "לקוח מזדמן לא נמצא" },
        { status: 404 }
      );
    }

    const [clientRow] = await database
      .select({
        id: client.id,
        tabitColumnNames: client.tabitColumnNames,
      })
      .from(client)
      .where(eq(client.id, clientId))
      .limit(1);
    if (!clientRow) {
      return NextResponse.json({ error: "לקוח לא נמצא" }, { status: 404 });
    }

    if (addAlias) {
      const existingAliases = (clientRow.tabitColumnNames ?? []) as string[];
      const trimmedNew = occRow.tabitColumnName.trim();
      const alreadyPresent = existingAliases.some(
        (a) => a.trim().toLowerCase() === trimmedNew.toLowerCase()
      );
      if (!alreadyPresent) {
        await database
          .update(client)
          .set({
            tabitColumnNames: [...existingAliases, trimmedNew],
          })
          .where(eq(client.id, clientId));
      }
    }

    const result = await mergeOccasionalIntoClient(id, clientId);
    return NextResponse.json({ data: result });
  } catch (error) {
    console.error("Failed to link occasional client:", error);
    return NextResponse.json(
      { error: "שגיאה בקישור לקוח מזדמן" },
      { status: 500 }
    );
  }
}
