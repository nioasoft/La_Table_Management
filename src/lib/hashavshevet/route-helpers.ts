import { NextResponse, type NextRequest } from "next/server";
import type { z } from "zod";

import type { CompanyRecord, HashavshevetStore } from "@/data-access/hashavshevet";
import { classifyRows, type ClassifiedRow } from "./classify";
import { copy } from "./copy";
import { roundCents } from "./format";
import type { ExportDefinition } from "./registry";
import type { BuiltRow } from "./types";

/** Shared by the preview and send routes. */

export function requestIdOf(request: NextRequest): string {
  return request.headers.get("x-vercel-id") ?? crypto.randomUUID();
}

export function fail(error: string, status: number, extra: Record<string, unknown> = {}): NextResponse {
  return NextResponse.json({ success: false, error, ...extra }, { status });
}

/** 400 for a body that failed its schema: the first Hebrew message the schema defined, else the generic one. */
export function invalidBody(error: z.ZodError): NextResponse {
  const hebrew = error.issues.find((i) => /[֐-׿]/.test(i.message));
  return fail(hebrew?.message ?? copy.invalidRequest, 400);
}

/**
 * Loggable facts of an error, never its message: a Drizzle query error's message carries the
 * query params, i.e. row payloads. The pg code / constraint (bare or as Drizzle's `cause`) say enough.
 */
export function errorLogFields(err: unknown): { error: string; code?: string; constraint?: string } {
  const e = err as { name?: unknown; code?: unknown; constraint?: unknown; cause?: { code?: unknown; constraint?: unknown } } | null;
  const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
  return {
    error: err instanceof Error ? err.name : typeof err,
    code: str(e?.code) ?? str(e?.cause?.code),
    constraint: str(e?.constraint) ?? str(e?.cause?.constraint),
  };
}

/** Generic 500 (no stack, no internals) plus one structured English log line carrying the request id. */
export function serverFail(event: string, requestId: string, err: unknown): NextResponse {
  console.error(
    JSON.stringify({ event, requestId, error: err instanceof Error ? err.message : String(err) }),
  );
  return fail(copy.serverError(requestId), 500, { requestId });
}

export interface BuiltAndClassified {
  blockingErrors: string[];
  companies: Map<string, CompanyRecord>;
  classified: ClassifiedRow[];
}

/** A row as Reut finds it in the preview table: its first non-empty display values, else its key. */
function rowLabel(row: BuiltRow): string {
  const shown = Object.values(row.display).filter((v) => String(v).trim() !== "");
  return shown.slice(0, 3).join(" · ") || row.rowKey;
}

/**
 * One guard for every export (the Excel paths never come here): Masofon2 rejects a zero-amount
 * line, and an empty apiRow means the builder had no API mapping. Either one blocks the send.
 */
function unsendableRows(rows: BuiltRow[]): string[] {
  return rows
    .filter((r) => roundCents(r.amount) === 0 || Object.keys(r.apiRow).length === 0)
    .map((r) => copy.unsendableRow(rowLabel(r)));
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
  return {
    blockingErrors: [...built.blockingErrors, ...unsendableRows(built.rows)],
    companies,
    classified: classifyRows(built.rows, locks, companies),
  };
}
