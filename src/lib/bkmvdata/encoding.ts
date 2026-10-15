import * as iconv from 'iconv-lite';

/**
 * Count Hebrew characters (Unicode range) in a string.
 * Used for encoding detection.
 */
export function countHebrew(text: string): number {
  let count = 0;
  const limit = Math.min(text.length, 10000);
  for (let i = 0; i < limit; i++) {
    const code = text.charCodeAt(i);
    if (code >= 0x05D0 && code <= 0x05EA) count++;
  }
  return count;
}

/**
 * Restore Hebrew from a 7-bit "shifted" export: every cp1255 letter byte minus
 * 0xA0, so ב-ת land on 'A'-'Z' and א on '&' (or '@'). Seen in מיאמוטו's files
 * from 2026-07: "DKPQEZ NDQRCD" = "הכנסות מהסעדה" — no encoding finds Hebrew,
 * every supplier goes unmatched and no revenue account is detected.
 * Only B100/B110 text is remapped: record codes and A100's "&OF1.31&" are real ASCII.
 * ponytail: a genuinely all-English file with uppercase B110 names would be remapped too;
 * such a file matches no (Hebrew) supplier anyway.
 */
export function unshiftHebrew(text: string): string {
  if (/[א-ת]/.test(text) || !/^B110[^\r\n]*[A-Z]/m.test(text)) return text;
  return text.replace(/^(B1[01]0)(.*)$/gm, (_, code: string, rest: string) =>
    code + rest.replace(/[@&A-Z]/g, (c) => (c === '&' ? 'א' : String.fromCharCode(0x05d0 + c.charCodeAt(0) - 0x40)))
  );
}

/**
 * Decode buffer from Hebrew encoding to UTF-8.
 * Auto-detects between ISO-8859-8, CP862 (DOS Hebrew), and Windows-1255.
 */
export function decodeBuffer(buffer: Buffer): string {
  try {
    // Try ISO-8859-8 first (most common for BKMV files)
    const iso = iconv.decode(buffer, 'ISO-8859-8');
    const isoCount = countHebrew(iso);
    if (isoCount > 50) {
      return iso; // Clearly correct encoding
    }

    // Try CP862 (DOS Hebrew) - used by some older accounting software
    const cp862 = iconv.decode(buffer, 'CP862');
    const cp862Count = countHebrew(cp862);

    // Try Windows-1255
    const win1255 = iconv.decode(buffer, 'windows-1255');
    const win1255Count = countHebrew(win1255);

    // Pick the encoding that produced the most Hebrew characters
    if (cp862Count > isoCount && cp862Count >= win1255Count) {
      return cp862;
    }
    if (win1255Count > isoCount) {
      return win1255;
    }

    return unshiftHebrew(iso); // Default to ISO-8859-8 (or 7-bit shifted Hebrew)
  } catch {
    // Fallback: try to decode as UTF-8 or Latin-1
    const decoder = new TextDecoder('iso-8859-8');
    return decoder.decode(buffer);
  }
}
