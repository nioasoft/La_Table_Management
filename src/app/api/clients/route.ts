import { NextRequest, NextResponse } from "next/server";
import {
  requireAdminOrSuperUser,
  isAuthError,
} from "@/lib/api-middleware";
import {
  getClients,
  createClient,
  setClientFranchisees,
} from "@/data-access/clients";
import { randomUUID } from "crypto";

/**
 * GET /api/clients - List clients with optional filters
 *
 * Query params:
 * - active: "true" | "false" to filter by active status
 */
export async function GET(request: NextRequest) {
  try {
    const authResult = await requireAdminOrSuperUser(request);
    if (isAuthError(authResult)) return authResult;

    const searchParams = request.nextUrl.searchParams;
    const activeParam = searchParams.get("active");

    const options: { isActive?: boolean } = {};
    if (activeParam === "true") options.isActive = true;
    if (activeParam === "false") options.isActive = false;

    const clients = await getClients(options);

    return NextResponse.json({ clients });
  } catch (error) {
    console.error("Error fetching clients:", error);
    return NextResponse.json(
      { error: "שגיאה בטעינת לקוחות" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/clients - Create a new client
 */
export async function POST(request: NextRequest) {
  try {
    const authResult = await requireAdminOrSuperUser(request);
    if (isAuthError(authResult)) return authResult;
    const { user } = authResult;

    const body = await request.json();
    const {
      name,
      companyId,
      email,
      contactName,
      hashavshevetName,
      tabitColumnNames,
      posTerminalCommission,
      dineInCommission,
      deliveryCommission,
      takeawayCommission,
      eventsCommission,
      additionalBenefits,
      invoiceGeneration,
      journalEntryGeneration,
      notes,
      franchiseeIds,
    } = body;

    if (!name) {
      return NextResponse.json(
        { error: "שם לקוח הוא שדה חובה" },
        { status: 400 }
      );
    }

    const clientId = randomUUID();
    const newClient = await createClient({
      id: clientId,
      name,
      companyId: companyId || null,
      email: email || null,
      contactName: contactName || null,
      hashavshevetName: hashavshevetName || null,
      tabitColumnNames: Array.isArray(tabitColumnNames) ? tabitColumnNames : null,
      posTerminalCommission: posTerminalCommission || null,
      dineInCommission: dineInCommission || null,
      deliveryCommission: deliveryCommission || null,
      takeawayCommission: takeawayCommission || null,
      eventsCommission: eventsCommission || null,
      additionalBenefits: additionalBenefits || null,
      invoiceGeneration: invoiceGeneration ?? false,
      journalEntryGeneration: journalEntryGeneration ?? false,
      notes: notes || null,
      createdBy: user.id,
    });

    if (franchiseeIds && franchiseeIds.length > 0) {
      await setClientFranchisees(clientId, franchiseeIds);
    }

    return NextResponse.json({ client: newClient }, { status: 201 });
  } catch (error) {
    console.error("Error creating client:", error);
    return NextResponse.json(
      { error: "שגיאה ביצירת לקוח" },
      { status: 500 }
    );
  }
}
