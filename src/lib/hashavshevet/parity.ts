import { roundCents } from "./format";
import type { BuiltRow } from "./types";

/**
 * Compares the first sheet of an old Excel export (as `sheet_to_json(ws, { header: 1 })`)
 * with the builder's rows: header = keys of `display`, then every row's values in order.
 * Numbers are compared to two decimals, a date serial to a dd/mm/yyyy display value; an empty cell
 * equals "". Returns one line per difference.
 */

const DMY = /^\d{2}\/\d{2}\/\d{4}$/;
const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30);

/** An Excel date serial as dd/mm/yyyy. Nearest day: the stored fraction depends on the writer's time zone. */
function serialToDmy(serial: number): string {
  const d = new Date(EXCEL_EPOCH_MS + Math.round(serial) * 86_400_000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
}

function cellEquals(actual: unknown, expected: string | number): boolean {
  // A date column reads back as a serial number; the builder shows it as dd/mm/yyyy.
  if (typeof actual === "number" && typeof expected === "string" && DMY.test(expected)) {
    return serialToDmy(actual) === expected;
  }
  if (typeof actual === "number" || typeof expected === "number") {
    const a = Number(actual ?? "");
    const e = Number(expected);
    return Number.isFinite(a) && Number.isFinite(e) && roundCents(a) === roundCents(e);
  }
  return String(actual ?? "") === expected;
}

function show(value: unknown): string {
  return JSON.stringify(value ?? "");
}

function compareRow(
  sheetRow: readonly unknown[],
  columns: readonly string[],
  display: BuiltRow["display"],
  rowNumber: number,
): string[] {
  const diffs = columns.flatMap((column, index) =>
    cellEquals(sheetRow[index], display[column])
      ? []
      : [`row ${rowNumber}, "${column}": sheet ${show(sheetRow[index])}, builder ${show(display[column])}`],
  );
  if (sheetRow.length > columns.length) diffs.push(`row ${rowNumber}: sheet has ${sheetRow.length} columns, builder has ${columns.length}`);
  return diffs;
}

export function compareSheetToRows(
  sheet: readonly (readonly unknown[])[],
  rows: readonly BuiltRow[],
): string[] {
  const sheetRows = sheet.slice(1).filter((r) => r.some((c) => c !== undefined && c !== ""));
  const diffs: string[] = [];
  if (rows.length === 0) {
    if (sheetRows.length > 0) diffs.push(`sheet has ${sheetRows.length} data rows, builder has 0`);
    return diffs;
  }
  const columns = Object.keys(rows[0].display);
  const header = sheet[0] ?? [];
  if (columns.length !== header.length || columns.some((c, i) => String(header[i] ?? "") !== c)) {
    diffs.push(`header: sheet ${show(header)}, builder ${show(columns)}`);
  }
  if (sheetRows.length !== rows.length) {
    diffs.push(`row count: sheet ${sheetRows.length}, builder ${rows.length}`);
  }
  rows.slice(0, sheetRows.length).forEach((row, i) => {
    diffs.push(...compareRow(sheetRows[i], columns, row.display, i + 2));
  });
  return diffs;
}
