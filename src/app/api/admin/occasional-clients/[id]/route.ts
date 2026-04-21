import { NextRequest, NextResponse } from "next/server";
import { requireAdminOrSuperUser, isAuthError } from "@/lib/api-middleware";
import {
  deleteOccasionalClient,
  updateOccasionalClient,
} from "@/data-access/occasional-clients";
import { z } from "zod";

const patchSchema = z
  .object({
    hashavshevetName: z.string().trim().nullable().optional(),
    ignored: z.boolean().optional(),
    notes: z.string().nullable().optional(),
  })
  .strict();

export async function PATCH(
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

  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "קלט לא חוקי", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const patch = parsed.data;
  // Normalize empty strings to null so hashavshevetName="" clears the mapping
  const normalized = {
    ...patch,
    hashavshevetName:
      patch.hashavshevetName === "" ? null : patch.hashavshevetName,
    notes: patch.notes === "" ? null : patch.notes,
  };

  try {
    const updated = await updateOccasionalClient(id, normalized);
    if (!updated) {
      return NextResponse.json(
        { error: "לקוח מזדמן לא נמצא" },
        { status: 404 }
      );
    }
    return NextResponse.json({ data: updated });
  } catch (error) {
    console.error("Failed to update occasional client:", error);
    return NextResponse.json(
      { error: "שגיאה בעדכון לקוח מזדמן" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireAdminOrSuperUser(request);
  if (isAuthError(authResult)) return authResult;

  const { id } = await params;

  try {
    const result = await deleteOccasionalClient(id);
    if (!result) {
      return NextResponse.json(
        { error: "לקוח מזדמן לא נמצא" },
        { status: 404 }
      );
    }
    return NextResponse.json({ data: result });
  } catch (error) {
    console.error("Failed to delete occasional client:", error);
    return NextResponse.json(
      { error: "שגיאה במחיקת לקוח מזדמן" },
      { status: 500 }
    );
  }
}
