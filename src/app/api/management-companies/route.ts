import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/utils/auth";
import {
  getManagementCompanies,
  getActiveManagementCompanies,
  createManagementCompany,
  getManagementCompanyStats,
  isManagementCompanyCodeUnique,
  seedManagementCompanies,
} from "@/data-access/managementCompanies";
import { randomUUID } from "crypto";

/**
 * GET /api/management-companies - Get all management companies (Admin/Super User only)
 */
export async function GET(request: NextRequest) {
  try {
    const session = await auth.api.getSession({
      headers: request.headers,
    });

    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Check if user is admin or super_user
    const userRole = (session.user as typeof session.user & { role?: string })
      .role;
    if (userRole !== "super_user" && userRole !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const searchParams = request.nextUrl.searchParams;
    const filter = searchParams.get("filter");

    let managementCompanies;
    if (filter === "active") {
      managementCompanies = await getActiveManagementCompanies();
    } else {
      managementCompanies = await getManagementCompanies();
    }

    // Get stats if requested
    const includeStats = searchParams.get("stats") === "true";
    const stats = includeStats ? await getManagementCompanyStats() : null;

    return NextResponse.json({ managementCompanies, stats });
  } catch (error) {
    console.error("Error fetching management companies:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/management-companies - Create a new management company (Super User only)
 */
export async function POST(request: NextRequest) {
  try {
    const session = await auth.api.getSession({
      headers: request.headers,
    });

    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Only super_user can create management companies
    const userRole = (session.user as typeof session.user & { role?: string })
      .role;
    if (userRole !== "super_user") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await request.json();

    // Check if this is a seed request
    if (body.seed === true) {
      const seededCompanies = await seedManagementCompanies(session.user.id);
      return NextResponse.json({ managementCompanies: seededCompanies, seeded: true }, { status: 201 });
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
      bankName,
      bankBranch,
      bankAccountNumber,
      isActive,
    } = body;

    // Validate required fields
    if (!code || !nameHe) {
      return NextResponse.json(
        { error: "Code and Hebrew name are required" },
        { status: 400 }
      );
    }

    // Check if code is unique
    const isUnique = await isManagementCompanyCodeUnique(code);
    if (!isUnique) {
      return NextResponse.json(
        { error: "Management company code already exists" },
        { status: 400 }
      );
    }

    const newManagementCompany = await createManagementCompany({
      id: randomUUID(),
      code,
      nameHe,
      nameEn: nameEn || null,
      description: description || null,
      contactName: contactName || null,
      contactEmail: contactEmail || null,
      contactPhone: contactPhone || null,
      companyId: companyId || null,
      address: address || null,
      taxId: taxId || null,
      invoicePrefix: invoicePrefix || null,
      bankName: bankName || null,
      bankBranch: bankBranch || null,
      bankAccountNumber: bankAccountNumber || null,
      isActive: isActive !== undefined ? isActive : true,
      createdBy: session.user.id,
    });

    return NextResponse.json({ managementCompany: newManagementCompany }, { status: 201 });
  } catch (error) {
    console.error("Error creating management company:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
