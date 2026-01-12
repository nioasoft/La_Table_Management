import { NextRequest, NextResponse } from "next/server";
import {
  requireAdminOrSuperUser,
  requireSuperUser,
  isAuthError,
} from "@/lib/api-middleware";
import {
  getManagementCompanyById,
  updateManagementCompany,
  deleteManagementCompany,
  isManagementCompanyCodeUnique,
  generateInvoiceNumber,
} from "@/data-access/managementCompanies";
import type { UpdateManagementCompanyData } from "@/db/schema";

interface RouteContext {
  params: Promise<{ managementCompanyId: string }>;
}

/**
 * GET /api/management-companies/[managementCompanyId] - Get a single management company
 */
export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const authResult = await requireAdminOrSuperUser(request);
    if (isAuthError(authResult)) return authResult;

    const { managementCompanyId } = await context.params;

    const managementCompany = await getManagementCompanyById(managementCompanyId);
    if (!managementCompany) {
      return NextResponse.json({ error: "Management company not found" }, { status: 404 });
    }

    return NextResponse.json({ managementCompany });
  } catch (error) {
    console.error("Error fetching management company:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/management-companies/[managementCompanyId] - Update management company details
 */
export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const authResult = await requireAdminOrSuperUser(request);
    if (isAuthError(authResult)) return authResult;

    const { managementCompanyId } = await context.params;
    const body = await request.json();

    // Check for special action: generate invoice number
    if (body.action === "generateInvoiceNumber") {
      const invoiceNumber = await generateInvoiceNumber(managementCompanyId);
      if (!invoiceNumber) {
        return NextResponse.json({ error: "Management company not found" }, { status: 404 });
      }
      return NextResponse.json({ invoiceNumber });
    }

    const {
      code,
      nameHe,
      nameEn,
      description,
      contactName,
      contactEmail,
      contactPhone,
      companyId,
      address,
      taxId,
      invoicePrefix,
      nextInvoiceNumber,
      bankName,
      bankBranch,
      bankAccountNumber,
      isActive,
    } = body;

    // Check if management company exists
    const existingCompany = await getManagementCompanyById(managementCompanyId);
    if (!existingCompany) {
      return NextResponse.json({ error: "Management company not found" }, { status: 404 });
    }

    // If code is being updated, check uniqueness
    if (code && code !== existingCompany.code) {
      const isUnique = await isManagementCompanyCodeUnique(code, managementCompanyId);
      if (!isUnique) {
        return NextResponse.json(
          { error: "Management company code already exists" },
          { status: 400 }
        );
      }
    }

    const updateData: UpdateManagementCompanyData = {};

    if (code !== undefined) updateData.code = code;
    if (nameHe !== undefined) updateData.nameHe = nameHe;
    if (nameEn !== undefined) updateData.nameEn = nameEn;
    if (description !== undefined) updateData.description = description;
    if (contactName !== undefined) updateData.contactName = contactName;
    if (contactEmail !== undefined) updateData.contactEmail = contactEmail;
    if (contactPhone !== undefined) updateData.contactPhone = contactPhone;
    if (companyId !== undefined) updateData.companyId = companyId;
    if (address !== undefined) updateData.address = address;
    if (taxId !== undefined) updateData.taxId = taxId;
    if (invoicePrefix !== undefined) updateData.invoicePrefix = invoicePrefix;
    if (nextInvoiceNumber !== undefined) updateData.nextInvoiceNumber = nextInvoiceNumber;
    if (bankName !== undefined) updateData.bankName = bankName;
    if (bankBranch !== undefined) updateData.bankBranch = bankBranch;
    if (bankAccountNumber !== undefined) updateData.bankAccountNumber = bankAccountNumber;
    if (isActive !== undefined) updateData.isActive = isActive;

    const updatedCompany = await updateManagementCompany(managementCompanyId, updateData);
    if (!updatedCompany) {
      return NextResponse.json({ error: "Management company not found" }, { status: 404 });
    }

    return NextResponse.json({ managementCompany: updatedCompany });
  } catch (error) {
    console.error("Error updating management company:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/management-companies/[managementCompanyId] - Delete a management company
 */
export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    // Only super_user can delete management companies
    const authResult = await requireSuperUser(request);
    if (isAuthError(authResult)) return authResult;

    const { managementCompanyId } = await context.params;

    const deleted = await deleteManagementCompany(managementCompanyId);
    if (!deleted) {
      return NextResponse.json({ error: "Management company not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting management company:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
