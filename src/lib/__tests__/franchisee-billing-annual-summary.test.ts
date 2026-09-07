import { describe, expect, it } from "vitest";

import {
  groupAnnualRows,
  pivotAnnualRows,
  type AnnualQueryRow,
} from "@/lib/franchisee-billing-annual-summary";

function queryRow(overrides: Partial<AnnualQueryRow>): AnnualQueryRow {
  return {
    franchiseeId: "f-1",
    franchiseeName: "סידיוס בע״מ",
    brandName: "פט ויני",
    periodMonth: null,
    netBase: null,
    royalty: null,
    marketing: null,
    discountValue: null,
    ...overrides,
  };
}

describe("pivotAnnualRows", () => {
  it("places each month's value at its own index and leaves the rest null", () => {
    const [row] = pivotAnnualRows(
      [
        queryRow({ periodMonth: 1, netBase: "100" }),
        queryRow({ periodMonth: 7, netBase: "300" }),
      ],
      "turnover",
    );

    expect(row.months[0]).toBe("100");
    expect(row.months[6]).toBe("300");
    expect(row.months).toHaveLength(12);
    // A month with no billing row is empty, never zero — an empty cell and a
    // real ₪0 month mean different things to whoever reads the grid.
    expect(row.months.filter((value) => value === null)).toHaveLength(10);
  });

  it("keeps a franchisee with no billing rows at all as an empty row", () => {
    const rows = pivotAnnualRows([queryRow({})], "turnover");

    expect(rows).toHaveLength(1);
    expect(rows[0].months.every((value) => value === null)).toBe(true);
    expect(rows[0].total).toBe("0");
    expect(rows[0].average).toBeNull();
  });

  it("averages over months that carry data, not over twelve", () => {
    const [row] = pivotAnnualRows(
      [
        queryRow({ periodMonth: 7, netBase: "100" }),
        queryRow({ periodMonth: 8, netBase: "200" }),
      ],
      "turnover",
    );

    expect(row.total).toBe("300");
    expect(Number(row.average)).toBe(150);
  });

  it("fills the grid from the column the report type asks for", () => {
    const raw = [
      queryRow({
        periodMonth: 3,
        netBase: "1000",
        royalty: "50",
        marketing: "10",
        discountValue: "7",
      }),
    ];

    expect(pivotAnnualRows(raw, "turnover")[0].months[2]).toBe("1000");
    expect(pivotAnnualRows(raw, "royalties")[0].months[2]).toBe("50");
    expect(pivotAnnualRows(raw, "marketing")[0].months[2]).toBe("10");
    expect(pivotAnnualRows(raw, "discounts")[0].months[2]).toBe("7");
  });

  it("derives the royalty percentage from the year's turnover", () => {
    const raw = [
      queryRow({ periodMonth: 7, netBase: "1000", royalty: "50" }),
      queryRow({ periodMonth: 8, netBase: "1000", royalty: "70" }),
    ];

    expect(Number(pivotAnnualRows(raw, "royalties")[0].ratePercent)).toBe(6);
    // The percentage belongs to the royalty grid alone.
    expect(pivotAnnualRows(raw, "turnover")[0].ratePercent).toBeNull();
  });

  it("returns no percentage when the year has no turnover to divide by", () => {
    const [row] = pivotAnnualRows(
      [queryRow({ periodMonth: 7, netBase: "0", royalty: "50" })],
      "royalties",
    );

    expect(row.ratePercent).toBeNull();
  });

  it("groups every row of one franchisee together", () => {
    const rows = pivotAnnualRows(
      [
        queryRow({ franchiseeId: "f-1", periodMonth: 1, netBase: "100" }),
        queryRow({ franchiseeId: "f-1", periodMonth: 2, netBase: "100" }),
        queryRow({ franchiseeId: "f-2", franchiseeName: "מיאמוטו בע״מ", periodMonth: 1, netBase: "5" }),
      ],
      "turnover",
    );

    expect(rows).toHaveLength(2);
    expect(rows[0].total).toBe("200");
    expect(rows[1].total).toBe("5");
  });
});

describe("groupAnnualRows", () => {
  const rows = pivotAnnualRows(
    [
      queryRow({ franchiseeId: "f-1", brandName: "פט ויני", periodMonth: 1, netBase: "100", royalty: "10" }),
      queryRow({ franchiseeId: "f-2", franchiseeName: "מיאמוטו בע״מ", brandName: "פט ויני", periodMonth: 1, netBase: "300", royalty: "20" }),
      queryRow({ franchiseeId: "f-3", franchiseeName: "קינג קונג חורב בע״מ", brandName: "קינג קונג", periodMonth: 2, netBase: "700", royalty: "40" }),
    ],
    "royalties",
  );

  it("splits the rows into one section per brand", () => {
    const { brands } = groupAnnualRows(rows);

    expect(brands.map((brand) => brand.brandName)).toEqual(["פט ויני", "קינג קונג"]);
    expect(brands[0].rows).toHaveLength(2);
    expect(brands[1].rows).toHaveLength(1);
  });

  it("subtotals each brand month by month", () => {
    const { brands } = groupAnnualRows(rows);

    expect(brands[0].subtotal.months[0]).toBe("30");
    expect(brands[0].subtotal.total).toBe("30");
    expect(brands[1].subtotal.months[1]).toBe("40");
  });

  it("adds every brand into one group total", () => {
    const { grandTotal } = groupAnnualRows(rows);

    expect(grandTotal.total).toBe("70");
    expect(grandTotal.months[0]).toBe("30");
    expect(grandTotal.months[1]).toBe("40");
    expect(grandTotal.months[2]).toBeNull();
  });

  it("recomputes the percentage on totals rather than averaging the branches", () => {
    const { brands, grandTotal } = groupAnnualRows(rows);

    // 30 / 400, not the mean of 10% and 6.67%.
    expect(Number(brands[0].subtotal.ratePercent)).toBeCloseTo(7.5, 6);
    // 70 / 1100.
    expect(Number(grandTotal.ratePercent)).toBeCloseTo(6.363636, 5);
  });

  it("keeps a brand whose branches have no data, with an empty subtotal", () => {
    const empty = pivotAnnualRows([queryRow({ brandName: "נתנזון" })], "turnover");
    const { brands, grandTotal } = groupAnnualRows(empty);

    expect(brands).toHaveLength(1);
    expect(brands[0].subtotal.months.every((value) => value === null)).toBe(true);
    expect(grandTotal.total).toBe("0");
    expect(grandTotal.average).toBeNull();
  });
});
