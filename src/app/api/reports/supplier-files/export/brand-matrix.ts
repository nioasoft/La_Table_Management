import * as XLSX from "xlsx";
import type { SupplierFilesReport } from "@/data-access/supplier-file-reports";

// Brand matrix sheets: one sheet per brand, row per supplier,
// two columns (קניות/עמלה) per franchisee + totals — Reut's manual workbook layout.
// קניות = netAmount (before VAT) so that קניות × % = עמלה.
export function createBrandMatrixSheets(
  data: SupplierFilesReport,
  wb: XLSX.WorkBook
): void {
  // supplierId → % rate (from the supplier's files; percentage suppliers only)
  const supplierRates = new Map<string, number>();
  for (const f of data.files) {
    if (
      !supplierRates.has(f.supplierId) &&
      f.commissionType === "percentage" &&
      f.commissionRate !== null
    ) {
      supplierRates.set(f.supplierId, f.commissionRate);
    }
  }

  // brandName → franchiseeId → franchiseeName
  const brands = new Map<string, Map<string, string>>();
  for (const s of data.bySupplier) {
    for (const fr of s.franchisees) {
      const brandFranchisees =
        brands.get(fr.brandName) ?? new Map<string, string>();
      brandFranchisees.set(fr.franchiseeId, fr.franchiseeName);
      brands.set(fr.brandName, brandFranchisees);
    }
  }

  for (const [brandName, franchiseeMap] of brands) {
    const franchisees = [...franchiseeMap.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name, "he"));

    // Header rows: branch name merged over its two columns, then totals
    const headerRow1: (string | number)[] = ["", ""];
    const headerRow2: (string | number)[] = ["ספק", "%"];
    const merges: XLSX.Range[] = [];
    franchisees.forEach((fr, i) => {
      const col = 2 + i * 2;
      headerRow1.push(fr.name, "");
      headerRow2.push("קניות", "עמלה");
      merges.push({ s: { r: 0, c: col }, e: { r: 0, c: col + 1 } });
    });
    headerRow1.push("סה״כ", "");
    headerRow2.push("סה״כ קניות", "סה״כ עמלות");
    const totalsCol = 2 + franchisees.length * 2;
    merges.push({ s: { r: 0, c: totalsCol }, e: { r: 0, c: totalsCol + 1 } });

    const rows: (string | number)[][] = [];
    const columnTotals = new Array<number>(totalsCol + 2).fill(0);

    for (const s of data.bySupplier) {
      const byFranchisee = new Map(
        s.franchisees
          .filter((fr) => fr.brandName === brandName)
          .map((fr) => [fr.franchiseeId, fr])
      );
      if (byFranchisee.size === 0) continue;

      const rate = supplierRates.get(s.supplierId);
      const row: (string | number)[] = [
        s.supplierName,
        rate !== undefined ? rate / 100 : "",
      ];
      let purchasesTotal = 0;
      let commissionTotal = 0;
      franchisees.forEach((fr, i) => {
        const entry = byFranchisee.get(fr.id);
        if (entry) {
          const purchases = Math.round(entry.netAmount);
          const commission = Math.round(entry.commission);
          row.push(purchases, commission);
          purchasesTotal += purchases;
          commissionTotal += commission;
          columnTotals[2 + i * 2] += purchases;
          columnTotals[2 + i * 2 + 1] += commission;
        } else {
          row.push("", "");
        }
      });
      row.push(purchasesTotal, commissionTotal);
      columnTotals[totalsCol] += purchasesTotal;
      columnTotals[totalsCol + 1] += commissionTotal;
      rows.push(row);
    }

    if (rows.length === 0) continue;

    const totalsRow: (string | number)[] = ["סה״כ", ""];
    for (let c = 2; c < columnTotals.length; c++) totalsRow.push(columnTotals[c]);

    const sheet = XLSX.utils.aoa_to_sheet([headerRow1, headerRow2, ...rows, totalsRow]);
    sheet["!merges"] = merges;
    sheet["!cols"] = [
      { wch: 25 },
      { wch: 6 },
      ...Array.from({ length: franchisees.length * 2 + 2 }, () => ({ wch: 12 })),
    ];
    // % column as percentage display
    for (let r = 2; r < 2 + rows.length; r++) {
      const cell = sheet[XLSX.utils.encode_cell({ r, c: 1 })];
      if (cell && typeof cell.v === "number") cell.z = "0%";
    }
    XLSX.utils.book_append_sheet(wb, sheet, brandName.slice(0, 31));
  }
}
