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
  const bytes =
    data instanceof Uint8Array
      ? data.subarray(0, SNIFF_BYTES)
      : new Uint8Array(data.slice(0, SNIFF_BYTES));

  if (bytes.length < 2) return false;

  // Decode by BOM — the meta charset declaration lies in the file we care about
  const decoder =
    bytes[0] === 0xff && bytes[1] === 0xfe
      ? new TextDecoder("utf-16le")
      : new TextDecoder("utf-8");
  const text = decoder.decode(bytes).replace(/^﻿/, "");

  return OPENING_TAG_RE.test(text) && TABLE_TAG_RE.test(text);
}
