/**
 * Migration endpoint: populate franchisee_bkmv_year from existing uploaded_file records.
 *
 * GET /api/bkmvdata/migrate-years?dryRun=true  → count only
 * POST /api/bkmvdata/migrate-years             → execute migration
 *
 * Super user only.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireSuperUser, isAuthError } from "@/lib/api-middleware";
import { database } from "@/db";
import { uploadedFile, type BkmvProcessingResult } from "@/db/schema";
import { isNotNull, asc } from "drizzle-orm";
import { upsertFromFullBreakdown } from "@/data-access/franchisee-bkmv-year";

export async function GET(request: NextRequest) {
  const authResult = await requireSuperUser(request);
  if (isAuthError(authResult)) return authResult;

  const dryRun =
    request.nextUrl.searchParams.get("dryRun") === "true";

  // Count files that have BKMV processing results with monthlyBreakdown
  const files = await database
    .select({
      id: uploadedFile.id,
      franchiseeId: uploadedFile.franchiseeId,
      originalFileName: uploadedFile.originalFileName,
    })
    .from(uploadedFile)
    .where(isNotNull(uploadedFile.bkmvProcessingResult))
    .orderBy(asc(uploadedFile.createdAt));

  const eligibleFiles = files.filter((f) => f.franchiseeId);

  return NextResponse.json({
    dryRun,
    totalBkmvFiles: files.length,
    eligibleFiles: eligibleFiles.length,
    skippedNoFranchisee: files.length - eligibleFiles.length,
  });
}

export async function POST(request: NextRequest) {
  const authResult = await requireSuperUser(request);
  if (isAuthError(authResult)) return authResult;

  // Fetch all files with BKMV processing results, ordered by createdAt ASC
  // so newer files overwrite older ones
  const files = await database
    .select({
      id: uploadedFile.id,
      franchiseeId: uploadedFile.franchiseeId,
      bkmvProcessingResult: uploadedFile.bkmvProcessingResult,
      originalFileName: uploadedFile.originalFileName,
      createdAt: uploadedFile.createdAt,
    })
    .from(uploadedFile)
    .where(isNotNull(uploadedFile.bkmvProcessingResult))
    .orderBy(asc(uploadedFile.createdAt));

  let processed = 0;
  let skipped = 0;
  let noFranchisee = 0;
  let noBreakdown = 0;
  const errors: Array<{ fileId: string; error: string }> = [];
  const yearsSummary: Record<number, { updated: number; skipped: number }> = {};

  for (const file of files) {
    if (!file.franchiseeId) {
      noFranchisee++;
      continue;
    }

    const bkmvResult = file.bkmvProcessingResult as BkmvProcessingResult;
    if (!bkmvResult.monthlyBreakdown) {
      noBreakdown++;
      continue;
    }

    try {
      const result = await upsertFromFullBreakdown(
        file.franchiseeId,
        bkmvResult.monthlyBreakdown,
        bkmvResult.supplierMatches || null,
        file.id,
        { forceOverwrite: true }
      );

      for (const y of result.updated) {
        if (!yearsSummary[y]) yearsSummary[y] = { updated: 0, skipped: 0 };
        yearsSummary[y].updated++;
      }
      for (const y of result.skipped) {
        if (!yearsSummary[y]) yearsSummary[y] = { updated: 0, skipped: 0 };
        yearsSummary[y].skipped++;
      }

      processed++;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "Unknown error";
      errors.push({ fileId: file.id, error: errorMsg });
      skipped++;
    }
  }

  return NextResponse.json({
    success: true,
    totalFiles: files.length,
    processed,
    skipped,
    noFranchisee,
    noBreakdown,
    yearsSummary,
    errors: errors.slice(0, 20), // Limit error output
  });
}
