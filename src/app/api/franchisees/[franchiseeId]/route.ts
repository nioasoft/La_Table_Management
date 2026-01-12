import { NextRequest, NextResponse } from "next/server";
import {
  requireAdminOrSuperUser,
  requireSuperUser,
  isAuthError,
} from "@/lib/api-middleware";
import {
  getFranchiseeById,
  updateFranchisee,
  deleteFranchisee,
  isFranchiseeCodeUnique,
  type UpdateFranchiseeDataWithStatusChange,
} from "@/data-access/franchisees";
import { createAuditContext } from "@/data-access/auditLog";

interface RouteContext {
  params: Promise<{ franchiseeId: string }>;
}

/**
 * GET /api/franchisees/[franchiseeId] - Get a single franchisee
 */
export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const authResult = await requireAdminOrSuperUser(request);
    if (isAuthError(authResult)) return authResult;

    const { franchiseeId } = await context.params;

    const franchisee = await getFranchiseeById(franchiseeId);
    if (!franchisee) {
      return NextResponse.json(
        { error: "Franchisee not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({ franchisee });
  } catch (error) {
    console.error("Error fetching franchisee:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/franchisees/[franchiseeId] - Update franchisee details
 */
export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const authResult = await requireAdminOrSuperUser(request);
    if (isAuthError(authResult)) return authResult;
    const { user } = authResult;

    const { franchiseeId } = await context.params;
    const body = await request.json();
    const {
      brandId,
      name,
      code,
      aliases,
      companyId,
      address,
      city,
      state,
      postalCode,
      country,
      primaryContactName,
      primaryContactEmail,
      primaryContactPhone,
      owners,
      openingDate,
      leaseOption1End,
      leaseOption2End,
      leaseOption3End,
      franchiseAgreementEnd,
      status,
      notes,
      isActive,
      // Status change logging fields
      statusChangeReason,
      statusChangeNotes,
      statusEffectiveDate,
    } = body;

    // Check if franchisee exists
    const existingFranchisee = await getFranchiseeById(franchiseeId);
    if (!existingFranchisee) {
      return NextResponse.json(
        { error: "Franchisee not found" },
        { status: 404 }
      );
    }

    // If code is being updated, check uniqueness
    if (code && code !== existingFranchisee.code) {
      const isUnique = await isFranchiseeCodeUnique(code, franchiseeId);
      if (!isUnique) {
        return NextResponse.json(
          { error: "Franchisee code already exists" },
          { status: 400 }
        );
      }
    }

    // Validate owners array if provided
    if (owners && Array.isArray(owners)) {
      for (const owner of owners) {
        if (!owner.name) {
          return NextResponse.json(
            { error: "Each owner must have a name" },
            { status: 400 }
          );
        }
        if (
          owner.ownershipPercentage !== undefined &&
          (owner.ownershipPercentage < 0 || owner.ownershipPercentage > 100)
        ) {
          return NextResponse.json(
            { error: "Ownership percentage must be between 0 and 100" },
            { status: 400 }
          );
        }
      }
    }

    const updateData: UpdateFranchiseeDataWithStatusChange = {};

    if (brandId !== undefined) updateData.brandId = brandId;
    if (name !== undefined) updateData.name = name;
    if (code !== undefined) updateData.code = code;
    if (aliases !== undefined) updateData.aliases = aliases;
    if (companyId !== undefined) updateData.companyId = companyId;
    if (address !== undefined) updateData.address = address;
    if (city !== undefined) updateData.city = city;
    if (state !== undefined) updateData.state = state;
    if (postalCode !== undefined) updateData.postalCode = postalCode;
    if (country !== undefined) updateData.country = country;
    if (primaryContactName !== undefined)
      updateData.primaryContactName = primaryContactName;
    if (primaryContactEmail !== undefined)
      updateData.primaryContactEmail = primaryContactEmail;
    if (primaryContactPhone !== undefined)
      updateData.primaryContactPhone = primaryContactPhone;
    if (owners !== undefined) updateData.owners = owners;
    if (openingDate !== undefined) updateData.openingDate = openingDate;
    if (leaseOption1End !== undefined) updateData.leaseOption1End = leaseOption1End;
    if (leaseOption2End !== undefined) updateData.leaseOption2End = leaseOption2End;
    if (leaseOption3End !== undefined) updateData.leaseOption3End = leaseOption3End;
    if (franchiseAgreementEnd !== undefined)
      updateData.franchiseAgreementEnd = franchiseAgreementEnd;
    if (status !== undefined) updateData.status = status;
    if (notes !== undefined) updateData.notes = notes;
    if (isActive !== undefined) updateData.isActive = isActive;

    // Include status change logging fields if provided
    if (statusChangeReason !== undefined) updateData.statusChangeReason = statusChangeReason;
    if (statusChangeNotes !== undefined) updateData.statusChangeNotes = statusChangeNotes;
    if (statusEffectiveDate !== undefined) updateData.statusEffectiveDate = statusEffectiveDate;

    // Create audit context for logging
    const auditContext = createAuditContext({ user: { id: user.id, name: user.name, email: user.email } }, request);

    // Pass the current user's ID and audit context for audit logging
    const userId = user.id;
    const updatedFranchisee = await updateFranchisee(franchiseeId, updateData, userId, auditContext);
    if (!updatedFranchisee) {
      return NextResponse.json(
        { error: "Franchisee not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({ franchisee: updatedFranchisee });
  } catch (error) {
    console.error("Error updating franchisee:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/franchisees/[franchiseeId] - Delete a franchisee
 */
export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    // Only super_user can delete franchisees
    const authResult = await requireSuperUser(request);
    if (isAuthError(authResult)) return authResult;

    const { franchiseeId } = await context.params;

    const deleted = await deleteFranchisee(franchiseeId);
    if (!deleted) {
      return NextResponse.json(
        { error: "Franchisee not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting franchisee:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
