import { describe, it, expect } from "vitest";
import {
  calculateNetFromGross,
  calculateGrossFromNet,
  roundAmount,
  roundPercent,
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
// Rounding Tests - roundAmount (whole shekels, no agorot)
// ============================================================================

describe("roundAmount", () => {
  it("rounds to whole shekels", () => {
    expect(roundAmount(10.49)).toBe(10);
    expect(roundAmount(10.50)).toBe(11);
    expect(roundAmount(10.51)).toBe(11);
    expect(roundAmount(10.99)).toBe(11);
  });

  it("handles values already whole", () => {
    expect(roundAmount(10)).toBe(10);
    expect(roundAmount(100)).toBe(100);
  });

  it("handles zero", () => {
    expect(roundAmount(0)).toBe(0);
  });

  it("handles negative numbers", () => {
    expect(roundAmount(-10.49)).toBe(-10);
    expect(roundAmount(-10.51)).toBe(-11);
    // Math.round(-10.5) = -10 (rounds towards +Infinity)
    expect(roundAmount(-10.5)).toBe(-10);
  });

  it("handles very small amounts", () => {
    expect(roundAmount(0.49)).toBe(0);
    expect(roundAmount(0.50)).toBe(1);
    expect(roundAmount(0.01)).toBe(0);
  });

  it("handles very large numbers", () => {
    expect(roundAmount(1000000.49)).toBe(1000000);
    expect(roundAmount(1000000.50)).toBe(1000001);
  });

  it("handles floating point precision issues", () => {
    // JavaScript: 0.1 + 0.2 = 0.30000000000000004
    const result = 0.1 + 0.2;
    expect(roundAmount(result)).toBe(0);
  });
});

// ============================================================================
// Rounding Tests - roundPercent (2 decimal places for percentages)
// ============================================================================

describe("roundPercent", () => {
  it("rounds to 2 decimal places", () => {
    expect(roundPercent(3.456)).toBe(3.46);
    expect(roundPercent(3.454)).toBe(3.45);
    expect(roundPercent(3.455)).toBe(3.46);
  });

  it("handles whole numbers", () => {
    expect(roundPercent(5)).toBe(5);
    expect(roundPercent(100)).toBe(100);
  });

  it("handles zero", () => {
    expect(roundPercent(0)).toBe(0);
  });

  it("preserves precision for typical commission rates", () => {
    expect(roundPercent(3.5)).toBe(3.5);
    expect(roundPercent(2.75)).toBe(2.75);
    expect(roundPercent(12.123)).toBe(12.12);
  });
});

// ============================================================================
// Integration Tests - Typical Commission Calculations
// ============================================================================

describe("Commission calculation workflow", () => {
  it("calculates commission from gross amount correctly", () => {
    const grossAmount = 11800; // ILS including 18% VAT
    const commissionRate = 0.03; // 3%

    // Step 1: Calculate net
    const netAmount = calculateNetFromGross(grossAmount);
    expect(roundAmount(netAmount)).toBe(10000);

    // Step 2: Calculate commission on net
    const commission = netAmount * commissionRate;
    expect(roundAmount(commission)).toBe(300);
  });

  it("handles typical supplier commission scenario", () => {
    // Supplier A reports: 5,000 ILS (VAT inclusive)
    // Commission rate: 2.5%

    const grossAmount = 5000;
    const commissionRate = 0.025;

    const netAmount = calculateNetFromGross(grossAmount);
    const commission = roundAmount(netAmount * commissionRate);

    // Net = 5000 / 1.18 = 4237.29...
    // Commission = 4237.29 * 0.025 = 105.93... → rounds to 106
    expect(roundAmount(netAmount)).toBe(4237);
    expect(commission).toBe(106);
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

    // Round final totals to whole shekels
    totalNet = roundAmount(totalNet);
    totalCommission = roundAmount(totalCommission);

    // Expected:
    // Item 1: net = 1000, commission = 20
    // Item 2: net = 2000, commission = 50
    // Item 3: net = 500, commission = 15
    // Total net = 3500, total commission = 85
    expect(totalNet).toBe(3500);
    expect(totalCommission).toBe(85);
  });
});
