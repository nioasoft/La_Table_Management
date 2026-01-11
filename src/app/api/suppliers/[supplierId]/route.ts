import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/utils/auth";
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
    const session = await auth.api.getSession({
      headers: request.headers,
    });

    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userRole = (session.user as typeof session.user & { role?: string })
      .role;

    // Only admins and super users can view supplier details
    if (userRole !== "super_user" && userRole !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

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
    const session = await auth.api.getSession({
      headers: request.headers,
    });

    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userRole = (session.user as typeof session.user & { role?: string })
      .role;

    // Only admins and super users can update suppliers
    if (userRole !== "super_user" && userRole !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

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
      isActive,
      brandIds,
      fileMapping,
      commissionExceptions,
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

    // Add commission change logging fields
    if (commissionChangeReason !== undefined)
      updateData.commissionChangeReason = commissionChangeReason;
    if (commissionChangeNotes !== undefined)
      updateData.commissionChangeNotes = commissionChangeNotes;
    if (commissionEffectiveDate !== undefined)
      updateData.commissionEffectiveDate = commissionEffectiveDate;

    // Create audit context for logging
    const auditContext = createAuditContext(session, request);

    // Pass the user ID and audit context to log who made the commission change
    const updatedSupplier = await updateSupplier(
      supplierId,
      updateData,
      session.user.id,
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
    const session = await auth.api.getSession({
      headers: request.headers,
    });

    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userRole = (session.user as typeof session.user & { role?: string })
      .role;

    // Only super_user can delete suppliers
    if (userRole !== "super_user") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

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
