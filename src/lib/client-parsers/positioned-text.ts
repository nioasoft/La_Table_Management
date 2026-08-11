/**
 * Column-aware PDF text extraction.
 *
 * `pdf-parse` (used by most parsers here) flattens a page to a string and
 * throws the glyph positions away. For prose that is fine; for TABLES it is
 * lossy in a way that silently destroys data: a 10bis day row comes out as
 * `"01/07188178----366-48.44"`, where `188178` could as easily be `18|8178`.
 * There is no way to recover the column boundaries afterwards.
 *
 * `pdfjs-dist` — already a direct dependency, already used by
 * mishloha-parser / invoice-haat-parser / invoice-mishloha-parser — exposes
 * each text item with its transform matrix, so rows and columns survive.
 *
 * Reach for this whenever a parser needs to read a TABLE out of a PDF.
 * `pdf-parse` remains the right tool for keyword and label matching.
 */

/** pdfjs legacy build — same module specifier the other PDF parsers use. */
const PDFJS_MODULE = "pdfjs-dist/legacy/build/pdf.mjs";

/** Items closer than this on the x axis belong to the same cell. */
const CELL_GAP = 6;

/** Items within this many points of each other on y are the same row. */
const ROW_TOLERANCE = 2;

export interface PositionedRow {
  /** 1-based page number. */
  page: number;
  /** Baseline y of the row (higher = further up the page). */
  y: number;
  /**
   * Cell texts in VISUAL left-to-right order.
   *
   * For an RTL table this means the rightmost Hebrew column lands LAST.
   * Callers reading a Hebrew table should either index from the end or
   * reverse the array — see `joinRtl`.
   */
  cells: string[];
}

/**
 * Extract every page of a PDF as positioned rows.
 *
 * Items are grouped into rows by baseline y, then into cells by x proximity,
 * so a table keeps its shape. Rows are returned in reading order: page
 * ascending, then y descending (top of page first).
 */
export async function extractPositionedRows(
  buffer: Buffer,
): Promise<PositionedRow[]> {
  const pdfjs = await import(/* webpackIgnore: true */ PDFJS_MODULE);
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(buffer),
    useSystemFonts: true,
  }).promise;

  const out: PositionedRow[] = [];

  for (let page = 1; page <= doc.numPages; page++) {
    const content = await (await doc.getPage(page)).getTextContent();
    const items = (
      content.items as Array<{ str: string; transform: number[] }>
    ).filter((i) => i.str.trim().length > 0);

    // Group by baseline y, tolerating sub-point drift within a row.
    const byRow: Array<{ y: number; parts: Array<{ x: number; s: string }> }> = [];
    for (const item of items) {
      const y = item.transform[5];
      const x = item.transform[4];
      const row = byRow.find((r) => Math.abs(r.y - y) <= ROW_TOLERANCE);
      if (row) row.parts.push({ x, s: item.str });
      else byRow.push({ y, parts: [{ x, s: item.str }] });
    }

    byRow.sort((a, b) => b.y - a.y);

    for (const row of byRow) {
      row.parts.sort((a, b) => a.x - b.x);
      const cells: string[] = [];
      let prevEnd: number | null = null;
      for (const part of row.parts) {
        const text = part.s.trim();
        if (!text) continue;
        if (prevEnd !== null && part.x - prevEnd <= CELL_GAP) {
          cells[cells.length - 1] += part.s;
        } else {
          cells.push(part.s);
        }
        // No advance-width in the item we keep, so approximate the cell end
        // by its start. Under-estimating only ever splits a cell, never
        // merges two — and splitting is recoverable by the caller, merging
        // is not.
        prevEnd = part.x;
      }
      const trimmed = cells.map((c) => c.trim()).filter(Boolean);
      if (trimmed.length > 0) out.push({ page, y: row.y, cells: trimmed });
    }
  }

  return out;
}

/**
 * Join visual-order cells back into logical Hebrew.
 *
 * pdfjs emits RTL runs right-to-left on the x axis, so a line reading
 * "פירוט עסקאות למסעדת ויני חיפה" arrives as
 * ["חיפה","ויני","למסעדת","עסקאות","פירוט"].
 */
export function joinRtl(cells: string[]): string {
  return [...cells].reverse().join(" ").replace(/\s+/g, " ").trim();
}

/** Parse a table cell to a number. Returns null for "-" and other blanks. */
export function cellToNumber(cell: string | undefined): number | null {
  if (!cell) return null;
  const cleaned = cell.replace(/[,\s₪]/g, "");
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return null;
  return parseFloat(cleaned);
}
