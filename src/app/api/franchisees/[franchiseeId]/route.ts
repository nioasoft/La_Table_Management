import { NextRequest, NextResponse } from "next/server";
import {
  requireAdminOrSuperUser,
  requireSuperUser,
  isAuthError,
} from "@/lib/api-middleware";
import {
  getFranchiseeById,
  getFranchiseeByIdWithContacts,
  updateFranchisee,
  deleteFranchisee,
  isFranchiseeCodeUnique,
  findAliasCollisions,
  type UpdateFranchiseeDataWithStatusChange,
} from "@/data-access/franchisees";
import { createAuditContext } from "@/data-access/auditLog";
import { franchiseeRoyaltyPatchSchema } from "@/schemas/franchisee-royalty";
import { z } from "zod";

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

    const franchisee = await getFranchiseeByIdWithContacts(franchiseeId);
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
    const containsRoyaltyPatch = [
      "royaltyTiers",
      "royaltyTierBasis",
      "royaltyTiersConfirmed",
      "royaltyIncludeTips",
      "hashavshevetAccountKey",
      "marketingFeeRate",
    ].some((field) => field in body);
    const royaltyPatch = containsRoyaltyPatch
      ? franchiseeRoyaltyPatchSchema.parse({
          royaltyTiers: body.royaltyTiers,
          royaltyTierBasis: body.royaltyTierBasis,
          royaltyTiersConfirmed: body.royaltyTiersConfirmed,
          royaltyIncludeTips: body.royaltyIncludeTips,
          hashavshevetAccountKey: body.hashavshevetAccountKey,
          marketingFeeRate: body.marketingFeeRate,
        })
      : null;
    const {
      brandId,
      name,
      code,
      aliases,
      address,
      city,
      state,
      postalCode,
      country,
      openingDate,
      leaseOption1End,
      leaseOption2End,
      leaseOption3End,
      franchiseAgreementEnd,
      status,
      notes,
      hashavshevetItemKey,
      hashavshevetRevenueAccount,
      isActive,
      isKosher,
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

    const updateData: UpdateFranchiseeDataWithStatusChange = {};

    if (brandId !== undefined) updateData.brandId = brandId;
    if (name !== undefined) updateData.name = name;
    if (code !== undefined) {
      updateData.code = code;
      updateData.companyId = /^\d+$/.test(code) ? code : null;
    }
    if (aliases !== undefined) {
      // Reject aliases already registered to another franchisee — a shared
      // alias makes the matcher route that name to the wrong franchisee.
      if (Array.isArray(aliases) && aliases.length > 0) {
        const collisions = await findAliasCollisions(aliases, franchiseeId);
        if (collisions.length > 0) {
          const detail = collisions
            .map((c) => `"${c.alias}" (רשום אצל ${c.ownerName})`)
            .join(", ");
          return NextResponse.json(
            {
              error: `כינוי יכול להיות רשום רק אצל זכיין אחד. הכינויים הבאים כבר תפוסים: ${detail}`,
              collisions,
            },
            { status: 409 }
          );
        }
      }
      // Dedup within the list itself
      updateData.aliases = Array.isArray(aliases) ? [...new Set(aliases)] : aliases;
    }
    if (address !== undefined) updateData.address = address;
    if (city !== undefined) updateData.city = city;
    if (state !== undefined) updateData.state = state;
    if (postalCode !== undefined) updateData.postalCode = postalCode;
    if (country !== undefined) updateData.country = country;
    if (openingDate !== undefined) updateData.openingDate = openingDate;
    if (leaseOption1End !== undefined) updateData.leaseOption1End = leaseOption1End;
    if (leaseOption2End !== undefined) updateData.leaseOption2End = leaseOption2End;
    if (leaseOption3End !== undefined) updateData.leaseOption3End = leaseOption3End;
    if (franchiseAgreementEnd !== undefined)
      updateData.franchiseAgreementEnd = franchiseAgreementEnd;
    if (status !== undefined) {
      updateData.status = status;
      // Auto-sync isActive when status changes (unless isActive was explicitly provided)
      if (isActive === undefined) {
        updateData.isActive = status === "active";
      }
    }
    if (notes !== undefined) updateData.notes = notes;
    if (hashavshevetItemKey !== undefined) updateData.hashavshevetItemKey = hashavshevetItemKey;
    if (hashavshevetRevenueAccount !== undefined) {
      updateData.hashavshevetRevenueAccount =
        hashavshevetRevenueAccount === "" ? null : hashavshevetRevenueAccount;
    }
    if (isActive !== undefined) updateData.isActive = isActive;
    if (isKosher !== undefined) updateData.isKosher = isKosher;
    if (royaltyPatch) {
      updateData.royaltyTiers = royaltyPatch.royaltyTiers;
      updateData.royaltyTierBasis = royaltyPatch.royaltyTierBasis;
      updateData.royaltyTiersConfirmed = royaltyPatch.royaltyTiersConfirmed;
      updateData.royaltyIncludeTips = royaltyPatch.royaltyIncludeTips;
      updateData.hashavshevetAccountKey =
        royaltyPatch.hashavshevetAccountKey;
      updateData.marketingFeeRate =
        royaltyPatch.marketingFeeRate.toString();
    }

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
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          error: "נתוני התמלוגים אינם תקינים. יש לבדוק את המדרגות ולנסות שוב.",
          issues: error.issues.map((issue) => ({
            path: issue.path,
            message: issue.message,
          })),
        },
        { status: 400 }
      );
    }
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
