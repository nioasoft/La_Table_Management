"use client";

import { useMemo, useState } from "react";
import { CheckCircle2, LockKeyhole, Search } from "lucide-react";

import { FranchiseeBillingDiscountCell } from "@/components/franchisee-billing-discount-cell";
import { FranchiseeBillingDiscountEmail } from "@/components/franchisee-billing-discount-email";
import { FranchiseeBillingNoRevenueCell } from "@/components/franchisee-billing-no-revenue-cell";
import { BillingNumber } from "@/components/franchisee-billing-number";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { FranchiseeBillingScreenPayload } from "@/schemas/franchisee-billing-screen";

interface FranchiseeBillingTableProps {
  readonly rows: FranchiseeBillingScreenPayload["rows"];
  readonly onSaveDiscount: (
    billingId: string,
    discountRatePoints: number,
  ) => Promise<void>;
  readonly onSaveNoRevenueReason: (
    billingId: string,
    noRevenueReason: string | null,
  ) => Promise<void>;
}

const currencyColumns = [
  ["grossBase", "מחזור ברוטו"],
  ["netBase", "מחזור נטו"],
] as const;

interface BrandTotals {
  readonly brandName: string;
  readonly grossBase: number;
  readonly netBase: number;
  readonly royalty: number;
  readonly marketing: number;
  readonly total: number;
}

type BrandTotalsSource = Pick<
  FranchiseeBillingTableProps["rows"][number],
  "brandName" | "grossBase" | "netBase" | "royalty" | "marketing" | "total"
>;

/** One totals line per brand, in the order the brands appear in the table. */
export function totalsByBrand(
  rows: readonly BrandTotalsSource[],
): readonly BrandTotals[] {
  const totals = new Map<string, BrandTotals>();
  for (const row of rows) {
    const current = totals.get(row.brandName) ?? {
      brandName: row.brandName,
      grossBase: 0,
      netBase: 0,
      royalty: 0,
      marketing: 0,
      total: 0,
    };
    totals.set(row.brandName, {
      brandName: row.brandName,
      grossBase: current.grossBase + Number(row.grossBase),
      netBase: current.netBase + Number(row.netBase),
      royalty: current.royalty + Number(row.royalty),
      marketing: current.marketing + Number(row.marketing),
      total: current.total + Number(row.total),
    });
  }
  return [...totals.values()];
}

function BrandTotalsRow({ totals }: { readonly totals: BrandTotals }) {
  return (
    <TableRow className="font-semibold">
      <TableCell className="sticky start-0 z-10 bg-muted">
        סה״כ {totals.brandName}
      </TableCell>
      <TableCell>
        <BillingNumber value={String(totals.grossBase)} kind="currency" />
      </TableCell>
      <TableCell>
        <BillingNumber value={String(totals.netBase)} kind="currency" />
      </TableCell>
      <TableCell colSpan={3} />
      <TableCell>
        <BillingNumber value={String(totals.royalty)} kind="currency" />
      </TableCell>
      <TableCell>
        <BillingNumber value={String(totals.marketing)} kind="currency" />
      </TableCell>
      <TableCell>
        <BillingNumber value={String(totals.total)} kind="currency" />
      </TableCell>
      <TableCell colSpan={2} />
    </TableRow>
  );
}

const ALL_BRANDS = "all";

export function FranchiseeBillingTable({
  rows,
  onSaveDiscount,
  onSaveNoRevenueReason,
}: FranchiseeBillingTableProps) {
  const [discountPreviews, setDiscountPreviews] = useState<
    Readonly<Record<string, number>>
  >({});
  const [search, setSearch] = useState("");
  const [brand, setBrand] = useState<string>(ALL_BRANDS);
  const brandNames = useMemo(
    () => [...new Set(rows.map((row) => row.brandName))],
    [rows],
  );
  const query = search.trim();
  const visibleRows = rows.filter(
    (row) =>
      (brand === ALL_BRANDS || row.brandName === brand) &&
      (query === "" || row.franchiseeName.includes(query)),
  );

  const updatePreview = (billingId: string, discountValue: number) => {
    setDiscountPreviews((current) => ({
      ...current,
      [billingId]: discountValue,
    }));
  };

  return (
    <div className="rounded-xl border bg-background shadow-sm">
      <div className="flex flex-wrap items-center gap-3 border-b p-3">
        <div className="relative">
          <Search
            className="absolute start-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            dir="rtl"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="חיפוש זכיין…"
            aria-label="חיפוש זכיין"
            className="w-56 ps-8"
          />
        </div>
        <Select dir="rtl" value={brand} onValueChange={setBrand}>
          <SelectTrigger
            dir="rtl"
            aria-label="סינון לפי מותג"
            className="w-44"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent dir="rtl">
            <SelectItem value={ALL_BRANDS}>כל המותגים</SelectItem>
            {brandNames.map((name) => (
              <SelectItem key={name} value={name}>
                {name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {visibleRows.length !== rows.length && (
          <span className="text-sm text-muted-foreground">
            {visibleRows.length} מתוך {rows.length} שורות
          </span>
        )}
      </div>
      <div className="overflow-x-auto">
      <Table className="min-w-[1250px] [&_td]:px-3 [&_td]:py-2.5 [&_th]:px-3">
        <TableCaption className="pb-4">
          סכומי החיוב מוצגים כפי שנשמרו, ללא חישוב מחדש במסך.
        </TableCaption>
        <TableHeader className="bg-muted/70">
          <TableRow>
            <TableHead className="sticky start-0 z-20 min-w-44 bg-muted">
              זכיין
            </TableHead>
            {currencyColumns.map(([, label]) => (
              <TableHead key={label} className="min-w-28">
                {label}
              </TableHead>
            ))}
            <TableHead className="min-w-20">תעריף</TableHead>
            <TableHead className="min-w-32" title="הנחה / דחייה בנקודות אחוז">
              דחייה (הנחה)
            </TableHead>
            <TableHead className="min-w-28" title="שווי הדחייה בשקלים">
              שווי הדחייה
            </TableHead>
            <TableHead className="min-w-28">תמלוגים</TableHead>
            <TableHead className="min-w-28">שיווק</TableHead>
            <TableHead className="min-w-32">לתשלום כולל מע״מ</TableHead>
            <TableHead className="min-w-40">סיבת אין מחזור</TableHead>
            <TableHead className="min-w-28" title="יתרת דחיות מצטברת">
              יתרת דחיות
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {visibleRows.length === 0 && (
            <TableRow>
              <TableCell
                colSpan={11}
                className="py-10 text-center text-muted-foreground"
              >
                אין שורות שתואמות את הסינון
              </TableCell>
            </TableRow>
          )}
          {visibleRows.map((row) => {
            const isApproved = row.status === "approved";
            const isStale = row.isStaleSource;
            const stickyBackground = isStale
              ? "bg-red-50 dark:bg-red-950/20"
              : isApproved
                ? "bg-emerald-50 dark:bg-emerald-950/20"
                : "bg-background";
            return (
              <TableRow
                key={row.id}
                className={
                  isStale
                    ? "bg-red-50/60 hover:bg-red-50 dark:bg-red-950/15"
                    : isApproved
                    ? "bg-emerald-50/60 hover:bg-emerald-50 dark:bg-emerald-950/15"
                    : undefined
                }
              >
                <TableCell
                  className={`sticky start-0 z-10 font-medium ${stickyBackground}`}
                >
                  <div className="space-y-1.5">
                    <span className="block">{row.franchiseeName}</span>
                    {isStale ? (
                      <Badge variant="destructive">מקובץ קודם</Badge>
                    ) : isApproved ? (
                      <Badge
                        variant="outline"
                        className="gap-1 border-emerald-300 bg-emerald-100 text-emerald-800"
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        מאושר
                      </Badge>
                    ) : (
                      <Badge variant="secondary">טיוטה</Badge>
                    )}
                    {row.sourceFileName && (
                      <span className="block text-xs font-normal text-muted-foreground">
                        מקור: <bdi>{row.sourceFileName}</bdi>
                      </span>
                    )}
                  </div>
                </TableCell>
                {currencyColumns.map(([field]) => (
                  <TableCell key={field}>
                    <BillingNumber value={row[field]} kind="currency" />
                  </TableCell>
                ))}
                <TableCell>
                  <BillingNumber value={row.tierRate} kind="percent" />
                </TableCell>
                <TableCell>
                  {isApproved || row.isApprovalBlocked ? (
                    <div className="space-y-1.5">
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <LockKeyhole className="h-4 w-4" aria-hidden="true" />
                        <div>
                          <BillingNumber
                            value={row.discountRatePoints}
                            kind="percent"
                          />
                          {row.isApprovalBlocked && (
                            <span className="block text-xs">
                              חסום עד להכרעה
                            </span>
                          )}
                        </div>
                      </div>
                      <FranchiseeBillingDiscountEmail row={row} />
                    </div>
                  ) : (
                    <FranchiseeBillingDiscountCell
                      key={`${row.id}:${row.discountRatePoints}`}
                      row={row}
                      onPreview={updatePreview}
                      onSave={onSaveDiscount}
                    />
                  )}
                </TableCell>
                <TableCell>
                  <BillingNumber
                    value={
                      discountPreviews[row.id] ?? Number(row.discountValue)
                    }
                    kind="currency"
                    className="font-medium text-amber-700 dark:text-amber-300"
                  />
                </TableCell>
                <TableCell>
                  <BillingNumber value={row.royalty} kind="currency" />
                </TableCell>
                <TableCell>
                  <BillingNumber value={row.marketing} kind="currency" />
                </TableCell>
                <TableCell>
                  <BillingNumber
                    value={row.total}
                    kind="currency"
                    className="font-semibold"
                  />
                </TableCell>
                <TableCell>
                  <FranchiseeBillingNoRevenueCell
                    key={`${row.id}:${row.noRevenueReason ?? ""}`}
                    row={row}
                    onSave={onSaveNoRevenueReason}
                  />
                </TableCell>
                <TableCell>
                  <BillingNumber
                    value={row.deferralBalance}
                    kind="currency"
                    className="font-semibold text-slate-700 dark:text-slate-200"
                  />
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
        {visibleRows.length > 0 && (
          <TableFooter>
            {totalsByBrand(visibleRows).map((totals) => (
              <BrandTotalsRow key={totals.brandName} totals={totals} />
            ))}
          </TableFooter>
        )}
      </Table>
      </div>
    </div>
  );
}
