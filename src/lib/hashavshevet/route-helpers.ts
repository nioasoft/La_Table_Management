import { NextResponse, type NextRequest } from "next/server";

import type { CompanyRecord, HashavshevetStore } from "@/data-access/hashavshevet";
import { classifyRows, type ClassifiedRow } from "./classify";
import type { ExportDefinition } from "./registry";

/** Shared by the preview and send routes. */

export function requestIdOf(request: NextRequest): string {
  return request.headers.get("x-vercel-id") ?? crypto.randomUUID();
}

export function fail(error: string, status: number, extra: Record<string, unknown> = {}): NextResponse {
  return NextResponse.json({ success: false, error, ...extra }, { status });
}

export interface BuiltAndClassified {
  blockingErrors: string[];
  companies: Map<string, CompanyRecord>;
  classified: ClassifiedRow[];
}

/** Spec §7: build the export's rows server-side and classify each against active locks and companies. */
export async function buildAndClassify(
  store: Pick<HashavshevetStore, "getCompanies" | "getActiveLocks">,
  definition: ExportDefinition,
  params: unknown,
): Promise<BuiltAndClassified> {
  const built = await definition.build(params);
  const [companies, locks] = await Promise.all([
    store.getCompanies(),
    store.getActiveLocks(definition.type, built.rows.map((r) => r.rowKey)),
  ]);
  return { blockingErrors: built.blockingErrors, companies, classified: classifyRows(built.rows, locks, companies) };
}
