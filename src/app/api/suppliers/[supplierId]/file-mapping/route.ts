import { NextRequest, NextResponse } from "next/server";
import {
  requireAdminOrSuperUser,
  isAuthError,
} from "@/lib/api-middleware";
import {
  getSupplierById,
  getSupplierFileMapping,
  updateSupplierFileMapping,
  validateFileMapping,
} from "@/data-access/suppliers";
import type { SupplierFileMapping } from "@/db/schema";

interface RouteContext {
  params: Promise<{ supplierId: string }>;
}

/**
 * GET /api/suppliers/[supplierId]/file-mapping - Get file mapping configuration for a supplier
 */
export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const authResult = await requireAdminOrSuperUser(request);
    if (isAuthError(authResult)) return authResult;

    const { supplierId } = await context.params;

    // Check if supplier exists
    const supplier = await getSupplierById(supplierId);
    if (!supplier) {
      return NextResponse.json({ error: "Supplier not found" }, { status: 404 });
    }

    const fileMapping = await getSupplierFileMapping(supplierId);

    return NextResponse.json({ fileMapping });
  } catch (error) {
    console.error("Error fetching file mapping:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/suppliers/[supplierId]/file-mapping - Update file mapping configuration for a supplier
 */
export async function PUT(request: NextRequest, context: RouteContext) {
  try {
    const authResult = await requireAdminOrSuperUser(request);
    if (isAuthError(authResult)) return authResult;

    const { supplierId } = await context.params;
    const body = await request.json();

    // Check if supplier exists
    const existingSupplier = await getSupplierById(supplierId);
    if (!existingSupplier) {
      return NextResponse.json({ error: "Supplier not found" }, { status: 404 });
    }

    // Extract and validate file mapping data
    const {
      fileType,
      columnMappings,
      headerRow,
      dataStartRow,
      rowsToSkip,
      skipKeywords,
    } = body;

    // Build the file mapping object
    const fileMapping: SupplierFileMapping = {
      fileType,
      columnMappings: {
        franchiseeColumn: columnMappings?.franchiseeColumn || "",
        amountColumn: columnMappings?.amountColumn || "",
        dateColumn: columnMappings?.dateColumn || "",
      },
      headerRow: Number(headerRow) || 1,
      dataStartRow: Number(dataStartRow) || 2,
      rowsToSkip: rowsToSkip !== undefined && rowsToSkip !== null ? Number(rowsToSkip) : undefined,
      skipKeywords: Array.isArray(skipKeywords) ? skipKeywords : [],
    };

    // Validate the file mapping
    const validationErrors = validateFileMapping(fileMapping);
    if (validationErrors.length > 0) {
      return NextResponse.json(
        { error: "Validation failed", details: validationErrors },
        { status: 400 }
      );
    }

    // Update the file mapping
    const updatedSupplier = await updateSupplierFileMapping(
      supplierId,
      fileMapping
    );

    if (!updatedSupplier) {
      return NextResponse.json({ error: "Supplier not found" }, { status: 404 });
    }

    return NextResponse.json({
      fileMapping: updatedSupplier.fileMapping,
      message: "File mapping configuration updated successfully",
    });
  } catch (error) {
    console.error("Error updating file mapping:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/suppliers/[supplierId]/file-mapping - Remove file mapping configuration for a supplier
 */
export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const authResult = await requireAdminOrSuperUser(request);
    if (isAuthError(authResult)) return authResult;

    const { supplierId } = await context.params;

    // Check if supplier exists
    const existingSupplier = await getSupplierById(supplierId);
    if (!existingSupplier) {
      return NextResponse.json({ error: "Supplier not found" }, { status: 404 });
    }

    // Clear the file mapping by setting it to null
    const updatedSupplier = await updateSupplierFileMapping(supplierId, null);

    if (!updatedSupplier) {
      return NextResponse.json({ error: "Supplier not found" }, { status: 404 });
    }

    return NextResponse.json({
      message: "File mapping configuration removed successfully",
    });
  } catch (error) {
    console.error("Error deleting file mapping:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
