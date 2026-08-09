/**
 * Detection for spreadsheets that are really HTML tables.
 *
 * Some supplier ERPs export a report as an HTML `<TABLE>` and name it `.xls`
 * — ימה וקדמה's "ניתוח מכירות תקופתי" does this, in UTF-16LE, while declaring
 * `charset=UTF-8` in its meta tag. SheetJS parses such a file, but decodes the
 * Hebrew as mojibake, so both the browser-side XLS→XLSX conversion and the
 * magic-byte validator need to recognise it and leave the bytes alone.
 *
 * Shared by client and server; deliberately dependency-free.
 */

/** Bytes to sniff — enough to clear a long inline <style> block before <TABLE>. */
const SNIFF_BYTES = 16384;

const OPENING_TAG_RE = /^\s*<\s*(?:!doctype\s+html|html|table)\b/i;
const TABLE_TAG_RE = /<\s*table\b/i;

/**
 * True when the buffer is an HTML document containing a table. Requires both an
 * HTML opening tag and a `<table>` so a stray "<" in a text file can't match.
 */
export function looksLikeHtmlTableFile(data: ArrayBuffer | Uint8Array): boolean {
  const text = sniffText(data);
  return OPENING_TAG_RE.test(text) && TABLE_TAG_RE.test(text);
}

/**
 * True when the file is the frameset shell Excel writes for "Save as Web Page".
 *
 * Excel splits such a save into a shell that holds nothing but a tab strip and
 * a `<link>` to `<name>.files/sheet001.htm`, where all the data actually lives.
 * The `.files` folder never travels with the file over WhatsApp or email, so the
 * shell arrives alone and parses as an empty workbook — "הקובץ ריק", with no
 * hint that a re-save is what emptied it. Detecting the shell lets the upload
 * say so outright.
 */
export function isExcelWebPageShell(data: ArrayBuffer | Uint8Array): boolean {
  const text = sniffText(data);
  return (
    /<meta\s+name=["']?Excel\s+Workbook\s+Frameset/i.test(text) ||
    (/<meta\s+name=["']?ProgId["']?\s+content=["']?Excel\.Sheet/i.test(text) &&
      /\.files\/sheet\d+\.htm/i.test(text))
  );
}

function sniffText(data: ArrayBuffer | Uint8Array): string {
  const bytes =
    data instanceof Uint8Array
      ? data.subarray(0, SNIFF_BYTES)
      : new Uint8Array(data.slice(0, SNIFF_BYTES));

  if (bytes.length < 2) return "";

  // Decode by BOM — the meta charset declaration lies in the files we care about
  const decoder =
    bytes[0] === 0xff && bytes[1] === 0xfe
      ? new TextDecoder("utf-16le")
      : new TextDecoder("utf-8");
  return decoder.decode(bytes).replace(/^﻿/, "");
}
