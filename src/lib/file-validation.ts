import { fileTypeFromBuffer } from "file-type";

/**
 * Mapping of allowed MIME types to file-type library extensions
 * Used for magic byte validation to prevent MIME type spoofing
 */
const ALLOWED_FILE_SIGNATURES: Record<string, string[]> = {
  // Documents
  "application/pdf": ["pdf"],
  "application/msword": ["doc"],
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [
    "docx",
  ],
  "application/vnd.ms-excel": ["xls"],
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ["xlsx"],

  // Images
  "image/jpeg": ["jpg", "jpeg"],
  "image/png": ["png"],
  "image/gif": ["gif"],
};

export interface FileValidationResult {
  valid: boolean;
  detectedMimeType?: string;
  error?: string;
}

/**
 * Validate file type using magic byte detection
 * This prevents MIME type spoofing attacks where attackers
 * upload executables with fake MIME types
 *
 * @param buffer - File buffer to validate
 * @param claimedMimeType - MIME type claimed by client
 * @returns Validation result with detected type
 */
export async function validateFileType(
  buffer: Buffer,
  claimedMimeType: string
): Promise<FileValidationResult> {
  // Text files have no magic bytes - validate differently
  if (claimedMimeType === "text/plain" || claimedMimeType === "text/csv") {
    if (hasExecutableSignature(buffer)) {
      return {
        valid: false,
        error: "File appears to be executable, not text",
      };
    }
    // Additional check: ensure it's valid UTF-8 text
    if (!isValidTextFile(buffer)) {
      return {
        valid: false,
        error: "File contains binary data, not valid text",
      };
    }
    return { valid: true, detectedMimeType: claimedMimeType };
  }

  // Binary files - check magic bytes
  const detectedType = await fileTypeFromBuffer(buffer);

  if (!detectedType) {
    return {
      valid: false,
      error: "Could not determine file type from content",
    };
  }

  const allowedExtensions = ALLOWED_FILE_SIGNATURES[claimedMimeType];
  if (!allowedExtensions) {
    return {
      valid: false,
      error: "MIME type not in allowed list",
    };
  }

  if (!allowedExtensions.includes(detectedType.ext)) {
    return {
      valid: false,
      detectedMimeType: detectedType.mime,
      error: `Type mismatch: claimed ${claimedMimeType}, detected ${detectedType.mime}`,
    };
  }

  return { valid: true, detectedMimeType: detectedType.mime };
}

/**
 * Check if buffer has executable file signature
 * Prevents executables disguised as text/other files
 */
function hasExecutableSignature(buffer: Buffer): boolean {
  if (buffer.length < 4) return false;

  const header = buffer.subarray(0, 4);

  // Executable magic bytes to reject
  const executableSignatures = [
    [0x4d, 0x5a], // MZ (DOS/Windows executable)
    [0x7f, 0x45, 0x4c, 0x46], // ELF (Linux executable)
    [0xcf, 0xfa, 0xed, 0xfe], // Mach-O (macOS executable, little-endian)
    [0xfe, 0xed, 0xfa, 0xcf], // Mach-O (macOS executable, big-endian)
    [0xca, 0xfe, 0xba, 0xbe], // Mach-O fat binary
  ];

  return executableSignatures.some((sig) =>
    sig.every((byte, i) => header[i] === byte)
  );
}

/**
 * Check if buffer appears to be valid text (not binary)
 */
function isValidTextFile(buffer: Buffer): boolean {
  // Check first 8KB for binary content
  const checkLength = Math.min(8192, buffer.length);
  const sample = buffer.subarray(0, checkLength);

  // Count null bytes and other binary indicators
  let nullCount = 0;
  let printableCount = 0;

  for (let i = 0; i < sample.length; i++) {
    const byte = sample[i];
    if (byte === 0) {
      nullCount++;
    } else if (
      (byte >= 0x20 && byte <= 0x7e) || // printable ASCII
      byte === 0x09 || // tab
      byte === 0x0a || // newline
      byte === 0x0d || // carriage return
      byte >= 0x80 // UTF-8 continuation bytes
    ) {
      printableCount++;
    }
  }

  // Reject if more than 1% null bytes (binary file indicator)
  if (nullCount > checkLength * 0.01) {
    return false;
  }

  // Require at least 90% printable/text characters
  return printableCount / sample.length >= 0.9;
}
