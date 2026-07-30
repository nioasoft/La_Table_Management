"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  Loader2,
  RefreshCw,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { fetchWithTimeout } from "@/lib/fetch-with-timeout";
import {
  franchiseeBillingExportStatusResponseSchema,
  type FranchiseeBillingExportBrandStatus,
  type FranchiseeBillingItemType,
  type FranchiseeBillingPeriod,
} from "@/schemas/franchisee-billing-screen";

interface FranchiseeBillingExportProps {
  readonly period: FranchiseeBillingPeriod;
}

interface DownloadState {
  readonly key: string;
  readonly message: string;
}

export interface BrandExportGate {
  readonly coverageLabel: string;
  readonly missingNames: readonly string[];
  readonly exportDisabled: boolean;
}

const EXPORT_TYPES: readonly {
  readonly itemType: FranchiseeBillingItemType;
  readonly label: string;
}[] = [
  { itemType: "royalty", label: "תמלוגים" },
  { itemType: "marketing", label: "שיווק" },
];

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

export function hashavshevetExportUrl(
  period: FranchiseeBillingPeriod,
  brandId?: string,
  itemType?: FranchiseeBillingItemType,
): string {
  const params = new URLSearchParams({
    year: String(period.year),
    month: String(period.month),
    ...(brandId ? { brandId } : { mode: "status" }),
    ...(itemType ? { itemType } : {}),
  });
  return `/api/franchisee-billing/hashavshevet-export?${params.toString()}`;
}

export function deriveBrandExportGate(
  brand: FranchiseeBillingExportBrandStatus,
): BrandExportGate {
  return {
    coverageLabel: `${brand.readyCount}/${brand.totalActive}`,
    missingNames: brand.missing.map((item) => item.franchiseeName),
    exportDisabled: !brand.canExport,
  };
}

async function fetchExportStatus(
  period: FranchiseeBillingPeriod,
): Promise<readonly FranchiseeBillingExportBrandStatus[]> {
  const response = await fetchWithTimeout(hashavshevetExportUrl(period));
  const body: unknown = await response.json();
  if (!response.ok) {
    throw new Error(
      apiErrorMessage(body) ??
        "לא ניתן לבדוק אם קובצי חשבשבת מוכנים לייצוא.",
    );
  }
  const parsed =
    franchiseeBillingExportStatusResponseSchema.safeParse(body);
  if (!parsed.success) {
    console.error("Invalid Hashavshevet export status response:", {
      issues: parsed.error.issues,
    });
    throw new Error("נתוני מוכנות הייצוא אינם תקינים. רענני את העמוד.");
  }
  return parsed.data.data.brands;
}

function responseFileName(
  response: Response,
  fallback: string,
): string {
  const disposition = response.headers.get("Content-Disposition") ?? "";
  const match = disposition.match(/filename\*=UTF-8''([^;]+)/i);
  if (!match?.[1]) return fallback;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return fallback;
  }
}

async function downloadExport(
  period: FranchiseeBillingPeriod,
  brand: FranchiseeBillingExportBrandStatus,
  itemType: FranchiseeBillingItemType,
  label: string,
): Promise<void> {
  const response = await fetchWithTimeout(
    hashavshevetExportUrl(period, brand.brandId, itemType),
  );
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    throw new Error(
      apiErrorMessage(body) ??
        "הקובץ לא הופק. בדקי שכל הזכיינים עדיין מאושרים.",
    );
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = responseFileName(
    response,
    `${brand.brandName} ${label} זכיינים.xlsx`,
  );
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function ExportLoading() {
  return (
    <div aria-label="מוכנות הייצוא נטענת" className="space-y-3">
      <Skeleton className="h-6 w-48" />
      <div className="grid gap-3 lg:grid-cols-3">
        {Array.from({ length: 3 }, (_, index) => (
          <Skeleton key={index} className="h-36 w-full" />
        ))}
      </div>
    </div>
  );
}

function ExportError({
  error,
  onRetry,
}: {
  readonly error: Error;
  readonly onRetry: () => void;
}) {
  return (
    <div
      role="alert"
      className="rounded-xl border border-destructive/40 bg-destructive/5 p-4"
    >
      <p className="flex items-center gap-2 font-medium">
        <AlertTriangle
          className="h-5 w-5 text-destructive"
          aria-hidden="true"
        />
        מוכנות הייצוא לא נטענה
      </p>
      <p className="mt-1 text-sm text-muted-foreground">{error.message}</p>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="mt-3"
        onClick={onRetry}
      >
        <RefreshCw aria-hidden="true" />
        נסי שוב
      </Button>
    </div>
  );
}

function MissingFranchisees({
  totalActive,
  gate,
}: {
  readonly totalActive: number;
  readonly gate: BrandExportGate;
}) {
  if (totalActive === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        אין זכיינים פעילים במותג הזה.
      </p>
    );
  }
  if (gate.missingNames.length === 0) {
    return (
      <p className="flex items-center gap-1.5 text-sm text-emerald-700">
        <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
        כל הזכיינים מוכנים לייצוא
      </p>
    );
  }
  return (
    <div className="text-sm text-destructive">
      <p className="font-medium">חסרים:</p>
      <ul className="mt-1 list-inside list-disc">
        {gate.missingNames.map((name, index) => (
          <li key={`${name}:${index}`}>{name}</li>
        ))}
      </ul>
    </div>
  );
}

interface BrandExportCardProps {
  readonly brand: FranchiseeBillingExportBrandStatus;
  readonly pendingKey: string | null;
  readonly onDownload: (
    brand: FranchiseeBillingExportBrandStatus,
    itemType: FranchiseeBillingItemType,
    label: string,
  ) => void;
}

function BrandExportCard({
  brand,
  pendingKey,
  onDownload,
}: BrandExportCardProps) {
  const gate = deriveBrandExportGate(brand);
  return (
    <article className="space-y-3 rounded-xl border bg-card p-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-semibold">{brand.brandName}</h3>
        <span
          dir="ltr"
          className="rounded-full bg-muted px-2.5 py-1 text-sm font-semibold [font-variant-numeric:tabular-nums]"
        >
          <bdi>{gate.coverageLabel}</bdi>
        </span>
      </div>
      <MissingFranchisees totalActive={brand.totalActive} gate={gate} />
      <div className="flex flex-wrap gap-2">
        {EXPORT_TYPES.map(({ itemType, label }) => {
          const key = `${brand.brandId}:${itemType}`;
          const pending = pendingKey === key;
          return (
            <Button
              key={itemType}
              type="button"
              size="sm"
              variant={itemType === "royalty" ? "default" : "outline"}
              disabled={gate.exportDisabled || pendingKey !== null}
              onClick={() => onDownload(brand, itemType, label)}
            >
              {pending ? (
                <Loader2 className="animate-spin" aria-hidden="true" />
              ) : (
                <Download aria-hidden="true" />
              )}
              {pending ? "מפיק קובץ…" : `ייצוא ${label}`}
            </Button>
          );
        })}
      </div>
    </article>
  );
}

export function FranchiseeBillingExport({
  period,
}: FranchiseeBillingExportProps) {
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [success, setSuccess] = useState<DownloadState | null>(null);
  const query = useQuery({
    queryKey: [
      "franchisee-billing-hashavshevet-export",
      period.year,
      period.month,
    ],
    queryFn: () => fetchExportStatus(period),
  });

  const handleDownload = async (
    brand: FranchiseeBillingExportBrandStatus,
    itemType: FranchiseeBillingItemType,
    label: string,
  ) => {
    const key = `${brand.brandId}:${itemType}`;
    setPendingKey(key);
    setFailure(null);
    try {
      await downloadExport(period, brand, itemType, label);
      setSuccess({
        key,
        message: `קובץ ${label} של ${brand.brandName} הופק, נשמר והורד.`,
      });
      await query.refetch();
    } catch (error: unknown) {
      console.error("Failed to export franchisee billing:", error);
      setFailure(
        error instanceof Error
          ? error.message
          : "הקובץ לא הופק. נסי שוב.",
      );
    } finally {
      setPendingKey(null);
    }
  };

  return (
    <section className="space-y-4" aria-labelledby="hashavshevet-export-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="mb-1 flex items-center gap-2 text-sm font-medium text-primary">
            <FileSpreadsheet className="h-4 w-4" aria-hidden="true" />
            קובצי הנהלת חשבונות
          </p>
          <h2 id="hashavshevet-export-title" className="text-xl font-semibold">
            ייצוא לחשבשבת
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            לכל מותג מופקים שני קבצים נפרדים. הייצוא נפתח רק כשכל הזכיינים
            הפעילים מאושרים או מסומנים ללא מחזור.
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={query.isFetching}
          onClick={() => void query.refetch()}
        >
          <RefreshCw
            className={query.isFetching ? "animate-spin" : undefined}
            aria-hidden="true"
          />
          בדיקה מחדש
        </Button>
      </div>

      {query.isLoading && <ExportLoading />}
      {query.isError && (
        <ExportError
          error={
            query.error instanceof Error
              ? query.error
              : new Error("אירעה שגיאה לא צפויה. נסי שוב.")
          }
          onRetry={() => void query.refetch()}
        />
      )}
      {query.data && query.data.length === 0 && (
        <div className="rounded-xl border border-dashed bg-muted/20 p-6 text-center">
          <p className="font-medium">אין מותגים זמינים לייצוא</p>
          <p className="mt-1 text-sm text-muted-foreground">
            בדקי שהמותגים פעילים ונסי לרענן את העמוד.
          </p>
        </div>
      )}
      {query.data && query.data.length > 0 && (
        <div className="grid gap-3 lg:grid-cols-3">
          {query.data.map((brand) => (
            <BrandExportCard
              key={brand.brandId}
              brand={brand}
              pendingKey={pendingKey}
              onDownload={(selectedBrand, itemType, label) =>
                void handleDownload(selectedBrand, itemType, label)
              }
            />
          ))}
        </div>
      )}

      {failure && (
        <p role="alert" className="text-sm text-destructive">
          {failure}
        </p>
      )}
      {success && !failure && (
        <p
          key={success.key}
          role="status"
          className="text-sm text-emerald-700"
        >
          {success.message}
        </p>
      )}
    </section>
  );
}
