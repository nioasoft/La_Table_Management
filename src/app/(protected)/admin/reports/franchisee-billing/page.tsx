"use client";

import { useQuery } from "@tanstack/react-query";
import {
  AlertCircle,
  CalendarDays,
  FileSpreadsheet,
  Loader2,
  RefreshCw,
} from "lucide-react";
import { useState } from "react";

import { FranchiseeBillingReportExportButton } from "@/components/reports/franchisee-billing-report-export-button";
import { FranchiseeBillingReportTable } from "@/components/reports/franchisee-billing-report-table";
import { ReportLayout } from "@/components/reports/report-layout";
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
import {
  buildFranchiseeBillingReportUrl,
  resolveFranchiseeBillingReportTab,
} from "@/lib/franchisee-billing-report-request";
import {
  franchiseeBillingReportResponseSchema,
  type FranchiseeBillingReportPayload,
  type FranchiseeBillingReportType,
} from "@/schemas/franchisee-billing-reports";

const MONTHS = [
  "ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני",
  "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר",
] as const;

const REPORTS: readonly {
  type: FranchiseeBillingReportType;
  label: string;
  description: string;
  empty: string;
}[] = [
  {
    type: "royalties",
    label: "תמלוגים",
    description: "תמלוגים לפי סניף בחודש שנבחר",
    empty: "לא נמצאו תמלוגים לחיוב בחודש שנבחר",
  },
  {
    type: "turnover",
    label: "מחזורים",
    description: "מחזור כולל מע״מ ולפני מע״מ, זה לצד זה",
    empty: "לא נמצאו נתוני מחזור בחודש שנבחר",
  },
  {
    type: "collection",
    label: "גבייה",
    description: "גבייה מצטברת עד החודש שנבחר, לפי ייצוא לחשבשבת",
    empty: "עד החודש שנבחר לא יוצאו חיובי תמלוגים או שיווק",
  },
  {
    type: "discounts",
    label: "ערך הנחות",
    description: "ערך ההנחות המצטבר שנשמר בפנקס הדחיות",
    empty: "עד החודש שנבחר לא נרשמו הנחות בפנקס הדחיות",
  },
];

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
  readonly report: FranchiseeBillingReportPayload | undefined;
  readonly isLoading: boolean;
  readonly error: Error | null;
  readonly emptyMessage: string;
  readonly onRetry: () => void;
}

function ReportState({
  report,
  isLoading,
  error,
  emptyMessage,
  onRetry,
}: ReportStateProps) {
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
        <p className="mt-1 text-sm">{emptyMessage}</p>
      </div>
    );
  }
  return <FranchiseeBillingReportTable report={report} />;
}

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

async function fetchReport(
  reportType: FranchiseeBillingReportType,
  year: number,
  month: number,
): Promise<FranchiseeBillingReportPayload> {
  const response = await fetchWithTimeout(
    buildFranchiseeBillingReportUrl({ reportType, year, month }),
  );
  const body: unknown = await response.json().catch((error: unknown) => {
    console.error("Franchisee billing report returned invalid JSON", error);
    return null;
  });
  if (!response.ok) throw new Error(apiError(body));
  const parsed = franchiseeBillingReportResponseSchema.safeParse(body);
  if (!parsed.success || parsed.data.data.reportType !== reportType) {
    console.error("Invalid franchisee billing report response", parsed.error);
    throw new Error("התקבלו נתוני דוח לא תקינים. נסי לרענן");
  }
  return parsed.data.data;
}

interface YearSelectProps {
  readonly value: number;
  readonly options: readonly number[];
  readonly onChange: (value: number) => void;
}

function YearSelect({ value, options, onChange }: YearSelectProps) {
  return (
    <div className="space-y-2">
      <Label htmlFor="report-year">שנה</Label>
      <Select
        dir="rtl"
        value={String(value)}
        onValueChange={(nextValue) => onChange(Number(nextValue))}
      >
        <SelectTrigger id="report-year" dir="rtl">
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

interface MonthSelectProps {
  readonly value: number;
  readonly onChange: (value: number) => void;
}

function MonthSelect({ value, onChange }: MonthSelectProps) {
  return (
    <div className="space-y-2">
      <Label htmlFor="report-month">חודש</Label>
      <Select
        dir="rtl"
        value={String(value)}
        onValueChange={(nextValue) => onChange(Number(nextValue))}
      >
        <SelectTrigger id="report-month" dir="rtl">
          <CalendarDays className="me-2 h-4 w-4" />
          <SelectValue />
        </SelectTrigger>
        <SelectContent dir="rtl">
          {MONTHS.map((label, index) => (
            <SelectItem key={label} value={String(index + 1)}>
              {label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

interface ReportTabsProps {
  readonly reportType: FranchiseeBillingReportType;
  readonly report: FranchiseeBillingReportPayload | undefined;
  readonly isLoading: boolean;
  readonly error: Error | null;
  readonly onChange: (value: FranchiseeBillingReportType) => void;
  readonly onRetry: () => void;
}

function ReportTabs({
  reportType,
  report,
  isLoading,
  error,
  onChange,
  onRetry,
}: ReportTabsProps) {
  const handleTabChange = (value: string): void => {
    const nextReportType = resolveFranchiseeBillingReportTab(value);
    if (nextReportType) onChange(nextReportType);
  };

  return (
    <Tabs
      dir="rtl"
      value={reportType}
      onValueChange={handleTabChange}
    >
      <TabsList className="grid h-auto w-full grid-cols-2 gap-1 lg:grid-cols-4">
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
              <CardTitle className="text-xl">{item.label}</CardTitle>
              <p className="text-sm text-muted-foreground">{item.description}</p>
            </CardHeader>
            <CardContent>
              <ReportState
                report={report}
                isLoading={isLoading}
                error={error}
                emptyMessage={item.empty}
                onRetry={onRetry}
              />
            </CardContent>
          </Card>
        </TabsContent>
      ))}
    </Tabs>
  );
}

interface ReportPageViewProps extends ReportTabsProps {
  readonly year: number;
  readonly month: number;
  readonly years: readonly number[];
  readonly isFetching: boolean;
  readonly onYearChange: (value: number) => void;
  readonly onMonthChange: (value: number) => void;
}

function ReportBody({
  year,
  month,
  years,
  isFetching,
  onYearChange,
  onMonthChange,
  ...tabsProps
}: ReportPageViewProps) {
  return (
    <>
      <Card>
        <CardContent className="grid gap-4 pt-6 sm:grid-cols-2">
          <YearSelect value={year} options={years} onChange={onYearChange} />
          <MonthSelect value={month} onChange={onMonthChange} />
        </CardContent>
      </Card>
      <ReportTabs {...tabsProps} />
      {isFetching && !tabsProps.isLoading && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          מעדכן את נתוני הדוח…
        </p>
      )}
    </>
  );
}

function ReportPageView(props: ReportPageViewProps) {
  const hasRows = Boolean(props.report?.rows.length);
  return (
    <ReportLayout
      title="דוחות חיוב זכיינים"
      description="תמלוגים, מחזורים, גבייה וערך הנחות באותו מסך"
      breadcrumbs={[
        { label: "ניהול", href: "/admin" },
        { label: "דוחות", href: "/admin/reports" },
        { label: "חיוב זכיינים" },
      ]}
      isLoading={props.isFetching}
      onRefresh={props.onRetry}
      actions={(
        <FranchiseeBillingReportExportButton
          reportType={props.reportType}
          year={props.year}
          month={props.month}
          disabled={!hasRows || props.isFetching}
        />
      )}
    >
      <ReportBody {...props} />
    </ReportLayout>
  );
}

export default function FranchiseeBillingReportsPage() {
  const [initialPeriod] = useState(() => {
    const date = new Date();
    return { year: date.getFullYear(), month: date.getMonth() + 1 };
  });
  const [reportType, setReportType] =
    useState<FranchiseeBillingReportType>("royalties");
  const [year, setYear] = useState(initialPeriod.year);
  const [month, setMonth] = useState(initialPeriod.month);
  const years = Array.from(
    { length: initialPeriod.year - 2019 },
    (_, index) => initialPeriod.year - index,
  );
  const query = useQuery({
    queryKey: ["franchisee-billing-report", reportType, year, month],
    queryFn: () => fetchReport(reportType, year, month),
    retry: 1,
  });

  return (
    <ReportPageView
      reportType={reportType}
      report={query.data}
      year={year}
      month={month}
      years={years}
      isLoading={query.isLoading}
      isFetching={query.isFetching}
      error={query.error}
      onChange={setReportType}
      onYearChange={setYear}
      onMonthChange={setMonth}
      onRetry={() => { void query.refetch(); }}
    />
  );
}
