"use client";

import { useCallback } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  CalendarDays,
  FileX2,
  Loader2,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";

import { FranchiseeBillingAlerts } from "@/components/franchisee-billing-alerts";
import { FranchiseeBillingApproval } from "@/components/franchisee-billing-approval";
import { FranchiseeBillingExport } from "@/components/franchisee-billing-export";
import { FranchiseeBillingSources } from "@/components/franchisee-billing-sources";
import { FranchiseeBillingTable } from "@/components/franchisee-billing-table";
import { FranchiseeBillingUpload } from "@/components/franchisee-billing-upload";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { fetchWithTimeout } from "@/lib/fetch-with-timeout";
import { reprocessSourceFile } from "@/lib/franchisee-billing-reprocess";
import {
  franchiseeBillingMutationSchema,
  franchiseeBillingMutationResponseSchema,
  franchiseeBillingScreenResponseSchema,
  type FranchiseeBillingMutation,
  type FranchiseeBillingPeriod,
  type FranchiseeBillingScreenPayload,
} from "@/schemas/franchisee-billing-screen";

const MONTHS = [
  "ינואר",
  "פברואר",
  "מרץ",
  "אפריל",
  "מאי",
  "יוני",
  "יולי",
  "אוגוסט",
  "ספטמבר",
  "אוקטובר",
  "נובמבר",
  "דצמבר",
] as const;

const now = new Date();
const INITIAL_PERIOD = {
  year: now.getFullYear(),
  month: now.getMonth() + 1,
} as const;
const YEAR_OPTIONS = Array.from(
  { length: 7 },
  (_, index) => INITIAL_PERIOD.year - 4 + index,
);

function apiErrorMessage(value: unknown): string | null {
  if (
    typeof value === "object" &&
    value !== null &&
    "error" in value &&
    typeof value.error === "string"
  ) {
    return value.error;
  }
  return null;
}

async function fetchBillingScreen(
  period: FranchiseeBillingPeriod,
): Promise<FranchiseeBillingScreenPayload> {
  try {
    const params = new URLSearchParams({
      year: String(period.year),
      month: String(period.month),
    });
    const response = await fetchWithTimeout(
      `/api/franchisee-billing?${params.toString()}`,
    );
    const responseBody: unknown = await response.json();
    if (!response.ok) {
      throw new Error(
        apiErrorMessage(responseBody) ??
          "לא ניתן לטעון את נתוני החיוב. נסי שוב.",
      );
    }
    const parsed = franchiseeBillingScreenResponseSchema.safeParse(
      responseBody,
    );
    if (!parsed.success) {
      console.error("Invalid franchisee billing screen response:", {
        issues: parsed.error.issues,
      });
      throw new Error("נתוני החיוב שהתקבלו אינם תקינים. רענני את העמוד.");
    }
    return parsed.data.data;
  } catch (error: unknown) {
    console.error("Failed to load franchisee billing screen:", error);
    throw error;
  }
}

async function patchBillingScreen(
  mutation: FranchiseeBillingMutation,
): Promise<void> {
  const payload = franchiseeBillingMutationSchema.parse(mutation);
  const response = await fetchWithTimeout("/api/franchisee-billing", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const responseBody: unknown = await response.json();
  if (!response.ok) {
    throw new Error(
      apiErrorMessage(responseBody) ??
        "השינוי לא נשמר. רענני את העמוד ונסי שוב.",
    );
  }
  const parsed = franchiseeBillingMutationResponseSchema.safeParse(
    responseBody,
  );
  if (!parsed.success) {
    console.error("Invalid franchisee billing mutation response:", {
      issues: parsed.error.issues,
    });
    throw new Error("השינוי נשמר אך תשובת השרת אינה תקינה. רענני את העמוד.");
  }
}

function BillingScreenLoading() {
  return (
    <div aria-label="נתוני החיוב נטענים" className="space-y-3">
      <Skeleton className="h-14 w-full" />
      {Array.from({ length: 5 }, (_, index) => (
        <Skeleton key={index} className="h-16 w-full" />
      ))}
    </div>
  );
}

function BillingScreenError({
  error,
  onRetry,
}: {
  readonly error: Error;
  readonly onRetry: () => void;
}) {
  return (
    <div
      role="alert"
      className="rounded-xl border border-destructive/40 bg-destructive/5 p-6 text-center"
    >
      <AlertTriangle
        className="mx-auto mb-3 h-8 w-8 text-destructive"
        aria-hidden="true"
      />
      <h2 className="text-lg font-semibold">נתוני החיוב לא נטענו</h2>
      <p className="mt-2 text-sm text-muted-foreground">{error.message}</p>
      <Button type="button" className="mt-4" onClick={onRetry}>
        נסי שוב
      </Button>
    </div>
  );
}

function BillingEmptyState({ hasSource }: { readonly hasSource: boolean }) {
  return (
    <div className="rounded-xl border border-dashed bg-muted/20 px-6 py-12 text-center">
      <FileX2
        className="mx-auto mb-3 h-10 w-10 text-muted-foreground"
        aria-hidden="true"
      />
      <h2 className="text-lg font-semibold">
        {hasSource
          ? "הקובץ נקלט, אך אין שורות חיוב להצגה"
          : "לא הועלה קובץ לחודש הזה"}
      </h2>
      <p className="mx-auto mt-2 max-w-xl text-sm text-muted-foreground">
        {hasSource
          ? "תקני את החסימות שמופיעות מעל אזור זה והעלי את הקובץ מחדש."
          : "בחרי קובץ מחזור חודשי מטאבית. לאחר העיבוד, שורות הטיוטה יופיעו כאן."}
      </p>
    </div>
  );
}

function readPeriod(params: URLSearchParams): FranchiseeBillingPeriod {
  const year = Number(params.get("year"));
  const month = Number(params.get("month"));
  const valid =
    Number.isInteger(year) &&
    Number.isInteger(month) &&
    month >= 1 &&
    month <= 12 &&
    year >= 2000;
  return valid ? { year, month } : INITIAL_PERIOD;
}

export function FranchiseeBillingScreen() {
  // The period lives in the URL so a refresh keeps the month Reut is working
  // on and a link to a specific month can be shared.
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const period = readPeriod(new URLSearchParams(searchParams.toString()));
  const setPeriod = useCallback(
    (next: FranchiseeBillingPeriod) => {
      router.replace(
        `${pathname}?year=${next.year}&month=${next.month}`,
        { scroll: false },
      );
    },
    [pathname, router],
  );
  const query = useQuery({
    queryKey: ["franchisee-billing-screen", period.year, period.month],
    queryFn: () => fetchBillingScreen(period),
  });

  const saveDiscount = async (
    billingId: string,
    discountRatePoints: number,
  ) => {
    await patchBillingScreen({
      action: "update_discount",
      billingId,
      discountRatePoints,
    });
    await query.refetch();
  };

  const resolveDifference = async (
    difference: FranchiseeBillingScreenPayload["approvedDifferences"][number],
    resolution: "reopen" | "keep",
  ) => {
    await patchBillingScreen({
      action: "resolve_difference",
      sourceFileId: difference.sourceFileId,
      franchiseeId: difference.franchiseeId,
      resolution,
    });
    await query.refetch();
  };

  /**
   * Settles one blocked row: either it belongs to a franchisee, or it is not a
   * franchisee at all. The decision is stored on the file and the workbook is
   * replayed, so the amounts still come from Tabit and never from the screen.
   */
  const resolveAnomaly = async (
    anomaly: FranchiseeBillingScreenPayload["anomalies"][number],
    franchiseeId: string | null,
  ) => {
    await reprocessSourceFile(anomaly.sourceFileId, {
      rowIndex: anomaly.rowIndex,
      franchiseeId,
    });
    await query.refetch();
  };

  const saveNoRevenueReason = async (
    billingId: string,
    noRevenueReason: string | null,
  ) => {
    await patchBillingScreen({
      action: "update_no_revenue_reason",
      billingId,
      noRevenueReason,
    });
    await query.refetch();
  };

  const handleUploaded = async (uploadedPeriod: FranchiseeBillingPeriod) => {
    if (
      uploadedPeriod.year === period.year &&
      uploadedPeriod.month === period.month
    ) {
      await query.refetch();
      return;
    }
    setPeriod(uploadedPeriod);
  };

  const data = query.data;
  return (
    <main dir="rtl" className="container mx-auto py-6 space-y-6">
      <header className="flex flex-col gap-4 border-b pb-5 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <p className="mb-1 flex items-center gap-2 text-sm font-medium text-primary">
            <CalendarDays className="h-4 w-4" aria-hidden="true" />
            חיוב חודשי לזכיינים
          </p>
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
            תמלוגים ושיווק
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            עברי על הטיוטה, הזיני דחיות בנקודות אחוז ושמרי כל שורה.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1.5">
            <span className="text-xs font-medium text-muted-foreground">
              חודש
            </span>
            <Select
              dir="rtl"
              value={String(period.month)}
              onValueChange={(value) =>
                setPeriod({ ...period, month: Number(value) })
              }
            >
              <SelectTrigger
                dir="rtl"
                aria-label="חודש חיוב"
                className="w-36"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent dir="rtl">
                {MONTHS.map((monthName, index) => (
                  <SelectItem
                    key={monthName}
                    dir="rtl"
                    value={String(index + 1)}
                    className="text-end"
                  >
                    {monthName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <span className="text-xs font-medium text-muted-foreground">
              שנה
            </span>
            <Select
              dir="rtl"
              value={String(period.year)}
              onValueChange={(value) =>
                setPeriod({ ...period, year: Number(value) })
              }
            >
              <SelectTrigger
                dir="rtl"
                aria-label="שנת חיוב"
                className="w-28"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent dir="rtl">
                {YEAR_OPTIONS.map((year) => (
                  <SelectItem
                    key={year}
                    dir="rtl"
                    value={String(year)}
                    className="text-end"
                  >
                    <span
                      dir="ltr"
                      className="[font-variant-numeric:tabular-nums]"
                    >
                      <bdi>{year}</bdi>
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button type="button" variant="outline" asChild>
            <Link href="/admin/franchisees/royalty-tiers">
              <ShieldCheck aria-hidden="true" />
              אישור מדרגות
            </Link>
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => void query.refetch()}
            disabled={query.isFetching}
            aria-label="רענון נתוני החיוב"
          >
            {query.isFetching ? (
              <Loader2 className="animate-spin" aria-hidden="true" />
            ) : (
              <RefreshCw aria-hidden="true" />
            )}
            רענון
          </Button>
        </div>
      </header>

      <FranchiseeBillingUpload onUploaded={handleUploaded} />

      {query.isLoading && <BillingScreenLoading />}
      {query.isError && (
        <BillingScreenError
          error={
            query.error instanceof Error
              ? query.error
              : new Error("אירעה שגיאה לא צפויה. נסי שוב.")
          }
          onRetry={() => void query.refetch()}
        />
      )}
      {data && (
        <section className="space-y-5" aria-live="polite">
          <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
            <FranchiseeBillingSources
              sourceFiles={data.sourceFiles}
              onChanged={() => query.refetch()}
            />
            <p className="font-medium">
              {data.rows.length === 1
                ? "שורת חיוב אחת"
                : `${data.rows.length} שורות חיוב`}
            </p>
          </div>
          <FranchiseeBillingAlerts
            anomalies={data.anomalies}
            warnings={data.warnings}
            staleRows={data.rows.filter((row) => row.isStaleSource)}
            approvedDifferences={data.approvedDifferences}
            franchisees={data.franchisees}
            onResolveDifference={resolveDifference}
            onResolveAnomaly={resolveAnomaly}
          />
          <FranchiseeBillingApproval
            key={`approval-${period.year}-${period.month}`}
            data={data}
            period={period}
            onApproved={() => query.refetch()}
          />
          <FranchiseeBillingExport
            key={[
              "export",
              period.year,
              period.month,
              data.rows.length,
              data.rows.filter((row) => row.status === "approved").length,
            ].join("-")}
            period={period}
          />
          {data.rows.length > 0 ? (
            <FranchiseeBillingTable
              key={`${period.year}-${period.month}`}
              rows={data.rows}
              onSaveDiscount={saveDiscount}
              onSaveNoRevenueReason={saveNoRevenueReason}
            />
          ) : (
            <BillingEmptyState hasSource={data.sourceFiles.length > 0} />
          )}
        </section>
      )}
    </main>
  );
}
