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

    return iso; // Default to ISO-8859-8
  } catch {
    // Fallback: try to decode as UTF-8 or Latin-1
    const decoder = new TextDecoder('iso-8859-8');
    return decoder.decode(buffer);
  }
}
