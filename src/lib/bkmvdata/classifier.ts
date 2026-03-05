import type { BkmvSoftwareType } from './types';

/**
 * Classify a BKMVDATA file to determine which accounting software produced it.
 *
 * Decision tree based on B110 record patterns:
 * 1. Key is 15-digit all-numeric -> nihul
 * 2. Key contains Hebrew/Latin alpha -> hashavshevet
 * 3. Key is short numeric:
 *    a. Description contains "000000000000" -> hashavshevet (numeric key variant)
 *    b. pos 117 contains "aa" -> nihul (shouldn't happen with short key, but guard)
 *    c. Name field populated AND desc starts with digit+Hebrew -> unknown-d
 *    d. Name field empty AND pos 117 has Hebrew text -> ravachit
 *    e. Fallback: check B100 counterparty pattern
 */
export function classifyBkmvFile(text: string): BkmvSoftwareType {
  const lines = text.split(/\r?\n/);

  // Collect a few B110 and B100 records for analysis
  const b110Lines: string[] = [];
  const b100Lines: string[] = [];

  for (const line of lines) {
    if (line.startsWith('B11') && b110Lines.length < 5) {
      b110Lines.push(line);
    } else if (line.startsWith('B10') && b100Lines.length < 5) {
      b100Lines.push(line);
    }
    if (b110Lines.length >= 5 && b100Lines.length >= 5) break;
  }

  // Classify from B110 records (most reliable)
  if (b110Lines.length > 0) {
    const result = classifyFromB110(b110Lines);
    if (result) return result;
  }

  // Fallback: classify from B100 counterparty pattern
  if (b100Lines.length > 0) {
    return classifyFromB100(b100Lines);
  }

  // Default fallback
  return 'hashavshevet';
}

function classifyFromB110(b110Lines: string[]): BkmvSoftwareType | null {
  // Check multiple B110 records for consistency
  for (const line of b110Lines) {
    const accountKey = line.substring(22, 37).trim();
    const accountName = line.substring(37, 67).trim();
    const accountDesc = line.substring(67, 117).trim();
    const pos117 = line.substring(117, 147).trim();

    if (!accountKey) continue;

    // Check 1: 15-digit all-numeric key -> nihul
    if (accountKey.length === 15 && /^\d{15}$/.test(accountKey)) {
      return 'nihul';
    }

    // Check 2: key contains Hebrew or Latin alpha -> hashavshevet
    if (/[א-תa-zA-Z]/.test(accountKey)) {
      return 'hashavshevet';
    }

    // Check 3: short numeric key - need more disambiguation
    if (/^\d+$/.test(accountKey)) {
      // 3a: description contains "000000000000" -> hashavshevet (numeric key variant)
      if (accountDesc.includes('000000000000')) {
        return 'hashavshevet';
      }

      // 3b: pos 117 is "aa" -> nihul
      if (pos117 === 'aa') {
        return 'nihul';
      }

      // 3c: name populated AND desc starts with digit+Hebrew -> unknown-d
      if (accountName && accountName.length > 0 && /^\d{1,2}[א-ת]/.test(accountDesc)) {
        return 'unknown-d';
      }

      // 3d: name empty AND pos 117 has Hebrew text -> ravachit
      if ((!accountName || /^[\d\s\-\.]*$/.test(accountName)) && /[א-ת]/.test(pos117)) {
        return 'ravachit';
      }

      // 3e: name empty AND description has name+sort pattern (no zeros) -> ravachit
      if ((!accountName || /^[\d\s\-\.]*$/.test(accountName)) && /^[א-תa-zA-Z]/.test(accountDesc)) {
        return 'ravachit';
      }
    }
  }

  return null;
}

function classifyFromB100(b100Lines: string[]): BkmvSoftwareType {
  for (const line of b100Lines) {
    const counterparty = line.substring(172, 199).trim();

    // 27-digit all-numeric -> nihul
    if (/^\d{27}$/.test(counterparty)) {
      return 'nihul';
    }

    // Contains Hebrew -> hashavshevet
    if (/[א-ת]/.test(counterparty)) {
      return 'hashavshevet';
    }

    // Short numeric -> ravachit (most common case)
    if (/^\d{1,6}$/.test(counterparty)) {
      return 'ravachit';
    }
  }

  return 'hashavshevet';
}
