import { NextRequest, NextResponse } from "next/server";

import { drizzleHashavshevetStore, type HashavshevetStore } from "@/data-access/hashavshevet";
import { isAuthError, requireAdminOrSuperUser } from "@/lib/api-middleware";
import {
  blockingStatuses,
  groupByCompanyId,
  type ClassifiedRow,
  type CompanyInfo,
  type RowStatus,
} from "@/lib/hashavshevet/classify";
import { copy } from "@/lib/hashavshevet/copy";
import { roundCents } from "@/lib/hashavshevet/format";
import { EXPORTS, type ExportDefinition } from "@/lib/hashavshevet/registry";
import { buildAndClassify, errorLogFields, fail, requestIdOf } from "@/lib/hashavshevet/route-helpers";
import type { ExportType } from "@/lib/hashavshevet/types";
import type { HConnectPlugin } from "@/lib/hconnect";
import { previewRequestSchema } from "@/schemas/hashavshevet";

/** Spec §7: build the rows of an export, classify each one, group by target company. */

/** A classified row as the client sees it: no `apiRow`; the send route rebuilds the H-Connect payload server-side. */
export type PreviewRow = Omit<ClassifiedRow, "apiRow">;

export interface PreviewGroup {
  companyId: string | null;
  companyName: string | null;
  requiresApproval: boolean;
  rows: PreviewRow[];
  /** Sum of the rows that would be sent now (status "new"), rounded to cents. */
  totalNew: number;
}

export interface PreviewData {
  exportType: ExportType;
  plugin: HConnectPlugin;
  groups: PreviewGroup[];
  blockingErrors: string[];
  blockingStatuses: RowStatus[];
}

export interface PreviewDeps {
  store: Pick<HashavshevetStore, "getCompanies" | "getActiveLocks">;
  exports: Record<ExportType, ExportDefinition>;
}

type CompanyDirectory = Map<string, CompanyInfo & { nameHe: string }>;

function toPreviewRow({ apiRow: _apiRow, ...rest }: ClassifiedRow): PreviewRow {
  return rest;
}

/** One group per distinct companyId, in order of first appearance; null (no company) is its own group. */
function groupByCompany(rows: ClassifiedRow[], companies: CompanyDirectory): PreviewGroup[] {
  return [...groupByCompanyId(rows)].map(([companyId, groupRows]) => {
    const info = companyId === null ? undefined : companies.get(companyId);
    const totalNew = groupRows.reduce((sum, r) => (r.status === "new" ? sum + r.amount : sum), 0);
    return {
      companyId,
      companyName: info?.nameHe ?? null,
      requiresApproval: info?.requiresApproval ?? false,
      rows: groupRows.map(toPreviewRow),
      totalNew: roundCents(totalNew),
    };
  });
}

export async function handlePreview(
  request: NextRequest,
  deps: PreviewDeps = { store: drizzleHashavshevetStore, exports: EXPORTS },
): Promise<NextResponse> {
  const requestId = requestIdOf(request);
  const authResult = await requireAdminOrSuperUser(request);
  if (isAuthError(authResult)) return authResult;

  const body: unknown = await request.json().catch(() => undefined);
  const parsed = previewRequestSchema.safeParse(body);
  if (!parsed.success) return fail(copy.invalidRequest, 400);
  const { exportType, params } = parsed.data;

  try {
    const definition = deps.exports[exportType];
    const { blockingErrors, companies, classified } = await buildAndClassify(deps.store, definition, params);
    const data: PreviewData = {
      exportType,
      plugin: definition.plugin,
      groups: groupByCompany(classified, companies),
      blockingErrors,
      blockingStatuses: blockingStatuses(classified),
    };
    return NextResponse.json({ success: true, data });
  } catch (err) {
    console.error(
      JSON.stringify({
        event: "hashavshevet_preview_failed",
        requestId,
        exportType,
        ...errorLogFields(err),
      }),
    );
    return fail(copy.serverError(requestId), 500, { requestId });
  }
}

// A named wrapper, never `export const POST = handlePreview`: Next passes a route context as the
// second argument, which would land in `deps`.
export async function POST(request: NextRequest): Promise<NextResponse> {
  return handlePreview(request);
}
