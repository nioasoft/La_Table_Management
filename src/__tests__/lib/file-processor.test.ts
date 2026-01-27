import { describe, it, expect } from "vitest";
import {
  calculateNetFromGross,
  calculateGrossFromNet,
  roundToTwoDecimals,
  ISRAEL_VAT_RATE,
} from "@/lib/file-processor";

// ============================================================================
// VAT Calculation Tests
// ============================================================================

describe("calculateNetFromGross", () => {
  it("calculates net amount using default VAT rate", () => {
    // With 18% VAT: Net = Gross / 1.18
    const gross = 118;
    const result = calculateNetFromGross(gross);
    expect(result).toBeCloseTo(100, 2);
  });

  it("calculates net amount with custom VAT rate", () => {
    // With 10% VAT: Net = Gross / 1.10
    const gross = 110;
    const result = calculateNetFromGross(gross, 0.1);
    expect(result).toBeCloseTo(100, 2);
  });

  it("returns 0 for gross of 0", () => {
    const result = calculateNetFromGross(0);
    expect(result).toBe(0);
  });

  it("handles negative amounts", () => {
    const gross = -118;
    const result = calculateNetFromGross(gross);
    expect(result).toBeCloseTo(-100, 2);
  });

  it("handles small amounts with precision", () => {
    const gross = 11.8;
    const result = calculateNetFromGross(gross);
    expect(result).toBeCloseTo(10, 2);
  });

  it("handles large amounts", () => {
    const gross = 1180000;
    const result = calculateNetFromGross(gross);
    expect(result).toBeCloseTo(1000000, 0);
  });

  it("uses Israel VAT rate of 18%", () => {
    expect(ISRAEL_VAT_RATE).toBe(0.18);
  });
});

describe("calculateGrossFromNet", () => {
  it("calculates gross amount using default VAT rate", () => {
    // With 18% VAT: Gross = Net * 1.18
    const net = 100;
    const result = calculateGrossFromNet(net);
    expect(result).toBeCloseTo(118, 2);
  });

  it("calculates gross amount with custom VAT rate", () => {
    // With 10% VAT: Gross = Net * 1.10
    const net = 100;
    const result = calculateGrossFromNet(net, 0.1);
    expect(result).toBeCloseTo(110, 2);
  });

  it("returns 0 for net of 0", () => {
    const result = calculateGrossFromNet(0);
    expect(result).toBe(0);
  });

  it("handles negative amounts", () => {
    const net = -100;
    const result = calculateGrossFromNet(net);
    expect(result).toBeCloseTo(-118, 2);
  });

  it("handles small amounts", () => {
    const net = 10;
    const result = calculateGrossFromNet(net);
    expect(result).toBeCloseTo(11.8, 2);
  });

  it("handles large amounts", () => {
    const net = 1000000;
    const result = calculateGrossFromNet(net);
    expect(result).toBeCloseTo(1180000, 0);
  });
});

describe("VAT round-trip conversion", () => {
  it("gross -> net -> gross should return original value", () => {
    const original = 1000;
    const net = calculateNetFromGross(original);
    const backToGross = calculateGrossFromNet(net);
    expect(backToGross).toBeCloseTo(original, 10);
  });

  it("net -> gross -> net should return original value", () => {
    const original = 1000;
    const gross = calculateGrossFromNet(original);
    const backToNet = calculateNetFromGross(gross);
    expect(backToNet).toBeCloseTo(original, 10);
  });
});

// ============================================================================
// Rounding Tests
// ============================================================================

describe("roundToTwoDecimals", () => {
  it("rounds to exactly 2 decimal places", () => {
    expect(roundToTwoDecimals(10.12345)).toBe(10.12);
    expect(roundToTwoDecimals(10.129)).toBe(10.13);
  });

  it("handles values with fewer decimal places", () => {
    expect(roundToTwoDecimals(10)).toBe(10);
    expect(roundToTwoDecimals(10.1)).toBe(10.1);
  });

  it("rounds 0.5 up (standard rounding)", () => {
    expect(roundToTwoDecimals(10.125)).toBe(10.13);
    expect(roundToTwoDecimals(10.115)).toBe(10.12);
  });

  it("handles zero", () => {
    expect(roundToTwoDecimals(0)).toBe(0);
  });

  it("handles negative numbers", () => {
    expect(roundToTwoDecimals(-10.12345)).toBe(-10.12);
    expect(roundToTwoDecimals(-10.129)).toBe(-10.13);
  });

  it("handles very small numbers", () => {
    expect(roundToTwoDecimals(0.001)).toBe(0);
    expect(roundToTwoDecimals(0.005)).toBe(0.01);
    expect(roundToTwoDecimals(0.009)).toBe(0.01);
  });

  it("handles very large numbers", () => {
    expect(roundToTwoDecimals(1000000.12345)).toBe(1000000.12);
  });

  it("preserves precision for financial calculations", () => {
    // Test typical commission calculations
    const netAmount = 847.46;
    const commissionRate = 0.025; // 2.5%
    const rawCommission = netAmount * commissionRate; // 21.1865
    expect(roundToTwoDecimals(rawCommission)).toBe(21.19);
  });

  it("handles floating point precision issues", () => {
    // JavaScript: 0.1 + 0.2 = 0.30000000000000004
    const result = 0.1 + 0.2;
    expect(roundToTwoDecimals(result)).toBe(0.3);
  });
});

// ============================================================================
// Integration Tests - Typical Commission Calculations
// ============================================================================

describe("Commission calculation workflow", () => {
  it("calculates commission from gross amount correctly", () => {
    // Typical workflow:
    // 1. Receive gross amount from supplier (includes VAT)
    // 2. Calculate net amount (remove VAT)
    // 3. Calculate commission on net amount
    // 4. Round to 2 decimals for financial precision

    const grossAmount = 11800; // ILS including 18% VAT
    const commissionRate = 0.03; // 3%

    // Step 1: Calculate net
    const netAmount = calculateNetFromGross(grossAmount);
    expect(roundToTwoDecimals(netAmount)).toBe(10000);

    // Step 2: Calculate commission on net
    const commission = netAmount * commissionRate;
    expect(roundToTwoDecimals(commission)).toBe(300);
  });

  it("handles typical supplier commission scenario", () => {
    // Supplier A reports: 5,000 ILS (VAT inclusive)
    // Commission rate: 2.5%

    const grossAmount = 5000;
    const commissionRate = 0.025;

    const netAmount = calculateNetFromGross(grossAmount);
    const commission = roundToTwoDecimals(netAmount * commissionRate);

    // Net = 5000 / 1.18 = 4237.29
    // Commission = 4237.29 * 0.025 = 105.93
    expect(roundToTwoDecimals(netAmount)).toBeCloseTo(4237.29, 2);
    expect(commission).toBeCloseTo(105.93, 2);
  });

  it("handles multiple line items accumulation", () => {
    // Simulate processing multiple rows and accumulating totals
    const lineItems = [
      { gross: 1180, rate: 0.02 },
      { gross: 2360, rate: 0.025 },
      { gross: 590, rate: 0.03 },
    ];

    let totalNet = 0;
    let totalCommission = 0;

    for (const item of lineItems) {
      const net = calculateNetFromGross(item.gross);
      const commission = net * item.rate;
      totalNet += net;
      totalCommission += commission;
    }

    // Round final totals
    totalNet = roundToTwoDecimals(totalNet);
    totalCommission = roundToTwoDecimals(totalCommission);

    // Expected:
    // Item 1: net = 1000, commission = 20
    // Item 2: net = 2000, commission = 50
    // Item 3: net = 500, commission = 15
    // Total net = 3500, total commission = 85
    expect(totalNet).toBe(3500);
    expect(totalCommission).toBe(85);
  });
});
