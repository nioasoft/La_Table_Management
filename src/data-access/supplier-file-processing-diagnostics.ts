import { database } from "@/db";
import {
  supplierFileProcessingDiagnostics,
  franchisee,
} from "@/db/schema";
import { sql } from "drizzle-orm";
import { randomUUID } from "crypto";
import { createHash } from "crypto";

/**
 * Compute SHA-256 of a buffer as a lowercase hex string.
 */
export function sha256Hex(buf: Buffer | Uint8Array): string {
  return createHash("sha256").update(buf).digest("hex");
}

interface LogInput {
  supplierFileUploadId?: string | null;
  supplierId?: string | null;
  fileName: string;
  fileSizeBytes?: number | null;
  fileSha256?: string | null;
  matchStats?: unknown;
}

/**
 * Insert a diagnostic snapshot for a single supplier-file processing run.
 *
 * Captures the franchisees/aliases counts at processing time so that when two
 * uploads of the same file later produce different match results we can prove
 * what changed (file content via sha256, alias count, franchisee count).
 *
 * Designed to be fire-and-forget: callers should not await this in the hot
 * response path — wrap with `void` or handle errors locally so a diagnostic
 * failure never breaks an upload.
 */
export async function logSupplierFileProcessingDiagnostic(
  input: LogInput
): Promise<void> {
  try {
    // Snapshot franchisees + aliases counts.
    // coalesce(jsonb_array_length(aliases), 0) handles franchisees with NULL aliases.
    const [snapshot] = await database
      .select({
        franchiseesCount: sql<number>`count(*)::int`,
        aliasesCount: sql<number>`coalesce(sum(coalesce(jsonb_array_length(${franchisee.aliases}), 0)), 0)::int`,
      })
      .from(franchisee);

    await database.insert(supplierFileProcessingDiagnostics).values({
      id: randomUUID(),
      supplierFileUploadId: input.supplierFileUploadId ?? null,
      supplierId: input.supplierId ?? null,
      fileName: input.fileName,
      fileSizeBytes: input.fileSizeBytes ?? null,
      fileSha256: input.fileSha256 ?? null,
      franchiseesSnapshotCount: snapshot?.franchiseesCount ?? null,
      aliasesSnapshotCount: snapshot?.aliasesCount ?? null,
      matchStats: (input.matchStats as object | undefined) ?? null,
    });
  } catch (err) {
    // Diagnostic logging must never fail an upload. Log and move on.
    console.error("[supplier-file-diagnostics] failed to log:", err);
  }
}
