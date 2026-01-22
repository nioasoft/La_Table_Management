import { NextRequest, NextResponse } from "next/server";
import {
  requireAdminOrSuperUser,
  isAuthError,
} from "@/lib/api-middleware";
import {
  getFranchiseeById,
  updateFranchisee,
} from "@/data-access/franchisees";
import { createAuditContext } from "@/data-access/auditLog";

interface RouteContext {
  params: Promise<{ franchiseeId: string }>;
}

/**
 * POST /api/franchisees/[franchiseeId]/aliases - Add an alias to a franchisee
 */
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const authResult = await requireAdminOrSuperUser(request);
    if (isAuthError(authResult)) return authResult;
    const { user } = authResult;

    const { franchiseeId } = await context.params;
    const body = await request.json();
    const { alias } = body;

    if (!alias || typeof alias !== "string" || !alias.trim()) {
      return NextResponse.json(
        { error: "Alias is required" },
        { status: 400 }
      );
    }

    const trimmedAlias = alias.trim();

    // Get existing franchisee
    const existingFranchisee = await getFranchiseeById(franchiseeId);
    if (!existingFranchisee) {
      return NextResponse.json(
        { error: "Franchisee not found" },
        { status: 404 }
      );
    }

    // Check if alias already exists
    const currentAliases = existingFranchisee.aliases || [];
    if (currentAliases.includes(trimmedAlias)) {
      return NextResponse.json(
        { error: "Alias already exists for this franchisee" },
        { status: 400 }
      );
    }

    // Add the new alias
    const updatedAliases = [...currentAliases, trimmedAlias];

    // Create audit context for logging
    const auditContext = createAuditContext(
      { user: { id: user.id, name: user.name, email: user.email } },
      request
    );

    const updatedFranchisee = await updateFranchisee(
      franchiseeId,
      { aliases: updatedAliases },
      user.id,
      auditContext
    );

    if (!updatedFranchisee) {
      return NextResponse.json(
        { error: "Failed to update franchisee" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      alias: trimmedAlias,
      franchisee: updatedFranchisee,
    });
  } catch (error) {
    console.error("Error adding alias:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/franchisees/[franchiseeId]/aliases - Remove an alias from a franchisee
 */
export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const authResult = await requireAdminOrSuperUser(request);
    if (isAuthError(authResult)) return authResult;
    const { user } = authResult;

    const { franchiseeId } = await context.params;
    const { searchParams } = new URL(request.url);
    const alias = searchParams.get("alias");

    if (!alias) {
      return NextResponse.json(
        { error: "Alias parameter is required" },
        { status: 400 }
      );
    }

    // Get existing franchisee
    const existingFranchisee = await getFranchiseeById(franchiseeId);
    if (!existingFranchisee) {
      return NextResponse.json(
        { error: "Franchisee not found" },
        { status: 404 }
      );
    }

    // Remove the alias
    const currentAliases = existingFranchisee.aliases || [];
    const updatedAliases = currentAliases.filter((a) => a !== alias);

    if (updatedAliases.length === currentAliases.length) {
      return NextResponse.json(
        { error: "Alias not found" },
        { status: 404 }
      );
    }

    // Create audit context for logging
    const auditContext = createAuditContext(
      { user: { id: user.id, name: user.name, email: user.email } },
      request
    );

    const updatedFranchisee = await updateFranchisee(
      franchiseeId,
      { aliases: updatedAliases },
      user.id,
      auditContext
    );

    if (!updatedFranchisee) {
      return NextResponse.json(
        { error: "Failed to update franchisee" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      franchisee: updatedFranchisee,
    });
  } catch (error) {
    console.error("Error removing alias:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
