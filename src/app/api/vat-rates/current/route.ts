import { NextRequest, NextResponse } from "next/server";
import {
  requireAdminOrSuperUser,
  isAuthError,
} from "@/lib/api-middleware";
import {
  getCurrentVatRate,
  getVatRateForDate,
} from "@/data-access/vatRates";

/**
 * GET /api/vat-rates/current - Get the current VAT rate (Admin/Super User only)
 *
 * Query params:
 * - date: Optional date (YYYY-MM-DD) to get the rate for a specific date
 *
 * Response:
 * - rate: The VAT rate as a decimal (e.g., 0.18)
 * - ratePercent: The VAT rate as a percentage (e.g., 18)
 * - effectiveDate: The date this rate became effective (if date param provided, shows the rate's effective date)
 */
export async function GET(request: NextRequest) {
  try {
    const authResult = await requireAdminOrSuperUser(request);
    if (isAuthError(authResult)) return authResult;

    const searchParams = request.nextUrl.searchParams;
    const dateParam = searchParams.get("date");

    let rate: number;

    if (dateParam) {
      // Validate date format
      const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
      if (!dateRegex.test(dateParam)) {
        return NextResponse.json(
          { error: "Date must be in YYYY-MM-DD format" },
          { status: 400 }
        );
      }

      // Get rate for specific date
      const date = new Date(dateParam + "T00:00:00Z");
      rate = await getVatRateForDate(date);
    } else {
      // Get current rate
      rate = await getCurrentVatRate();
    }

    return NextResponse.json({
      rate,
      ratePercent: Math.round(rate * 10000) / 100, // Convert to percentage with 2 decimal places
      asOf: dateParam || new Date().toISOString().split("T")[0],
    });
  } catch (error) {
    console.error("Error fetching current VAT rate:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
