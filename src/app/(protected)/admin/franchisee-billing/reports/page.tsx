"use client";

import { useQuery } from "@tanstack/react-query";
import { AlertCircle, FileSpreadsheet, Loader2, RefreshCw } from "lucide-react";
import { useState } from "react";
import { z } from "zod";

import { FranchiseeBillingAnnualTable } from "@/components/reports/franchisee-billing-annual-table";
import { ReportLayout } from "@/components/reports/report-layout";
import { ExcelExportButton } from "@/components/reports/report-export-button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { fetchWithTimeout } from "@/lib/fetch-with-timeout";
import { hasAnnualData } from "@/lib/franchisee-billing-annual-summary";
import {
  franchiseeBillingAnnualResponseSchema,
  franchiseeBillingAnnualTypeSchema,
  type FranchiseeBillingAnnualPayload,
  type FranchiseeBillingAnnualType,
} from "@/schemas/franchisee-billing-annual";

const brandOptionsSchema = z.object({
  brands: z.array(z.object({ id: z.string(), nameHe: z.string() }).loose()),
});

const REPORTS: readonly {
  type: FranchiseeBillingAnnualType;
  label: string;
  description: string;
}[] = [
  {
    type: "turnover",
    label: "מחזורים",
    description: "מחזור לפני מע״מ לכל סניף, חודש בחודש, עם סה״כ לכל מותג",
  },
  {
    type: "royalties",
    label: "תמלוגים",
    description:
      "תמלוגים לפני מע״מ לכל סניף, ובעמודה האחרונה האחוז בפועל מהמחזור השנתי",
  },
  {
    type: "marketing",
    label: "שיווק",
    description: "דמי שיווק לפני מע״מ לכל סניף, חודש בחודש",
  },
  {
    type: "discounts",
    label: "הנחות",
    description:
      "ערך ההנחה שניתנה בפועל בכל חודש — הפער בין התמלוגים המלאים למה שחויב",
  },
];

const ALL_BRANDS = "all";
const EMPTY_MESSAGE =
  "לא נמצאו חיובים בשנה שנבחרה. חודשים שטרם עובדו יופיעו ריקים";

function apiError(body: unknown): string {
  if (
    typeof body === "object" &&
    body !== null &&
    "error" in body &&
    typeof body.error === "string"
  ) {
    return body.error;
  }
  return "אירעה שגיאה בטעינת הדוח. נסי שוב";
}

function buildQueryString(
  reportType: FranchiseeBillingAnnualType,
  year: number,
  brandId: string | null,
): string {
  const params = new URLSearchParams({ reportType, year: String(year) });
  if (brandId) params.set("brandId", brandId);
  return params.toString();
}

async function fetchReport(
  reportType: FranchiseeBillingAnnualType,
  year: number,
  brandId: string | null,
): Promise<FranchiseeBillingAnnualPayload> {
  const response = await fetchWithTimeout(
    `/api/reports/franchisee-billing/annual?${buildQueryString(reportType, year, brandId)}`,
  );
  const body: unknown = await response.json().catch((error: unknown) => {
    console.error("Annual billing report returned invalid JSON", error);
    return null;
  });
  if (!response.ok) throw new Error(apiError(body));
  const parsed = franchiseeBillingAnnualResponseSchema.safeParse(body);
  if (!parsed.success || parsed.data.data.reportType !== reportType) {
    console.error("Invalid annual billing report response", parsed.error);
    throw new Error("התקבלו נתוני דוח לא תקינים. נסי לרענן");
  }
  return parsed.data.data;
}

interface BrandOption {
  readonly id: string;
  readonly nameHe: string;
}

async function fetchBrandOptions(): Promise<readonly BrandOption[]> {
  const response = await fetchWithTimeout("/api/brands");
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new Error(apiError(body));
  const parsed = brandOptionsSchema.safeParse(body);
  if (!parsed.success) {
    console.error("Invalid brands response for report filter", parsed.error);
    throw new Error("רשימת המותגים לא נטענה. נסי לרענן");
  }
  return parsed.data.brands;
}

function LoadingTable(): React.ReactNode {
  return (
    <div className="space-y-3" aria-label="טוען את נתוני הדוח">
      {[0, 1, 2, 3].map((row) => (
        <Skeleton key={row} className="h-12 w-full" />
      ))}
    </div>
  );
}

interface ReportStateProps {
  readonly report: FranchiseeBillingAnnualPayload | undefined;
  readonly isLoading: boolean;
  readonly error: Error | null;
  readonly onRetry: () => void;
}

function ReportState({ report, isLoading, error, onRetry }: ReportStateProps) {
  if (isLoading) return <LoadingTable />;
  if (error) {
    return (
      <Alert variant="destructive">
        <AlertCircle className="h-4 w-4" />
        <AlertTitle>הדוח לא נטען</AlertTitle>
        <AlertDescription className="flex items-center justify-between gap-4">
          <span>{error.message}</span>
          <Button type="button" variant="outline" size="sm" onClick={onRetry}>
            <RefreshCw className="me-2 h-4 w-4" />
            נסי שוב
          </Button>
        </AlertDescription>
      </Alert>
    );
  }
  if (!report || report.rows.length === 0) {
    return (
      <div className="py-12 text-center text-muted-foreground">
        <FileSpreadsheet className="mx-auto mb-3 h-10 w-10" />
        <p className="font-medium text-foreground">אין נתונים להצגה</p>
        <p className="mt-1 text-sm">{EMPTY_MESSAGE}</p>
      </div>
    );
  }
  return <FranchiseeBillingAnnualTable report={report} />;
}

interface YearSelectProps {
  readonly value: number;
  readonly options: readonly number[];
  readonly onChange: (value: number) => void;
}

function YearSelect({ value, options, onChange }: YearSelectProps) {
  return (
    <div className="space-y-2">
      <Label htmlFor="annual-report-year">שנה</Label>
      <Select
        dir="rtl"
        value={String(value)}
        onValueChange={(nextValue) => onChange(Number(nextValue))}
      >
        <SelectTrigger id="annual-report-year" dir="rtl">
          <SelectValue />
        </SelectTrigger>
        <SelectContent dir="rtl">
          {options.map((option) => (
            <SelectItem key={option} value={String(option)}>
              <bdi>{option}</bdi>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

interface BrandSelectProps {
  readonly value: string | null;
  readonly options: readonly BrandOption[];
  readonly onChange: (value: string | null) => void;
}

function BrandSelect({ value, options, onChange }: BrandSelectProps) {
  return (
    <div className="space-y-2">
      <Label htmlFor="annual-report-brand">מותג</Label>
      <Select
        dir="rtl"
        value={value ?? ALL_BRANDS}
        onValueChange={(nextValue) =>
          onChange(nextValue === ALL_BRANDS ? null : nextValue)
        }
      >
        <SelectTrigger id="annual-report-brand" dir="rtl">
          <SelectValue />
        </SelectTrigger>
        <SelectContent dir="rtl">
          <SelectItem value={ALL_BRANDS}>כל המותגים</SelectItem>
          {options.map((option) => (
            <SelectItem key={option.id} value={option.id}>
              {option.nameHe}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function resolveTab(value: string): FranchiseeBillingAnnualType | null {
  const parsed = franchiseeBillingAnnualTypeSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export default function FranchiseeBillingAnnualReportsPage() {
  const [currentYear] = useState(() => new Date().getFullYear());
  const [reportType, setReportType] =
    useState<FranchiseeBillingAnnualType>("turnover");
  const [year, setYear] = useState(currentYear);
  const [brandId, setBrandId] = useState<string | null>(null);
  const years = Array.from(
    { length: currentYear - 2019 },
    (_, index) => currentYear - index,
  );

  const query = useQuery({
    queryKey: ["franchisee-billing-annual", reportType, year, brandId],
    queryFn: () => fetchReport(reportType, year, brandId),
    retry: 1,
  });
  const brandsQuery = useQuery({
    queryKey: ["report-brand-options"],
    queryFn: fetchBrandOptions,
    staleTime: 5 * 60 * 1000,
  });

  const refetch = (): void => {
    void query.refetch();
  };
  const canExport = Boolean(query.data && hasAnnualData(query.data.rows));

  return (
    <ReportLayout
      title="דוחות שנתיים — תמלוגים ושיווק"
      description="מחזורים, תמלוגים ודמי שיווק לפי סניף וחודש, לפני מע״מ"
      breadcrumbs={[
        { label: "ניהול", href: "/admin" },
        { label: "חיוב תמלוגים ושיווק", href: "/admin/franchisee-billing" },
        { label: "דוחות" },
      ]}
      isLoading={query.isFetching}
      onRefresh={refetch}
      actions={(
        <ExcelExportButton
          endpoint="/api/reports/franchisee-billing/annual/export"
          queryString={buildQueryString(reportType, year, brandId)}
          reportType={`franchisee-billing-annual-${reportType}-${year}`}
          disabled={!canExport || query.isFetching}
        />
      )}
    >
      <Card>
        <CardContent className="grid gap-4 pt-6 sm:grid-cols-2">
          <YearSelect value={year} options={years} onChange={setYear} />
          <BrandSelect
            value={brandId}
            options={brandsQuery.data ?? []}
            onChange={setBrandId}
          />
        </CardContent>
      </Card>

      <Tabs
        dir="rtl"
        value={reportType}
        onValueChange={(value) => {
          const next = resolveTab(value);
          if (next) setReportType(next);
        }}
      >
        <TabsList className="grid h-auto w-full grid-cols-2 gap-1 sm:grid-cols-4">
          {REPORTS.map((item) => (
            <TabsTrigger key={item.type} value={item.type}>
              {item.label}
            </TabsTrigger>
          ))}
        </TabsList>
        {REPORTS.map((item) => (
          <TabsContent key={item.type} value={item.type}>
            <Card>
              <CardHeader>
                <CardTitle className="text-xl">
                  {item.label} — <bdi>{year}</bdi>
                </CardTitle>
                <p className="text-sm text-muted-foreground">
                  {item.description}
                </p>
              </CardHeader>
              <CardContent>
                <ReportState
                  report={query.data}
                  isLoading={query.isLoading}
                  error={query.error}
                  onRetry={refetch}
                />
              </CardContent>
            </Card>
          </TabsContent>
        ))}
      </Tabs>

      {query.isFetching && !query.isLoading && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          מעדכן את נתוני הדוח…
        </p>
      )}
    </ReportLayout>
  );
}
