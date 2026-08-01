"use client";

import { useState } from "react";
import { CheckCircle2, LockKeyhole } from "lucide-react";

import { FranchiseeBillingDiscountCell } from "@/components/franchisee-billing-discount-cell";
import { FranchiseeBillingNoRevenueCell } from "@/components/franchisee-billing-no-revenue-cell";
import { BillingNumber } from "@/components/franchisee-billing-number";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
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

export function FranchiseeBillingTable({
  rows,
  onSaveDiscount,
  onSaveNoRevenueReason,
}: FranchiseeBillingTableProps) {
  const [discountPreviews, setDiscountPreviews] = useState<
    Readonly<Record<string, number>>
  >({});

  const updatePreview = (billingId: string, discountValue: number) => {
    setDiscountPreviews((current) => ({
      ...current,
      [billingId]: discountValue,
    }));
  };

  return (
    <div className="overflow-x-auto rounded-xl border bg-background shadow-sm">
      <Table className="min-w-[1700px]">
        <TableCaption className="pb-4">
          סכומי החיוב מוצגים כפי שנשמרו, ללא חישוב מחדש במסך.
        </TableCaption>
        <TableHeader className="bg-muted/70">
          <TableRow>
            <TableHead className="sticky start-0 z-20 min-w-44 bg-muted">
              זכיין
            </TableHead>
            {currencyColumns.map(([, label]) => (
              <TableHead key={label} className="min-w-32">
                {label}
              </TableHead>
            ))}
            <TableHead className="min-w-28">תעריף מדרגה</TableHead>
            <TableHead className="min-w-44">דחייה בנקודות אחוז</TableHead>
            <TableHead className="min-w-36">שווי הדחייה בשקלים</TableHead>
            <TableHead className="min-w-32">תמלוגים</TableHead>
            <TableHead className="min-w-32">שיווק</TableHead>
            <TableHead className="min-w-36">סה״כ לפני מע״מ</TableHead>
            <TableHead className="min-w-40">לתשלום כולל מע״מ</TableHead>
            <TableHead className="min-w-60">סיבת אין מחזור</TableHead>
            <TableHead className="min-w-40">יתרת דחיות מצטברת</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => {
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
                  <FranchiseeBillingNoRevenueCell
                    key={`${row.id}:${row.noRevenueReason ?? ""}`}
                    row={row}
                    onSave={onSaveNoRevenueReason}
                  />
                </TableCell>
                <TableCell>
                  <BillingNumber value={row.royalty} kind="currency" />
                </TableCell>
                <TableCell>
                  <BillingNumber value={row.marketing} kind="currency" />
                </TableCell>
                <TableCell>
                  <BillingNumber value={row.subtotal} kind="currency" />
                </TableCell>
                <TableCell>
                  <BillingNumber
                    value={row.total}
                    kind="currency"
                    className="font-semibold"
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
      </Table>
    </div>
  );
}
