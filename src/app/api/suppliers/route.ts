import { NextRequest, NextResponse } from "next/server";
import {
  requireAdminOrSuperUser,
  isAuthError,
} from "@/lib/api-middleware";
import {
  getSuppliers,
  getActiveSuppliers,
  createSupplier,
  getSupplierStats,
  isSupplierCodeUnique,
  setSupplierBrands,
  getSupplierBrands,
  validateFileMapping,
} from "@/data-access/suppliers";
import { randomUUID } from "crypto";
import type { SupplierFileMapping, CommissionException } from "@/db/schema";

/**
 * GET /api/suppliers - Get all suppliers (Admin/Super User only)
 */
export async function GET(request: NextRequest) {
  try {
    const authResult = await requireAdminOrSuperUser(request);
    if (isAuthError(authResult)) return authResult;

    const searchParams = request.nextUrl.searchParams;
    const filter = searchParams.get("filter");

    let suppliers;
    if (filter === "active") {
      suppliers = await getActiveSuppliers();
    } else {
      suppliers = await getSuppliers();
    }

    // Fetch brands for each supplier
    const suppliersWithBrands = await Promise.all(
      suppliers.map(async (supplier) => {
        const brands = await getSupplierBrands(supplier.id);
        return {
          ...supplier,
          brands,
        };
      })
    );

    // Get stats if requested
    const includeStats = searchParams.get("stats") === "true";
    const stats = includeStats ? await getSupplierStats() : null;

    return NextResponse.json({ suppliers: suppliersWithBrands, stats });
  } catch (error) {
    console.error("Error fetching suppliers:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/suppliers - Create a new supplier (Admin/Super User only)
 */
export async function POST(request: NextRequest) {
  try {
    const authResult = await requireAdminOrSuperUser(request);
    if (isAuthError(authResult)) return authResult;
    const { user } = authResult;

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
      bkmvAliases,
    } = body;

    // Validate required fields
    if (!code || !name) {
      return NextResponse.json(
        { error: "Code and name are required" },
        { status: 400 }
      );
    }

    // Check if code is unique
    const isUnique = await isSupplierCodeUnique(code);
    if (!isUnique) {
      return NextResponse.json(
        { error: "Supplier code already exists" },
        { status: 400 }
      );
    }

    // Validate file mapping if provided
    let validatedFileMapping: SupplierFileMapping | null = null;
    if (fileMapping) {
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
      validatedFileMapping = fileMappingData;
    }

    // Validate commission exceptions if provided
    let validatedCommissionExceptions: CommissionException[] | null = null;
    if (commissionExceptions && Array.isArray(commissionExceptions)) {
      validatedCommissionExceptions = commissionExceptions
        .filter((e: CommissionException) => e.identifier && e.identifier.trim() !== "")
        .map((e: CommissionException) => ({
          identifier: e.identifier.trim(),
          rate: typeof e.rate === "number" ? e.rate : parseFloat(e.rate) || 0,
          matchType: e.matchType || "keyword",
          notes: e.notes || undefined,
        }));
    }

    // Validate bkmvAliases if provided
    const validatedBkmvAliases = Array.isArray(bkmvAliases)
      ? bkmvAliases.filter((a: string) => typeof a === "string" && a.trim() !== "").map((a: string) => a.trim())
      : null;

    const supplierId = randomUUID();
    const newSupplier = await createSupplier({
      id: supplierId,
      code,
      name,
      companyId: companyId || null,
      description: description || null,
      contactName: contactName || null,
      contactEmail: contactEmail || null,
      contactPhone: contactPhone || null,
      secondaryContactName: secondaryContactName || null,
      secondaryContactEmail: secondaryContactEmail || null,
      secondaryContactPhone: secondaryContactPhone || null,
      address: address || null,
      taxId: taxId || null,
      paymentTerms: paymentTerms || null,
      defaultCommissionRate: defaultCommissionRate || null,
      commissionType: commissionType || "percentage",
      settlementFrequency: settlementFrequency || "monthly",
      vatIncluded: vatIncluded !== undefined ? vatIncluded : false,
      fileMapping: validatedFileMapping,
      commissionExceptions: validatedCommissionExceptions,
      bkmvAliases: validatedBkmvAliases,
      isActive: isActive !== undefined ? isActive : true,
      createdBy: user.id,
    });

    // Set brand associations if provided
    if (brandIds && Array.isArray(brandIds) && brandIds.length > 0) {
      await setSupplierBrands(supplierId, brandIds);
    }

    // Fetch the brands for the response
    const brands = await getSupplierBrands(supplierId);

    return NextResponse.json(
      { supplier: { ...newSupplier, brands } },
      { status: 201 }
    );
  } catch (error) {
    console.error("Error creating supplier:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
