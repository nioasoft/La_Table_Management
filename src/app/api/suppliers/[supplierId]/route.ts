import { NextRequest, NextResponse } from "next/server";
import {
  requireAdminOrSuperUser,
  requireRole,
  isAuthError,
} from "@/lib/api-middleware";
import {
  getSupplierById,
  updateSupplier,
  deleteSupplier,
  isSupplierCodeUnique,
  setSupplierBrands,
  getSupplierBrands,
  getSupplierCommissionHistory,
  validateFileMapping,
} from "@/data-access/suppliers";
import { createAuditContext } from "@/data-access/auditLog";
import type { UpdateSupplierDataWithCommissionChange } from "@/data-access/suppliers";
import type { SupplierFileMapping, CommissionException } from "@/db/schema";

interface RouteContext {
  params: Promise<{ supplierId: string }>;
}

/**
 * GET /api/suppliers/[supplierId] - Get a single supplier
 */
export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const authResult = await requireAdminOrSuperUser(request);
    if (isAuthError(authResult)) return authResult;

    const { supplierId } = await context.params;

    const supplier = await getSupplierById(supplierId);
    if (!supplier) {
      return NextResponse.json({ error: "Supplier not found" }, { status: 404 });
    }

    // Fetch associated brands
    const brands = await getSupplierBrands(supplierId);

    // Check if commission history is requested
    const searchParams = request.nextUrl.searchParams;
    const includeHistory = searchParams.get("includeHistory") === "true";
    const commissionHistory = includeHistory
      ? await getSupplierCommissionHistory(supplierId)
      : undefined;

    return NextResponse.json({
      supplier: { ...supplier, brands, commissionHistory },
    });
  } catch (error) {
    console.error("Error fetching supplier:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/suppliers/[supplierId] - Update supplier details
 */
export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const authResult = await requireAdminOrSuperUser(request);
    if (isAuthError(authResult)) return authResult;
    const { user } = authResult;

    const { supplierId } = await context.params;
    const body = await request.json();
    const {
      code,
      name,
      companyId,
      description,
      contactName,
      contactEmail,
      contactPhone,
      secondaryContactName,
      secondaryContactEmail,
      secondaryContactPhone,
      address,
      taxId,
      paymentTerms,
      defaultCommissionRate,
      commissionType,
      settlementFrequency,
      vatIncluded,
      vatExempt,
      isActive,
      brandIds,
      fileMapping,
      commissionExceptions,
      bkmvAliases,
      hashavshevetCode,
      // Commission change logging fields
      commissionChangeReason,
      commissionChangeNotes,
      commissionEffectiveDate,
    } = body;

    // Check if supplier exists
    const existingSupplier = await getSupplierById(supplierId);
    if (!existingSupplier) {
      return NextResponse.json({ error: "Supplier not found" }, { status: 404 });
    }

    // If code is being updated, check uniqueness
    if (code && code !== existingSupplier.code) {
      const isUnique = await isSupplierCodeUnique(code, supplierId);
      if (!isUnique) {
        return NextResponse.json(
          { error: "Supplier code already exists" },
          { status: 400 }
        );
      }
    }

    const updateData: UpdateSupplierDataWithCommissionChange = {};

    if (code !== undefined) updateData.code = code;
    if (name !== undefined) updateData.name = name;
    if (companyId !== undefined) updateData.companyId = companyId;
    if (description !== undefined) updateData.description = description;
    if (contactName !== undefined) updateData.contactName = contactName;
    if (contactEmail !== undefined) updateData.contactEmail = contactEmail;
    if (contactPhone !== undefined) updateData.contactPhone = contactPhone;
    if (secondaryContactName !== undefined)
      updateData.secondaryContactName = secondaryContactName;
    if (secondaryContactEmail !== undefined)
      updateData.secondaryContactEmail = secondaryContactEmail;
    if (secondaryContactPhone !== undefined)
      updateData.secondaryContactPhone = secondaryContactPhone;
    if (address !== undefined) updateData.address = address;
    if (taxId !== undefined) updateData.taxId = taxId;
    if (paymentTerms !== undefined) updateData.paymentTerms = paymentTerms;
    if (defaultCommissionRate !== undefined)
      updateData.defaultCommissionRate = defaultCommissionRate;
    if (commissionType !== undefined) updateData.commissionType = commissionType;
    if (settlementFrequency !== undefined)
      updateData.settlementFrequency = settlementFrequency;
    if (vatIncluded !== undefined) updateData.vatIncluded = vatIncluded;
    if (vatExempt !== undefined) updateData.vatExempt = vatExempt;
    if (isActive !== undefined) updateData.isActive = isActive;

    // Handle file mapping update
    if (fileMapping !== undefined) {
      if (fileMapping === null) {
        // Allow clearing file mapping
        updateData.fileMapping = null;
      } else {
        // Validate and set file mapping
        const fileMappingData: SupplierFileMapping = {
          fileType: fileMapping.fileType,
          columnMappings: {
            franchiseeColumn: fileMapping.columnMappings?.franchiseeColumn || "",
            amountColumn: fileMapping.columnMappings?.amountColumn || "",
            dateColumn: fileMapping.columnMappings?.dateColumn || "",
          },
          headerRow: Number(fileMapping.headerRow) || 1,
          dataStartRow: Number(fileMapping.dataStartRow) || 2,
          rowsToSkip: fileMapping.rowsToSkip !== undefined && fileMapping.rowsToSkip !== null
            ? Number(fileMapping.rowsToSkip)
            : undefined,
          skipKeywords: Array.isArray(fileMapping.skipKeywords) ? fileMapping.skipKeywords : [],
        };

        const validationErrors = validateFileMapping(fileMappingData);
        if (validationErrors.length > 0) {
          return NextResponse.json(
            { error: "File mapping validation failed", details: validationErrors },
            { status: 400 }
          );
        }
        updateData.fileMapping = fileMappingData;
      }
    }

    // Handle commission exceptions update
    if (commissionExceptions !== undefined) {
      if (commissionExceptions === null || (Array.isArray(commissionExceptions) && commissionExceptions.length === 0)) {
        // Clear commission exceptions
        updateData.commissionExceptions = null;
      } else if (Array.isArray(commissionExceptions)) {
        // Validate and set commission exceptions
        const validatedExceptions: CommissionException[] = commissionExceptions
          .filter((e: CommissionException) => e.identifier && e.identifier.trim() !== "")
          .map((e: CommissionException) => ({
            identifier: e.identifier.trim(),
            rate: typeof e.rate === "number" ? e.rate : parseFloat(String(e.rate)) || 0,
            matchType: e.matchType || "keyword",
            notes: e.notes || undefined,
          }));
        updateData.commissionExceptions = validatedExceptions.length > 0 ? validatedExceptions : null;
      }
    }

    // Handle BKMV aliases update
    if (bkmvAliases !== undefined) {
      if (bkmvAliases === null || (Array.isArray(bkmvAliases) && bkmvAliases.length === 0)) {
        // Clear BKMV aliases
        updateData.bkmvAliases = null;
      } else if (Array.isArray(bkmvAliases)) {
        // Validate and set BKMV aliases
        const validatedAliases = bkmvAliases
          .filter((a: string) => typeof a === "string" && a.trim() !== "")
          .map((a: string) => a.trim());
        updateData.bkmvAliases = validatedAliases.length > 0 ? validatedAliases : null;
      }
    }

    // Handle Hashavshevet code update
    if (hashavshevetCode !== undefined) {
      updateData.hashavshevetCode = hashavshevetCode?.trim() || null;
    }

    // Add commission change logging fields
    if (commissionChangeReason !== undefined)
      updateData.commissionChangeReason = commissionChangeReason;
    if (commissionChangeNotes !== undefined)
      updateData.commissionChangeNotes = commissionChangeNotes;
    if (commissionEffectiveDate !== undefined)
      updateData.commissionEffectiveDate = commissionEffectiveDate;

    // Create audit context for logging
    const auditContext = createAuditContext(
      { user: { id: user.id, name: user.name, email: user.email } },
      request
    );

    // Pass the user ID and audit context to log who made the commission change
    const updatedSupplier = await updateSupplier(
      supplierId,
      updateData,
      user.id,
      auditContext
    );
    if (!updatedSupplier) {
      return NextResponse.json({ error: "Supplier not found" }, { status: 404 });
    }

    // Update brand associations if provided
    if (brandIds !== undefined && Array.isArray(brandIds)) {
      await setSupplierBrands(supplierId, brandIds);
    }

    // Fetch updated brands
    const brands = await getSupplierBrands(supplierId);

    return NextResponse.json({ supplier: { ...updatedSupplier, brands } });
  } catch (error) {
    console.error("Error updating supplier:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/suppliers/[supplierId] - Delete a supplier
 */
export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const authResult = await requireRole(request, ["super_user"]);
    if (isAuthError(authResult)) return authResult;

    const { supplierId } = await context.params;

    const deleted = await deleteSupplier(supplierId);
    if (!deleted) {
      return NextResponse.json({ error: "Supplier not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting supplier:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
